import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock searchWorker
vi.mock('../workers/search', () => ({
  searchWorker: {
    init: vi.fn(async () => ({ stale: false })),
    persist: vi.fn(async () => ({ documents: [] })),
    index: vi.fn(async () => ({ count: 0 })),
    remove: vi.fn(async () => undefined),
    search: vi.fn(async () => ({ vectorHits: [], keywordHits: [], documents: [] })),
  },
}))

const { searchWorker } = await import('../workers/search')
const { LAST_INDEXED_TURN_KEY, layeredMemory } = await import('./layered-memory')

describe('layeredMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('persist', () => {
    it('throttles rapid sequential persist calls within 30s', async () => {
      await layeredMemory.persist(true) // reset clock with a force persist
      const initialCallCount = (searchWorker.persist as ReturnType<typeof vi.fn>).mock.calls.length

      // Second call without force within 30s should be throttled
      await layeredMemory.persist(false)
      expect(searchWorker.persist).toHaveBeenCalledTimes(initialCallCount)
    })

    it('bypasses 30s throttle when force is true', async () => {
      await layeredMemory.persist(true)
      const initialCallCount = (searchWorker.persist as ReturnType<typeof vi.fn>).mock.calls.length

      // Second call with force=true should execute
      await layeredMemory.persist(true)
      expect(searchWorker.persist).toHaveBeenCalledTimes(initialCallCount + 1)
    })
  })

  describe('indexDocuments', () => {
    it('serializes concurrent index batches in order without dropping any', async () => {
      const order: number[] = []

      ;(searchWorker.index as ReturnType<typeof vi.fn>).mockImplementation(async (docs: any[]) => {
        const id = docs[0]?.id
        order.push(id)
        await new Promise(resolve => setTimeout(resolve, 20))
      })

      // Fire two batches concurrently
      const p1 = layeredMemory.indexDocuments([{ id: 1 }])
      const p2 = layeredMemory.indexDocuments([{ id: 2 }])

      await Promise.all([p1, p2])

      expect(searchWorker.index).toHaveBeenCalledTimes(2)
      expect(order).toEqual([1, 2])
    })

    it('returns immediately without calling searchWorker.index or persist when documents is empty or null', async () => {
      await layeredMemory.indexDocuments([])
      await layeredMemory.indexDocuments(null as any)
      await layeredMemory.indexDocuments(undefined as any)

      expect(searchWorker.index).not.toHaveBeenCalled()
      expect(searchWorker.persist).not.toHaveBeenCalled()
    })
  })

  describe('lastIndexedTurnAt watermark', () => {
    const store: Record<string, string> = {}
    const setItem = vi.fn((key: string, value: string) => {
      store[key] = value
    })

    beforeEach(() => {
      for (const key of Object.keys(store))
        delete store[key]
      setItem.mockClear()
      vi.stubGlobal('localStorage', { setItem })
    })

    it('exposes the worker watermark on init and mirrors it for sync delta checks', async () => {
      ;(searchWorker.init as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stale: false, lastIndexedTurnAt: 777 })

      const state = await layeredMemory.init()

      expect(state.lastIndexedTurnAt).toBe(777)
      expect(layeredMemory.lastIndexState?.lastIndexedTurnAt).toBe(777)
      expect(setItem).toHaveBeenCalledWith(LAST_INDEXED_TURN_KEY, '777')
    })

    it('leaves the watermark absent for legacy worker replies without mirroring', async () => {
      ;(searchWorker.init as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stale: false })

      const state = await layeredMemory.init()

      expect(state.lastIndexedTurnAt).toBeUndefined()
      expect(setItem).not.toHaveBeenCalled()
    })

    it('mirrors the persisted snapshot header watermark on persist', async () => {
      ;(searchWorker.persist as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ header: { lastIndexedTurnAt: 888 }, documents: [] })

      await layeredMemory.persist(true)

      expect(setItem).toHaveBeenCalledWith(LAST_INDEXED_TURN_KEY, '888')
    })

    it('survives environments without localStorage', async () => {
      vi.unstubAllGlobals()
      ;(searchWorker.init as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stale: false, lastIndexedTurnAt: 555 })

      const state = await layeredMemory.init()

      expect(state.lastIndexedTurnAt).toBe(555)
    })
  })
})
