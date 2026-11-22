# Implementation Plan — Model Driver Contract (RFC 0002)

| Field | Value |
| :--- | :--- |
| Status | **Approved for implementation (2026-11-22).** Decisions D1–D8 are signed off (§2). Implementation has not started; this document is still docs-only, and beginning a phase does not commit or push anything by itself. |
| Normative source | [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) (RFC 0002). Where this plan and the RFC disagree, the RFC wins; where the RFC is silent, this plan chooses and says so. |
| Contract package | `@proj-airi/stage-renderer-sdk` — revision `{ major: 0, minor: 2 }` in this working tree, 13 contract files, **no integration** |
| Supersedes | [`docs/design-stage-renderer-migration.md`](../../docs/design-stage-renderer-migration.md) (the RFC 0001 companion plan) wherever that document conflicts with RFC 0002 — see Appendix B |
| Scope | Host integration for Electron + Web + Pocket, four first-party drivers (Spine, MMD, Live2D, VRM), and migration of the data AIRI already holds |
| Out of scope | Third-party driver packaging/distribution, a plugin loader or discovery mechanism, a driver-side cloud-sync channel, a scripting VM, beat sync, progress reporting, a cancellation channel outside cue transactions |

**Decision record.** The project owner signed off on all eight decisions (D1–D8) on **2026-11-22**. The review accepted each proposal and added binding constraints, all incorporated below: D1 (renderer-hosted manager, election only if moved, state in web storage, thin manager), D4 (keep existing extensions, add new ones), D5 (publication is mandatory; an empty prompt + empty token list is a real publication and is kept as-is). A later change to D1, D4, D5 or D8 is a plan revision, not an implementation detail.

Notation: **MUST** / **MAY** / **SHOULD** carry the RFC's meaning. A `→` names a repository path that the task touches. "Phase" is a shippable slice, not a calendar estimate. Every phase ends with an exit criterion that can be observed, not with "code written".

Execution note: each phase is cut into PR-sized tasks at implementation time. The recurring per-task checklists are the cutover checklist (§8.1) for data, the smoke list (§9.2) for a driver, and the guards (§7.3) for anything that deletes a host seam.

---

## 0. Starting point

This plan starts from a specific, verifiable state, because most of its sequencing is about moving one working system without pausing it.

1. **The contract package exists and is uncommitted.** `packages/stage-renderer-sdk` holds 13 contract files. The working tree already contains the RFC 0002 reshuffle: `adapter.ts`, `components.ts`, `plugin-port.ts` added; `persistence.ts` (the RFC 0001 state-scope channel) and `renderer.ts` (renamed to `components.ts`) deleted; ten files modified. `src/index.ts` re-exports 12 of the 13 — `adapter` is not exported. Its only validation is `pnpm -F @proj-airi/stage-renderer-sdk typecheck` (`tsc --noEmit`), and it has no tests.
2. **Nothing imports the package.** A repository-wide grep for `stage-renderer-sdk` outside its own `src/index.ts`/`README.md` returns nothing. This is the cheapest possible starting point: the contract can still change without touching a consumer.
3. **The app renders through one component and four stores.** `RendererStage.vue` statically imports the four scene components; `ControlStripHost.vue`, `ControlStrip.vue`, `ModelCustomizer.vue`, the card store and the settings pages read and write the four renderer stores directly. The compiler still sees every format.
4. **The data model has no identities beyond a display-model string.** `display-model-${nanoid}` is minted in the host store; there is no `profileId`; there is no driver id on a model; a character card points at `modules.displayModelId`. No `modelPrompt` field exists.
5. **No host machinery for the contract exists**: no registry, adapter, manager, runtime, cue broker, mount registry, model rows, profile records, prompt publication, or driver panels/picker.

That state defines two risks the plan must manage:

- **Contract churn is free now and expensive after Phase 1.** §3 closes the RFC 0002 gaps before any host code depends on the shapes.
- **The app cannot stop rendering while it migrates.** Every phase keeps the un-migrated formats on the legacy path; a format crosses over in its own slice (§6), and only §7 deletes the legacy path.

---

## 1. Current project structure

This section is the factual baseline the plan is built on: what exists, where it lives, and how strongly the host is coupled to the four renderers. Counts and anchors come from the current working tree.

### 1.1 Repository map relevant to rendering

| Path | Role today | Relationship to RFC 0002 |
| :--- | :--- | :--- |
| `packages/stage-ui` | Host UI, scene mounting, display-model store, settings pages logic, card store, caption surfaces | Becomes the host that knows **no** format |
| `packages/stage-ui-three` | VRM: Three.js scene, store, preview util, VFX, trace | Renderer internals of the VRM driver |
| `packages/stage-ui-live2d` | Live2D: Pixi scene, store, DSL VM, preview util, validator, OPFS loader | Renderer internals of the Live2D driver |
| `packages/stage-ui-spine` | Spine: scene, store, preview util, version detection | Renderer internals of the Spine driver |
| `packages/stage-ui-mmd` | MMD: scene, store, preview util, ZIP extractor, morph constants | Renderer internals of the MMD driver |
| `packages/stage-pages` | Settings routes: models, card editor, onboarding, providers | Host consumers of model rows, panels, pickers |
| `packages/stage-layouts` | Stage embedding in layouts | Consumes `WidgetStage`, no format knowledge |
| `packages/stage-renderer-sdk` | The contract (**this package**) | The boundary |
| `apps/stage-tamagotchi` | Electron main + renderer; window managers for control strip, actor stage, chat, settings, onboarding, caption, customizer and the rest; eventa contracts | Hosts the registry, adapters and mounts |
| `apps/stage-web`, `apps/stage-pocket` | Single-renderer hosts (browser, Capacitor) | Single-process variant of the same host |
| `packages/plugin-sdk`, `packages/plugin-protocol` | Existing plugin host for server/WebSocket plugins | **Not** the driver loader; RFC 0002 explicitly has no loader |
| `packages/model-driver-lipsync`, `model-driver-magic-live2d`, `model-driver-mediapipe`, `motion-driver-magic` | Motion-capture / lip-sync / MAGIC motion "drivers" | **Name collision**: these are not avatar-format drivers (see §1.7) |

### 1.2 How a model reaches the screen today

```text
Electron window                       renderer page                         mount
─────────────────────────────────────────────────────────────────────────────────────────
main (control strip)  ──────────────▶ pages/index.vue        ──▶ WidgetStage
                                                               └▶ ControlStripHost.vue
                                                                  └▶ RendererStage.vue
stage (actor)         ── /actor ────▶ pages/actor.vue        ──▶ RendererStage.vue
chat                  ── /chat ─────▶ pages/chat.vue         ──▶ RendererStage.vue
chat → Rehearsal                     chat_rehearsal.vue      ──▶ RendererStage.vue
settings              ── /settings ─▶ stage-pages/models      ──▶ model-settings/index.vue
                                                                  └▶ 4 scene components (async)
onboarding            ── /onboarding▶ step-finale.vue         ──▶ RendererStage.vue
web / pocket          ── / ─────────▶ pages/index.vue        ──▶ WidgetStage → RendererStage.vue
```

`RendererStage.vue` is the single seam, and it is a union type written by hand:

- static imports of `Live2DScene`, `MMDScene`, `SpineScene`, `ThreeScene` and their stores (`packages/stage-ui/src/components/scenes/RendererStage.vue:3-6`);
- four mutually exclusive `v-if` branches, each with its own prop list (`:454-555`);
- exposed per-renderer handles (`vrmViewerRef`, `live2dSceneRef`, `spineViewerRef`, `mmdViewerRef`, `canvasElement`, `captureFrame`, `readRenderTargetRegionAtClientPoint`) at `:436-445`;
- host-drawn caption surfaces that reach into the renderer (`HeadTetheredCaption.vue` imports `attachLive2DHeadTetheredCaption` and hands it the Pixi app; `HeadTetheredCanvas2D.vue` and `HeadTetheredRadialMenu.vue` call `getHeadPose()`).

### 1.3 Coupling baseline

A full inventory of host→renderer coupling (every import, format branch, store reach-in, channel, mount, asset path, panel and renderer-internal name) is in **Appendix A**. Summary:

| Kind | Count | Concentrated in |
| :--- | ---: | :--- |
| Static imports / re-exports of a renderer package outside it | 75 host files/packages (one row per file) | `RendererStage.vue:3-6`, `ControlStripHost.vue:15-18`, `ModelCustomizer.vue:14-17`, `display-models.ts:10-27` |
| Format branches (`DisplayModelFormat`, `stageModelRenderer`, format strings) | 117 rows; **216** `DisplayModelFormat` references, **57** `stageModelRenderer === '…'` comparisons | `stage-model.ts`, `display-models.ts`, `ModelCustomizer.vue`, `ControlStrip.vue`, `model-selector.vue`, onboarding |
| Renderer-store reach-ins | 74 | `ControlStrip.vue:489-495`, `ModelCustomizer.vue:69-72`, `airi-card.ts:456-457`, `ControlStripHost.vue:102-104` |
| BroadcastChannel sites carrying renderer state | 35, on **12** host channel names + **5** renderer package channels | `RendererStage.vue`, `ControlStripHost.vue`, caption surfaces, `airi-speaking-state` |
| Mount sites (scene components, props, exposed methods) | 30 | the five `RendererStage` call sites + settings preview + devtools |
| Model binary / asset handling in host code | 43 | `display-models.ts` (2,375 lines), `stage-model.ts`, `model-selector.vue`, `sync-engine.ts` |
| Per-format settings panels and pickers | 37 | `model-settings/*.vue`, `ModelCustomizer.vue`, `ControlStrip.vue`, `model-selector.vue`, onboarding |
| Host code naming renderer internals | 55 | Live2D `ParamAngleX`-style parameter panels, VRM humanoid bones, Spine skin candidates, MMD morph slots, Live2D lip-sync |

The load-bearing observation: **the coupling is not 466 independent decisions.** It is one enum (`DisplayModelFormat`, 7 values), one parallel renderer enum (`StageModelRenderer`, 5 values), five stores, one scene component and one 2,375-line store. The plan removes those five seams rather than chasing call sites.

### 1.4 Data, identity and persistence today

| Fact | Current shape | Consequence for the migration |
| :--- | :--- | :--- |
| Model record | `DisplayModel = DisplayModelFile \| DisplayModelURL \| DisplayModelCloud` (`packages/stage-ui/src/stores/display-models.ts:41-110`) | Carries host annotations *and* format capabilities *and* (for file models) the binary |
| Identity | `display-model-${nanoid()}` minted at import (`:1195`, `:1246`); presets are hardcoded ids (`preset-live2d-1`, `preset-vrm-1`, …) resolved through `MODEL_ID_ALIASES` (`:470-475`) | AIRI mints an id, but not through an adapter, and the `display-model-` prefix doubles as the persistence predicate |
| Profile / outfit | `AiriOutfit` lives on the **card** (`card.schema.ts:195-204`, `:320`) and is mirrored onto the model record; `applyOutfit` only pokes VRM expression weights (`airi-card.ts:1423-1469`) | No `profileId` anywhere; RFC 0002 requires one per import and a driver-owned profile body |
| Card binding | `extensions.airi.modules.displayModelId` (`card.schema.ts:103`), mirrored into `active_state.displayModelId` (`:375`) | 307 `displayModelId` references; identity preservation avoids a card migration |
| Model prompt | `extensions.airi.acting.modelExpressionPrompt` (`card.schema.ts:308-319`) — **user/LLM-authored**, generated from live capability lists, injected into the system prompt (`airi-card.ts:1521-1531`) | RFC 0002 says only the driver can write a model's prompt, per model **and profile**; the existing text has to be handed over (§2, D5) |
| Binary storage | localforage **default** DB: `display-model-{nanoid}` (record including `File`), `{id}-textures` (MMD companion), URL models under their raw id | The driver owns these keys after cutover; the host must stop enumerating them |
| Catalog cache | unstorage `local:display-models/metadata-cache`, `local:sync-metadata/remote-catalog-cache` | AIRI's own rows replace the metadata cache; the row store is new |
| Deletion | `local:sync-metadata/deleted-models/{id}` written on removal, scanned by `reconcileModels()` | This is already the "durable marker" RFC 0002 §13.2 asks for; keep and generalize |
| Preview | `previewImage` data URL on the record + metadata cache + remote `assets/models/{id}-preview.png`; produced per format by four body-mounted canvases | Driver produces, AIRI stores a copy (§5.7) |
| Settings | ≈110 `settings/{stage-ui-three,live2d,spine,mmd}/*` localStorage keys, window-global; only `settings/positioning/models` and `settings/stage-ui-three/lastModelIdentity` are model-scoped | Driver storage; one-time legacy bag per driver |
| Tests | No test covers import, the metadata cache, texture companions, capability extraction from bytes, preview generation, or card→model binding; `model-capabilities.test.ts` covers label normalization only | The migration's riskiest code is the least tested today; §9 adds the missing harness |

### 1.5 Process and transport topology

| Layer | Facts |
| :--- | :--- |
| Electron main | Creates 16 windows (`apps/stage-tamagotchi/src/main/index.ts:322-452`), composes services with `injeca`, owns window lifecycle and native capture. **No IndexedDB, no DOM, no WebGL.** |
| Renderer windows | Vue + Pinia; own IndexedDB/localStorage; one origin shared by all windows. |
| Main↔renderer | Typed `@moeru/eventa` contracts (`apps/stage-tamagotchi/src/shared/eventa.ts`, 438 lines) plus window-specific RPC handlers; a few raw `ipcMain` channels (`byos-fs:*`, `stage:capture-window`, backup bundle). |
| Renderer↔renderer | `BroadcastChannel` only, fire-and-forget. Twelve host channel names participate in renderer state (`airi-speaking-state`, `airi:stage-capture`, `airi-caption-overlay`, `airi-stage-model-ready`, …). |
| Web / Pocket | One renderer; no main process; the same `WidgetStage` composition. |

### 1.6 What does not exist

