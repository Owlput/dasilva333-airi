# Implementation Plan — Model Driver Contract (RFC 0002)

| Field | Value |
| :--- | :--- |
| Status | **Approved through Phase 1 (2026-11-23). Decision record revised 2026-11-24** (see the revision note below). Phases 2–8 are gated by the approval boundary. **Phase 0 is complete and committed** at contract `0.1` on branch `model-driver-throwaway`, RFC amendment included; P0.0's separate baseline commit is waived (P0-D1, §0). Host implementation has not started. |
| Normative source | [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) (RFC 0002). Where this plan and the RFC disagree, the RFC wins. Phase 0 adds contract surface the RFC does not yet contain (§3.1), so **RFC 0002 is amended as Phase 0's last commit** (§3.2) and the contract's additions become normative text rather than private convention. Host choices the RFC leaves open are recorded in §2. |
| Contract package | `@proj-airi/stage-renderer-sdk` — 15 contract files (`src/contract/`), plus `index.ts`, `compatibility.ts`, `validate.ts` and its `vitest` suite; `0.1.0`, committed on `model-driver-throwaway`, **no integration** (D12, §0). P0.0's separate `0.0.3` baseline commit is waived (P0-D1). |
| Supersedes | [`docs/design-stage-renderer-migration.md`](../../docs/design-stage-renderer-migration.md) (the RFC 0001 companion plan) wherever that document conflicts with RFC 0002 — see Appendix B |
| Scope | Host integration for Electron + Web + Pocket, four first-party drivers (Spine, MMD, Live2D, VRM), migration of existing data on user request, and a three-release reversal window |
| Out of scope | Third-party driver packaging/distribution and a loader, a driver-side cloud-sync channel, a scripting VM, beat sync, per-cue progress reporting (migration status is host-level, §5.9), cancellation outside cue transactions, a per-driver compilation pipeline, a dedicated onboarding update mode, Stage-Mate's own migration (§1.7) |

**Approval boundary.** Phase 0 and Phase 1 are approved. Every later phase is approved only at the exit gate of the phase before it.

| Phase | Scope | Approved | Gate that must pass before the next phase starts |
| :--- | :--- | :--- | :--- |
| 0 | Contract closure | 2026-11-23 | SDK `typecheck` + `test` green; zero importers; RFC amended |
| 1 | Host core + stub | 2026-11-23 | Broker/registry/manager-request suites; main-bundle assertion |
| 2 | Mounts, host surfaces, prompt, migration service, VRM spike | **not approved** | Phase 1 exit criteria |
| 3–6 | One driver per phase, Spine → MMD → Live2D → VRM | **not approved** | Previous driver's exit criteria |
| 7 | Hardening, transfer, reversal | **not approved** | Phase 6 exit criteria |
| 8 | Final removal after the cutoff | **not approved** | Phase 7 exit criteria |

**Revision note (2026-11-24).** This revision changed the decisions it touched and added D17 and D18. It also reversed two earlier answers: migration is **user-requested** rather than a queue that starts on launch (D13), and Stage-Mate **migrates as planned** with one documented speech-relay exception rather than being left broken (D3, §5.5). Mechanisms deleted by this revision, so that no stale reference survives: `overwrite` on the migration path, `absorbed` as a boolean, the `absorbed && retained` driver gate, `revertedAt`, `legacyModelId` on the host model record, `entry` on `requestRenderer`, host-side outfit conversion, and the `partial` publication flag.

