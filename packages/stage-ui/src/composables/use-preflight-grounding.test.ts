import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { usePreFlightGrounding } from './use-preflight-grounding'

const mockSearchEntries = vi.fn()

vi.mock('../stores/memory-text-journal', () => ({
  useTextJournalStore: () => ({
    searchEntries: mockSearchEntries,
  }),
}))

const activeCardMock = ref<any>({
  name: 'Ren',
  extensions: {
    airi: {
      groundingMemoryEnabled: true,
    },
  },
})
const activeCardIdMock = ref<string | undefined>('card-ren')

vi.mock('../stores/modules/airi-card', () => ({
  useAiriCardStore: () => ({
    activeCard: activeCardMock,
    activeCardId: activeCardIdMock,
  }),
}))

describe('usePreFlightGrounding', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    mockSearchEntries.mockReset()
    activeCardMock.value = {
      name: 'Ren',
      extensions: {
        airi: {
          groundingMemoryEnabled: true,
        },
      },
    }
  })

  it('separates true KG claims into kgFacts and dialogue mentions into memories', async () => {
    mockSearchEntries.mockResolvedValueOnce([
      {
        id: 'claim:finch-banker',
        isKgClaim: true,
        kind: 'kg_claim',
        subject: 'Finch',
        predicate: 'is',
        object: 'Banker',
        score: 0.95,
        content: '[Knowledge Graph] Finch is Banker',
      },
      {
        id: 'kg-mention:turn-academy-1',
        title: '[Knowledge Graph] Academy (Mention)',
        kind: 'raw',
        subject: 'Academy',
        predicate: 'mentioned in',
        object: 'C6rlV2MvRWuQJJnXHiDFq\'s turn',
        content: 'Ren stands alone in the alley... Behind him, the massive towers of the Imperial Academy rise.',
        isKgClaim: true,
        score: 0.70,
        timestamp: '2026-10-17T14:00:00.000Z',
      },
      {
        id: 'journal-entry-1',
        title: 'Spore Cultivation',
        kind: 'journal',
        content: 'Ren harvested glowing moss spores today.',
        score: 0.82,
      },
    ])

    const messageInput = ref('Have you guys seen the Academy?')
    const { memories, kgFacts, search, stagedGroundingPayload } = usePreFlightGrounding({
      messageInput,
      activeCardId: activeCardIdMock,
    })

    await search('Have you guys seen the Academy?')

    // 1. kgFacts must contain Knowledge Graph claims and entity associations
    expect(kgFacts.value).toHaveLength(2)
    const finchClaim = kgFacts.value.find(f => f.id === 'claim:finch-banker')
    expect(finchClaim).toBeDefined()
    expect(finchClaim?.subject).toBe('Finch')
    expect(finchClaim?.predicate).toBe('is')
    expect(finchClaim?.object).toBe('Banker')

    const academyMention = kgFacts.value.find(f => f.id === 'kg-mention:turn-academy-1')
    expect(academyMention).toBeDefined()
    expect(academyMention?.subject).toBe('Academy')
    expect(academyMention?.predicate).toBe('mentioned in')

    // 2. memories must contain pure episodic rawSearch entries
    expect(memories.value).toHaveLength(1)
    const journal = memories.value.find(m => m.id === 'journal-entry-1')
    expect(journal).toBeDefined()
    expect(journal?.title).toBe('Spore Cultivation')
    expect(journal?.content).toContain('Ren harvested glowing moss spores today.')

    // 3. stagedGroundingPayload compiles to prompt with BOTH sections and narrative content intact
    expect(stagedGroundingPayload.value).not.toBeNull()
    const promptText = stagedGroundingPayload.value?.content || ''

    expect(promptText).toContain('[CONFIRMED KNOWLEDGE GRAPH FACTS]')
    expect(promptText).toContain('• Finch ➔ is ➔ Banker')

    expect(promptText).toContain('[VERBATIM DIALOGUE MEMORIES]')
    expect(promptText).toContain('Ren stands alone in the alley... Behind him, the massive towers of the Imperial Academy rise.')
    expect(promptText).toContain('Ren harvested glowing moss spores today.')

    // Must NOT contain the corrupted bare triple
    expect(promptText).not.toContain('• Academy ➔ mentioned in')
  })

  it('clears results when messageInput is short or empty', async () => {
    const messageInput = ref('hi')
    const { memories, kgFacts, search } = usePreFlightGrounding({
      messageInput,
      activeCardId: activeCardIdMock,
    })

    await search('hi')
    expect(memories.value).toHaveLength(0)
    expect(kgFacts.value).toHaveLength(0)
    expect(mockSearchEntries).not.toHaveBeenCalled()
  })
})
