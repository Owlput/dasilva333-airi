/**
 * Companion Embassy Durable Object (single instance per user, `idFromName('embassy')`).
 *
 * Pure helpers in this module are framework-free and covered by vitest.
 * The `EmbassyDO` class itself only runs inside workerd (WebSocket hibernation
 * + `storage.sql`) and is exercised via integration, not unit tests.
 */

export const EMBASSY_DO_ID_NAME = 'embassy'
export const EMBASSY_DO_CLASS_NAME = 'EmbassyDO'

export const FRIEND_REQUESTS_DDL = `CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_handle TEXT NOT NULL,
  from_pubkey TEXT NOT NULL,
  from_character_name TEXT NOT NULL,
  intro_message TEXT NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
)`

export const TRUSTED_PEERS_DDL = `CREATE TABLE IF NOT EXISTS trusted_peers (
  pubkey TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
)`

export const NAP_TURNS_DDL = `CREATE TABLE IF NOT EXISTS nap_turns (
  id TEXT PRIMARY KEY,
  sender_pubkey TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  timestamp INTEGER NOT NULL
)`

export const EMBASSY_SCHEMA_DDL = [FRIEND_REQUESTS_DDL, TRUSTED_PEERS_DDL, NAP_TURNS_DDL]

export interface InboundFriendRequest {
  id: string
  fromHandle: string
  fromPubkey: string
  fromCharacterName: string
  introMessage: string
  timestamp: number
  nonce: string
}

export interface NapTurnRecord {
  id: string
  senderPubkey: string
  topic: string
  payloadJson: string
  timestamp: number
}

export type EmbassyPushEvent
  = | { type: 'inbound_request', request: InboundFriendRequest }
    | { type: 'nap_turn', turn: NapTurnRecord }
    | { type: 'pending_sync', requests: InboundFriendRequest[] }

export function isValidFriendRequestRecord(value: unknown): value is InboundFriendRequest {
  if (!value || typeof value !== 'object')
    return false
  const r = value as Record<string, unknown>
  return typeof r.id === 'string' && r.id.length > 0
    && typeof r.fromHandle === 'string' && r.fromHandle.length > 0
    && typeof r.fromPubkey === 'string' && r.fromPubkey.length > 0
    && typeof r.fromCharacterName === 'string' && r.fromCharacterName.length > 0
    && typeof r.nonce === 'string' && r.nonce.length > 0
}

export function buildPushEvent(event: EmbassyPushEvent): string {
  return JSON.stringify(event)
}

export function sanitizeMachineTag(machineId?: string | null): string[] {
  if (!machineId || typeof machineId !== 'string')
    return ['unknown-device']
  const clean = machineId.trim().slice(0, 64)
  return [clean || 'unknown-device']
}

/** Minimal structural surface of a hibernating DO state (no workerd import). */
export interface EmbassyStorage {
  sql: {
    exec: <T>(query: string, ...bindings: unknown[]) => { toArray: () => T[] }
  }
  getWebSockets: (tag?: string) => WebSocket[]
}

export interface EmbassyState {
  storage: EmbassyStorage
  acceptWebSocket: (ws: WebSocket, tags?: string[]) => void
  blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>
}

export interface EmbassyEnv {
  OWNER_ID?: string
}

function ensureSchema(storage: EmbassyStorage): void {
  for (const ddl of EMBASSY_SCHEMA_DDL)
    storage.sql.exec(ddl)
}

function listPendingRequests(storage: EmbassyStorage): InboundFriendRequest[] {
  const rows = storage.sql.exec<Record<string, unknown>>(
    `SELECT id, from_handle, from_pubkey, from_character_name, intro_message, timestamp, nonce
     FROM friend_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100`,
  ).toArray()
  return rows.map(row => ({
    id: String(row.id),
    fromHandle: String(row.from_handle),
    fromPubkey: String(row.from_pubkey),
    fromCharacterName: String(row.from_character_name),
    introMessage: typeof row.intro_message === 'string' ? row.intro_message : '',
    timestamp: Number(row.timestamp),
    nonce: String(row.nonce),
  }))
}

function pushToSockets(state: EmbassyState, event: EmbassyPushEvent): number {
  const text = buildPushEvent(event)
  let delivered = 0
  for (const ws of state.storage.getWebSockets()) {
    try {
      ws.send(text)
      delivered += 1
    }
    catch {
      // NOTICE: a dead socket must never fail the store-and-forward write.
    }
  }
  return delivered
}