**Decision record.** D1–D18 are recorded once, in [§2](#2-decisions), with a minimal index at its head. D1–D16 were signed off on 2026-11-22/23 and re-reviewed by this revision; D17 and D18 are new.

Notation: **MUST** / **MAY** / **SHOULD** carry the RFC's meaning. "Phase" is a shippable slice, not a calendar estimate. Every phase ends with an observable exit criterion.

---

## 0. Starting point

1. **The baseline was never pinned as its own commit.** `packages/stage-renderer-sdk` held 13 contract files when Phase 0 opened; that tree was the RFC 0002 reshuffle (`adapter.ts`, `components.ts`, `plugin-port.ts` added; `persistence.ts` and `renderer.ts` deleted; ten files modified), `src/index.ts` re-exported 12 of the 13 — `adapter` was not exported — and its only validation was `tsc --noEmit`, with no tests. P0.0 asked for exactly that tree to be committed as `0.0.3` before Phase 0 began; it was not, and reconstructing the history after the fact would rewrite a commit that already exists on the branch, so **P0.0 is waived** (P0-D1). What is lost is only the ability to diff "the tree the plan was approved against" from "what Phase 0 changed"; that difference is now the C-table plus [`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md).
2. **Phase 0's contract work is committed at `0.1.0`.** 15 contract files in `src/contract/` (`registry.ts` and `migration.ts` are new), plus `src/index.ts`, `src/compatibility.ts`, `src/validate.ts` and the `vitest` suite (`src/validate.test.ts`, `src/contract.test.ts`, 82 tests). `tsc --noEmit` is clean, `vitest run` is green, `MODEL_DRIVER_CONTRACT_VERSION` is `{ major: 0, minor: 1 }`, and the RFC amendment (§3.2) is in the same commit, on branch `model-driver-throwaway`.
3. **Nothing imports the package.** A repository-wide grep for `stage-renderer-sdk` outside its own `src/`/`README.md`/`DECISIONS-PHASE0.md` returns nothing.
4. **The app renders through one component and four stores.** `RendererStage.vue` statically imports the four scene components; `ControlStripHost.vue`, `ControlStrip.vue`, `ModelCustomizer.vue`, the card store and the settings pages read and write the four renderer stores directly.
5. **The data model has no identities beyond a display-model string.** `display-model-${nanoid}` is minted in the host store; there is no `profileId`; there is no driver id on a model; a character card points at `modules.displayModelId`. No model-prompt publication exists.
6. **No host machinery for the contract exists**: no registry, adapter, manager, runtime, cue broker, mount registry, model rows, profile records, prompt publication, or driver panels/picker.

The choices Phase 0 made while closing each gap are recorded once, outside this plan, in [`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md).

Three risks govern the sequencing:

- **Contract churn is free now and expensive after Phase 1.** §3 closes the RFC 0002 gaps before host code depends on the shapes.
- **The app cannot stop rendering while it migrates.** Every phase keeps un-migrated formats on the legacy path; a format crosses over in its own slice (§6), and removal is last (§8).
- **Migration changes user data.** It rewrites card bindings and re-imports model bytes. It therefore runs on request, is reversible for three releases, and deletes nothing without a user decision (D9, D13, D14).

---

## 1. Current project structure

This section is the factual baseline: what exists, where it lives, and how strongly the host is coupled to the four renderers.

### 1.1 Repository map relevant to rendering

| Path | Role today | Relationship to RFC 0002 |
| :--- | :--- | :--- |
| `packages/stage-ui` | Host UI, scene mounting, display-model store, settings logic, card store, captions | Becomes the host that knows no format |
| `packages/stage-ui-three` | VRM: Three.js scene, store, preview util, VFX, trace | Renderer internals + driver subpaths |
| `packages/stage-ui-live2d` | Live2D: Pixi scene, store, DSL VM, preview util, validator, OPFS | Renderer internals + driver subpaths |
| `packages/stage-ui-spine` | Spine: scene, store, preview util, version detection | Renderer internals + driver subpaths |
| `packages/stage-ui-mmd` | MMD: scene, store, preview util, ZIP extractor, morph constants | Renderer internals + driver subpaths |
| `packages/stage-pages` | Settings routes: models, card editor, onboarding, providers | Host consumers of rows, panels, pickers |
| `packages/stage-layouts` | Stage embedding in layouts | Consumes `WidgetStage`, no format knowledge |
| `packages/stage-renderer-sdk` | The contract (**this package**) | The boundary |
| `apps/stage-tamagotchi` | Electron main + renderer; window managers; eventa contracts | Hosts the registry, managers, adapters and mounts |
| `apps/stage-web`, `apps/stage-pocket` | Single-renderer hosts (browser, Capacitor) | Single-process variant of the same host |
| `packages/plugin-sdk`, `packages/plugin-protocol` | Existing plugin host for server/WebSocket plugins | **Not** reused; RFC 0002 has no loader |
| `packages/model-driver-lipsync`, `model-driver-magic-live2d`, `model-driver-mediapipe`, `motion-driver-magic` | Motion-capture / lip-sync / MAGIC motion "drivers" | **Name collision**; unrelated to avatar formats (§1.7) |

### 1.2 How a model reaches the screen today

```text
Electron window                       renderer page                         mount
─────────────────────────────────────────────────────────────────────────────────────────
main (control strip)  ──────────────▶ pages/index.vue        ──▶ WidgetStage
                                                               └▶ ControlStripHost.vue
                                                                  └▶ RendererStage.vue
stage (acting)        ── /actor ────▶ pages/actor.vue        ──▶ RendererStage.vue
chat                  ── /chat ─────▶ pages/chat.vue         ──▶ RendererStage.vue
chat → Rehearsal                     chat_rehearsal.vue      ──▶ RendererStage.vue
settings              ── /settings ─▶ stage-pages/models      ──▶ model-settings/index.vue
                                                                  └▶ 4 scene components (async)
onboarding            ── /onboarding▶ step-finale.vue         ──▶ RendererStage.vue
web / pocket          ── / ─────────▶ pages/index.vue        ──▶ WidgetStage → RendererStage.vue
```

`RendererStage.vue` is the seam, and it is a hand-maintained union:

- static imports of `Live2DScene`, `MMDScene`, `SpineScene`, `ThreeScene` and their stores (`packages/stage-ui/src/components/scenes/RendererStage.vue:3-6`);
- four mutually exclusive `v-if` branches, each with its own prop list (`:454-555`);
- exposed per-renderer handles (`vrmViewerRef`, `live2dSceneRef`, `spineViewerRef`, `mmdViewerRef`, `canvasElement`, `captureFrame`, `readRenderTargetRegionAtClientPoint`) at `:436-445`;
- host-drawn caption surfaces that reach into the renderer (`HeadTetheredCaption.vue` imports `attachLive2DHeadTetheredCaption` and hands it the Pixi app; `HeadTetheredCanvas2D.vue` and `HeadTetheredRadialMenu.vue` call `getHeadPose()`).

### 1.3 Coupling baseline

The full inventory is in **Appendix A**. Summary:

| Kind | Count | Concentrated in |
| :--- | ---: | :--- |
| Static imports / re-exports of a renderer package outside it | 75 host files/packages | `RendererStage.vue:3-6`, `ControlStripHost.vue:15-18`, `ModelCustomizer.vue:14-17`, `display-models.ts:10-27` |
| Format branches | 117 rows; **216** `DisplayModelFormat` references, **57** `stageModelRenderer === '…'` comparisons | `stage-model.ts`, `display-models.ts`, `ModelCustomizer.vue`, `ControlStrip.vue`, `model-selector.vue`, onboarding |
| Renderer-store reach-ins | 74 | `ControlStrip.vue:489-495`, `ModelCustomizer.vue:69-72`, `airi-card.ts:456-457`, `ControlStripHost.vue:102-104` |
| BroadcastChannel sites carrying renderer state | 35, on **12** host channel names + **5** renderer package channels | `RendererStage.vue`, `ControlStripHost.vue`, captions, `airi-speaking-state` |
| Mount sites | 30 | the five `RendererStage` call sites + settings preview + devtools |
| Model binary / asset handling in host code | 43 | `display-models.ts` (2,375 lines), `stage-model.ts`, `model-selector.vue`, `sync-engine.ts` |
| Per-format settings panels and pickers | 37 | `model-settings/*.vue`, `ModelCustomizer.vue`, `ControlStrip.vue`, `model-selector.vue`, onboarding |
| Host code naming renderer internals | 55 | Live2D parameter panels, VRM humanoid bones, Spine skin candidates, MMD morph slots, lip sync |

The coupling is not 466 independent decisions. It is one enum (`DisplayModelFormat`, 7 values), one parallel renderer enum (`StageModelRenderer`, 5 values), five stores, one scene component and one 2,375-line store.

### 1.4 Data, identity and persistence today

| Fact | Current shape | Consequence |
| :--- | :--- | :--- |
| Model record | `DisplayModel = DisplayModelFile \| DisplayModelURL \| DisplayModelCloud` (`display-models.ts:41-110`) | Carries annotations, capabilities and (for file models) the binary |
| Identity | `display-model-${nanoid()}` at import (`:1195`, `:1246`); presets hardcoded; `MODEL_ID_ALIASES` (`:470-475`) | AIRI mints ids, but not through an adapter; the prefix is the persistence predicate |
| Profile / outfit | `AiriOutfit` on the card (`card.schema.ts:195-204,320`) and mirrored onto the record; `applyOutfit` only pokes VRM weights (`airi-card.ts:1423-1469`) | No `profileId`; RFC requires one per import and a driver-owned profile body. The conversion is **driver work**, not a host step (D14) |
| Card binding | `extensions.airi.modules.displayModelId` (`:103`), mirrored into `active_state.displayModelId` (`:375`) | 307 `displayModelId` references; the new path adds `extensions.airi.avatar` beside it (D4) |
| Model prompt | `extensions.airi.acting.modelExpressionPrompt` (`:308-319`), user/LLM-authored and injected into the system prompt (`airi-card.ts:1521-1531`) | RFC moves it into a driver publication, per model **and profile**, as an atomic pair with the ACT token list. The legacy text is frozen at cutover, never restored (D10, D5) |
| Binary storage | localforage default DB: `display-model-{nanoid}` (record incl. `File`), `{id}-textures` (MMD), URL models under their raw id | Driver-owned keys after cutover; host stops enumerating them |
| Catalog cache | unstorage `local:display-models/metadata-cache`, `local:sync-metadata/remote-catalog-cache` | Host rows replace the metadata cache |
| Deletion | `local:sync-metadata/deleted-models/{id}` written on removal, scanned by `reconcileModels()` | Already the durable marker RFC §13.2 asks for |
| Preview | `previewImage` data URL + metadata cache + remote `{id}-preview.png`; four body-mounted canvases | Driver produces, AIRI stores a copy |
| Settings | ≈110–120 `settings/{stage-ui-three,live2d,spine,mmd}/*` keys, window-global; only `settings/positioning/models` and `lastModelIdentity` are model-scoped | Driver storage; one-time legacy handover per model (D8), collected opaquely (D14) |
| Tests | No store-level import test; only MMD variant detection and label normalization are covered | §9 adds the missing harness |

### 1.5 Process and transport topology

| Layer | Facts |
| :--- | :--- |
| Electron main | Creates the window managers (`apps/stage-tamagotchi/src/main/index.ts:322-452`), composes services with `injeca`, owns window lifecycle and native capture. **No IndexedDB, no DOM, no WebGL.** |
| Renderer windows | Vue + Pinia; own IndexedDB/localStorage; one origin shared by all windows. |
| Main↔renderer | Typed `@moeru/eventa` contracts (`apps/stage-tamagotchi/src/shared/eventa.ts`, 438 lines) plus window-specific RPC; a few raw `ipcMain` channels (`byos-fs:*`, `stage:capture-window`, backup bundles). |
| Renderer↔renderer | `BroadcastChannel` only, fire-and-forget. Twelve host channel names participate in renderer state. |
| Web / Pocket | One renderer; no main process; the same `WidgetStage` composition. |

### 1.6 What does not exist

- A declaration registry, contract-version check, enable/disable state or driver status surface.
- An adapter that mints identities, requests entry points or authenticates a runtime.
- A manager in main, a model-row enumeration path, or a renderer-request path.
- A cue broker: no transaction table, correlation authority, settlement, drop/deadline, cancellation or window-gone handling.
- A mount registry: readiness is a local ref, surfaces/purposes are not modeled, cues are addressed by component ref where they exist.
- `HostNamedModelRecord`, `HostModelProfileRecord`, `CharacterModelBinding`, persisted rows.
- Prompt publication as a driver→host push, or a prompt + ACT token list pair.
- Driver panels, driver picker, AIRI's unavailable-model picker.
- An arbitration surface for two disagreeing publications (D5).
- Speech frames as a host service (each renderer receives `mouthOpenSize`; Live2D additionally runs the host's `createLive2DLipSync`).
- Any test or harness that can mount a fake driver.

### 1.7 Constraints

1. **The name "model driver" is taken by motion/lip-sync packages.** New packages and prose use “stage driver”; `ModelDriver*` stays for contract types. The old "model driver" will be renamed later.
2. **Desktop main cannot touch IndexedDB.** Model bytes and settings stay in web storage, so anything that needs storage runs in a renderer (§4.3, D1).
3. **Web and Pocket have no main process.** The host core is usable in-process without Electron.
4. **Electron main externalizes dependencies by default**, so a driver manager imported by main is special-cased in the build (D2).
5. **Stage-Mate (Unity) is outside the contract but follows the VRM cutover** (§5.5, §6.4). It receives no avatar handover: the data migration is AIRI↔driver only.
6. **First-party only.** No loader, no discovery, no third-party distribution.
7. **The repo develops directly on `main`.** Every phase is reviewable on its own.

---

## 2. Decisions

RFC 0002 leaves host choices open. Each decision is stated once below, in order, with whatever shape it needs. The index carries titles only.

| # | Decision |
| :--- | :--- |
| D1 | Manager and cue authority |
| D2 | Driver layout and entry resolution |
| D3 | Transport |
| D4 | Identity, the empty avatar, and card binding |
| D5 | Prompt publication, snapshot and arbitration |
| D6 | Order |
| D7 | Scope |
| D8 | Legacy handover |
| D9 | Reversibility and the cutoff |
| D10 | Legacy card fields |
| D11 | Background window |
| D12 | Contract versioning |
| D13 | Migration runs on user request |
| D14 | Byte custody |
| D15 | Downgrade |
| D16 | Onboarding and the post-update screen |
| D17 | Storage policy |
| D18 | Ids inside packages |

### D1 — Manager and cue authority

The registry creates, owns and releases one manager per driver — in Electron **main** on desktop, in-process on Web/Pocket — and main also holds the broker, the transaction table, the live mount descriptors and the deadline timer. The adapter is the **endpoint**: it emits envelopes and receives settlements, and `NO_TARGET` is the broker's decision delivered to it. The manager keeps §4.4 step 5 fan-out, rows, entry lookup and lifecycle. Mount ids are issued by the registry, never constructed by a renderer. There is no desktop lock.

`RegistryHandle`, `ManagerChannel` and `registerMount` are specified in §4.3; the renderer-request behaviour, submission and settlement are §4.3 and §4.4.

### D2 — Driver layout and entry resolution

Driver modules stay colocated in the renderer package they belong to (`src/driver/*`) with six subpaths. Main imports only the DOM-free `manifest`/`manager`; the renderer imports `provider`/`mount`/`panels`/`picker` through one loader table that is the only renderer-side place a driver package is imported. The manager — not the adapter, not the manifest — chooses the entry, and the adapter imports what it named.

The subpaths, the export map, the four-step resolution and the build assertion are specified in §4.7.

### D3 — Transport

`@moeru/eventa` for everything that is answered — cue envelopes, manager requests, and observations that settle. `BroadcastChannel` for observation only (speech frames, renderer state), latest-wins, no ack, and no trip through main. In-process on Web/Pocket. The Stage-Mate speech relay is the single documented exception that crosses main (§5.5), because an ack that can be lost is not an ack.

### D4 — Identity, the empty avatar, and what a card carries

The adapter is the identity authority: `modelId` is **generated fresh** at import or restore (the legacy `DisplayModel.id` is **not** adopted — it survives only as the frozen `modules.displayModelId` and inside the driver's retained handover); `profileId` is minted by the adapter, preserved inside a package and checked on the way in; the driver only reads ids. The registry issues `mountId`. `extensions.airi.avatar` is additive, **an empty one is a normal state**, and the card carries a complete publication snapshot. `modules.displayModelId` is frozen at cutover, and after cutover only the revert transaction writes it (D10).

The binding's shape is §4.5; the states it can be in, and what each one renders and offers, are §5.6.

### D5 — Prompt publication, the card snapshot, and arbitration

One atomic `ModelPromptPublication` — text **and** ACT token list, one `version` — covers the prompt. A driver MUST publish at least once per model/profile once activated. An empty prompt with an empty token array is valid and stored as-is. A prompt-capable driver that finishes activation without ever publishing for that model/profile is a fault, and the fault is a runtime state surfaced in the driver panel — it never blocks migration (D8). An older publication is stale and discarded.

The host prompt store is the only input to prompt assembly and the card keeps a complete portable snapshot of it. The two are reconciled at activation only; a disagreement is arbitrated **by the user** and nothing is ever discarded — the losing copy is archived complete.

The reconciliation table, the conflict rules and the arbitration surface are §5.4 and §5.10.

**Reversal.** The legacy prompt is retained for the reversal window and is not cleared at cutover. A reverted character reads it again. At window close it becomes inert legacy data and follows D10.

### D6 — Order

Spine → MMD → Live2D → VRM. The Phase 2 VRM spike gates Phase 3. No rationale for the order is recorded beyond risk-first sequencing.

### D7 — Scope

First-party only: no loader, no discovery, no third-party distribution. Driver specifiers are build-time links resolved by the renderer bundle (D2).

### D8 — Legacy handover

A handover is offered **per model**, at the moment the migration queue reaches that model, and it is **lazily materialized** — one model's bytes in memory at a time, never the whole library (D17). It contains everything the driver needs to reproduce the model and to serve a later revert. The driver absorbs it, **retains it in its own storage**, and reports `retained` for that model. The host writes `model-migration/{modelId}` only after the import transaction commits (§6.5).

**Completeness.** "Complete" means every model of the driver transferred. Completeness gates the driver's terminal marker and the deletion of its legacy copies; it never gates per-model rendering on the new path. A model that cannot transfer (quota, driver refusal) stays legacy-shaped and the driver simply never completes.

**Migration is not gated by the prompt.** A missing publication is a runtime fault (D5). It never blocks a model from transferring and it never blocks the run: the model migrates, and its missing prompt stays visible as a fault until the driver publishes.

**Import is the create.** There is no pre-registered host record. The adapter mints the `modelId` and a default `profileId`, the handover carries the legacy metadata (name, nsfw, groups, tags, searchKey inputs) and the legacy label, and the host record is written from the import's result. Nothing is held before migration, so nothing needs `overwrite`, and crash-retry is a check-then-skip against the driver's own rows.

### D9 — Reversibility and the cutoff

Revert is served by the driver, not by retained host copies, and it is a **transaction**:

- it is **per character** and atomic: the driver returns its retained `LegacyRestorePayload` (C23), the legacy import recreates the legacy record **under the preserved legacy id**, and the transaction writes `modules.displayModelId` (and the `active_state` mirror) from the payload and clears `extensions.airi.avatar` — all of it, or none of it;
- the per-driver "Revert avatar migration" action is a loop of independent per-character transactions reporting one result each, never a wholesale failure;
- a model with **no legacy origin** (imported after cutover, no retained handover) refuses with a readable reason rather than importing nothing;
- reverts keep driver data, so "Migrate again" is available for the same character while the window is open.

**Frozen field, one exception.** `modules.displayModelId` is frozen at cutover and **only the revert transaction writes it afterwards** (D10). A model switch after cutover leaves the frozen field naming the card's *original* legacy model, so revert restores the character to its *current* model on the legacy path rather than to a stale one.

**Cutoff.** The legacy path ships for at least three published releases after that format's cutover. Then the legacy **renderer** is removed, the legacy **collector** survives indefinitely (it is bytes-in/bytes-out and cheap), legacy data is never deleted automatically, and a late user can still migrate — losing only the renders in between. This is the whole of "the user bears the cost of not migrating".

**No revert marker.** "Is this character on the legacy path?" is derivable — no `avatar.modelId` present — so there is no `revertedAt` and no bookkeeping to drift. §8.1's removal condition becomes cutoff-based, because user-requested migration would otherwise never satisfy it.

### D10 — Legacy card fields

`cueAllowlist`, `compiledWhitelist`, `active_state.active_expressions`, `AiriOutfit.meshes`/`expressions` and `acting.modelExpressionPrompt` are kept inert and frozen at their cutover values. After cutover the revert transaction is the only writer of `modules.displayModelId` (D9), and nothing restores `acting.modelExpressionPrompt` because nothing changed it. Removal is a user-requested cleanup, never automatic, and never part of the legacy-copy deletion prompt.

### D11 — Background window

One window owned by main, consumer-refcounted from day one, **not counted for quit**, closed explicitly at shutdown, with `backgroundThrottling: false`. It hosts manager-requested driver entries (D1) and the migration runtime (§5.9).

### D12 — Contract versioning

`0.0.3` was the uncommitted baseline P0.0 was to pin — waived, so it exists only as provenance (P0-D1); `0.1` is the first shipped contract shape; any later breaking shape is `0.2`. A manifest is compatible when its minor matches below 1.0 and its major from 1.0 (C14).

### D13 — Migration runs on user request

The distinction that matters here is that **nothing moves until the user asks**. The surfaces, the run's mechanics and its reporting are specified once in §5.9 and §5.10; this decision fixes only the trigger and its consequences:

- declining leaves every character on the legacy path untouched, with the action available and no nagging;
- **partial is terminal.** If storage runs out mid-run, every committed model stays committed and the rest stay legacy-shaped; nothing is rolled back. That is why deleting the *remaining* legacy copies stays blocked until the cutoff (D9);
- "No progress reporting" in the scope line means no per-cue progress, not no migration status.

### D14 — AIRI is a byte custodian

AIRI is a byte custodian, never an interpreter: it collects legacy items as an opaque whole, writes driver bundles as-is, performs no format parsing and no outfit conversion, and never partially deletes the legacy set. Opaque to the host in the handover: `values`, `outfits`, `files`, `assets`, `prompt` and `url`. The driver interprets them and reports `unused` (§6.5). Byte-exact handling of driver bundles is specified in §7.1, and outfit conversion is driver work (§6.0 D-9). A driver refusal leaves the app fully usable on the legacy path, and the host keeps the collected legacy items **as a whole** so a later attempt is possible.

### D15 — Downgrade

A downgraded build cannot render a model whose host legacy copies were deleted, because it cannot ask the driver for them. That is the single guarantee this design gives up; it is stated in the deletion prompt and in §10.

### D16 — Onboarding and the post-update screen

Onboarding re-runs on update; steps whose values are already configured are skippable and never overwritten. The post-update screen is the primary migration entry point (§5.10). A dedicated update mode is deferred.

### D17 — Storage policy

Migration is gated, and the gate is arithmetic. Normal mode needs free space ≥ the driver's legacy library size; progressive mode — chosen by the user, never assumed — needs ≥ the largest single model's **imported** size, because each legacy copy is deleted at its own commit. Failing the gate blocks that driver with exactly three options: free space, enable progressive deletion, or cancel. An unavailable estimate is disclosed, never guessed. The gate prefers a driver-declared import size over the compressed legacy archive size, and **move-import is a required driver property** so the retained payload and the imported row are never two copies of the same bytes.

The gate table, the copy census and the nine failure patterns are §5.9.

### D18 — Ids inside packages, and conflicts

A driver package, a backup, a restore and a device transfer **preserve** the ids they carry (`modelId`, `profileId`); the adapter **checks** them, and the driver never creates one. Migration from legacy is the one asymmetry: it mints **fresh** ids and keeps the legacy id only as provenance (D4).

A conflict — an incoming id that already exists locally — is resolved by the user, never silently:

- **reassign and repoint** (default): the incoming model gets a fresh id and the card that references it is repointed in the same transaction; existing local cards are never touched;
- **skip**: nothing is imported;
- **replace in place**: offered only when the user asks for it, because swapping content under an unchanged id silently changes what an existing card renders; it implies `overwrite` and `resetProfiles`.

`overwrite` exists for that case and for the ordinary picker. **No migration path uses it** — migration's import is the create (D8), so there is nothing to overwrite and no marker to authorize it.

---

## 3. Phase 0 — Close the contract

**Goal:** the contract package expresses RFC 0002 exactly, with executable checks, before host code depends on it. No application behaviour changes.

| # | Gap (RFC section) | Change | Acceptance |
| :--- | :--- | :--- | :--- |
| C1 | `Adapter` is unexported and cannot mint (`§5.1`, `§8.2`, App A) | Export it; add `mintModelId`/`mintProfileId`; do **not** add `mintMountId` — the registry issues it (C22); add `requestEntrypoint({ driverId, kind, surface, purpose })`; document manager authentication | `src/index.ts` exports `./contract/adapter`; tests mint unique ids; the adapter type exposes no way to construct a mount id |
| C2 | Envelopes address `mountId`, not driver + surface + purpose (`§9.2`) | `CueEnvelope.target = { modelDriverId, surface?, purpose? }`; remove public `mountId`; rename `ACTOR` to `ACTING` in the surface/purpose/host-window enums | A test sends `{ driver, surface:'acting', purpose:'acting' }` and resolves the right mount set |
| C3 | Manager delivery is missing (`§4.2`, `§12`) | `deliver`, `withdraw`, enumeration-change notification, analyzer registration | Type-level tests; §4's stub exercises it |
| C4 | No cancellation (`§9.7`) | Transaction states, six withdrawal requests including `abort-current`, per-target result table, bounds | Tests cover every request |
| C5 | Acknowledgement incomplete (`§9.3`) | Answering `modelDriverId`; debug message; acceptance vs settlement split; drop `requestId` | Accept, cancel before settle, observe `cancelled` |
| C6 | Failure vocabulary incomplete (`§9.4`, `§9.6`, `§6.2`) | Add `cancelled`, `window-gone`, `contract-version-mismatch`, `model-referenced`, `profile-referenced`, **`profile-missing`**; rename `RENDERER_UNAVAILABLE` → `DRIVER_UNAVAILABLE` | Exhaustive enum tests |
| C7 | Prompt is not a versioned pair (`§10.4`) | One `ModelPromptPublication` carrying `text`, `tokens` and one `version`; mandatory once activated; empty valid for every driver; a prompt-capable driver that never publishes is a fault; stale publication rejected; the card's snapshot carries the same pair | Publishing `('', [])` persists for any driver; a prompt-capable driver with no publication is a runtime fault, not a migration gate; an older version is discarded |
| C8 | Capability/cue vocabulary deltas (`§6.4`, `§9.5`) | `effect`/`EffectCue`; `ACT='act'`; `interactionModes`; `effect` in `ResetScope`; POI gaze target; `NO_TARGET` rejection; cues typed “beyond load”; no transient load/reset/caption | Typecheck + grep |
| C9 | Readiness transitions absent (`§8.4`) | `READINESS_TRANSITIONS` + `isReady`; only `model-loaded`/`ready-for-model` are ready | Walk every declared transition; reject an undeclared one |
| C10 | Cross-window queries missing (`§8.6`) | Manager-level `queryMount`/`commandMount` by surface+purpose; live-instance members stay | A second adapter reaches a mount |
| C11 | No reference check before removal (`§5.2`, `§5.10`) | Host gate in `remove`/`removeProfile`/`purge`; `references?` evidence; failure codes | Stub refuses a referenced model |
| C12 | `pending-import` contradicts RFC (`§5.1`, `§13.2`) | Remove from `ModelState`; add AIRI-only `PendingModelPayload` | A pending payload cannot construct a `LoadCue` |
| C13 | Migration input is per-entry (`§13.1`) | Per-model handover as specified in §6.5 — model bytes and the legacy label, report `retained`/`unused`/`warnings`, **no `absorbed` boolean and no per-driver aggregate**; the driver retains what it received and consumes the bytes by reference (D8, D17) | Two calls for the same model are idempotent; a driver that drops the payload reports `retained: false` and no migration marker is written; a driver that copies instead of moving is a defect against D-16 |
| C14 | No compatibility predicate (`§6.2`) | `isContractCompatible` (same minor below 1.0, same major from 1.0, patch-compatible); readable rejection | Table-driven test |
| C15 | Entry declaration bypasses the manager (`§6.1`, §6.5) | Manifest `entry: { manager }` only; manager gains `resolveEntrypoint` returning `{ specifier }`; adapter requests it | Startup test proves main imports no renderer UI; resolver test returns the mount specifier and every `provider` specifier resolves |
| C16 | Two driver-status vocabularies (`§7.3`) | Keep `DriverStatus`/`UnavailableModelReason`; document mapping, including `profile-missing` | Mapping test |
| C17 | No validators/tests | `validateManifest`, `validateCueEnvelope`, `assertCapabilityCompleteness`, `assertAckShape`; add `vitest` | `typecheck` + `test` green |
| C18 | Stale RFC 0001 citations | Update `src/index.ts`/`README.md`; add adapter + plan to the file map | Links resolve |
| C19 | Pointer wording contradicts RFC (`§10.3`) | A runtime MAY attach listeners inside its own window; the service is the only route outside it | Comment/type review |
| C20 | Host passes a size (`§8.3`) | Remove `RendererMountProps.viewport`; the container is the viewport and the mount measures it | No size reaches a driver |
| C21 | Commit lacks input and per-entry settlement (`§5.3`) | `confirmImport` receives the input handle/copies; each committed entry settles independently; **the migration path never passes `overwrite`** | One failing + one succeeding entry persists only the success; a migration import of a held id is a plain create |
| C22 | Manager has no renderer-code request (`§5.8`, `§10.2`) | Add `RegistryHandle`, `ManagerChannel` and `registerMount` exactly as specified in §4.3; `createManager(handle)` receives the handle and there is no `storage` on it | Manager requests a renderer, exchanges one message through the channel, and answers `listModels`; no storage handle reaches main; each refusal reason is asserted separately; mount ids are registry-issued |
| C23 | Revert has no data path (`§13.1`, `§5.10`) | Host transition type `LegacyRestorePayload`: on request the driver returns one model's retained legacy entry — **the legacy id**, setting values, placement, outfit payload, prompt and model bytes — so the host can feed the legacy import under the preserved id; opaque to the RFC like the handover | Stub round trip: retain a handover, request a restore, the host receives the same bytes and the same legacy id, and the legacy path renders |

**Execution units** (one reviewable change each)

| Unit | Contents | Done when |
| :--- | :--- | :--- |
| P0.0 | Pin the `0.0.3` baseline as its own commit; correct §0 | The reshuffle is a named commit, not a working-tree diff, and it is reviewed and accepted as the baseline |
| P0.1 | Adapter export, entry request, minting (no `mintMountId`), cue target + `acting` rename, vocabulary deltas, pointer wording, no viewport | `tsc --noEmit` clean |
| P0.2 | Cancellation, ack split, failure codes (incl. `profile-missing`), readiness, queries, compatibility | Type-level tests |
| P0.3 | Records/migration types, per-model handover, reference gate, pending payload, import commit input, `RegistryHandle` + `registerMount` | Types compile; mapping tests |
| P0.4 | Validators, `vitest`, exports/citations | `pnpm -F @proj-airi/stage-renderer-sdk test` green |
| P0.5 | `docs/data-catalog.md` model-domain correction + new keys (`prompt`, `prompt-archive`, markers) | Catalog matches source |

> **P0.0 is waived** (P0-D1): the baseline was never pinned as its own commit, and reconstructing it after the fact would rewrite a commit that already exists on the branch. P0.4's `pnpm -F @proj-airi/stage-renderer-sdk test` was executed as `vitest run` directly, because pnpm could not open its store database in the authoring session; the declared script is that same command. The evidence table is in [`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md).

### 3.1 Contract surface added beyond the RFC

Phase 0 adds symbols the RFC does not yet contain: `RegistryHandle` and `registerMount` (C22), `LegacyRestorePayload` (C23), `PendingModelPayload` (C12), `isContractCompatible` (C14), and the `profile-missing` failure reason (C6). Appendix C claims a 1:1 map, so that claim is false until the RFC is amended.

### 3.2 RFC amendment

The amendment lands **as Phase 0's last commit**, after P0.4 and P0.5, against [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md): the added symbols above, the per-model handover with the legacy label, the atomic publication pair, the `ACTING` rename, and the `profile-missing` reason. Sequencing matters: the contract freezes first, so the RFC documents what exists rather than what is planned. Until the amendment lands the contract is ahead of its normative source, which is acceptable only because nothing imports it.

**Landed:** written as one appended section (A1.1–A1.8) and committed in the **same commit** as the contract rather than as a separate last commit, because the whole phase was one change by the time a human committed it. The ordering this clause protects — contract frozen before the RFC documents it — held within that change; it is recorded as a deviation in P0-D1 and the header states the outcome.

**Exit criteria**

1. `pnpm -F @proj-airi/stage-renderer-sdk typecheck` and the new `test` pass. (Verified by running the same binaries directly — see [`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md) §Validation.)
2. No format string (`vrm|live2d|spine|mmd`) outside comments; no `stateScope`/`persistence` residue.
3. Every RFC 0002 section maps to an exported symbol (Appendix C); zero app importers remain.
4. Package `version` `0.1.0` and `MODEL_DRIVER_CONTRACT_VERSION` `{ major: 0, minor: 1 }` land in one commit.
5. A `0.0.x` manifest is rejected by `isContractCompatible` with a readable reason.
6. The RFC amendment is committed and the contract ↔ RFC map is true. (It shares the Phase 0 commit rather than being its own last commit — P0-D1.)

**Next action:** Phase 1. P0.0 is waived, every other unit is complete, and the six criteria above hold; Phase 1 starts on top of this contract.

---

## 4. Phase 1 — Host core

**Goal:** a host implementation that can carry the contract with a stub driver, with no real renderer touched and no user-visible behaviour change.

### 4.1 Where the code lives

| Artifact | Path (new unless noted) | Responsibility |
| :--- | :--- | :--- |
| Host core (pure TS, no Vue/Pinia) | `packages/stage-driver-host/` | Registry, broker, transaction table, cancellation, live mount registry (descriptors only), id minting for `modelId`/`profileId`, mount-id issuance, host record types plus the record/profile/prompt stores behind a storage port (the renderer adapter supplies IndexedDB), `RegistryHandle` contract, entry-resolution protocol |
| Contract validators | `packages/stage-renderer-sdk/src/validate.ts` | Manifest, envelope, capability completeness, compatibility, ack shape (Phase 0) |
| Main-process service | `apps/stage-tamagotchi/src/main/services/model-drivers/` | Registry ownership, managers, renderer-request routing, row cache, eventa contracts, window-gone settlement, enabled flags |
| Shared background window | `apps/stage-tamagotchi/src/main/windows/background/`, `src/renderer/background.html`, `background.main.ts` | The app's one background window: hosts manager-requested driver entries and the migration queue's runtime, with a consumer refcount, lazy start, `backgroundThrottling: false`, excluded from the quit decision and closed at shutdown. Beat sync stays separate in Phase 1 |
| Renderer adapter | `apps/stage-tamagotchi/src/renderer/libs/model-drivers/adapter.ts` | Per-window adapter: mint, mount registration, services, authenticated channels |
| Renderer loader table | `apps/stage-tamagotchi/src/renderer/libs/model-drivers/loaders.ts` | The only renderer-side table that imports driver `provider`/`mount`/`panels`/`picker` modules |
| Web / Pocket host | `apps/stage-web/src/libs/model-drivers/`, `apps/stage-pocket/src/libs/model-drivers/` | In-process registry + managers + adapters, same interfaces |
| Stub driver + harness | `packages/stage-driver-host/src/testing/` | Fake driver: manifest, manager, runtime, provider, mount, panel, picker, and the **full §5.10 surface** (`migrate`, `transfer`, `export`/`import`, `purge`, `LegacyRestorePayload`) |

No `stage-driver-main`: driver manifests and managers live in the driver packages, and main imports only their DOM-free subpaths (§2 D2). `packages/stage-driver-host` has no Vue dependency. The background entry is added to the renderer MPA inputs beside `index.html`/`beat-sync.html`, uses the shared preload, and does not mount `App.vue`. The Vue-facing host (`packages/stage-ui/src/libs/model-drivers/`) is Phase 2 work (§5.2, §5.9) — Phase 1 ships only the dev-only stub route, so no unreachable UI layer is written in this phase.

### 4.2 Registry and managers (Electron main)

Startup sequence, matching RFC 0002 Appendix A:

1. **Read declarations before executing driver code.** The first-party table names each driver's `manifest` **and** `manager` module loaders; main imports the manifest and validates `id`, `driverVersion`, `contractVersion`, `requirements`, `capabilities`, and that `entry.manager` matches the table's manager subpath. A mismatch is rejected with a readable reason; no manager is created. The table is static, so main never dynamically imports an unchecked specifier.
2. **Load the host state.** Main reads `{userData}/model-drivers/state.json` (`enabled`, cached rows, retention markers) and registers drivers with the persisted enable flags. First run defaults to enabled. Cached rows are a display fallback, not a source of truth.
3. **Create the manager** in main by loading the table's `manager` subpath and calling `createManager(handle)`. `handle` is a `RegistryHandle` with `log`, `requestRenderer` and ordinary registry operations. It has no storage. The manager may request renderer code when it needs data.
4. **Create the broker, the transaction table and the mount registry** in main. The mount registry holds live descriptors only — no records, no probe results, no web storage.
5. **Do not start the background window at boot.** It is created lazily on the first `requestRenderer` call that cannot reuse a live renderer, and lives until shutdown once started (D11).
6. **Broadcast `onChange`** when a driver is enabled, disabled, updated or the manager reports an enumeration change; main replaces that driver's row cache and the host refreshes.

Main holds declarations, cached flags, directly owned managers, the host row cache, mount descriptors, transaction table and the renderer-request routing. It holds **no runtime, no probe result and no web storage of its own**.

### 4.3 Managers

- **Registry-owned.** The registry creates and directly owns exactly one manager per driver.
- **RegistryHandle.** The manager receives `{ log, requestRenderer, listDrivers, isEnabled, onChange }` at creation and no storage:

```ts
// contract addition (C22)
interface RegistryHandle {
  log: HostLogger
  /** Ask the host for a renderer able to run this driver's code. Addressed like a cue. */
  requestRenderer: (request: {
    driverId: ModelDriverId
    surface?: Surface
    purpose?: Purpose
  }) => Promise<RequestRendererResult>
  /** Ordinary registry operations; the manager may use them directly. */
  listDrivers: () => DriverInfo[]
  isEnabled: (driverId: ModelDriverId) => boolean
  onChange: (handler: () => void) => Unsubscribe
}

type RequestRendererResult
  = | { ok: true, channel: ManagerChannel }
    | { ok: false, reason: 'window-unavailable' | 'entry-failed' | 'driver-disabled' | 'shutting-down' }

interface ManagerChannel {
  send: (message: unknown) => void
  onMessage: (handler: (message: unknown) => void) => Unsubscribe
}
```

- **Mount registration.** The registry issues mount ids, so a renderer cannot construct one:

```ts
// registry client supplied to the adapter
registerMount: (request: {
  driverId: ModelDriverId
  surface: Surface
  purpose: Purpose
  windowId: string
}) => Promise<{ ok: true, mountId: MountId } | { ok: false, reason: 'driver-disabled' | 'shutting-down' }>
```

A mount is unaddressable between being created and this response arriving; readiness does not begin before it.
- **Renderer request.** `requestRenderer({ driverId, surface?, purpose? })` reuses a live renderer first — one serving the named surface, then any live renderer — and starts the driver's provider entry there, or reuses that entry when the manager already has a channel to it. With no live renderer able to serve it, it starts the shared background window and runs the entry there. It returns `{ ok: true, channel }` or `{ ok: false, reason }` with a host-owned reason (`window-unavailable`, `entry-failed`, `driver-disabled`, `shutting-down`). A channel that closes later counts as a refusal on the next request and never reaches into the row cache. The host performs no handshake; the driver owns the message format.
- **Rows.** `listModels()` is a pull. The driver may persist an index, keep a cache, or enumerate on demand; the host caches the last successful result for display only, and never overrides `ok:false`.
- **Crash.** A manager failure is a main-process failure; there is no separate window to recreate. On restart, managers are re-created, channels are gone, and the row cache covers the gap until the next successful pull. Any in-flight transaction settles `aborted`.
- **Quit.** The app quits when the last **visible** window closes — the background window is never part of that decision. On shutdown, `deactivate` is called on every active runtime, pending transactions settle `aborted`, managers are released, and the background window is closed explicitly.
- **Ownership.** The registry owns the manager directly on every host. There is no desktop lock, no election protocol and no ownership handoff; Web/Pocket's in-process registry owns its manager under the single-instance assumption (D1).

### 4.4 Broker and transaction table (main)

The broker implements RFC 0002 §4.2, §9.3, §9.6 and §9.7:

1. **Accept:** validate the envelope (known driver, capture alone, bounded cue kinds, a routable target). Malformed → `INVALID_ENVELOPE`, nothing delivered.
2. **Mint the correlation value** from one app-wide counter; record `submitted`; return `{ nonce, settled }` immediately.
3. **Resolve the target:** `{ modelDriverId, surface?, purpose? }` → matching mounts, from the live descriptors in main. A mount that exists but is not ready is queued until ready or deadline. **No matching mount → every slot rejected `NO_TARGET`** (a settled, successful transaction with `handled: false`); `dropIfNotReady` does the same without waiting. The settlement is delivered to the originating adapter; the adapter does not decide it.
4. **Deliver in order per driver**, without waiting for completion.
5. **Manager fan-out:** the manager decides which mounts receive the envelope and how to combine outcomes; the host provides the pipe to each mount's window.
6. **Settle once:** one outcome per cue plus `handled`; late/duplicate acks are discarded.
7. **Deadline:** settles `error` with `timeout`; later acks discarded. The timer runs in main, which is never throttled.
8. **Window gone:** unregister mounts; settle pending `cancelled` if undelivered, `aborted` if delivered.
9. **Withdrawals (C4):** apply to broker-held work first, then the receiver; answer per §9.7. `cancel`/`pop`/`pop-all` never stop a running transaction; `abort`/`abort-current`/`dump` ask the receiver and settle `aborted` or with its own outcome. `abort-current` targets the running transaction only.
10. **Bounds:** cap correlations per request and report entries; a malformed request fails.

State: `nonce → { state, driver, target, deliveredTo[], acknowledgedBy[], deadline, resolution }` plus per-driver queues. In-memory; a host restart settles every pending transaction `aborted`.

### 4.5 Identity, records, rows and markers

| Concern | Implementation |
| :--- | :--- |
| Minting | The **adapter** mints `modelId` and `profileId`, fresh on every new identity; it never adopts a legacy id (D4). The **registry** issues `mountId` on registration (D1). Uniqueness for `mountId` is guaranteed by issuance; `modelId`/`profileId` are random and checked by the adapter against the record store |
| Model record | `HostNamedModelRecord` in the host core's record store (storage port), persisted in IndexedDB under `local:model-drivers/models/{modelId}`. Never holds the binary and never holds the legacy id |
| Profile record | `HostModelProfileRecord` under `local:model-drivers/profiles/{profileId}`; one default profile per import |
| Binding | `extensions.airi.avatar = { driverId, modelId, profileId, prompt? }` beside the frozen `modules.displayModelId` (D4) |
| Rows | The display cache lives in main's `state.json` beside the enabled flags, is written only from a successful pull, and never overrides `ok:false` (§4.3) |
| Prompt | `local:model-drivers/prompt/{driverId}/{modelId}/{profileId}` holds the current publication (text + tokens + version). Archived losers of an arbitration: `local:model-drivers/prompt-archive/{driverId}/{modelId}/{profileId}/{version}`. The card caches the same pair (D5) |
| Pending payload | `PendingModelPayload`: a localforage blob plus `local:model-drivers/pending/{payloadId}` (driver hint, legacy id label, timestamp; no identity) |
| Markers | IndexedDB only: `model-migration/{modelId}` written after the import transaction commits, and `driver-migration/{driverId}` written when every known legacy model of that driver has its marker (D8). `state.json` in main is the **single owner** of `legacy-retention/{driverId}`; the renderer reads it over IPC and never writes it. Shorthand elsewhere omits the `local:model-drivers/markers/` prefix |
| Deletion | `local:model-drivers/deleted/{modelId}` canonical; keep reading the legacy `local:sync-metadata/deleted-models/{id}` during migration |
| Enabled | `{userData}/model-drivers/state.json`; host and renderer caches for UI |

**The binding's shape** (D4). Additive beside the frozen `modules.displayModelId`, and every existing `extensions.airi.*` field stays (D10):

```ts
// packages/stage-ui/src/types/card.schema.ts — AiriAvatarBindingSchema (new)
// absent  ≡ {}    no new-path binding; normal
// non-empty       driverId + modelId + profileId are required together
extensions.airi.avatar =
  | {}
  | {
      driverId: string,
      modelId: string,      // fresh; the new-path binding
      profileId: string,    // driver profile, adapter-minted and -checked
      prompt?: {            // complete portable snapshot of the driver's publication
        modelId: string,
        profileId: string,
        text: string,
        tokens: string[],   // ACT token list — travels with the text, always
        version: number,
        publishedAt: number,
      },
    }
```

### 4.6 Driver storage (renderer only)

- All renderer handles of one driver — provider/runtime, panels and pickers — address the same driver namespace.
- The media are unchanged: a per-driver localforage instance `airi-driver-<driverId>` for payloads and a namespace for small values/keys; the host prefixes and strips keys and `keys()` is scoped. `watch` uses the internal `airi:driver-storage:<driverId>` channel.
- If the manager needs storage, the steps are described in D1.
- Isolation is enforced host-side; concurrency is last-write-wins and the driver's responsibility (RFC §10.2).

### 4.7 Entry resolution and loading

Driver modules stay in the renderer package they belong to, with six subpaths:

```text
packages/stage-ui-three/src/driver/
  manifest.ts     pure data: id, version, requirements, capability hint, entry: { manager }
  manager.ts      DOM-free: createManager(handle), resolveEntrypoint, delivery/withdrawal
  provider.ts     renderer: probe/import/list/remove/preview/profiles/capabilities, and the
                  manager-addressable service that answers requestRenderer
  mount.vue       renderer: the mount component
  panels.vue      renderer: settings/popover panels
  picker.vue      renderer: model picker
```

Subpath exports: `./driver/manifest`, `./driver/manager`, `./driver/provider`, `./driver/mount`, `./driver/panels`, `./driver/picker`.

**Who loads what.** Main imports only `manifest`/`manager` (DOM-free). The renderer never imports `manager`; it imports `provider`/`mount`/`panels`/`picker` through its own loader table. `externalizeDeps.exclude` includes the four renderer packages so main bundles the manager subpath instead of leaving a runtime `require()` of source.

**Resolution.** The manager performs the lookup; the adapter requests it:

1. adapter → registry: `resolveEntrypoint({ driverId, kind, surface, purpose })`;
2. registry → manager (in-process on desktop main): the manager chooses the entry;
3. manager → adapter: `{ specifier }` (for example `@proj-airi/stage-ui-three/driver/mount`);
4. adapter imports the specifier through its build-time loader table and mounts it.

The loader table is generated from the first-party driver list and is the only renderer-side place renderer packages are imported. It also contains the `provider` specifier that `requestRenderer` needs, and a startup test asserts every declared specifier resolves. The adapter makes no entry decision; it imports what the manager named. An unknown specifier is `invalid-entrypoint` with a readable reason.

**No precompiled drivers.** First-party renderer modules are compiled by the normal renderer build. No per-driver build pipeline is introduced. Third-party external specifiers are deferred with the loader.

**Build assertion.** Tree-shaking is a bundler behaviour, not a security boundary, so CI fails if any renderer runtime module (Vue/Three/Pixi, a scene, a store) is reachable from the Electron main entry. Manager modules are also linted to forbid imports of the package index, `.vue` files, Vue, Three or Pixi.

### 4.8 Stub driver and harness

A complete stub is built in this phase:

| Piece | Behaviour |
| :--- | :--- |
| Manifest | Valid 0.1 declaration; `entry: { manager }`; static capabilities; prompt capability declared |
| Manager | `createManager(handle)`; `requestRenderer` + `ManagerChannel`; `listModels` through a renderer pull; `resolveEntrypoint`; delivery/withdrawal with an in-memory queue |
| Runtime | `activate`, `rendererCapabilities`, provider with two-phase import, profiles, preview, capabilities, vocabulary, prompt publication (including empty) |
| Mount | Seven readiness states, `LoadCue`, cue recording, `occupiesPoint`/`hitTest`, capture, failure on demand |
| Panel / picker | Minimal components proving frames, placement and the `select` contract |
| Migration surface | `migrate` per model, retention with **move-import**, `transfer`, `export`/`import`, `purge`, `LegacyRestorePayload` — without these, Phase 2's queue and all of §9.3 have no driver to run against |

Used by broker/registry tests and a dev-only route (`/devtools/model-driver-stub`) that exercises mount → load → cue → cancel → capture across two windows.

### 4.9 Exit criteria

1. `pnpm -F @proj-airi/stage-driver-host test` covers registration/version rejection, manager creation and restart, `RegistryHandle` renderer requests, mount registration and registry-issued ids, channel messaging, row pulls, envelope validation, correlation uniqueness, FIFO, drop, deadline, six withdrawals, window-gone, storage isolation and id minting.
2. With the stub, two windows register mounts; `{ driver, surface:'acting', purpose:'acting' }` reaches only the acting mount; a cue with no matching mount settles `NO_TARGET`; a not-ready mount drops when asked and otherwise waits; closing a window settles `aborted`.
3. Manager restart (main restart) re-creates managers, preserves the row cache, and the next pull requests renderer code again.
4. Backup/restore with the stub brings back catalogue, rows, prompt, the prompt archive and the opaque bundle.
5. No renderer runtime module is reachable from the main entry (build assertion).
6. Legacy `RendererStage` still renders all four formats; no production UI invokes the new host except the dev-only stub route, and no host UI module is shipped in this phase.
7. The background window starts on the first request that needs it, is excluded from the quit decision, keeps its timers at normal cadence, and is closed at shutdown — each asserted. Beat sync is untouched.

---

## 5. Phase 2 — Mounts, host surfaces, prompt and the migration service

**Goal:** the host mounts a driver component on every surface, sends cues, reads readiness, publishes and reconciles prompts, and carries a user-requested migration — proven with the stub while the legacy path keeps rendering.

### 5.1 Surfaces, purposes and windows

RFC 0002 §8.2 fixes surfaces and purposes. The review renames `ACTOR` to `ACTING`.

| Surface | Purpose | Where | Container today | Migrated by |
| :--- | :--- | :--- | :--- | :--- |
| `stage` | `stage` | Control Strip window (`pages/index.vue` → `WidgetStage` → `ControlStripHost`) | `RendererStage` | Phase 3+ per driver |
| `acting` | `acting` | Acting window (`windows/stage`, `/actor`) | `RendererStage` | Phase 3+ |
| `stage` | `chat` | Chat window (`/chat`) | `RendererStage` | Phase 3+ |
| `rehearsal` | `rehearsal` | Rehearsal room tab | `RendererStage` + `ModelCustomizer` | Phase 3+ per driver (`ModelCustomizer` last) |
| `preview` | `preview` | Settings → Models, onboarding finale, calibration, card export | `RendererStage` / four scenes | Phase 3+ |
| — (panel) | — | Settings tab, control-strip popover, card editor inline | per-format panels | Phase 3+ |

A surface is a label, not an identity. A purpose carries meaning; nothing may resolve “the” stage.

### 5.2 MountHost

1. The adapter asks the **registry** for a `mountId` through `registerMount({ driverId, surface, purpose, windowId })`; the registry issues it (D1). A mount is unaddressable until this resolves.
2. The adapter asks the **manager** for the entry: `{ driverId, kind:'mount', surface, purpose }`; the manager returns a specifier; the adapter imports it.
3. The host mounts into a container it owns with `surface`, `purpose`, `paused`, `visible`, `reducedMotion`, `qualityHint`, `interactionMode`, `modelDriverId`, optional `characterId`. **No model prop**; the model arrives by `LoadCue`. **No size prop**; the container is the viewport.
4. The mount registers in the mount registry; readiness updates on `state-change`; unregister on unmount/window close.
5. The host handles **all eight events of RFC §8.5**: `state-change`, `first-frame`, `context-change`, `disposed`, `error`, `hit-area-change`, `animation-finished`, `cue-rejected`.
6. Queries: the creating window calls the live instance; other windows name surface+purpose through the manager (C10).
7. `dispose(shallow|deep)` is the host’s choice; a driver without `dispose` is unmounted.

The host never holds the renderer’s canvas, app, camera or scene graph.

### 5.3 Host features that move off renderer stores

| Feature | Today | After this phase |
| :--- | :--- | :--- |
| Pause/visibility | `stagePaused` + per-renderer props | `paused`/`visible` props |
| Interaction mode | `modelStore.interactionMode` written by `use-control-strip-action.ts` | one prop, gated by declared `interactionModes` |
| Quality | `modelStore.renderScale` | `qualityHint` prop |
| Pointer | four renderers bind their own listeners; three spaces | `RendererPointerService`, one box-relative conversion |
| Capture | `captureFrame`, `airi:stage-capture`, per-format ladders | `capture` cue on the new path; the legacy capture code stays until Phase 8 for reversal |
| Readiness | local `'pending'\|'loading'\|'mounted'` | seven contract states with transition validation |
| Head pose / captions | host draws inside the canvas | `CaptionCue`; the renderer draws its text |

### 5.4 Prompt: publication, snapshot, reconciliation

**Two homes, one authority.** The host prompt store (`local:model-drivers/prompt/{driverId}/{modelId}/{profileId}`) is the **only** input to `buildSystemPrompt`; `HostPromptService` keeps the current publication per `(driver, model, profile)` and AIRI writes the card snapshots from it. The card's `avatar.prompt` is a **complete portable snapshot** — text and tokens together, because they are published together — used to survive import, restore and driver reinstall. There is nowhere in the system where a text exists without its token list.

**Reconciled at activation only.** Import and restore merely *cause* divergence; they never touch the store, because a backup already carries the store and a bare card carries only its own snapshot.

| Card snapshot vs store | Meaning | Injected |
| :--- | :--- | :--- |
| absent, store absent | nothing published | none — a fault if the driver is prompt-capable and activated |
| absent, store present | card is behind | store; card rewritten on its next write |
| present, ids match, store absent | the card is the only copy | seeded to the store at activation (text **and** tokens); the counter is set so the next publication is strictly newer |
| present, ids match, store strictly newer | stale snapshot | store |
| present, ids match, version ≥ store with different content, or equal versions with different text | **conflict** | none until the user arbitrates |
| present, ids ≠ binding | belongs to a different binding | never injected; refreshed when the binding is right again |

**Conflict.** Detected only at activation. While it stands: no model prompt is injected for that binding, the character carries a "prompt conflict" flag — a normal, non-error state that renders less — and the arbitration surface in Settings → Data (§5.10) shows both texts and token lists with version and provenance ("this device" versus "from the card"). The user picks; the winner is written with `version = max(all versions seen) + 1`; the loser is archived **complete** under `local:model-drivers/prompt-archive/{driverId}/{modelId}/{profileId}/{version}` with its provenance and time, and is never deleted. Raised once per distinct version pair, so a driver that republishes on every activation does not nag.

**A publication that is not strictly newer never supersedes the card's surviving copy** — including an empty one. It raises the conflict instead of clobbering, which is what makes the mechanism do anything at all.

**Assembly rule.** `buildSystemPrompt` resolves the binding first and reads only the store; it never reads `avatar.prompt` directly. Staleness is repaired at activation or on the next card write, never inside assembly, because prompt assembly must not mutate character data.

**Switching.** `buildSystemPrompt` switches **per binding**: a migrated binding with a store entry uses it (including an empty one); anything else keeps `acting.modelExpressionPrompt` and the expressions provider until every format has been cut over and its reversal window closes. The provider is deleted only in Phase 8.

- Switching profiles republishes; the prefix-cache cost is accepted and presented to the user.
- **Authorship**: for a migrated character the driver panel owns prompt authoring; the host's prompt generator survives only for legacy-path characters and is deleted in Phase 8.

### 5.5 Speech

- The **adapter** hosts the analyzer where the audio graph lives (ControlStripHost) and publishes `SpeechAnalysisFrame` (~30 Hz, latest-wins); frames propagate adapter-to-adapter as **observation** traffic — BroadcastChannel, no ack, no retention.
- **The one exception.** The Stage-Mate Unity sidecar consumes the same frames over its `stage:vrm` bridge, which lives in main. Speech frames therefore reach main **only** to be relayed to that sidecar: still no ack, no retention, no settlement, and never a cue. This is the single documented main-crossing path (D3).
- The new path consumes `SpeechAnalysisFrame`; `mouthOpenSize`/`currentAudioSource`, host `createLive2DLipSync` and the per-renderer envelope fan-out remain for the legacy path until Phase 8.
- A test asserts no speech frame ever travels as a cue, and that the only main-crossing hop is the sidecar relay.

### 5.6 Selection, panels, and every state a binding can be in

| Concern | Implementation |
| :--- | :--- |
| Driver picker | Mount `entry.picker` in a host dialog frame; props carry the character and current model; `select` returns imported `{ modelId, profileId }`. A builtin is imported first. |
| AIRI picker | Lists persisted rows; warns when a model cannot load; writes the binding anyway. |
| Panels | Host frame + declared chrome (`settings`, `popover`, `inline`); panels edit driver storage or send cues, never host state. |
| Replacement | Persist `extensions.airi.avatar` only — after cutover the host never writes `modules.displayModelId` (D10) — then send `LoadCue`; failure is surfaced, never rolled back silently. The mount survives a model change; only a driver change replaces it. |

**`avatar` states.** The empty object is a state, not a defect, so this table is normative (D4):

| # | Card `avatar` | Resolves | Meaning | Renders | Error | UI |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | absent ≡ `{}`, no `modules.displayModelId` | — | no model was ever chosen | nothing | no | choose a model |
| 2 | absent ≡ `{}`, `modules.displayModelId` present, pre-cutoff | legacy record | still on the legacy path | legacy model | no | migrate |
| 3 | absent ≡ `{}`, `modules.displayModelId` present, post-cutoff | legacy renderer removed | model unavailable; the character is fine | nothing | no | migrate now |
| 4 | all three ids, driver + record + profile resolve | yes | bound, normal | driver model | no | model controls |
| 5 | all three ids, model record absent | record missing | only the model is unavailable | nothing | no | import / choose model |
| 6 | all three ids, driver disabled or absent | driver missing | only the model is unavailable | nothing | no | enable driver |
| 7 | all three ids, profile absent | profile missing | the binding is internally incomplete | nothing | **yes**, driver-reported | choose a profile |
| 8 | some but not all of the three | — | invalid; rejected by schema on load or import | nothing | yes, at load | re-bind |

Rules that follow from it:

1. **Absent ≡ `{}` in every code path.** Both mean "no new-path binding".
2. **Legacy detection keys on the absence of `avatar.modelId`, never on the absence of the object.** Otherwise a legacy card that gains `avatar: {}` on its next save becomes indistinguishable from an unbound migrated card and its cutover silently stops.
3. **The empty object is materialized on the next card write, never on read,** so opening a library does not rewrite every card.
4. **A missing model is not an error; a missing profile is** (row 7). The character holds a reference; losing the referent is normal, an internally inconsistent binding is not.
5. **Avatar and prompt are independent.** Rows 1–3 never suppress a prompt, and a prompt conflict never suppresses an avatar.

`UnavailableModelReason` (`profile-missing` included, C6) supplies the reason behind rows 5–7; it never adds a state of its own.

### 5.7 Preview and authorship

- Catalog and card chips read AIRI’s stored copy; no driver required.
- An import asks the driver for a preview while the model is decoded; failure does not fail the import.
- Drivers get their own preview pipeline; the four host preview generators remain for the legacy path until Phase 8.
- Author travels with the row and is cached; legacy `authorIcon` URLs are fetched or skipped with a warning.

### 5.8 Exit criteria

1. The stub mounts on `acting`, `stage`/`stage`, `stage`/`chat`, `rehearsal` and `preview`; illegal readiness transitions are rejected in dev; every mount id comes from the registry.
2. A cue reaches only the addressed surface/purpose; capture returns bytes in the ack; `NO_TARGET` is a settled unapplied outcome delivered to the originating adapter; cancellation requests behave per the table.
3. A panel renders in settings and the strip popover; a picker returns an imported pair; the AIRI picker binds an unavailable model and offers the right action for each `avatar` state.
4. A stub publication reaches a test card and its snapshot carries text **and** tokens; an empty publication stays empty; a non-migrated format still reads its legacy prompt.
5. **Reconciliation**: a card-only snapshot seeds the store at activation with the next version strictly greater; a store-newer card is refreshed; a card-newer pair raises a conflict, injects nothing, and archives the loser complete on arbitration.
6. Pointer events arrive box-relative for one mount; a second mount is unaffected.
7. Speech frames drive the stub; no frame crosses main except the sidecar relay, and none ever travels as a cue.
8. All legacy behaviour still works; no format is cut over.
9. The migration service runs a fixture library on request: the storage gate blocks a driver that cannot fit, allows it with progressive deletion, converts a character-bound model first, resumes after a kill, parks a failing model on the legacy path with a badge, and reports `N of M`.
10. The VRM architecture spike reports on D-1…D-18 and the mandatory two-mount case, **and gates Phase 3**: its report must confirm the VRM-specific shapes (profiles-as-outfits, capture, `occupiesPoint`, `hitTest`, prompt publication) before any format ships. Its dev-only route is the whole artifact and is deleted in Phase 6.

### 5.9 Migration service

Migration is an action, not a launch-time queue (D13). The service lives in `packages/stage-ui/src/libs/model-drivers/migration.ts` and:

- is started by the user from the post-update screen or Settings → Data, per driver, with an "all drivers" convenience;
- runs in the shared background window on desktop, with `backgroundThrottling: false`, creating the driver's runtime locally so no model byte crosses a process boundary; in the page on Web/Pocket;
- prioritizes models bound to a character, then the rest;
- converts one model per pass, each one a host transaction plus a driver import (§6.5), and resumes from `model-migration/{modelId}` after a crash or quit;
- keeps the legacy path rendering until that model's marker is written;
- applies the storage gate before the driver's first import and enforces progressive deletion only if the user chose it (D17);
- parks a failed model on the legacy path with a "needs attention" badge instead of failing the driver;
- accepts a partial result as a terminal state and reports it as such;
- reports `N of M` in Settings → Data plus one toast.

**The storage gate** (D17). Both modes are budgeted before the driver's first import, and failing it blocks that driver rather than starting a run it cannot finish:

| Mode | Requirement | Basis |
| :--- | :--- | :--- |
| normal (legacy copies kept until the user asks) | free space ≥ the driver's legacy library size | legacy copies (≈L) already exist; the driver adds ≈L |
| progressive (user chose to delete as it goes) | free space ≥ the largest single model's **imported** size | each model's legacy copy is deleted when its own transaction commits |

- **Driver-declared size.** The gate prefers an `estimatedSizeBytes` from the driver's `probe`, because a legacy archive can expand on import (an MMD ZIP with compressed textures is the obvious case). It falls back to the legacy size only when the driver declares nothing.
- **Estimate unavailable.** When `navigator.storage.estimate()` is unavailable, the app **tells the user it cannot measure**, defaults to progressive deletion because that is the smallest footprint, and lets them switch. It never silently guesses.
- **Move-import.** The driver consumes its retained handover payload **by reference**; it must not hold the payload and the imported row as two copies of the same bytes (D-16). Copy census for one model of size S in progressive mode:

| Moment | On disk | Copy-import driver | Move-import driver |
| :--- | :--- | ---: | ---: |
| before migration | legacy record (+`{id}-textures` for MMD) | 1S | 1S |
| handover received, retained | + driver's retained payload | 2S | 2S |
| import executing | + driver's model row, if the import copies | **3S** | 2S |
| import committed, retention dropped | legacy + row | 2S | 2S |
| legacy copy deleted (progressive) | row | 1S | 1S |

**Failure patterns and solutions.**

| # | Pattern | Detected | State left behind | Solution |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Free space below the gate (normal mode) | pre-flight, per driver | nothing imported | block; free space, enable progressive, or cancel |
| 2 | Free space below the gate (progressive) | pre-flight, per driver | nothing imported | same, with the smaller bound |
| 3 | Quota exhausted mid-run despite the gate | the failing model's write | that model stays legacy-shaped; every committed model stands | park the model, report `N of M`, resume when space returns; deletions already made stay made |
| 4 | Quota exhausted inside the driver's own import write | driver | no partial row (driver obligation) | the host transaction never runs; retry after space is freed; a non-atomic driver import is a driver bug surfaced as a warning |
| 5 | Legacy copy deletion fails after commit | deletion step | the copy remains — always the safe direction | retry on the next pass; report the retained bytes so the watermark is visible |
| 6 | Retention plus import exceeds the bound | pre-flight | nothing imported | prevented by the move-import requirement above |
| 7 | A single model can never fit | pre-flight | the driver never completes | report which model and why; it stays legacy until the cutoff; deletion of the rest stays blocked |
| 8 | `navigator.storage.estimate()` unavailable | pre-flight | unknown | tell the user, default to progressive, allow switching |
| 9 | Export needs its own headroom | export | — | stream straight to the file, no temp copy, so a full export does not need another copy of the library |

### 5.10 Migration surfaces

One shared component, three hosts: the post-update screen on the first launch after a driver cutover, the onboarding stepper for a fresh install restoring a pre-contract backup, and Settings → Data.

- The post-update screen is the **entry point** and precedes anything moving: what will change, the storage verdict (and, when it cannot measure, that it cannot), the export offer, and the choice between normal and progressive deletion.
- Onboarding re-runs on update; steps whose values are already configured are skippable and never overwritten, and a dedicated update mode is deferred (D16).
- Settings → Data always shows status, the per-driver state, the deletion action once available, and the prompt arbitration surface (D5).

---

## 6. Phases 3–6 — The four first-party drivers

Order: **Spine → MMD → Live2D → VRM**. Each phase adds one driver, runs the per-model cutover (§6.5) and switches that format’s new path. **No legacy code is deleted in Phases 3–6**: the legacy path stays frozen and functional for the reversal window (D9), and every code deletion is deferred to Phase 8. Host legacy copies are removed only on a user request (D9, §6.5 step 10), never as part of the cutover. A driver change that would break the legacy path is implemented in driver-only code or deferred.

### 6.0 Work every driver must do

| # | Obligation | Why |
| :--- | :--- | :--- |
| D-1 | **Per-instance state.** VRM and Live2D hold one active model in a store singleton; assume Spine/MMD do until audited. | A driver can be mounted several times at once. Implement additively in driver-only code so the legacy path keeps its singleton. |
| D-2 | **`animation-finished` nonce registry.** Completion callbacks are keyed by name/`group#index` today. | The event echoes the transaction correlation; two motions in flight must be distinguishable. |
| D-3 | **Edge-triggered `hit-area-change`.** Current emitters send per-pointer-move payloads or nothing. | RFC §8.5 is edges only, including model-caused changes under a still pointer. |
| D-4 | **`occupiesPoint`.** The helper exists but has no consumer; only VRM answers. | Click-through/fade must not be VRM-only. |
| D-5 | **Box-relative pointer conversion.** Three different spaces today. | One host conversion; the renderer maps onward. |
| D-6 | **Model-scoped storage.** Settings are window-global today. | Two mounts must not overwrite each other. |
| D-7 | **Capability discovery.** Replace host parsing with `modelCapabilities()`. | Host and runtime lists already disagree. |
| D-8 | **Preview.** Move the format’s pipeline into the driver. | AIRI stores a copy; it must not render a format. |
| D-9 | **Profiles.** Represent appearance as driver-owned profiles, and **convert legacy outfits yourself** — the handover carries them opaque and the host does no conversion (D14). `saveProfile` must work with no mount. | RFC §5.2/§7.2; `AiriOutfit` is host data today. |
| D-10 | **Prompt publication.** Publish `(text, tokens, version)` per model/profile at least once (empty allowed), republish on profile change, and stop the host needing authoring UI of its own. | RFC §10.4; replaces the acting prompt. |
| D-11 | **Panel + picker.** Own the format’s settings UI, model list **and prompt authoring**. | RFC §11; replaces per-format host panels and the host prompt generator. |
| D-12 | **Speech subscription.** Consume frames; the legacy mouth prop stays until Phase 8. | RFC §12. |
| D-13 | **Capture, stopAll, dispose.** Implement declared queries. | RFC §8.6. |
| D-14 | **Deactivate / purge / transfer / migrate.** `transfer` is mandatory for first-party drivers — it is the only complete legacy copy once host copies are deleted (§7.1). | RFC §5.10, §10.2. |
| D-15 | **Row query.** Answer `listModels` after import/remove/profile change; whether that uses an index, a cache or on-demand enumeration is the driver’s implementation. | AIRI pulls; there is no row-index contract. |
| D-16 | **Retain the handover and consume it by reference.** Keep the received entry (settings, outfits, prompt, model bytes) in driver storage; drop the byte payload once the import commits; keep a metadata reference so revert can re-emit from the driver's own model storage. The import must **move**, never copy — holding the payload and the row as two copies is a 3S peak (D17). | D8, D14; revert reads from here. |
| D-17 | **Declare prompt capability.** The manifest states whether the driver publishes prompts. A prompt-capable driver must publish at least once per model/profile; an empty publication is valid, no publication is a runtime fault that never blocks migration. | D5. |
| D-18 | **Declare an import size.** `probe` reports an estimated post-import size so the storage gate is not computed from a compressed legacy archive. | D17. |

### 6.1 Phase 3 — Spine

**Driver work**

- Manifest/manager/provider under `stage-ui-spine/src/driver/`; entry returns the Spine mount specifier.
- Mount: `load`, `motion`, `profile`, `expression`, `caption`, `reset`, `capture`; `occupiesPoint`/`hitTest`; no `view`/`effect`.
- Provider: `probe` from the ZIP/skeleton (with `estimatedSizeBytes`), `list`, `remove`, `preview`, `modelCapabilities`, profiles, prompt publication.
- Storage: give the driver its own storage for `settings/spine/*` and placement; the legacy keys remain untouched for reversal.
- Rows: report to the host on every change.
- Migration: accept the per-model handover, retain it, import by reference, implement `LegacyRestorePayload`.

**Host wiring (legacy path preserved)**

- The `avatar` binding selects the new Spine mount; `displayModelId` + the existing branch still select the legacy path.
- `stage-model.ts` keeps its legacy mapping; the new path does not consult it.
- Legacy `selectVariantAndSkin`/`playOneShotAnimation`/`shouldUpdateView` call sites remain for the legacy path; the new path uses `ProfileCue`/`MotionCue`.
- `settings/spine/*`, candidate tables and the `SpineScene` branch stay until Phase 8.

**Exit:** load/act/profile/capture/occupiesPoint on acting + preview; settings survive restart; rows answer through a manager pull; the migration round trip works for a fixture Spine model (retain, import by reference, revert); the legacy Spine path still works; `legacy-retention` written.

### 6.2 Phase 4 — MMD

**Driver work**

- Manifest/manager/provider under `stage-ui-mmd/src/driver/`; `capabilityDiscovery: 'runtime'`; optional caption; no `view`.
- Own the texture companion: `confirmImport` receives all files in one set; resolve relative paths internally. The legacy `{id}-textures` convention stays for the legacy path until Phase 8.
- `probe` uses `validateMMDZip`/`extractMmdFromZip` and declares `estimatedSizeBytes` — the extracted size, not the ZIP's; the 30-morph truncation disappears from the new path.
- Move `MorphSlot`, `MORPH_CANDIDATES`, `EMOTION_MORPHS`, `createMorphController`, `resolveMorphName` into driver-only code; declare the 14 logical slots as expression units.
- Give the driver its own storage for physics/IK/gravity, materials, lights/skybox, camera FOV, placement and custom/deleted motions.
- Migration: retain the handover (ZIP **and** textures), import by reference, implement `LegacyRestorePayload`.

**Host wiring (legacy path preserved)**

- The new path selects the driver mount; the legacy `MMDScene` branch, `texture-map`, `previewExpression`, host stores and `sync-engine.ts` reconciliation remain until Phase 8.
- The host’s `mmdTextureMap` remains the legacy input; the driver resolves its own files.

**Exit:** an MMD ZIP with textures imports/loads through the driver; capabilities match runtime; motion completion; rows answer through a manager pull; the migration round trip works; the legacy path still works; retention written.

### 6.3 Phase 5 — Live2D

**Driver work**

- Manifest/manager/provider under `stage-ui-live2d/src/driver/`; static discovery; `occupiesPoint`/`hitTest`; optional caption; no `view`; requirements declare the Cubism global and OPFS.
- Per-instance model in driver-only code (D-1); the legacy store singleton is untouched.
- Parameter editor, gimmick deck, mappings, DSL actions and **prompt authoring** move into the driver panel. The DSL script is character content: the model-bundled DSL is ignored at load; the host’s dating-sim parser is kept and its verbs become cues. Where the script is stored is tracked in §8.6; it is not a driver blocker. Intimacy is character state.
- Caption: the driver draws its own head-tethered text from `CaptionCue`; no Pixi injection, no `ParamAngleX/Y/Z` reads.
- Pointer: subscribe to `RendererPointerService`; the legacy template/canvas/window listeners remain for the legacy path until Phase 8.
- Lip sync: consume frames; the host `createLive2DLipSync` and the 0..100 mouth prop remain for the legacy path until Phase 8.
- Migration: retain the handover, import by reference, implement `LegacyRestorePayload`; OPFS availability is checked before the gate, not after.

**Host wiring (legacy path preserved)**

- The new path selects the driver mount; the legacy Live2D branch, `HeadTetheredCaption` Pixi path, `live2dSceneRef` chain, channels and ambient bridge remain until Phase 8.
- Remove the host re-export `packages/stage-ui/src/stores/live2d.ts` only in Phase 8.

**Exit:** load/ACT/caption/hit edges/capture/occupiesPoint; profiles survive; settings window restart; rows answer through a manager pull; the migration round trip works; the legacy path still works; retention written.

### 6.4 Phase 6 — VRM

**Driver work**

- Manifest/manager/provider under `stage-ui-three/src/driver/`; runtime discovery; `occupiesPoint`; `dispose`; optional caption; `view` only once a POI set exists.
- Per-instance VRM in driver-only code; the legacy `window.vrm`/`window.expressionManager` remain for the legacy path until Phase 8.
- Give the driver its own storage for camera, transform, render scale, physics, lights/skybox, mesh visibility and custom VRMA; `GazeCue` overrides the pointer; `ResetCue{scope:'view'|'transform'}`.
- Profiles replace `AiriOutfit` + `applyOutfit` on the new path; composition rules are the driver’s (D-9).
- `occupiesPoint` from the render target; `capture` from the canvas.
- V-HACK moves into the driver panel/dev surface on the new path.
- **Stage-Mate migrates as planned** (§5.5): it keeps its placement, receives forwarded cues, and its exit criterion is "Stage-Mate follows".
- Migration: retain the handover (VRM bytes **and** custom VRMA), import by reference, implement `LegacyRestorePayload`.

**Host wiring (legacy path preserved)**

- The new path selects the driver mount; `settings/stage-ui-three/*`, `applyOutfit`, the `airi-stores-live2d` writes, the VRM branch/panels and the viewer refs remain until Phase 8.

**Exit:** load/act/custom VRMA/profile outfit/capture/occupiesPoint; camera/placement survive; Stage-Mate follows; rows answer through a manager pull; the migration round trip works; the legacy path still works; retention written.

### 6.5 Per-model cutover (runs inside each driver phase)

Run per model, character-bound first. Every step is idempotent, and step 5 is a single host transaction so a model is never half-bound.

1. **Reach the model.** The queue selects the next legacy model of the driver, character-bound models first.
2. **Build the per-model handover.** Collected from legacy storage, lazily — one model’s bytes in memory at a time. It carries the legacy label, the legacy metadata, the window-global settings values, the model’s own values, placement, outfits, the legacy prompt, the files (or the URL) and its assets.
3. **Driver `migrate`.** The driver absorbs the entry, **retains it in its own storage**, and reports `retained` plus `unused` keys. A refusal parks the model on the legacy path with a reason; nothing is deleted and the queue continues.
4. **Import round trip.** The adapter mints a **fresh `modelId`** and a default `profileId`; `probe` reports `estimatedSizeBytes`; `confirmImport` runs **without `overwrite`** — the import is the create. On retry, if the driver already has that row, the import is skipped (check-then-skip) and the transaction proceeds. The driver consumes its retained payload **by reference** and drops the byte payload.
5. **Host transaction (one IndexedDB write).** Writes the record from the import result plus the handover metadata, the profile, the prompt snapshot state, `extensions.airi.avatar = { driverId, modelId, profileId }` on **every card whose `modules.displayModelId` equals this model's legacy id**, and `model-migration/{modelId}`.
6. **Prompt.** The handover carries the legacy text; the driver publishes at activation and the last publication becomes the card snapshot (D5, D8).
7. **Binding.** `modules.displayModelId` stays frozen and untouched. The new path reads `avatar.modelId` only.
8. **Placement.** The driver absorbs the `settings/positioning/models` entry; the legacy entry is kept until deletion.
9. **Rows.** The driver makes the new rows answerable to `listModels`; the host cache updates after the next pull.
10. **Completion and deletion.** When every known legacy model has a `model-migration` marker, write `driver-migration/{driverId}`. Progressive deletion has already removed each legacy copy at its own commit; otherwise the copies are offered once per driver in Settings → Data under the §7.3 rules.

**Legacy handover shape.** Host-owned transition type; the contract carries it opaquely. One entry per call, because the offer is per model (D8).

```ts
interface ModelDriverLegacyHandoverEntry {
  schemaVersion: 1
  driverId: ModelDriverId
  createdAt: number
  modelId: ModelId // fresh, adapter-minted, already decided
  legacyModelId: string // the old DisplayModel.id — provenance, and what revert restores
  meta: { name: string, nsfw?: boolean, groups?: string[], tags?: string[], searchKeyInputs?: string[] }
  /** Window-global values at collection time + the model they described. */
  settings: { selectedModelId?: string, values: Record<string, unknown> }
  values?: Record<string, unknown> // per-model settings, raw
  placement?: { x: number, y: number, scale: number }
  outfits?: unknown[] // converted by the driver, never by the host
  prompt?: string // acting.modelExpressionPrompt
  files?: Array<{ name: string, mimeType?: string, bytes: Uint8Array }>
  url?: string // URL/preset models: no bytes to copy
  assets?: Array<{ key: string, mimeType?: string, bytes: Uint8Array, deleted?: boolean }>
}

interface ModelDriverLegacyHandoverReport {
  retained: boolean // the driver kept the payload in its own storage
  unused?: string[] // legacy keys/values the driver did not interpret
  warnings?: string[]
}
```

Included: model bytes, legacy URLs, and the legacy metadata (`meta`) — it is needed because the host record is written from the import result rather than registered beforehand. Excluded: preview and author (host-owned and collected separately) and capability lists (the driver re-derives them). `values`, `outfits`, `files`, `assets` and `prompt` are opaque; the driver interprets them and reports `unused`.

**Revert during the window.** “Revert avatar migration” asks the driver for `LegacyRestorePayload` (C23) and runs the per-character transaction of D9. Two details belong here: the legacy import must recreate the record **under the preserved legacy id**, and `acting.modelExpressionPrompt` is never restored, because nothing changed it.

**Legacy items are held as a whole** (D14). A driver refusal leaves the app usable on the legacy path and the collected payload available for a later attempt.

---

## 7. Phase 7 — Hardening, transfer and the reversal window

**Goal:** while every format’s retention window is open, make backup/restore, device transfer, purge and user-side reversal real. This phase does **not** remove legacy code, and it never deletes legacy data automatically — deletion happens only on a user request (D9).

### 7.1 Backup and restore

- Enumeration includes: host model/profile records, row caches, pending payloads, the prompt store **and the prompt archive**, migration/retention markers, each driver’s `driverTransfer` bundle (mandatory for first-party drivers, D-14 — once host legacy copies are deleted it is the only complete legacy copy), and any legacy copies the user chose to keep.
- **Driver bundles are byte-exact and opaque** (D14). AIRI wraps its own records in an envelope and writes each `driverTransfer` bundle as-is — no parsing, no re-encoding, no validation of the driver’s format. Unrecoverable parts are warnings, not a failed restore, and the driver validates its own bundle on import.
- Export streams straight to the file the user picks — no temporary copy of the library, so a full export does not need its own headroom (§5.9, row 9). This is the one sanctioned byte path across IPC, and it exists only because the user asked for a file.
- A pre-contract backup is read by a versioned legacy reader that imports through the two-phase path and writes deletion markers for what it consumed. The reader lives beside the host core; the cutoff is a named constant with a test that an older bundle is refused with a readable message.
- The round trip — backup on profile A, restore on clean profile B — is an exit criterion here and in Phase 1 with the stub.

### 7.2 Transfer, purge and deactivation

- `purge` deletes every byte the driver persisted; the host clears its records only after success.
- A referenced model/profile is refused with a distinguishable outcome (C11).
- Deactivation stops mounts, releases runtime services, and leaves rows/catalog visible as unavailable.
- A transferred device preserves the ids its packages carry and the adapter checks them (D18); an id conflict is resolved by the user, never silently.

### 7.3 Retention and reversal

For each format, after its cutover release:

- `legacy-retention/{driverId}` in `state.json` records `{ cutoverVersion, removeAfterRelease }`, where `removeAfterRelease` is at least three published releases after the cutover version.
- The legacy render path stays in the build and is never written by new code. `modules.displayModelId` stays frozen except for the revert transaction (D10).
- **“Revert avatar migration”** (per driver, Settings → Data) and **“Use legacy model”** (per character, while the window is open) are the two surfaces that run the D9 transaction; driver data is kept so the character can be migrated again.
- **Legacy copies are deleted only on a user prompt**, showing the size, what is removed and the downgrade consequence, with a second confirmation repeating both. Declining keeps them and leaves the action available; the action is unavailable while any character still renders that driver on the legacy path, and it names those characters.
- **“Migrate again”** is available for a reverted character while the window is open: it re-runs the cutover against the driver’s retained handover and restores the `avatar` binding. Reversal and re-migration are both explicit user actions.
- A downgraded build cannot render a model whose host legacy copies were deleted, because it cannot ask the driver (D15). This is the one guarantee the design gives up and it is stated in the prompt.
- Card-field cleanup follows D10 and remains a separate, per-character explicit request; it is never part of the deletion prompt.

### 7.4 Pending payloads and two stores

- A model the user did not confirm becomes a `PendingModelPayload`: listed under the character, importable later, no identity, legacy id as a label.
- Legacy models under legacy ids, pending payloads and driver rows appear in one list; each model has exactly one owning source.
- A legacy reference resolves by exact id, then the alias table, then the user. An unresolved reference is cleared, never presented as `model-missing` (RFC §13.2).

### 7.5 Web, Pocket and quota

- The same cutover and reversal run on Pocket with a smaller quota and without OPFS everywhere.
- The storage gate (D17) runs in both modes; when the estimate is unavailable the user is told and progressive deletion is the default.
- Re-import copies one model at a time; on a shortfall skip with a warning and keep it legacy-shaped. Legacy data is retained, so a skipped model is not a loss, and a partial result is an accepted terminal state (D13).

### 7.6 Exit criteria

1. A clean-profile restore brings back catalogue, prompt, the prompt archive, profiles, pending payloads and driver bundles; retained legacy copies are present until the user answers the deletion prompt.
2. “Revert avatar migration” restores legacy rendering for a test character through the driver round trip, including after the host legacy copies were deleted, and can be re-migrated.
3. A simulated downgrade build renders while host legacy copies remain, and fails with a readable reason once they were deleted — the documented consequence of D15.
4. A pre-contract backup restores through the legacy reader and writes deletion markers.
5. Referenced-model removal is refused; purge succeeds once references are cleared.
6. Declining the deletion prompt keeps the copies and leaves the action available; accepting removes them and a later revert still succeeds through the driver.
7. The deletion prompt is unavailable while a character is on that driver’s legacy path, and it names that character.
8. An export of a full library produces a byte-identical driver bundle on a device with less free space than the library, because nothing is copied before the write.

---

## 8. Phase 8 — Final removal

**Goal:** remove the legacy renderer, code and data only after every format has passed its cutoff. This is the point of no return and the last phase. **The migration collector is not removed** — see §8.6.

### 8.1 Cutoff conditions

All must hold:

1. every format’s cutoff has passed: `legacy-retention/{driverId}` exists for installs that had legacy data, and `removeAfterRelease` is at least three published releases after the cutover;
2. the repository has published those releases — a fact checked at PR time against release history, never derived from per-user state, because a fresh install has no retention record at all;
3. a backup created after Phase 7 exists, including driver bundles and records;
4. the release notes state that un-migrated avatars are unavailable and how to migrate.

Whether the user already deleted the host legacy copies is **not** a condition: deletion is offered per driver, is never required before removal, and a user who never answered keeps their copies until they do.

**Removal is cutoff-based, not opt-in-based** (D13). At the cutoff the renderer is gone, so a character with no `avatar.modelId` is simply one with an unavailable model — never a dropped character, never lost card data.

### 8.2 Deferred per-format deletions

Nothing was deleted in Phases 3–6 (D9). Phase 8 removes, per format:

| Format | Delete |
| :--- | :--- |
| Spine | binary-skeleton candidate tables + byte scan; `"Variant [Skin]"` composition; `spine:...` key parsing; `SpineScene` branch; `selectVariantAndSkin`/`playOneShotAnimation`/`shouldUpdateView` call sites; `settings/spine/*` host stores |
| MMD | PMX regex parse + 30-morph cap; hardcoded motion list; `mmdTextureMap`; `settings/mmd/*` host stores; `sync-engine.ts` raw MMD reconciliation; `MMDScene` branch; `texture-map`/`previewExpression` props |
| Live2D | zip/cp437/OPFS imports; capability parsers; multi-model repair; `live2d.vue`/`live2d-customization.vue`; `LHackerPanel` host mount; Live2D branch; `HeadTetheredCaption` Pixi path; `live2dSceneRef` chain; `airi-stores-stage-ui-live2d*` channels; ambient-motion bridge; host `createLive2DLipSync`; `stores/live2d.ts` re-export |
| VRM | glTF chunk parser; preview import; `settings/stage-ui-three/*`; `applyOutfit`/`AiriOutfit` host handling; `airi-stores-live2d` writes; trigger call sites; `ModelCustomizer`, `WardrobeMeshTreeNode`, `vrm.vue`, `vrm-expressions.vue`, `HackerPanel` host mount; `vrmViewerRef`; `playStatus`; `binaryLoaded`; `vrm-instance-cache.ts` |

### 8.3 Shared deletions

Phase 8 then removes the shared seams:

| Area | Delete | Replaced by |
| :--- | :--- | :--- |
| Format taxonomy | `DisplayModelFormat` (7 values), `DisplayModel`, `DisplayModelFile/URL/Cloud`, `display-models.ts` (2,375 lines) | `HostNamedModelRecord`, `HostModelProfileRecord`, `ModelSummary`, `PendingModelPayload` |
| Selection | `stageModelRenderer`, `StageModelRenderer`, `settings/stage/model` | `CharacterModelBinding` + `LoadCue` |
| Capability parsing | glTF chunk scan, Live2D `.exp3` scan, Spine candidate tables + byte scan, PMX regex cap, `libs/character/model-capabilities.ts` | `provider.modelCapabilities()` + vocabulary |
| Preview | four preview utils’ host imports, `regenerateDisplayModelPreview` dispatch | `provider.preview()`, stored copy |
| Assets | `{id}-textures`, `mmdTextureMap`, host blob URL ownership | driver storage + `LoadCue` |
| Per-format UI | `ModelCustomizer.vue`, `WardrobeMeshTreeNode.vue`, `vrm.vue`, `vrm-expressions.vue`, `live2d.vue`, `live2d-customization.vue`, `mmd.vue`, `spine.vue`, `ModelSceneSettings.vue`, `ModelPromptGeneratorModal.vue` | driver panels, including prompt authoring |
| Picker | `model-selector.vue` per-format intake/report/repair branches | driver pickers + `probe`/`confirmImport` |
| Stores | five renderer BroadcastChannels, `packages/stage-ui/src/stores/live2d.ts`, `stores/settings/{live2d,spine,mmd}.ts` (VRM keys live in the renderer store, not a host settings store) | `HostServices`, cues, panels, driver storage |
| Speech | `mouthOpenSize`, `currentAudioSource`, host `createLive2DLipSync`, envelope fan-out | `SpeechAnalysisFrame` + driver subscription (the sidecar relay stays — §5.5) |
| Captions | `HeadTetheredCaption.vue` Pixi injection, `HeadTetheredCanvas2D.vue` in-canvas drawing, `getHeadPose`, `HeadPose` | `CaptionCue` |
| Capture | `captureFrame`, `readRenderTargetRegionAtClientPoint`, `airi:stage-capture`, stubbed sites | `capture` cue + `occupiesPoint` |
| Motion | `playStatus`, `binaryLoaded`, `vrm-instance-cache.ts`, `shouldUpdateView`, per-renderer trigger APIs | `ActCue`, `MotionCue`, `EffectCue`, `ProfileCue`, `ResetCue` |

**Kept per D10:** `cueAllowlist`, `compiledWhitelist`, `active_state.active_expressions`, `AiriOutfit.meshes`/`expressions`, `acting.modelExpressionPrompt`. They stay inert; a user-requested cleanup may remove them later.

### 8.4 Legacy data deletion

After the cutoff conditions:

- remove whatever remains of the legacy model records and bytes, `{id}-textures`, per-format settings and `settings/positioning/models` entries (a driver whose copies the user deleted has nothing left here); remove migration-only staging copies, but **keep** the card's `acting.modelExpressionPrompt` and every other card field per D10;
- keep the durable deletion markers and `driver-*` migration/retention markers;
- keep card fields per D10;
- **keep the migration collector** (§8.6) — it is not one-time code, it is the only bridge a late user has.

### 8.5 Architecture guards

Vitest source scans. Each guard lands in the phase that creates the invariant it protects, with its allowlist, and the allowlist only ever shrinks. A guard whose allowlist is empty is absolute from the phase it lands in.

**Mechanics.** The forbidden patterns live in exactly one exempt data file (`scripts/architecture-guards/legacy-patterns.json`) — a guard that contains `airi-stores-` would otherwise fail its own scan. That file is the only file permitted to contain the patterns. The per-phase allowlist is **generated once** by a scan at Phase 2 start, frozen with `{ path, patterns, removedInPhase }` per entry, and every guard asserts three things: nothing outside the list, the list only ever shrinks, and no file but the patterns file contains a pattern.

1. No host import of a renderer package outside the driver subpaths (`driver/manifest`, `driver/manager` in main; `driver/provider`, `driver/mount`, `driver/panels`, `driver/picker` in the loader table) and devtools.
2. No `display-model-` outside the migration module.
3. No `airi-stores-` outside the allowlist (the renderer store modules and the host files that subscribe — `ControlStripHost.vue`, `RendererStage.vue`, `airi-card.ts`, `chat.ts`; §A.4, §8.3).
4. No host reads of `settings/(stage-ui-three|live2d|spine|mmd|positioning)/` outside the allowlist (`stores/settings/{live2d,spine,mmd}.ts`, the VRM keys in the renderer store, the per-format panels).
5. No `captureFrame`, `getHeadPose`, `HeadPose`, `live2dApp`, `vrmViewerRef`, `texture-map`, `preview-expression`, `mouthOpenSize` outside the allowlist (`RendererStage.vue`, `HeadTethered*.vue`, `ControlStripHost.vue`).
6. Host core has no Vue/Electron/Pinia dependency.
7. The contract has no format strings; runtime values are limited to contract constants/validators (`MODEL_DRIVER_CONTRACT_VERSION`, `READINESS_TRANSITIONS`, `isReady`, validators).
8. **Main bundle assertion:** no renderer runtime module is reachable from the Electron main entry (lands with Phase 1).
9. **No host file outside the migration module and the revert module writes `modules.displayModelId`**; nothing anywhere writes `acting.modelExpressionPrompt` for a migrated character. Stated as a path allowlist, never as a temporal predicate, so it is checkable from Phase 2 (D10).
10. **Speech transport:** no speech frame travels as a cue, and the only main-crossing hop is the Stage-Mate sidecar relay (lands with Phase 2, §5.5).

### 8.6 One-time code expiry and docs

- **The migration collector stays.** The legacy reader, the per-driver key table and the handover builder are not deleted one release after removal: they are bytes-in/bytes-out, they cost almost nothing, and they are the only path a late user has to their still-on-disk legacy items. What is deleted with the renderer is everything that *interprets* or *displays* legacy data.
- Catalogs move with the change, not with this phase: `docs/data-catalog.md` (every new key in the phase that writes it), `docs/project-testing-parity.md` (every new suite in the phase that adds it), `docs/rosetta-stone.md` (when a canonical entry point moves, first in Phase 2), and `airi-character-rendering` (repoint paths; add `airi-model-driver-host` when Phase 2 lands). The remaining Phase 8 edits are only the ones the removals themselves cause.
- Deferred, not smuggled in: card-level profile/expression storage (D10 keeps fields until a user cleanup), the card script schema (the dating-sim parser keeps verbs working; where the script is stored is a follow-up, not a driver blocker), Stage-Mate as a second VRM mount, third-party packaging, a runtime loader, and consolidating beat sync into the background renderer.

### 8.7 Exit criteria

1. Every guard passes; `stage-ui`, `stage-pages`, each renderer package typecheck; `stage-tamagotchi` builds (includes typecheck); `stage-web` builds and its workspace typecheck runs separately.
2. A clean profile imports one model of each format, binds it, renders on acting + chat + settings preview, restarts, and sees the same result.
3. No legacy path remains; no host file reads a renderer store or names a format, outside the guarded allowlists.
4. A character whose model was never migrated is unavailable rather than broken, offers "migrate now", still migrates correctly through the retained collector, and no card data is lost.
5. The prompt store, card snapshots and the prompt archive are all still readable, and no publication was lost by the removal.

---

## 9. Testing and validation

### 9.1 Contract and host core (CI)

| Suite | Asserts |
| :--- | :--- |
| `stage-renderer-sdk/src/validate.test.ts` | manifest, compatibility, capability completeness, envelope rules, ack shape, mandatory/empty publication (text **and** tokens), prompt capability, the no-publication fault, stale publication |
| `stage-driver-host/src/registry.test.ts` | declaration registration, version rejection, manager creation/restart, `RegistryHandle` renderer request, each refusal reason, registry-issued mount ids, channel messaging, row pulls, enable/disable |
| `stage-driver-host/src/broker.test.ts` | accept→settle, correlation uniqueness, FIFO, drop, deadline/late ack, six withdrawals, `NO_TARGET` delivered to the originating adapter, window-gone, bounds |
| `stage-driver-host/src/transport.test.ts` | speech frames are observation-only, never a cue, and the only main crossing is the sidecar relay |
| `stage-driver-host/src/storage.test.ts` | renderer namespace isolation, `keys()` scope, `watch`, concurrent writes |
| `stage-driver-host/src/entry.test.ts` | manager-performed entry lookup, specifier returned, every declared `provider` specifier resolves, unknown key → `invalid-entrypoint` |
| `stage-driver-host/src/stub-driver.test.ts` | stub through every host rule, failing mount, refusing cue, migration surface |
| `stage-ui/src/libs/model-drivers/*.test.ts` | records, binding write/clear, the `avatar` state table, frozen legacy fields, prompt store + snapshot + seed + conflict + archive, the storage gate, the migration transaction (priority, resume, park-on-failure, partial), the deletion action, reversal, retention read from `state.json` |
| Architecture guards (§8.5) | source scans against the generated allowlist, the shrinking assertion, the patterns-file exemption, and the main bundle assertion |

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/stage-renderer-sdk test
pnpm -F @proj-airi/stage-driver-host test
pnpm -F @proj-airi/stage-ui typecheck
```

### 9.2 Per-driver smoke

§9.2 is the proof that a driver *draws*; it is not the proof that it behaves. Each driver phase also ships one automated harness against a fake backend, because the obligations most likely to break are logic, not pixels: per-instance state (D-1), edge-triggered `hit-area-change` (D-3), `occupiesPoint` (D-4), box-relative pointer (D-5), profiles without a mount (D-9), move-import (D-16), row queries (D-15).

The automated harness covers load → ready → act → capture and the mandatory two-mount isolation. Manual or E2E covers:

1. Load by cue; `ready-for-model` → `loading-model` → `model-loaded`; `first-frame` hides loading.
2. ACT/expression/motion (`animation-finished`)/effect where declared.
3. Profile switch; restart; profile persists.
4. Caption with sentence timing where declared.
5. Capture in the ack; refused capture is a rejected outcome.
6. `hitTest`/`occupiesPoint` where declared.
7. Pause/visibility; `dispose(shallow)` then remount; `dispose(deep)` on model switch.
8. Cross-window cue: `{ surface:'acting', purpose:'acting' }` affects only the acting mount.
9. Two mounts of the same model (acting + preview) do not bleed state.
10. Rehearsal panel/token insertion.
11. Revert: “Use legacy model” restores the legacy path through the driver round trip, including after the host legacy copies were deleted; re-migrate returns to the driver.
12. Rows answer a manager pull after import/remove/profile change; a manager restart preserves the cache and requests renderer code again.

### 9.3 Migration and retention tests

- Fixture `DisplayModel` of each format: fresh identity, the legacy label preserved, preview, handover with bytes, byte ownership, marker writes, retained handover.
- The full round trip: handover carries the bytes, the driver retains them via move-import, the ordinary import stores them **without** `overwrite`, and a later `LegacyRestorePayload` returns the same bytes and the legacy id.
- Crash between `confirmImport` and the marker; re-run; check-then-skip; idempotent, no duplicate.
- Driver refusal: parked on the legacy path, nothing deleted, queue continues.
- `retained: false` blocks `model-migration/{modelId}` and nothing is deleted.
- Prompt: a handover with legacy text produces a publication and a card snapshot carrying tokens; one without produces a valid empty publication and still migrates.
- Storage: the gate blocks a normal run that does not fit; allows the same driver in progressive mode; the estimate-unavailable path tells the user and defaults to progressive; a mid-run shortfall leaves committed models committed.
- Three-release simulation: a build at `removeAfterRelease - 1` refuses removal; a build at cutoff allows it.
- Reversal: revert through the round trip after the host copies were deleted, re-migrate, and a downgrade failing readably.
- The deletion action: declined keeps the copies and stays available; accepted removes them; unavailable while a character is on the driver's legacy path.
- Backup round trip with driver bundles (mandatory `transfer`), the prompt archive, and any retained legacy copies.
- Quota shortfall: a skipped model stays legacy and retryable.

### 9.4 Builds

- Phase: affected workspace typechecks; `stage-tamagotchi build` (includes typecheck) and `stage-web build` when main/routing/packaging changes.
- Main bundle assertion runs with every main build.
- Catalogs update in the phase that changes them: a phase that adds a storage key or a suite without updating `docs/data-catalog.md` / `docs/project-testing-parity.md` is incomplete, not deferred to Phase 8.
- `pnpm lint:fix` is not validation; if used, review the whole diff.

### 9.5 Not CI-testable

WebGL/WebGPU, Cubism, Spine, audio devices, multi-monitor DPI and Electron window behaviour are manual smoke targets; §9.2 is the proof that a driver draws.

---

## 10. Risk register

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Host row cache drifts from manager state | Catalog falls back to a stale row | Manager pull is authoritative; cache is display-only; `ok:false` never read as “no models” |
| Manager renderer request refused or unavailable | `listModels` cannot answer | A live renderer first, the shared background window as fallback; each refusal reason is surfaced to the UI caller |
| Background window dies | Channel closes; catalogue falls back to cache | Manager requests another renderer on the next pull; the row cache is display-only; no host crash |
| Background window pins the app open | App never quits after the visible windows close | The quit decision counts **visible windows only**; the background window is closed explicitly at shutdown (D11) |
| Background window's timers are throttled | Migration appears frozen for the largest libraries | `backgroundThrottling: false` on that window; migration is long-lived work there, so the old "no long-lived timers" rule is retired |
| Background window's storage origin differs in packaged builds | Driver storage reads empty in production | §1.5 states one origin; verify a known driver key round-trips in dev and packaged builds before Phase 3 |
| Manager/runtime message protocol drifts | Driver-defined messages fail to parse | Host transports opaque messages; the driver owns versioning and reports its own failure |
| Manager subpath pulls renderer UI into main | Main bundle bloat/crash | `externalizeDeps.exclude` + DOM-free manager lint + CI bundle assertion |
| Runtime specifier not in the renderer loader | `invalid-entrypoint` at mount | First-party loader table is generated from the same driver list; a startup test resolves every declared `provider`/`mount`/`panels`/`picker` entry |
| Tree-shaking is not a boundary | Renderer code leaks into main later | Build assertion fails the build, not a convention |
| Two homes for the prompt disagree | A character renders with the wrong expression guidance | Store is the only assembly input; reconciliation at activation; a disagreement is arbitrated by the user, never silently resolved (D5) |
| A prompt conflict is never arbitrated | A migrated character runs without a model prompt indefinitely | Flagged on the character and in Settings → Data; nothing is lost; the driver's next publication can settle it; the state is visible, never silent |
| An empty publication and a missing publication look alike | A driver bug reads as a deliberate empty prompt | Empty is stored as an entry; missing is a fault; the two are distinct states in the store and in the panel |
| Card snapshot does not survive a restore | An authored prompt is lost | The snapshot is complete (text + tokens) and seeds the store at activation; the store itself is in the backup |
| Legacy copies occupy disk until the user answers | Disk pressure on large libraries | The action shows the size and what is freed; progressive mode removes each copy at its own commit; the driver's `driverTransfer` bundle is the fallback copy |
| Storage gate passes, run still fails | A split library | Accepted as a terminal state (D13); the gate blocks what it can predict; committed models stand; the rest stay legacy |
| Gate is computed from compressed legacy bytes | A run fails on expansion (MMD textures) | The gate prefers the driver's declared `estimatedSizeBytes` (D-18) |
| A driver copies instead of moving the payload | 3S peak during import | Move-import is a required driver property (D-16, D17) and a per-driver exit criterion |
| `storage.estimate()` unavailable | The user cannot know whether it fits | Tell the user, default to progressive deletion, allow switching (D17) |
| A card arrives naming a profile this device lacks | A character cannot bind | Driver reports `profile-missing`; the view requires the user to choose a profile (D4 row 7) |
| Fresh ids leave the frozen field stale | Revert would restore the wrong model | Revert writes `modules.displayModelId` from the payload; the assert-and-refuse design was rejected (D9, D10) |
| Revert runs while the driver has no payload | Half a revert | The transaction refuses before it starts if the model has no legacy origin or no retained payload |
| A model never transfers (quota, permanent refusal) | Driver never completes; deletion blocked | Accepted: incomplete drivers never reach the deletion action; the legacy path serves until the cutoff |
| User never migrates | Avatar unavailable after the cutoff | Stated in the screen and the release notes; "migrate now" stays available; the collector never expires; the user bears the cost (D9, D13) |
| Legacy copies deleted while a character still renders the legacy path | Stranded character | The deletion action is unavailable until that character is migrated, and it names the character |
| Per-instance driver state | Two mounts overwrite each other | D-1 is a per-driver exit criterion; preview is the mandatory second mount in the automated harness |
| Stage-Mate diverges | Two avatars disagree | Own placement, forwarded cues, speech frames relayed through main as the single documented exception (§5.5); VRM exit includes "Stage-Mate follows" |

---

## 11. Definition of done — program summary

Each phase's exit criteria are that phase's Definition of Done and its gate (the approval boundary at the top of this document). The checklist below is the program summary: it is satisfied only after Phase 8 and is not a gate for any single phase.

- [ ] RFC 0002 maps 1:1 to contract symbols — and the RFC amendment has landed, so the map is true rather than aspirational.
- [ ] Registry-owned managers in main + `RegistryHandle` + registry-issued mount ids + cue-shaped `requestRenderer` with refusal reasons + host row cache + broker + mount descriptors + adapter/loader + web storage exist and are used by every format.
- [ ] Four drivers implement manifest, manager, runtime, provider, mount, panel, picker, storage, profiles, prompt, preview, speech, declared queries and row queries — including move-import and a declared import size.
- [ ] Every surface (acting, stage/stage, stage/chat, rehearsal, preview, onboarding, card export) mounts through the driver path.
- [ ] Cues, acks, refusals, failures, drops, deadlines, cancellations, `NO_TARGET` and window-gone settle per RFC.
- [ ] The prompt has one authority, one snapshot, and a user-arbitrated disagreement; no publication is ever discarded.
- [ ] The empty `avatar` is a valid state everywhere, and no missing model is ever reported as an error.
- [ ] No host file imports a renderer UI module; no host file names a format outside a shrinking allowlist; guards + main bundle assertion prove it.
- [ ] Models, previews, annotations, settings, placement, outfits-as-profiles and prompts survive migration; retries resume; crashes resume; a partial result is reported honestly.
- [ ] Reversal works through the driver round trip for at least three releases; deleting host legacy copies is user-prompted, never automatic; final removal is cutoff-based and gated.
- [ ] Web/Pocket pass the same smoke list minus desktop-only surfaces, under the storage gate.
- [ ] Docs, data catalog, test parity, Rosetta Stone and the relevant skill updated; the collector is explicitly listed as permanent, not scheduled for deletion.

---

## Appendix A — Current host/renderer coupling inventory

Scope: `packages/stage-ui`, `packages/stage-pages`, `packages/stage-layouts`, `apps/stage-tamagotchi`, `apps/stage-web`, `apps/stage-pocket`, excluding `node_modules`/`dist`.

### A.1 Static imports of renderer packages (75 files/packages, grouped)

| Area | Files | Imported |
| :--- | :--- | :--- |
| stage-ui scenes | `RendererStage.vue:3-6`; `scenes/index.ts:8`; `HeadTetheredCaption.vue:2-6`; `ControlStripHost.vue:15-18` | 4 scenes + 4 stores + Live2D caption attach + VRM trace |
| stage-ui stores | `stores/live2d.ts:1`; `display-models.ts:1,10-15,26-27,59`; `sync-engine.ts:1577,1778`; `dating-sim.ts:721`; `airi-card.ts:8-10,889`; `discord.ts:25-26`; `context-providers/expressions.ts:4-5` | stores, preview utils, loaders, VFX, capability types |
| stage-ui composables | `use-idle-animations.ts:1-2`; `use-expression-curation.ts:5-8`; `use-data-maintenance.ts:12`; `use-control-strip-action.ts:1`; `use-live2d-stage-ambient-motion.ts:11` | four stores, animation options, motion control |
| stage-ui settings | `model-settings/index.vue:4-5,31-34`; `vrm.vue:2`; `vrm-expressions.vue:2`; `spine.vue:2`; `mmd.vue:2`; `live2d.vue:2-3`; `live2d-customization.vue:2`; `LHackerPanel.vue:7`; `HackerPanel.vue:4`; `ModelCustomizer.vue:2-3,14-17`; `WardrobeMeshTreeNode.vue:2` | panels, capability types, OPFS |
| stage-ui other UI | `ControlStrip.vue:4-7`; `EmotionCalibrationStudio.vue:4-7`; `selective-sync-panel.vue:2-3`; `model-selector.vue:2,6-9`; `Live2DReportModal.vue:2`; `step-finale.vue:2` | stores, validators, extractors, animations |
| stage-pages | `useActingCapabilities.ts:4-8`; `use-card-export.ts:474-475,484-485`; `CardEditorForm.vue:7-11`; `beat-sync.vue:2-4`; `flowmdm.vue:4` | four stores, preview, beat sync |
| apps | tamagotchi: `chat_rehearsal.vue:5-8`; `pages/index.vue:15-16,22`; `stage-vfx.vue:7,12`; `devtools/live2d.vue:6,10`; `generate-motion.ts:3`; `stage-three-runtime-trace.ts:17`; `stage-three-runtime-diagnostics.ts:13,28`. web: `performance-playground.vue:5-6`; `model-driver-mediapipe.vue:6-7`; `devtools/live2d.vue:5`; `polaroid.vue:2`. pocket: `performance-playground.vue:5-6`; `polaroid.vue:2` | stores, scenes, animations, trace |
| build metadata | `stage-ui/package.json:94-97`; `stage-pages/package.json:35-37`; `stage-tamagotchi/package.json:59-61`; `electron.vite.config.ts:174-175,213`; `tsconfig.web.json:30,33`; `stage-web/package.json:37`; `stage-pocket/package.json:50` | deps, aliases, TS paths |

### A.2 Format-branch hotspots (12 representative of 117 rows)

| Anchor | Branch |
| :--- | :--- |
| `stores/settings/stage-model.ts:11,138-156,200-209,262-280` | renderer union + three format switches |
| `display-models.ts:29-37,665-770,773-1160,1197-1231,1244-1250,1515-1580,1946-2285` | enum; Spine repair; Live2D split; preview; capability parsers |
| `RendererStage.vue:112,156-163,167-169,179-213,455-555,567-580` | ambient, canvas, capture, four mounts, caption/radial refs |
| `ControlStripHost.vue:270-424,1130-1132` | four-way emotion/motion routing; MMD texture prefetch |
| `model-settings/index.vue:92,131-137,158,203-260,333-362` | Y negation, capture, preview scenes, panels, hack panels |
| `ModelCustomizer.vue:83-96,103-126,360-372,395-446,790-848,929-948,1019-1027,1087-1126` | format map, gates, active state, triggers, VFX, idle prefixes, tabs |
| `EmotionCalibrationStudio.vue:125-156,251-260,349-373,667-670,1048` | triple fallback, vocabularies, triggers, VRM-only framing |
| `ControlStrip.vue:142-149,958-1148,2614` | filter, motion/expression lists, play/clear, wardrobe |
| `model-selector.vue:56-80,104,222-233,367-387,450-498,730-828` | label map, filter, counts, per-format import |
| `use-idle-animations.ts:19-40`; `use-expression-curation.ts:288-318`; `use-data-maintenance.ts:296,593` | idle, preview, ZIP allow-list |
| `airi-card.ts:876-894`; `discord.ts:1550-1556`; `dating-sim.ts:721-751` | mappings, selfie, mood |
| onboarding `step-vessel.vue:93-111,144,379-419`; `step-finale.vue:56-58,128-155`; `useStarterCardCommit.ts:298-308`; VFX/VRMA/MMD type files | format UI, demo, 2D/3D classification, binary vocabulary |

### A.3 Renderer-store reach-ins (74, grouped)

| File | Stores |
| :--- | :--- |
| `ControlStrip.vue:489-495,945,958-1148` | all four — pickers |
| `ControlStripHost.vue:102-104,163-173,217-422,1788-1789,1960` | all four — cue routing, reloads, thinking motion |
| `ModelCustomizer.vue:69-72,119-165,263-372,396-399,430-441,642-749,791-948` | all four + Live2D VM/params |
| `RendererStage.vue:106-109,145,361-372,479-547` | VRM/MMD/Live2D — scale, interaction, dating-sim writes |
| `airi-card.ts:456-457,831-894,1432-1468` | Live2D/Spine/VRM — card sync, outfits |
| `use-expression-curation.ts:64-67,289-316`; `use-idle-animations.ts:9,30-37`; `use-control-strip-action.ts:45-93` | all four — preview/idle/interaction |
| `EmotionCalibrationStudio.vue:98-102,355-372,667-670`; per-format panels (`vrm`, `vrm-expressions`, `live2d`, `live2d-customization`, `mmd`, `spine`, hack panels) | per-format settings |
| `chat_rehearsal.vue:53-56,396-415,686`; `pages/index.vue:87,129-130,679-768`; `generate-motion.ts:79-105` | app stages/tools |
| `CardEditorForm.vue:125-141,638`; `useActingCapabilities.ts:52-67,135`; `use-card-export.ts:477-488`; `flowmdm.vue:56` | card editor/providers |
| `sync-engine.ts:1589,1780-1781`; `selective-sync-panel.vue:378-462`; `use-data-maintenance.ts:783` | sync/reset |

### A.4 Channels carrying renderer state (17 names)

| Channel | Publishers → subscribers |
| :--- | :--- |
| `airi-stage-model-ready` | RendererStage/acting window → App startup gate |
| `airi:stage-capture` | strip/card grid/Discord → RendererStage capture |
| `airi:stage-selfie-viewfinder` | strip/card grid → acting window |
| `airi-caption-overlay` | speech/caption producers → caption panel, head-tethered, dating sim |
| `airi-chat-stream` | chat session → captions |
| `airi-chat-present` | ControlStripHost |
| `airi-speaking-state` | ControlStripHost → acting/chat/rehearsal mouths, `chat.ts` |
| `airi-control-strip-actions` | customizer/strip → stage pages |
| `airi:display-models-sync` | `display-models.ts` across windows |
| `live2d-dsl-bridge`, `dating-sim-sync` | dating sim ↔ Live2D |
| `airi::stage-three-runtime-trace` | VRM trace bridge |
| `airi-stores-live2d` (VRM store), `airi-stores-stage-ui-live2d`, `airi-stores-stage-ui-live2d-motion-control`, `airi-stores-stage-ui-spine`, `airi-stores-stage-ui-mmd` | renderer stores |

### A.5 Mount sites (30)

| Site | Mount |
| :--- | :--- |
| `RendererStage.vue:454-483` | `Live2DScene` (~20 props + 3 events) |
| `RendererStage.vue:484-510` | `ThreeScene`, `@binary-loaded` → V-HACK |
| `RendererStage.vue:511-533` | `SpineScene` |
| `RendererStage.vue:534-555` | `MMDScene` with `texture-map`, `preview-expression` |
| `RendererStage.vue:566-594` | head-tethered caption + radial menu |
| `ControlStripHost.vue:2004-2014` | `RendererStage` (web) |
| `model-settings/index.vue:205-274` | four scene components |
| `EmotionCalibrationStudio.vue:1077-1091`; `step-finale.vue:595-609`; `chat_rehearsal.vue:1329-1342`; `chat.vue:1963-1976`; `actor.vue:561-582` | `RendererStage` surfaces |
| `pages/index.vue` (desktop/web/pocket) | `WidgetStage` |
| devtools | `Live2DCanvas`/`Live2DModel`, `ThreeScene`, custom Three scene |

### A.6 Model data and asset paths

| Kind | Path/key |
| :--- | :--- |
| Local model record | localforage default DB, `display-model-{nanoid}` (incl. `File`), `{id}-textures` |
| URL/preset models | raw id (`preset-live2d-1`, `preset-vrm-1`), `MODEL_ID_ALIASES` |
| Catalog caches | `local:display-models/metadata-cache`, `local:sync-metadata/remote-catalog-cache`, `local:sync-metadata/preview-updated/{id}` |
| Deletion | `local:sync-metadata/deleted-models/{id}` |
| Remote layout | `assets/models/manifest.json`, `{id}.bin`, `{id}-textures.json`, `{id}-preview.png`; `assets/mmd/manifest.json`; `assets/vrma/manifest.json` |
| Stage-Mate | `{userData}/stage-mate-cache/{modelId}.vrm`, `.outfits.json` |
| Card | `modules.displayModelId`, `active_state.displayModelId`, `outfits`, `acting.modelExpressionPrompt`, legacy `modules.{vrm,live2d}` |
| Per-model settings | `settings/positioning/models` (only model-keyed map) |
| Per-format settings | ≈110–120 keys in `settings/{stage-ui-three,live2d,spine,mmd}/*` (VRM ~38, Live2D ~18, Spine ~15, MMD ~42) |

### A.7 Panels and pickers

| Surface | Current implementation |
| :--- | :--- |
| Settings → Models | `model-settings/index.vue` + `vrm.vue`, `vrm-expressions.vue`, `live2d.vue`, `live2d-customization.vue`, `mmd.vue`, `spine.vue`, `ModelCustomizer.vue`, `ModelSceneSettings.vue`, `HackerPanel.vue`, `LHackerPanel.vue` |
| Control Strip | motion/expression/wardrobe pickers (`ControlStrip.vue:949-1148`) |
| Card editor | `CardEditorForm.vue` acting tab, `useActingCapabilities.ts` |
| Model selection | `model-selector.vue`, `ControlStrip.vue:109-155`, onboarding `step-vessel.vue` |
| Acting/calibration | `EmotionCalibrationStudio.vue`, `ModelPromptGeneratorModal.vue` |

### A.8 Renderer-internal vocabulary in host code

| Vocabulary | Anchor |
| :--- | :--- |
| Live2D parameter ids (`ParamAngleX`, `ParamMouthOpenY`, `ParamBreath`) | `live2d-customization.vue:79-104` |
| Live2D motion groups (`Happy`, `Face#2`, `exp12`) | `constants/emotions.ts:16-37`; `dating-sim.ts:725-735`; `ControlStripHost.vue:307` |
| VRM expression names (`Fun`, `Joy`, `Blink_L`) | `constants/emotions.ts:40-51`; `EmotionCalibrationStudio.vue:294-329` |
| VRM humanoid bones, `VRMC_vrm_animation` | `utils/vrmaBuilder.ts:6-23,224-228`; `VrmSocketResolver.ts:17-109` |
| Spine skins/animations candidates | `display-models.ts:2149-2191`; `spine.vue` |
| MMD morph slots/candidates | `model-capabilities.ts`; `mmd.vue`; `ModelCustomizer.vue` |
| `getHeadPose` shape | `HeadTetheredCanvas2D.vue:37-45`; `HeadTetheredRadialMenu.vue:298-306` |
| Live2D Pixi app injection | `HeadTetheredCaption.vue:111-134` |
| Live2D lip-sync types | `ControlStripHost.vue:11-12,179-180,1686-1688` |

### A.9 Test coverage today

| Area | Coverage |
| :--- | :--- |
| Import / format detection | partial — MMD variant detection and URL extension tagging only; no `addDisplayModel` |
| Store CRUD / metadata cache / alias table | none |
| Texture companion | none |
| Capability extraction from bytes | none (label normalization only) |
| Preview generation | none |
| Card→model binding / prompt | none (schema test covers cue allowlist only) |
| Sync reconciliation | none for model manifests |
| Renderer mounting | one source-scan guard; no functional mount test |

---

## Appendix B — How this supersedes the RFC 0001 migration plan

[`docs/design-stage-renderer-migration.md`](../../docs/design-stage-renderer-migration.md) remains a useful per-renderer inventory, but its architecture is RFC 0001's.

| Topic | RFC 0001 plan | RFC 0002 / this plan |
| :--- | :--- | :--- |
| State across mounts | `stateScope`, shared snapshot | No state scope, no snapshot; every mount independent |
| Prompt | per-scope `activeKeys`, host wording | Per model+profile publication as an atomic text+tokens pair, one version; card keeps a complete snapshot; disagreement is user-arbitrated |
| Cue addressing | `target.mountId` | Driver + surface (+ purpose); broker resolves, manager fans out |
| Mount identity | renderer-minted | Registry-issued on registration |
| Cancellation | absent | Six withdrawals, seven states, per-target results |
| Queries | live component only | Also by surface+purpose through the manager |
| Capabilities | one list | Claim vs probe, interaction modes, effect/reset deltas |
| Migration input | entries reported `unused` individually | One handover **per model**, lazily materialized, retained by the driver, consumed by reference |
| Migration trigger | launch-time queue | **User request**, from a screen that precedes it, with a storage gate and a cutoff |
| `pending-import` | transient state | Persisted identity-less payload |
| Manager | main (RFC 0001) | Main; registry-owned; `RegistryHandle`; cue-shaped renderer request; host row cache; broker and mount descriptors beside it |
| Reversibility | none | Three releases, driver-served revert as a per-character transaction, removal last |
| Stage-Mate | outside contract, own placement | Same ruling, retained: it migrates as planned and its speech relay is the single main-crossing exception |

Per-renderer inventories and deletion candidates remain the starting point for §6; the decisions, transport, shared state, prompt and cancellation sections must not be carried over.

---

## Appendix C — Contract conformance map (after Phase 0)

| RFC section | Symbol(s) | Status |
| :--- | :--- | :--- |
| §4.1 actors | registry, mount registry, manager, runtime, adapter | Manager in main; adapter exported; mount ids registry-issued |
| §4.2 communication | cue channel/sink, manager deliver/withdraw, observation | Complete |
| §5.1 identity | ids, adapter minting, `ModelState` | Complete; `pending-import` moved out; fresh model ids, no legacy adoption |
| §5.2 profiles | provider profiles, reference gate | Complete; conversion of legacy outfits is driver work |
| §5.3 two-phase import | probe→parts, confirm with input, per-entry settlement, `estimatedSizeBytes` | Complete (C21, D-18) |
| §5.4 builtins | descriptor without id | Already conformant |
| §5.5 duplicates | conflict, overwrite, resetProfiles | Complete; migration never uses `overwrite`; conflicts are user-resolved (D18) |
| §5.6 provenance | migration marker + host marker | Complete |
| §5.7 preview/authorship | preview/author records | Already conformant |
| §5.8 enumeration | `listModels`, `ModelSummary`, `RegistryHandle` renderer request with refusal reasons | `RegistryHandle` request (C22) |
| §5.9 capabilities | modelCapabilities, effect kind | Complete |
| §5.10 transfer/deletion | export/import, purge, reference gate, `LegacyRestorePayload` | Complete (C11, C23) |
| §6.1–§6.3 declaration | manifest, requirements, activation | Manager-only entry (C15) |
| §6.4 claim vs probe | capabilities, interaction modes | Complete |
| §6.5 loading | manager resolveEntrypoint → specifier | Complete (C15) |
| §7.1–§7.4 selection/replacement/prompt | picker, binding, publication | Complete (C7, D5) |
| §8.1–§8.6 mounting | props/emits/exposed, transitions, queries, acting rename | Complete |
| §9.1–§9.7 cues | envelope, vocabulary, ack, delivery, cancellation, no-target | Complete |
| §10.1–§10.5 services | storage (runtimes), pointer, prompt, theme | Complete |
| §11 panels | panel/picker declarations | Complete |
| §12 speech | frames + analyzer service + the sidecar relay exception | Complete |
| §13 migration | per-model handover with model bytes, records, retention, `LegacyRestorePayload` for revert | Complete (C13, C23) |
| — | Contract revision | `0.1` from Phase 0 close; `{ major: 0, minor: 2 }` is draft-only and must not appear in a manifest. RFC 0002 is amended **as Phase 0's last commit** (§3.2), which is what makes this table true |

---

## Appendix D — Work order at a glance

| Phase | Slice | Ships when |
| :--- | :--- | :--- |
| 0 | Contract closure + validators + RFC amendment | SDK typecheck/tests green; zero importers; amendment open |
| 1 | Host core + registry-owned manager in main + `RegistryHandle`/cue-shaped renderer request + registry-issued mount ids + background window + host row cache + stub with the full migration surface | Broker/registry/manager-request/entry/window-gone suites pass in two windows |
| 2 | Mounts, surfaces, prompt store + snapshot + arbitration, panels, picker, speech, user-requested migration with the storage gate and the screen, VRM spike | Stub renders on every surface; the run resumes and parks; prompt conflicts arbitrate; spike report gates Phase 3; no format cut over |
| 3 | Spine cutover | Spine loads/acts/profiles/captures; migration round trip; legacy retained |
| 4 | MMD cutover | MMD imports with textures through the driver; migration round trip; legacy retained |
| 5 | Live2D cutover | Caption/pointer/OPFS/DSL actions; migration round trip; legacy retained |
| 6 | VRM cutover | Camera/transform/profiles/VRMA; Stage-Mate follows; migration round trip; legacy retained |
| 7 | Hardening, transfer, retention/reversal | Backup round trip incl. the prompt archive; revert works after deletion through the driver; deletion is user-prompted |
| 8 | Final removal after every cutoff | Guards green; legacy renderer/data gone; collector kept; unmigrated characters unavailable, not broken |


