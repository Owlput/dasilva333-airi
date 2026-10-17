import type { SearchCandidate, SearchDocumentMeta } from '../hybrid-scorer'

import { describe, expect, it, vi } from 'vitest'

import { EntityLedger } from '../entity-ledger'
import {
  defaultScorerConfig,
  detectQueryProfile,
  scoreHybridResults,
} from '../hybrid-scorer'
import { layeredMemory } from '../layered-memory'

vi.mock('../../workers/search', () => ({
  searchWorker: {
    init: vi.fn(async () => {}),
    search: vi.fn(async () => ({
      documents: [
        {
          id: 'doc-paris',
          content: 'We had a lovely walk near the Eiffel Tower in Paris on 2024-05-10.',
          kind: 'journal_entry',
          timestamp: '2024-05-10T12:00:00.000Z',
          source: 'user',
        },
      ],
      vectorHits: [{ id: 'doc-paris', score: 0.88 }],
      keywordHits: [{ id: 'doc-paris', score: 0.92 }],
    })),
    index: vi.fn(async () => 1),
    persist: vi.fn(async () => ({})),
    remove: vi.fn(async () => {}),
  },
}))

describe('semantic Search & Memory Refinements', () => {
  describe('query Profile Detection', () => {
    it('detects quote queries', () => {
      expect(detectQueryProfile('what did they say about "hello"?')).toBe('quote')
      expect(detectQueryProfile('verbatim transcript of yesterday')).toBe('quote')
      expect(detectQueryProfile('exact quote: I love coffee')).toBe('quote')
    })

    it('detects question queries', () => {
      expect(detectQueryProfile('who is the actor?')).toBe('question')
      expect(detectQueryProfile('how to run a test')).toBe('question')
      expect(detectQueryProfile('where did we go yesterday?')).toBe('question')
    })

    it('detects longform queries', () => {
      expect(
        detectQueryProfile(
          'this is a very long query that has more than fourteen words to trigger the longform profile detection logic',
        ),
      ).toBe('longform')
    })

    it('detects default queries', () => {
      expect(detectQueryProfile('simple search')).toBe('default')
    })
  })

  describe('rRF & MMR Scoring', () => {
    const mockDocs: SearchDocumentMeta[] = [
      {
        id: 'doc1',
        content: 'I love drinking green tea in the morning.',
        kind: 'raw',
        timestamp: new Date().toISOString(),
        source: 'user',
        embedding: [0.1, 0.2, 0.3],
      },
      {
        id: 'doc2',
        content: 'Green tea is full of healthy antioxidants.',
        kind: 'stmm',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        source: 'assistant',
        embedding: [0.1, 0.2, 0.31], // very similar to doc1
      },
      {
        id: 'doc3',
        content: 'Antigravity is a powerful AI coding assistant.',
        kind: 'ltmm',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        source: 'system',
        embedding: [0.9, 0.8, 0.7],
      },
    ]

    const vectorCandidates: SearchCandidate[] = [
      { id: 'doc1', score: 0.85 },
      { id: 'doc2', score: 0.84 },
      { id: 'doc3', score: 0.40 },
    ]

    const keywordCandidates: SearchCandidate[] = [
      { id: 'doc2', score: 1.0 },
      { id: 'doc1', score: 0.5 },
    ]

    it('applies reciprocal rank fusion (RRF) and ranks doc2 first due to higher keyword rank', () => {
      const results = scoreHybridResults(
        'green tea',
        mockDocs,
        vectorCandidates,
        keywordCandidates,
        {
          ...defaultScorerConfig,
          mmrLambda: 1.0, // disable MMR to verify pure RRF first
        },
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe('doc2')
      expect(results[1].id).toBe('doc1')
    })

    it('diversifies results using MMR', () => {
      const results = scoreHybridResults(
        'green tea AI',
        mockDocs,
        vectorCandidates,
        keywordCandidates,
        {
          ...defaultScorerConfig,
          mmrLambda: 0.2, // Strong diversity penalty
        },
      )

      const ids = results.map(r => r.id)
      expect(ids.indexOf('doc2')).toBe(0) // Highest initial relevance is chosen first
      expect(ids.indexOf('doc3')).toBeLessThan(ids.indexOf('doc1')) // doc3 is selected before the duplicate doc1
    })

    it('boosts documents matching extracted temporal hooks even if older', () => {
      const pastDoc: SearchDocumentMeta = {
        id: 'past1',
        content: 'Trip to Tokyo on 2024-04-15 was unforgettable.',
        kind: 'ltmm',
        timestamp: '2024-04-15T10:00:00.000Z',
        source: 'user',
        embedding: [0.5, 0.5, 0.5],
      }
      const recentDoc: SearchDocumentMeta = {
        id: 'recent1',
        content: 'Went to the park today and had tea.',
        kind: 'raw',
        timestamp: new Date().toISOString(),
        source: 'user',
        embedding: [0.5, 0.5, 0.5],
      }

      const docs = [pastDoc, recentDoc]
      const vCandidates = [
        { id: 'recent1', score: 0.7 },
        { id: 'past1', score: 0.65 },
      ]
      const kCandidates = [
        { id: 'recent1', score: 0.6 },
        { id: 'past1', score: 0.6 },
      ]

      // Without temporal hook, recentDoc wins due to recency decay
      const normalResults = scoreHybridResults('tokyo trip', docs, vCandidates, kCandidates)
      expect(normalResults[0].id).toBe('recent1')

      // With temporal hook matching 2024-04-15, pastDoc receives dateMatchBoost and wins
      const temporalResults = scoreHybridResults(
        'tokyo trip 2024-04-15',
        docs,
        vCandidates,
        kCandidates,
        defaultScorerConfig,
        [{ text: '2024-04-15', isoDateHint: '2024-04-15', year: 2024, monthIndex: 3, day: 15 }],
      )

      expect(temporalResults[0].id).toBe('past1')
      expect(temporalResults[0].dateMatchBoost).toBeGreaterThan(0)
    })
  })

  describe('layeredMemory.search with DualSearcherPass3 & Knowledge Graph', () => {
    it('executes baseline search with heuristic triage and in-memory entity graph traversal', async () => {
      const ledger = new EntityLedger()
      ledger.getOrCreateEntity('Paris', 'place')
      ledger.addClaim({
        subject: 'Paris',
        predicate: 'has attraction',
        object: 'Eiffel Tower',
        evidence: ['Visited Eiffel Tower in Paris.'],
        dateInfo: { formatted_label: 'May 10, 2024', iso_date: '2024-05-10' },
      })

      const results = await layeredMemory.search('Tell me about Paris trip', 5, 'card-1', {
        ledger,
      })

      expect(layeredMemory.lastSearchMode).toBe('baseline')
      expect(layeredMemory.lastTriage).toBeDefined()
      expect(layeredMemory.lastTriage?.category).toBe(4) // C4 literal default

      // Should contain Knowledge Graph hit as top priority
      const kgClaim = results.find(r => r.isKgClaim)
      expect(kgClaim).toBeDefined()
      expect(kgClaim?.subject).toBe('Paris')
      expect(kgClaim?.predicate).toBe('has attraction')
      expect(kgClaim?.object).toBe('Eiffel Tower')

      // Should also contain worker hybrid hit
      const workerDoc = results.find(r => r.id === 'doc-paris')
      expect(workerDoc).toBeDefined()
    })

    it('engages Pass 11 System 1 triage and cross-encoder reranker when systemOneStore is configured', async () => {
      const ledger = new EntityLedger()
      ledger.getOrCreateEntity('Alice', 'person')
      ledger.addClaim({
        subject: 'Alice',
        predicate: 'works at',
        object: 'Cyberdyne',
        evidence: ['Alice joined Cyberdyne.'],
      })

      const mockSystemOneStore = {
        configured: true,
        runTriage: vi.fn(async () => ({
          category: 1,
          choice: 'c1_multihop',
          confidence: 0.95,
          probabilities: { c1_multihop: 0.95 },
          temporalSubtype: 'none',
          searchScope: 'multi_session',
          method: 'system1_zero_shot',
          latencyMs: 42,
        })),
        runRerank: vi.fn(async (q: string, pool: any[]) => ({
          rankedCandidates: pool.map((c, idx) => ({
            id: c.id,
            finalScore: idx === 0 ? 0.99 : 0.80,
            normJevScore: 1.0,
          })),
          latencyMs: 55,
        })),
      }

      const results = await layeredMemory.search('Alice connections across all sessions', 5, 'card-1', {
        ledger,
        systemOneStore: mockSystemOneStore,
      })

      expect(mockSystemOneStore.runTriage).toHaveBeenCalled()
      expect(mockSystemOneStore.runRerank).toHaveBeenCalled()
      expect(layeredMemory.lastSearchMode).toBe('pass11')
      expect(layeredMemory.lastTriage?.choice).toBe('c1_multihop')
      expect(results.length).toBeGreaterThan(0)
    })

    it('surfaces direct dialogue source mentions from Knowledge Graph when entity has no S-P-O claims', async () => {
      const ledger = new EntityLedger()
      ledger.addSource({
        turnId: 'turn-theodore-1',
        text: 'Theodore, a small mouse assistant, clutches a ledger nearby while counting crystals.',
        speaker: 'Assistant',
        timestamp: 1720000000000,
        session: 'session-ch116',
      })
      const ent = ledger.getOrCreateEntity('Theodore', 'person')
      ledger.addMention({ span: 'Theodore', turnId: 'turn-theodore-1', entityId: ent.entityId })

      // Theodore has NO S-P-O claims in ledger.claims
      expect(ledger.claims.size).toBe(0)

      const results = await layeredMemory.search('Theodore', 5, 'card-1', {
        ledger,
      })

      // Must find the mention hit from the Knowledge Graph
      const mentionHit = results.find(r => r.id === 'kg-mention:turn-theodore-1')
      expect(mentionHit).toBeDefined()
      expect(mentionHit?.subject).toBe('Theodore')
      expect(mentionHit?.content).toContain('Theodore, a small mouse assistant')
      expect(mentionHit?.source).toBe('chat:session-ch116')
      expect(mentionHit?.score).toBe(0.70)
      expect(mentionHit?.isKgClaim).toBe(true)
    })

    it('guarantees Knowledge Graph mention quota even when worker hits saturate returnLimit', async () => {
      const { searchWorker } = await import('../../workers/search')
      // Simulate searchWorker returning 10 vector candidates that saturate the limit
      vi.mocked(searchWorker.search).mockResolvedValueOnce({
        documents: Array.from({ length: 10 }, (_, i) => ({
          id: `doc-filler-${i}`,
          characterId: 'card-1',
          title: `Filler Chat ${i}`,
          content: `Some random memory turn ${i}`,
          kind: 'raw' as any,
          timestamp: new Date().toISOString(),
          source: 'user',
        })),
        vectorHits: Array.from({ length: 10 }, (_, i) => ({
          id: `doc-filler-${i}`,
          score: 0.95 - (i * 0.01),
        })),
        keywordHits: [],
      })

      const ledger = new EntityLedger()
      ledger.addSource({
        turnId: 'turn-theodore-saturate',
        text: 'Theodore, a small mouse assistant, clutches a ledger nearby.',
        speaker: 'Assistant',
        timestamp: 1720000000000,
        session: 'session-ch116',
      })
      const ent = ledger.getOrCreateEntity('Theodore', 'person')
      ledger.addMention({ span: 'Theodore', turnId: 'turn-theodore-saturate', entityId: ent.entityId })

      const results = await layeredMemory.search('Theodore', 5, 'card-1', {
        ledger,
      })

      // Must NOT be starved out by the 10 filler worker hits!
      const mentionHit = results.find(r => r.id === 'kg-mention:turn-theodore-saturate')
      expect(mentionHit).toBeDefined()
      expect(mentionHit?.subject).toBe('Theodore')
      expect(results.length).toBeLessThanOrEqual(5)
    })

    // ROOT CAUSE:
    // When WebGPU or WASM neural embedder crashes (e.g. GatherBlockQuantized operator failure 12198344),
    // searchWorker.search throws. Previously, this uncaught rejection aborted layeredMemory.search,
    // causing textJournalStore to drop into local LTMM fallback and discarding all offline Knowledge Graph hits.
    //
    // BEFORE: Uncaught error in searchWorker.search rejected layeredMemory.search, discarding kgHits.
    // FIXED BY: try/catch around searchWorker retrieval in layered-memory.ts, preserving in-memory KG hits.
    it('preserves Knowledge Graph hits when searchWorker candidate retrieval throws', async () => {
      const { searchWorker } = await import('../../workers/search')
      vi.mocked(searchWorker.search).mockRejectedValueOnce(
        new Error('ONNX Runtime WASM exception pointer: 12198344 (unsupported ONNX operator)'),
      )

      const ledger = new EntityLedger()
      ledger.addSource({
        turnId: 'turn-theodore-fallback-1',
        text: 'Theodore, a small mouse assistant, clutches a ledger nearby.',
        speaker: 'Assistant',
        timestamp: 1720000000000,
        session: 'session-ch116',
      })
      const ent = ledger.getOrCreateEntity('Theodore', 'person')
      ledger.addMention({ span: 'Theodore', turnId: 'turn-theodore-fallback-1', entityId: ent.entityId })

      const results = await layeredMemory.search('Theodore', 5, 'card-1', {
        ledger,
      })

      expect(results.length).toBeGreaterThan(0)
      const mentionHit = results.find(r => r.id === 'kg-mention:turn-theodore-fallback-1')
      expect(mentionHit).toBeDefined()
      expect(mentionHit?.subject).toBe('Theodore')
      expect(mentionHit?.content).toContain('Theodore, a small mouse assistant')
      expect(mentionHit?.source).toBe('chat:session-ch116')
    })

    it('prevents substring collision so "about" does not trigger "out" entity match', async () => {
      const ledger = new EntityLedger()
      const outEnt = ledger.getOrCreateEntity('out', 'concept')
      ledger.addSource({
        turnId: 'turn-out-1',
        text: 'The guard went out into the hall.',
        speaker: 'Narrator',
        timestamp: 1720000000000,
        session: 'session-out',
      })
      ledger.addMention({ span: 'out', turnId: 'turn-out-1', entityId: outEnt.entityId })

      const results = await layeredMemory.search('what about the crystal nest?', 5, 'card-1', {
        ledger,
      })

      // Must NOT match "out" because "about" contains substring "out" but not as a word boundary
      const outHit = results.find(r => r.subject?.toLowerCase() === 'out')
      expect(outHit).toBeUndefined()
    })

    it('disambiguates focal entity using System 1 and allocates fair-share mentions across distinct entities', async () => {
      const ledger = new EntityLedger()

      // 1. Larissa entity with multiple sources
      const larissaEnt = ledger.getOrCreateEntity('Larissa', 'person')
      for (let i = 0; i < 5; i++) {
        const turnId = `turn-larissa-${i}`
        ledger.addSource({
          turnId,
          text: `Larissa flips through her bestiary and complains about mud turn ${i}.`,
          speaker: 'Larissa',
          timestamp: 1720000000000 + i * 1000,
          session: 'session-camp',
        })
        ledger.addMention({ span: 'Larissa', turnId, entityId: larissaEnt.entityId })
      }

      // 2. Sirius Starweaver entity
      const siriusEnt = ledger.getOrCreateEntity('Sirius Starweaver', 'person')
      ledger.addSource({
        turnId: 'turn-sirius-1',
        text: 'Sirius Starweaver, Luna\'s father, stood near the door with an icy expression.',
        speaker: 'Narrator',
        timestamp: 1720000000000,
        session: 'session-ch166',
      })
      ledger.addMention({ span: 'Sirius Starweaver', turnId: 'turn-sirius-1', entityId: siriusEnt.entityId })

      // Mock System 1 store identifying Sirius Starweaver as the primary focal entity
      const mockSystemOneStore = {
        configured: true,
        runTriage: vi.fn(async () => ({
          category: 4,
          choice: 'c4_literal',
          confidence: 0.9,
          probabilities: {},
          temporalSubtype: 'none',
          searchScope: 'single_session',
          conjunctionStructure: 'single_atomic',
          conjunctionConfidence: 0.9,
          requiresDecomposition: 0,
        })),
        runRerank: vi.fn(async (_q: string, cands: any[]) => ({
          rankedCandidates: cands.map((c: any) => ({ ...c, finalScore: 0.9 })),
        })),
        identifyFocusEntity: vi.fn(async (_q: string, candidates: Array<{ id: string, label: string }>) => {
          // Identify Sirius Starweaver as focal entity
          const match = candidates.find(c => c.label.includes('Sirius'))
          return match?.id || null
        }),
      }

      const results = await layeredMemory.search(
        'great job Larissa! and what about Sirius? who is he related to?',
        6,
        'card-1',
        {
          ledger,
          systemOneStore: mockSystemOneStore,
        },
      )

      expect(mockSystemOneStore.identifyFocusEntity).toHaveBeenCalled()

      // Must contain BOTH Larissa and Sirius Starweaver without Larissa starving out Sirius!
      const siriusHit = results.find(r => r.subject?.includes('Sirius'))
      expect(siriusHit).toBeDefined()
      expect(siriusHit?.content).toContain('Luna\'s father')

      const larissaHit = results.find(r => r.subject?.toLowerCase() === 'larissa')
      expect(larissaHit).toBeDefined()
    })

    it('divides mention quota equally across distinct entities when System 1 is not configured or fails', async () => {
      const ledger = new EntityLedger()

      // Larissa with 6 sources
      const larissaEnt = ledger.getOrCreateEntity('Larissa', 'person')
      for (let i = 0; i < 6; i++) {
        const turnId = `turn-larissa-eq-${i}`
        ledger.addSource({
          turnId,
          text: `Larissa turn ${i}`,
          speaker: 'Larissa',
          timestamp: 1720000000000 + i * 1000,
          session: 'session-camp',
        })
        ledger.addMention({ span: 'Larissa', turnId, entityId: larissaEnt.entityId })
      }

      // Sirius with 2 sources
      const siriusEnt = ledger.getOrCreateEntity('Sirius', 'person')
      ledger.addSource({
        turnId: 'turn-sirius-eq-1',
        text: 'Sirius Starweaver arrived at the door.',
        speaker: 'Narrator',
        timestamp: 1720000000000,
        session: 'session-ch166',
      })
      ledger.addMention({ span: 'Sirius', turnId: 'turn-sirius-eq-1', entityId: siriusEnt.entityId })

      // System 1 not configured
      const results = await layeredMemory.search(
        'great job Larissa! and what about Sirius?',
        6,
        'card-1',
        {
          ledger,
        },
      )

      // Both distinct entities must be present
      const siriusHit = results.find(r => r.subject?.includes('Sirius'))
      expect(siriusHit).toBeDefined()
      const larissaHit = results.find(r => r.subject?.toLowerCase() === 'larissa')
      expect(larissaHit).toBeDefined()
    })

    it('filters out leading grammatical conjunctions and pronouns so "And Lynn" and "you" do not match query words', async () => {
      const ledger = new EntityLedger()

      // Larissa
      const larissaEnt = ledger.getOrCreateEntity('Larissa', 'person')
      ledger.addSource({
        turnId: 'turn-larissa-1',
        text: 'Larissa smiles and opens her bestiary.',
        speaker: 'Larissa',
        timestamp: 1720000000000,
        session: 'session-camp',
      })
      ledger.addMention({ span: 'Larissa', turnId: 'turn-larissa-1', entityId: larissaEnt.entityId })

      // Sirius Starweaver
      const siriusEnt = ledger.getOrCreateEntity('Sirius Starweaver', 'person')
      ledger.addSource({
        turnId: 'turn-sirius-1',
        text: 'Sirius Starweaver, Luna\'s father, stood near the door.',
        speaker: 'Narrator',
        timestamp: 1720000000000,
        session: 'session-ch166',
      })
      ledger.addMention({ span: 'Sirius', turnId: 'turn-sirius-1', entityId: siriusEnt.entityId })

      // Noise entities: "And Lynn" and "you"
      const andLynnEnt = ledger.getOrCreateEntity('And Lynn', 'person')
      ledger.addSource({
        turnId: 'turn-lynn-1',
        text: 'And Lynn waited in the hallway.',
        speaker: 'Narrator',
        timestamp: 1720000000000,
        session: 'session-hall',
      })
      ledger.addMention({ span: 'And Lynn', turnId: 'turn-lynn-1', entityId: andLynnEnt.entityId })

      const youEnt = ledger.getOrCreateEntity('you', 'person')
      ledger.addSource({
        turnId: 'turn-you-1',
        text: 'you are speaking.',
        speaker: 'User',
        timestamp: 1720000000000,
        session: 'session-user',
      })
      ledger.addMention({ span: 'you', turnId: 'turn-you-1', entityId: youEnt.entityId })

      const results = await layeredMemory.search(
        'lol. great job Larissa you nailed it! and what about Sirius? can anyone tell me who he is related to?',
        6,
        'card-1',
        { ledger },
      )

      // Verified: "And Lynn" and "you" are NOT present in KG hits
      const andLynnHit = results.find(r => r.subject === 'And Lynn')
      expect(andLynnHit).toBeUndefined()

      const youHit = results.find(r => r.subject === 'you')
      expect(youHit).toBeUndefined()

      // Verified: Larissa and Sirius Starweaver ARE present
      const siriusHit = results.find(r => r.subject === 'Sirius Starweaver')
      expect(siriusHit).toBeDefined()

      const larissaHit = results.find(r => r.subject === 'Larissa')
      expect(larissaHit).toBeDefined()
    })
  })
})
