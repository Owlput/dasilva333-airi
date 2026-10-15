# Architecture & Design: Jev-Powered Eternal Thread (System 1 + Pillar 5)

> **Status**: Design Proposal & Architecture Specification
> **Canonical RFCs / Roadmaps**: [`docs/proposal-jev-integration.md`](./proposal-jev-integration.md) (Domain G: Winnow Compaction, Domain K: Entropy Referee), [`docs/design-jev-integrations.md`](./design-jev-integrations.md)
> **Primary Stores**: [`packages/stage-ui/src/stores/memory-lifetime.ts`](../packages/stage-ui/src/stores/memory-lifetime.ts), [`packages/stage-ui/src/stores/modules/system-one.ts`](../packages/stage-ui/src/stores/modules/system-one.ts)
> **Related Domain Skills**: [`.agents/skills/airi-memory-lifetime/SKILL.md`](../.agents/skills/airi-memory-lifetime/SKILL.md), [`.agents/skills/airi-jev-decision-engine/SKILL.md`](../.agents/skills/airi-jev-decision-engine/SKILL.md)
> **Data Catalog**: [`docs/data-catalog.md`](./data-catalog.md) §1.8 (Lifetime Artifacts), §1.9 (Provisioning Sessions)

---

## 1. Executive Summary & The Core Thesis

In Project AIRI's memory architecture, **Pillar 5 (Lifetime Artifacts / Eternal Thread)** synthesizes and maintains long-horizon relationship identity across sessions.

An architectural audit of [`memory-lifetime.ts`](../packages/stage-ui/src/stores/memory-lifetime.ts) reveals that **roughly 80% of the subsystem's defensive complexity exists because we are asking an autoregressive System-2 text generator to perform System-1 classification, gating, and pruning tasks**:

1. We ask System 2 to decide whether anything changed (`changed: boolean`).
2. We ask System 2 to regenerate 45 established bullets just to append 1 new observation.
3. We ask System 2 to judge which older bullets to drop or consolidate when a section bloats.
4. We slice transcripts with arbitrary character caps because feeding full daily logs into System 2 is expensive and dilutes model attention.

By integrating **TypeSafe Jev (`typesafe/jev-1.13`)**—and its offline local counterpart `laya-local`—via [`useSystemOneStore`](../packages/stage-ui/src/stores/modules/system-one.ts), AIRI gains a non-autoregressive, bidirectional ModernBERT classification coprocessor running over a **32k context window with calibrated `noul`, `choice`, and `score` heads, ~120ms roundtrip latency, \$0 output tokens, and \$42 per billion input tokens**.

At \$42 per billion tokens, a comprehensive 10,000-token daily evaluation costs **\$0.00042 (four hundredths of a cent)**. Rather than discarding Pillar 5's hardened architecture, System 1 serves as the **curatorial gatekeeper, turn compactor, and bullet-level surgical auditor** whenever `systemOneStore.configured === true`, falling back to the existing baseline whenever `systemOneStore.configured === false`.

---

## 2. Diagnosis: The Failure Modes of System-2 Lifetime Maintenance

Recent engineering iterations in `memory-lifetime.ts` introduced substantial defensive armor to protect against fundamental failure modes inherent to autoregressive generation:

* **Why we built the Zero-Change Contract (`changed: false`) & True-Diff Verification:**
  Autoregressive LLMs have a strong generative prior against doing nothing. When handed yesterday's chat transcript and asked *"Did anything durable change?"*, next-token prediction strongly biases them toward inventing minor tweaks or restating existing facts to justify producing output tokens.
* **Why we built the Contraction Guard (`< 70%` bullets) & Auto-Rollup Rebase:**
  Every time System 2 re-emits the entire 6-section pack to incorporate a single observation, it must re-generate 40–50 existing bullets token-by-token. This causes "telephone game" semantic drift, phrasing degradation, and the occasional silent drop of old memories.
