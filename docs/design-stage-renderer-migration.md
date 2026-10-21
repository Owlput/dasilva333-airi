# Stage renderer migration outline

Companion to [`rfcs/0001-stage-renderer-plugin-contract.md`](./rfcs/0001-stage-renderer-plugin-contract.md).
The RFC is the upstream-facing design; this file is the fork-facing work plan for
moving the four existing renderers behind it.

**Status: proposal.** Nothing here is implemented, and nothing in this file is
authorization to change code — it is the order of operations, the per-renderer
mapping, and the decisions that have to be made first.

**Revision 2026-10-20 — multi-window decisions applied.** This plan now assumes:
the host keeps a **mount registry + cue broker in the Electron main process** over
`@moeru/eventa`; **capture is a cue** (`CaptureCue`), not an exposed method; **lip sync
is a plugin-level analyzer** (`HostSpeechAnalyzerService`), not a renderer contract
member; imports are **two-phase** (`probe -> parts`, then AIRI-minted `selections` into
`confirmImport`); an existing `modelId` is a **conflict** unless migration explicitly
overwrites it; and calibration UIs live in **driver panels**, not in a host
`EmotionCalibrationStudio`. Where older text below says "audio tap", "captureFrame" or
"probe with the minted id", this revision wins.

**Revision 2026-10-21 — P1/P2 decisions applied.** Model import uses **`files` only**
(no `file`/companion split) and AIRI imports **models only**; `saveProfile` needs a
registered driver but **no mount**, while `MigrationInput` stays TBD; actor and chat
share one **semantic `stateScope`** (preview is the only private scope), while the first
cue broker is **single-mount** and `stateScope` fan-out is deferred; the control strip's
expression/motion/wardrobe picker is a
**driver-provided panel** (`hostSurfaces`/`hostSurface`); head-tethered captions are
rendered by a **driver that declares `caption`** (optional capability) and AIRI no longer
consumes `HeadPose`; storage namespace isolation is **AIRI-side** and invisible to the driver;
**this release is first-party only**, the static manifest is read before the runtime, and the
main registry holds only manifest/enable state; `capture` has an **empty payload** and returns
the renderer's own canvas; legacy deletion writes
tombstones so reboot/cloud restore cannot resurrect data. Where older text below says
"preview mount" for chat, `getHeadPose`, `saveProfile needs a mount`, `file` +
companions, or `includeBackground`, this revision wins.

Evidence: every mapping below was produced by reading the four renderer packages
and the host wiring. Line references are to the tree as it stands today; the
per-renderer inventories they come from are cited inline.

## Order of work

Each renderer moves behind the contract **in its own release**, and the app keeps running the
un-migrated ones on the old path until their turn, so no phase depends on a big-bang switch.

| Phase | Contents | Ships when |
| :--- | :--- | :--- |
| 1 | Host scaffolding (§2): **main-process mount registry + cue broker over eventa**, plugin-level speech frames, snapshot and prompt stores, records, the `migrate` channel, `stageModelDriverId`, backup visibility | a stub driver passes the phase-1 checks with no real renderer touched; two windows can route and ack a cue |
| 2 | Spine (§3.1) + its cutover | Spine models load, emote, move and keep their settings; its legacy keys are gone |
| 3 | MMD (§3.2) + its cutover | the same, and the morph/emotion tables now live in the driver |
| 4 | Live2D (§3.3) + its cutover | the same, and the DSL stops being a host renderer API while the pose transport disappears |
| 5 | VRM (§3.4) + its cutover | the same, and camera, meshes, auras and custom VRMA live in the driver |
| 6 | Shared deletions and the final cutover (§4) | the format enum, `DisplayModel` and every host per-model panel are gone |
| 7 | First-party packaging and transfer (§5) | a clean-profile restore brings a device's drivers back; third-party publish/loader is deferred |

Two rules hold across the whole sequence: **the host reads no renderer store once that renderer's phase
has landed** (if it still does, the phase is not done), and **no legacy data is deleted before the
driver confirms it absorbed it** (§4.1).

---

## 1. Decisions required before any code moves

The RFC's section 9 lists what the contract cannot express. These are the decisions a renderer needs
settled **before** it moves behind the contract; most are now written into the RFC as closed items,
and the table keeps the ruling and the cost of each. Two of them invalidate prose that migration
would otherwise entrench. D7 is not from the RFC: it settles who owns the wardrobe UI now that
appearance travels as a profile. D8 closes the leftover half of 9.8, where the question was
what a capability kind and an `ExpressionCue.key` actually name. D9 is not from the RFC either: it
settles who owns a script, which is the question 9.5 and 9.12 were circling. D10 comes from 9.12 too,
and it cuts scope rather than assigning it: beat sync is not worth a driver-layer service, so the
stream it would have needed is deleted and the feature is temporarily unavailable to drivers.

