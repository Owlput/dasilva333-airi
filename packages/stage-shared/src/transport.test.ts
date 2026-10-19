import { describe, expect, it } from 'vitest'

import { createLoopbackTransport } from './transport'

describe('createLoopbackTransport', () => {
  it('delivers broadcast to subscribers and unsubscribes', async () => {
    const transport = createLoopbackTransport()
    await transport.start()
    expect(transport.status).toBe('connected')

    const received: unknown[] = []
    const unsubscribe = await transport.subscribe('nap_propose', msg => received.push(msg.payload))
    await transport.broadcast('nap_propose', { hello: true })
    expect(received).toEqual([{ hello: true }])

    unsubscribe()
    await transport.broadcast('nap_propose', { hello: false })
    expect(received).toEqual([{ hello: true }])
    await transport.stop()
    expect(transport.status).toBe('disconnected')
  })

  it('sendToPeer returns false with no subscribers', async () => {
    const transport = createLoopbackTransport()
    await transport.start()
    expect(await transport.sendToPeer('peer-1', 'nap_turn', {})).toBe(false)
    await transport.stop()
  })
})