* **Why we built `buildDayTranscriptWithBudget` (24k char head/tail slicing):**
  70% of a busy day's conversation is routine operational banter or fleeting dialogue. Passing an uncompacted 60,000-character raw transcript to System 2 exhausts token budgets, dilutes attention over trivial exchanges, and increases latency.

---

## 3. The 3 Core System-1 Operations in `useSystemOneStore`

System 1 provides three discrete non-autoregressive operations mapped directly to `memory-lifetime.ts` execution points:

| Operation | Hook Point in `memory-lifetime.ts` | Jev Primitives (`choice` / `score` / `noul`) | Architectural Advantage Over System 2 Alone |
| :--- | :--- | :--- | :--- |
| **`runLifetimeDayGate(characterName, currentPack, day, transcript)`** | Inside `applyIncrementalUpdate()` **before** invoking `callJsonMode` | **6 parallel contrastive `choice` heads** (one per `DistilledPack` section) using calibrated distractor attractor basins:<ul><li>`durable_new_addition`</li><li>`updates_existing_bullet`</li><li>`already_captured_in_pack`</li><li>`transient_routine_banter`</li><li>`no_relevant_evidence`</li></ul> | **80%+ of days are routine.** Instead of paying a System-2 LLM to read the day and re-emit 1,000 JSON tokens just to declare `changed: false`, Jev evaluates all 6 sections in **~120ms for \$0.0002**. If all 6 land in distractor basins, `lastConsumedDay` advances immediately with **zero System-2 calls and 0% risk of accidental rewrite**. |
| **`runTurnSalienceCompaction(docs)`** (`Winnow` / Domain G) | Inside `buildDayTranscriptWithBudget()` (when raw turns exceed budget) or before `provision()` chunking | Batches raw turns into 4-turn windows and scores each window:<ul><li>`salience_class` (`choice`): `durable_fact_or_preference`, `relational_or_emotional_moment`, `sticky_joke_or_ritual`, `routine_chitchat_or_filler`</li><li>`retention_score` (`score` 0.0–1.0)</li></ul> | Replaces blind `40% head / 60% tail` character slicing. Drops `routine_chitchat_or_filler` ($< 0.40$) so a 50k-character day compresses into ~12k characters of pure signal—never losing middle-of-the-day events. |
| **`runPackBulletAudit(sectionName, bullets, dayTranscript)`** | Inside `applyIncrementalUpdate()` **only for sections flagged as `updates_existing_bullet`** | Evaluates each existing bullet $b_i$ in the affected section:<ul><li>`status` (`choice`): `keep_unchanged`, `superseded_by_new_day`, `duplicate_of_another_bullet`</li></ul> | **Eliminates generational "telephone game" drift.** Untouched sections are **frozen in TypeScript**—even if System 2 hallucinates changes to an untouched section, TypeScript only merges the sections Jev unlocked. |

---

## 4. Concrete Schema Blueprint for `system-one.ts`

Declared in [`packages/stage-ui/src/stores/modules/system-one.ts`](../packages/stage-ui/src/stores/modules/system-one.ts), the following schema uses the **Distractor Attractor** pattern proven in Shootout V3/V4 benchmarks (where explicit distractor candidate options eliminate false positives):