| # | Decision | Why it blocks |
| :--- | :--- | :--- |
| D1 | Gesture / pointer-edge input (RFC 9.1) | **Decided:** `RendererPointerService` delivers `down`/`move`/`up`/`cancel`/`enter`/`leave`/`wheel` with `pointerId`/`button`/`buttons`/`modifiers` to one named mount, subscribed by `mountId`. Every renderer's own drag/pinch/wheel listener is deleted as it migrates. |
| D2 | The pointer-space correction (RFC 9.2) | **Decided:** `RendererMountPoint` is box-relative CSS px, converted once host-side; the renderer maps onward itself. The contract note that claimed the producers already did this is corrected, and all three wrong conventions (Live2D window px ÷ canvas size, VRM `window.innerWidth/Height`, Spine backing-store px) are migration inputs. |
| D3 | Live observation (RFC 9.3) | **Decided: the direction flips.** AIRI provides the prompt service and the renderer publishes into it — `ModelDriverHostServices.prompt.publish({ stateScope, activeKeys })` from the mounted instance, with AIRI wording the line from the vocabulary it already holds, in the tail. `createExpressionsContext`'s store imports (`context-providers/expressions.ts:14-51`) are deleted rather than ported. Every surface that displayed live state becomes a driver panel (D7) — the control strip's expression, motion and wardrobe pickers (`ControlStrip.vue:940-1035`) and `ModelCustomizer`'s row highlighting — so no host surface reads renderer state. The control strip mounts the **driver-provided** panel in a host popover shell (`hostSurfaces`, `hostSurface`), not a built-in picker. |
| D4 | Text/caption channel (RFC 9.4) | **Decided:** `CaptionCue` carries the utterance, its sentence split and timing, `utteranceId` and `elapsedMs`; the renderer owns all presentation. `nativeHandle` is deleted and the host stops drawing inside any renderer's canvas — which also deletes host-side overlay controls and every `sceneRef`/`viewerRef` reach-through. |
| D5 | Transform ownership (RFC 9.6) | **Decided: the renderer owns placement, and every host copy dies.** Position, scale, rotation and the camera are per-model settings like render scale or physics, so they live in renderer storage and travel in its snapshot `values`; the host keeps no copy and restates nothing. That deletes `settings/positioning/models` plus the per-renderer position/scale keys, the drag → emit → store → prop round-trip, and `ViewControls`' X/Y/scale sliders (D7 takes them). What survives on the host is exactly three things: `interactionMode` (already a prop), `ResetCue` with the new `scope: 'transform'`, and **Stage-Mate** — a fourth writer that keeps its own copy (D16) instead of `settings/positioning/models` (`stage-model.ts:391`). A one-time import of the old keys into renderer storage is part of the driver work, or every user's layout resets (§9.2). |
| D6 | Addressing disambiguation (RFC 9.8) | **Decided:** `SelectionCue` and `MeshCue` are both deleted — AIRI must not drive raw parameters or toggle parts, so appearance is a `ProfileCue` and the renderer composes it. D8 settles what `ExpressionCue.key` names. |
| D7 | Model settings and wardrobe UI | **Decided:** every per-model settings surface is a **driver-provided panel** (`ModelDriverPanelDeclaration`) — expression and motion mappings, wardrobe, and scene/physics/material controls. Toggling parts, grouping outfits, the composition rules (base/overlay interaction) and the capability lists are all driver code; the host only mounts the panel and frames it. **The control strip pickers use the same mechanism**: a driver declares `hostSurfaces` containing `popover`/`inline`, and the host supplies only the popover shell and anchor. Deletes `ModelCustomizer.vue` (reach-throughs at `:361,430,441`, wardrobe half at `:652,740-751`), the per-format panels (`vrm.vue`, `vrm-expressions.vue`, `live2d.vue`, `live2d-customization.vue`, `mmd.vue`, `spine.vue`, `ModelSceneSettings.vue`) and their `usePositioningStore` reads; `model-settings/index.vue` keeps the route and the preview frame. **Calibration is one of these panels**: `EmotionCalibrationStudio` does not survive as a host component, and a calibration action edits only a preview mount of its own `stateScope` — never the global `stageModelSelected`. Card storage is a separate, deferred step (§8.9). |
| D8 | Capability kinds and the token→native mapping (RFC 9.8) | **Decided:** there is no `morph` kind. One addressable unit is one `EXPRESSION` descriptor whatever backs it — vertex morph, blend shape, parameter preset — and `ExpressionCue.key` names that unit. A driver whose ACT token differs from its native name keeps the alias table itself; AIRI stores the token, never the raw key. Deletes the host's `rawKey → label` round-trip (`airi-card.ts:868-890`, `ControlStripHost.vue:409-423`) and the `previewExpression = rawKey` write (`ModelCustomizer.vue:805,943`). |
| D9 | Who owns a script (RFC 9.5, 9.12) | **Decided:** the script is character content, not renderer content. The DSL lives in the **character card** and AIRI interprets it; what it calls is the action a driver already offers — `MotionCue`, `ActCue`, `ProfileCue` — which the driver composes itself. The parts of a script about model motion are **model capability**; the parts about variables, intimacy and choices are **character state** and never cross into a renderer. So the SDK carries no VM, no verb set and no intimacy channel, and a model bundle stops being a place where behaviour is authored. |
| D10 | Beat sync (RFC 9.12) | **Decided: out of the contract.** Beat sync is a secondary feature and is not worth a driver-layer service. **There is no `HostAudioInterface` in the contract at all**: lip sync is a plugin-level analyzer (`HostSpeechAnalyzerService`) that registers against the host audio source and publishes frames, and a renderer never receives an `AudioNode`. The beat feature is **temporarily unavailable to drivers**: the only capture of outside audio the app can make lives in a dedicated hidden window, whose `AudioNode` cannot be handed to a renderer in another realm, and the capture handler is one app-wide `defaultSession` handler that its owner resets to `null` (`packages/electron-screen-capture/src/main/index.ts:146-151,228-239`). The beat-sync window, its channel and its payloads stay as they are. A first-party driver may read the plugin-layer channel directly as a stopgap; that is outside this contract and costs it portability. |
| D11 | Where pre-contract settings go (contract gap) | **Decided: one explicit channel.** `ModelDriverRuntime.migrate(hostState)` plus `ModelDriverCapabilities.migration` (RFC 5.9, 9.16). The host builds one bag per driver from a per-driver key list, adds `selectedModelId` for the window-global entries, offers it **once after `activate` and before the first mount**, deletes only the entries the driver does not report as `unused`, and marks the driver. **The bag's final shape is still TBD**; `entries`/`selectedModelId` are the transition shape, not a frozen contract. A failure keeps every key and retries on the next activation (three attempts, then one toast with a retry action). `migrate` MUST be idempotent, because a crash between the driver's write and the host's marker re-offers the same bag. The key list is one host table that dies with the last driver; it is not a contract. |
| D12 | Identity and records | **Decided: `ModelId` keeps the legacy value.** A `DisplayModel.id` (`display-model-<nanoid>`) becomes the `modelId` unchanged, and a card's `displayModelId` (`card.schema.ts:103`) therefore keeps working with **no card migration and no re-binding**. One `HostNamedModelRecord` per legacy record (`name` -> `displayName`, `nsfw`/`groups`/`tags` copied, `previewImage` -> `preview`, `modelDriverHint` from one format -> driver table), and **one default `profileId` minted per model before its first load**, which is what makes `ModelScopedState.profileId` never empty. `expressionCapabilities`/`motionCapabilities` are re-derived by the driver (`modelCapabilities()`) rather than imported; `outfits` become driver profiles through D11's bag, written straight into the driver's own profile storage. `saveProfile` only requires the driver to be registered, not a live mount, so migration can call it before the first mount; `vfxMappings` travel in the bag as well. |
| D13 | Model bytes | **Decided: re-import through the public front door, in two phases.** Per legacy model the host builds a `ModelProbeInput` from its own store — the localforage blob plus the `{id}-textures` files all in one `files` array with aligned `fileNames`, `url` for URL models — and calls `probe`, which returns `parts` and writes nothing. There is no `file`/companion split; AIRI only imports models, and non-model assets use the driver's own channel. It then calls `confirmImport({ selections: [{ partIndex, modelId: preservedLegacyId, profileId: mintedDefaultProfileId }], overwrite: true, migration: { source: 'legacy-display-model', sourceId, payloadHash } })`. The `overwrite` is migration-only and is guarded by a `pending`/`done` marker, so a crash replay is safe and a normal import of the same id still gets `MODEL_ID_CONFLICT`. The legacy blob is deleted **only after** `ok: true` and the marker is `done`. Cost: a full decode per model and a 2x peak for that model only (one at a time, gated on `navigator.storage.estimate()`); if there is no room the model is skipped with a warning rather than half-migrated. |
| D14 | Thumbnails | **Decided: never a live render during migration.** Copy the legacy `previewImage` into `HostAnnotationFields.preview` **only when it is already a data URL**; an asset URL/path is not a data URL and must be fetched or skipped with a warning, never stored as-is (`ModelPreview.dataUrl` is persisted in a reactive record). New imports produce a preview at import time, when the driver already has the model decoded (`ModelDescriptor.preview` or `provider.preview()`). The host's offscreen preview renderer (`display-models.ts:271`) is deleted with the store. A driver with `previewModel: false` shows the catalog placeholder until its panel asks for one. |
| D15 | The ACT alias table | **Decided: driver storage, keyed by `modelId`.** The host's per-activation push (`airi-card.ts:867-895`, `ControlStripHost.vue:240,364`, `ModelCustomizer.vue:269,347`) is deleted — the map it derived is the driver's own capability-label projection, which the driver already knows. `settings/live2d/emotion-mappings` is a **single global key with no model attribution** (last activation wins), so it is handed to the Live2D driver once and applied to `selectedModelId` only; per-model re-binding happens in the driver panel. That is a bounded, explicit loss rather than an invented attribution. |
| D16 | Stage-Mate | **Decided: outside the contract for this migration.** The Unity sidecar stays a host-side actor with its own bridge, not a driver and not a mount: it has no `stateScope`, no snapshot and no cue sink. Its placement moves into the sidecar's own persisted window config, one-time imported from `settings/positioning/models`, so for now the stage and Unity are placed **independently** — an accepted behaviour change, revisitable later as a second mount of the VRM driver (mount != model, one `stateScope`) if the divergence grates. Its lip-sync envelope is computed by the host from **its own** main-window audio graph / `SpeechAnalysisFrame` stream, never from a renderer's analyser, so no renderer is consulted for it. |
| D17 | `StageModelRenderer` | **Decided: a driver id, and the comparisons die in each renderer's phase.** `stage-model.ts:11`'s four-value union becomes `stageModelDriverId` in phase 1 (`'disabled'` becomes "no driver bound"), and the 63 `stageModelRenderer === '...'` comparisons are resolved by the phase of the renderer they belong to. They become capability questions (`caption`, `view`, `occupiesPoint`), panel presence, or a `driverId` equality where a host-only dev tool genuinely needs one (V-HACK, L-HACK). Target: **zero driver-id checks on the stage path**; the dev-tool ones are listed and kept. |
| D18 | First-party scope | **Decided: this release supports first-party drivers only.** They are consumed through workspace static imports; the SDK stays `private` + source-only and no third-party install/dist/publish is promised. Remove `private` and add `dist`/`.d.ts`/`files`/`peerDependencies.vue` only after the contract and renderer host are stable. |
| D19 | Manifest/runtime order and main registry scope | **Decided: manifest first, runtime second.** Main discovers/validates the static manifest and keeps only manifest/enable state; the renderer loads the runtime and calls `activate()`. `rendererCapabilities()` needs a live instance in that window and is never answered by main; the main registry holds nothing beyond manifest information. |

Three prerequisites are host-side and none is a contract defect: **no `profileId` exists anywhere
today** (the import path in `stage-model.ts` mints only the model id, while `LoadCue.profileId`,
`ProfileCue`, `HostModelProfileRecord` and `ModelScopedState.profileId` all need one minted before the
import); **there is no record to hold a model's identity, annotations and preview** (`DisplayModel`
has the data but is the object being deleted); and **there is no place to keep a driver's snapshot or
its prompt keys**, which also means those two stores must exist before the first `migrate` call or
driver state would be written into nothing.

D12–D19 are the decisions that turn those into one cutover: identity is preserved by construction, the
bytes come back through the public import path, thumbnails are copied rather than rendered, the alias
tables move into the driver, Stage-Mate stays outside, the format enum becomes a driver id,
first-party-only packaging is explicit, and the static manifest precedes any runtime.

One more cleanup belongs to phase 1 rather than to any renderer: the removed `draggable` prop is still
passed to Live2D, Spine and MMD (`RendererStage.vue:479,519,547`; `Live2D.vue:131` and `MMD.vue:246`
read it), so those pass-throughs go with the prop surface they belong to. The same step removes every
host reach-through into a renderer's viewport: `HeadTetheredCaption.vue`'s Pixi bubble and the
`live2dSceneRef` chain that feeds it (`RendererStage.vue:563`), `HeadTetheredCanvas2D.vue`'s in-canvas
drawing, and the `vrmViewerRef`/`spineViewerRef`/`mmdViewerRef` exposures — because the contract now
says AIRI never touches one, and text travels as `CaptionCue` instead.

---

## 2. Phase 1 — host scaffolding

Everything below is host-side and testable against a stub renderer before any real
renderer moves.

