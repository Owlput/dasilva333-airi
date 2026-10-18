import type { TextJournalEntry } from '../types/text-journal'
import type { AiriCard } from './modules/airi-card'

import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { shortTermMemoryRepo } from '../database/repos/short-term-memory.repo'
import { LAST_INDEXED_TURN_KEY, layeredMemory } from '../libs/search/layered-memory'
import { useTextJournalStore } from './memory-text-journal'

// Mock the database repo so tests don't touch IndexedDB
vi.mock('../database/repos/text-journal.repo', () => ({
  textJournalRepo: {
    getAll: vi.fn(async () => []),
    saveAll: vi.fn(async () => undefined),
  },
}))

// NOTICE: Pinia v3's storeToRefs iterates all keys and does `value.effect` before
// isRef/isReactive — it crashes on null/primitive values. The correct pattern is to
// return a `reactive()` object wrapping Vue refs so storeToRefs gets a Pinia-like
// proxy that auto-unwraps refs (reactive() unwraps nested refs on access).
//
// The vi.mock factories use async `import('vue')` — Vitest vi.mock factories support
// async imports. The reactive/ref state holders are created once per module load
// then mutated between tests through the `h` hoisted handles.

// Shared mutable state holders — initialised to null, filled by the mock factories.
// vi.hoisted ensures they exist before vi.mock factories run.
const h = vi.hoisted(() => ({
  userId: { r: null as null | { value: string | null } },
  activeCard: { r: null as null | { value: AiriCard | null } },
  activeCardId: { r: null as null | { value: string } },
  cards: { r: null as null | { value: Map<string, AiriCard> } },
}))

vi.mock('./auth', async () => {
  const { reactive, ref } = await import('vue')
  h.userId.r = ref<string | null>(null)
  return { useAuthStore: () => reactive({ userId: h.userId.r }) }
})

vi.mock('./modules/airi-card', async () => {
  const { reactive, ref } = await import('vue')
  h.activeCard.r = ref<AiriCard | null>(null)
  h.activeCardId.r = ref<string>('card-1')
  h.cards.r = ref<Map<string, AiriCard>>(new Map())
  const store = reactive({
    activeCard: h.activeCard.r,
    activeCardId: h.activeCardId.r,
    cards: h.cards.r,
  })
  return { useAiriCardStore: () => store }
})

vi.mock('./chat/session-store', async () => {
  return {
    useChatSessionStore: () => ({
      activeSessionId: 'test-session',
      getCharacterIndex: vi.fn(() => ({ activeSessionId: 'test-session' })),
      getSessionMeta: vi.fn(() => ({ universe: 'default' })),
    }),
  }
})

// Import the repo AFTER mocks are registered to get the mocked version
const { textJournalRepo } = await import('../database/repos/text-journal.repo')

// Minimal card fixture — only the fields memory-text-journal.ts actually reads (name).
// Cast to avoid constructing the full AiriExtension required by the AiriCard type.
const mockCard = { name: 'TestChar', version: '1' } as unknown as AiriCard