```typescript
// File: packages/stage-ui/src/stores/modules/system-one.ts

export const JEV_LIFETIME_SECTION_CRITERIA = {
  durable_new_addition: 'The day contains a brand-new, lasting relationship fact, milestone, recurring preference, or sticky inside joke that belongs in this section and is NOT yet in the current pack.',
  updates_existing_bullet: 'The day explicitly changes, reverses, or materially evolves an existing bullet already listed in this section.',
  already_captured_in_pack: 'The day reinforces habits, topics, or dynamics already represented in the current pack (no edit needed).',
  transient_routine_banter: 'Ordinary daily conversation, temporary mood, one-off situational chat, or fleeting small talk that does not redefine the long-term relationship.',
  no_relevant_evidence: 'Nothing in the day transcript relates to this section.',
} as const

export const JEV_LIFETIME_DAY_GATE_SCHEMA = {
  relationship_core: {
    type: 'choice',
    instructions: 'Evaluate whether the new day requires modifying relationship_core (fundamental bond, power dynamic, role framing).',
    criteria: JEV_LIFETIME_SECTION_CRITERIA,
  },
  user_patterns: {
    type: 'choice',
    instructions: 'Evaluate whether the new day requires modifying user_patterns (recurring user behaviors, communication habits, mannerisms).',
    criteria: JEV_LIFETIME_SECTION_CRITERIA,
  },
  shared_rituals: {
    type: 'choice',
    instructions: 'Evaluate whether the new day requires modifying shared_rituals (repeated routines, shared comfort habits, recurring activities).',
    criteria: JEV_LIFETIME_SECTION_CRITERIA,
  },
  stable_topics: {
    type: 'choice',
    instructions: 'Evaluate whether the new day requires modifying stable_topics (long-term recurring subjects or ongoing projects).',
    criteria: JEV_LIFETIME_SECTION_CRITERIA,
  },
  meaningful_old_moments: {
    type: 'choice',
    instructions: 'Evaluate whether the new day contains a major emotional milestone or unforgettable shared event worth preserving for months.',
    criteria: JEV_LIFETIME_SECTION_CRITERIA,
  },
  inside_jokes_or_motifs: {
    type: 'choice',
    instructions: 'Evaluate whether the new day coined or cemented a sticky recurring inside joke, nickname, or motif.',
    criteria: JEV_LIFETIME_SECTION_CRITERIA,
  },
} as const
```

---

## 5. Surgical Section Locking in `applyIncrementalUpdate()`

Inside [`packages/stage-ui/src/stores/memory-lifetime.ts`](../packages/stage-ui/src/stores/memory-lifetime.ts), the handoff between System 1 (Jev) and System 2 (LLM) follows a dual-branch structure:

```
                                  applyIncrementalUpdate(characterId, universeId)
                                                        |
                                       Is systemOneStore.configured?
                                        /                       \
                                      YES                        NO
                                      /                            \
                        systemOneStore.execute(...)             Fallback Baseline
                        (JEV_LIFETIME_DAY_GATE_SCHEMA)         (System-2 callJsonMode
                                      |                         re-emitting full pack)
                      Are any sections triggered?
                     (durable_new or updates_existing)
                               /              \
                             NO               YES
                             /                  \
                     FAST-EXIT (~120ms)      SURGICAL SYSTEM-2 INVOCATION
                     - lastConsumedDay = day - Pass Jev triggered section lock in prompt
                     - changed: false        - System 2 re-emits candidate
                     - notes: ['System-1...']- TypeScript overrides un-triggered sections!
```

### Case A: Zero Sections Triggered (Fast-Exit in ~120ms)
If none of the 6 sections returned `'durable_new_addition'` or `'updates_existing_bullet'` with calibrated confidence $\ge 0.60$:
1. **Skip `callJsonMode` completely.**
2. Record `{ day, changed: false, updatedAt: Date.now(), notes: ['System-1 gate: routine day (no durable section changes)'] }`.
3. Advance `artifact.metadata.lastConsumedDay = day`.
4. Persist and continue to the next day in the catchup queue.
5. **Cost**: \$0.0002, latency ~120ms, zero System-2 load, zero chance of hallucinated edits.

### Case B: 1 or More Sections Triggered (Surgical Section Lock)
Suppose Jev flags only `inside_jokes_or_motifs: 'durable_new_addition'`, while the other 5 sections classify into `'already_captured_in_pack'` or `'transient_routine_banter'`:
1. Invoke System 2 (`callJsonMode`), injecting Jev's locked section scope into system directives:
   `"SYSTEM-1 AUDIT LOCK: Only modify [inside_jokes_or_motifs]. Keep all other sections identical."`