| Item | Target | Notes |
| :--- | :--- | :--- |
| `stateScope` minting + snapshot record | new host store | **One shared scope for every non-preview mount** (actor, chat, rehearsal, main stage); each preview mount gets its own scope. Scope has semantic identity and does **not** include `modelId`; model switches update the record. Must never equal a `RendererMountSurfaceKind` value. New persisted keys, so `docs/data-catalog.md` gains them in the same change. |
| Authoritative `state`/`prompt` copy in main | main-process coordinator + eventa | Renderers publish over IPC; main keeps the record and broadcasts the accepted revision, so the main window can build prompts while the actor is elsewhere. A mount unmount clears its scope's prompt line. |
| One cue bus + **mount registry/broker in Electron main** | replaces `airi-stores-live2d`, `airi-stores-stage-ui-live2d`, `airi-stores-stage-ui-live2d-motion-control`, `airi-stores-stage-ui-mmd`, `airi-stores-stage-ui-spine` | `@moeru/eventa` contracts in `shared/eventa.ts`: mount register/update/unregister/list, cue send/deliver/ack. Broker owns global nonce, per-mount FIFO, pending table and timeout. The first broker is **single-mount**: `mountId` addresses one, `stateScope` is rejected with `INVALID_ENVELOPE`, and fan-out with an aggregate ack is a follow-up. In-process short-circuit for web/pocket. BroadcastChannel is observer-only; it cannot carry an ack. |
| Plugin-level speech frames | `HostSpeechAnalyzerService` (main-window audio owner) | Phase 1 reuses the existing `ControlStripHost` analyser to publish `SpeechAnalysisFrame` (~30 Hz, latest-wins) before the plugin loader exists. No `AudioNode` in IPC; no per-frame cue. |
| `services.storage` | wraps localStorage/localforage with a renderer-scoped namespace | The renderer must be able to enumerate *its own* keys (`keys()`) and observe changes (`watch()`) — the latter is what lets a settings-window panel update the actor mount without a store import. |
| Manifest-first validation + split registries | main manifest registry + renderer `ModelDriverHostRegistry` + main `ModelDriverMountRegistry` | **Manifest first, runtime second**: main reads the static manifest and keeps only manifest/enable state; the renderer then loads the runtime and calls `activate()`. `rendererCapabilities()` is answered by the renderer instance, never by main. `contractVersion` is checked at manifest read; enable/disable; `resolveMountComponent()` lazily (today `RendererStage.vue` imports all four scenes statically). Mount descriptors carry `mountId`, `modelDriverId`, `modelId?`, `surface`, `stateScope`, `windowId`, `readiness`; window destruction clears them and settles pending sends `aborted`. |
| `profileId` minting | `stage-model.ts` + card | After `probe` returns `parts` and the user selects them, before `confirmImport`; **one default per model** (D12) so a mounted model always has a profile to report. The legacy id is preserved only through the migration `overwrite` path. |
| `HostNamedModelRecord` / `HostModelProfileRecord` | replaces the capability fields on `DisplayModel` | `HostAnnotationFields` already matches the stored preview shape (`display-models.ts:1618`). A model is addressable by its legacy id unchanged (D12), so no card is touched. |
| `migrate` channel + per-driver key table | `ModelDriverRuntime.migrate` + one host table (D11, RFC 5.9) | Offered once after `activate`, before the first mount. Deletes only entries the driver did not report as `unused`; `driver-migration/{id}` is the marker. Test it by calling twice — retry has to be a no-op. |
| `prompt` store | new host store next to `state` | `scope -> activeKeys`, written only by a mounted instance. The prompt tail reads the **shared** scope's last publication; a scope with none contributes no line. |
| Backup visibility | BYOS key enumeration | The new record and snapshot stores *and* each driver's `driverTransfer` bundle have to be enumerated, or a device move restores AIRI's catalog against an empty driver. Round-trip it here, not in phase 7. |
| `stageModelDriverId` | replaces `StageModelRenderer` (D17) | The four-value union becomes a driver id; `'disabled'` becomes "no driver bound". The 63 comparisons are retired in each renderer's own phase; the few host-only dev tools that keep one are named there. |
| Preview policy | `ModelDescriptor.preview` / `provider.preview()` at import (D14) | No host-side preview renderer. Copy legacy images, ask the driver while the model is decoded, show the placeholder otherwise. |

Exit criteria: a stub renderer can be mounted, loaded by cue, previewed, snapshotted
and disabled — with no format string anywhere in the host. Two windows (actor + chat) are both in
the registry and share one `stateScope`; a cue addressed to one `mountId` is applied only there and
acked once, a `stateScope` target is rejected with `INVALID_ENVELOPE`, closing the actor clears its
descriptor and settles pending sends `aborted`, and TTS produces a speech frame that the actor
consumes. A legacy bag is offered exactly once, an `unused` entry survives a second run, and a
backup restored on a clean profile brings back both the catalog and the driver's state.

---

## 3. Per-renderer migration

Order: **Spine -> MMD -> Live2D -> VRM** (smallest surface first; VRM last because
its camera, transform, meshes, auras and animation storage are all host-entangled).

Each section is: what the renderer must grow, the legacy -> contract map, what the
host deletes, and the renderer-side defects worth fixing while the file is open.
Every Grow list also includes the driver's own settings panel (D7), which replaces
the host panels listed in §4.

### 3.1 Spine

**Grow:** `manifest` (`capabilityDiscovery: 'static'`, optional `caption` in `cues`, `occupiesPoint: true`
from its own canvas alpha (§8.2), no `view`),
`activate`/`deactivate` (replacing
`import.meta.hot?.dispose(() => window.location.reload())` at `Model.vue:1177-1180`
and `Canvas.vue:75-78`), `provider` (`list`, `remove`, `preview`, `probe`,
`modelCapabilities`), and a mount shim over `Spine.vue` adding the required cue
sink and a `capture` cue handler returning `CaptureResult`.

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `currentAnimation` | `settings/spine/current-animation`, `{name,loop,nonce}` | `MotionCue{key,repeat}` |
| `oneShotAnimation` | transient `{name,loop,nonce}` | `MotionCue` in a `persistent:false` envelope |
| `currentSkin` / `currentVariant` | `settings/spine/current-{skin,variant}`, strings | `ProfileCue` — the renderer stores the `"Variant [Skin]"` composite as one profile |
| `activeAnimations` | `settings/spine/active-animations`, never written | drop it (never written) |
| `animationSpeed`, `defaultMixDuration`, `renderScale`, `idleAnimationEnabled`, `maxFps`, `premultipliedAlpha` | host settings + props | renderer storage; `maxFps` is declared and never read (`Model.vue:30,42`), `premultipliedAlpha` has a store/prop second writer (`:70,281`) |
| `xOffset`/`yOffset`/`scale` props | from `settings/positioning/models` | renderer storage (D5) |
| `mouthOpenSize` | consumed as a boolean edge + bone offset x15 (`Model.vue:541-566`) | consumed from the plugin-level `SpeechAnalysisFrame` stream; the mount prop is gone |
| `hitAreaHover` emit | `{name,x,y,hovered}` per pointer move | `hit-area-change` `{areaId,entered}`, edges only |
| head-tethered caption | host `HeadTetheredCanvas2D` + `getHeadPose()` | declaring driver draws it from `CaptionCue`; `HeadPose`/`getHeadPose` deleted; AIRI may keep its own overlay fallback outside the driver contract |
| `captureFrame()` | `Blob \| null` | `capture` cue; returns `CaptureResult` (bytes + mime + size) in the ack |
| `shouldUpdateView()` + `airi-stores-stage-ui-spine` | `{type:'spine-should-update-view'}` / `'spine-play-one-shot'` | cue bus; a re-mount request is a `LoadCue` at the renderer's own `modelId` |
| `availableAnimations`/`Skins`/`Variants` written into host localStorage keys | `settings/spine/available-*` | `services.storage` + `modelCapabilities()` + `CapabilityVocabularySnapshot` |
| hit areas | parsed (`model0.json.hit_areas`) and never surfaced | `hitTest` + a `'pointOfInterest'` descriptor set |
| idle list | card `acting.idleAnimations` with `spine:` prefix | renderer-owned selection; the prefix disappears |

**Legacy bag (D11):** its `settings/spine/*` keys from the appendix, the model's
`settings/positioning/models` entry and any `outfits` on the record. The `available-*` caches are in the
bag too, but the driver discards them and reports them `unused` — they are derived from the package,
not user data. The model file itself takes the D13 path, not the bag.

**Host deletes:** the binary-skeleton candidate tables and byte scan
(`display-models.ts:2149-2221`), the `"Variant [Skin]"` composition
(`:2250-2265`), static imports of `spine-preview`/`spine-version`
(`display-models.ts:13-14,24`), `display-models.ts:665-770`'s Spine repair, and the
`spine:...` key parsing in `RendererStage.vue`.

**Fix while here:** `componentState='mounted'` in a `finally` after a load failure
(`Model.vue:641-645`) with no `@error` wired at the call site
(`RendererStage.vue:511-533`); `hitDetectionMode: 'bounds'` falling through to the radial test
(`:156-167`); the dead `view-control` store and its disagreeing bounds.

### 3.2 MMD