export class EmbassyDO {
  constructor(private readonly state: EmbassyState, private readonly env: EmbassyEnv) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket')
        return new Response('Expected websocket', { status: 426 })
      const ownerId = request.headers.get('x-owner-id') ?? url.searchParams.get('owner')
      if (!this.env.OWNER_ID || !ownerId || ownerId !== this.env.OWNER_ID)
        return new Response('Forbidden', { status: 403 })
      const machineId = url.searchParams.get('machine') ?? undefined
      const pair = new WebSocketPair()
      const client = (pair as unknown as Record<string, WebSocket>)[0]
      const server = (pair as unknown as Record<string, WebSocket>)[1]
      this.state.acceptWebSocket(server, sanitizeMachineTag(machineId))
      return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit)
    }

    if (request.method === 'POST' && url.pathname === '/internal/friend-request') {
      let record: unknown = null
      try {
        record = await request.json()
      }
      catch {
        return Response.json({ error: 'invalid_json' }, { status: 400 })
      }
      if (!isValidFriendRequestRecord(record))
        return Response.json({ error: 'invalid_identity' }, { status: 400 })
      let stored = false
      await this.state.blockConcurrencyWhile(async () => {
        ensureSchema(this.state.storage)
        const existing = this.state.storage.sql.exec(
          `SELECT id FROM friend_requests WHERE nonce = ? LIMIT 1`,
          record.nonce,
        ).toArray()
        if (existing.length > 0)
          return
        this.state.storage.sql.exec(
          `INSERT INTO friend_requests (id, from_handle, from_pubkey, from_character_name, intro_message, timestamp, nonce, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          record.id,
          record.fromHandle,
          record.fromPubkey,
          record.fromCharacterName,
          record.introMessage ?? '',
          record.timestamp,
          record.nonce,
          Date.now(),
        )
        stored = true
      })
      const pushed = pushToSockets(this.state, { type: 'inbound_request', request: record })
      return Response.json({ stored, pushed })
    }

    if (request.method === 'POST' && url.pathname === '/internal/inbox') {
      let turn: unknown = null
      try {
        turn = await request.json()
      }
      catch {
        return Response.json({ error: 'invalid_json' }, { status: 400 })
      }
      const t = turn as Record<string, unknown>
      if (!t || typeof t.senderPubkey !== 'string' || typeof t.topic !== 'string' || typeof t.payloadJson !== 'string') {
        return Response.json({ error: 'invalid_turn' }, { status: 400 })
      }
      let trusted = false
      await this.state.blockConcurrencyWhile(async () => {
        ensureSchema(this.state.storage)
        const rows = this.state.storage.sql.exec(
          `SELECT pubkey FROM trusted_peers WHERE pubkey = ? LIMIT 1`,
          t.senderPubkey,
        ).toArray()
        trusted = rows.length > 0
        if (!trusted)
          return
        this.state.storage.sql.exec(
          `INSERT OR IGNORE INTO nap_turns (id, sender_pubkey, topic, payload_json, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
          `${t.timestamp}_${t.nonce ?? 'x'}`,
          t.senderPubkey,
          t.topic,
          t.payloadJson,
          Number(t.timestamp),
        )
      })
      if (!trusted)
        return Response.json({ error: 'quarantined' }, { status: 403 })
      const pushed = pushToSockets(this.state, {
        type: 'nap_turn',
        turn: {
          id: `${t.timestamp}`,
          senderPubkey: t.senderPubkey as string,
          topic: t.topic as string,
          payloadJson: t.payloadJson as string,
          timestamp: Number(t.timestamp),
        },
      })
      return Response.json({ queued: true, pushed })
    }

    if (request.method === 'POST' && url.pathname === '/internal/accept') {
      let body: any = null
      try {
        body = await request.json()
      }
      catch {
        return Response.json({ error: 'invalid_json' }, { status: 400 })
      }
      if (typeof body?.pubkey !== 'string' || !body.pubkey) {
        return Response.json({ error: 'invalid_identity' }, { status: 400 })
      }
      await this.state.blockConcurrencyWhile(async () => {
        ensureSchema(this.state.storage)
        this.state.storage.sql.exec(
          `INSERT OR REPLACE INTO trusted_peers (pubkey, handle, accepted_at) VALUES (?, ?, ?)`,
          body.pubkey,
          typeof body.handle === 'string' ? body.handle : '',
          Date.now(),
        )
        this.state.storage.sql.exec(
          `UPDATE friend_requests SET status = 'trusted' WHERE from_pubkey = ? AND status = 'pending'`,
          body.pubkey,
        )
      })
      return Response.json({ trusted: true })
    }

    if (request.method === 'GET' && url.pathname === '/internal/pending') {
      let requests: InboundFriendRequest[] = []
      await this.state.blockConcurrencyWhile(async () => {
        ensureSchema(this.state.storage)
        requests = listPendingRequests(this.state.storage)
      })
      return Response.json({ requests })
    }

    return new Response('Not Found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let action: unknown = null
    try {
      action = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
    }
    catch {
      return
    }
    if (!action || typeof action !== 'object' || (action as Record<string, unknown>).action !== 'sync')
      return
    let requests: InboundFriendRequest[] = []
    await this.state.blockConcurrencyWhile(async () => {
      ensureSchema(this.state.storage)
      requests = listPendingRequests(this.state.storage)
    })
    try {
      ws.send(buildPushEvent({ type: 'pending_sync', requests }))
    }
    catch {
      // NOTICE: sync reply is best-effort; the socket may have raced a close.
    }
  }

  async webSocketClose(): Promise<void> {
    // NOTICE: hibernation attachments clean up automatically; nothing to persist.
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'Embassy socket error')
    }
    catch {
      // NOTICE: closing an already-dead socket must not throw.
    }
  }
}