2. **Programmatic Section Freezing in TypeScript**:
   Upon receiving System 2's response, TypeScript enforces section immutability by construction:
   ```typescript
   const candidatePack: DistilledPack = {
     relationship_core: triggered.has('relationship_core') ? normalized.relationship_core : currentPack.relationship_core,
     user_patterns: triggered.has('user_patterns') ? normalized.user_patterns : currentPack.user_patterns,
     shared_rituals: triggered.has('shared_rituals') ? normalized.shared_rituals : currentPack.shared_rituals,
     stable_topics: triggered.has('stable_topics') ? normalized.stable_topics : currentPack.stable_topics,
     meaningful_old_moments: triggered.has('meaningful_old_moments') ? normalized.meaningful_old_moments : currentPack.meaningful_old_moments,
     inside_jokes_or_motifs: triggered.has('inside_jokes_or_motifs') ? normalized.inside_jokes_or_motifs : currentPack.inside_jokes_or_motifs,
     compression_notes: currentPack.compression_notes,
   }
   ```
3. **Immutability Guarantee**: Even if System 2 attempts to rephrase `relationship_core` or drops an old bullet in `meaningful_old_moments` while adding an inside joke, **TypeScript ignores System 2's output on every section Jev did not unlock.**

---

## 6. Winnow Turn Compaction (Domain G)

When an active day contains extensive conversation, `memory-lifetime.ts` currently truncates raw transcripts at `MAX_SOURCE_CHARS_PER_DAY = 24000` using a fixed 40% head / 60% tail heuristic, discarding conversations in the middle of the day.

Following **Domain G (`fast-jev-compaction` / `Winnow`)** of [`docs/proposal-jev-integration.md`](./proposal-jev-integration.md):

* Turn exchanges (2–4 turns per window) are scored by Jev using a paired `choice` and `score` evaluation:
  - `category`: `['durable_personal_fact', 'relational_milestone', 'sticky_joke_or_ritual', 'emotional_anchor', 'routine_chitchat_or_filler']`
  - `retention_score`: scalar from `0.0` to `1.0`.
* Exchanges categorized as `routine_chitchat_or_filler` (or with `retention_score < 0.40`) are pruned prior to transcript composition.
* A 60,000-character chat day compacts down to ~12,000 characters of dense, high-signal narrative exchanges without temporal blindspots.

---

## 7. Smart Entropy & Stability Rebase Referee (Domain K)

Rather than relying strictly on a fixed counter (`MAX_MERGES_BEFORE_REBASE = 15`), Jev operates as an **Entropy & Redundancy Referee** over the `DistilledPack`:

* When `countPackBullets(currentPack)` exceeds the target density for `targetTokens`, Jev evaluates bullet pairs within bloated sections for **Semantic Redundancy & Recency Salience (`score` 0.0–1.0)**.
* Only candidate pairs with high redundancy scores are dispatched to a micro-consolidation pass, pruning overlap while keeping foundational memories intact.

---

## 8. Architectural Matrix: Fallback vs. System-1 Enhanced

The integration preserves complete backward compatibility. If `systemOneStore.configured` is false, `memory-lifetime.ts` continues running its hardened baseline pipeline without interruption:

| Lifecycle Step | Fallback Baseline (`!systemOneStore.configured`) | System-1 Enhanced (`systemOneStore.configured` — Jev / Laya) |
| :--- | :--- | :--- |
| **1. Transcript Preparation** | `buildDayTranscriptWithBudget` (40% head / 60% tail slice + full LTMM) | **Jev Winnow Compaction**: Filters `routine_chitchat_or_filler`; preserves 100% of high-salience turns across the full timeline |
| **2. Zero-Change Evaluation** | System-2 `callJsonMode` re-emitting all 6 sections + True-Diff check | **Jev 6-Head Contrastive Gate (~120ms)**: Fast-exits on routine days; isolates specific triggered sections |
| **3. Pack Modification** | System 2 re-emits entire pack; guarded by `< 70%` Contraction Guard | **Jev Bullet Audit + Surgical Section Lock**: Unchanged sections are frozen in TypeScript; System 2 writes only unlocked sections |
| **4. Rollup / Rebase** | Fixed counter trigger (`mergesSinceRebase >= 15`) runs `reprovisionFromChunks` | **Jev Entropy Referee**: Continuously prunes duplicate or superseded bullets when density limits are reached |
| **5. Token Economics** | 1,000–3,000 output tokens per active day evaluation | \$0 output tokens on routine days; ~100 output tokens on changed days |

---

## 9. Open Decisions & Implementation Roadmap

The following decisions guide the planned implementation:

### 1. Schema Placement & Composition
* **Decision**: Declare `JEV_LIFETIME_SECTION_CRITERIA` and `JEV_LIFETIME_DAY_GATE_SCHEMA` in [`packages/stage-ui/src/stores/modules/system-one.ts`](../packages/stage-ui/src/stores/modules/system-one.ts) and export them.
* **Rationale**: Centralizing schemas in `system-one.ts` enables testing them directly in the System 1 settings playground ([`packages/stage-pages/src/pages/settings/modules/system-one.vue`](../packages/stage-pages/src/pages/settings/modules/system-one.vue)) while keeping `memory-lifetime.ts` clean.

### 2. Calibrated Decision Thresholds
* **Decision**: Require $P(\text{durable\_new\_addition} \lor \text{updates\_existing\_bullet}) \ge 0.60$ for a section to be considered triggered.
* **Rationale**: The contrastive distractor basins (`already_captured_in_pack`, `transient_routine_banter`) absorb ambiguous chatter. Setting a 0.60 confidence floor ensures only high-conviction events trigger System-2 generation.

### 3. Local Laya WebGPU / WASM Transcripts
* **Decision**: For local `laya-local` execution, run turn compaction on 4-turn windows sequentially or in micro-batches to respect WebGPU buffer limits on low-memory devices.

### 4. Update History Audit Trail
* **Decision**: Include triggered section identifiers in `LifetimeUpdateRecord.notes`.
* **Format**: `{ day, changed: true, notes: ['System-1: unlocked [inside_jokes_or_motifs], 5 sections frozen'] }`.

---

## 10. References & Canonical Documents

- **RFC & Roadmap**: [`docs/proposal-jev-integration.md`](./proposal-jev-integration.md) — Comprehensive specification of TypeSafe Jev, Distractor Attractor architecture, Domain G (Turn Compaction), and Domain K (Entropy Referee).
- **Shipped Jev Subsystems**: [`docs/design-jev-integrations.md`](./design-jev-integrations.md) — Production inventory of Jev triage, reranking, affect classification, and arcade copilots.
- **Lifetime Memory Subsystem Skill**: [`.agents/skills/airi-memory-lifetime/SKILL.md`](../.agents/skills/airi-memory-lifetime/SKILL.md) — Primary operational guide for Pillar 5.
- **Jev Decision Engine Skill**: [`.agents/skills/airi-jev-decision-engine/SKILL.md`](../.agents/skills/airi-jev-decision-engine/SKILL.md) — Operational guide for Jev decision contracts, `noul` probability rules, and playground diagnostics.
- **Original Research & Specs**:
  - [`docs/memory_lab/lifetime-artifact-generation-plan.md`](./memory_lab/lifetime-artifact-generation-plan.md)
  - [`docs/memory_lab/state-of-system.md`](./memory_lab/state-of-system.md)
  - [`docs/memory_lab/memory-engine-integration-plan.md`](./memory_lab/memory-engine-integration-plan.md)
- **Data Persistence Schema**: [`docs/data-catalog.md`](./data-catalog.md) §1.8 & §1.9.