**Grow:** manifest (`capabilityDiscovery: 'runtime'`, optional `caption` in `cues`, `occupiesPoint: true`
via canvas alpha or its render target (§8.2), no `view`),
runtime with `deactivate`, provider (`probe` is real here: `validateMMDZip` exists
at `utils/mmd-validator.ts:28-69` with **no caller** today), mount shim, and the cue
sink.

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `previewExpression` prop + broadcast | host-written transient with hand-rolled timers | `ExpressionCue` in a `persistent:false` envelope, `resetAfterMs` |
| `currentMotion` + `oneShotAction` | `settings/mmd/custom-motions`, store | `MotionCue` |
| `morph-overrides` | `settings/mmd/morph-overrides`, read but never written by UI | renderer storage: the slot→native-name table is the driver's (D8) |
| `emotion-action-map`, `emotionMorphs` | store; `setEmotion` has **no caller** so the whole path is dead | `ActCue` (the projection becomes renderer-side) |
| physics/IK/grant/gravity switches | `settings/mmd/{physics-enabled,ik-enabled,grant-enabled,physics-gravity}` | renderer storage |
| materials | `settings/mmd/{available-materials,material-opacity,albedo-glow}` | renderer storage; `available-materials` has no consumer |
| lights/skybox/env | `settings/mmd/scenes/...`, `envEnabled`, `skyBoxIntensity`; the renderer *writes* `directional-light/{position,target}` (`MMD.vue:872-873`) | renderer storage |
| camera | renderer owns and auto-frames; `camera-position`, `cameraDistance`, `trackingMode`, `followSpeed`, `eyeHeight`, `lookAtTarget` are **inert**; only `cameraFOV` is read | renderer storage; `cameraFOV` stays renderer-owned, so MMD declares no `view` |
| placement | `settings/mmd/{scale,position,modelOffset,modelRotationY,rotationY,modelSize,modelOrigin}`; `scale` has two writers with different defaults; `rotationY` (radians, applied) vs `modelRotationY` (degrees, written by the panel) | renderer storage; one key per concept (D5) |
| `mouthOpenSize` x0.7 -> `vowelA` | prop | the driver's own mapping from the plugin-level speech frames (`RendererStage.vue:534-555` never fed `audioSource` at all) |
| head-tethered caption | none today | declaring driver draws it from `CaptionCue`; no host head-pose path; AIRI may keep its own overlay fallback |
| `scaleChange`/`offsetChange` emits | wheel/drag | D5 decision (renderer storage vs pushback channel) |
| morphs | host parses PMX by regex and **truncates to 30** (`display-models.ts:2268-2285`) | `modelCapabilities()` as `EXPRESSION` units (D8); the 30 cap disappears |
| motions | hardcoded 14 (`stores/mmd.ts:203-218`) + user blobs in localforage `mmd-motion-*` | `modelCapabilities()` + `services.storage` |
| sockets | `MmdSocketResolver` written but **never constructed** | `'pointOfInterest'` descriptors if MMD ever declares `view` |

**Moves into the driver (D8):** `MorphSlot`, `MORPH_CANDIDATES` and `EMOTION_MORPHS`
(`constants/morphs.ts`), plus `createMorphController` and `resolveMorphName`
(`composables/mmd/morph.ts`). Turning one id into several vertex-morph weights is exactly the
mapping AIRI must not hold, so MMD declares its 14 logical slots as `EXPRESSION` descriptors — the
slot names are stable across models, unlike `あ`/`a`/`A` — and keeps the candidate table, the
per-model override and the emotion→weights table to itself. A model-specific morph the user binds
by hand is the driver's own extra descriptor, not a slot.

**Legacy bag (D11):** `settings/mmd/*` (39 keys, appendix), the user motion blobs in
localforage (`mmd-motion-*`), the placement entry and `outfits`. `morphMappings` and
`emotion-action-map` travel in the bag only so the driver can recognise them and answer `unused` — the
slot table they encode is driver code after D8, not user data.

**Host deletes:** the PMX regex parse and 30-morph cap, the hardcoded motion list,
`sync-engine.ts:1417-1418` (raw localStorage) and `:1581-1589` (raw localforage
enumeration), `mmdTextureMap` construction (`stage-model.ts:213-247`) and the
`:texture-map` prop, and the `settings/mmd/*` host store
(`stage-ui/src/stores/settings/mmd.ts`).

**Fix while here:** the `scale`/`rotationY` key mismatches; `morphMappings` (written
by the card, never read by the renderer); `availableMaterials`/`isModelLoaded`
written and never read; `shouldUpdateView()` with no subscriber despite
`airi-card.ts:892`; the MMD stage never receiving `idle-animations` or
`current-audio-source`.

### 3.3 Live2D

**Grow:** manifest (`capabilityDiscovery: 'static'`, optional `caption` in `cues`, `occupiesPoint` from
its own canvas alpha (§8.2), no `view`), runtime with `deactivate`, provider, mount shim, and the
cue sink — none of
which exist (no `handle(envelope)`, no `profileId`, no `modelCapabilities()`
anywhere in the package).

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `modelSrc`/`modelFile` props | blob URL + raw bytes | `LoadCue.modelId` (+ renderer-internal resolution from the `probe` parts / `confirmImport` selections) |
| `activeExpressions` | `settings/live2d/active-expressions`, `Record<fileName,weight>` | `ExpressionCue` / `ActCue` |
| `currentMotion` | `{group,index}` (+ 4 raw `localStorage` keys) | `MotionCue{key}`; the group+index mechanism stays renderer-internal |
| `modelParameters` | `settings/live2d/parameters`, `Record<paramId,number>` | the renderer's own panel; AIRI never drives raw parameters |
| `emotionMappings` | `settings/live2d/emotion-mappings`, 3 live writers | renderer-side projection; AIRI sends tokens |
| `disableFocusAt`, `followSpeed` | `settings/live2d/{disable-focus,follow-speed}` | renderer storage (the cue only overrides the live pointer) |
| idle/cycle list | card `acting.idleAnimations`, `live2d:<group>:<index>` | renderer-owned selection; `ResetCue` motion scope |
| idle gate | `settings/live2d/idle-animation-enabled` → prop `live2dIdleAnimationEnabled` (`RendererStage.vue:472` → `Live2D.vue:273` → `Model.vue:429`) | **driver storage** (RFC 9.11): ambient motion is the driver's, so the host key and the prop go and the toggle moves into its panel; the DSL's own per-group gate stays inside the renderer (RFC 9.12) |
| pointer | window-relative px divided by canvas size; template `@wheel`/`@pointer*` plus 2 canvas listeners and 4 window listeners | `RendererPointerService` events in box-relative px (D2 resolved); `disableFocusAt` becomes renderer storage |
| `mouthOpenSize` 0..100 | prop | derived by the driver from the plugin-level speech frames |
| `hitAreaHover` | per pointer move, `{name,x,y,hovered}` | `hit-area-change` edges only |
| `captureFrame()` | `Blob \| null` | `capture` cue; `CaptureResult` in the ack |
| `live2dApp()` + the host's Pixi bubble | ad-hoc native handle; the host draws inside the canvas | deleted — the renderer draws its own bubble from `CaptionCue`, and `nativeHandle` no longer exists |
| DSL: `dispatchDsl`, `selectDslChoice`, `setVarFloat`, `getDslState` | exposed methods | **deleted** — the script moves to the card and AIRI interprets it (D9, §8.10); the driver keeps only the actions a cue names |
| pose/breath spring + exclusive claim | 6 `BroadcastChannel` messages on `airi-stores-stage-ui-live2d-motion-control` | renderer-internal (RFC 9.11 ruled): the engine becomes a driver plugin driven by the plugin-level speech frames, and the store, channel and lease are deleted (§9.3) |
| captions | renderer posts `caption-assistant`; the host imports the bubble builder | `CaptionCue` + `ResetCue{scope:'caption'}`; presentation is entirely the renderer's |
| `move`/`change_cos`/`replace_tex` | DSL verbs; `change_cos` is a **no-op** today | `ProfileCue` for `change_cos`; `replace_tex` needs texture addressing and is dead (`ports.ts` texture sink never wired) |
| costumes | `GimmickCostume` introspected, never applied | profiles |
| intimacy | `settings/live2d/dsl-intimacy`, `0..100000`, leaks to the host | **character state** (D9): moves into the card's variables, not a renderer key and not a cue |

**Legacy bag (D11):** `settings/live2d/*` (11 keys), `parameters`, `emotion-mappings` (applied to
`selectedModelId` only, D15), the placement entry and `outfits`. **Not** `dsl-intimacy`: it is
character state (D9), so it moves into the card's variables and never into driver storage.

**Host deletes:** the Live2D zip/cp437/OPFS imports in `display-models.ts`
(`:10-11,26-27`), the two expression/motion parsers (`:1949-2019`), the
`ParamAngleX`-style parameter panel (`live2d.vue:338-406`,
`live2d-customization.vue:298,317`), the `airi-stores-stage-ui-live2d*` channels,
the renderer store re-export at `stage-ui/src/stores/live2d.ts:1`, and
`HeadTetheredCaption.vue`'s in-canvas bubble plus the `live2dSceneRef` prop chain feeding it.
**Not deleted:** the dating-sim verb parser (`dating-sim.ts:561-591` →
`RendererStage.vue:377-380`) is the seed of the card-level DSL (D9, §8.10); its `window` CustomEvents
become cues, and the parser is generalized instead of removed.

**Fix while here:** `mounted` set after an error (`Model.vue:1412`); the
`getComputedStyle` theme read and the hidden div (`:1526,2038`); `window.electron`
+ `Notification` (`:1006,118-136`); `window.__LHACK_LAST_ZIP_BUFFER__` (`:96`);
hash route sniffing (`:256-267,665-667,962-963,1482`); `useLive2dTranslator`
calling a translation endpoint and caching labels (`use-live2d-translator.ts:117`).

### 3.4 VRM

