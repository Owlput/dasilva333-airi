---
title: Fix Default Character (ReLU vs default Ghost ID)
description: Tracked project to eliminate the long-standing default-character regression and Universe Memory RAG toggle failure.
---

# Project: Fix Default Character (`default` vs `relu` Ghost ID)

> Status: `implemented` — phases 1–5 done in working tree, uncommitted, awaiting review.
> Created: 2026-10-19 — first tracked attempt after 4–5 untracked tries since fork.

## 0. Why track this now

This regression has existed since the fork (and likely still exists upstream). Multiple prior fix attempts were never tracked — no commits logged, no evolution history. This file is the canonical tracker going forward. Update `Attempt Log` on every try.

### Attempt Log

| # | Date | Commit / Branch | What was tried | Outcome |
|---|------|-----------------|----------------|---------|
| 1–4 | pre-2026-10-19 | untracked | ad-hoc `default` → `relu` patches, UI fallback edits | Untracked, regressed — ghost ID returned |
| 5 | 2026-10-19 | `main` dirty (6 files) | CCv3 `data.extensions` lockstep in `airi-card.ts`, `effectiveCardId` in `ChatOptionsInjectionsView.vue`, session-char sync in `chat.vue` | Partial — leaves `\|\| 'default'` intact, `effectiveCardId` can still resolve to `'default'` |
| 6 | 2026-10-19 | `main` dirty (12 files) | Phases 1–5: `resolveCardId` + healing, `default`→`relu` rename-preserving migration, RAG unification, UI fallback sweep, tamagotchi boot init | Implemented — `airi-card.test.ts` 18/18 pass; typechecks show only pre-existing `MessagingFriends.vue` + provider errors |

Current dirty tree (do not commit as-is):

```text
M apps/stage-tamagotchi/src/renderer/pages/chat.vue
M packages/stage-layouts/src/components/Layouts/ChatOptions/ChatOptionsInjectionsView.vue
M packages/stage-layouts/src/components/Layouts/ChatOptionsPopover.vue
M packages/stage-ui/src/stores/modules/airi-card.test.ts
M packages/stage-ui/src/stores/modules/airi-card.ts
M packages/stage-ui/src/stores/modules/live-session.ts
```

## 1. Invariants (must always hold)

1. There is always an active character — no `null` global active character ID.
2. On first-ever boot with zero config, something valid is marked active.
3. Starter characters are seeded and ReLU (`DEFAULT_STARTER_CARD_ID = 'relu'`) is the designated default.

## 2. Root-cause diagnosis

### 2.1 The Ghost ID: `'default'` vs `'relu'`

Commit `7178d242a` decoupled the starter from legacy ID `'default'` to `'relu'` and enforced `expect(store.getCard('default')).toBeUndefined()`. Several surfaces were never updated and still fall back to `'default'`:

- `apps/stage-tamagotchi/src/renderer/pages/chat.vue:100,118,128,1051` — `activeCardId.value || airiCardStore.activeCardId || 'default'` (and `:1051` `characterId: cardId || 'default'`)
- `packages/stage-layouts/src/components/Layouts/ChatOptionsPopover.vue:124` — `effectiveCharacterId.value || 'default'`
- `packages/stage-pages/src/pages/settings/components/SettingsQuickAccess.vue:240` — `activeCardId.value || 'default'`
- `packages/stage-layouts/src/components/Layouts/InteractiveArea.vue:65` — `characterId: cardId || 'default'`

Any of those paths navigates to `/settings/airi-card/edit?id=default`. `cardStore.getCard('default')` returns `undefined`, the form loads blank defaults, and Save calls `updateCard('default', …)` which returns `false`. The starter becomes uneditable.

Persisted-state drift compounds it: `localStorage['airi-card-active-id'] = 'default'`, `local:airi-cards['default']`, `sessionMetas[].characterId = 'default'`, plus `sync-engine.ts` restoring `localStorage` from IndexedDB backup.

### 2.2 Universe Memory (RAG) toggle stuck off & wiped on edit

Four compounding causes found in code audit:

1. **Targeting `'default'` instead of `'relu'`**: sessions created under old `'default'` yield `effectiveCardId = 'default'`; `toggleGroundingMemory('default')` hits `cards.get('default') -> undefined` and silently returns.
2. **Split schema + `CardEditorForm.vue` default mismatch**:
   - `CardEditorForm.vue:1365` (Cognition tab) initializes `universeRagGroundingEnabled` with `cognitionData?.searchEngine?.universeRagEnabled ?? true` (defaults to `true` even when RAG is off!) and never reads `groundingMemoryEnabled`.
   - `CardEditorForm.vue:1206-1252` (`saveCard`) writes `cognition.searchEngine.universeRagEnabled` and `groundingEnabled`, **but completely omits `groundingMemoryEnabled` from the saved object**!
   - Then `airi-card.ts:1372` (`resolveAiriExtension` inside `newAiriCard` / `compactCard`) normalizes `groundingMemoryEnabled: existingExtension?.groundingMemoryEnabled ?? false`, **which means `compactAllCardsMap()` on startup or saving in the Card Editor resets `groundingMemoryEnabled` to `false` unless it was explicitly set on `extensions.airi.groundingMemoryEnabled`**!
   - Meanwhile, `use-preflight-grounding.ts:61-64` and `chat.ts:824-827` check `groundingMemoryEnabled || universeRag?.enabled || firstHopProcessor === 'universe_rag' || cognition?.searchEngine?.universeRagEnabled` (using `||`), so if `CardEditorForm.vue` defaulted `universeRagEnabled` to `true`, runtime RAG could turn on silently while `ChatOptionsInjectionsView.vue` and `ChatGroundingPopover.vue` (which only check `groundingMemoryEnabled`) showed the toggle as **OFF**!
3. **CCv3 dual container**: CCv3 cards carry extensions in `card.data.extensions.airi.*` as well as `card.extensions.airi.*`.
4. **Dirty-tree read/write split**: The current dirty-tree `effectiveCardId` in `ChatOptionsInjectionsView.vue` reads via `targetCard fallback → activeCard` (`relu`) but writes via raw `effectiveCardId` (`'default'`), so read and write target different cards.

### 2.3 Missing `cardStore.initialize()` in desktop Electron & `removeCard` gap

- `apps/stage-web/src/App.vue:117` and `apps/stage-pocket/src/App.vue:76` call `cardStore.initialize()` on boot. `apps/stage-tamagotchi/src/renderer/App.vue:475` only called `analyticsStore.initialize()` (relying on `chatSessionStore.initialize() -> ensureActiveSessionForCharacter()` to eventually call `airiCardStore.initialize()`, leaving a window where UI components mount before `initialize()` runs).
- Furthermore, in `airi-card.ts:1527`, `initialize()` only checks `if (!activeCardId.value) activeCardId.value = DEFAULT_STARTER_CARD_ID` — if `activeCardId.value` is `'default'` (or a deleted card ID), `!activeCardId.value` is `false`, so `activeCardId` is **never healed**!
- Similarly, `removeCard(id)` (`airi-card.ts:617`) deletes the card from `cards` without healing `activeCardId` if the user just deleted the currently active card, violating Invariant #1 (`activeCard` becomes `undefined`).
- Finally, in `session-store.ts:571-575`, `loadSession()` checks `const characterId = stored.meta?.characterId; const characterIndex = index.value?.characters[characterId]` and aborts loading with `"session was deleted mid-flight"` if `stored.meta.characterId` (`'default'`) doesn't match the migrated index key (`'relu'`).

## 3. Plan

### Phase 1 — Enforce invariants in `useAiriCardStore`

1. Add canonical `resolveCardId(id?: string | null): string`:
   - If `id` is in `cards.value`, return `id`.
   - If `id === 'default'` and `'default'` is not in `cards.value`, alias to `DEFAULT_STARTER_CARD_ID` (`'relu'`) if present.
   - Otherwise fall back to `activeCardId.value` (if in `cards.value`), then `DEFAULT_STARTER_CARD_ID` (if in `cards.value`), then `cards.value.keys().next().value || DEFAULT_STARTER_CARD_ID`.
2. Self-healing `activeCardId` (`ensureValidActiveCardId()`):
   - Call at the end of `initialize()`, after `loadCards()` (once `cards.value.size > 0`), and inside `removeCard(id)`: if `!cards.value.has(activeCardId.value)`, heal `activeCardId.value` to `resolveCardId(activeCardId.value)`.
   - If `cards.value.size === 0` after `removeCard()`, re-seed `DEFAULT_STARTER_CARD_ID` (`'relu'`) so Invariant #1 (always an active character) can never be broken even if a user deletes every card.
3. Alias in mutations (`updateCard`, `toggleGrounding`, `toggleGroundingMemory`, `toggleShortTermMemory`, `toggleLifetimeMemory`, `toggleGroundingTopics`, `toggleGroundingDirectorScratchpad`, `toggleSalienceGate`, `setAutonomousArtistry`, `activateCard`):
   - Resolve incoming `id` via `resolveCardId(id)` when `id === 'default'` (or missing) while keeping raw `getCard('default')` returning `undefined` so `airi-card.test.ts` invariant test stays green.

### Phase 2 — Legacy `'default'` → `'relu'` migration on load (Rename-Preserving)

1. `airi-card.ts initialize()`:
   - If persisted `cards` has key `'default'`:
     - If `'relu'` does **not** exist yet, move `'default'` entry to `'relu'` (and delete key `'default'`).
     - If `'relu'` **already** exists (user booted post-`7178d242a`), copy `'default'` to a new preserved key `'default-imported-<timestamp>'` (updating its display name with a `(Legacy)` suffix if identical to `'ReLU'`) and delete key `'default'` — **never delete user data**, while guaranteeing the ghost key `'default'` is gone.
   - Heal `activeCardId.value`: if `activeCardId.value === 'default'` or `!nextCards.has(activeCardId.value)`, set `activeCardId.value = DEFAULT_STARTER_CARD_ID`.
