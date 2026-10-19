import type { Peer } from '@proj-airi/stage-shared'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useNapChatStore } from './nap-chat'

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

describe('useNapChatStore.selectCandidates', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('fail-closed when globally disabled', () => {
    const store = useNapChatStore()
    store.napEnabled = false
    expect(store.selectCandidates([friend()], 'card-1', 9999)).toEqual([])
  })

  it('requires user away at nap threshold', () => {
    const store = useNapChatStore()
    store.afkThresholdMinutes = 15
    expect(store.selectCandidates([friend()], 'card-1', 60)).toEqual([])
    expect(store.selectCandidates([friend()], 'card-1', 901)).toHaveLength(1)
  })

  it('respects per-friend allowlist', () => {
    const store = useNapChatStore()
    const gated = friend({ allowedCompanionIds: ['card-allowed'] })
    expect(store.selectCandidates([gated], 'card-other', 9999)).toEqual([])
    expect(store.selectCandidates([gated], 'card-allowed', 9999)).toHaveLength(1)
  })

  it('single-fire welcome-back recap', () => {
    const store = useNapChatStore()
    expect(store.shouldDeliverRecap()).toBe(true)
    expect(store.shouldDeliverRecap()).toBe(false)
    store.markIdleSessionStarted()
    expect(store.shouldDeliverRecap()).toBe(true)
  })
})