**Grow:** manifest (`capabilityDiscovery: 'runtime'`, optional `caption` in `cues`,
`occupiesPoint: true`, `dispose: true`, `view` only once a POI set exists), runtime
with `deactivate`, provider, mount shim, cue sink, and `modelCapabilities()` from
the expression manager + `unmappedExpressions` (`VRMModel.vue:689-691`).

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `modelSrc` blob URL | host-minted per model | `LoadCue.modelId` |
| `triggerEmotion`/`triggerMotion`/`triggerVfx` + `onTrigger*` | store + `airi-stores-live2d` channel | `ActCue` / `MotionCue` / `VfxCue` |
| `activeExpressions` | `Record<name,weight>`, host-written by card sync | `ExpressionCue` |
| `emotionMappings` | `settings/stage-ui-three/emotionMappings`, **write-only** (nothing reads it) | delete; the renderer's own emote states are the projection |
| `hiddenMeshes` + 4 mesh-visibility methods | `string[]`, `(name,visible)`; the `_<prim>` naming leaks the glTF mechanism | `ProfileCue`; toggling parts while authoring is the renderer's own panel |
| `lookAtTarget`, `trackingMode`, `followSpeed`, `eyeHeight` | host keys, partly renderer-written | renderer storage; `GazeCue` overrides the live pointer |
| camera | `camera-position`, `cameraDistance`, `cameraFOV` + `OrbitControls` writing two of them back | renderer storage once `view` is declared (D5 + RFC 9.6) |
| `modelOffset`, `scale`, `modelRotationY`, `modelOrigin`, `modelSize` | three writers (`settings/stage-ui-three/*`, `settings/positioning/models`, `pages/index.vue:767`) | renderer storage (D5) |
| `availableExpressions` | `settings/stage-ui-three/availableExpressions`, **never cleared on model switch** | `modelCapabilities()` + `CapabilityVocabularySnapshot` |
| idle | `vrmIdleAnimation`, `vrmIdleCycleEnabled` (the latter is never read), card `idleAnimations` with `live2d:`/`spine:` keys parsed out at `VRMModel.vue:284-288` | renderer-owned cycle; the foreign prefixes disappear |
| custom VRMA | localforage `custom-vrma-animation-<uuid>` + tombstones + `airi:custom-vrma-sync` | `services.storage` (the two `localforage`/`BroadcastChannel` usages) |
| `playStatus{duration,url}` | emitted, forwarded, no consumer | delete (RFC 5.5) |
| `binaryLoaded` | declared exposed/emitted, **never emitted** | delete |
| head-tethered caption | host `HeadTetheredCanvas2D` + `getHeadPose()` | declaring driver draws it from `CaptionCue`; `HeadPose`/`getHeadPose` deleted; AIRI may keep its own overlay fallback |
| `readRenderTargetRegionAtClientPoint` | exposed, call site stubbed | `occupiesPoint` |
| cloth/aura | `AuraController` + `VrmSocketResolver` (10 hardcoded sockets) | renderer-internal; sockets become POIs if `view` is declared |
| outfits | `AiriOutfit` + `applyOutfit` composition on the host | `ProfileCue` + renderer-side `saveProfile` |

**Legacy bag (D11):** `settings/stage-ui-three/*` (37 keys), the custom-VRMA localforage entries
(`custom-vrma-animation-<uuid>` plus their tombstones, as `Blob` values), the placement entry and
`outfits`. `favoriteExpression` is dead and rides along as `unused` unless the driver wants it.

**Host deletes:** the glTF JSON-chunk expression parse (`display-models.ts:2036-2085`),
static imports of `vrm-preview` (`:11`), `applyOutfit` and `AiriOutfit`
(`airi-card.ts:1407-1469`), the `settings/stage-ui-three/*` host store keys (37),
and the `vrm-instance-cache.ts` module that has zero callers and is not exported
(`components/Model/vrm-instance-cache.ts:41-81`) while `VRMModel.vue:218-266`
implements its own shallow/deep cleanup, and the `vrmViewerRef` exposure the host
reaches into (`RendererStage.vue:436-445`).

**Fix while here:** delete the deep import of `stage-ui/src/stores/audio`
(`composables/vrm/lip-sync.ts:11`) — VRM lip sync now consumes plugin-level speech frames;
`window.vrm`/`window.expressionManager`
(`expression.ts:95-100`); `process.env.NODE_ENV` (`:138`); the second CSS-pixel
conversion in `render-target.ts:60-61`; `useThreeSceneIsTransparentAtPoint`
uncalled.

---

## 4. Phase 6 — shared deletions and the final cutover

By the time this phase starts every driver owns its models and its settings, and each one has already
run the checklist below for its own keys. What is left on the host is the shared machinery, and deleting
it is the point of no return.

### 4.1 The cutover checklist (run per renderer, inside that renderer's phase)

1. **Records.** One `HostNamedModelRecord` per legacy `DisplayModel` of that renderer: `modelId` = the
   legacy `id` (D12), `modelDriverHint` = that driver, annotations copied, `searchKey` rebuilt. Mint the
   model's default `profileId` here, before any load can need it.
2. **Preview.** `previewImage` -> `HostAnnotationFields.preview` with a fresh `updatedAt` (D14).
3. **Settings.** Offer the driver's bag once (`migrate`), keep whatever it reports `unused`, write
   `driver-migration/{driverId}`.
4. **Bytes.** Per model: `probe` -> `parts`, then `confirmImport({ selections, overwrite: true, migration })` under the preserved `modelId`; delete the legacy
   blob only on `ok`; write `model-migration/{modelId}`. On failure leave both sides untouched and retry
   on the next launch (D13).
5. **Placement.** Delete the model's `settings/positioning/models` entry only after step 3 or 4 confirmed
   the driver absorbed it.
6. **Legacy keys.** Delete that renderer's settings keys and its `DisplayModel` rows, and only then the
   host code that read them.

Every step is per item and idempotent, so a crash resumes cleanly: nothing is deleted before its marker
exists, and re-running steps 1-4 is a no-op. The order matters in one place — step 2 must precede step
6, or the thumbnail is gone with the record it was copied from.

### 4.2 Shared deletions

First, the host's reaches into renderer viewports: `HeadTetheredCaption.vue` (imports a Live2D
composable and hands it the Pixi app), `HeadTetheredCanvas2D.vue`'s in-canvas drawing, and the
`live2dSceneRef`/`vrmViewerRef`/`spineViewerRef`/`mmdViewerRef` exposures on `RendererStage.vue`
together with the per-format capture/`readRenderTargetRegionAtClientPoint` ladders that go with
them — capture is now a `capture` cue whose bytes return through the ack, and occlusion comes from
`occupiesPoint` only.

Beyond each renderer's list: the `DisplayModelFormat` enum and every switch on it
(`stage-model.ts:139-156,200-209,262-280`), the capability fields on `DisplayModel`
(`display-models.ts:52-55`), `cueAllowlist`/`compiledWhitelist` on the card
(`airi-card.ts:95,99`), the field-wise capability merge in `sync-engine.ts:17-42`
and its call sites, the `<id>-textures` companion convention, and the remaining
`readRenderTargetRegionAtClientPoint` stubs and the old `airi:stage-capture` broadcast in
`ControlStripHost.vue:1963-1973`; capture is the `capture` cue now. Because D7 makes the whole per-model settings surface a
driver panel, the customizer and its panels go with them: `ModelCustomizer.vue`,
`WardrobeMeshTreeNode.vue`, `model-settings/{vrm,vrm-expressions,live2d,live2d-customization,mmd,spine}.vue`
and `ModelSceneSettings.vue`, together with their `usePositioningStore` reads.
`model-settings/index.vue` keeps the route and the preview frame the driver panel mounts into.

## 5. Phase 7 — first-party packaging and transfer

Per renderer: static manifest `requirements` (Live2D's `Live2DCubismCore` global and the
Spine licence become declared requirements instead of an `index.html` accident and
a settings toggle), `driverTransfer` bundles so a device restore brings back
renderer settings and not only AIRI's records, and the probe path so "drop a file
and AIRI figures out what it is" keeps working after per-format detection leaves
`display-models.ts`.

**This phase is first-party only.** The SDK stays `private` + source-only and drivers are consumed
through workspace static imports. Remove `private`, add `dist`/`.d.ts`, `files`, and
`peerDependencies.vue` only when the contract and renderer host are stable enough to publish a
third-party loader; that is not this release's exit criterion. The static manifest is still read
before the runtime in this phase, and main never holds a runtime or a probed capability result.

## 6. Verification per phase

- **Phase 1:** a stub renderer through the broker — load, cue round-trip, ack `results`, preview, snapshot
  write/read, disable. Plus the three things that only fail in the field: the legacy bag is offered
  **once** (call `migrate` twice with the same bag and expect the same result), an `unused` entry is
  still in storage afterwards, and a backup restored on a clean profile brings back the catalog, the
  driver's state and its bundles.
- **Each renderer phase:** `pnpm -F @proj-airi/stage-ui-<format> typecheck` plus
  `pnpm -F @proj-airi/stage-ui typecheck`, then the runtime smoke list — load by cue, ACT emotion,
  motion + `animation-finished`, preview, capture, hit test (where declared), `CaptionCue`
  rendering where declared, pause/visibility, dispose strategy, one cross-window cue — and then the cutover checks:
  - every legacy model of that renderer is present under its old id, with its annotations and preview;
  - its placement and settings survived: the same model loads where the user left it, with the same
    alias table bound;
  - the renderer's legacy keys and `DisplayModel` rows are gone, and a second launch re-imports nothing;
  - a crash simulated between `confirmImport` and the blob delete (kill before the marker) leaves the
    model intact on the next launch and does not duplicate the import.
- **Phase 6:** `grep -r "airi-stores-" packages apps` returns nothing, no host file reads a renderer
  store, `grep -r "DisplayModelFormat" packages apps` returns nothing, no host file reads a
  `settings/(live2d|mmd|spine|stage-ui-three|positioning)/*` key, and `grep -r "getHeadPose\\|HeadPose"`
  returns nothing outside the migration record.

## 7. Risk register