- A driver declaration registry, contract-version check, enable/disable state or driver status surface.
- An adapter that resolves entry points, mints identities or authenticates a runtime.
- A manager (driver code outside mounts) or a model-row enumeration path.
- A cue broker: no transaction table, no correlation value authority, no settlement, no drop/deadline, no cancellation, no window-gone handling.
- A mount registry: readiness is a local ref, surfaces/purposes are not modeled, and cues are addressed to components by ref where they exist at all.
- `HostNamedModelRecord`, `HostModelProfileRecord`, `CharacterModelBinding`, model/profile row persistence.
- Prompt publication as a driver→host push, or a prompt + ACT token list pair.
- Driver panels, driver picker, AIRI's unavailable-model picker.
- Speech frames as a host service (each renderer receives a `mouthOpenSize` prop today, and Live2D additionally runs the host's `createLive2DLipSync`).
- Any test or harness that can mount a fake driver.

### 1.7 Constraints the plan must respect

1. **The name "model driver" is already taken by motion/lip-sync packages.** `@proj-airi/model-driver-magic-live2d`, `model-driver-mediapipe`, `model-driver-lipsync` and `motion-driver-magic` are unrelated to avatar formats. New packages and prose must not rely on `model-driver-*`; this plan uses **stage driver** in package names and keeps `ModelDriver*` only for contract types.
2. **Desktop main cannot touch IndexedDB.** Managers need driver storage (§4.1, decision D1).
3. **Web and Pocket have no main process.** The host core must be usable in-process without Electron.
4. **Electron main externalizes dependencies.** Anything the main process imports is bundled unless listed; importing a Vue/Three renderer package into main would drag the renderer stack into the main bundle.
5. **Stage-Mate (Unity) is outside the contract for this migration.** It is a second copy of the avatar with its own window config and lip-sync envelope; RFC 0002 has no channel for it. It keeps its bridge, consumes the same speech frames, and receives forwarded cues.
6. **First-party only.** The SDK stays `private`; drivers are workspace imports. RFC 0002 non-goals forbid a loader, and no third-party distribution is promised by this plan.
7. **The repo develops directly on `main`.** Every phase is reviewable on its own; no big-bang switch.

---

## 2. Decisions (signed off 2026-11-22)

RFC 0002 deliberately leaves several host choices open ("where the host runs it is the host's decision", "which transport carries which kind is the host's implementation"). The choices below were signed off on 2026-11-22 and are now binding. The alternative column is kept as the record of what was rejected, not as an open question.

| # | Decision | Chosen | Alternative (rejected) | Status |
| :--- | :--- | :--- | :--- | :--- |
| D1 | Where managers run on desktop | A dedicated hidden **driver-host renderer window** owns managers and their storage; the main-process registry holds declarations + enabled flags + the broker | Managers in Electron main with a new file-based storage medium | Signed off |
| D2 | Driver packaging | Driver modules colocated in each renderer package (`src/driver/*`, subpath exports) for the first-party release; a separate `@proj-airi/stage-driver-*` package only if third-party distribution is revisited | Four new packages now | Signed off |
| D3 | Transport | `@moeru/eventa` invoke/event for registry requests, delivery and observation on desktop; direct in-process calls on Web/Pocket; `BroadcastChannel` never carries an acknowledgement | BroadcastChannel + polling | Signed off |
| D4 | Identity preservation | Legacy model ids become `modelId` verbatim; one default `profileId` per import; the card keeps `displayModelId` and gains `extensions.airi.avatar` for driver/profile/prompt | Rename the card field and migrate all cards | Signed off |
| D5 | Existing model prompt | Hand `acting.modelExpressionPrompt` to the driver in the migration bag; after cutover the card caches the driver's last publication (`avatar.prompt`, host UI read-only) | Keep it as a host fallback/override | Signed off |
| D6 | Format order | Spine → MMD → Live2D → VRM | VRM first (most visible) | Signed off |
| D7 | First-party scope | No loader, no discovery, no third-party install | Reuse `plugin-sdk` host | Signed off |
| D8 | Backup compatibility | Keep a legacy backup reader until the pre-contract backup format's version cutoff; the driver migration runs during restore | Drop old backups | Signed off |

### D1 — Manager hosting on desktop

**Requirement.** The manager outlives every mount and every user window, answers model enumeration with no mount, and needs driver-namespaced storage. The host chooses where it runs (RFC 0002 §4.1, §10.2: "the host may run the driver's non-rendering code in a window of its choosing").

**Options.**

- **A. Managers in Electron main + a new main-side storage medium (e.g. files under `userData`).**
  - Pros: literal two-process split; no extra renderer.
  - Cons: model bytes live in IndexedDB today and are multi-GB; this creates a second storage medium, a second migration for every model, a main-side implementation of `keys`/`watch`, and a permanent split between BYOS/sync (renderer) and driver bytes (main). Main also cannot run the provider's parsing code without bundling renderer dependencies.
- **B. Managers in one hidden driver-host renderer window, created at startup and alive for the app lifetime.**
  - Pros: one storage medium (the existing IndexedDB origin); the manager and provider instances share the same storage adapter; no Vue/Three code in the main bundle; window destruction is already observable by main, so window-gone settlement stays correct.
  - Cons: one extra renderer process (tens of MB), a startup ordering dependency, and a nuance: the manager outlives all *display* windows but is itself hosted in a window. Mitigation: the host window has no route, no UI and no stage; it is an implementation detail, and web/pocket co-locate managers in-process.
- **C. Managers in the always-on control-strip window.**
  - Rejected: reloading or closing that window kills managers, which contradicts "outlives every window".

**Decided: B.** The registry and cue broker remain AIRI's and live in the main process (global correlation values, window-gone detection, authorization); the host window hosts managers and is reached through main. The startup/recovery consequences are specified in §4.2–§4.3.

**Signed-off interpretation.** The review accepts a manager in the renderer process, which is this plan's **Option B** (the hidden driver-host window); the main-process manager (Option A) stays rejected. The review's constraints are binding:

- **Election.** None is required on desktop: the hidden host window is the single manager host, and main owns the registry. It **is** required where the host can be duplicated — Web/Pocket in several tabs of one origin — so those hosts elect one manager owner per profile (Web Locks where available, otherwise a `BroadcastChannel` claim with a tab id), and the other tabs proxy to the owner. If the manager ever moves into a user window or into main, the same one-owner election applies; never two managers for one driver.
- **State.** The manager keeps no essential state in memory. Enabled flags, rows, records and migration markers live in host web storage (IndexedDB/localStorage); anything the manager caches is disposable and re-read after a restart.
- **Thinness.** The manager does lifecycle and model listing only. Parsing, preview generation, capability discovery and rendering stay in runtimes/provider instances; the manager is not computation- or persistence-intensive.
- **Movability.** The host service interface is the boundary. Moving the manager later is a host wiring change, never a driver change, and its state survives because it already lives in host web storage.

**Status: Accept Option A.** Manager in renderer process may require election. Manager state must be persisted on web storage, if any at all. The manager is not computation intensive or persistence state intensive. The manager may be moved in the future if there is a performance or stability issue, but the general model persists.

### D2 — Driver packaging

**Option A (chosen): driver modules live in the renderer package they belong to**, e.g. `packages/stage-ui-three/src/driver/{manifest,manager,provider,mount,panels,picker}.ts`, exposed through subpath exports. The host never imports a renderer package directly; a single first-party driver table names manifest module specifiers, and a guard test (§7.3) fails on any other host import.

**Option B: four new `@proj-airi/stage-driver-*` packages.** Cleaner long-term boundary and a prerequisite for third-party distribution, but it duplicates package plumbing now and moves code that is still churning.

**Decided: A now, B later.** The manifest indirection means moving to B is a package move, not a host change.

**Status: Accepted as proposed.**

### D3 — Transport

- **Desktop:** typed `@moeru/eventa` invoke/event for registry requests (register, update, unregister, list/query, deliver, withdraw, ack) and for observation; the main process relays between the driver-host window and each mounting window. A driver never sees a transport, only its channel.
- **Web / Pocket:** the same interfaces implemented with direct in-process calls; no serialization and no relay.
- **BroadcastChannel is observation-only.** It has no return path and no ordering guarantee; it cannot carry an acknowledgement, and today's five renderer channels silently do nothing when the receiving window did not instantiate the matching store. It survives only where an observer genuinely needs latest-wins state (theme, row refresh).

**Status: Accepted.**

### D4 — Identity preservation

RFC 0002 §5.1 requires the adapter to mint identities and guarantees stability across transfer/restore. The cheapest way to keep every existing reference valid is:

**Decided shape.**

- `modelId` = the existing `DisplayModel.id` (including `preset-live2d-1`, `display-model-<nanoid>`), adopted at import/restore. No card migration.
- One default `profileId` minted per imported model before its first load, so `LoadCue.profileId` is never empty. Only the adapter mints it; a driver persists it and never rewrites it.
- The card keeps `modules.displayModelId` as the **model id**, and adds one new schema object:

```ts
// packages/stage-ui/src/types/card.schema.ts — AiriAvatarBindingSchema (new)
extensions.airi.avatar = {
  driverId: string,
  profileId: string,
  prompt?: {            // cache of the driver's last publication, never host-authored
    modelId: string,
    profileId: string,
    text: string,
    version: number,
    publishedAt: number,
  },
}
```

  The full publication (text + ACT token list + version) is kept in the host's prompt store; the card keeps only what must survive a driver that is not running, which is the text plus the identity/version it belongs to. A card without `avatar` is a legacy card: resolve its driver from the model record's `modelDriverHint` and mint/attach the binding during the cutover. Valibot schema tests cover the new object, a legacy card, and a mismatched `modelId`.

**Additive schema, per review.** Every existing `extensions.airi.*` field stays (`modules`, `acting`, `outfits`, `active_state`, the legacy per-format blocks); `avatar` is added beside them. Nothing is renamed or removed, so existing readers keep working. Only data changes at cutover: the legacy prompt text is copied into the cache and cleared, and outfits are converted to driver profiles.

The alternative — renaming the card field to `avatar` and migrating all cards — touches 307 references for no user-visible gain and creates a second failure mode during cutover.

**Status: Accepted.** Note: keep the existing extensions and add new extensions.

### D5 — The existing model prompt

Today `extensions.airi.acting.modelExpressionPrompt` is generated by the user (or an LLM) from live capability lists and injected verbatim into the system prompt (`buildSystemPrompt`, `airi-card.ts:1521-1531`). RFC 0002 §7.4/§10.4 replaces this with a **driver-published prompt + ACT token list pair**, versioned per model and profile, with no fallback.

**Decided migration:** the per-driver legacy bag carries the card's current `modelExpressionPrompt` plus the model id it was written for (already needed for window-global settings). The driver may adopt that text as the initial publication for that model/profile and republish it; adoption is optional, but the driver must still publish (possibly empty) once it is activated. After the cutover:

- the card cache is `extensions.airi.avatar.prompt.text` (D4), not `acting.modelExpressionPrompt`;
- `buildSystemPrompt` reads the avatar prompt and never the acting field;
- `acting.modelExpressionPrompt` stays in the schema as **legacy input only**: it is read once during migration, then cleared from the card so two texts cannot disagree;
- the host never generates or edits the avatar prompt;
- a driver **MUST** publish at least once per model/profile; an empty prompt string and an empty ACT token array are a valid publication and are kept exactly as published (the cache exists with that empty text, and `buildSystemPrompt` contributes no model section);
- "no publication yet" (the driver has not been activated for that model/profile) is the only case with no cache; it is not the same as an empty publication;
- the "generate prompt" UI moves into the driver's panel and writes the driver's publication, not the card directly.

**Rejected alternative:** keep it as a host override. It would contradict RFC 0002 §7.4, reintroduce a second writer of a driver-owned text, and keep the host coupled to capability vocabulary.

**Status: Accepted.** Note on "publish nothing": the driver MUST publish, and empty string for prompt and empty array for ACT token list is accepted and kept as is.

### D6–D8

Signed off as proposed:

- **D6 (order).** Spine first because it has no camera, no lip sync and a static capability package; then MMD (asset companions), Live2D (profiles, captions, pointer, OPFS), VRM last (camera, transform, meshes, Stage-Mate). Each phase is shippable on its own.
- **D7 (no loader).** The first-party driver table is a static list of manifest specifiers. `@proj-airi/plugin-sdk` already hosts server/WebSocket plugins with a different lifecycle and is not reused: RFC 0002 non-goals forbid a loader, and a first-party static table is smaller than adapting an unrelated host.
- **D8 (backups).** A pre-contract backup is restored by a versioned legacy reader that imports through the two-phase path and writes deletion markers. The reader lives beside the host core and asserts the backup manifest's format version; the cutoff is a named constant with a test that an older bundle is refused with a readable message. Product commitment: maintain the reader for at least one release after the migration completes.

**Status: Accepted.**

---

## 3. Phase 0 — Close the contract

**Goal:** the contract package expresses RFC 0002 exactly, with executable checks, before any host code depends on it. No application behavior changes.

The current package is close but not conformant. The audit found the following gaps (full matrix in Appendix C):

| # | Gap (RFC section) | Change in `packages/stage-renderer-sdk/src/contract` | Acceptance |
| :--- | :--- | :--- | :--- |
| C1 | `Adapter` is unexported and cannot mint (`§5.1`, `§8.2`, App A) | Export it; type `fetchRuntime(intent)` with `{ modelDriverId, surface, purpose, mountId? }`; return `{ runtime, component?, managerChannel, services }`; add `mintModelId()`, `mintProfileId()`, `mintMountId()`; document the manager-authentication step | `src/index.ts` exports `./contract/adapter`; a unit test mints unique ids and rejects a duplicate mount id |
| C2 | Envelopes address `mountId`, not driver + surface + purpose (`§9.2`) | `CueEnvelope.target = { modelDriverId, surface?, purpose? }`; remove `mountId` from the public envelope; keep a broker-internal resolution record | A test sends to `{driver, surface:'stage', purpose:'actor'}` and resolves to the right mount set |
| C3 | Delivery to the manager is missing (`§4.2`, `§12`) | `ModelDriverManager.deliver(envelope)`, `withdraw(request)`, an enumeration-change notification, and an analyzer-registration member; a manager-side `onChange` for rows | Type-level only in this phase; the host stub in §4 exercises it |
| C4 | No cancellation (`§9.7`) | `CueTransactionState` enum (`submitted`/`queued`/`running`/`complete`/`cancelled`/`aborted`/`error`); `CueWithdrawalRequest` union (`cancel`/`abort`/`pop`/`pop-all`/`abort-current`/`dump`); per-target results (`cancelled`/`requested`/`running`/`unknown`/`empty` + correlations + count); bounds on named correlations and report size | Tests cover each request against a fake transaction table |
| C5 | Acknowledgement shape incomplete (`§9.3`) | Add the answering `modelDriverId`; allow a debug message on resolved outcomes; split acceptance from settlement (`send` returns `{ nonce, settled }`; `settled` resolves to the ack); drop the second correlation notion (`requestId`) | A test accepts a transaction, cancels it before settlement, and observes `cancelled` |
| C6 | Failure vocabulary incomplete (`§9.4`, `§9.6`, `§6.2`) | Add `cancelled`, `window-gone`, `contract-version-mismatch`, `model-referenced`, `profile-referenced`; rename `RENDERER_UNAVAILABLE` to `DRIVER_UNAVAILABLE`; keep `ABORTED` for "started and stopped" | Enum exhaustive in tests; no rejection reason is ever reported as a failure |
| C7 | Prompt and ACT token list are not a pair (`§10.4`) | Replace `ModelPrompt` with `ModelPromptPublication { modelDriverId, modelId, profileId, prompt, actTokens, version, publishedAt }`; `HostPromptService.publish(publication)`; document that AIRI stores only the latest, compares versions, and treats an **empty** prompt + empty token array as a real publication (not as absence); publication is mandatory once the driver is activated for that model/profile | Test: publishing profile B does not overwrite profile A's cached pair; publishing `('', [])` stores the empty publication and does not delete the cache |
| C8 | Capability vocabulary deltas (`§6.4`, `§9.5`) | Rename `vfx` → `effect`, `VfxCue` → `EffectCue`, `CueKind.VFX` → `EFFECT`, `CueKind.ACT = 'act'`; add `interactionModes: RendererMountInteractionMode[]`; add `effect` to `ResetScope`; add a point-of-interest target to `GazeMode`; type `capabilities.cues` as "beyond load"; forbid `persistent: false` on load/reset/caption | Typecheck + grep: no `vfx`/`VFX` in exported names |
| C9 | Readiness transitions are absent (`§8.4`) | A transition table (`READINESS_TRANSITIONS`) and `isReady(state)` (only `model-loaded` and `ready-for-model` are ready); document that a transition outside the table is a major-version change | A test walks every declared transition and rejects one undeclared one |
| C10 | Cross-window mount queries are missing (`§8.6`) | Manager-level `queryMount(request)` / `commandMount(request)` addressed by surface+purpose for `occupiesPoint`, `hitTest`, `stopAll`, `dispose`; keep the live-instance members for the creating window | A test from a second adapter reaches a mount by surface+purpose |
| C11 | No reference check before removal (`§5.2`, `§5.10`) | Document the host gate in `remove`/`removeProfile`/`purge`; optional `references?: string[]` evidence; failure codes C6 | Stub driver refuses a referenced model with `model-referenced` |
| C12 | `pending-import` contradicts the RFC (`§5.1`, `§13.2`) | Remove it from `ModelState`; add an **AIRI-only** `PendingModelPayload` record to `references.ts` (payload ref, driver hint, legacy id label, createdAt; no model identity) | Test: the host cannot construct a `LoadCue` from a pending payload |
| C13 | Migration bag is per-entry, not whole-bag (`§13.1`) | `migrate(bag)` returns `{ absorbed: boolean, warnings? }`; the host deletes the whole bag only on `absorbed: true`, then writes a marker; idempotency documented | A test calls twice with the same bag and observes no change |
| C14 | No compatibility predicate (`§6.2`) | `isContractCompatible(driver, host)` (same minor below 1.0, same major from 1.0, patch-compatible); rejection carries a readable reason | Table-driven test |
| C15 | `entry` declares five modules vs "only manager is static" (`§6.5`) | **Decided: RFC errata, no contract change.** The manifest names module specifiers, but nothing evaluates them at startup — the host loads only `manager` and resolves the rest on demand through the adapter. Phase 0 updates RFC §6.5 to say declaration, not load. Moving specifiers behind a manager method would add an indirection with no behavioral gain for a first-party static table | A host-side startup test imports no renderer module |
| C16 | Two driver-status vocabularies (`§7.3`) | Keep `DriverStatus` and `UnavailableModelReason`, and document the mapping (`NOT_INSTALLED`→`driver-unknown`, `DISABLED`→`driver-disabled`, `ERROR`→`driver-error`) | Mapping test |
| C17 | No validators or tests | Add runtime validators: `validateManifest`, `validateCueEnvelope`, `assertCapabilityCompleteness`, `assertAckShape`; add `vitest` + `test` script to the package | `pnpm -F @proj-airi/stage-renderer-sdk test` and `typecheck` green |
| C18 | Stale RFC 0001 citations | Update `src/index.ts` and `README.md` to cite RFC 0002; add the adapter and this plan to the README file map | README links resolve |
| C19 | Pointer wording contradicts the RFC (`§10.3`) | The RFC allows a runtime to attach its own listeners for events inside its window; the service is the only route for events outside it. Replace "MUST NOT attach a listener of its own" with that rule in `host-services.ts` and `renderer-mount.ts` | Comment/type review; no renderer is forced to keep a listener |
| C20 | The host passes a size (`§8.3`) | Remove `RendererMountProps.viewport`; the container's box is the viewport and the mount measures it. Pointer points stay relative to that box | No size reaches a driver; a mount measures its own container; pointer math remains box-relative |
| C21 | Commit does not carry the imported input and cannot settle per entry (`§5.3`) | `confirmImport` receives the input handle/copies alongside the selection, and each committed entry settles independently — a failing commit MUST NOT undo another | A stub commit with one failing and one succeeding entry persists only the success |

**Also in this phase (docs, not code):** update `docs/data-catalog.md` §3.2 to the real `DisplayModel` shape and add the new host record keys the later phases introduce. The catalog currently documents fields the source no longer writes and omits three storage keys (`local:display-models/metadata-cache`, `local:sync-metadata/remote-catalog-cache`, `local:sync-metadata/preview-updated/{id}`). Also apply the RFC §6.5 errata (C15) and the stale-citation fixes (C18).

**Execution units** (each is one reviewable change; do them in this order)

| Unit | Contents | Done when |
| :--- | :--- | :--- |
| P0.1 | Adapter (C1), envelope addressing (C2), delivery members (C3), prompt publication (C7), vocabulary deltas (C8), pointer wording (C19), no viewport prop (C20) | `tsc --noEmit` clean; no consumer yet |
| P0.2 | Cancellation model (C4), ack/acceptance split (C5), failure codes (C6), readiness transitions (C9), cross-window queries (C10), compatibility (C14) | Type-level tests for each table/union |
| P0.3 | Records and migration types (C11–C13, C16), import commit input (C21), RFC errata (C15) | Types compile; mapping tests |
| P0.4 | Validators + `vitest` (C17), exports/citations (C18) | `pnpm -F @proj-airi/stage-renderer-sdk test` green |
| P0.5 | `docs/data-catalog.md` correction and new keys | Catalog matches source for the model domain |

**Exit criteria**

1. `pnpm -F @proj-airi/stage-renderer-sdk typecheck` and the new `test` both pass.
2. A grep over `packages/stage-renderer-sdk/src` finds no format string (`vrm|live2d|spine|mmd`) outside comments and no `stateScope`/`persistence` residue.
3. Every RFC 0002 section maps to at least one exported symbol; the mapping is recorded in Appendix C.
4. The package still has **zero importers** in the app.

**Next action:** start with P0.1. Phase 1 begins only when all four exit criteria hold; do not scaffold a host against a contract that has not passed them.

---

## 4. Phase 1 — Host core

**Goal:** a host implementation that can carry the contract with a stub driver, with no real renderer touched and no user-visible behavior change. This is the phase every other phase depends on.

### 4.1 Where the code lives

| Artifact | Path (new unless noted) | Responsibility |
| :--- | :--- | :--- |
| Host core (pure TS, no Vue/Pinia) | `packages/stage-driver-host/` | Registry, cue broker, transaction table, cancellation, mount registry, id minting, host record types, driver storage adapter contract, the static first-party driver table |
| Contract validators | `packages/stage-renderer-sdk/src/validate.ts` | Manifest, envelope, capability completeness, compatibility, ack shape (Phase 0) |
| Main-process wiring | `apps/stage-tamagotchi/src/main/services/model-drivers/` | Registry ownership, eventa contracts, manager proxy, window-gone settlement, enabled flags |
| Driver-host window | `apps/stage-tamagotchi/src/main/windows/driver-host/`, `apps/stage-tamagotchi/src/renderer/pages/driver-host.vue` | Hidden window that hosts managers (decision D1) |
| Renderer adapter | `apps/stage-tamagotchi/src/renderer/libs/model-drivers/adapter.ts` | Per-window adapter: mint, resolve entry points, services, authenticated channels |
| Vue-facing host | `packages/stage-ui/src/libs/model-drivers/` | Records store, mount host, panel/picker frames, unavailable view, prompt cache |
| Web / Pocket host | `apps/stage-web/src/libs/model-drivers/`, `apps/stage-pocket/src/libs/model-drivers/` | In-process registry + managers + adapters, same interfaces |
| Stub driver + harness | `packages/stage-driver-host/src/testing/` | A complete fake driver: manager, runtime, provider, mount component, panel, picker |

`packages/stage-driver-host` deliberately has no Vue dependency: it is imported by Electron main, by the hidden window, by renderer windows, and by Web/Pocket. Vue-facing pieces stay in `stage-ui`.

### 4.2 Registry (Electron main)

Startup sequence, matching RFC 0002 Appendix A:

1. **Read declarations before executing driver code.** The static first-party table names one manifest module per driver; main imports only the manifest module and validates `id`, `driverVersion`, `contractVersion`, `requirements`, `capabilities` (C14/C17). A mismatch is rejected here with a readable reason; no service container is ever built.
2. **Register the driver** with its static capability hint, requirements, `enabled` flag and persisted `DriverInfo`. Enabled flags live in host web storage (`airi:model-drivers:enabled`, read through the driver-host window on desktop and directly on Web/Pocket); main keeps the last known values as a cache and refreshes them when a manager reports ready.
3. **Create the manager** in the driver-host window (D1). The host window reads the enabled flags and boots managers for enabled drivers; main records `hasManager` only after the manager reports ready. A failed manager load becomes `DriverStatus.ERROR`; rows persisted by the host keep the catalog usable.
4. **Create the broker and mount registry** (one each, in main).
5. **Broadcast `onChange`** whenever a driver is enabled, disabled, updated or a manager comes up/down, so the host re-enumerates rows (RFC §5.8).

Main holds **no runtime, no mount, no probe result**. It holds declarations, cached enabled flags, manager proxies, mount descriptors and the transaction table.

### 4.3 Manager hosting (desktop window; Web/Pocket in-process)

- A hidden `BrowserWindow` created after `app.whenReady()`, with `show: false`, `skipTaskbar: true`, `backgroundThrottling: false` (a throttled timer would make managers unresponsive), and a dedicated route `#/driver-host` that renders no UI.
- It owns the managers. Managers receive a host-provided service container: logger, namespaced storage (4.6), prompt channel, cue channel, pointer service, theme, UI, i18n, runtime facts, optional bridge/diagnostics (RFC §10.1).
- **Thin by design (D1 review constraint).** A manager does lifecycle and `listModels`, nothing else: no parsing, no preview generation, no capability discovery, no rendering. Those run in runtimes or lightweight provider instances in the window that asked for them. The manager is therefore neither computation- nor persistence-intensive, which is what makes it safe to host here and movable later.
- **No essential in-memory state.** Enabled flags, rows, records, markers and the prompt cache are host web storage (IndexedDB/localStorage), so a manager restarted after a crash re-reads its own list instead of losing it.
- **No election on desktop.** The hidden window is the single manager host and main owns the registry, so there is no contender to elect. Election applies only where hosts can duplicate (Web/Pocket tabs, below) or if the manager later moves into a user window or into main: one owner at a time, a deterministic winner, and re-election on crash.
- **Startup ordering.** Window creation is not a startup barrier: the main/actor windows appear immediately and catalogs render from persisted rows. A mount request or a cue that needs a manager waits on `whenManagerReady(driverId)`; if the manager has not reported ready before the transaction deadline (or a host-side 10 s default for foreground actions), the caller gets a `driver-unavailable` failure or an unapplied outcome, never a hang. This is the only place the hidden window touches user-visible latency.
- **Crash and reload.** Manager or window crash marks the driver `ERROR`, settles every pending transaction for its mounts (`aborted`), recreates the window with backoff (3 attempts, then a user-visible "retry driver" action), and re-registers. Rows persisted by AIRI keep the catalog visible as unavailable throughout.
- **Quit.** On app shutdown, `deactivate` is called on every active runtime, managers are released, and pending transactions settle `aborted` before the window is destroyed.
- The window is not a mount surface and never hosts a renderer. Preview generation that needs WebGL runs in the window that imported/asked for it (`provider.preview`), not here.

**Web / Pocket.** Managers run in-process in the app renderer, with the same interfaces. If the host permits several tabs of one origin, the election above picks one manager owner and the rest proxy to it; the shared IndexedDB is still the storage, and concurrent writes remain the driver's responsibility. No Electron APIs are used on this path.

### 4.4 Broker and transaction table (main)

The broker implements RFC 0002 §4.2, §9.3, §9.6 and §9.7. Its rules, in implementation order:

1. **Accept:** validate the envelope (target driver known, capture alone in its envelope, cue kinds bounded, at least one routable target). Malformed → `INVALID_ENVELOPE`, nothing delivered.
2. **Mint the correlation value** from one app-wide counter; record `submitted`; return `{ nonce, settled }` immediately (RFC §9.3: accepted before settled).
3. **Resolve the target:** `{ modelDriverId, surface?, purpose? }` → the matching mounts known to the mount registry. If a matching mount exists but is not ready, queue until it is (or the deadline passes). If **no** mount matches at all, settle every slot as unapplied (`renderer-not-ready`, a successful transaction with `handled: false`); `dropIfNotReady` does the same without waiting for readiness.
4. **Deliver in order per driver**, without waiting for completion: the manager may have two envelopes in flight.
5. **Manager fan-out:** the manager decides which mounts receive the envelope and how to combine their outcomes. The host provides the pipe from the manager to each mount's window; it does not interpret the driver's protocol.
6. **Settle once:** the aggregate ack carries one outcome per cue plus `handled`; late or duplicate acks are discarded.
7. **Deadline (`timeoutMs`):** settle `error` with `timeout`; the work may continue; a later ack is discarded rather than settling twice.
8. **Window gone:** unregister that window's mounts; settle pending transactions addressing them `cancelled` if never delivered, `aborted` if delivered. No caller is left waiting.
9. **Withdrawal requests** (C4): apply first to what the broker still holds, then to the receiver's queue, and answer per the RFC §9.7 result table. `cancel`/`pop`/`pop-all` never stop a running transaction; `abort`/`dump` ask the receiver and settle `aborted` or with the receiver's own outcome.
10. **Bounds:** cap named correlations per request and entries per report; reject a malformed change with a failure.

State is a table `nonce → { state, driver, target, deliveredTo[], acknowledgedBy[], deadline, resolution }` plus the per-driver queues. It is in-memory; a broker restart is a host restart, and every pending transaction settles `aborted`.

### 4.5 Identity, records and rows

| Concern | Implementation |
| :--- | :--- |
| Minting | The **adapter** mints `modelId`, `profileId` and `mountId` (C1). Uniqueness is checked against the main registry; an id already taken is rejected (`model-id-conflict`). |
| Model record | `HostNamedModelRecord` in a new host store; persisted in unstorage under `local:model-drivers/models/{modelId}` (annotation, driver hint, cached preview, author, timestamps). Never holds the binary. |
| Profile record | `HostModelProfileRecord` under `local:model-drivers/profiles/{profileId}`; one default profile per import. |
| Binding | `extensions.airi.avatar = { driverId, profileId }` next to the existing `modules.displayModelId` (D4). The card remains a reference, never a snapshot. |
| Rows | `ModelSummary[]` returned by the manager is persisted under `local:model-drivers/summaries/{driverId}/{modelId}/{profileId}` so a disabled driver's models stay listed and are shown unavailable (§5.8). |
| Pending payload | `PendingModelPayload` (C12): a host-owned blob in localforage plus a record under `local:model-drivers/pending/{id}` carrying the driver hint, the legacy id **as a label**, and a timestamp. No identity, never loadable. |
| Deletion markers | Generalize the existing `local:sync-metadata/deleted-models/{id}` into the durable marker RFC §13.2 requires; export and restore must respect it. |

Everything in this table is web storage, not manager memory. That is the persisted-state half of the D1 review constraint: the manager can be restarted, moved, or re-elected without a data migration, because the records were never inside it.

`docs/data-catalog.md` gains every new key in the same change.

### 4.6 Driver storage service

One host adapter, implemented once, used by every driver handle:

- **Desktop:** `localforage.createInstance({ name: 'airi-driver-<driverId>' })` for values and blobs; keys are relative to the driver namespace.
- **Isolation:** the host prefixes on write and strips on read; `keys()` returns only this driver's keys; a key outside the namespace is rejected rather than normalized.
- **Watch:** a write posts on an internal `airi:driver-storage:<driverId>` channel so every handle of that driver (mount, panel, picker, manager) observes it, including across windows. The driver decides whether it wants cross-window convergence; the host only reports writes.
- **Concurrency:** last write wins; RFC §10.2 makes convergence the driver's responsibility. The adapter never merges.
- **No interpretation:** the host never reads a driver key, enumerates a driver's layout, or restores a value.

### 4.7 Stub driver and test harness

A complete stub driver is built in this phase, not after it, because every host rule needs a counterpart:

| Piece | Behavior |
| :--- | :--- |
| Manifest | Valid 0.2 declaration, `capabilityDiscovery: static`, `profiles: true`, `cues` including `act`, `expression`, `motion`, `effect`, `profile`, `reset`, `caption`, `capture` |
| Manager | `listModels()` from its storage; answers a change notification; delivery/withdrawal with an in-memory queue |
| Runtime | `activate` (records services), `rendererCapabilities` (complete), provider with two-phase import, profiles, preview (1×1 PNG), capabilities, vocabulary |
| Mount | A plain component that reports the seven readiness states, accepts a `LoadCue`, records cues, answers `occupiesPoint`/`hitTest`, encodes a capture, and can be made to fail on demand |
| Panel / picker | Minimal components that prove the frames, placement filters and `select` contract |

It is used by broker/registry unit tests and by a dev-only smoke route (`/devtools/model-driver-stub`) that exercises mount → load → cue → cancel → capture across two windows.

**Execution units** (each is one reviewable change; P1.1–P1.2 need no Electron wiring)

| Unit | Contents | Done when |
| :--- | :--- | :--- |
| P1.1 | `stage-driver-host` types, registry, transaction table, broker logic, cancellation, mount registry, id minting | Unit tests pass without a transport |
| P1.2 | Driver storage adapter: namespaces, `keys()`, `watch`, isolation | Isolation/watch tests pass; no host reads a driver key |
| P1.3 | Driver-host window (D1): creation, boot, manager load, crash/reload, `backgroundThrottling: false` | A manager answers `listModels` with no display window open |
| P1.4 | Eventa contracts + main service: registry requests, delivery relay, window-gone settlement, enabled flags | Two-window cue round trip with the stub; close-window settles `aborted` |
| P1.5 | Host records, adapter minting, `extensions.airi.avatar` schema (D4), prompt cache store | Card schema tests; a stub binding loads by binding |
| P1.6 | Stub driver + harness + `/devtools/model-driver-stub` route | The full Phase 1 exit list runs from the dev route |
| P1.7 | Backup enumeration and clean-profile restore with the stub (D8 groundwork) | Round trip restores rows, prompt and the stub bundle |

### 4.8 Exit criteria

1. `pnpm -F @proj-airi/stage-driver-host test` covers: registration and version rejection; manager readiness and crash recovery; envelope validation; correlation uniqueness; FIFO; drop; deadline; each withdrawal request and its result table; window-gone settlement; storage isolation and `keys()`; id minting and duplicate rejection.
2. With the stub driver, two Electron windows register mounts, a cue addressed `{ driver, surface: 'stage', purpose: 'actor' }` is applied only in the actor window and acked once, a cue to a surface with no mount settles unapplied, a cue to a not-ready mount drops when requested and otherwise waits, and closing the actor window settles its pending transaction `aborted`.
3. A backup on one profile and a restore on a clean profile bring back the stub's catalogue, rows, prompt and `driverTransfer` bundle — the backup path is exercised in this phase, not left to Phase 8.
4. No real renderer package is imported by the host core, main, or the driver-host window (`grep` guard in §7.3).
5. The app's existing behavior is unchanged: the legacy `RendererStage` path still renders all four formats, and nothing in the UI invokes the new host yet.
6. **Manager restart and empty prompt.** Killing the driver-host window and letting it recover leaves the catalog, rows and bindings intact, and a driver publishing `('', [])` round-trips that empty publication instead of deleting the cache.

---

## 5. Phase 2 — Mounts and host surfaces

**Goal:** the host can mount a driver component on every surface AIRI has, send cues, read readiness and listen to events — still proven with the stub, while the legacy path keeps rendering.

### 5.1 Surfaces, purposes and windows

RFC 0002 §8.2 fixes surfaces and purposes for this revision. The host's current surfaces map as follows:

| Surface | Purpose | Where | Container today | Migrated by |
| :--- | :--- | :--- | :--- | :--- |
| `stage` | `stage` | Control Strip window (`pages/index.vue` → `WidgetStage` → `ControlStripHost`) | `RendererStage` | Phase 3+ per driver |
| `actor` | `actor` | Actor window (`windows/stage`, `/actor`) | `RendererStage` | Phase 3+ |
| `stage` | `chat` | Chat window (`/chat`) | `RendererStage` | Phase 3+ |
| `rehearsal` | `rehearsal` | Rehearsal room tab | `RendererStage` + `ModelCustomizer` | Phase 3+ per driver (`ModelCustomizer` goes in Phase 7) |
| `preview` | `preview` | Settings → Models, onboarding finale, calibration studio, card export | `RendererStage` / four scenes directly | Phase 3+ |
| — (panel) | — | Settings tab, control-strip popover, card editor inline | per-format settings panels | Phase 3+ |

Two rules from the RFC shape the code:

- A **surface is a label, not an identity**. Several mounts share `stage`; nothing may resolve "the" stage.
- A **purpose** carries meaning. A preview mount must not start an idle cycle a live actor would; a chat stage may frame differently.

### 5.2 MountHost

A new host component `MountHost.vue` (in `packages/stage-ui/src/libs/model-drivers/`) replaces the per-format branches **for migrated drivers**:

1. The adapter mints `mountId` before mounting.
2. The adapter resolves the entry point from the manifest for `{ modelDriverId, surface, purpose }`.
3. The host mounts the returned component into a container it owns, with the props of RFC §8.3: `surface`, `purpose`, `paused`, `visible`, `reducedMotion`, `qualityHint`, `interactionMode`, plus `modelDriverId` and, where relevant, `characterId`. **No model prop**: the model arrives by `LoadCue`. **No size prop**: the container's box is the viewport and the mount measures it.
4. The mount registers in the main mount registry with `mountId`, driver, surface, purpose, window, readiness; readiness updates on `state-change`; unregister on unmount/window close.
5. The host listens to the eight events of RFC §8.5 and routes them: `first-frame` hides loading UI, `context-change` drives window-level decisions, `error`/`disposed` update the descriptor, `hit-area-change` moves host overlays, `animation-finished` resolves the caller's motion correlation, `cue-rejected` falls back.
6. Queries: the creating window calls the live instance (`occupiesPoint`, `hitTest`, `stopAll`, `dispose`); any other window names surface+purpose through the manager (C10).
7. `dispose(shallow|deep)` is the host's choice on teardown; a driver that does not declare `dispose` is simply unmounted.

The host container is the viewport. The host passes no size and does not hold a handle to the renderer's canvas, app, camera or scene graph.

### 5.3 Host features that move off the renderer stores

| Feature | Today | After this phase |
| :--- | :--- | :--- |
| Pause/visibility | `stagePaused` and prop chains per renderer | `paused` / `visible` props from the host lifecycle store |
| Interaction mode | `modelStore.interactionMode` written by `use-control-strip-action.ts` and passed to all four scenes | one `interactionMode` prop, gated by the driver's declared `interactionModes` |
| Quality | `modelStore.renderScale` read by `RendererStage.vue:145` | `qualityHint` prop |
| Pointer | four renderers bind their own canvas/window listeners; three coordinate spaces | `RendererPointerService`, one conversion to box-relative CSS px per mount |
| Capture | `captureFrame` exposed on `RendererStage`, `airi:stage-capture` broadcast, per-format ladders | `capture` cue; bytes return in the ack; the broadcast and exposed methods are deleted |
| Readiness | local `componentState: 'pending'\|'loading'\|'mounted'` | the seven contract states with transition validation |
| Head pose / captions | host draws inside the renderer's canvas via `getHeadPose()` / Pixi injection | `CaptionCue`; the renderer draws its own text |

### 5.4 Prompt

- `HostPromptService` keeps the latest publication per `(driver, model, profile)`; AIRI writes it into `extensions.airi.avatar.prompt` **only** while that model/profile is the character's binding (RFC §10.4). Publication is mandatory once the driver is activated for that model/profile; an empty prompt and empty token array are stored as-is and the card cache holds an empty text, which is different from "no publication yet".
- `buildSystemPrompt` reads that field instead of `acting.modelExpressionPrompt`. The context provider that imported two renderer stores (`stores/chat/context-providers/expressions.ts:4-5`) is deleted: RFC 0002 keeps the prompt as driver text that AIRI does not parse, so acting guidance travels inside the publication rather than in a host-composed second line. The legacy `acting.modelExpressionPrompt` is cleared during migration and never written again, so the card cannot hold two competing texts.
- A mismatch between the token-list version and the prompt version is surfaced to the user (fault), not silently used.
- Switching profiles republishes, and the card cache updates; the cost to prefix caching is accepted (RFC §10.4).

### 5.5 Speech

- The host analyzer runs where the audio graph lives (today the ControlStripHost window) and publishes `SpeechAnalysisFrame` (~30 Hz, latest-wins) through `HostSpeechAnalyzerService`; the runtime subscribes and maps frames onto its own rig.
- `mouthOpenSize` / `currentAudioSource` props, the host's `createLive2DLipSync`, and the per-renderer envelope fan-out are deleted as each driver migrates.
- Stage-Mate consumes the same frame stream from the host; it never asks a renderer for an analyser.

### 5.6 Selection, panels and unavailable models

| Concern | Implementation |
| :--- | :--- |
| Driver picker | Mount `entry.modelPicker` in a host dialog frame; props carry the character and its current model; `select` returns only imported `{ modelId, profileId }`. A builtin is imported first (RFC §7.1). |
| AIRI picker | Lists persisted rows; warns when the chosen model cannot load; writes the binding anyway (RFC §7.1). |
| Panels | Host frame + declared chrome (`settings`, `popover`, `inline`); the driver's component fills the body. Panels edit driver storage or send cues, never host state. |
| Replacement | Persist the new binding, clear the previous prompt cache, send `LoadCue`. Failure is surfaced, never silently rolled back (RFC §7.2). The mount survives a model change; only a driver change replaces it. |
| Unavailable | `UnavailableModelReason` drives one view with the actions that are actually possible: enable driver, choose another model, clear binding. The model is kept, not deleted. |

### 5.7 Preview and authorship

- The catalog and card chips read AIRI's **stored copy** (`HostAnnotationFields.preview`), with no driver required.
- A new import asks the driver for a preview while the model is decoded; a failure is reported and does not fail the import.
- The four host preview generators (and their body-mounted canvases) are not called by the host after cutover; they move into the drivers.
- Author (`ModelAuthor`) travels with the row and is cached; legacy `authorIcon` URLs are fetched during migration or skipped with a warning, never stored as if the URL were the image.

### 5.8 Exit criteria

1. The stub driver mounts on `actor`, `stage`/`chat`, `rehearsal` and `preview`, registers in the mount registry, and reports all readiness transitions; an illegal transition is logged and rejected in dev.
2. A cue reaches the stub only on the addressed surface/purpose; capture returns bytes through the ack; cancel/abort/pop/pop-all/abort-current/dump behave per the result table.
3. A driver panel renders in the settings frame and the control-strip popover; a driver picker returns an imported pair; the AIRI picker writes a binding for an unavailable model.
4. A stub-published prompt lands in a test card and is injected into a system prompt; an empty publication is stored as empty text (not as "no prompt"); no host code imports a renderer store for it.
5. Pointer events arrive box-relative for one mount while a second mount is unaffected; no component binds its own listener in the stub.
6. Speech frames drive the stub's mouth value; the host no longer sends a `mouthOpenSize` prop on the new path.
7. All legacy behavior still works; no format is cut over yet.

---

## 6. Phases 3–6 — The four first-party drivers

The order is **Spine → MMD → Live2D → VRM**: smallest surface first, last the one whose camera, transform, meshes, auras and animation storage are most entangled with the host. Each phase migrates one package, runs the cutover checklist (§8.1) for that format's models, and deletes that format's host code. No phase depends on a later one.

### 6.0 Work every driver must do

These are driver-side obligations, not host changes:

| # | Obligation | Why |
| :--- | :--- | :--- |
| D-1 | **Per-instance state.** VRM (`activeVrm`/`activeVrmParser`/`activeVrmIdentity`) and Live2D (`model = shallowRef`) hold one active model in a store singleton; Spine and MMD must be assumed to have the same shape until audited. | RFC 0002 allows a driver to be mounted several times at once (actor + chat + preview). A member of the *store* cannot serve two mounts. |
| D-2 | **`animation-finished` nonce registry.** One-shot completion callbacks are keyed by name or `group#index` today. | The event echoes the transaction correlation value; a driver with two motions in flight must know which finished, and must define "finished" for `repeat: -1`. |
| D-3 | **Edge-triggered `hit-area-change`.** All current emitters send `{ name, x, y, hovered }` per pointer move (Live2D, Spine) or nothing (MMD). | RFC §8.5 is edges only and must also fire when the *renderer* moves the model under a still pointer. |
| D-4 | **`occupiesPoint`.** The helper exists (`composables/canvas-alpha.ts`) but has no consumer; only VRM answers today. | Click-through and fade decisions are window-level and must not be VRM-only. |
| D-5 | **Box-relative pointer conversion.** Live2D divides window px by canvas size; VRM uses `window.innerWidth/Height`; Spine uses backing-store px. | One host conversion; the renderer maps onward into its own space. |
| D-6 | **Model-scoped storage.** Settings are window-global today; only `settings/positioning/models` and `lastModelIdentity` are model-scoped. | The driver owns layout and versioning; two mounts must not overwrite each other's model state. |
| D-7 | **Capability discovery.** Replace host parsing with `modelCapabilities()` (static or runtime as declared). | Host capability lists and runtime lists already disagree (RFC 0001 §2.5). |
| D-8 | **Preview.** Move the format's preview pipeline into the driver and expose `provider.preview` / `ModelDescriptor.preview`. | The host stores a copy; it must not render a format. |
| D-9 | **Profiles.** Represent the appearance state (skin/outfit/mesh set) as driver-owned profiles; `saveProfile` must work with no mount. | RFC §5.2, §7.2; today `AiriOutfit` is host data and `applyOutfit` only pokes VRM weights. |
| D-10 | **Prompt publication.** Publish `(prompt, actTokens, version)` per model/profile at least once (empty prompt/tokens allowed and kept), republish on profile change. | RFC §10.4; replaces `acting.modelExpressionPrompt`. |
| D-11 | **Panel + picker.** Own the settings UI for the format's capability record and the model list. | RFC §11; replaces `ModelCustomizer.vue` and per-format panels. |
| D-12 | **Speech subscription.** Subscribe to `SpeechAnalysisFrame`; delete the mouth prop path. | RFC §12. |
| D-13 | **Capture, stopAll, dispose.** Implement the declared queries; `dispose(shallow\|deep)` only when declared. | RFC §8.6; replaces exposed `captureFrame` and host teardown ladders. |
| D-14 | **Deactivate / purge / transfer / migrate.** Advertise and implement what the driver can do. | RFC §5.10, §10.2; required for disable, uninstall, device move and the legacy bag. |

### 6.1 Phase 3 — Spine

**Why first:** smallest surface. Skins/variants are already profile-shaped, there is no camera, no lip sync, no blink, and its preview path is self-contained.

**Driver work**

- Manifest: `capabilityDiscovery: 'static'`, `occupiesPoint: true`, `hitTest: true`, optional `caption`, no `view`, no `effect`.
- Mount shim over `SpineScene` with the required cue sink: `load`, `motion`, `profile`, `expression`, `caption`, `reset`, `capture`.
- Provider: `probe` from the ZIP/skeleton (the version detector exists), `list`, `remove`, `preview`, `modelCapabilities`, profiles.
- Storage: move `settings/spine/*` (≈15 keys) and placement into driver storage; delete `componentState = 'mounted'` in a `finally` after a load failure (`spine/Model.vue`).

**Host cutover and deletions**

- `stage-model.ts` no longer maps `spine-zip` to a renderer; the binding drives a Spine mount.
- Delete the binary-skeleton candidate tables, byte scan and `"Variant [Skin]"` composition from `display-models.ts`; delete the `spine:...` key parsing and the `SpineScene` branch in `RendererStage.vue`.
- `selectVariantAndSkin`/`playOneShotAnimation`/`shouldUpdateView` calls leave `airi-card.ts`, `ControlStripHost.vue`, `CardEditorForm.vue`, `useActingCapabilities.ts`, `EmotionCalibrationStudio.vue`; they become `ProfileCue`/`MotionCue`.
- Delete `settings/spine/*` from `stores/settings/spine.ts` and `stage-ui-spine/src/stores/spine.ts` after the bag is absorbed.

**Exit:** a Spine model loads by cue on actor + settings preview, plays a motion and reports `animation-finished`, switches a profile, is captured, answers `occupiesPoint`, keeps its settings across restart, and its legacy keys/models are gone.

### 6.2 Phase 4 — MMD

**Why second:** exposes the settings-ownership and asset-companion failure modes cheaply. The ZIP validator already exists with no caller; morphs are a host heuristic capped at 30.

**Driver work**

- Manifest: `capabilityDiscovery: 'runtime'`, `occupiesPoint: true`, optional `caption`, no `view`.
- The MMD package takes ownership of the texture companion: `confirmImport` receives all files (model + textures) in one set; it resolves relative texture paths itself and keeps the mapping in its own storage. The host's `{id}-textures` convention and `mmdTextureMap` prop disappear.
- `probe` uses `validateMMDZip`/`extractMmdFromZip`; the host's 30-morph truncation disappears when morph discovery moves into the driver.
- Move `MorphSlot`, `MORPH_CANDIDATES`, `EMOTION_MORPHS`, `createMorphController`, `resolveMorphName` into the driver; declare the 14 logical slots as `expression` capability units.
- Move physics/IK/gravity, materials, lights/skybox, camera (`cameraFOV`), placement and custom/deleted motions into driver storage. Do not port inert keys.

**Host cutover and deletions**

- Delete the PMX regex parse and 30-morph cap, the hardcoded motion list, `mmdTextureMap` construction in `stage-model.ts`, and `settings/mmd/*` host stores.
- Delete `sync-engine.ts`'s raw MMD store reconciliation (`:1577-1589`) and the selective-sync VMD branch once the driver's own transfer carries them.
- Delete the `MMDScene` branch, `texture-map` prop and `previewExpression` prop from `RendererStage.vue`.

**Exit:** an MMD ZIP with textures imports and loads entirely from driver storage (no `<id>-textures` key), morphs/capabilities match the runtime list, a motion reports completion, settings survive restart, and legacy MMD models are migrated or pending.

### 6.3 Phase 5 — Live2D

**Why third:** the largest UI surface. It exercises static capability discovery, profiles (costumes), captions, hit regions, parameter panels, OPFS and the DSL — and it is the format whose in-canvas caption and pointer paths must be rebuilt rather than ported.

**Driver work**

- Manifest: `capabilityDiscovery: 'static'`, `occupiesPoint: true`, `hitTest: true`, optional `caption`, no `view`; requirements declare the Cubism global and OPFS.
- Mount: per-instance model (D-1); no `model = shallowRef` singleton.
- Move the parameter editor (`ParamAngleX`-style), gimmick deck, emotion/motion mapping and DSL actions behind the driver's panel. The DSL **script** is character content, not driver content: the model-bundled DSL is ignored at load, the host's dating-sim verb parser is kept as the seed of the card-level interpreter, and where the script is stored is tracked as a prerequisite in §7.5. The driver exposes only the actions a cue names (`ProfileCue` for `change_cos`, `MotionCue`, `ActCue`); the intimacy scalar is character state, never driver storage.
- Caption: the driver draws its own head-tethered text from `CaptionCue`; the host stops injecting a Pixi `BatchRenderer` into the app and stops reading `ParamAngleX/Y/Z` per frame.
- Pointer: subscribe to `RendererPointerService`; delete the template `@wheel`/`@pointer*` and canvas/window listeners; move `disableFocusAt`/`followSpeed` into driver storage.
- Lip sync: consume `SpeechAnalysisFrame`; the host's `createLive2DLipSync` and the `mouthOpenSize` 0..100 prop go.
- Delete the `airi-stores-stage-ui-live2d*` channels and the ambient-motion bridge; motion/breath run on the driver's own update loop.

**Host cutover and deletions**

- Delete the Live2D zip/cp437/OPFS imports, the two capability parsers and the multi-model repair from `display-models.ts` (the repair moves into the driver).
- Delete `live2d.vue` and `live2d-customization.vue`; move `LHackerPanel.vue` into the driver's panel set as a dev section (it reads Live2D drawables). Delete the `live2d` branch of `RendererStage.vue`, the `HeadTetheredCaption` Pixi path and the `live2dSceneRef` prop chain.
- Delete the host re-export `packages/stage-ui/src/stores/live2d.ts`.
- Keep the dating-sim verb parser as the seed of the card-level script; its CustomEvents become cues.

**Exit:** a Live2D model loads, emotes by ACT token, plays a caption with sentence timing, reports hit-area edges, captures, answers `occupiesPoint`, keeps costumes as profiles, and survives a settings-window restart with the same model state.

### 6.4 Phase 6 — VRM

**Why last:** most entangled. The host writes camera, transform, mesh visibility, emotion mappings and custom VRMA today; Stage-Mate duplicates placement and lip sync; V-HACK reads raw bytes.

**Driver work**

- Manifest: `capabilityDiscovery: 'runtime'`, `occupiesPoint: true`, `dispose: true`, optional `caption`; declare `view` only once a point-of-interest set exists (the aura sockets are the candidates).
- Mount: per-instance VRM (D-1); delete `window.vrm`/`window.expressionManager`.
- Move camera, transform, render scale, physics switches, lights/skybox, mesh visibility and custom VRMA storage into driver storage; `GazeCue` overrides the live pointer; `ResetCue{ scope: 'view' | 'transform' }` hands framing/placement back.
- Profiles replace `AiriOutfit` + `applyOutfit`: composition rules (base/overlay, mesh sets, expression weights) are the driver's.
- `occupiesPoint` from the render target; `capture` from the renderer's canvas; delete the stubbed `readRenderTargetRegionAtClientPoint`.
- V-HACK and Stage-Mate remain host-side dev/integration tools; V-HACK keeps a driver-declared bridge or moves into the driver panel. Stage-Mate keeps its own placement copy and consumes host speech frames.

**Host cutover and deletions**

- Delete the glTF chunk expression parser, VRM preview import and `vrm-preview` use; delete `settings/stage-ui-three/*` (≈38 keys), `applyOutfit`, `AiriOutfit` handling in the card store, the five `airi-stores-live2d` channel writes and `triggerEmotion`/`triggerMotion`/`triggerVfx` call sites.
- Delete `ModelCustomizer.vue`, `WardrobeMeshTreeNode.vue`, `vrm.vue`, `vrm-expressions.vue` from the host panels; move `HackerPanel.vue` into the VRM driver's panel set as a dev section. Delete the `vrmViewerRef` exposure.
- Delete the `playStatus` chain, `binaryLoaded` and the unused `vrm-instance-cache.ts`.

**Exit:** a VRM model loads, acts, plays a custom VRMA, changes outfit through a profile (not `applyOutfit`), is captured, answers `occupiesPoint`, keeps camera/placement across restart, and Stage-Mate still follows the character with host-published speech frames.

---

## 7. Phase 7 — Final cutover and deletion

**Goal:** the host no longer knows a format. This is the point of no return and the phase that makes the contract pay for itself.

### 7.1 The switch

After all four formats have migrated:

1. `RendererStage.vue` loses its four static imports and its four branches; it becomes (or is replaced by) a thin composition of `MountHost` plus host-drawn background, overlays and control strip.
2. `stageModelRenderer` and the three `switch (model.format)` blocks in `stores/settings/stage-model.ts` are deleted. Selection becomes: read the binding, resolve the driver, mount, send `LoadCue`.
3. The catalogue, card chip, model selector, onboarding vessel step and calibration studio read host rows and bindings, not `displayModelsStore`/`DisplayModelFormat`.
4. The legacy path is deleted only after a release in which all four formats have been migrated and no user-facing surface still needs it.

### 7.2 Shared deletions

| Area | Delete | Replaced by |
| :--- | :--- | :--- |
| Format taxonomy | `DisplayModelFormat` (7 values), `DisplayModel`, `DisplayModelFile/URL/Cloud`, `display-models.ts` (2,375 lines) | `HostNamedModelRecord`, `HostModelProfileRecord`, `ModelSummary`, `PendingModelPayload` |
| Selection | `stageModelRenderer`, `StageModelRenderer` type, `settings/stage/model` | `CharacterModelBinding` + `LoadCue` |
| Capability parsing | VRM glTF chunk scan, Live2D `.exp3` scan, Spine hardcoded candidate tables + byte scan, PMX UTF-16 regex cap, `libs/character/model-capabilities.ts` | `provider.modelCapabilities()` + `CapabilityVocabulary` |
| Preview | 4 preview utils' host imports in `display-models.ts`, `regenerateDisplayModelPreview` dispatch | `provider.preview()` / `ModelDescriptor.preview`, stored copy |
| Assets | `{id}-textures` convention, `mmdTextureMap`, per-format blob URL ownership in `stage-model.ts` | driver storage + `LoadCue` |
| Per-format UI | `ModelCustomizer.vue`, `WardrobeMeshTreeNode.vue`, `vrm.vue`, `vrm-expressions.vue`, `live2d.vue`, `live2d-customization.vue`, `mmd.vue`, `spine.vue`, `ModelSceneSettings.vue` | driver panels |
| Picker | `model-selector.vue` per-format intake/report/repair branches | driver pickers + `probe`/`confirmImport` |
| Stores | 5 renderer BroadcastChannels, `packages/stage-ui/src/stores/live2d.ts` re-export, `stores/settings/{live2d,spine,mmd}.ts`, per-format store reach-ins | `HostServices`, cues, panels, driver storage |
| Speech | `mouthOpenSize`, `currentAudioSource`, host `createLive2DLipSync`, per-renderer envelope fan-out | `SpeechAnalysisFrame` + driver subscription |
| Captions | `HeadTetheredCaption.vue` Pixi injection, `HeadTetheredCanvas2D.vue` in-canvas drawing, `getHeadPose`, `HeadPose` | `CaptionCue` |
| Capture | `captureFrame`, `readRenderTargetRegionAtClientPoint`, `airi:stage-capture`, the stubbed call sites | `capture` cue + `occupiesPoint` |
| Motion plumbing | `playStatus` chain, `binaryLoaded`, `vrm-instance-cache.ts`, `shouldUpdateView`, `triggerEmotion`/`triggerMotion`/`triggerVfx`/`playOneShotAction`/`selectVariantAndSkin`/`previewExpression`/`resetState` | `ActCue`, `MotionCue`, `EffectCue`, `ProfileCue`, `ResetCue` |
| Card fields | `cueAllowlist`/`compiledWhitelist`; `active_expressions` weights; `AiriOutfit.meshes/expressions` | driver vocabulary + `ProfileCue` (see §7.5) |
| Stage-Mate | its writes to `settings/positioning/models` | its own window config, imported once (the old plan's D16, still valid) |

### 7.3 Architecture guards

Enforced as Vitest source-scan tests (the pattern already used by `packages/stage-ui/src/components/scenes/runtime.test.ts`), not as a lint rule nobody runs:

1. **No host import of a renderer package** outside `**/src/driver/**`, the driver table, devtools and tests: `@proj-airi/stage-ui-(three|live2d|spine|mmd)` must not appear in `packages/stage-ui/src`, `packages/stage-pages/src`, `packages/stage-layouts/src`, `apps/*/src` (except the allowlisted driver/devtool paths).
2. **No format taxonomy in the host**: `DisplayModelFormat`, `DisplayModel`, `stageModelRenderer`, `display-model-` (outside the migration module and its tests).
3. **No renderer channels**: `airi-stores-` anywhere.
4. **No renderer settings keys** read by the host outside the migration module: `settings/(stage-ui-three|live2d|spine|mmd|positioning)/`.
5. **No renderer viewport reach-through**: `captureFrame`, `getHeadPose`, `HeadPose`, `live2dApp`, `vrmViewerRef`, `texture-map`, `preview-expression`, `mouthOpenSize`.
6. **Host core stays platform-neutral**: `packages/stage-driver-host` has no Vue, no Electron, no Pinia dependency.
7. **The contract stays format-free**: no `vrm|live2d|spine|mmd` outside comments in the SDK; no runtime value beyond `MODEL_DRIVER_CONTRACT_VERSION`.

A guard is only added when its target is actually removed, so the suite stays green through the migration instead of failing for every format not yet cut over.

### 7.4 Documentation and catalogue upkeep

- `docs/data-catalog.md`: new host record keys, pending payloads, markers; correct the stale §3.2 record shape.
- `docs/rosetta-stone.md`: add the registry/adapter/manager/broker entry points; remove `display-models.ts` as a canonical model entry.
- `docs/project-testing-parity.md`: register the new suites (`stage-renderer-sdk` validators, `stage-driver-host` broker, stub harness, architecture guards).
- `.agents/skills/airi-character-rendering/SKILL.md`: repoint paths to drivers; add a new skill `airi-model-driver-host` once Phase 2 lands, because "how the driver host works" is an independently useful query scope.
- Delete one-time migration tables one release after their format migrates (§8.8), and keep the durable records/markers.

### 7.5 Deferred (must not be smuggled in)

- **Card-level outfit/expression storage.** `AiriOutfitSchema` persists renderer-native `meshes`/`expressions`, and `active_state.active_expressions` persists renderer keys written by Concept/manifestation code. Profile ids should replace both. Until that schema change lands:
  - each driver must accept the legacy outfit payload once through its migration bag and keep its capability keys stable;
  - the card's outfit picker is replaced by the driver's profile panel/picker (a presentation change, not a data migration);
  - no driver may rename a capability unit that the card persists until the profile-id schema ships.
- **Script ownership.** The Live2D model-bundled DSL stops executing at its driver cutover. The host's dating-sim parser is kept and its verbs become cues (`start_mtn` → `MotionCue`, `clear_exp` → `ResetCue`, `change_cos` → `ProfileCue`), so the feature keeps working without a renderer API. Moving the script into the card schema is a separate follow-up, not a driver blocker; the character-state parts (variables, intimacy) never enter driver storage.
- **Stage-Mate as a second VRM mount.** Possible only after VRM is a driver and the sidecar can consume a mount channel; not this release.
- **Third-party packaging.** `dist`, `.d.ts`, `peerDependencies.vue`, installation and sandboxing are out of scope.

### 7.6 Exit criteria

1. Every guard in §7.3 passes.
2. `pnpm -F @proj-airi/stage-ui typecheck`, `stage-pages`, and each renderer package typecheck pass; `apps/stage-tamagotchi` builds (its build includes typechecking); `apps/stage-web` builds (its build does not typecheck, so run the affected workspace typecheck separately).
3. A clean profile can import one model of each format, bind it to a card, render it on actor + chat + settings preview, and restart with the same result.
4. No host file reads a renderer store; no renderer package imports host UI.

---

## 8. Phase 8 — Migration, backup and transfer

**Goal:** existing users keep their models, annotations, previews, appearance, layout and prompt across the cutover; a crash at any point is resumable; deletion is durable.

### 8.1 Cutover checklist, per model

Run once per legacy `DisplayModel`, in this order. Every step is per item and idempotent.

1. **Record.** Create `HostNamedModelRecord`: `modelId` = the legacy id (D4); `modelDriverHint` = the format's driver; copy `name` → `displayName`, `nsfw`/`groups`/`tags`, rebuild `searchKey`. Mint the model's default `profileId` here, before any load can need it.
2. **Preview.** Copy `previewImage` to `HostAnnotationFields.preview` **only when it is already a data URL**; fetch an asset URL during migration or skip it with a warning — never store an address as if it were the image.
3. **Settings.** Build the driver's legacy bag (§8.3) and call `migrate`; write `driver-migration/{driverId}` only after `absorbed: true`.
4. **Bytes.** Build `ModelProbeInput` from the host's own store — the localforage blob plus `{id}-textures` files in one `files` set with aligned names, or the URL for URL models — call `probe`, then `confirmImport` with the preserved `modelId`, the minted `profileId`, `overwrite: true`, and a migration marker. Delete the legacy blob **only after** `ok: true`; write `model-migration/{modelId}`.
5. **Profiles.** Convert card `outfits` into driver profiles through the bag (the driver owns the composition); write the default profile; keep the card's outfit names as annotations only.
6. **Prompt.** Hand `acting.modelExpressionPrompt` to the driver in the bag (D5), scoped to the legacy selected model; the first publication becomes `extensions.airi.avatar.prompt.text`, and the legacy acting field is cleared.
7. **Binding.** Ensure the card's `modules.displayModelId` still resolves and write `extensions.airi.avatar = { driverId, profileId }`. No card re-binding is required for models whose ids were preserved.
8. **Placement.** Delete the model's `settings/positioning/models` entry only after step 3 or 4 confirmed the driver absorbed it.
9. **Delete legacy.** Remove the `DisplayModel` row and that format's settings keys, then the host code that read them.
10. **Mark.** Write the durable deletion marker for anything removed (§8.4).

Crash safety: a crash between 4 and the blob delete leaves both sides intact; the next launch re-runs 1–4 as a no-op. Nothing is deleted before its marker exists; step 2 must precede step 9 or the thumbnail disappears with the record it came from.

### 8.2 Legacy references

- A legacy reference is resolved by **exact legacy id**, then the **alias table** (`MODEL_ID_ALIASES` today: `hiyori-free`, `hiyori-pro`, `avatar-sample-a/b`), then by **asking the user** what the model was.
- A reference none of these resolves is **not** an unavailable model: the binding is cleared, the user chooses another model, and the result is never presented as `model-missing` (RFC §13.2).
- A model the user does not confirm is neither deleted nor imported: it becomes a `PendingModelPayload`, listed under the character, operable, importable later. Its legacy id travels as a **label**, not an identity.
- A preset is a builtin: importing it goes through the driver's own path; a card that references a builtin imports it inside the card's confirmation.
- A legacy preview that is an address is fetched and stored, or skipped with a warning.
- Legacy deletions are recorded, not silently performed: the existing `local:sync-metadata/deleted-models/{id}` marker is generalized and respected by export and restore, so a deleted model cannot come back from a backup or a second device.

### 8.3 The legacy settings bag

- One bag per driver, built from a host-side key table that lives only as long as the migration (it encodes knowledge the contract forbids).
- Contents: the driver's `settings/<format>/*` values, the model's `settings/positioning/models` entry, the card's `outfits` for that model, the selected model id (window-global values need to know which model they described), and the model prompt (D5).
- Offered **once per driver**, after `activate` and before the first mount. The driver absorbs the whole bag and reports `{ absorbed, warnings }`. The host deletes the bag only on `absorbed: true`, then writes `driver-migration/{driverId}`.
- `migrate` MUST be idempotent: a crash between the driver's write and the marker re-offers the same bag, and a second call is a no-op.
- A driver that answers `migration: false` has nowhere to put the bag: keep the keys for one release and show one toast naming what could not be imported. Deleting immediately turns a missing member into silent data loss.

### 8.4 Deletion, export and restore markers

- **Durable markers**: `driver-migration/{driverId}`, `model-migration/{modelId}`, and the generalized deletion marker. These are the only record that a device has been migrated, and they survive the cleanup in §8.8.
- **Prune protection** must read the new binding records instead of scanning card fields (`display-models.ts:1753-1767` today).
- **Export/restore** respects the marker: a restore does not resurrect a model the user deleted, and re-importing a bundle carrying an id AIRI already holds is `model-id-conflict`, not an upsert (RFC §5.5).

### 8.5 Backup and device move

- The backup enumeration must include: host model/profile records, row caches, pending payloads, markers, and each driver's `driverTransfer` bundle. Without the last one, a restore brings back a catalogue against an empty driver.
- `driverTransfer` transfers the **whole driver state** as an opaque bundle; what could not be restored is reported as warnings, and a partly restored driver is better than a failed one.
- A pre-contract backup is read by a legacy reader that imports models fully during restore (two-phase import), writes deletion markers for what it consumed, and is retained as long as the legacy backup format can be restored. The format carries a version; an explicit cutoff declares older backups unsupported (D8).
- The round trip — backup on profile A, restore on a clean profile B — is a Phase 1 exit criterion with the stub and a Phase 8 exit criterion with real drivers, not a later afterthought.

### 8.6 Two stores during migration

Formats migrate one at a time, so AIRI holds both sources: legacy models still in its own storage, and rows from migrated drivers. One list contains legacy models under their legacy ids, pending payloads, and driver rows side by side. A model has exactly one owning source.

A driver's cutover imports/commits every model the user confirmed, moves the rest to pending, and only then removes that format's legacy rendering path. After the cutover, that slice leaves AIRI's storage; the legacy store is deleted when the last driver has migrated.

### 8.7 Web, Pocket and quota

- The same cutover runs on Pocket with a smaller quota and without OPFS everywhere. Run the checklist on Pocket **before** deleting that format's legacy keys, and treat a skipped model there like any other skip: visible, retryable, never silent.
- Re-import doubles that model's storage while it runs: migrate one model at a time, gated on `navigator.storage.estimate()`; on a shortfall skip with a warning and keep the model legacy-shaped rather than half-migrated.
- Stage-Web's in-process host runs the same checklist; its storage is the same IndexedDB origin.

### 8.8 The one-time code must expire

The key table, the format→driver table and the checklist encode renderer knowledge on the host — exactly what the contract forbids. They are allowed only because they are deletable:

- each format's table entry and checklist step are removed in the release after its models are migrated;
- the records, `driver-*` markers and deletion markers stay.

If a migration table outlives its migration, the host owns renderer storage knowledge again, this time with no contract keeping it honest.

### 8.9 Exit criteria

1. Every legacy model of a migrated format appears under its old id with annotations and preview; a second launch re-imports nothing.
2. Settings and placement survive: the same model loads where the user left it, with the same profile/alias table bound.
3. A simulated crash between `confirmImport` and the blob delete leaves the model intact on the next launch, with no duplicate.
4. A clean-profile restore brings back the catalogue, the prompt, the profiles and the driver's own bundles.
5. A deleted model stays deleted after a restore from an older backup.

---

## 9. Testing and validation

Validation is layered because the risk is layered: contract shapes, broker semantics, driver behavior, data migration, and host surface composition.

### 9.1 Contract and host core (runs in CI)

| Suite | What it asserts |
| :--- | :--- |
| `packages/stage-renderer-sdk/src/validate.test.ts` | manifest validation, compatibility predicate, capability completeness, envelope rules (capture alone, target required), ack shape, token-list/prompt version comparison, mandatory publication + empty-publication semantics |
| `packages/stage-driver-host/src/broker.test.ts` | accept → settle, correlation uniqueness, FIFO, drop, deadline + late-ack discard, six withdrawals and the §9.7 result table, window-gone, bounds |
| `packages/stage-driver-host/src/registry.test.ts` | declaration registration, version rejection, enable/disable, manager ready/crash, re-enumeration |
| `packages/stage-driver-host/src/storage.test.ts` | namespace isolation, `keys()` scope, `watch` propagation, concurrent writes |
| `packages/stage-driver-host/src/stub-driver.test.ts` | the stub through every host rule, including a failing mount and a refusing cue |
| `packages/stage-ui/src/libs/model-drivers/*.test.ts` | records store, binding write/clear, prompt cache, unavailable-reason mapping |
| Architecture guards (§7.3) | source scans that keep the host format-free |

Commands:

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/stage-renderer-sdk test
pnpm -F @proj-airi/stage-driver-host test
pnpm -F @proj-airi/stage-ui typecheck
```

### 9.2 Per-driver runtime smoke (manual or Electron E2E, not CI-only)

For each migrated format, in the actor window unless noted:

1. Load by cue; observe `ready-for-model` → `loading-model` → `model-loaded`; `first-frame` hides the loading UI.
2. ACT emotion, expression, motion (with `animation-finished`), effect where declared.
3. Profile switch; restart and confirm the profile persisted.
4. Caption with sentence timing where declared.
5. Capture through the ack; verify mime/size; verify a refused capture is a rejected outcome, not a failure.
6. Hit test and `occupiesPoint` (click-through), where declared.
7. Pause/visibility, `dispose(shallow)` then remount (fast path), `dispose(deep)` on model switch.
8. Cross-window cue: actor and chat both mounted; a cue addressed to `{ surface: 'stage', purpose: 'actor' }` affects only the actor.
9. Settings preview: a second mount of the same model while the actor is live; no state bleed.
10. Rehearsal room: driver panel and token insertion still work.

Run the same list once on Web and once on Pocket for each format, and once with a second monitor/DPI scale for VRM/Live2D.

### 9.3 Migration tests

- A fixture `DisplayModel` of each format, imported through the cutover, asserting identity, preview, profile, bag absorption, byte ownership and marker writes.
- Crash injection: kill between steps; re-run; assert idempotency and no duplicate rows.
- A model skipped on a simulated quota shortfall remains listed as legacy/pending and retryable.
- Backup round trip on a clean profile for each driver that declares `driverTransfer`.
- Deletion + restore: marker respected.
- Manager restart: kill the driver-host window during a pending transaction; the catalog and bindings survive, the transaction settles, and a fresh manager re-enumerates the same rows.
- Empty publication: `('', [])` persists with its version and does not clear the cache.

### 9.4 Builds

- Per phase: affected workspace typechecks (`stage-ui`, `stage-pages`, each renderer package, `stage-tamagotchi` typecheck).
- At a phase that changes main-process wiring, renderer routing or packaging: `pnpm -F @proj-airi/stage-tamagotchi build` (includes typecheck) and `pnpm -F @proj-airi/stage-web build`.
- `pnpm lint:fix` is not validation; if used, review the whole diff.

### 9.5 What cannot be tested in CI

WebGL/WebGPU, Cubism runtime, Spine runtime, audio devices, multi-monitor DPI and Electron window behavior are manual smoke targets. The plan does not pretend otherwise: the stub driver covers host semantics, and §9.2 is the only proof that a driver draws.

---

## 10. Risk register

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Manager placement (D1) adds a hidden renderer and a startup dependency | Boot complexity; catalog temporarily empty | Persist rows; create the host window after app-ready without blocking the main window; recreate on crash; web/pocket use in-process |
| The manager host restarts or is moved later | Model list or enabled state lost; duplicate owners | All essential state is in host web storage (§4.5); no election while one host exists; if moved, one-owner election + re-read, never two managers |
| Contract churn after Phase 1 | Rework across four drivers | Phase 0 closes C1–C21 before any consumer; revision bump discipline; validators |
| A driver keeps a store singleton (`activeVrm`, Live2D `model`) | Two mounts overwrite each other | D-1 is a per-driver exit criterion; settings preview is the mandatory second mount in every smoke list |
| Re-import doubles storage during migration | Quota exhaustion on Pocket/low-end | One model at a time, gated on `estimate()`; skip with warning; delete legacy only after success |
| ACT alias tables have no model attribution (`settings/live2d/emotion-mappings`) | One user's mappings land on the wrong model | Hand the single global key to the Live2D driver once, apply to the selected model, say so in a toast; per-model re-binding happens in the driver panel |
| Existing user-authored model prompt is lost | Visible regression in acting quality | D5: pass it in the bag; driver may adopt it; surface the loss once if it declines |
| Stage-Mate diverges (placement, lip sync) | Two avatars disagree | It keeps its own placement (imported once) and consumes host speech frames; cue forwarding keeps ACT/motion in sync |
| Crash or window close mid-transaction leaves a caller waiting | Hanging promises | Window-gone settlement (`cancelled`/`aborted`) is a Phase 1 exit criterion; deadlines are enforced |
| A driver declares capabilities it cannot honor | Wrong UI offered | Probe is the truth; host reads probe before offering; a cue may still be refused, which is a normal outcome |
| Caption/head-tether regression | The most visible feature breaks | `CaptionCue` implementation is per-driver work in the same phase; host keeps an optional overlay fallback that does not depend on driver head pose |
| Migration tables outlive the migration | Host re-learns renderer storage | §8.8: delete each format's table entry one release after cutover |
| Legacy backup format drifts | Old backups unrestorable | Keep a versioned reader with an explicit cutoff (D8); test one pre-contract backup per release |

---

## 11. Definition of done

The contract is implemented when all of the following are true, not when the last file compiles:

- [ ] RFC 0002 has a 1:1 contract mapping, validators and tests; `MODEL_DRIVER_CONTRACT_VERSION` is bumped for any breaking shape.
- [ ] A registry, adapter, manager host, broker, mount registry, transaction table and driver storage exist and are used by every format.
- [ ] Four first-party drivers implement manifest, manager, runtime, provider, mount, panel, picker, storage, profiles, prompt, preview, speech and the declared queries.
- [ ] Every host surface (actor, stage/chat, rehearsal, preview/settings, onboarding, card export) mounts through the driver path.
- [ ] Cues, acknowledgements, refusals, failures, drops, deadlines, cancellations and window-gone settlement all follow RFC 0002.
- [ ] No host file imports a renderer package; no host file knows a format; the guards prove it.
- [ ] Existing models, previews, annotations, settings, placement, outfits-as-profiles and prompts survive the migration; crashes resume; deletion is durable; backups round-trip.
- [ ] Web and Pocket pass the same smoke list as Electron (minus desktop-only surfaces).
- [ ] Docs, data catalogue, test catalogue, Rosetta Stone and the relevant skill are updated; one-time migration tables are scheduled for deletion.

---

## Appendix A — Current host/renderer coupling inventory

Scope: `packages/stage-ui`, `packages/stage-pages`, `packages/stage-layouts`, `apps/stage-tamagotchi`, `apps/stage-web`, `apps/stage-pocket`, excluding `node_modules`/`dist`. Counts are from the working tree at the time of writing.

### A.1 Static imports of renderer packages (75)

| Area | Files (anchor is the import block) | What is imported |
| :--- | :--- | :--- |
| stage-ui scenes | `components/scenes/RendererStage.vue:3-6`; `components/scenes/index.ts:8`; `components/scenes/HeadTetheredCaption.vue:2-6`; `components/scenes/ControlStripHost.vue:15-18` | 4 scenes + 4 stores + Live2D caption attach + VRM trace |
| stage-ui stores | `stores/live2d.ts:1` (re-export); `stores/display-models.ts:1,10-15,26-27,59`; `stores/sync-engine.ts:1577,1778`; `stores/dating-sim.ts:721`; `stores/modules/airi-card.ts:8-10,889`; `stores/modules/discord.ts:25-26`; `stores/chat/context-providers/expressions.ts:4-5` | stores, preview utils, loaders, VFX, capability types |
| stage-ui composables | `use-idle-animations.ts:1-2`; `use-expression-curation.ts:5-8`; `use-data-maintenance.ts:12`; `use-control-strip-action.ts:1`; `features/motions/live2d/use-live2d-stage-ambient-motion.ts:11` | four stores, animation options, motion control |
| stage-ui settings | `model-settings/index.vue:4-5,31-34`; `vrm.vue:2`; `vrm-expressions.vue:2`; `spine.vue:2`; `mmd.vue:2`; `live2d.vue:2-3`; `live2d-customization.vue:2`; `live2d-lhack/LHackerPanel.vue:7`; `vrm-vhack/HackerPanel.vue:4`; `ModelCustomizer.vue:2-3,14-17`; `components/WardrobeMeshTreeNode.vue:2` | panels, capability types, OPFS |
| stage-ui other UI | `ControlStrip.vue:4-7`; `EmotionCalibrationStudio.vue:4-7`; `selective-sync-panel.vue:2-3`; `model-selector/model-selector.vue:2,6-9`; `model-selector/Live2DReportModal.vue:2`; `onboarding/v3/steps/step-finale.vue:2` | stores, validators, extractors, animations |
| stage-pages | `settings/airi-card/composables/useActingCapabilities.ts:4-8`; `use-card-export.ts:474-475,484-485`; `components/CardEditorForm.vue:7-11`; `pages/devtools/beat-sync.vue:2-4`; `pages/settings/providers/motion/flowmdm.vue:4` | four stores, preview, beat sync |
| apps | `stage-tamagotchi`: `chat_rehearsal.vue:5-8`; `pages/index.vue:15-16,22`; `pages/devtools/stage-vfx.vue:7,12`; `pages/devtools/live2d.vue:6,10`; `stores/tools/builtin/generate-motion.ts:3`; `bridges/stage-three-runtime-trace.ts:17`; `stores/stage-three-runtime-diagnostics.ts:13,28`. `stage-web`: `devtools/performance-playground.vue:5-6`; `devtools/model-driver-mediapipe.vue:6-7`; `devtools/live2d.vue:5`; `devtools/polaroid.vue:2`. `stage-pocket`: `devtools/performance-playground.vue:5-6`; `devtools/polaroid.vue:2` | stores, scenes, animations, trace |
| package/build metadata | `packages/stage-ui/package.json:94-97`; `packages/stage-pages/package.json:35-37`; `apps/stage-tamagotchi/package.json:59-61`; `apps/stage-tamagotchi/electron.vite.config.ts:174-175,213`; `apps/stage-tamagotchi/tsconfig.web.json:30,33`; `apps/stage-web/package.json:37`; `apps/stage-pocket/package.json:50` | workspace deps, aliases, TS paths |

### A.2 Format-branch hotspots (117 rows; top 30)

| Anchor | Branch |
| :--- | :--- |
| `stores/settings/stage-model.ts:11,138-156,200-209,262-280` | `StageModelRenderer` union + three `switch (model.format)` copies |
| `stores/display-models.ts:29-37,665-770,773-1160,1197-1231,1244-1250,1515-1580,1946-2285` | format enum; Spine repair; Live2D split; preview dispatch; capability parsers |
| `components/scenes/RendererStage.vue:112,156-163,167-169,179-213,455-555,567-580` | ambient motion, canvas, capture, four `v-if` mounts, caption/radial refs |
| `components/scenes/ControlStripHost.vue:270-424,1130-1132` | VRM/Live2D/Spine/MMD emotion+motion routing, MMD texture prefetch |
| `components/scenarios/settings/model-settings/index.vue:92,131-137,158,203-260,333-362` | Live2D Y negation, capture, preview scenes, panels, hack panels |
| `components/scenarios/settings/model-settings/ModelCustomizer.vue:83-96,103-126,360-372,395-446,790-848,929-948,1019-1027,1087-1126` | format map, capability gate, active state, triggers, VFX tab, idle prefixes, tab gating |
| `components/scenarios/acting/EmotionCalibrationStudio.vue:125-156,251-260,349-373,667-670,1048` | model-type triple fallback, vocabularies, triggers, counts, VRM-only framing |
| `components/scenarios/layout/ControlStrip.vue:142-149,958-1148,2614` | format filter, motion/expression lists, play/clear, wardrobe refusal |
| `components/scenarios/dialogs/model-selector/model-selector.vue:56-80,104,222-233,367-387,450-498,730-828` | format label map, filter, counts, per-format import |
| `composables/use-idle-animations.ts:19-40`; `use-expression-curation.ts:288-318`; `use-data-maintenance.ts:296,593` | idle sources; preview dispatch; ZIP allow-list |
| `stores/modules/airi-card.ts:876-894`; `stores/modules/discord.ts:1550-1556`; `stores/dating-sim.ts:721-751` | card sync mappings; selfie; Live2D mood |
| onboarding `step-vessel.vue:93-111,144,379-419`; `step-finale.vue:56-58,128-155`; `step-tools.vue:35`; `useStarterCardCommit.ts:298-308` | per-format catalog, filter, demo, tool/artistry gating, 2D/3D classification |
| `packages/stage-ui/src/libs/vfx/sockets/*`; `utils/vrmaBuilder.ts`; `types/three-mmd.d.ts` | VRM/MMD socket and binary vocabulary |

### A.3 Renderer-store reach-ins (74; grouped)

| File | Stores touched |
| :--- | :--- |
| `ControlStrip.vue:489-495,945,958-1148` | all four — motion/expression/wardrobe pickers |
| `ControlStripHost.vue:102-104,163-173,217-422,1788-1789,1960` | all four — cue routing, reload pings, thinking motion |
| `ModelCustomizer.vue:69-72,119-165,263-372,396-399,430-441,642-749,791-948` | all four + Live2D VM/params |
| `RendererStage.vue:106-109,145,361-372,479-547` | VRM/MMD/Live2D — scale, interaction mode, dating-sim writes |
| `airi-card.ts:456-457,831-894,1432-1468` | Live2D/Spine/VRM — card sync + outfits |
| `use-expression-curation.ts:64-67,289-316`; `use-idle-animations.ts:9,30-37`; `use-control-strip-action.ts:45-93` | all four — preview/idle/interaction |
| `EmotionCalibrationStudio.vue:98-102,355-372,667-670`; `model-settings/*.vue` (5 files); `live2d.vue`; `live2d-customization.vue`; `spine.vue`; `vrm.vue`; `vrm-expressions.vue`; `HackerPanel.vue`; `LHackerPanel.vue` | per-format settings |
| `chat_rehearsal.vue:53-56,396-415,686`; `pages/index.vue:87,129-130,679-768`; `generate-motion.ts:79-105` | app-level stages and tools |
| `stage-pages` `CardEditorForm.vue:125-141,638`; `useActingCapabilities.ts:52-67,135`; `use-card-export.ts:477-488`; `flowmdm.vue:56` | card editor and providers |
| `stores/sync-engine.ts:1589,1780-1781`; `selective-sync-panel.vue:378-462`; `use-data-maintenance.ts:783` | sync and reset paths |

### A.4 Channels carrying renderer state (17 names)

| Channel | Publishers → subscribers |
| :--- | :--- |
| `airi-stage-model-ready` | `RendererStage`, actor window → `App.vue` startup gate |
| `airi:stage-capture` | Control Strip, card grid, Discord → `RendererStage` capture |
| `airi:stage-selfie-viewfinder` | Control Strip, card grid → actor window |
| `airi-caption-overlay` | speech/caption producers, renderer pages → caption panel, head-tethered captions, dating sim |
| `airi-chat-stream` | chat session → captions |
| `airi-chat-present` | `ControlStripHost` |
| `airi-speaking-state` | `ControlStripHost` → actor/chat/rehearsal mouths, `chat.ts` |
| `airi-control-strip-actions` | customizer/strip → stage pages |
| `airi:display-models-sync` | `display-models.ts` across windows |
| `live2d-dsl-bridge`, `dating-sim-sync` | dating-sim ↔ Live2D |
| `airi::stage-three-runtime-trace` | VRM trace bridge |
| `airi-stores-live2d` (VRM store), `airi-stores-stage-ui-live2d`, `airi-stores-stage-ui-live2d-motion-control`, `airi-stores-stage-ui-spine`, `airi-stores-stage-ui-mmd` | renderer package stores |

### A.5 Mount sites (30)

| Site | Mount |
| :--- | :--- |
| `RendererStage.vue:454-483` | `Live2DScene` with ~20 props + 3 events |
| `RendererStage.vue:484-510` | `ThreeScene` with VRM props, `@binary-loaded` → V-HACK |
| `RendererStage.vue:511-533` | `SpineScene` |
| `RendererStage.vue:534-555` | `MMDScene` with `texture-map`, `preview-expression` |
| `RendererStage.vue:566-594` | head-tethered caption + radial menu |
| `ControlStripHost.vue:2004-2014` | `RendererStage` (web path) |
| `model-settings/index.vue:205-274` | four scene components |
| `EmotionCalibrationStudio.vue:1077-1091`; `step-finale.vue:595-609`; `chat_rehearsal.vue:1329-1342`; `chat.vue:1963-1976`; `actor.vue:561-582` | `RendererStage` surfaces |
| `apps/*/pages/index.vue` (`index.vue:948-959` desktop; web `:242-255`; pocket `:267-279`) | `WidgetStage` |
| Devtools | `Live2DCanvas`/`Live2DModel`, `ThreeScene`, custom Three scene (`stage-vfx.vue`) |

### A.6 Model data and asset paths

| Kind | Path/key |
| :--- | :--- |
| Local model record | localforage default DB, `display-model-{nanoid}` (record incl. `File`), `{id}-textures` (MMD) |
| URL/preset models | raw id (`preset-live2d-1`, `preset-vrm-1`, …), `MODEL_ID_ALIASES` |
| Catalog caches | `local:display-models/metadata-cache`, `local:sync-metadata/remote-catalog-cache`, `local:sync-metadata/preview-updated/{id}` |
| Deletion | `local:sync-metadata/deleted-models/{id}` |
| Remote layout | `assets/models/manifest.json`, `{id}.bin`, `{id}-textures.json`, `{id}-preview.png`; `assets/mmd/manifest.json`; `assets/vrma/manifest.json` |
| Stage-Mate | `{userData}/stage-mate-cache/{modelId}.vrm`, `{modelId}.outfits.json` |
| Card | `modules.displayModelId`, `active_state.displayModelId`, `outfits`, `acting.modelExpressionPrompt`, `modules.{vrm,live2d}` legacy blocks |
| Per-model settings | `settings/positioning/models` (only model-keyed map) |
| Per-format settings | ≈110–120 keys in `settings/{stage-ui-three,live2d,spine,mmd}/*` (VRM ~38, Live2D ~18, Spine ~15, MMD ~42) |

### A.7 Panels and pickers

| Host surface | Current implementation |
| :--- | :--- |
| Settings → Models | `model-settings/index.vue` + `vrm.vue`, `vrm-expressions.vue`, `live2d.vue`, `live2d-customization.vue`, `mmd.vue`, `spine.vue`, `ModelCustomizer.vue`, `ModelSceneSettings.vue`, `HackerPanel.vue`, `LHackerPanel.vue` |
| Control Strip | motion/expression/wardrobe pickers in `ControlStrip.vue:949-1148` |
| Card editor | `CardEditorForm.vue` acting tab, `useActingCapabilities.ts` |
| Model selection | `model-selector.vue`, `ControlStrip.vue:109-155`, onboarding `step-vessel.vue` |
| Acting/calibration | `EmotionCalibrationStudio.vue`, `ModelPromptGeneratorModal.vue` |

### A.8 Renderer-internal vocabulary in host code

| Vocabulary | Anchor |
| :--- | :--- |
| Live2D parameter ids (`ParamAngleX`, `ParamMouthOpenY`, `ParamBreath`, …) | `model-settings/live2d-customization.vue:79-104` |
| Live2D motion groups (`Happy`, `Face#2`, `exp12`) | `constants/emotions.ts:16-37`; `dating-sim.ts:725-735`; `ControlStripHost.vue:307` |
| VRM expression names (`Fun`, `Joy`, `Blink_L`, `Sorrow`) | `constants/emotions.ts:40-51`; `EmotionCalibrationStudio.vue:294-329` |
| VRM humanoid bones, `VRMC_vrm_animation` | `utils/vrmaBuilder.ts:6-23,224-228`; `libs/vfx/sockets/VrmSocketResolver.ts:17-109` |
| Spine skins/animations candidates | `display-models.ts:2149-2191`; `model-settings/spine.vue` |
| MMD morph slots/candidates | `libs/character/model-capabilities.ts`; `mmd.vue`; `ModelCustomizer.vue` |
| `getHeadPose` shape | `HeadTetheredCanvas2D.vue:37-45`; `HeadTetheredRadialMenu.vue:298-306` |
| Live2D Pixi app injection | `HeadTetheredCaption.vue:111-134` |
| Live2D lip-sync types | `ControlStripHost.vue:11-12,179-180,1686-1688` |

### A.9 Test coverage today

| Area | Coverage |
| :--- | :--- |
| Import / format detection | partial — MMD variant detection and URL extension tagging only |
| Store CRUD / metadata cache / alias table | none |
| Texture companion | none |
| Capability extraction from bytes | none (label normalization only) |
| Preview generation | none |
| Card→model binding / prompt | none (schema test covers cue allowlist only) |
| Sync reconciliation | none for model manifests |
| Renderer mounting | `runtime.test.ts` guards against a specific runtime import; no functional mount test |

This is why §9 builds the stub harness before touching a real driver: the riskiest code in the migration is currently the least tested.

---

## Appendix B — How this supersedes the RFC 0001 migration plan

[`docs/design-stage-renderer-migration.md`](../../docs/design-stage-renderer-migration.md) remains a useful per-renderer inventory (it lists legacy keys, defects and deletion candidates), but its architecture is RFC 0001's. The following differences are why the plan above is a rewrite, not an update:

| Topic | RFC 0001 plan | RFC 0002 / this plan |
| :--- | :--- | :--- |
| Sharing state between mounts | `stateScope`, one shared scope for actor/chat, per-scope snapshot | **No state scope and no snapshot**; every mount is independent, a cue is sent to each mount, driver state is its own storage |
| Prompt | `prompt.publish({ stateScope, activeKeys })`; host words the line; per-scope | `ModelPromptPublication` per **model + profile**, with an ACT token list and a monotonic version; card holds the cache |
| Cue addressing | `target.mountId`, first broker single-mount, fan-out deferred | Envelope names **driver + surface (+ purpose)**; the manager fans out; no mount id in the envelope |
| Cancellation | absent (RFC 0001 §9.15 closed it) | Six withdrawal requests, seven transaction states, per-target result table (§9.7) |
| Mount queries | only on the live component | Also reachable by surface+purpose through the manager (§8.6) |
| Capabilities | one list, no interaction modes | Claim vs probe, interaction modes, effect/reset deltas |
| Failure vocabulary | no `cancelled`/`window-gone`/reference codes | §9.4/§9.6 closed |
| Migration bag | entries reported `unused` individually | Whole-bag handover with `absorbed` + marker |
| `pending-import` | a transient import state | A persisted, identity-less payload AIRI lists and can import later |
| Stage-Mate | outside the contract, keeps placement | Same ruling, still valid — retained |

Per-renderer **inventories** in the old document (Spine/MMD/Live2D/VRM legacy keys, defects, deletion candidates) remain the starting point for each driver phase; the **decisions, transport, shared state, prompt and cancellation** sections must not be carried over.

---

## Appendix C — Contract conformance map (after Phase 0)

| RFC 0002 section | Contract symbol(s) | Status after Phase 0 |
| :--- | :--- | :--- |
| §4.1 actors | `ModelDriverHostRegistry`, `ModelDriverMountRegistry`, `ModelDriverManager`, `ModelDriverRuntime`, `Adapter` | Registry + adapter exported; manager holds delivery |
| §4.2 communication | `CueChannel`, `CueSink`, manager delivery/withdrawal, observation events | Complete (C2/C3/C5) |
| §5.1 identity | `ModelId`, `ModelProfileId`, adapter minting, `ModelState` | Complete; `pending-import` moved out (C12) |
| §5.2 profiles | `ModelProvider.*Profile`, reference gate | Complete (C11) |
| §5.3 two-phase import | `probe` → `parts`, `confirmImport(selections)` | Complete (C21); input carried to commit, per-entry settlement |
| §5.4 builtins | `ModelDescriptor.modelId?` | Already conformant |
| §5.5 duplicates | `MODEL_ID_CONFLICT`, `overwrite`, `resetProfiles` | Already conformant |
| §5.6 provenance | `ModelImportMigration` + host marker | Complete (C13 host side) |
| §5.7 preview/authorship | `ModelPreview`, `ModelAuthor`, `HostAnnotationFields` | Already conformant |
| §5.8 enumeration | `ModelDriverManager.listModels`, `ModelSummary`, persisted rows | Complete (rows are host records) |
| §5.9 capabilities per model | `modelCapabilities`, `ModelCapabilityDescriptor` (`effect`) | Complete (C8) |
| §5.10 transfer/deletion | `export`/`import`, `purge`, reference gate | Complete (C11) |
| §6.1–§6.3 declaration | `ModelDriverManifest`, requirements, activation report | Complete; version validation (C14) |
| §6.4 claim vs probe | `ModelDriverCapabilities`, `rendererCapabilities`, `interactionModes` | Complete (C8) |
| §6.5 loading | `ModelDriverEntryPoints` + lazy resolution | Reconciled by documentation/choice (C15) |
| §7.1–§7.4 selection/replacement/prompt | picker contract, `CharacterModelBinding`, `ModelPromptPublication` | Complete (C7); mandatory publication, empty publication retained |
| §8.1–§8.6 mounting | `RendererMountProps/Emits/Exposed`, readiness transitions, queries | Complete (C9/C10) |
| §9.1–§9.7 cues | `CueEnvelope`, vocabulary, ack, delivery, cancellation | Complete (C2/C4/C5/C6/C8) |
| §10.1–§10.5 services | `HostServices`, storage, pointer, prompt, theme | Complete (pointer wording fixed: a runtime MAY attach its own listeners where the host offers none) |
| §11 panels | `ModelDriverPanelDeclaration`, `ModelPicker*` | Complete; manager channel typed |
| §12 speech | `SpeechAnalysisFrame`, analyzer service | Complete; manager answers analyzer registration |
| §13 migration | `migrate`, bag report, host records | Complete (C13) |

---

## Appendix D — Work order at a glance

| Phase | Slice | Ships when |
| :--- | :--- | :--- |
| 0 | Contract closure + validators | SDK typecheck/tests green; still zero importers |
| 1 | Host core + stub driver | Stub passes broker/registry/storage/window-gone suite in two windows |
| 2 | Mounts, surfaces, prompt, panels, picker, speech | Stub renders on every surface; no format cut over |
| 3 | Spine driver + cutover | Spine models load/act/profile/capture; legacy Spine path deleted |
| 4 | MMD driver + cutover | MMD imports with textures through the driver; morph cap gone |
| 5 | Live2D driver + cutover | Live2D caption/pointer/OPFS/DSL actions work; host injection gone |
| 6 | VRM driver + cutover | VRM camera/transform/profiles/VRMA work; Stage-Mate follows |
| 7 | Final cutover + guards | Host imports no renderer; guards green |
| 8 | Migration, backup, transfer, purge | Clean-profile restore round trip; crash tests pass |
| ongoing (after 8) | Documentation upkeep + one-time code expiry | Catalogues updated; migration tables scheduled for deletion |