2. `session-store.ts`:
   - In `loadIndexForUser()` and `reconstructIndexFromIndexedDB()`: if `index.value.characters['default']` exists, merge its `sessions` into `index.value.characters['relu']` (rewriting each `meta.characterId = 'relu'`), preserve `activeSessionId` if `'relu'` had none, and delete `index.value.characters['default']`.
   - In `loadSession(sessionId)`: if `stored.meta?.characterId === 'default'` and `!index.value?.characters['default']`, normalize `stored.meta.characterId = 'relu'` before the mid-flight deletion guard (`lines 571-576`) so legacy sessions don't abort loading!

### Phase 3 — Fix `effectiveCardId` + RAG split-brain

1. Never let `effectiveCardId` resolve to an ID absent from `cards` (in `ChatOptionsInjectionsView.vue` and `ChatOptionsPopover.vue`):
   ```ts
   const effectiveCardId = computed(() => {
     const rawCandidateId = props.characterId
       || chatSessionStore.sessionMetas[chatSessionStore.activeSessionId]?.characterId
       || activeCardId.value
     return airiCardStore.resolveCardId(rawCandidateId)
   })
   ```
2. Unify RAG across all 4 places:
   - `airi-card.ts` `resolveAiriExtension`:
     ```ts
     const resolvedRag = existingExtension?.groundingMemoryEnabled
       ?? existingExtension?.cognition?.searchEngine?.universeRagEnabled
       ?? false
     ```
     Set both `groundingMemoryEnabled: resolvedRag` and (if `cognition?.searchEngine` exists) `cognition.searchEngine.universeRagEnabled = resolvedRag`.
   - `airi-card.ts` `toggleGroundingMemory(id)`:
     Write both `groundingMemoryEnabled: !current` AND `cognition.searchEngine.universeRagEnabled: !current` (plus CCv3 `data.extensions.airi`).
   - `CardEditorForm.vue`:
     - Line 1365 (`initializeCard`): initialize `universeRagGroundingEnabled.value = airiExt?.groundingMemoryEnabled ?? cognitionData?.searchEngine?.universeRagEnabled ?? false` (default `false` to match `resolveAiriExtension`, not `true`!).
     - Line 1206 (`saveCard`): include `groundingMemoryEnabled: universeRagGroundingEnabled.value` alongside `cognition.searchEngine.universeRagEnabled: universeRagGroundingEnabled.value`.
   - `ChatOptionsInjectionsView.vue` & `ChatGroundingPopover.vue`:
     Read `activeAiriExt?.groundingMemoryEnabled ?? activeAiriExt?.cognition?.searchEngine?.universeRagEnabled ?? false`.

### Phase 4 — UI fallbacks + desktop boot

1. `stage-tamagotchi App.vue`: add `await cardStore.initialize()` right after `analyticsStore.initialize()` (after `initializeFromLocalBackup()`), before `chatSessionStore.initialize()`.
2. Replace `|| 'default'` with `|| DEFAULT_STARTER_CARD_ID` in `chat.vue` (100, 118, 128, 1051), `ChatOptionsPopover.vue:124`, `InteractiveArea.vue:65`, `SettingsQuickAccess.vue:240`.
3. In `edit.vue` / `CardEditorForm.vue`: resolve `props.cardId` via `cardStore.resolveCardId(props.cardId)` when in edit mode so `/settings/airi-card/edit?id=default` (or any stale bookmark) edits the resolved starter card instead of opening a blank ghost form.

### Phase 5 — Verification

1. `pnpm -F @proj-airi/stage-ui test airi-card` + `session-store.sync` tests for: legacy session/card migration, `effectiveCardId` with `'default'` session, lockstep RAG toggle.
2. Typechecks: `stage-ui`, `stage-layouts`, `stage-pages`, `stage-tamagotchi`.

## 4. Decisions (resolved 2026-10-19)

- [x] Raw `getCard('default')` stays `undefined` — aliasing lives only in `resolveCardId()` + mutations. Existing invariant test preserved.
- [x] Both-cards policy: keep both, rename legacy `'default'` (e.g. `'default-imported-<ts>'`) instead of merging/dropping. Ghost ID dies as an active reference, but no user data is destroyed. Phase 2 must: rewrite `activeCardId`/`sessionMetas` off `'default'`, never auto-delete the renamed copy.
- [x] Current 6-file dirty tree stays dirty for review — do not commit as fix, new work builds on top.

## 5. Open questions

- None — ready to implement phases 1–5 with the rename-preserving variant of Phase 2.