| Risk | Mitigation |
| :--- | :--- |
| A migrated renderer keeps its own listener out of habit | D1 is decided, so this becomes a per-renderer checklist item: the pointer path moves to `services.pointer`, the canvas/window listeners are deleted with it, and the renderer's own coordinate conversion shrinks to "box-relative px into my own space". |
| Live observation (D3) is a push channel, so the prompt loses its expressions line until a driver publishes | Land `services.prompt` in phase 1 with the first migrated driver: the context slot (`system:expressions`) stays, the store import goes, and a scope with no publication contributes no line. |
| Transform ownership (D5) has three copies and a fourth writer (Stage-Mate) | Decided: the renderer owns placement and the host keeps `interactionMode` and `ResetCue{scope:'transform'}`. The one-time import of `settings/positioning/models` runs in the cutover (§4.1) before the key is deleted, or layouts reset. Stage-Mate is outside the contract (D16) and keeps its own copy in the sidecar's window config, imported in the same step — the stage and Unity are placed independently from now on. |
| Re-importing every model doubles that model's storage while it runs (D13) | One model at a time, gated on `navigator.storage.estimate()`; on a shortfall the model is skipped with a warning and stays legacy-shaped rather than half-migrated, and the blob is deleted only after `confirmImport` returns `ok`. |
| A device restore brings back the catalog against an empty driver | Phase 1, not phase 7: the backup enumeration has to include the new stores *and* `driverTransfer` bundles, and the round-trip is a phase-1 exit criterion. |
| The per-model ACT alias table is lost (D15) | Unavoidable for the one global legacy key, which has no model attribution: hand it to the Live2D driver once, apply it to `selectedModelId`, and say so in the toast. Everything bound after the migration lives in driver storage per `modelId`. |
| A driver answers `migration: false`, or a third-party driver has no migration | The host keeps the bag's keys for one release and shows one toast naming what could not be imported; deleting them immediately would turn a missing member into silent data loss. |
| Mobile (stage-pocket) runs the same cutover on a smaller quota and without OPFS everywhere | Run the checklist on pocket before deleting the legacy keys, and treat a skipped model there the same as any other skip — visible, retryable, never silent. |
| Live2D's scripting VM has no contract home | It has none by design: the script is character content, so it moves to the card and AIRI interprets it (D9, §8.10). The driver keeps only the actions a cue names, and the exposed-method surface is deleted. |
| Deleting host capability parsing removes the "works with no renderer loaded" path | `CapabilityVocabularySnapshot` is written by the renderer and read by the host with nothing mounted — that is the replacement, and it must be populated during the same phase. |

---

## 8. Open issues, consolidated

The per-renderer "Grow" lists stay in §3; this section is the cross-cutting cut — what a
driver has to grow, and what only becomes visible when the four existing renderers are read
side by side. Contract gaps also live in the RFC's section 9; where one has an RFC number it
is cited rather than restated.

### 8.1 One active model per window, not per mount

The contract allows one driver to be mounted several times at once (actor plus a chat-side stage in
one shared scope, a settings preview, two previews on one surface). Two of the four renderers hold
exactly one active model in a store-level singleton, and one of them also publishes it globally:

| Renderer | Singleton |
| :--- | :--- |
| VRM | `stage-ui-three/src/stores/model-store.ts:100-102` (`activeVrm`, `activeVrmParser`, `activeVrmIdentity`) and `window.vrm` / `window.expressionManager` (`stage-ui-three/src/composables/vrm/expression.ts:97-98`) |
| Live2D | `stage-ui-live2d/src/stores/live2d.ts:69` (`model = shallowRef<Live2DModel>()`) |

Spine and MMD were not audited for this and should assume the same shape until they are.

**Consequence:** a second mount overwrites the first, so "a chat-side stage and the actor both
show the shared scope" cannot be implemented for them as they stand. This is not a contract defect —
a mount
factory may return a component whose state is per-instance — but it is the largest piece of
driver-side work here, and it has to land in the same step as §8.5, because the per-scope
state work assumes per-instance ownership.

### 8.2 `occupiesPoint`: the reader exists, the wiring does not

The member is synchronous, and the first read of it said only VRM could answer: it reads a render target
synchronously (`stage-ui-three/src/composables/render-target.ts:51,94`, wired at `ThreeScene.vue:130`)
while Pixi was assumed unable to read pixels synchronously.

That is wrong, and this tree already contains the counter-example:
`composables/canvas-alpha.ts:19` (`isCanvasRegionTransparent`, a `gl.readPixels` over a circle's bounding
box that re-checks the circle on the CPU) and `:161` (`useCanvasPixelIsTransparentAtPoint`). Live2D and
Spine draw through Pixi, whose canvas is a WebGL context, so the same call answers for them; MMD draws
through Three like VRM and can use either path. What is missing is not the capability but the wiring:
the helper has **no consumer** today, `ControlStripHost.vue:1963-1973` stubs the read to `null`, and
`RendererStage.vue:166-170` answers `null` for every format except VRM — which is why click-through is
VRM-only in practice (`stage-three-transparency.ts:14`).

**Decided: keep the member synchronous and let every renderer answer, Live2D included.** Two caveats
belong to the renderer, not to the contract: a drawing-buffer read is only reliable for the frame that
drew it (Pixi and Three both default `preserveDrawingBuffer: false`), so a renderer renders on demand,
sets the flag, or caches the last answered point; and choosing the threshold and the sample radius is
exactly the "sensitivity is the renderer's own policy" line in `renderer-mount.ts`. The migration item is
therefore to move `canvas-alpha.ts`'s read into the drivers and delete the host copy with the other
reach-throughs (§4.2) — not to declare a capability false.

### 8.3 `hit-area-change` is edge-triggered, and nobody computes it that way

Every renderer that reports hit areas emits `{name,x,y,hovered}` from inside its pointer
handler and `null` on leave: Live2D (`stage-ui-live2d/src/components/scenes/live2d/Model.vue:1820-1829`),
Spine (`stage-ui-spine/src/components/scenes/spine/Model.vue:196-204`); the host re-emits it
as `hitAreaHover` (`Live2D.vue:58`, `Spine.vue:43`). MMD emits nothing at all.

The contract wants edges only, no point, and — the part nobody does today — an emit when the
*renderer* moves the model under a still pointer. **Per-renderer work:** hoist the hit test
into the frame loop, key it by `areaId`, and emit transitions only.

### 8.4 `animation-finished` needs a nonce registry that does not exist

