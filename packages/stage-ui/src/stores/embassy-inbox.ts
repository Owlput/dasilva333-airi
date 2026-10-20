import type { FriendRequest, Peer } from '@proj-airi/stage-shared'

import type { EmbassySocketRequest } from '../libs/transport/embassy-socket'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { getOrCreateDeviceKeypair, uint8ArrayToHex } from '../composables/use-peer-embassy'
import { createCloudflareEdgeTransport, NAP_CHAT_TOPICS } from '../libs/transport/cloudflare-edge-transport'
import { createEmbassySocket } from '../libs/transport/embassy-socket'
import { usePeersStore } from './peers'

export interface EmbassyInboxConnectOptions {
  workerUrl: string
  ownerId: string
  machineId?: string
  socketImpl?: typeof WebSocket
  fetchFn?: typeof fetch
}

interface EmbassySocketHandle {
  disconnect: () => void
  sendSync: () => boolean
  readonly status: string
}

async function signWithKeypair(privateKey: CryptoKey, message: string): Promise<string> {
  const data = new TextEncoder().encode(message)
  const sig = await crypto.subtle.sign('Ed25519', privateKey, data)
  return uint8ArrayToHex(new Uint8Array(sig))
}

/**
 * Live embassy inbox (plumbing side).
 *
 * Owns the hibernated WebSocket + CloudflareEdge transport pair and a real
 * inbound friend-request queue. Nap turns arriving on the socket are fanned
 * into the transport's subscriber set; the nap-chat coordinator subscribes
 * there. Accepting writes trust server-side first, roster second.
 */
export const useEmbassyInboxStore = defineStore('embassy-inbox', () => {
  const connected = ref(false)
  const socketStatus = ref('disconnected')
  const workerUrl = ref<string | null>(null)
  const ownerId = ref<string | null>(null)
  const inboundRequests = ref<FriendRequest[]>([])
  const ignoredIds = ref<Set<string>>(new Set())
  const recentTurns = ref<Array<{ topic: string, payload: unknown, senderId: string, timestamp: number }>>([])

  let socket: EmbassySocketHandle | null = null
  let transport: ReturnType<typeof createCloudflareEdgeTransport> | null = null
  let unsubscribeTurns: (() => void) | null = null

  const pendingRequests = computed(() => inboundRequests.value.filter(r => r.status === 'pending' && !ignoredIds.value.has(r.id)))

  function upsertRequest(request: FriendRequest | (EmbassySocketRequest & { status?: FriendRequest['status'] })) {
    const idx = inboundRequests.value.findIndex(r => r.id === request.id)
    const normalized: FriendRequest = {
      id: request.id,
      fromHandle: request.fromHandle,
      fromPubkey: request.fromPubkey,
      fromCharacterName: request.fromCharacterName,
      introMessage: request.introMessage,
      timestamp: request.timestamp ?? Date.now(),
      nonce: request.nonce ?? request.id,
      status: request.status ?? 'pending',
    }
    if (idx >= 0)
      inboundRequests.value[idx] = normalized
    else inboundRequests.value.push(normalized)
  }

  async function connect(options: EmbassyInboxConnectOptions) {
    disconnect()
    workerUrl.value = options.workerUrl
    ownerId.value = options.ownerId

    const keypair = await getOrCreateDeviceKeypair()
    const sign = (message: string) => signWithKeypair(keypair.privateKey, message)

    const peersStore = usePeersStore()
    await peersStore.init()
    const edgeTransport = createCloudflareEdgeTransport({
      senderPubkey: keypair.publicKeyHex,
      resolvePeerWorkerUrl: (peerId: string) => {
        const peer = (peersStore.roster as Peer[]).find(p => p.id === peerId)
        return peer?.endpoints.cloudflareWorkerUrl ?? null
      },
      sign,
      fetchFn: options.fetchFn,
    })
    transport = edgeTransport
    await edgeTransport.start()
    unsubscribeTurns = await edgeTransport.subscribe(NAP_CHAT_TOPICS.turn, (msg) => {
      recentTurns.value.push({ topic: msg.topic, payload: msg.payload, senderId: msg.senderId, timestamp: msg.timestamp })
      if (recentTurns.value.length > 50)
        recentTurns.value.splice(0, recentTurns.value.length - 50)
    })

    const sock = createEmbassySocket({
      workerUrl: options.workerUrl,
      ownerId: options.ownerId,
      machineId: options.machineId ?? `machine-${Date.now().toString(36)}`,
      socketImpl: options.socketImpl,
      events: {
        onEnvelopeText: raw => edgeTransport.ingestInboundEnvelope(raw, 'embassy-socket'),
        onRequest: request => upsertRequest(request),
        onSyncRequests: requests => requests.forEach(upsertRequest),
        onStatusChange: status => socketStatus.value = status,
      },
    })
    socket = sock
    sock.connect()
    connected.value = true
  }

  function disconnect() {
    try {
      socket?.disconnect()
    }
    catch {}
    try {
      unsubscribeTurns?.()
    }
    catch {}
    void transport?.stop().catch(() => {})
    socket = null
    transport = null
    unsubscribeTurns = null
    connected.value = false
    socketStatus.value = 'disconnected'
  }

  function ignoreRequest(id: string) {
    // NOTICE: local-only until the worker gains a decline route; a dropped
    // entry reappears on the next sync catch-up while the DO still holds it.
    ignoredIds.value.add(id)
    inboundRequests.value = inboundRequests.value.filter(r => r.id !== id)
  }

  async function acceptRequest(id: string): Promise<{ ok: boolean, error?: string }> {
    const request = inboundRequests.value.find(r => r.id === id)
    if (!request)
      return { ok: false, error: 'Unknown request.' }
    if (!workerUrl.value || !ownerId.value)
      return { ok: false, error: 'Embassy not connected.' }
    let res: Response
    try {
      const fetchFn = (globalThis.fetch ?? fetch).bind(globalThis)
      res = await fetchFn(`${workerUrl.value.replace(/\/$/, '')}/api/friends/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-owner-id': ownerId.value },
        body: JSON.stringify({ pubkey: request.fromPubkey, handle: request.fromHandle }),
      })
    }
    catch (err: any) {
      return { ok: false, error: err?.message || 'Network error.' }
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        detail = (await res.json() as any)?.error ?? detail
      }
      catch {}
      return { ok: false, error: String(detail) }
    }
    request.status = 'accepted'
    inboundRequests.value = inboundRequests.value.filter(r => r.id !== id)
    const peersStore = usePeersStore()
    await peersStore.upsertPeer({
      id: request.fromPubkey,
      alias: request.fromHandle.split('.')[0] || request.fromCharacterName,
      characterName: request.fromCharacterName,
      relationship: 'external-friend',
      trustState: 'trusted',
      lastSeenTimestamp: Date.now(),
      endpoints: {
        cloudflareWorkerUrl: request.fromHandle.startsWith('http') ? request.fromHandle : `https://${request.fromHandle}`,
      },
      shareHandle: request.fromHandle,
      allowedCapabilities: { canNapChat: false, canShareMemories: false, canStreamSensory: false },
      allowedCompanionIds: [],
    })
    return { ok: true }
  }

  function getTransport() {
    return transport
  }

  return {
    connected,
    socketStatus,
    workerUrl,
    inboundRequests,
    pendingRequests,
    recentTurns,
    connect,
    disconnect,
    ignoreRequest,
    acceptRequest,
    getTransport,
  }
})
