# Implementation Plan — Model Driver Contract (RFC 0002)

| Field | Value |
| :--- | :--- |
| Status | **Approved through Phase 1 (2026-11-23);** Phases 2–8 are gated (approval boundary below). Host implementation has not started; this document is docs-only. |
| Normative source | [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) (RFC 0002). Where this plan and the RFC disagree, the RFC wins; the host choices the RFC leaves open are recorded in §2, and no RFC text change is required. |
| Contract package | `@proj-airi/stage-renderer-sdk` — `0.0.3` in this working tree (pinned as Phase 0's first unit, P0.0), 13 contract files, **no integration**; becomes `0.1` at Phase 0 close |
| Supersedes | [`docs/design-stage-renderer-migration.md`](../../docs/design-stage-renderer-migration.md) (the RFC 0001 companion plan) wherever that document conflicts with RFC 0002 — see Appendix B |
| Scope | Host integration for Electron + Web + Pocket, four first-party drivers (Spine, MMD, Live2D, VRM), migration of existing data, and a three-patch-release reversal window |
| Out of scope | Third-party driver packaging/distribution and a loader, a driver-side cloud-sync channel, a scripting VM, beat sync, per-cue progress reporting (migration status is host-level, §5.9), cancellation outside cue transactions, a per-driver compilation pipeline, a dedicated onboarding update mode |

**Approval boundary.** Phase 0 and Phase 1 are approved. Every later phase is approved only at the exit gate of the phase before it.

| Phase | Scope | Approved | Gate that must pass before the next phase starts |
| :--- | :--- | :--- | :--- |
| 0 | Contract closure | 2026-11-23 | SDK `typecheck` + `test` green; zero importers |
| 1 | Host core + stub | 2026-11-23 | Broker/registry/manager-request suites; main-bundle assertion |
| 2 | Mounts and host surfaces | **not approved** | Phase 1 exit criteria |
| 3–6 | One driver per phase, Spine → MMD → Live2D → VRM | **not approved** | Previous driver's exit criteria |
| 7 | Hardening, transfer, reversal | **not approved** | Phase 6 exit criteria |
| 8 | Final removal | **not approved** | Phase 7 exit criteria |

**Decision record.** D1–D10 were signed off on 2026-11-22; D11–D16 record the 2026-11-23 review. Further decision update is below:

| # | Final decision |
| :--- | :--- |
| D1 | Manager runs in the Electron **main process** on desktop; the registry owns it directly; it receives a `RegistryHandle`, not storage, and requests renderer code when it needs storage. One shared background window hosts those requests (D11). No desktop lock. Host keeps a row cache and its own flags, not a model store. |
| D2 | Driver modules stay **colocated in the renderer package** (`src/driver/*`); main imports only the DOM-free `manifest`/`manager` subpaths; the renderer loads the rest through its own bundler-resolved loader. |
| D3 | `@moeru/eventa` for cross-process requests/delivery/observation; in-process on Web/Pocket; `BroadcastChannel` is observation-only, and `SpeechAnalysisFrame` is observation. |
| D4 | Legacy ids become `modelId`; one default `profileId` per import; the card keeps `displayModelId` and adds `extensions.airi.avatar`; **all existing card fields stay** (additive). |
| D5 | Prompt and ACT token list are one atomic publication with one version; an empty publication is valid for every driver, but a prompt-capable driver that never publishes is a fault; legacy prompt retained for reversal. |
| D6 | Spine → MMD → Live2D → VRM. |
| D7 | First-party only; entry specifiers are build-time links resolved by the renderer bundle; no loader. |
| D8 | The migration payload is a **legacy handover**, offered once per driver, with per-model entries **including model bytes**; the driver retains it (D14, D-16). |
| D9 | Migration is reversible by the user for **at least three patch releases**; the legacy path is removed only after every format's window closes, and legacy copies are deleted only on a user prompt. |
| D10 | Deprecated card fields are kept inert; deletion is a user-requested cleanup, never automatic. |
| D11 | One shared background window, owned by main, with a consumer refcount from day one; `requestRenderer` returns a channel or a host-owned refusal reason. |
| D12 | `0.0.3` is the uncommitted baseline committed by P0.0; `0.1` is the first shipped contract shape; any later breaking shape is `0.2`. |
| D13 | Cutover is a background, prioritized, resumable queue; the legacy path renders until a model's migration marker is written. |
| D14 | The handover carries everything, model bytes included; the driver retains it; migrated models enter through the ordinary import; host legacy copies are deleted only after `absorbed && retained` and a user confirmation prompt. |
| D15 | Revert is served by the driver copying its bytes back into the legacy import; a downgraded build can no longer render legacy models. |
| D16 | Onboarding re-runs on update; configured values are skippable and never overwritten; a dedicated update mode is deferred. |

Notation: **MUST** / **MAY** / **SHOULD** carry the RFC's meaning. "Phase" is a shippable slice, not a calendar estimate. Every phase ends with an observable exit criterion.

---

## 0. Starting point

1. **The contract package exists and is uncommitted at `0.0.3`.** `packages/stage-renderer-sdk` holds 13 contract files. The uncommitted working tree is the RFC 0002 reshuffle: `adapter.ts`, `components.ts`, `plugin-port.ts` added; `persistence.ts` and `renderer.ts` deleted; ten files modified. `src/index.ts` re-exports 12 of the 13 — `adapter` is not exported. Its only validation is `tsc --noEmit`, and it has no tests. Phase 0's first unit (P0.0) commits exactly this tree as `0.0.3`, and Phase 0 closes at `0.1`.
2. **Nothing imports the package.** A repository-wide grep for `stage-renderer-sdk` outside its own `src/index.ts`/`README.md` returns nothing.
3. **The app renders through one component and four stores.** `RendererStage.vue` statically imports the four scene components; `ControlStripHost.vue`, `ControlStrip.vue`, `ModelCustomizer.vue`, the card store and the settings pages read and write the four renderer stores directly.
4. **The data model has no identities beyond a display-model string.** `display-model-${nanoid}` is minted in the host store; there is no `profileId`; there is no driver id on a model; a character card points at `modules.displayModelId`. No model-prompt field exists.
5. **No host machinery for the contract exists**: no registry, adapter, manager, runtime, cue broker, mount registry, model rows, profile records, prompt publication, or driver panels/picker.

Two risks govern the sequencing:

- **Contract churn is free now and expensive after Phase 1.** §3 closes the RFC 0002 gaps before host code depends on the shapes.
- **The app cannot stop rendering while it migrates.** Every phase keeps un-migrated formats on the legacy path; a format crosses over in its own slice (§6), and removal is last (§8).

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
| Profile / outfit | `AiriOutfit` on the card (`card.schema.ts:195-204,320`) and mirrored onto the record; `applyOutfit` only pokes VRM weights (`airi-card.ts:1423-1469`) | No `profileId`; RFC requires one per import and a driver-owned profile body |
| Card binding | `extensions.airi.modules.displayModelId` (`:103`), mirrored into `active_state.displayModelId` (`:375`) | 307 `displayModelId` references; identity preservation avoids a card migration |
| Model prompt | `extensions.airi.acting.modelExpressionPrompt` (`:308-319`), user/LLM-authored and injected into the system prompt (`airi-card.ts:1521-1531`) | RFC moves it to a driver publication, per model **and profile**; legacy text has to be retained for reversal (D5/D9) |
| Binary storage | localforage default DB: `display-model-{nanoid}` (record incl. `File`), `{id}-textures` (MMD), URL models under their raw id | Driver-owned keys after cutover; host stops enumerating them |
| Catalog cache | unstorage `local:display-models/metadata-cache`, `local:sync-metadata/remote-catalog-cache` | Host rows replace the metadata cache |
| Deletion | `local:sync-metadata/deleted-models/{id}` written on removal, scanned by `reconcileModels()` | Already the durable marker RFC §13.2 asks for |
| Preview | `previewImage` data URL + metadata cache + remote `{id}-preview.png`; four body-mounted canvases | Driver produces, AIRI stores a copy |
| Settings | ≈110–120 `settings/{stage-ui-three,live2d,spine,mmd}/*` keys, window-global; only `settings/positioning/models` and `lastModelIdentity` are model-scoped | Driver storage; one-time legacy handover per driver |
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
- Speech frames as a host service (each renderer receives `mouthOpenSize`; Live2D additionally runs the host's `createLive2DLipSync`).
- Any test or harness that can mount a fake driver.

### 1.7 Constraints

1. **The name "model driver" is taken by motion/lip-sync packages.** New packages and prose use “stage driver”; `ModelDriver*` stays for contract types. The old "model driver" will be renamed later.
2. **Desktop main cannot touch IndexedDB.** A manager therefore reaches storage only by asking the registry to run a driver entry in a renderer — a live renderer first, the shared background window as fallback. If the request is refused, the manager stays dormant and `listModels` reports `ok:false` with the refusal reason (§4.3). Model bytes and settings stay in web storage (§2 D1).
3. **Web and Pocket have no main process.** The host core is usable in-process without Electron.
4. **Electron main externalizes dependencies by default.** A driver manager imported by main must be in `externalizeDeps.exclude` so it is bundled; a build assertion verifies no renderer UI enters the main bundle (§2 D2).
5. **Stage-Mate (Unity) is outside the contract.** It keeps its bridge, consumes host speech frames, and receives forwarded cues.
6. **First-party only.** No loader, no discovery, no third-party distribution.
7. **The repo develops directly on `main`.** Every phase is reviewable on its own.

---

## 2. Decisions

RFC 0002 leaves host choices open. The choices below are signed off; rejected alternatives are kept as history.

| # | Decision | Chosen | Rejected | Status |
| :--- | :--- | :--- | :--- | :--- |
| D1 | Manager hosting | Electron main on desktop; registry owns the manager directly; `RegistryHandle` with `requestRenderer`, no storage; one shared background window as the renderer host, consumer refcount | A hidden window dedicated only to model drivers; a generic background-service layer in Phase 1; file-backed driver storage in main; direct storage handle for the manager | Signed off (revised 2026-11-23, D11) |
| D2 | Driver layout and entry loading | Colocated `src/driver/*`; main imports DOM-free manifest/manager subpaths; manager returns a specifier; renderer loader imports it; build assertion | Separate `stage-driver-main`; precompiled driver artifacts | Signed off (revised) |
| D3 | Transport | `@moeru/eventa` for requests/delivery/observation; in-process on Web/Pocket; BroadcastChannel observation-only, including `SpeechAnalysisFrame` (latest-wins, no ack, never through main) | BroadcastChannel + polling | Signed off (revised 2026-11-23) |
| D4 | Identity and card | Legacy ids become `modelId`; one default `profileId`; card adds `extensions.airi.avatar`; all existing fields kept | Rename card fields and migrate cards | Signed off |
| D5 | Prompt | One atomic publication, one version; empty publication valid for every driver; no publication is a fault for a prompt-capable driver; legacy prompt retained for reversal; gated rollout | Two versions compared; global switch in Phase 2 | Signed off (revised 2026-11-23) |
| D6 | Order | Spine → MMD → Live2D → VRM | VRM first | Signed off |
| D7 | Scope | First-party only; no loader; bundler-resolved specifiers | `plugin-sdk` host; runtime loader | Signed off |
| D8 | Migration payload | **Legacy handover**, once per driver, per-model entries | Per-model handover | Signed off |
| D9 | Reversibility | Legacy path ships ≥3 patch releases; revert served by the driver copying its archive back into the legacy import; host legacy copies deleted only after a user prompt; removal last | Delete at cutover; data-only reversibility; host retention as the revert source | Signed off (revised 2026-11-23) |
| D10 | Legacy card fields | Kept inert; deletion only on explicit user request | Automatic removal in Phase 8 | Signed off |

### D1 — Manager in Electron main

**Requirement.** The manager outlives every mount and every user window, answers model enumeration without a visible window and without holding storage, and runs without DOM or WebGL.

**Decided.** The manager runs in the Electron main process on desktop, and in-process on Web/Pocket. The registry creates, owns and releases one manager per driver directly. A window dedicated only to model drivers is rejected; a single shared background window hosts manager-requested entries (§4.1, D11), and a file-backed driver-storage medium is rejected.

`createManager(handle)` is synchronous entrypoint from a driver and runs at registry startup. The manager receives a `RegistryHandle` The handle is the registry's own service surface:

```ts
// contract addition (C22)
interface RegistryHandle {
  log: HostLogger
  /** Ask the host to run a named driver entry in a renderer. */
  requestRenderer: (request: { entry: string }) => Promise<RequestRendererResult>
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

**How the manager reaches storage.** It does not read storage itself, the storage must be accessed through the driver's own code:

1. the manager chooses a capable renderer it already has a channel to, if any — a visible renderer first, then the shared background window. With no live renderer able to serve it, it asks the registry to start its entry in the background window;
2. if the manager reuses one, it talks to the renderer-side code there and reaches storage through it;
3. if the manager requests one, the registry returns a duplex `ManagerChannel` and the renderer entry receives the other end;
4. the host performs no handshake; the driver owns the message format, versioning and readiness protocol;
5. a refusal returns `{ ok: false, reason }` with a host-owned reason (§4.3); with no UI, the manager may stay dormant.

**Rows.** `listModels()` is a pull. The driver may keep a row index, a cache, or enumerate on demand. The host caches the last successful result for display only, and that cache never overrides `ok:false`. `enabled` flags and retention markers stay host-owned.

**Ownership.** The registry owns the manager directly on every host. Web/Pocket's in-process registry owns its manager under the single-instance assumption.

**Manager scope.** Lifecycle, model rows through pulls, entry lookup and cue routing. Parsing, preview generation, capability discovery and rendering stay in renderer runtimes. The manager may keep in-memory state, including its own record of requested channels; it owns no mount, no probe result and no renderer.

**Movability.** The manager boundary is a service interface. Moving it later is a host wiring change, not a driver change.

### D2 — Driver layout and entry resolution

**Decided.** Driver modules stay in the renderer package they belong to:

```text
packages/stage-ui-three/src/driver/
  manifest.ts     pure data: id, version, requirements, capability hint, entry: { manager }
  manager.ts      DOM-free: createManager(handle), resolveEntrypoint, delivery/withdrawal
  provider.ts     renderer: probe/import/list/remove/preview/profiles/capabilities
  mount.vue       renderer: the mount component
  panels.vue      renderer: settings/popover panels
  picker.vue      renderer: model picker
```

Subpath exports: `./driver/manifest`, `./driver/manager`, `./driver/mount`, `./driver/panels`, `./driver/picker`.

**Who loads what.** Main imports only `manifest`/`manager` (DOM-free). The renderer never imports `manager`; it imports `mount`/`panels`/`picker` through its own loader table. `externalizeDeps.exclude` includes the four renderer packages so main bundles the manager subpath instead of leaving a runtime `require()` of source.

**Entry resolution.** The manager performs the lookup; the adapter requests it:

1. adapter → registry: `resolveEntrypoint({ driverId, kind, surface, purpose })`;
2. registry → manager (in-process on desktop main): the manager chooses the entry;
3. manager → adapter: `{ specifier }` (for example `@proj-airi/stage-ui-three/driver/mount`);
4. adapter imports the specifier through its build-time loader table and mounts it.

The loader table is generated from the first-party driver list and is the only renderer-side place renderer packages are imported. Because the driver code is not compiled separately, such table must be held by an adapter. The behavior will change when a proper loader and a driver compilation pipeline land.

The adapter makes no entry decision; it only imports the module the manager named. Unknown specifier → `invalid-entrypoint` with a readable reason.

**No precompiled drivers.** First-party renderer modules are compiled by the normal renderer build. No per-driver build pipeline is introduced. Third-party external specifiers are deferred with the loader.

**Build assertion.** Tree-shaking is a bundler behavior, not a security boundary, so a CI check fails if any renderer runtime module (Vue/Three/Pixi, a scene, a store) is reachable from the Electron main entry. Manager modules are also linted to forbid imports of the package index, `.vue` files, Vue, Three or Pixi.

### D4 — Identity and card binding

**Decided.** The adapter is the sole identity authority:

- `modelId` = the existing `DisplayModel.id` (including presets), adopted at import/restore; no card re-binding;
- one default `profileId` minted per imported model before its first load;
- the card keeps `modules.displayModelId` and adds one object:

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

Every existing `extensions.airi.*` field stays (D10). The full publication (prompt + ACT token list + version) lives in the host prompt store; the card keeps only what must survive a driver that is not running. A card without `avatar` is legacy: resolve the driver from the record’s `modelDriverHint` and attach the binding during cutover. Valibot tests cover the new object, a legacy card and a mismatched `modelId`.

### D5 — Prompt and ACT token list

**Decided.** One atomic `ModelPromptPublication` with one `version` covers the prompt and its token list. A driver MUST publish at least once per model/profile once activated; an empty prompt + empty token array is a valid publication and is stored as-is, not treated as “no prompt.” An older publication is stale and discarded, surfaced as a fault.

A driver declares prompt capability in its manifest. An **empty publication** — empty text with an empty token array — is valid, and is stored as-is. What is not allowed is **no publication at all**: a prompt-capable driver that finishes activation without ever publishing for that model/profile leaves the handover unabsorbed for that model, so the host retries and surfaces the fault. The legacy text is retained for reversal and stays readable in the driver panel, so an empty publication is visible rather than silent.

**Rollout.** Phase 2 builds the publication channel and the cache. `buildSystemPrompt` switches per driver: if the card's binding uses a migrated driver and an `avatar.prompt` cache exists (including empty), it uses it; otherwise it keeps `acting.modelExpressionPrompt` and the expressions context provider until **every** format has been cut over and its reversal window closes. The provider is deleted only in Phase 8.

**Reversal.** The legacy prompt is retained for the reversal window (D9); it is not cleared at cutover. A reverted character reads it again. At window close it becomes inert legacy data and follows D10.

### D8 — Legacy handover

**Decided.** One handover per driver, offered after `activate` and before the first mount, containing one entry per legacy model. The full shape is in §6.5. The driver absorbs and retains all entries; the host deletes the handover and writes `driver-migration/{driverId}` only on `absorbed && retained`, otherwise it retains the handover and retries idempotently. Per-model markers `model-migration/{modelId}` record commits.

### D9 — Reversibility for three patch releases

**Decided.** The legacy render path ships for at least three patch releases, and revert is served by the driver, not by retained host copies:

- the handover carries everything, model bytes included, and the driver retains it (D14, D-16);
- migrated models enter through the ordinary import, so the driver's own storage is the authority and the source of a revert;
- host legacy copies are deleted only after `absorbed && retained` **and** an explicit user prompt (once per driver, §7.3), which states the disk figure, what is removed, and that a downgraded build will no longer render those models; declining keeps them and leaves the action available;
- **“Revert avatar migration”** asks the driver for its retained legacy payload (C23) and feeds those bytes into the **legacy import** — the same call the old picker used — recreating the legacy storage the legacy path reads; the driver keeps its copy for re-migration;
- a downgraded build cannot ask the driver, so it cannot render legacy models whose host copies were deleted. That is the single guarantee this design gives up; it is stated in the prompt and in §10;
- each format records `legacy-retention/{driverId} = { cutoverVersion, removeAfterPatch }` in `state.json`, the single owner (§4.5).

Final removal (Phase 8) starts only when every format's window has closed. Backups carry the driver's `driverTransfer` bundle, mandatory for first-party drivers (§7.1), which is the only complete legacy copy once host copies are deleted.

### D10 — Legacy card fields

**Decided.** `cueAllowlist`, `compiledWhitelist`, `active_state.active_expressions`, `AiriOutfit.meshes`/`expressions` and `acting.modelExpressionPrompt` are kept. During migration they are read but not written; after cutover they are inert. `modules.displayModelId` and `acting.modelExpressionPrompt` are frozen at their cutover values: no host code writes either one after cutover (D15). Deletion of these fields happens only through an explicit user request (a maintenance cleanup with confirmation); none of them is deleted automatically in Phase 8. Card fields are never part of the legacy-copy deletion prompt (§7.3) — that action removes legacy storage, not character data.

---

## 3. Phase 0 — Close the contract

**Goal:** the contract package expresses RFC 0002 exactly, with executable checks, before host code depends on it. No application behavior changes.

| # | Gap (RFC section) | Change | Acceptance |
| :--- | :--- | :--- | :--- |
| C1 | `Adapter` is unexported and cannot mint (`§5.1`, `§8.2`, App A) | Export it; add `mintModelId`/`mintProfileId`/`mintMountId`; add `requestEntrypoint({ driverId, kind, surface, purpose })`; document manager authentication | `src/index.ts` exports `./contract/adapter`; tests mint unique ids and reject a duplicate mount id |
| C2 | Envelopes address `mountId`, not driver + surface + purpose (`§9.2`) | `CueEnvelope.target = { modelDriverId, surface?, purpose? }`; remove public `mountId`; rename `ACTOR` to `ACTING` in surface/purpose/host-window enums | A test sends `{ driver, surface:'acting', purpose:'acting' }` and resolves the right mount set |
| C3 | Manager delivery is missing (`§4.2`, `§12`) | `deliver`, `withdraw`, enumeration-change notification, analyzer registration | Type-level tests; §4 stub exercises it |
| C4 | No cancellation (`§9.7`) | Transaction states, six withdrawal requests including `abort-current`, per-target result table, bounds | Tests cover every request |
| C5 | Acknowledgement incomplete (`§9.3`) | Answering `modelDriverId`; debug message; acceptance vs settlement split; drop `requestId` | Accept, cancel before settle, observe `cancelled` |
| C6 | Failure vocabulary incomplete (`§9.4`, `§9.6`, `§6.2`) | Add `cancelled`, `window-gone`, `contract-version-mismatch`, `model-referenced`, `profile-referenced`; rename `RENDERER_UNAVAILABLE` → `DRIVER_UNAVAILABLE` | Exhaustive enum tests |
| C7 | Prompt not a versioned pair (`§10.4`) | One `ModelPromptPublication` with one `version`; mandatory publication; empty prompt/tokens valid for every driver; a prompt-capable driver that never publishes is a fault; stale publication rejected | Publishing `('', [])` persists for any driver; a prompt-capable driver with no publication keeps the handover unabsorbed; older version is discarded |
| C8 | Capability/cue vocabulary deltas (`§6.4`, `§9.5`) | `effect`/`EffectCue`; `ACT='act'`; `interactionModes`; `effect` in `ResetScope`; POI gaze target; `NO_TARGET` rejection; cues typed “beyond load”; no transient load/reset/caption | Typecheck + grep |
| C9 | Readiness transitions absent (`§8.4`) | `READINESS_TRANSITIONS` + `isReady`; only `model-loaded`/`ready-for-model` are ready | Walk every declared transition; reject an undeclared one |
| C10 | Cross-window queries missing (`§8.6`) | Manager-level `queryMount`/`commandMount` by surface+purpose; live-instance members stay | A second adapter reaches a mount |
| C11 | No reference check before removal (`§5.2`, `§5.10`) | Host gate in `remove`/`removeProfile`/`purge`; `references?` evidence; failure codes | Stub refuses a referenced model |
| C12 | `pending-import` contradicts RFC (`§5.1`, `§13.2`) | Remove from `ModelState`; add AIRI-only `PendingModelPayload` | A pending payload cannot construct a `LoadCue` |
| C13 | Migration input is per-entry (`§13.1`) | Rename to legacy handover; per-driver with per-model entries **including model bytes**; report `absorbed`, `retained`, `absorbedModelIds`, `unused`, `warnings`; the driver must retain what it received | Two calls with the same handover are idempotent; a driver that drops the archive reports `retained: false` and no migration marker is written |
| C14 | No compatibility predicate (`§6.2`) | `isContractCompatible` (same minor below 1.0, same major from 1.0, patch-compatible); readable rejection | Table-driven test |
| C15 | Entry declaration bypasses the manager (`§6.1`, §6.5) | Manifest `entry: { manager }` only; manager gains `resolveEntrypoint` returning `{ specifier }`; adapter requests it | Startup test proves main imports no renderer UI; resolver test returns the mount specifier |
| C16 | Two driver-status vocabularies (`§7.3`) | Keep `DriverStatus`/`UnavailableModelReason`; document mapping | Mapping test |
| C17 | No validators/tests | `validateManifest`, `validateCueEnvelope`, `assertCapabilityCompleteness`, `assertAckShape`; add `vitest` | `typecheck` + `test` green |
| C18 | Stale RFC 0001 citations | Update `src/index.ts`/`README.md`; add adapter + plan to the file map | Links resolve |
| C19 | Pointer wording contradicts RFC (`§10.3`) | A runtime MAY attach listeners inside its own window; the service is the only route outside it | Comment/type review |
| C20 | Host passes a size (`§8.3`) | Remove `RendererMountProps.viewport`; the container is the viewport and the mount measures it | No size reaches a driver |
| C21 | Commit lacks input and per-entry settlement (`§5.3`) | `confirmImport` receives the input handle/copies; each committed entry settles independently | One failing + one succeeding entry persists only the success |
| C22 | Manager has no renderer-code request (`§5.8`, `§10.2`) | Add `RegistryHandle` (`log`, `requestRenderer`, registry operations); redefine `ManagerChannel` as `{ send, onMessage }`; add optional `HostServices.managerChannel`; `createManager(handle)` receives the handle; no `storage` on it; `requestRenderer` returns `{ ok: true, channel } \| { ok: false, reason }` with host-owned reasons (`window-unavailable`, `entry-failed`, `driver-disabled`, `shutting-down`) | Manager requests an entry, exchanges one message through the channel, and answers `listModels`; no storage handle reaches main; each refusal reason is asserted separately |
| C23 | Revert has no data path (`§13.1`, `§5.10`) | Host transition type `LegacyRestorePayload`: on request the driver returns one model's retained legacy entry — setting values, outfit payload, prompt and model bytes — so the host can feed the legacy import; opaque to the RFC like the handover | Stub round trip: retain a handover, request a restore, the host receives the same bytes and the legacy path renders |

**Execution units** (one reviewable change each)

| Unit | Contents | Done when |
| :--- | :--- | :--- |
| P0.0 | Pin the `0.0.3` baseline as its own commit; correct §0 | The reshuffle is a named commit, not a working-tree diff |
| P0.1 | Adapter export, entry request, minting, cue target + `acting` rename, vocabulary deltas, pointer wording, no viewport | `tsc --noEmit` clean |
| P0.2 | Cancellation, ack split, failure codes, readiness, queries, compatibility | Type-level tests |
| P0.3 | Records/migration types, handover, reference gate, pending payload, import commit input, `RegistryHandle` | Types compile; mapping tests |
| P0.4 | Validators, `vitest`, exports/citations | `pnpm -F @proj-airi/stage-renderer-sdk test` green |
| P0.5 | `docs/data-catalog.md` model-domain correction + new keys | Catalog matches source |

**Exit criteria**

1. `pnpm -F @proj-airi/stage-renderer-sdk typecheck` and the new `test` pass.
2. No format string (`vrm|live2d|spine|mmd`) outside comments; no `stateScope`/`persistence` residue.
3. Every RFC 0002 section maps to an exported symbol (Appendix C); zero app importers remain.
4. Package `version` `0.1.0` and `MODEL_DRIVER_CONTRACT_VERSION` `{ major: 0, minor: 1 }` land in one commit.
5. A `0.0.x` manifest is rejected by `isContractCompatible` with a readable reason.

**Next action:** P0.0. Phase 1 starts only when these criteria hold.

---

## 4. Phase 1 — Host core

**Goal:** a host implementation that can carry the contract with a stub driver, with no real renderer touched and no user-visible behavior change.

### 4.1 Where the code lives

| Artifact | Path (new unless noted) | Responsibility |
| :--- | :--- | :--- |
| Host core (pure TS, no Vue/Pinia) | `packages/stage-driver-host/` | Registry, broker logic (hosted in main), transaction table, cancellation, mount registry, id minting, host record types plus the record/profile/prompt stores behind a storage port (the renderer adapter supplies IndexedDB), `RegistryHandle` contract, entry-resolution protocol |
| Contract validators | `packages/stage-renderer-sdk/src/validate.ts` | Manifest, envelope, capability completeness, compatibility, ack shape (Phase 0) |
| Main-process service | `apps/stage-tamagotchi/src/main/services/model-drivers/` | Registry ownership, managers, renderer-request routing, row cache, eventa contracts, window-gone settlement, enabled flags |
| Shared background window | `apps/stage-tamagotchi/src/main/windows/background/`, `src/renderer/background.html`, `background.main.ts` | The app's one background window: hosts manager-requested driver entries, with a consumer refcount and lazy start; beat sync stays separate in Phase 1; other consumers can join later without changing this plan |
| Renderer adapter | `apps/stage-tamagotchi/src/renderer/libs/model-drivers/adapter.ts` | Per-window adapter: mint, request entry points, services, authenticated channels |
| Renderer loader table | `apps/stage-tamagotchi/src/renderer/libs/model-drivers/loaders.ts` | The only renderer-side table that imports driver `mount`/`panels`/`picker` modules and manager-requested entries |
| Web / Pocket host | `apps/stage-web/src/libs/model-drivers/`, `apps/stage-pocket/src/libs/model-drivers/` | In-process registry + managers + adapters, same interfaces |
| Stub driver + harness | `packages/stage-driver-host/src/testing/` | Fake driver: manifest, manager, runtime, provider, mount, panel, picker |

No `stage-driver-main`: driver manifests and managers live in the driver packages, and main imports only their DOM-free subpaths (§2 D2). `packages/stage-driver-host` has no Vue dependency. The background entry is added to the renderer MPA inputs beside `index.html`/`beat-sync.html`, uses the shared preload, and does not mount `App.vue`; other consumers can join that window later without changing this plan. The Vue-facing host (`packages/stage-ui/src/libs/model-drivers/`) is Phase 2 work (§5.2, §5.9) — Phase 1 ships only the dev-only stub route, so no unreachable UI layer is written in this phase.

### 4.2 Registry and managers (Electron main)

Startup sequence, matching RFC 0002 Appendix A:

1. **Read declarations before executing driver code.** The first-party table names each driver’s `manifest` **and** `manager` module loaders; main imports the manifest and validates `id`, `driverVersion`, `contractVersion`, `requirements`, `capabilities`, and that `entry.manager` matches the table’s manager subpath. A mismatch is rejected with a readable reason; no manager is created. The table is static, so main never dynamically imports an unchecked specifier.
2. **Load the host state.** Main reads `{userData}/model-drivers/state.json` (`enabled`, cached rows, retention markers) and registers drivers with the persisted enable flags. First run defaults to enabled. Cached rows are a display fallback, not a source of truth.
3. **Create the manager** in main by loading the table’s `manager` subpath and calling `createManager(handle)`. `handle` is a `RegistryHandle` with `log`, `requestRenderer` and ordinary registry operations. It has no storage. The manager may request renderer code when it needs data.
4. **Create the broker and mount registry** in main.
5. **Do not start the background window at boot.** It is created lazily on the first `requestRenderer` call that cannot reuse a live renderer, and is destroyed when its last consumer releases (§4.3).
6. **Broadcast `onChange`** when a driver is enabled, disabled, updated or the manager reports an enumeration change; main replaces that driver's row cache and the host refreshes.

Main holds declarations, cached flags, directly owned managers, the host row cache, mount descriptors, transaction table and the renderer-request routing. It holds **no runtime, no mount, no probe result and no web storage of its own**.

### 4.3 Managers

- **Registry-owned.** The registry creates and directly owns exactly one manager per driver.
- **RegistryHandle.** The manager receives `{ log, requestRenderer, listDrivers, isEnabled, onChange }` at creation.
- **Renderer request.** `requestRenderer({ entry })` reuses a live renderer first — a visible renderer, then the shared background window — and starts the named entry there, or reuses that entry when the manager already has a channel to it. It returns `{ ok: true, channel }` or `{ ok: false, reason }` with a host-owned reason (`window-unavailable`, `entry-failed`, `driver-disabled`, `shutting-down`). The renderer entry receives the other end at startup. A channel that closes later counts as a refusal on the next request and never reaches into the row cache. The host performs no handshake; the driver owns the message format.
- **Rows.** `listModels()` is a pull. The driver may persist an index, keep a cache, or enumerate on demand; The host caches the last successful result for display only, and never overrides `ok:false`.
- **Crash.** A manager failure is a main-process failure; there is no separate window to recreate. On restart, managers are re-created, channels are gone, and the row cache covers the gap until the next successful pull. Any in-flight transaction settles `aborted`.
- **Quit.** On shutdown, `deactivate` is called on every active runtime, managers are released, and pending transactions settle `aborted`.
- **Ownership.** The registry owns the manager directly on every host. There is no desktop lock, no election protocol and no ownership handoff; Web/Pocket’s in-process registry owns its manager under the single-instance assumption (D1).

### 4.4 Broker and transaction table (main)

The broker implements RFC 0002 §4.2, §9.3, §9.6 and §9.7:

1. **Accept:** validate the envelope (known driver, capture alone, bounded cue kinds, a routable target). Malformed → `INVALID_ENVELOPE`, nothing delivered.
2. **Mint the correlation value** from one app-wide counter; record `submitted`; return `{ nonce, settled }` immediately.
3. **Resolve the target:** `{ modelDriverId, surface?, purpose? }` → matching mounts. A mount that exists but is not ready is queued until ready or deadline. **No matching mount → every slot rejected `NO_TARGET`** (a settled, successful transaction with `handled: false`); `dropIfNotReady` does the same without waiting.
4. **Deliver in order per driver**, without waiting for completion.
5. **Manager fan-out:** the manager decides which mounts receive the envelope and how to combine outcomes; the host provides the pipe to each mount’s window.
6. **Settle once:** one outcome per cue plus `handled`; late/duplicate acks are discarded.
7. **Deadline:** settle `error` with `timeout`; later acks discarded.
8. **Window gone:** unregister mounts; settle pending `cancelled` if undelivered, `aborted` if delivered.
9. **Withdrawals (C4):** apply to broker-held work first, then the receiver; answer per §9.7. `cancel`/`pop`/`pop-all` never stop a running transaction; `abort`/`abort-current`/`dump` ask the receiver and settle `aborted` or with its own outcome. `abort-current` targets the running transaction only.
10. **Bounds:** cap correlations per request and report entries; a malformed request fails.

State: `nonce → { state, driver, target, deliveredTo[], acknowledgedBy[], deadline, resolution }` plus per-driver queues. In-memory; a host restart settles every pending transaction `aborted`.

### 4.5 Identity, records, rows and markers

| Concern | Implementation |
| :--- | :--- |
| Minting | The **adapter** mints `modelId`, `profileId`, `mountId`; uniqueness is checked against the host registry (main on desktop, in-process on Web/Pocket). |
| Model record | `HostNamedModelRecord` in the host core’s record store (storage port), persisted in IndexedDB under `local:model-drivers/models/{modelId}`. Never holds the binary. |
| Profile record | `HostModelProfileRecord` under `local:model-drivers/profiles/{profileId}`; one default profile per import. |
| Binding | `extensions.airi.avatar = { driverId, profileId, prompt? }` beside `modules.displayModelId` (D4). Card fields stay additive. |
| Rows | `listModels()` is a pull. The driver may keep a row index, a cache, or enumerate on demand; The host caches the last successful result for display only; the cache never overrides `ok:false`. |
| Prompt | `local:model-drivers/prompt/{driverId}/{modelId}/{profileId}`; the card caches `avatar.prompt`. |
| Pending payload | `PendingModelPayload`: a localforage blob plus `local:model-drivers/pending/{payloadId}` (driver hint, legacy id label, timestamp; no identity). |
| Markers | IndexedDB only: `.../driver-migration/{driverId}`, `.../model-migration/{modelId}`. `state.json` in main is the **single owner** of `legacy-retention/{driverId}`; the renderer reads it over IPC and never writes it. Shorthand elsewhere in this document omits the `local:model-drivers/markers/` prefix. |
| Deletion | `local:model-drivers/deleted/{modelId}` canonical; keep reading the legacy `local:sync-metadata/deleted-models/{id}` during migration. |
| Enabled | `{userData}/model-drivers/state.json`; host and renderer caches for UI. |

### 4.6 Driver storage (renderer only)

- All renderer handles of one driver — provider/runtime, panels and pickers — address the same driver namespace.
- The media are unchanged: a per-driver localforage instance `airi-driver-<driverId>` for payloads and a namespace for small values/keys; the host prefixes and strips keys and `keys()` is scoped. `watch` uses the internal `airi:driver-storage:<driverId>` channel.
- If the manager needs storage, the steps are described in D1.
- Isolation is enforced host-side; concurrency is last-write-wins and the driver’s responsibility (RFC §10.2).

### 4.7 Entry resolution and loading

See D2.

### 4.8 Stub driver and harness

A complete stub is built in this phase:

| Piece | Behavior |
| :--- | :--- |
| Manifest | Valid 0.2 declaration; `entry: { manager }`; static capabilities |
| Manager | `createManager(handle)`; `requestRenderer` + `ManagerChannel`; `listModels` through a renderer pull; `resolveEntrypoint`; delivery/withdrawal with an in-memory queue |
| Runtime | `activate`, `rendererCapabilities`, provider with two-phase import, profiles, preview, capabilities, vocabulary |
| Mount | Seven readiness states, `LoadCue`, cue recording, `occupiesPoint`/`hitTest`, capture, failure on demand |
| Panel / picker | Minimal components proving frames, placement and the `select` contract |

Used by broker/registry tests and a dev-only route (`/devtools/model-driver-stub`) that exercises mount → load → cue → cancel → capture across two windows.

### 4.9 Exit criteria

1. `pnpm -F @proj-airi/stage-driver-host test` covers registration/version rejection, manager creation and restart, `RegistryHandle` renderer requests, channel messaging, row pulls, envelope validation, correlation uniqueness, FIFO, drop, deadline, six withdrawals, window-gone, storage isolation and id minting.
2. With the stub, two windows register mounts; `{ driver, surface:'acting', purpose:'acting' }` reaches only the acting mount; a cue with no matching mount settles `NO_TARGET`; a not-ready mount drops when asked and otherwise waits; closing a window settles `aborted`.
3. Manager restart (main restart) re-creates managers, preserves the row cache, and the next pull requests renderer code again.
4. Backup/restore with the stub brings back catalogue, rows, prompt and the bundle.
5. No renderer runtime module is reachable from the main entry (build assertion).
6. Legacy `RendererStage` still renders all four formats; no production UI invokes the new host except the dev-only stub route, and no host UI module is shipped in this phase.
7. A manager request reuses a live renderer first; with none, the shared background window starts and is destroyed when its last consumer releases; each refusal reason is asserted, and beat sync is untouched.

---

## 5. Phase 2 — Mounts and host surfaces

**Goal:** the host mounts a driver component on every surface, sends cues, reads readiness and listens to events — proven with the stub while the legacy path keeps rendering.

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

1. The adapter mints `mountId`.
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

### 5.4 Prompt

- `HostPromptService` keeps the latest publication per `(driver, model, profile)`; AIRI writes it into `extensions.airi.avatar.prompt` only while that model/profile is the character’s binding.
- Publication is mandatory once the driver is activated for that model/profile; empty prompt/tokens are stored as empty, not as “no prompt”, for every driver. A prompt-capable driver that never publishes is a migration fault (§2 D5, §6.0 D-17); an empty publication is not.
- `buildSystemPrompt` switches **per driver**: migrated binding + `avatar.prompt` (including empty) → use it; otherwise keep `acting.modelExpressionPrompt` and the expressions provider until **every** format has been cut over and its reversal window closes. The provider is deleted only in Phase 8.
- An older publication is stale and surfaced as a fault; there is no token-vs-prompt version check because the pair is atomic.
- Switching profiles republishes; the prefix-cache cost is accepted and presented to the user.

### 5.5 Speech

- The **adapter** hosts the analyzer where the audio graph lives (ControlStripHost) and publishes `SpeechAnalysisFrame` (~30 Hz, latest-wins); frames propagate adapter-to-adapter as **observation** traffic — BroadcastChannel, no ack, no retention — and never traverse the main process. The runtime subscribes. A test asserts no speech frame ever travels as a cue.
- The new path consumes `SpeechAnalysisFrame`; `mouthOpenSize`/`currentAudioSource`, host `createLive2DLipSync` and the per-renderer envelope fan-out remain for the legacy path until Phase 8.
- Stage-Mate consumes the same frames; it never asks a renderer for an analyser.

### 5.6 Selection, panels and unavailable models

| Concern | Implementation |
| :--- | :--- |
| Driver picker | Mount `entry.picker` in a host dialog frame; props carry the character and current model; `select` returns imported `{ modelId, profileId }`. A builtin is imported first. |
| AIRI picker | Lists persisted rows; warns when a model cannot load; writes the binding anyway. |
| Panels | Host frame + declared chrome (`settings`, `popover`, `inline`); panels edit driver storage or send cues, never host state. |
| Replacement | Persist `extensions.airi.avatar` only — the host never writes `modules.displayModelId` or `acting.modelExpressionPrompt` after cutover (D10, D15) — then send `LoadCue`; failure is surfaced, never rolled back silently. The mount survives a model change; only a driver change replaces it. |
| Unavailable | `UnavailableModelReason` drives one view: enable driver, choose another model, clear binding. The model is kept. |

### 5.7 Preview and authorship

- Catalog and card chips read AIRI’s stored copy; no driver required.
- An import asks the driver for a preview while the model is decoded; failure does not fail the import.
- Drivers get their own preview pipeline; the four host preview generators remain for the legacy path until Phase 8.
- Author travels with the row and is cached; legacy `authorIcon` URLs are fetched or skipped with a warning.

### 5.8 Exit criteria

1. The stub mounts on `acting`, `stage`/`stage`, `stage`/`chat`, `rehearsal` and `preview`; illegal readiness transitions are rejected in dev.
2. A cue reaches only the addressed surface/purpose; capture returns bytes in the ack; `NO_TARGET` is a settled unapplied outcome; cancellation requests behave per the table.
3. A panel renders in settings and the strip popover; a picker returns an imported pair; the AIRI picker binds an unavailable model.
4. A stub publication reaches a test card; an empty publication stays empty; a non-migrated format still reads its legacy prompt.
5. Pointer events arrive box-relative for one mount; a second mount is unaffected.
6. Speech frames drive the stub; the new path sends no `mouthOpenSize`, and no frame crosses main.
7. All legacy behavior still works; no format is cut over.
8. The migration queue converts a fixture library, resumes after a kill, converts a character-bound model first, and parks a failing model on the legacy path with a badge.
9. The VRM architecture spike reports on D-1…D-15 and the mandatory two-mount case; its dev-only route is the whole artifact and is scheduled for deletion in Phase 6.

### 5.9 Migration service

Cutover (§6.5) is a data move, not a screen: every library model of a driver is re-imported through the ordinary import before the new path can render it. The service lives in `packages/stage-ui/src/libs/model-drivers/migration.ts` and:

- starts on launch, in the background, without blocking the stage;
- prioritizes models bound to a character, then the rest;
- converts one model per pass and resumes from `model-migration/{modelId}` after a crash or quit;
- keeps the legacy path rendering until that model's marker is written;
- parks a failed model on the legacy path with a "needs attention" badge instead of failing the driver;
- reports `N of M` in Settings → Data plus one toast. "No progress reporting" in the scope line means no per-cue progress, not no migration status.

### 5.10 Migration surfaces

One shared component, two hosts: the onboarding stepper for a fresh install restoring a pre-contract backup, and a one-time post-update screen on the first launch after a driver cutover. Onboarding re-runs on update; steps whose values are already configured are skippable and never overwritten, and a dedicated update mode is deferred (D16). Because the user can skip out of onboarding, Settings → Data always shows migration status and the legacy-copy deletion prompt on its own.

---

## 6. Phases 3–6 — The four first-party drivers

Order: **Spine → MMD → Live2D → VRM**. Each phase adds one driver, runs the per-model cutover (§6.5) and switches that format’s new path. **No legacy code is deleted in Phases 3–6**: the legacy path stays frozen and functional for the reversal window (D9), and every code deletion is deferred to Phase 8. Host legacy copies are removed only through the user deletion prompt (§6.5 step 10, §7.3), never as part of the cutover. A driver change that would break the legacy path is implemented in driver-only code or deferred.

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
| D-9 | **Profiles.** Represent appearance as driver-owned profiles; `saveProfile` works with no mount. | RFC §5.2/§7.2; `AiriOutfit` is host data today. |
| D-10 | **Prompt publication.** Publish `(prompt, actTokens, version)` per model/profile at least once (empty allowed), republish on profile change. | RFC §10.4; replaces the acting prompt. |
| D-11 | **Panel + picker.** Own the format’s settings UI and model list. | RFC §11; replaces per-format host panels. |
| D-12 | **Speech subscription.** Consume frames; the legacy mouth prop stays until Phase 8. | RFC §12. |
| D-13 | **Capture, stopAll, dispose.** Implement declared queries. | RFC §8.6. |
| D-14 | **Deactivate / purge / transfer / migrate.** `transfer` is mandatory for first-party drivers — it is the only complete legacy copy once host copies are deleted (§7.1); the rest is advertised and implemented where the RFC allows. | RFC §5.10, §10.2. |
| D-15 | **Row query.** Answer `listModels` after import/remove/profile change; whether that uses an index, a cache or on-demand enumeration is the driver’s implementation. | AIRI pulls; there is no row-index contract. |
| D-16 | **Retain the handover.** Keep the received legacy entries — settings, outfit payload, prompt and model bytes — in driver storage until Phase 8; drop the byte payload once the corresponding import succeeds and keep a model reference so revert can still re-emit it. | D14; revert reads from here. |
| D-17 | **Declare prompt capability.** The manifest states whether the driver publishes prompts. A prompt-capable driver must publish at least once per model/profile; an empty publication is valid, no publication is a fault. | D5. |

### 6.1 Phase 3 — Spine

**Driver work**

- Manifest/manager under `stage-ui-spine/src/driver/`; entry returns the Spine mount specifier.
- Mount: `load`, `motion`, `profile`, `expression`, `caption`, `reset`, `capture`; `occupiesPoint`/`hitTest`; no `view`/`effect`.
- Provider: `probe` from the ZIP/skeleton, `list`, `remove`, `preview`, `modelCapabilities`, profiles.
- Storage: give the driver its own storage for `settings/spine/*` and placement; the legacy keys remain untouched for reversal.
- Rows: report to the host on every change.

**Host wiring (legacy path preserved)**

- The `avatar` binding selects the new Spine mount; `displayModelId` + the existing branch still select the legacy path.
- `stage-model.ts` keeps its legacy mapping; the new path does not consult it.
- Legacy `selectVariantAndSkin`/`playOneShotAnimation`/`shouldUpdateView` call sites remain for the legacy path; the new path uses `ProfileCue`/`MotionCue`.
- `settings/spine/*`, candidate tables and the `SpineScene` branch stay until Phase 8.

**Exit:** load/act/profile/capture/occupiesPoint on acting + preview; settings survive restart; rows answer through a manager pull; legacy data and the legacy Spine path still work; `legacy-retention` written.

### 6.2 Phase 4 — MMD

**Driver work**

- Manifest/manager under `stage-ui-mmd/src/driver/`; `capabilityDiscovery: 'runtime'`; optional caption; no `view`.
- Own the texture companion: `confirmImport` receives all files in one set; resolve relative paths internally. The legacy `{id}-textures` convention stays for the legacy path until Phase 8.
- `probe` uses `validateMMDZip`/`extractMmdFromZip`; the 30-morph truncation disappears from the new path.
- Move `MorphSlot`, `MORPH_CANDIDATES`, `EMOTION_MORPHS`, `createMorphController`, `resolveMorphName` into driver-only code; declare the 14 logical slots as expression units.
- Give the driver its own storage for physics/IK/gravity, materials, lights/skybox, camera FOV, placement and custom/deleted motions.

**Host wiring (legacy path preserved)**

- The new path selects the driver mount; the legacy `MMDScene` branch, `texture-map`, `previewExpression`, host stores and `sync-engine.ts` reconciliation remain until Phase 8.
- The host’s `mmdTextureMap` remains the legacy input; the driver resolves its own files.

**Exit:** an MMD ZIP with textures imports/loads through the driver; capabilities match runtime; motion completion; rows answer through a manager pull; legacy path still works; retention written.

### 6.3 Phase 5 — Live2D

**Driver work**

- Manifest/manager under `stage-ui-live2d/src/driver/`; static discovery; `occupiesPoint`/`hitTest`; optional caption; no `view`; requirements declare the Cubism global and OPFS.
- Per-instance model in driver-only code (D-1); the legacy store singleton is untouched.
- Parameter editor, gimmick deck, mappings and DSL actions move into the driver panel. The DSL script is character content: the model-bundled DSL is ignored at load; the host’s dating-sim parser is kept and its verbs become cues. Where the script is stored is tracked in §8.6; it is not a driver blocker. Intimacy is character state.
- Caption: the driver draws its own head-tethered text from `CaptionCue`; no Pixi injection, no `ParamAngleX/Y/Z` reads.
- Pointer: subscribe to `RendererPointerService`; the legacy template/canvas/window listeners remain for the legacy path until Phase 8.
- Lip sync: consume frames; the host `createLive2DLipSync` and the 0..100 mouth prop remain for the legacy path until Phase 8.

**Host wiring (legacy path preserved)**

- The new path selects the driver mount; the legacy Live2D branch, `HeadTetheredCaption` Pixi path, `live2dSceneRef` chain, channels and ambient bridge remain until Phase 8.
- Remove the host re-export `packages/stage-ui/src/stores/live2d.ts` only in Phase 8.

**Exit:** load/ACT/caption/hit edges/capture/occupiesPoint; profiles survive; settings window restart; rows answer through a manager pull; legacy path still works; retention written.

### 6.4 Phase 6 — VRM

**Driver work**

- Manifest/manager under `stage-ui-three/src/driver/`; runtime discovery; `occupiesPoint`; `dispose`; optional caption; `view` only once a POI set exists.
- Per-instance VRM in driver-only code; the legacy `window.vrm`/`window.expressionManager` remain for the legacy path until Phase 8.
- Give the driver its own storage for camera, transform, render scale, physics, lights/skybox, mesh visibility and custom VRMA; `GazeCue` overrides the pointer; `ResetCue{scope:'view'|'transform'}`.
- Profiles replace `AiriOutfit` + `applyOutfit` on the new path; composition rules are the driver’s.
- `occupiesPoint` from the render target; `capture` from the canvas.
- V-HACK moves into the driver panel/dev surface on the new path; Stage-Mate keeps its placement and consumes host frames.

**Host wiring (legacy path preserved)**

- The new path selects the driver mount; `settings/stage-ui-three/*`, `applyOutfit`, the `airi-stores-live2d` writes, the VRM branch/panels and the viewer refs remain until Phase 8.

**Exit:** load/act/custom VRMA/profile outfit/capture/occupiesPoint; camera/placement survive; Stage-Mate follows; rows answer through a manager pull; legacy path still works; retention written.

### 6.5 Per-model cutover (runs inside each driver phase)

Run in two levels: **steps 1–2 for every legacy model of the driver**, then **step 3 once**, then **steps 4–9 per model**, then **step 10 once**. Every step is idempotent. Host legacy copies are deleted only after `absorbed && retained` and a user prompt (step 10); until then they are retained (D9).

1. **Record.** `HostNamedModelRecord`: `modelId` = legacy id; `modelDriverHint` = driver; copy name/nsfw/groups/tags; rebuild `searchKey`. Mint the default `profileId`.
2. **Preview.** Copy `previewImage` only when it is a data URL; fetch an asset URL or skip with a warning.
3. **Handover.** The renderer builds the **legacy handover** (below) from legacy storage and calls the runtime’s `migrate`; it is IPC-safe (`Uint8Array` payloads) and complete — model bytes included. Offer it once for the driver, after all of that driver’s models have identities. The driver absorbs it, **retains it in its own storage** (D-16) and reports `absorbed` and `retained`. The host writes `driver-migration/{driverId}` only on `absorbed && retained`; otherwise it keeps the handover and retries idempotently.
4. **Import round trip.** The driver provides the bytes it received in the handover and the host runs the ordinary import — `probe`, then `confirmImport` with the preserved `modelId`, the minted `profileId`, `overwrite: true` **only because the migration marker is present** (RFC §5.5/§5.6 permit the exception; an ordinary import of a held id remains `model-id-conflict`), and the migration provenance. The driver stores its copy and drops the handover’s byte payload, keeping a model reference. Write `model-migration/{modelId}`. The legacy blob stays until step 10.
5. **Profiles.** Convert card outfits to driver profiles through the handover; the card keeps its old fields (D10); the driver panel/picker takes over the UI.
6. **Prompt.** Hand `acting.modelExpressionPrompt` in the handover; the last publication becomes `avatar.prompt`; the legacy text stays until the format’s window closes. An empty publication is valid for every driver; a prompt-capable driver that publishes nothing is a fault (D5, D-17), so the handover stays unabsorbed for that model.
7. **Binding.** Keep `modules.displayModelId` frozen; add `extensions.airi.avatar = { driverId, profileId }`. No card re-binding, and the new path never writes the legacy field afterwards (D10).
8. **Placement.** The driver absorbs the `settings/positioning/models` entry; keep the legacy entry until the deletion prompt is answered.
9. **Rows.** The driver makes the new rows answerable to `listModels` through its own index or on-demand enumeration; the host cache updates after the next pull.
10. **Retention and deletion prompt.** Once every model of the driver is cut over, write `legacy-retention/{driverId} = { cutoverVersion, removeAfterPatch }` in `state.json`. The host then prompts **once per driver** in Settings → Data: the size of the legacy copies, what is removed, and that a downgraded build will no longer render those models. Deletion requires a second confirmation that repeats the size and the consequence; declining keeps them and leaves the action available. The prompt is unavailable while any character is still on that driver’s legacy path, and it names those characters. Card fields are never in the set (D10).

**Legacy handover shape.** Host-owned transition type; the contract carries it opaquely.

```ts
interface ModelDriverLegacyHandover {
  schemaVersion: 1
  driverId: ModelDriverId
  createdAt: number
  /** Window-global values + the model they described. */
  settings: {
    selectedModelId?: ModelId
    values: Record<string, unknown> // settings/<format>/*, raw
  }
  models: Array<{
    modelId: ModelId // preserved id, already registered
    profileId: ModelProfileId // minted default
    legacyModelId: string // label, not an identity
    values?: Record<string, unknown> // per-model settings, raw
    placement?: { x: number, y: number, scale: number }
    outfits?: unknown[] // converted by the driver
    prompt?: string // acting.modelExpressionPrompt
    /** Complete legacy content, so the driver never has to guess a layout. */
    files?: Array<{ name: string, mimeType?: string, bytes: Uint8Array }>
    url?: string // URL/preset models: no bytes to copy
  }>
  assets?: Array<{
    key: string // mmd-motion-*, custom-vrma-animation-*
    mimeType?: string
    bytes: Uint8Array
    deleted?: boolean // tombstones stay tombstones
  }>
}

interface ModelDriverLegacyHandoverReport {
  absorbed: boolean // true only when every model entry was absorbed
  retained: boolean // true only when the driver kept the handover in its own storage
  absorbedModelIds: ModelId[]
  unused?: Array<{ modelId?: ModelId, keys: string[] }>
  warnings?: string[]
}
```

Included: model bytes and legacy URLs — the offer is complete, and the driver hands the same bytes back into the ordinary import (round trip accepted, §6.5 step 4). Excluded: preview/author/name/tags (host record) and capability lists (the driver re-derives them from the import). `values`, outfits, files and assets are opaque; the driver interprets them and reports `unused`.

**Reversal during the window.** “Revert avatar migration” asks the driver for `LegacyRestorePayload` (C23) and feeds it into the **legacy import**, which recreates the legacy storage the old path reads; it then clears `avatar` for the affected characters and records `revertedAt`. `modules.displayModelId` and `acting.modelExpressionPrompt` are frozen and are never “restored”, because nothing changed them. Legacy copies are deleted only through the step-10 user prompt, not automatically.

---

## 7. Phase 7 — Hardening, transfer and the reversal window

**Goal:** while every format’s retention window is open, make backup/restore, device transfer, purge and user-side reversal real. This phase does **not** remove legacy code, and it never deletes legacy data automatically — deletion happens only through the user prompt of §7.3.

### 7.1 Backup and restore

- Enumeration includes: host model/profile records, row caches, pending payloads, prompt cache, migration/retention markers, each driver’s `driverTransfer` bundle (mandatory for first-party drivers, D-14 — once host legacy copies are deleted it is the only complete legacy copy), and any legacy copies the user chose to keep.
- `driverTransfer` moves the whole driver state as an opaque bundle; unrecoverable parts are warnings, not a failed restore.
- A pre-contract backup is read by a versioned legacy reader that imports through the two-phase path and writes deletion markers for what it consumed. The reader lives beside the host core; the cutoff is a named constant with a test that an older bundle is refused with a readable message (D14).
- The round trip — backup on profile A, restore on clean profile B — is an exit criterion here and in Phase 1 with the stub.

### 7.2 Transfer, purge and deactivation

- `purge` deletes every byte the driver persisted; the host clears its records only after success.
- A referenced model/profile is refused with a distinguishable outcome (C11).
- Deactivation stops mounts, releases runtime services, and leaves rows/catalog visible as unavailable.

### 7.3 Retention and reversal

For each format, after its cutover release:

- `legacy-retention/{driverId}` in `state.json` records `{ cutoverVersion, removeAfterPatch }`, where `removeAfterPatch` is at least three patch releases after the cutover version.
- The legacy render path stays in the build and is never written by new code. `modules.displayModelId` and `acting.modelExpressionPrompt` are frozen at their cutover values (D10).
- **“Revert avatar migration”** (Settings → Data/Maintenance, per driver) and **“Use legacy model”** (per character, while the window is open):
  - ask the driver for `LegacyRestorePayload` (C23);
  - feed those bytes into the **legacy import**, recreating the legacy storage the old path reads;
  - clear `extensions.airi.avatar` for the affected characters and record `revertedAt`;
  - keep driver data for re-migration.
- **Legacy copies are deleted only on a user prompt, never automatically.** After `absorbed && retained`, once per driver, the host shows the size of the legacy copies, what is removed, and that a downgraded build will no longer render those models; a second confirmation repeats the size and the consequence. Declining keeps them and leaves the action available. The prompt is unavailable while any character is still on that driver’s legacy path, and it names those characters.
- **“Migrate again”** is available for a reverted character/driver while the window is open: it re-runs the cutover against the driver’s retained handover and restores the `avatar` binding. Reversal and re-migration are both explicit user actions.
- A downgraded build cannot render a model whose host legacy copies were deleted, because it cannot ask the driver (D15). This is the one guarantee the design gives up and it is stated in the prompt.
- Card-field cleanup follows D10 and remains a separate, per-character explicit request; it is never part of the deletion prompt.

### 7.4 Pending payloads and two stores

- A model the user did not confirm becomes a `PendingModelPayload`: listed under the character, importable later, no identity, legacy id as a label.
- Legacy models under legacy ids, pending payloads and driver rows appear in one list; each model has exactly one owning source.
- A legacy reference resolves by exact id, then the alias table, then the user. An unresolved reference is cleared, never presented as `model-missing` (RFC §13.2).

### 7.5 Web, Pocket and quota

- The same cutover and reversal run on Pocket with a smaller quota and without OPFS everywhere.
- Re-import copies one model at a time; on a shortfall skip with a warning and keep it legacy-shaped. Legacy data is retained, so a skipped model is not a loss.
- Stage-Web’s in-process registry owns its manager directly under the single-instance assumption.
- On Web/Pocket `RegistryHandle.requestRenderer` runs the driver entry in-process and returns an in-memory channel; the window policy (visible renderer vs background window) is desktop-only.

### 7.6 Exit criteria

1. A clean-profile restore brings back catalogue, prompt, profiles, pending payloads and driver bundles; retained legacy copies are present until the user answers the deletion prompt.
2. “Revert avatar migration” restores legacy rendering for a test character through the driver round trip, including after the host legacy copies were deleted, and can be re-migrated.
3. A simulated downgrade build renders while host legacy copies remain, and fails with a readable reason once they were deleted — the documented consequence of D15.
4. A pre-contract backup restores through the legacy reader and writes deletion markers.
5. Referenced-model removal is refused; purge succeeds once references are cleared.
6. Declining the deletion prompt keeps the copies and leaves the action available; accepting removes them and a later revert still succeeds through the driver.
7. The deletion prompt is unavailable while a character is on that driver’s legacy path, and it names that character.

---

## 8. Phase 8 — Final removal

**Goal:** remove the legacy path, code and data only after every format has passed its reversal window. This is the point of no return and the last phase.

### 8.1 Cutoff conditions

All must hold:

1. every driver has a `legacy-retention` record whose `removeAfterPatch` has passed (at least three patch releases after its cutover);
2. no character has an active legacy path (every reverted character has been re-migrated or has had its legacy binding cleared);
3. the user has confirmed any pending re-migration or accepted clearing the legacy binding;
4. a backup created after Phase 7 exists, including driver bundles and records.

Whether the user already deleted the host legacy copies is not a condition: deletion is offered per driver and is never required before removal.

If condition 2 or 3 fails, removal is blocked with a user-facing request to re-migrate the remaining characters; it never silently drops a reverted character.

### 8.2 Deferred per-format deletions

Nothing was deleted in Phases 3–6; the legacy path stayed frozen for reversal. Phase 8 removes, per format:

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
| Per-format UI | `ModelCustomizer.vue`, `WardrobeMeshTreeNode.vue`, `vrm.vue`, `vrm-expressions.vue`, `live2d.vue`, `live2d-customization.vue`, `mmd.vue`, `spine.vue`, `ModelSceneSettings.vue` | driver panels |
| Picker | `model-selector.vue` per-format intake/report/repair branches | driver pickers + `probe`/`confirmImport` |
| Stores | five renderer BroadcastChannels, `packages/stage-ui/src/stores/live2d.ts`, `stores/settings/{live2d,spine,mmd}.ts` (VRM keys live in the renderer store, not a host settings store) | `HostServices`, cues, panels, driver storage |
| Speech | `mouthOpenSize`, `currentAudioSource`, host `createLive2DLipSync`, envelope fan-out | `SpeechAnalysisFrame` + driver subscription |
| Captions | `HeadTetheredCaption.vue` Pixi injection, `HeadTetheredCanvas2D.vue` in-canvas drawing, `getHeadPose`, `HeadPose` | `CaptionCue` |
| Capture | `captureFrame`, `readRenderTargetRegionAtClientPoint`, `airi:stage-capture`, stubbed sites | `capture` cue + `occupiesPoint` |
| Motion | `playStatus`, `binaryLoaded`, `vrm-instance-cache.ts`, `shouldUpdateView`, per-renderer trigger APIs | `ActCue`, `MotionCue`, `EffectCue`, `ProfileCue`, `ResetCue` |
| Stage-Mate | its writes to `settings/positioning/models` | its own window config, imported once |

**Kept per D10:** `cueAllowlist`, `compiledWhitelist`, `active_state.active_expressions`, `AiriOutfit.meshes`/`expressions`, `acting.modelExpressionPrompt`. They stay inert; a user-requested cleanup may remove them later.

### 8.4 Legacy data deletion

After the cutoff conditions:

- remove whatever remains of the legacy model records and bytes, `{id}-textures`, per-format settings and `settings/positioning/models` entries (a driver whose copies the user deleted has nothing left here); remove migration-only staging copies, but **keep** the card's `acting.modelExpressionPrompt` and every other card field per D10;
- keep the durable deletion markers and `driver-*` migration/retention markers;
- keep card fields per D10;
- delete one-time migration tables (§8.6).

### 8.5 Architecture guards

Vitest source scans. Each guard lands in the phase that creates the invariant it protects — never all at the end; a guard whose target does not exist yet is written, not deferred.

1. No host import of a renderer package outside the driver subpaths (`driver/manifest`, `driver/manager` in main; `driver/mount`, `driver/panels`, `driver/picker` in the loader table) and devtools.
2. No `DisplayModelFormat`, `DisplayModel`, `stageModelRenderer`, `display-model-` outside the migration module.
3. No `airi-stores-` anywhere.
4. No host reads of `settings/(stage-ui-three|live2d|spine|mmd|positioning)/`.
5. No `captureFrame`, `getHeadPose`, `HeadPose`, `live2dApp`, `vrmViewerRef`, `texture-map`, `preview-expression`, `mouthOpenSize`.
6. Host core has no Vue/Electron/Pinia dependency.
7. The contract has no format strings; runtime values are limited to contract constants/validators (`MODEL_DRIVER_CONTRACT_VERSION`, `READINESS_TRANSITIONS`, `isReady`, validators).
8. **Main bundle assertion:** no renderer runtime module is reachable from the Electron main entry (lands with Phase 1).
9. No host file writes `modules.displayModelId` or `acting.modelExpressionPrompt` after cutover (lands with Phase 2, D10).

### 8.6 One-time code expiry and docs

- The per-driver key table, format→driver table and checklist entry are deleted one release after that format’s removal; records, markers and deletion markers stay.
- Catalogs move with the change, not with this phase: `docs/data-catalog.md` (every new key in the phase that writes it), `docs/project-testing-parity.md` (every new suite in the phase that adds it), `docs/rosetta-stone.md` (when a canonical entry point moves, first in Phase 2), and `airi-character-rendering` (repoint paths; add `airi-model-driver-host` when Phase 2 lands). The remaining Phase 8 edits are only the ones the removals themselves cause.
- Deferred, not smuggled in: card-level profile/expression storage (D10 keeps fields until a user cleanup), the card script schema (the dating-sim parser keeps verbs working; where the script is stored is a follow-up, not a driver blocker), Stage-Mate as a second VRM mount, third-party packaging, a runtime loader, and consolidating beat sync into the background renderer.

### 8.7 Exit criteria

1. Every guard passes; `stage-ui`, `stage-pages`, each renderer package typecheck; `stage-tamagotchi` builds (includes typecheck); `stage-web` builds and its workspace typecheck runs separately.
2. A clean profile imports one model of each format, binds it, renders on acting + chat + settings preview, restarts, and sees the same result.
3. No legacy path remains; no host file reads a renderer store or names a format.
4. A reverted character blocks removal until re-migrated or cleared; no data is silently lost.

---

## 9. Testing and validation

### 9.1 Contract and host core (CI)

| Suite | Asserts |
| :--- | :--- |
| `stage-renderer-sdk/src/validate.test.ts` | manifest, compatibility, capability completeness, envelope rules, ack shape, mandatory/empty publication, prompt capability and the no-publication fault, stale publication |
| `stage-driver-host/src/registry.test.ts` | declaration registration, version rejection, manager creation/restart, `RegistryHandle` renderer request, each refusal reason, channel messaging, row pulls, enable/disable |
| `stage-driver-host/src/broker.test.ts` | accept→settle, correlation uniqueness, FIFO, drop, deadline/late ack, six withdrawals, `NO_TARGET`, window-gone, bounds |
| `stage-driver-host/src/transport.test.ts` | speech frames are observation-only and never enter a cue path or the main process |
| `stage-driver-host/src/storage.test.ts` | renderer namespace isolation, `keys()` scope, `watch`, concurrent writes |
| `stage-driver-host/src/entry.test.ts` | manager-performed entry lookup, specifier returned, unknown key → `invalid-entrypoint` |
| `stage-driver-host/src/stub-driver.test.ts` | stub through every host rule, failing mount, refusing cue |
| `stage-ui/src/libs/model-drivers/*.test.ts` | records, binding write/clear, frozen legacy fields, prompt cache, unavailable mapping, the migration queue (priority, resume, park-on-failure), the deletion prompt, reversal through the driver round trip, retention read from `state.json` |
| Architecture guards (§8.5) | source scans + main bundle assertion |

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/stage-renderer-sdk test
pnpm -F @proj-airi/stage-driver-host test
pnpm -F @proj-airi/stage-ui typecheck
```

### 9.2 Per-driver smoke (Electron/Web/Pocket, manual or E2E)

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

- Fixture `DisplayModel` of each format: identity, preview, handover with bytes, byte ownership, marker writes, retained handover.
- The full round trip: handover carries the bytes, the driver retains them, the ordinary import stores them, and a later `LegacyRestorePayload` returns the same bytes.
- Crash between `confirmImport` and the marker; re-run; idempotent, no duplicate.
- Handover partial absorption: host keeps it and retries; no model loses appearance/prompt.
- `retained: false` blocks `driver-migration/{driverId}` and nothing is deleted.
- Three-patch simulation: a build at `removeAfterPatch - 1` refuses removal; a build at cutoff allows it.
- Reversal: revert through the round trip after the host copies were deleted, re-migrate, and a downgrade failing readably.
- The deletion prompt: declined keeps the copies and stays available; accepted removes them; unavailable while a character is on the driver's legacy path.
- Backup round trip with driver bundles (mandatory `transfer`) and any retained legacy copies.
- Quota shortfall: skipped model stays legacy and retryable.

### 9.4 Builds

- Phase: affected workspace typechecks; `stage-tamagotchi build` (includes typecheck) and `stage-web build` when main/routing/packaging changes.
- Main bundle assertion runs with every main build.
- Catalogs update in the phase that changes them: a phase that adds a storage key or a suite without updating `docs/data-catalog.md` / `docs/project-testing-parity.md` is incomplete, not deferred to Phase 8.
- `pnpm lint:fix` is not validation; if used, review the whole diff.

### 9.5 Not CI-testable

WebGL/WebGPU, Cubism, Spine, audio devices, multi-monitor DPI and Electron window behavior are manual smoke targets; §9.2 is the proof that a driver draws.

---

## 10. Risk register

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Host row cache drifts from manager state | Catalog falls back to a stale row | Manager pull is authoritative; cache is display-only; `ok:false` never read as “no models” |
| Manager renderer request refused or unavailable | `listModels` cannot answer | A live renderer first, the shared background window as fallback; each refusal reason is surfaced to the UI caller |
| Background window dies | Channel closes; catalogue falls back to cache | Manager requests another entry on the next pull; the row cache is display-only; no host crash |
| Background window keeps the app alive | App does not quit after the visible windows close | Exclude it from the `window-all-closed` count while any consumer is registered; destroy it when the last consumer releases |
| Background window's storage origin differs in packaged builds | Driver storage reads empty in production | §1.5 states one origin; verify a known driver key round-trips in dev and packaged builds before Phase 3 |
| Background window throttles timers | Driver code stalls | Manager-requested code is request/response, not a render loop; no long-lived timers in that window |
| Manager/runtime message protocol drifts | Driver-defined messages fail to parse | Host transports opaque messages; the driver owns versioning and reports its own failure |
| Manager subpath pulls renderer UI into main | Main bundle bloat/crash | `externalizeDeps.exclude` + DOM-free manager lint + CI bundle assertion |
| Runtime specifier not in the renderer loader | `invalid-entrypoint` at mount | First-party loader table is generated from the same driver list; test every declared entry |
| Tree-shaking is not a boundary | Renderer code leaks into main later | Build assertion fails the build, not a convention |
| Legacy copies occupy disk until the user answers the deletion prompt | Disk pressure on large libraries | The prompt shows the size and what is freed; declining is allowed; the driver’s `driverTransfer` bundle is the fallback copy |
| A reverted user blocks final removal | Legacy path cannot be deleted | Removal is gated and explains the re-migrate/clear action; never silently drops the character |
| Handover partially absorbed | Appearance/prompt lost for some models | One handover per driver with per-model entries; retain until `absorbed && retained`; driver idempotent |
| Driver drops the retained handover | Revert has no source | `retained: false` blocks the migration marker; the queue retries; nothing is deleted |
| A prompt-capable driver never publishes | No prompt reaches the system prompt and the migration still looks complete | Publication is mandatory; absence is a migration fault (D5, D-17) that keeps the handover unabsorbed |
| User skips onboarding while migration runs | Migration appears stalled or invisible | Settings → Data always shows the queue and the deletion prompt (§5.10) |
| Legacy copies deleted while a character still renders the legacy path | Stranded character | The deletion prompt is unavailable until that character is re-migrated, and it names the character |
| User declines the deletion prompt | Disk stays occupied | Declining is supported; the action stays available in Settings → Data |
| Prompt gating leaves two paths | Acting guidance inconsistent | Gate by migrated driver, not global; delete provider only in Phase 8 |
| Per-instance driver state | Two mounts overwrite each other | D-1 is a per-driver exit criterion; preview is the mandatory second mount in smoke |
| Stage-Mate diverges | Two avatars disagree | Own placement, host speech frames, forwarded cues |
| Migration tables outlive the migration | Host re-learns renderer storage | Delete each table entry one release after removal |

---

## 11. Definition of done — program summary

Each phase's exit criteria are that phase's Definition of Done and its gate (the approval boundary at the top of this document). The checklist below is the program summary: it is satisfied only after Phase 8 and is not a gate for any single phase.

- [ ] RFC 0002 maps 1:1 to contract symbols; validators/tests pass; `MODEL_DRIVER_CONTRACT_VERSION` bumped for breaking shapes.
- [ ] Registry-owned managers in main + `RegistryHandle` + shared background-window request with refusal reasons + host row cache + broker + mount registry + adapter/loader + web storage exist and are used by every format.
- [ ] Four drivers implement manifest, manager, runtime, provider, mount, panel, picker, storage, profiles, prompt, preview, speech, declared queries and row queries.
- [ ] Every surface (acting, stage/stage, stage/chat, rehearsal, preview, onboarding, card export) mounts through the driver path.
- [ ] Cues, acks, refusals, failures, drops, deadlines, cancellations, `NO_TARGET` and window-gone settle per RFC.
- [ ] No host file imports a renderer UI module; no host file names a format; guards + main bundle assertion prove it.
- [ ] Models, previews, annotations, settings, placement, outfits-as-profiles and prompts survive migration; partial handovers retry; crashes resume.
- [ ] Reversal works for at least three patch releases through the driver round trip; deleting host legacy copies is user-prompted, never automatic; final removal is gated and user-confirmed.
- [ ] Web/Pocket pass the same smoke list minus desktop-only surfaces.
- [ ] Docs, data catalog, test parity, Rosetta Stone and the relevant skill updated; one-time tables scheduled for deletion.

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
| Prompt | per-scope `activeKeys`, host wording | Per model+profile publication, ACT token list, one version |
| Cue addressing | `target.mountId` | Driver + surface (+ purpose); manager fans out |
| Cancellation | absent | Six withdrawals, seven states, per-target results |
| Queries | live component only | Also by surface+purpose through the manager |
| Capabilities | one list | Claim vs probe, interaction modes, effect/reset deltas |
| Migration input | entries reported `unused` individually | Legacy handover, once per driver, per-model entries |
| `pending-import` | transient state | Persisted identity-less payload |
| Manager | main (RFC 0001) | Main; registry-owned; `RegistryHandle`; renderer request; host row cache |
| Reversibility | none | ≥3 patch releases, driver-served revert through the legacy import, removal last |
| Stage-Mate | outside contract, own placement | Same ruling, retained |

Per-renderer inventories and deletion candidates remain the starting point for §6; the decisions, transport, shared state, prompt and cancellation sections must not be carried over.

---

## Appendix C — Contract conformance map (after Phase 0)

| RFC section | Symbol(s) | Status |
| :--- | :--- | :--- |
| §4.1 actors | registry, mount registry, manager, runtime, adapter | Manager in main; adapter exported |
| §4.2 communication | cue channel/sink, manager deliver/withdraw, observation | Complete |
| §5.1 identity | ids, adapter minting, `ModelState` | Complete; `pending-import` moved out |
| §5.2 profiles | provider profiles, reference gate | Complete |
| §5.3 two-phase import | probe→parts, confirm with input, per-entry settlement | Complete (C21) |
| §5.4 builtins | descriptor without id | Already conformant |
| §5.5 duplicates | conflict, overwrite, resetProfiles | Complete |
| §5.6 provenance | migration marker + host marker | Complete |
| §5.7 preview/authorship | preview/author records | Already conformant |
| §5.8 enumeration | `listModels`, `ModelSummary`, `RegistryHandle` renderer request with refusal reasons | `RegistryHandle` request (C22) |
| §5.9 capabilities | modelCapabilities, effect kind | Complete |
| §5.10 transfer/deletion | export/import, purge, reference gate | Complete |
| §6.1–§6.3 declaration | manifest, requirements, activation | Manager-only entry (C15) |
| §6.4 claim vs probe | capabilities, interaction modes | Complete |
| §6.5 loading | manager resolveEntrypoint → specifier | Complete (C15) |
| §7.1–§7.4 selection/replacement/prompt | picker, binding, publication | Complete (C7) |
| §8.1–§8.6 mounting | props/emits/exposed, transitions, queries, acting rename | Complete |
| §9.1–§9.7 cues | envelope, vocabulary, ack, delivery, cancellation, no-target | Complete |
| §10.1–§10.5 services | storage (runtimes), pointer, prompt, theme | Complete |
| §11 panels | panel/picker declarations | Complete |
| §12 speech | frames + analyzer service | Complete |
| §13 migration | legacy handover with model bytes, records, retention, `LegacyRestorePayload` for revert | Complete (C13, C23) |
| — | Contract revision | `0.1` from Phase 0 close; `{ major: 0, minor: 2 }` is draft-only and must not appear in a manifest |

---

## Appendix D — Work order at a glance

| Phase | Slice | Ships when |
| :--- | :--- | :--- |
| 0 | Contract closure + validators | SDK typecheck/tests green; zero importers |
| 1 | Host core + registry-owned manager in main + `RegistryHandle`/renderer request with refusal reasons + shared background window + host row cache + stub | Broker/registry/manager-request/entry/window-gone suites pass in two windows |
| 2 | Mounts, surfaces, prompt, panels, picker, speech, migration queue and surfaces, VRM spike | Stub renders on every surface; the queue resumes; spike report; no format cut over |
| 3 | Spine cutover | Spine loads/acts/profiles/captures; legacy retained |
| 4 | MMD cutover | MMD imports with textures through the driver; legacy retained |
| 5 | Live2D cutover | Caption/pointer/OPFS/DSL actions; legacy retained |
| 6 | VRM cutover | Camera/transform/profiles/VRMA; Stage-Mate follows; legacy retained |
| 7 | Hardening, transfer, retention/reversal | Backup round trip; revert works after deletion through the driver; deletion is user-prompted |
| 8 | Final removal after every window | Guards green; legacy path/data gone; reverted characters handled |
