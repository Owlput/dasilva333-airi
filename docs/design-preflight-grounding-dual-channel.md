# Design: Pre-Flight Grounding Dual-Channel Architecture & WYSIWYG Dispatch

## Status
- **Author**: AIRI Engineering & User Pair Programming
- **Date**: 2026-10-17
- **Supersedes / Extends**: [docs/proposal-dynamic-memory-rag-injection.md](proposal-dynamic-memory-rag-injection.md)
- **Status**: Proposal / Ready for Implementation

---

## 1. Executive Summary & Core Contract

The pre-flight grounding panel sits directly above the chat composer, surfacing relevant context retrieved as the user types.

### The WYSIWYG Zero-Deviation Contract
> **What You See Is What You Send (WYSIWYG)**:
> There must be **0% deviation** between what is displayed in the pre-flight grounding preview and what is actually packaged into the system prompt for LLM inference.
>
> If the user sees a story excerpt on screen in the pre-flight drawer, that exact excerpt text **MUST** be present in the model's message array. The system must never silently discard, mutate, or downgrade previewed text during message dispatch.

---

## 2. Root Cause of Past Regressions

In previous iterations, the pre-flight preview and the prompt dispatch ran as two disconnected pipelines:

1. **The UI Layer (`InteractiveArea.vue`)**:
   As the user typed, it debounced `textJournalStore.searchEntries()` and directly rendered `entry.title` and `entry.content` into card components. If an entity mention matched a dialogue turn, the card showed the full narrative text (e.g. Ren's spores and the Imperial Academy towers).
2. **The Prompt Assembly Layer (`chat.ts` + `grounding-assembler.ts`)**:
   When the user clicked Send, `chat.ts` ran a separate, second search. If an item was tagged with `isKgClaim: true`, `grounding-assembler.ts` formatted it as a synthetic triple:
   ```text
   • Academy ➔ mentioned in ➔ C6rlV2MvRWuQJJnXHiDFq's turn
   ```
   **It completely discarded `entry.content`**, wiping out the entire narrative excerpt.
3. **The Architectural Flaw**:
   Trying to force two fundamentally distinct data models into one monolithic schema:
   - A **500-word dialogue excerpt** is *narrative text*.
   - A **knowledge graph claim** is a *relational triple* (`subject ➔ predicate ➔ object`).

Forcing an episodic dialogue turn to pretend to be a Knowledge Graph triple broke both the preview contract and model grounding.

---

## 3. The Dual-Channel Architecture

Instead of merging incompatible data structures, this design establishes two distinct, parallel channels that are respected end-to-end:

```
                      Composer Input (Debounced)
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
       [Track 1: searchEntries()]      [Track 2: KG Associations]
        Battle-tested vector/BM25       Entity Ledger S-P-O facts
        journals, turns, recaps         & relational associations
                  │                               │
                  │                               │
                  ▼                               ▼
       ┌──────────────────────┐        ┌──────────────────────┐
       │  COLUMN 1: MEMORIES  │        │   COLUMN 2: KG BIZ   │
       ├──────────────────────┤        ├──────────────────────┤
       │ [RAW] Turn Excerpt   │        │ • Finch ➔ is ➔ Banker│
       │ "...shadow wolf..."  │        │ • Academy ➔ located  │
       │                      │        │   in ➔ City          │
       └──────────┬───────────┘        └──────────┬───────────┘
                  │                               │
                  └───────────────┬───────────────┘
                                  │ On Send (Staged: Zero Duplicate Search!)
                                  ▼
               ┌──────────────────────────────────────┐
               │ [GROUNDED LONG-TERM MEMORIES]        │
               │                                      │
               │ [CONFIRMED KNOWLEDGE GRAPH FACTS]    │
               │ • Finch ➔ is ➔ Banker                │
               │ • Academy ➔ located in ➔ City        │
               │                                      │
               │ [EPISODIC & JOURNAL MEMORIES]        │
               │ [RAW] C6rl...:                       │
               │ "...shadow wolf dissolving..."       │
               └──────────────────────────────────────┘
```

### Track 1: Episodic & Journal Retrieval (`searchEntries()`)
- **Preserves existing `searchEntries()` without modification**: Keeps the reliable vector + BM25 retrieval over:
  - Long-Term Memory (LTMM) text journals
  - Short-Term Memory (STMM) daily recaps
  - Raw dialogue turn chunks
- **Schema**: Standard `TextJournalEntry` with guaranteed `.content`.
- **UI Column (Left)**: Renders narrative cards showing the kind badge (`[RAW]`, `[JOURNAL]`, `[RECAP]`), the title, and the narrative snippet.
- **Prompt Injection**: Injected under `[EPISODIC & JOURNAL MEMORIES]` with 100% of the narrative excerpt intact.

### Track 2: Knowledge Graph Associations (KG Biz)
- **Dedicated Entity Ledger Traversal**: Queries the active character's Entity Ledger for deterministic relational facts (`subject ➔ predicate ➔ object`).
- **Schema**: Pure `KnowledgeGraphFact`:
  ```ts
  interface KnowledgeGraphFact {
    id: string
    subject: string
    predicate: string
    object: string
    dateLabel?: string
    confidence?: number
  }
  ```
- **UI Column (Right)**: Renders structured relation chips / triple badges.
- **Prompt Injection**: Injected under `[CONFIRMED KNOWLEDGE GRAPH FACTS]` as concise relation bullets (`• Subject ➔ Predicate ➔ Object`).

---

## 4. The Composable: `usePreFlightGrounding`

A dedicated composable encapsulates the debounced query, concurrent dual-track search, staging, and prompt assembly:

```ts
export function usePreFlightGrounding(options: {
  messageInput: Ref<string>
  activeCardId: Ref<string | undefined>
  debounceMs?: number
}) {
  const memories = ref<TextJournalEntry[]>([])
  const kgFacts = ref<KnowledgeGraphFact[]>([])
  const isSearching = ref(false)

  // 1. Debounced query runner
  // Queries Track 1 (searchEntries) and Track 2 (Entity Ledger) concurrently.

  // 2. Staged prompt compiler
  // Pre-assembles the exact GroundingMessage payload using the exact staged items.
  const stagedGroundingPayload = computed<GroundingMessage | null>(() => {
    // Formats [CONFIRMED KNOWLEDGE GRAPH FACTS] from kgFacts.value
    // Formats [EPISODIC & JOURNAL MEMORIES] from memories.value
  })

  // 3. Clear / Reset
  function clear() {
    memories.value = []
    kgFacts.value = []
  }

  return {
    memories,
    kgFacts,
    isSearching,
    stagedGroundingPayload,
    clear,
  }
}
```

---

## 5. UI Layout Specifications

The pre-flight grounding drawer above the composer adopts a clean dual-column presentation:

1. **Header Bar**:
   - Status badge: `Pre-Flight Grounding Active`
   - Memory count toggle: `Memories (N)`
   - Graph facts count toggle: `Knowledge Graph (M)`
   - Telemetry / Visual Scene toggles (when active)
2. **Dual-Column Body (When Expanded)**:
   - **Left Column**: Grounded Memories (`searchEntries` results).
     - Clean card for each journal or dialogue excerpt.
     - Title, kind badge, and 2-line clamped narrative text.
     - Click to open full text preview modal.
   - **Right Column**: Knowledge Graph Associations.
     - Structured triple rows: `[Subject] ➔ [Predicate] ➔ [Object]`.
     - Confidence indicator and date label (if available).
3. **Adaptive Grid**:
   - If only memories match: Memory column expands to 100% width.
   - If only KG facts match: Graph column expands to 100% width.
   - On narrow/mobile screens: Stacks vertically or offers tabbed switching.

---

## 6. Zero Duplicate Execution

### Current Flawed Flow:
1. User types `query` → `InteractiveArea` runs `searchEntries(query)`.
2. User clicks Send → `chat.ts` runs `searchEntries(query)` a second time.
3. Wasteful WebGPU/WASM forward passes, 500ms–2s dispatch lag, and risk of result divergence.

### New Optimized Flow:
1. User types `query` → `usePreFlightGrounding` runs Track 1 & Track 2 and holds `stagedGroundingPayload`.
2. User clicks Send → `handleSend()` passes `stagedGroundingPayload` directly into `ingest()`.
3. `ingest()` attaches the pre-compiled payload immediately without re-querying.
4. **Benefits**:
   - Instant send response (no search delay on enter).
   - Zero redundant embedding inferences.
   - Complete 1:1 fidelity guaranteed by construction.

---

## 7. Migration & Implementation Plan

1. **Phase 1: Composable Creation**:
   - Implement `usePreFlightGrounding` in `packages/stage-ui/src/composables/use-preflight-grounding.ts`.
   - Add unit test coverage verifying dual-track separation and prompt compilation parity.
2. **Phase 2: UI Integration**:
   - Update `InteractiveArea.vue` (and `ChatArea.vue`) to use `usePreFlightGrounding`.
   - Implement the dual-column layout for Memories and Knowledge Graph.
3. **Phase 3: Ingest Pipeline Handoff**:
   - Allow `ingest(text, options)` to accept `stagedGroundingPayload`.
   - Skip redundant retrieval in `chat.ts` when a valid staged payload is provided.
4. **Phase 4: Validation**:
   - Verify with the "Theodore / Finch / white mouse" query that the excerpt text displayed in the left column appears word-for-word in the LLM dispatch payload.
