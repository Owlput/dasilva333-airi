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
const { layeredMemory } = await import('./layered-memory')

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
  })
})
