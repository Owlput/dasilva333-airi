import type { Peer } from '@proj-airi/stage-shared'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useNapChatStore } from './nap-chat'
import { NAP_COORDINATOR_MAX_TURNS, useNapChatCoordinatorStore } from './nap-chat-coordinator'

function friend(overrides: Partial<Peer> = {}): Peer {
  return {
    id: 'ed25519-kirie',
    alias: 'Alex',
    characterName: 'Kirie',
    relationship: 'external-friend',
    trustState: 'trusted',
    lastSeenTimestamp: Date.now(),
    endpoints: {},
    shareHandle: 'alex.workers.dev',
    allowedCapabilities: { canNapChat: true, canShareMemories: false, canStreamSensory: false },
    allowedCompanionIds: [],
    ...overrides,
  } as Peer
}

describe('useNapChatCoordinatorStore.evaluateTrigger', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('fires when away with eligible candidates', () => {
    const store = useNapChatCoordinatorStore()
    expect(store.evaluateTrigger(9999, [friend()], 'card-1')).toEqual({ fire: true, reason: 'ok' })
  })

  it('reports disabled when the master switch is off', () => {
    const napChat = useNapChatStore()
    napChat.napEnabled = false
    const store = useNapChatCoordinatorStore()
    expect(store.evaluateTrigger(9999, [friend()], 'card-1')).toEqual({ fire: false, reason: 'disabled' })
  })

  it('reports user-present when idle below threshold', () => {
    const store = useNapChatCoordinatorStore()
    expect(store.evaluateTrigger(60, [friend()], 'card-1')).toEqual({ fire: false, reason: 'user-present' })
  })

  it('reports no-candidates when away but nobody is eligible', () => {
    const store = useNapChatCoordinatorStore()
    const blocked = friend({ trustState: 'blocked' })
    expect(store.evaluateTrigger(9999, [blocked], 'card-1')).toEqual({ fire: false, reason: 'no-candidates' })
  })
})

describe('useNapChatCoordinatorStore session lifecycle', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('runs a capped turn loop and records the episode', () => {
    const store = useNapChatCoordinatorStore()
    expect(store.beginSession('ed25519-kirie', 'card-1', 'shader pipeline')).toBe(true)
    expect(store.beginSession('other', 'card-1')).toBe(false)
    expect(store.isActive).toBe(true)

    for (let i = 0; i < NAP_COORDINATOR_MAX_TURNS + 2; i++)
      store.recordTurn(i % 2 === 0 ? 'AIRI' : 'Kirie', `turn ${i}`)
    expect(store.turnCount).toBe(NAP_COORDINATOR_MAX_TURNS)

    const episode = store.finishSession('Compared notes on a rainy afternoon.')
    expect(episode).not.toBeNull()
    expect(episode!.turnCount).toBe(NAP_COORDINATOR_MAX_TURNS)
    expect(episode!.summary).toContain('rainy afternoon')
    expect(store.status).toBe('done')
  })

  it('rejects turns and finish outside an active session', () => {
    const store = useNapChatCoordinatorStore()
    expect(store.recordTurn('AIRI', 'hi')).toBe(false)
    expect(store.finishSession('nope')).toBeNull()
  })

  it('aborts and resets cleanly', () => {
    const store = useNapChatCoordinatorStore()
    store.beginSession('ed25519-kirie', 'card-1')
    store.recordTurn('AIRI', 'hi')
    store.abortSession()
    expect(store.status).toBe('aborted')
    expect(store.turnCount).toBe(0)
    store.resetSession()
    expect(store.status).toBe('idle')
    expect(store.beginSession('ed25519-kirie', 'card-1')).toBe(true)
  })
})
