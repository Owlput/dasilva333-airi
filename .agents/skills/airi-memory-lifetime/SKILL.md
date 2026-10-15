---
name: airi-memory-lifetime
description: >-
  Build/debug Lifetime Artifacts/Eternal Thread: source aggregation, chunk summaries, distillation, retries, incremental maintenance, auto-rollup rebase, prompt grounding budgets, and consumption watermarks.
---

# Memory Pillar 5 — Lifetime Artifacts (Eternal Thread)

The synthesized, distilled long-horizon identity/relationship blueprint per character+universe — what keeps relationship identity coherent across fresh sessions. Universe-scoped: a lifetime artifact is the product of ALL memories in that universe, encompassing every timeline/session sharing the same `universeId`.

## 1. Store, Repos & Type Definitions

| Attribute | Value |
| :--- | :--- |
| **Store** | `packages/stage-ui/src/stores/memory-lifetime.ts` (`useMemoryLifetimeStore`, `artifactsByUniverse` Map, `getArtifact(characterId, universeId)`) |
| **Artifact Repo** | `packages/stage-ui/src/database/repos/lifetime-memory.repo.ts` → `local:memory/lifetime/{characterId}:{universeId}` (one-way migration from bare `{characterId}`) |
| **Session Repo** | `packages/stage-ui/src/database/repos/provisioning-session.repo.ts` → `local:memory/provisioning-session/{characterId}:{universeId}` (migrates bare key, strips proxies) |
| **Artifact Model** | `LifetimeMemoryArtifact` (`types/lifetime-memory.ts`), containing `finalPack`, `distillPass1Pack`, `baseArchive`, `chunkSummaries`, and `updateHistory` |
| **Pack Interfaces** | `DistilledPack` (6 sections: `relationship_core`, `user_patterns`, `shared_rituals`, `stable_topics`, `meaningful_old_moments`, `inside_jokes_or_motifs`, plus `compression_notes`) |
| **Data Catalog** | `docs/data-catalog.md` §1.8 (Artifacts) & §1.9 (Provisioning Sessions) |

## 2. Complete File & Subsystem Map

The lifetime memory architecture touches storage, background cadences, UI, and prompt assembly:

```
packages/stage-ui/src/
├── stores/
│   ├── memory-lifetime.ts                   # Core store: provision, incremental merges, auto-rollup rebase
│   └── chat/
│       ├── session-store.ts                 # buildLifetimeMemoryContext(), ${id}:${version} prompt watcher
│       ├── grounding-assembler.ts           # [LIFETIME RELATIONSHIP ARTIFACT], 13k char exemption
│       ├── grounding-assembler.test.ts      # Unit tests for lifetime truncation exemption
│       ├── prompt-contracts.test.ts         # Contract verification for memory context builders
│       └── prompt-hierarchy-invariants.test.ts # Ordering invariants (Lifetime ahead of volatile sensors)
├── database/repos/
│   ├── lifetime-memory.repo.ts              # IndexedDB persistence for completed artifacts
│   └── provisioning-session.repo.ts         # Checkpoint store for interrupted/resumable builds
├── types/
│   └── lifetime-memory.ts                   # Valibot schemas & TypeScript interfaces
└── components/scenarios/dialogs/
    └── lifetime-memory/
        └── LifetimeProvisioningModal.vue    # Interactive wizard: stages, progress, live distillation view

apps/stage-tamagotchi/src/renderer/
└── App.vue                                  # ensureYesterdayShortTermBlockForActiveCharacter() cadence

packages/stage-layouts/src/components/Layouts/
└── ChatOptions/
    └── ChatOptionsInjectionsView.vue        # Chat options drawer: per-universe artifact toggle & status

packages/stage-pages/src/pages/settings/
├── memory/index.vue                         # Memory home overview: lifetime depth token counting
└── modules/components/
    ├── LifetimeMemoryView.vue               # Main settings view: sync triggers, manual refresh, error banner
    └── LifetimeHistoryModal.vue             # Inspection modal: chunk summaries & audit diffs

docs/
├── data-catalog.md                          # Canonical storage key & schema registry (§1.8, §1.9)
└── memory_lab/
    ├── lifetime-artifact-generation-plan.md # Architectural foundation: chunking, distillation, thresholds
    ├── state-of-system.md                   # Lab validation: base artifact + accumulated diffs
    └── memory-engine-integration-plan.md    # Original 3-phase lifecycle milestones
```

