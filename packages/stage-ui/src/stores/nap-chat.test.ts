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

  it('records episode and formats welcome-back recap with NO_REPLY guard', () => {
    const store = useNapChatStore()
    expect(store.latestEpisode).toBeNull()
    expect(store.formatWelcomeBackRecap()).toBe('NO_REPLY')

    store.recordEpisode({
      sessionId: 'sess-test-99',
      with: { characterName: 'Kirie', alias: 'Alex' },
      turnCount: 4,
      summary: 'Compared notes on a rainy afternoon.',
      timestamp: Date.now(),
      journalEntryId: 'ltmm-entry-99',
      turns: [{ speaker: 'AIRI', text: 'Hey Kirie!', time: '14:20' }],
    })

    expect(store.latestEpisode?.with.characterName).toBe('Kirie')
    expect(store.formatWelcomeBackRecap()).toContain('Kirie')

    expect(store.formatWelcomeBackRecap(null)).toBe('NO_REPLY')
  })

  it('manages companion social prompt guidance and per-friend topic guidance', () => {
    const store = useNapChatStore()
    expect(store.socialPromptGuidance).toContain('Be casual, friendly, and enthusiastic')

    store.socialPromptGuidance = 'Focus on robotics, anime recommendations, and 3D printing.'
    expect(store.socialPromptGuidance).toBe('Focus on robotics, anime recommendations, and 3D printing.')

    const peerWithGuidance = friend({
      allowedCapabilities: {
        canNapChat: true,
        canShareMemories: false,
        canStreamSensory: false,
        customPromptGuidance: 'Discuss local LLM benchmarks and quantization.',
      },
    })
    expect(peerWithGuidance.allowedCapabilities.customPromptGuidance).toBe('Discuss local LLM benchmarks and quantization.')
  })
})

describe('useNapChatStore dialog defaults', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults the history window to 6 turns', async () => {
    const { NAP_HISTORY_WINDOW_DEFAULT, useNapChatStore } = await import('./nap-chat')
    expect(NAP_HISTORY_WINDOW_DEFAULT).toBe(6)
    expect(useNapChatStore().napHistoryWindow).toBe(6)
  })

  it('ships conditional first-contact/continuation clauses keyed on the stable marker', async () => {
    const { DEFAULT_SOCIAL_PROMPT_GUIDANCE, NAP_DIALOG_NO_HISTORY_MARKER } = await import('./nap-chat')
    expect(NAP_DIALOG_NO_HISTORY_MARKER).toBe('No prior episodes with this peer.')
    expect(DEFAULT_SOCIAL_PROMPT_GUIDANCE).toContain('No prior episodes with this peer')
    expect(DEFAULT_SOCIAL_PROMPT_GUIDANCE).toContain('do not re-greet')
  })
})
