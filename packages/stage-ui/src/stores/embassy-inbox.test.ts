import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useEmbassyInboxStore } from './embassy-inbox'

class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: ((event: any) => void) | null = null
  onmessage: ((event: any) => void) | null = null
  onclose: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {}

  simulateOpen() {
    this.onopen?.({})
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data })
  }
}

function setup() {
  setActivePinia(createPinia())
  FakeSocket.instances = []
  const store = useEmbassyInboxStore()
  return { store }
}

async function connect(store: ReturnType<typeof useEmbassyInboxStore>) {
  await store.connect({
    workerUrl: 'https://airi-stage-edge.test.workers.dev',
    ownerId: 'owner-1',
    machineId: 'test-machine',
    socketImpl: FakeSocket as any,
  })
  FakeSocket.instances[0].simulateOpen()
}

describe('useEmbassyInboxStore', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the embassy socket and requests a sync catch-up', async () => {
    const { store } = setup()
    await connect(store)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0].url).toBe('wss://airi-stage-edge.test.workers.dev/ws?owner=owner-1&machine=test-machine')
    expect(FakeSocket.instances[0].sent).toEqual([JSON.stringify({ action: 'sync' })])
    expect(store.connected).toBe(true)
    store.disconnect()
    expect(store.connected).toBe(false)
  })

  it('fills the inbound queue from pending_sync without duplicates', async () => {
    const { store } = setup()
    await connect(store)
    const ws = FakeSocket.instances[0]
    const sync = {
      type: 'pending_sync',
      requests: [
        { id: 'r1', fromHandle: 'alex.workers.dev', fromPubkey: 'ab'.repeat(32), fromCharacterName: 'Kirie', timestamp: 1, nonce: 'n1', status: 'pending' },
        { id: 'r2', fromHandle: 'sarah.workers.dev', fromPubkey: 'cd'.repeat(32), fromCharacterName: 'Lain', timestamp: 2, nonce: 'n2', status: 'pending' },
      ],
    }
    ws.simulateMessage(JSON.stringify(sync))
    ws.simulateMessage(JSON.stringify(sync))
    expect(store.pendingRequests).toHaveLength(2)
    expect(store.pendingRequests.map(r => r.id).sort()).toEqual(['r1', 'r2'])
    store.disconnect()
  })

  it('routes nap turns through the transport into recentTurns', async () => {
    const { store } = setup()
    await connect(store)
    const envelope = JSON.stringify({ topic: 'airi/nap-chat/turn', payload: { text: 'hey' }, senderId: 'peer-x', timestamp: 7 })
    FakeSocket.instances[0].simulateMessage(JSON.stringify({ type: 'nap_turn', turn: { payloadJson: envelope } }))
    expect(store.recentTurns).toHaveLength(1)
    expect(store.recentTurns[0].topic).toBe('airi/nap-chat/turn')
    expect(store.recentTurns[0].senderId).toBe('peer-x')
    store.disconnect()
  })

  it('accept writes trust server-side first, roster second', async () => {
    const { store } = setup()
    await connect(store)
    FakeSocket.instances[0].simulateMessage(JSON.stringify({
      type: 'inbound_request',
      request: { id: 'r9', fromHandle: 'alex.workers.dev', fromPubkey: 'ab'.repeat(32), fromCharacterName: 'Kirie', timestamp: 1, nonce: 'n9', status: 'pending' },
    }))
    expect(store.pendingRequests).toHaveLength(1)

    const calls: Array<{ url: string, init: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ trusted: true }), { status: 200 })
    }))

    const res = await store.acceptRequest('r9')
    expect(res).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://airi-stage-edge.test.workers.dev/api/friends/accept')
    expect(JSON.parse(calls[0].init.body)).toEqual({ pubkey: 'ab'.repeat(32), handle: 'alex.workers.dev' })
    expect(calls[0].init.headers['x-owner-id']).toBe('owner-1')
    expect(store.pendingRequests).toHaveLength(0)

    const { usePeersStore } = await import('./peers')
    const peers = usePeersStore()
    const entry = peers.roster.find(p => p.id === 'ab'.repeat(32))
    expect(entry?.trustState).toBe('trusted')
    expect(entry && 'allowedCapabilities' in entry && (entry as any).allowedCapabilities.canNapChat).toBe(false)
    store.disconnect()
  })

  it('rejects unknown requests and surfaces worker failures', async () => {
    const { store } = setup()
    await connect(store)
    expect(await store.acceptRequest('nope')).toEqual({ ok: false, error: 'Unknown request.' })

    FakeSocket.instances[0].simulateMessage(JSON.stringify({
      type: 'inbound_request',
      request: { id: 'r8', fromHandle: 'alex.workers.dev', fromPubkey: 'ab'.repeat(32), fromCharacterName: 'Kirie', timestamp: 1, nonce: 'n8', status: 'pending' },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'quarantined' }), { status: 403 })))
    expect((await store.acceptRequest('r8')).ok).toBe(false)
    expect(store.pendingRequests).toHaveLength(1)
    store.disconnect()
  })

  it('ignore filters locally and survives resync within the session', async () => {
    const { store } = setup()
    await connect(store)
    const ws = FakeSocket.instances[0]
    const mk = (id: string) => JSON.stringify({ type: 'pending_sync', requests: [{ id, fromHandle: 'a.w.dev', fromPubkey: 'ab'.repeat(32), fromCharacterName: 'K', timestamp: 1, nonce: id, status: 'pending' }] })
    ws.simulateMessage(mk('r1'))
    expect(store.pendingRequests).toHaveLength(1)
    store.ignoreRequest('r1')
    expect(store.pendingRequests).toHaveLength(0)
    ws.simulateMessage(mk('r1'))
    expect(store.pendingRequests).toHaveLength(0)
    store.disconnect()
  })
})