## 3. Subsystem Lifecycle & Operational Status

| Phase | Mechanism & Function | Status |
| :--- | :--- | :--- |
| **1. Full Initialization** | 5-stage synthesis from full history (`provision()`) | **Implemented** |
| **2. Incremental Daily Update** | STMM-cadence merge of 24h window into `finalPack` (`applyIncrementalUpdate()`) | **Implemented** |
| **3. Auto-Rollup / Rebase** | Generational consolidation when diffs accumulate (`MAX_MERGES_BEFORE_REBASE`) | **Implemented (v2)** |
| **4. Manual Rebuild** | Re-distill from cached chunks (`reprovisionFromChunks()`) or clean reset (`restart()`) | **Implemented** |

Current reality: artifacts created before incremental maintenance lack `lastConsumedDay`/`finalPack`; the first `applyIncrementalUpdate` run forward-seals `lastConsumedDay` to yesterday and returns without destructive overwrites.

---

## 4. Initialization Pipeline (5 Stages)

`provision(characterId, universeId='global', resume=false, intervalSeconds=0, contextLimitTokens=64, targetTokens=1000)`:

1. **`collectSourceDocs()`**: Gathers universe-scoped evidence:
   - Chat sessions filtered by `universeId`. Longest session is designated the *Canonical Timeline*; others are branched and deduped as *Alternative Paths*.
   - STMM daily blocks (`shortTermMemoryRepo`).
   - LTMM journal entries (`textJournalRepo`).
2. **Chunked Extraction**: Groups source documents into chunks under `contextLimitTokens` (~64k tokens default), running `callJsonMode()` with `ChunkArchiveJsonSchema` to extract durable facts.
3. **Base Archive Synthesis**: Synthesizes all chunk archives into a unified `LifetimeArchive` via `buildBaseArchivePrompt()` and `LifetimeArchiveJsonSchema`, guarded by `withRetry(3, 2000ms)`.
4. **Two-Pass Distillation**:
   - `distill_pass_1`: Formats base content into 6 structured sections with bullet count scaling (`ratio = targetTokens / 1000`).
   - `distill_pass_2`: Caveman refinement removing pleasantries, duplicates, and conversational filler to land on `targetTokens`.
5. **Persistence & Broadcast**:
   - Sets forward watermarks: `metadata.initialConsumedDay` and `metadata.lastConsumedDay`.
   - Stores `finalPack` (the incremental merge target) and `distillPass1Pack`.
   - Clears the provisioning session from `provisioningSessionRepo`.
   - Broadcasts `airi:lifetime-memory-sync` across windows.

---

## 5. Incremental Maintenance (STMM Cadence)

Daily incremental maintenance runs as fire-and-forget background work:
- **Trigger**: `apps/stage-tamagotchi/src/renderer/App.vue` -> `ensureYesterdayShortTermBlockForActiveCharacter()` invokes `applyIncrementalUpdate(targetCardId, universeId)` after STMM generation completes on app boot and active card switch.
- **Card-Switch Resolution**: Awaits `chatSessionStore.ensureActiveSessionForCharacter()` prior to dispatch so `targetCardId` and active session `universeId` are locked before triggering.
- **Inputs (`collectWindowedDocs`)**:
  - Existing artifact `finalPack` (or normalized `distillPass1Pack`).
  - Yesterday's raw conversation turns since `metadata.lastConsumedDay` across all timelines sharing the universe.
  - New LTMM journal entries added since the watermark.
- **Autoregressive Schema Ordering (`IncrementalMergeSchema`)**:
  - `change_notes` and `changed` properties are defined **first** in the JSON schema. This ensures the autoregressive model determines whether durable relationship change occurred *before* emitting the six pack sections.
- **Inference Contraction Guard**:
  - If the candidate pack drastically contracts in total bullets compared to `currentPack` (e.g. dropping more than 35% of established history without cause), the merge pass throws a contraction guard error and retries up to 3 times with exponential backoff.
- **Programmatic True-Diff Verification**:
  - `arePacksContentEqual(currentPack, candidatePack)` compares normalized pack bullets. `artifact.version` is bumped and `mergesSinceRebase` is incremented **only if** the content actually changed; routine days advance `lastConsumedDay` without incrementing `version`.
- **Catchup Limit**: `MAX_CATCHUP_DAYS_PER_RUN = 14`. Unprocessed older days roll to subsequent boot runs.