describe('useTextJournalStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(textJournalRepo.saveAll as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    // Reset reactive mock state before each test
    h.activeCard.r!.value = mockCard
    h.activeCardId.r!.value = 'card-1'
    h.cards.r!.value = new Map([['card-1', mockCard]])

    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    setActivePinia(pinia)
  })

  // ————————————————— load ————————————————————————————————————————————————————————————

  describe('load', () => {
    it('fetches entries from the repo and normalizes them', async () => {
      const raw: TextJournalEntry[] = [
        {
          id: '1',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Hello',
          content: 'World',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(raw)

      const store = useTextJournalStore()
      await store.load()

      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].title).toBe('Hello')
    })

    it('does not call repo a second time when already initialized for the same userId', async () => {
      const store = useTextJournalStore()
      await store.load()
      await store.load()

      expect(textJournalRepo.getAll).toHaveBeenCalledTimes(1)
    })

    it('treats a null repo result as an empty array', async () => {
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const store = useTextJournalStore()
      await store.load()

      expect(store.entries).toHaveLength(0)
    })
  })

  // ————————————————— createEntry —————————————————————————————————————————————————————

  describe('createEntry', () => {
    it('creates an entry scoped to the active character', async () => {
      const store = useTextJournalStore()
      const entry = await store.createEntry({ title: 'My Day', content: 'Great day!' })

      expect(entry.characterId).toBe('card-1')
      expect(entry.characterName).toBe('TestChar')
      expect(entry.title).toBe('My Day')
      expect(entry.content).toBe('Great day!')
      expect(entry.source).toBe('tool')
      expect(typeof entry.createdAt).toBe('number')
    })

    it('falls back to "Journal Entry" when title is omitted', async () => {
      const store = useTextJournalStore()
      const entry = await store.createEntry({ content: 'No title provided' })
      expect(entry.title).toBe('Journal Entry')
    })

    it('resolves character by explicit characterId when provided', async () => {
      const altCard = { name: 'AltChar', version: '1' } as unknown as AiriCard
      h.cards.r!.value.set('card-2', altCard)

      const store = useTextJournalStore()
      const entry = await store.createEntry({ content: 'alt', characterId: 'card-2' })
      expect(entry.characterId).toBe('card-2')
      expect(entry.characterName).toBe('AltChar')
    })

    it('throws when no active card is available', async () => {
      h.activeCard.r!.value = null
      h.activeCardId.r!.value = ''

      const store = useTextJournalStore()
      await expect(store.createEntry({ content: 'orphan' })).rejects.toThrow(
        'No active character is available for text_journal.create.',
      )
    })

    it('throws when active card id is empty after resolution', async () => {
      h.activeCardId.r!.value = ''

      const store = useTextJournalStore()
      await expect(store.createEntry({ content: 'test' })).rejects.toThrow(
        'Active character could not be resolved for text journal entry creation.',
      )
    })

    it('wraps persist errors with a text_journal prefix', async () => {
      ;(textJournalRepo.saveAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'))

      const store = useTextJournalStore()
      await expect(store.createEntry({ title: 'Oops', content: 'fail' })).rejects.toThrow(
        'text_journal: failed to persist new entry "Oops": disk full',
      )
    })

    it('prepends the new entry so it appears first', async () => {
      const existing: TextJournalEntry = {
        id: 'old-1',
        userId: 'local',
        characterId: 'card-1',
        characterName: 'TestChar',
        title: 'Old',
        content: 'Old content',
        source: 'tool',
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        last_review: 0,
        createdAt: 1000,
        updatedAt: 1000,
      }
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([existing])

      const store = useTextJournalStore()
      await store.createEntry({ content: 'New content', title: 'New' })

      const saved = (textJournalRepo.saveAll as ReturnType<typeof vi.fn>).mock.calls[0][1] as TextJournalEntry[]
      expect(saved[0].title).toBe('New')
      expect(saved[1].id).toBe('old-1')
    })
  })

  // ————————————————— searchEntries ——————————————————————————————————————————————————

  describe('searchEntries', () => {
    const makeEntry = (overrides: Partial<TextJournalEntry>): TextJournalEntry => ({
      id: overrides.id ?? 'e1',
      userId: 'local',
      characterId: overrides.characterId ?? 'card-1',
      characterName: 'TestChar',
      title: overrides.title ?? 'Untitled',
      content: overrides.content ?? '',
      source: overrides.source ?? 'tool',
      stability: overrides.stability ?? 0,
      difficulty: overrides.difficulty ?? 0,
      elapsed_days: overrides.elapsed_days ?? 0,
      scheduled_days: overrides.scheduled_days ?? 0,
      last_review: overrides.last_review ?? 0,
      createdAt: overrides.createdAt ?? 1000,
      updatedAt: overrides.updatedAt ?? 1000,
    })

    beforeEach(() => {
      const entries = [
        makeEntry({ id: 'e1', title: 'apple diary', content: 'nothing special', createdAt: 1000 }),
        makeEntry({ id: 'e2', title: 'random', content: 'apple in content', createdAt: 2000 }),
        makeEntry({ id: 'e3', title: 'no match', content: 'completely different', createdAt: 3000 }),
        makeEntry({ id: 'e4', title: 'apple theme', content: 'apple appears here too', createdAt: 4000 }),
      ]
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(entries)
    })

    it('returns empty array for a blank query', async () => {
      const store = useTextJournalStore()
      const result = await store.searchEntries({ query: '  ' })
      expect(result).toHaveLength(0)
    })

    it('scores title matches higher than content matches', async () => {
      const store = useTextJournalStore()
      const result = await store.searchEntries({ query: 'apple', limit: 10 })

      // e4 has title+content (4+2=6), e1 has title only (4), e2 has content only (2)
      expect(result[0].id).toBe('e4')
      expect(result[1].id).toBe('e1')
      expect(result[2].id).toBe('e2')
    })

    it('excludes entries with no match', async () => {
      const store = useTextJournalStore()
      const result = await store.searchEntries({ query: 'apple', limit: 10 })
      expect(result.map(e => e.id)).not.toContain('e3')
    })

    it('respects the limit (capped at 10)', async () => {
      const manyEntries = Array.from({ length: 15 }, (_, i) =>
        makeEntry({ id: `e${i}`, title: `apple ${i}`, createdAt: i }))
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(manyEntries)

      const store = useTextJournalStore()
      const result = await store.searchEntries({ query: 'apple', limit: 20 })
      expect(result.length).toBeLessThanOrEqual(10)
    })

    it('returns at least 1 result even when limit is 0', async () => {
      const store = useTextJournalStore()
      const result = await store.searchEntries({ query: 'apple', limit: 0 })
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('scopes search to the given characterId', async () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'apple', characterId: 'card-1' }),
        makeEntry({ id: 'alt-1', characterId: 'card-2', title: 'apple alt' }),
      ]
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(entries)

      const store = useTextJournalStore()
      const result = await store.searchEntries({ query: 'apple', characterId: 'card-2' })
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('alt-1')
    })

    // ROOT CAUSE:
    // In the desktop chat window, entityLedgerStore starts with activeLedger = empty.
    // loadLedger(characterId) was only called when navigating to MindMapExplorer.vue.
    // Consequently, chat-level searches passed an empty ledger with 0 entities to layeredMemory.
    //
    // BEFORE: searchEntries only checked entityLedgerStore.currentLoadedCharacterId, never loading it.
    // FIXED BY: Eagerly awaiting entityLedgerStore.loadLedger(targetCharacterId) when targetCharacterId !== currentLoadedCharacterId.
    it('eagerly loads entity ledger for targetCharacterId when not already loaded', async () => {
      const { useEntityLedgerStore } = await import('./entity-ledger')
      const ledgerStore = useEntityLedgerStore()
      const loadSpy = vi.spyOn(ledgerStore, 'loadLedger').mockResolvedValue(undefined)

      const store = useTextJournalStore()
      await store.searchEntries({ query: 'Theodore', characterId: 'card-theodore-target' })

      expect(loadSpy).toHaveBeenCalledWith('card-theodore-target')
    })

    it('wraps load errors with a text_journal prefix', async () => {
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IDB error'))

      const store = useTextJournalStore()
      await expect(store.searchEntries({ query: 'anything' })).rejects.toThrow(
        'text_journal: failed to load entries before searching: IDB error',
      )
    })
  })

  // ————————————————— entries sort order —————————————————————————————————————————————

  describe('sortedEntries', () => {
    it('exposes entries sorted newest-first by createdAt', async () => {
      const entries: TextJournalEntry[] = [
        {
          id: 'a',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Old',
          content: '',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'b',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'New',
          content: '',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 9000,
          updatedAt: 9000,
        },
      ]
      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(entries)

      const store = useTextJournalStore()
      await store.load()

      expect(store.entries[0].id).toBe('b')
      expect(store.entries[1].id).toBe('a')
    })
  })

  // ————————————————— rebuildVectorIndex ———————————————————————————————————————————

  describe('rebuildVectorIndex', () => {
    it('crawls sessions, chunks dialogue, indexes batches, and persists snapshot', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      const persistSpy = vi.spyOn(layeredMemory, 'persist').mockResolvedValue(undefined)

      vi.spyOn(chatSessionsRepo, 'getIndex').mockResolvedValue({
        userId: 'local',
        characters: {
          'card-1': {
            sessions: {
              's-1': {
                sessionId: 's-1',
                characterId: 'card-1',
                createdAt: 1000,
                updatedAt: 2000,
                universeId: 'default',
              },
            },
            activeSessionId: 's-1',
          },
        },
      } as any)

      vi.spyOn(chatSessionsRepo, 'getSession').mockResolvedValue({
        id: 's-1',
        title: 'Session 1',
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: 'Hello Finch and Theodore!',
            createdAt: 1500,
          },
          {
            id: 'm-2',
            role: 'assistant',
            content: 'Hello! I remember Finch the little mouse and Theodore clearly.',
            createdAt: 1600,
          },
        ],
      } as any)

      vi.spyOn(shortTermMemoryRepo, 'getAll').mockResolvedValue([
        {
          id: 'stmm-1',
          characterId: 'card-1',
          summary: 'Met with Finch and Theodore.',
          date: '2026-10-17',
          universeId: 'default',
        } as any,
      ])

      const store = useTextJournalStore()
      expect(store.isRebuildingVectorIndex).toBe(false)

      await store.rebuildVectorIndex({ characterId: 'card-1', universeId: 'default' })

      expect(store.isRebuildingVectorIndex).toBe(false)
      expect(store.vectorIndexProgress?.phase).toBe('completed')
      expect(store.vectorIndexProgress?.percent).toBe(100)
      expect(store.lastVectorIndexRebuiltAt).toBeGreaterThan(0)
      expect(indexDocsSpy).toHaveBeenCalled()
      expect(persistSpy).toHaveBeenCalledWith(true)

      const indexedBatches = indexDocsSpy.mock.calls
      const allIndexed = indexedBatches.flatMap(call => call[0])
      expect(allIndexed.some((d: any) => d.kind === 'raw_turn' && d.fact.includes('Finch the little mouse'))).toBe(true)
      expect(allIndexed.some((d: any) => d.kind === 'stmm_block' && d.fact.includes('Met with Finch'))).toBe(true)
    })

    it('chunks mega-turns (>1,500 chars) into multiple indexed documents with Part tags', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      vi.spyOn(layeredMemory, 'persist').mockResolvedValue(undefined)

      // Construct a 3500-char dialogue turn
      const repeatedText = 'Finch the mouse and Theodore the cat discussed the grand secret of the old clock tower. '
      const longMessageText = repeatedText.repeat(40) // ~3500 chars

      vi.spyOn(chatSessionsRepo, 'getIndex').mockResolvedValue({
        userId: 'local',
        characters: {
          'card-1': {
            sessions: {
              's-1': { sessionId: 's-1', characterId: 'card-1', universeId: 'default' },
            },
            activeSessionId: 's-1',
          },
        },
      } as any)

      vi.spyOn(chatSessionsRepo, 'getSession').mockResolvedValue({
        id: 's-1',
        title: 'Session 1',
        messages: [
          {
            id: 'm-long',
            role: 'assistant',
            content: longMessageText,
            createdAt: 2000,
          },
        ],
      } as any)

      const store = useTextJournalStore()
      await store.rebuildVectorIndex({ characterId: 'card-1', universeId: 'default' })

      const indexedBatches = indexDocsSpy.mock.calls
      const allIndexed = indexedBatches.flatMap(call => call[0])
      const chunkedDocs = allIndexed.filter((d: any) => d.id.startsWith('m-long:c'))

      expect(chunkedDocs.length).toBeGreaterThan(1)
      expect(chunkedDocs[0].title).toMatch(/\[Part 1\/\d+\]/)
      expect(chunkedDocs[1].title).toMatch(/\[Part 2\/\d+\]/)
      expect(chunkedDocs[0].id).toBe('m-long:c0')
      expect(chunkedDocs[1].id).toBe('m-long:c1')
    })

    it('hydrates unhydrated journal entries from repo before indexing', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      vi.spyOn(layeredMemory, 'persist').mockResolvedValue(undefined)

      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'journal-cold-1',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Cold Hydration Test',
          content: 'This was loaded from repo during rebuildVectorIndex',
          source: 'tool',
          createdAt: 5000,
          updatedAt: 5000,
          universeId: 'default',
        },
      ])

      const store = useTextJournalStore()
      await store.rebuildVectorIndex({ characterId: 'card-1', universeId: 'default' })

      const indexedBatches = indexDocsSpy.mock.calls
      const allIndexed = indexedBatches.flatMap(call => call[0])
      expect(allIndexed.some((d: any) => d.id === 'journal-cold-1' && d.fact.includes('loaded from repo'))).toBe(true)
    })

    it('can be cancelled via cancelRebuildVectorIndex', async () => {
      vi.spyOn(layeredMemory, 'indexDocuments').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      vi.spyOn(layeredMemory, 'persist').mockResolvedValue(undefined)

      vi.spyOn(chatSessionsRepo, 'getIndex').mockResolvedValue({
        userId: 'local',
        characters: {
          'card-1': {
            sessions: {
              's-1': { sessionId: 's-1', characterId: 'card-1', universeId: 'default' },
            },
          },
        },
      } as any)

      vi.spyOn(chatSessionsRepo, 'getSession').mockResolvedValue({
        id: 's-1',
        messages: Array.from({ length: 30 }, (_, i) => ({
          id: `m-${i}`,
          role: 'user',
          content: `Message ${i} long enough to be indexed with extra text padding`,
        })),
      } as any)

      const store = useTextJournalStore()
      const rebuildPromise = store.rebuildVectorIndex({ characterId: 'card-1', universeId: 'default', batchSize: 2 })

      store.cancelRebuildVectorIndex()
      await rebuildPromise

      expect(store.isRebuildingVectorIndex).toBe(false)
      expect(store.vectorIndexProgress?.phase).toBe('cancelled')
    })
  })

  // ————————————————— backgroundIndexAll watermark gating ——————————————————————————

  describe('backgroundIndexAll watermark gating', () => {
    it('skips indexing entirely when watermark > 0 and no documents are newer than watermark', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      vi.spyOn(layeredMemory, 'init').mockResolvedValue({ stale: false, lastIndexedTurnAt: 5000 })
      layeredMemory.lastIndexState = { stale: false, lastIndexedTurnAt: 5000 }

      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'j-old',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Old Entry',
          content: 'Old content',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 3000,
          updatedAt: 3000,
        },
      ])

      const store = useTextJournalStore()
      await store.load(true)
      // NOTICE: load() fires an unawaited backgroundIndexAll — flush it out
      // and clear the spy so assertions below cover only the explicit call.
      // Without this the suite races the fire-and-forget cycle and flakes.
      await new Promise(resolve => setTimeout(resolve, 50))
      indexDocsSpy.mockClear()
      await store.backgroundIndexAll()

      expect(indexDocsSpy).not.toHaveBeenCalled()
    })

    it('indexes only delta documents when watermark > 0 and newer documents exist', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      vi.spyOn(layeredMemory, 'init').mockResolvedValue({ stale: false, lastIndexedTurnAt: 5000 })
      layeredMemory.lastIndexState = { stale: false, lastIndexedTurnAt: 5000 }

      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'j-old',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Old Entry',
          content: 'Old content',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 3000,
          updatedAt: 3000,
        },
        {
          id: 'j-new',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'New Entry',
          content: 'New content',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 8000,
          updatedAt: 8000,
        },
      ])

      const store = useTextJournalStore()
      await store.load(true)
      // NOTICE: load() fires an unawaited backgroundIndexAll — flush it out
      // and clear the spy so assertions below cover only the explicit call.
      // Without this the suite races the fire-and-forget cycle and flakes.
      await new Promise(resolve => setTimeout(resolve, 50))
      indexDocsSpy.mockClear()
      await store.backgroundIndexAll()

      expect(indexDocsSpy).toHaveBeenCalledTimes(1)
      const indexedDocs = indexDocsSpy.mock.calls[0][0]
      expect(indexedDocs.length).toBe(1)
      expect(indexedDocs[0].id).toBe('j-new')
    })

    it('indexes all documents when watermark is 0 or absent', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      vi.spyOn(layeredMemory, 'init').mockResolvedValue({ stale: false, lastIndexedTurnAt: 0 })
      layeredMemory.lastIndexState = { stale: false, lastIndexedTurnAt: 0 }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(LAST_INDEXED_TURN_KEY)
      }

      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'j-1',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Entry 1',
          content: 'Content 1',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 3000,
          updatedAt: 3000,
        },
      ])

      const store = useTextJournalStore()
      await store.load(true)
      // NOTICE: load() fires an unawaited backgroundIndexAll — flush it out
      // and clear the spy so assertions below cover only the explicit call.
      // Without this the suite races the fire-and-forget cycle and flakes.
      await new Promise(resolve => setTimeout(resolve, 50))
      indexDocsSpy.mockClear()
      await store.backgroundIndexAll()

      expect(indexDocsSpy).toHaveBeenCalledTimes(1)
      const indexedDocs = indexDocsSpy.mock.calls[0][0]
      expect(indexedDocs.length).toBe(1)
      expect(indexedDocs[0].id).toBe('j-1')
    })

    it('indexes all documents when index is marked stale even if watermark > 0', async () => {
      const indexDocsSpy = vi.spyOn(layeredMemory, 'indexDocuments').mockResolvedValue(undefined)
      vi.spyOn(layeredMemory, 'init').mockResolvedValue({ stale: true, reason: 'migration', lastIndexedTurnAt: 5000 })
      layeredMemory.lastIndexState = { stale: true, reason: 'migration', lastIndexedTurnAt: 5000 }

      ;(textJournalRepo.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'j-1',
          userId: 'local',
          characterId: 'card-1',
          characterName: 'TestChar',
          title: 'Entry 1',
          content: 'Content 1',
          source: 'tool',
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          last_review: 0,
          createdAt: 3000,
          updatedAt: 3000,
        },
      ])

      const store = useTextJournalStore()
      await store.load(true)
      // NOTICE: load() fires an unawaited backgroundIndexAll — flush it out
      // and clear the spy so assertions below cover only the explicit call.
      // Without this the suite races the fire-and-forget cycle and flakes.
      await new Promise(resolve => setTimeout(resolve, 50))
      indexDocsSpy.mockClear()
      await store.backgroundIndexAll()

      expect(indexDocsSpy).toHaveBeenCalledTimes(1)
      const indexedDocs = indexDocsSpy.mock.calls[0][0]
      expect(indexedDocs.length).toBe(1)
      expect(indexedDocs[0].id).toBe('j-1')
    })
  })
})
