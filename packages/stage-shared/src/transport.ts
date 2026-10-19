export type TransportId = 'cloudflare-edge' | 'libp2p-mesh' | 'loopback'
export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface TransportMessage<T = unknown> {
  topic: string
  payload: T
  senderId: string
  timestamp: number
}

export type TransportHandler<T = unknown> = (msg: TransportMessage<T>) => void

export interface TransportAdapter {
  readonly id: TransportId
  readonly status: TransportStatus
  start: () => Promise<void>
  stop: () => Promise<void>
  sendToPeer: <T>(peerId: string, topic: string, payload: T) => Promise<boolean>
  broadcast: <T>(topic: string, payload: T) => Promise<void>
  subscribe: <T>(topic: string, handler: TransportHandler<T>) => Promise<() => void>
}

export interface CloudflareEdgeTransportConfig {
  workerOrigin: string
  senderPubkey: string
  sign: (message: string) => Promise<string>
}

export function createLoopbackTransport(): TransportAdapter {
  const subs = new Map<string, Set<TransportHandler<any>>>()
  let status: TransportStatus = 'disconnected'

  return {
    id: 'loopback',
    get status() { return status },
    async start() { status = 'connected' },
    async stop() {
      status = 'disconnected'
      subs.clear()
    },
    async sendToPeer(peerId, topic, payload) {
      const handlers = subs.get(topic)
      if (!handlers || handlers.size === 0)
        return false
      const msg = { topic, payload, senderId: peerId, timestamp: Date.now() }
      for (const handler of [...handlers]) handler(msg)
      return true
    },
    async broadcast(topic, payload) {
      const handlers = subs.get(topic)
      if (!handlers)
        return
      const msg = { topic, payload, senderId: 'local', timestamp: Date.now() }
      for (const handler of [...handlers]) handler(msg)
    },
    async subscribe(topic, handler) {
      let set = subs.get(topic)
      if (!set) {
        set = new Set()
        subs.set(topic, set)
      }
      set.add(handler as TransportHandler<any>)
      return () => {
        set!.delete(handler as TransportHandler<any>)
      }
    },
  }
}