---

## 6. Auto-Rollup & Rebase (v2 Architecture)

To prevent compounding generational distortion across hundreds of daily incremental merges:
1. **Merge Counter**: Every `changed=true` merge increments `metadata.mergesSinceRebase`.
2. **Auto-Rollup Threshold**: When `mergesSinceRebase >= MAX_MERGES_BEFORE_REBASE` (default 30) and cached `chunkSummaries` exist, `applyIncrementalUpdate` automatically triggers `reprovisionFromChunks(characterId, universeId, 0, targetTokens)`.
3. **Preserving Evolution**: `reprovisionFromChunks` incorporates `priorIncrementalPack = artifact.finalPack` into the distillation prompt so newly accumulated rituals, jokes, and preferences are not discarded when re-running canonical synthesis.
4. **Reset**: Re-synthesis resets `mergesSinceRebase = 0` and sets `lastUpdateType = 'reprovision'`.

---

## 7. Prompt Grounding & Prefix Caching

Lifetime artifacts are injected into active LLM turns with strict prefix caching and budget protections:

- **Context Injection**: `session-store.ts` -> `buildLifetimeMemoryContext(characterId, universeId)` injects the distilled artifact under `[LIFETIME RELATIONSHIP ARTIFACT]`.
- **Prefix Cache Friendly Watcher**: `session-store.ts` watches `${artifact.id}:${artifact.version}` instead of `updatedAt`. Routine zero-change days (`changed: false`) that merely advance the day watermark do **not** dirty system prompt tokens or invalidate LLM KV prefix caches!
- **Grounding Budget Exemption**: In `grounding-assembler.ts`, `budgetGroundingMessages()` enforces a standard `maxPerBlockChars = 2500` cap to prevent runaway memory usage, but **explicitly exempts** blocks starting with `[LIFETIME RELATIONSHIP ARTIFACT]`, allowing up to `MAX_LIFETIME_BLOCK_CHARS = 13000` (within a total 14,000 char budget). This ensures detailed 1,000–3,000 token distilled packs never lose their trailing sections (*Meaningful Old Moments*, *Inside Jokes*).
- **Positioning**: In `chat.ts`, stable memory blocks (STMM, Lifetime Artifact) sit ahead of volatile per-turn system telemetry (`[ENVIRONMENTAL AWARENESS]` sensors), ensuring maximal KV prefix cache reuse.

---

## 8. UI Surfaces & Modals

- **`LifetimeProvisioningModal.vue`**:
  - Gated by `initiatedInModal` flag so automatic enabling (`airiCardStore.toggleLifetimeMemory`) only triggers for explicit user-driven modal runs, not background headless updates.
  - Automatically resets `progress.value.phase = 'idle'` when closed or completed.
- **`LifetimeMemoryView.vue`**:
  - Resolves `activeUniverseId` via active session metadata.
  - Queries `lifetimeStore.getArtifact(charId, universeId)` directly.
  - Displays error banners for both provisioning `lifetimeStore.error` and background `lifetimeStore.incrementalError`.
- **`ChatOptionsInjectionsView.vue`**:
  - Chat options drawer view. Watches `[activeCardId, activeUniverseId]` to synchronize the injection toggle and status badge with the current universe.

---

## 9. Verification & Invariants

- **Unit & Contract Tests**:
  - `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/memory-lifetime.test.ts` (verifies 5-stage provisioning synthesis).
  - `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/memory-lifetime.incremental.test.ts` (verifies incremental merges, true-diff checks, contraction guards, and auto-rollup).
  - `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/database/repos/provisioning-session.repo.test.ts` (verifies universe scoping & migration).
  - `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/chat/grounding-assembler.test.ts` (verifies 13k char exemption).
  - `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/chat/prompt-contracts.test.ts` (verifies context formatting).
  - `pnpm -F @proj-airi/stage-ui test packages/stage-ui/src/stores/chat/prompt-hierarchy-invariants.test.ts` (verifies cache-friendly ordering).
- **Typecheck**:
  - `pnpm -F @proj-airi/stage-tamagotchi typecheck`
  - `pnpm -F @proj-airi/stage-ui typecheck`
- **Pitfalls**:
  - Always read and write using `{characterId}:{universeId}`; never write bare `{characterId}` keys.
  - Never allow `applyIncrementalUpdate` to throw or block desktop boot in `App.vue`.