The emit echoes the transaction `nonce`; today's one-shot completion callbacks are keyed by
name or index (Live2D's motion key is `group#index`). Each driver has to keep
`nonce → in-flight motion` for the lifetime of the motion, and decide what "finished" means
for `repeat: -1`. **Per-renderer work, no contract change.**

### 8.5 Window-global settings vs. per-scope state

The snapshot is per `stateScope`; today's renderer settings are window-global
(`settings/live2d/parameters`, `settings/stage-ui-three/hiddenMeshes`, … — the 99 keys in the
appendix). Actor and chat now share one scope, so their mounts must publish into the same record
and read the same values; a preview is the only mount with a private scope. With two independent
mounts in one window, each would overwrite the other's "current" value, which is exactly why the
shared scope is explicit. The appendix already splits plain window settings from per-model values;
that split has to land with §8.1, not after it.

### 8.6 Lip-sync input: a plugin-level analyzer, not a renderer contract member

`RendererMountMouthInput` is gone, and so is `HostAudioInterface`: neither an openness scalar nor an
audio node is a prop or a service of the renderer contract. A plugin registers an analyzer against
the host's audio source (`HostSpeechAnalyzerService`); the host publishes low-rate
`SpeechAnalysisFrame`s (`at`, `rms`, optional `mouthOpen`/`viseme`), and the plugin's own renderer
subscribes to that stream and decides its mouth mapping — five vowels or one scalar is its own
business. The analyzer runs in the window that owns the `AudioContext` (today the main window's
`ControlStripHost`), never in the Electron main process; an `AudioNode` cannot cross a realm.

Two consequences for migration: the host stops computing a per-renderer envelope, and **who decides
the mouth shape is the plugin** — not a contract field. Phase 1 may publish a frame from the existing
`ControlStripHost` analyser before the plugin loader exists; the frame shape does not change when the
analyzer moves behind a plugin. The old fan-out (`mouthOpenSize` to all four renderers and to
Stage-Mate at `:1655-1668`) is deleted; Stage-Mate consumes the same frame stream (D16), never a
renderer's analyser.

### 8.7 Capture is a cue, and its result is typed

Live VRM capture re-renders and calls `domElement.toBlob` (`ThreeScene.vue:431-441`), but the
contract path is now a `capture` cue: the driver encodes its own canvas and returns a
`CaptureResult` (`mime`, `ArrayBuffer`, `width`, `height`) in `CueAck.results`. The cue payload is
empty — the caller does not name a background, format, quality or width — and capture must be the
only cue in its envelope. The broker applies `timeoutMs`; an encode failure is `capture-failed` on
the result envelope, not an empty success. Capture while
`paused`/`visible: false` still has to be answered by the driver: it either renders on demand or
returns a rejected outcome, and it says which.

### 8.8 Contract questions that will surface during driver work

| Question | RFC | What it costs a driver |
| :--- | :--- | :--- |
| No `AbortSignal` anywhere in the contract | — | `probe`, `load` and `capture` can only be abandoned by unmounting the mount, or by the broker's `timeoutMs` |

This row is a gap this fork found while cleaning up the contract; it has no RFC section
yet. Every other question that used to sit here is settled: transform ownership by D5 (the renderer
keeps placement and the host keeps `ResetCue{scope:'transform'}`), observation of active state by D3
(the driver publishes `activeKeys`, AIRI words the line), the choice round-trip by the ruling that a
menu is conversation content and therefore not a renderer concern (RFC 9.5, §8.10), the script's verb
set and the intimacy scalar by D9 (the card owns the script; intimacy is character state), the
capability gate by RFC 9.12 (the driver gates its own pools), the beat by leaving it out of the
contract altogether (D10: a driver receives plugin-level speech frames and nothing else), the `expression`/`morph` one by D8, and the pose/breath lease by RFC 9.11
(driver-internal, §9.3).

The rule behind the list: a question stays open only when an implementation in this tree already
needs the answer. Anything nobody has built is a future proposal, not a migration blocker — which
is why RFC 9.10 (performance timeline) is closed rather than carried here.

### 8.9 Deferred: card-level outfit and expression storage

`AiriOutfitSchema` (`stage-ui/src/types/card.schema.ts:195-204`) still persists
`meshes: string[]` and `expressions: Record<string, number>` — renderer-native keys inside
AIRI's own data. With appearance now a `ProfileCue` (D6), the card should keep `profileId`s
and the renderer should own the composition.

The same shape problem sits in `AiriActiveStateSchema.active_expressions`
(`card.schema.ts:377`): a `Record<rendererKey, weight>` that a Concept or an actor
manifestation writes (`artistry-autonomous.ts:231-234,716`) and the stage applies
(`airi-card.ts:830`). D8 says the driver resolves a token onto its own units, so a card that
pins weights by key is the same leak one layer down — a manifestation should name a
`profileId`, not carry the weights.

**Deliberately deferred.** Neither is a driver-migration blocker, but both have to land before
any driver renames or re-splits its units, because the card currently stores those names.

### 8.10 Decided: the DSL moves to the card (D9)

The script is character content, so it stops being split between a model bundle and a host runner.
Two implementations exist today, and they are the same language written twice:

- **In the model bundle.** A Live2D manifest carries DSL fields on motion entries — `VarFloats`,
  `Choices`, `Command`, `PostCommand`, `NextMtn`, `Intimacy`, `TimeLimit` — captured before the zip
  loader sanitizes them away (`stage-ui-live2d/src/runtime/dsl-capture.ts:52-79`) and interpreted by
  `packages/live2d-runtime`. The model author, not the character author, decides what the character
  does.
- **In the host.** `stores/dating-sim.ts:561-591` already parses `start_mtn`, `clear_exp`,
  `motions enable|disable` and `change_cos`, dispatches `window` CustomEvents, and
  `RendererStage.vue:359-373` turns them into Live2D store writes. That parser is the shape the card
  DSL should take — it is kept and generalized, not deleted, and its CustomEvents become cues.

**Where each part goes under D9:**

| Script part | Owner | Lands as |
| :--- | :--- | :--- |
| motion / expression / outfit commands | model capability | `MotionCue`, `ActCue`, `ProfileCue`; the driver composes lane, item and alias selection itself (D8) |
| variables, intimacy, time limits | character state | the card's variable space — not a renderer key, not a cue, and `dsl-intimacy-changed` stops existing |
| choices / suspension | character state | the conversation layer's overlay; the `dsl:` bridge and `showChoices` both go (RFC 9.5) |
| texture swap, group gating, sound | renderer / host | `replace_tex` is raw addressing AIRI must not drive (a different texture is a profile); sound is playback, which is the host's; the per-group gate is the driver's own bookkeeping (RFC 9.12), not a member |

**Not a driver-migration blocker**, but the card schema needs a home for the script before any of
this runs, and card-level storage is already a deferred item (§8.9). The migration order is therefore:
schema field → generalized interpreter → the four drivers expose actions → the model-bundled DSL
fields are ignored at load (not deleted from existing files, which are read-only to us).

**Left dangling if this is not done:** the model-bundled DSL keeps executing for Live2D while the card
DSL runs for everything else, so the same character can be scripted twice with two different owners.

### 8.11 Stage-Mate stays outside the contract (D16)

The Unity sidecar is a second window rendering the same character, but it is not a mount and cannot be
one yet: it has no in-process component, no `AudioNode`, and its protocol (`stage:model:position`,
`stage:vrm:lip-sync`, `positioning` inside `stage:state:sync`) is already a driver-shaped message set
spoken to the main process. Making it a driver would also mean two drivers serving the same VRM file —
two `modelId`s for one asset — and a card could point at only one of them.

So for this migration it keeps its host bridge, and three things change hands:

- **Its own placement.** The host stops being the shared copy, so Unity's position and scale move into
  the sidecar's persisted window config, imported once from `settings/positioning/models`. Moving the
  model on the stage no longer moves it in Unity, and vice versa — an accepted divergence, because the
  alternative is the shared store D5 deletes.
- **Its own lip-sync source.** `stage:vrm:lip-sync` loses its producer when the host stops computing
  openness from the Live2D analyser. The host owns the main-window audio graph and the
  `SpeechAnalysisFrame` stream now, so it computes that one envelope from its own analyzer and sends
  it to the sidecar — a host-to-its-own-sidecar channel, not a renderer measurement.
- **A cue-shaped inbound path.** `stage:state:sync` keeps carrying state, and the card's ACT/motion
  intents reach Unity as the same cues the driver receives, forwarded by the host. Otherwise the avatar
  on the stage emotes and the one in Unity does not.

The follow-up that would remove the divergence, if it ever matters: make the Unity window a **second
mount of the VRM driver** — a mount is not a model, both mounts share one `stateScope`, and the driver
owns the window through `services.bridge`. That is a VRM-driver feature, not a contract change.

### 8.12 The one-time code must expire

D11's key table, D12's format -> driver table and §4.1's checklist all encode knowledge of renderer
internals on the host — exactly what the contract forbids. They are allowed only because they are
deletable: each driver's cutover writes a marker, and that driver's table entry and checklist step are
removed in the release after its models are migrated. If the migration table outlives the migration, the
host ends up owning renderer storage knowledge again, this time with no contract keeping it honest.

Two things must *not* decay with it: `HostNamedModelRecord`/`HostModelProfileRecord` (the host's own
data) and the `driver-migration/*` markers, which are the only record that a device has been migrated.

---

## 9. Consumer inventory (RFC 9.3 and 9.6)

Two inventories, because "who reads this today" decides what D3 and D5 have to replace. Rows
marked **driver** leave the host with D7; rows marked **host** are what the replacement must
cover.

### 9.1 RFC 9.3 — who reads "what is active right now"

| Consumer | Where | Reads / writes | Disposition |
| :--- | :--- | :--- | :--- |
| Control strip, expression and wardrobe pickers | `ControlStrip.vue:945`, `:1021-1035`, `:1142-1144` | `modelStore.activeExpressions`, `live2dStore.activeExpressions`; `isOutfitActive` compares the card's `outfit.expressions` against live weights (±0.05); clicking writes a toggled weight back | **driver** (D7): the picker becomes a driver panel and reads its own state |
| Control strip, motion picker | `ControlStrip.vue:987-1019` | `mmdStore.currentMotion`, `spineStore.currentAnimation.name`, `live2dStore.currentMotion.{group,index}`, `vrmIdleAnimation` | **driver** (D7), same |
| `ModelCustomizer` row highlighting | `ModelCustomizer.vue:358-374`, `:398-442` | the same four stores | **driver** (D7) |
| Per-format settings panels | `vrm-expressions.vue:25,38`; `live2d-customization.vue:21,45,108-154` | read and write `activeExpressions`; the Live2D panel snapshots the whole record | **driver** (D7) |
| AI prompt injection | `context-providers/expressions.ts:14-51` → `chat.ts:600-604` | every key with weight > 0.1 from both stores | **host**, rebuilt as a service: the store reads are deleted and the driver publishes `{ stateScope, activeKeys }` through `ModelDriverHostServices.prompt` (`chat.ts` keeps the context slot) |
| Card / concept application | `airi-card.ts:831-835`, `:1432-1467`; `artistry-autonomous.ts:249`; `RendererStage.vue:364` | writes both stores; clears one on teardown | **driver**, through `ExpressionCue` / `ProfileCue` |
| Card-export cover snapshot | `use-card-export.ts:472-491` | `modelStore.activeExpressions`, for both formats | **bug today**: the Live2D branch imports `useModelStore` from `stage-ui-three` and hands the VRM record to `loadLive2DModelPreview`, so a Live2D cover never reflects live expressions |
| Tests | `context-providers.test.ts:66-88`; `prompt-hierarchy-invariants.test.ts:131-175` | mock all four stores as fixtures | rewrite with the consumers |

**How the prompt row is rebuilt.** AIRI owns the service and the sentence; the driver supplies only
facts. `createExpressionsContext` stops importing `stage-ui-three` and `stage-ui-live2d` — it reads
what the shared scope last published, maps `activeKeys` to `CapabilityVocabularyItem.label`, and
emits the same replace-self context. That is also what fixes the two holes the store read had: it
described only whichever renderer was mounted in that window, and nothing at all when the stage
window was closed. Appearance does not travel through this channel at all — a profile id names it,
and the id comes from the snapshot (D6, §1 prerequisite).

So 9.3 is not a read path at all: the renderer pushes what it has active, and the host never asks.
That leaves the question of who *displays* it settled the other way round — every picker that showed
it becomes driver UI (D7), so the host keeps no active-state surface to feed.

### 9.2 RFC 9.6 — who reads "where the model ended up"

Six copies, and a props chain that suppresses all of them:

**All six die (D5).** The table stays as the record of what had to be reconciled. What survives on the
host is three things and nothing else: `interactionMode` (already a prop), `ResetCue` with the new
`scope: 'transform'`, and the Stage-Mate bridge, which keeps its own copy (D16).

| Copy | Keys | Read by | Written by |
| :--- | :--- | :--- | :--- |
| **Host** | `settings/positioning/models` | app shells (`tamagotchi/index.vue:186-216`, `actor.vue:111`, `chat.vue:155-185`, `stage-web/index.vue:48`, `stage-pocket/index.vue`), `ViewControls/Inputs.vue:21-191`, and the per-format panels (leaving with D7) | the same app-shell handlers, `ViewControls`, the panels, `index.vue:761`'s reset, and **Stage-Mate** (`stage-model.ts:375-397` ← `stage-mate:model-position-changed`) |
| Live2D | `settings/live2d/{position,scale}` | `Live2D.vue:67` (`positionInPercentageString`, `storeScale`), used only when props are absent (`:89`, `:149`) | drag/pinch emits upward; the renderer does not write it back |
| VRM | `settings/stage-ui-three/{modelOffset,modelRotationY}` and `{scale,camera-position,cameraDistance}` | `ThreeScene.vue:115-121` (fallback), `:588-591`, `:648` | `OrbitControls` → `ThreeScene.vue:154-185`, camera only |
| MMD | `settings/mmd/{position,rotationY}` (via `view-control.ts` → store) and `settings/mmd/scale` | `MMD.vue:216-226`; `rotationY` has **no prop**, so the store always wins | store setters; `scale` has two declarations with different defaults (`view-control.ts:14` = 0.1, `stores/mmd.ts:221` = 1) |
| Spine | `settings/spine/{position,scale}` | nothing — `Spine.vue:109` uses props only | only `spine.ts:156-159`'s reset → dead copy |
| Rehearsal inline stage | component `ref`s | `chat_rehearsal.vue:78-88` | itself; resets on every mount, never persisted |

**Why the round-trip exists.** The host pushes its copy down every frame (`RendererStage.vue:465-467,
500-502,520-522,544-546` through `ControlStripHost.vue:58-60,2008-2009`), and every renderer prefers
the prop over its own store (`MMD.vue:216-218`, `ThreeScene.vue:117-119`, `Live2D.vue:89-90`). A drag
that emits and stores is the only way the value survives the next frame; if the emit is dropped, the
model snaps back. That is why "which copy dies" is not cosmetic.

**Stage-Mate is a fourth writer, and the docs never had it.** Unity moves the model, the main process
forwards `stage-mate:model-position-changed`, and `stage-model.ts:375-397` writes the host copy; the
reverse direction exports the host copy to Stage-Mate on model sync (`:330-352`). D5 does not hand this
bridge to the driver either: Stage-Mate keeps its own copy in the sidecar's persisted window config,
imported once from the host table (D16). The bridge stays where it is and the value it carries changes
owner — Unity stops dragging the stage's model and starts keeping its own. Leaving the bridge pointed at
`settings/positioning/models` would keep writing a key nothing reads.

**Already dead or duplicated:** the Spine pair (row 5), `mmdStore.modelOffset`/`modelRotationY`
(declared, no consumer), `settings/mmd/scale`'s two defaults, and the 20-line
`handleScaleChange`/`handleOffsetChange` pair copy-pasted into four app files.

**What is still an AIRI-side consumer — three, and none is a copy.** Checked by grepping every
`getPosition`/`setPosition` call site outside the four renderer packages:

| Consumer | Where | Why it survives |
| :--- | :--- | :--- |
| Interaction-mode switches (`tactile` / `orbit` / `drag` / `positioning`) | `composables/use-control-strip-action.ts:51,89-93`, `stores/settings/control-strip.ts:68-81`, `ViewControls/Inputs.vue`'s mode row | a live host decision about one mount, and already a contract prop (`RendererMountProps.interactionMode`) |
| Reset | `apps/stage-tamagotchi/src/renderer/pages/index.vue:761` (`setPosition(key, { x: 0, y: 0, scale: 1 })`) | a user action about a value the host does not own — `ResetCue{ scope: 'transform' }`, added for exactly this |
| Stage-Mate | `stage-mate/index.ts:177` (`positioning` in `stage:state:sync`), `:556` (`stage:model:position` out), `:219-225` (back in) → `stage-model.ts:391` | an external process that both reads and writes placement; it keeps its own copy in the sidecar's config (D16), imported once from the host table |

Plus one **data** consumer, not a live one: `settings/positioning/models` in `localStorage` holds
whatever every user already dragged into place, so the driver needs a one-time import — otherwise the
first launch after migration silently resets every layout to default.

Two things checked and genuinely clean, so the ruling costs nothing else: the card schema has **no**
position or scale field (`card.schema.ts` carries only `downscalePercent`), so no card migration; and
no layout or CSS reads `getPosition`, so nothing outside the list above depends on the host knowing
where the model is.

### 9.3 RFC 9.11 — the pose/breath transport is driver-internal

**Ruled (RFC 9.11):** a pose is renderer output, not input, so the contract defines no pose member
and no lease. The inventory below is kept as the **deletion list**: every producer row leaves the
host with the engine, and the consumer row becomes a plugin registration inside the driver.

All six messages live in one store, `stage-ui-live2d/src/stores/motion-control.ts:56-84`, on the
channel `airi-stores-stage-ui-live2d-motion-control` (`:237-239`).

| Role | Where | What |
| :--- | :--- | :--- |
| Producer | stage ambient motion: `RendererStage.vue:113` → `use-live2d-stage-ambient-motion.ts:97,115` | `set` at the driver's sample rate (~30 Hz, 13 axes) and one `breath set` on start |
| Producer | model-settings panel: `live2d.vue:117` instantiates the **same composable with the same `ownerId`** | the same two messages, from the settings window |
| Producer | devtools playground: `devtools/live2d.vue:167-193`, owner `devtools-live2d-ambient-motion` | `set`, `breath set`, and releases on toggle/unmount |
| Producer | **none for the lease** | `claimExclusiveControl` / `releaseExclusiveControl` have no caller anywhere in the tree |
| Consumer | Live2D model: `Model.vue:178-193`, `:883-884` | reads `control`/`breathControl`/`exclusiveOwnerId`, registers the two `post` plugins, and feeds the spring into the Pixi offset |

What the ruling means in code:

- **The engine moves behind the mount.** `useLive2DStageAmbientMotion` and both magic packages keep
  working as they are — they import no Vue, no Pinia and no channel — but the `target.apply`
  adapter stops being a broadcast post and becomes a plugin on the renderer's own update loop. The
  shape is already written down in `docs/design-live2d-autoregressive-motion.md` §3.1.
- **Delete with it:** the store, the channel name, the six messages, and the settings panel's
  second generator instance (`live2d.vue:117`, same `ownerId` as the stage).
- **The devtools workbench moves into the driver; it is not dropped.** Fitting, seed, profile and
  method controls become a debug/tuning surface the driver owns — a tab in its panel (D7) or a
  driver-owned dev route — driving the live instance in-process. With one producer inside one
  renderer there is nothing to arbitrate, so the direct drive needs no lease and no channel.
- **What stays host-side:** the audio graph and the analyzer tap, because handing over a signal is the
  host's job; openness, on/off, profile and intensity are the plugin's. The renderer never sees an
  `AudioNode`, only `SpeechAnalysisFrame`s.
- **The transport was fragile anyway:** `ownerId` is a constant, not an identity
  (`use-live2d-stage-ambient-motion.ts:62`), and release only clears a matching owner
  (`motion-control.ts:266-276`), so the settings window's instance releasing on unmount also
  releases the stage window's stream until its next frame re-posts.
- **A `pose` member would not have covered it:** the pose axes already carry model offset and a mouth
  driven from the plugin-level speech frames — what the contract models as a transform (D5) and as a
  separate analyzer stream.

---

## Appendix — settings key inventory by decision

Counts from a literal-key grep over the four renderer packages plus the desktop
renderer: 11 Live2D, 39 MMD, 12 Spine, 37 VRM = **99**.

| Decision | Keys |
| :--- | :--- |
| Renderer storage, plain settings | all `settings/live2d/magic/*`, blink/shadow/fps flags, `settings/mmd/{physics,ik,grant,gravity,albedo-glow,envEnabled,skyBoxIntensity,render-scale}`, `settings/spine/{default-mix,idle-enabled,max-fps,render-scale,animation-speed,hit-detection-mode,radial-hit-radius}`, `settings/stage-ui-three/{renderScale,maxFps,multisampling,envEnabled,skyBox*,nprIrrSH,interaction-mode}` |
| Renderer storage, per-model values (move into the snapshot `values`) | `settings/mmd/{morph-overrides,material-opacity}`, `settings/stage-ui-three/{activeExpressions,hiddenMeshes,modelOffset,modelRotationY,scale}`, `settings/spine/{position,scale}`, `settings/live2d/{parameters,position,scale}` |
| Renderer storage, camera (after D5) | `settings/stage-ui-three/{camera-position,cameraDistance,cameraFOV,lookAtTarget,eyeHeight,followSpeed,trackingMode}`, `settings/mmd/{cameraFOV}`, and the inert MMD camera keys which should be deleted rather than moved |
| Renderer storage, capability caches (replaced by `modelCapabilities()` + vocabulary) | `settings/live2d/{available-expressions,available-motions,motion-map}`, `settings/spine/{available-animations,available-skins,available-variants}`, `settings/mmd/{available-materials}`, `settings/stage-ui-three/{availableExpressions}` |
| Delete (dead or duplicated) | the second writer of `settings/mmd/scale`, one of the `rotationY` / `modelRotationY` pair, the host copy of `settings/mmd/render-scale`, `settings/mmd/{modelOffset,modelRotationY}` (written by the panel, unread), `settings/spine/{position,scale}` (unread), `settings/live2d/{current-motion,active-expressions,model-param-replay-disabled}` once the snapshot replaces them, `settings/stage-ui-three/favoriteExpression`, `settings/vrma/deleted-animations` (moves with the custom-animation store) |
| AIRI keeps | `settings/stage/model` (the reference), and `settings/stage/renderer` becomes a driver id (D17); `settings/positioning/models` only until §4.1 step 5 runs; card `acting.idleAnimations` only if idle selection stays host-owned (it should not) |
