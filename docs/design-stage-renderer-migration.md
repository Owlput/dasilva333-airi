# Stage renderer migration outline

Companion to [`rfcs/0001-stage-renderer-plugin-contract.md`](./rfcs/0001-stage-renderer-plugin-contract.md).
The RFC is the upstream-facing design; this file is the fork-facing work plan for
moving the four existing renderers behind it.

**Status: proposal.** Nothing here is implemented, and nothing in this file is
authorization to change code — it is the order of operations, the per-renderer
mapping, and the decisions that have to be made first.

Evidence: every mapping below was produced by reading the four renderer packages
and the host wiring. Line references are to the tree as it stands today; the
per-renderer inventories they come from are cited inline.

---

## 1. Decisions required before any code moves

The RFC's section 9 lists what the contract cannot express yet. Six of those are
**blocking**, because a renderer cannot be migrated behind the contract without
them, and two of them invalidate prose that migration would otherwise entrench:

| # | Decision | Why it blocks |
| :--- | :--- | :--- |
| D1 | Gesture / pointer-edge input (RFC 9.1) | **Decided:** `RendererPointerService` delivers `down`/`move`/`up`/`cancel`/`enter`/`leave`/`wheel` with `pointerId`/`button`/`buttons`/`modifiers` to one named mount, subscribed by `mountId`. Every renderer's own drag/pinch/wheel listener is deleted as it migrates. |
| D2 | The pointer-space correction (RFC 9.2) | **Decided:** `RendererMountPoint` is box-relative CSS px, converted once host-side; the renderer maps onward itself. The contract note that claimed the producers already did this is corrected, and all three wrong conventions (Live2D window px ÷ canvas size, VRM `window.innerWidth/Height`, Spine backing-store px) are migration inputs. |
| D3 | Live observation (RFC 9.3) | `ControlStrip.vue:945-1144` and `ModelCustomizer.vue:361,430,441` render "is this active" from renderer stores. If nothing replaces that read path, the host keeps reaching into renderer stores after migration, and the migration buys nothing. |
| D4 | Text/caption channel (RFC 9.4) | **Decided:** `CaptionCue` carries the utterance, its sentence split and timing, `utteranceId` and `elapsedMs`; the renderer owns all presentation. `nativeHandle` is deleted and the host stops drawing inside any renderer's canvas — which also deletes host-side overlay controls and every `sceneRef`/`viewerRef` reach-through. |
| D5 | Which transform copy dies (RFC 9.6) | `settings/positioning/models` (host) plus `settings/live2d/{position,scale}`, `settings/spine/{position,scale}`, `settings/mmd/{position,scale,modelOffset,modelRotationY}`, `settings/stage-ui-three/{modelOffset,scale}` (renderer) are three writers for one value. |
| D6 | Addressing disambiguation (RFC 9.8) | `MeshCue` and `SelectionCue{capabilityKind:'mesh'}` are two spellings of one operation, and `ExpressionCue` does not say whether its `key` is an `expression` or a `morph` descriptor. |

A seventh is not a contract defect but is a hard prerequisite: **no `profileId`
exists anywhere today.** `LoadCue.profileId`, `ProfileCue`,
`HostModelProfileRecord` and `ModelScopedState.profileId` all need AIRI to
mint one before a model is imported, and the import path
(`stage-model.ts`) currently mints only the model id.

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
| `stateScope` minting + snapshot record | new host store | One scope per surface today, one per preview mount. Must never equal a `RendererMountSurfaceKind` value. |
| One cue bus | replaces `airi-stores-live2d`, `airi-stores-stage-ui-live2d`, `airi-stores-stage-ui-live2d-motion-control`, `airi-stores-stage-ui-mmd`, `airi-stores-stage-ui-spine` | In-process for the mounted stage, `BroadcastChannel` between windows. Per-mount delivery, ack, FIFO per mount. |
| `services.storage` | wraps localStorage/localforage with a renderer-scoped namespace | The renderer must be able to enumerate *its own* keys (`keys()`), which is what `custom-vrm-animations.ts:95-104` and `sync-engine.ts:1581-1589` do by hand against the global keyspace today. |
| Manifest validation + registry | `ModelDriverHostRegistry` | `contractVersion` checked when the manifest is read; enable/disable; `resolveMountComponent()` lazily (today `RendererStage.vue` imports all four scenes statically). |
| `profileId` minting | `stage-model.ts` + card | Before import, alongside the model id. Kills the `AiriOutfit`/`applyOutfit` need for a host-side composition algorithm. |
| `HostNamedModelRecord` / `HostModelProfileRecord` | replaces the capability fields on `DisplayModel` | `HostAnnotationFields` already matches the stored preview shape (`display-models.ts:1618`). |

Exit criteria: a stub renderer can be mounted, loaded by cue, previewed, snapshotted
and disabled — with no format string anywhere in the host.

---

## 3. Per-renderer migration

Order: **Spine -> MMD -> Live2D -> VRM** (smallest surface first; VRM last because
its camera, transform, meshes, auras and animation storage are all host-entangled).

Each section is: what the renderer must grow, the legacy -> contract map, what the
host deletes, and the renderer-side defects worth fixing while the file is open.

### 3.1 Spine

**Grow:** `manifest` (`capabilityDiscovery: 'static'`, `headPose: true`, no `view`),
`activate`/`deactivate` (replacing
`import.meta.hot?.dispose(() => window.location.reload())` at `Model.vue:1177-1180`
and `Canvas.vue:75-78`), `provider` (`list`, `remove`, `preview`, `probe`,
`modelCapabilities`), and a mount shim over `Spine.vue` adding the required cue
sink and `ContractResult`-shaped `captureFrame`.

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `currentAnimation` | `settings/spine/current-animation`, `{name,loop,nonce}` | `MotionCue{key,repeat}` |
| `oneShotAnimation` | transient `{name,loop,nonce}` | `MotionCue` in a `persistent:false` envelope |
| `currentSkin` / `currentVariant` | `settings/spine/current-{skin,variant}`, strings | `SelectionCue` (`outfitStyle`/`outfitGroup`/`altModel`) or a `ProfileCue` for the `"Variant [Skin]"` composite |
| `activeAnimations` | `settings/spine/active-animations`, never written | `SelectionCue` (or drop it) |
| `animationSpeed`, `defaultMixDuration`, `renderScale`, `idleAnimationEnabled`, `maxFps`, `premultipliedAlpha` | host settings + props | renderer storage; `maxFps` is declared and never read (`Model.vue:30,42`), `premultipliedAlpha` has a store/prop second writer (`:70,281`) |
| `xOffset`/`yOffset`/`scale` props | from `settings/positioning/models` | renderer storage (D5) |
| `mouthOpenSize` | consumed as a boolean edge + bone offset x15 (`Model.vue:541-566`) | `RendererMountProps.mouth.openness` (0..1, normalized by the renderer) |
| `hitAreaHover` emit | `{name,x,y,hovered}` per pointer move | `hit-area-change` `{areaId,entered}`, edges only |
| `getHeadPose()` | `{screenX,screenY,yaw,pitch,roll,modelHeightPx}` | `HeadPose`; `yaw`/`pitch` must become `null` (they are hardcoded `0` at `Model.vue:1169-1170`) |
| `captureFrame()` | `Blob \| null` | `Promise<ContractResult<Blob>>` |
| `shouldUpdateView()` + `airi-stores-stage-ui-spine` | `{type:'spine-should-update-view'}` / `'spine-play-one-shot'` | cue bus; a re-mount request is a `LoadCue` at the renderer's own `modelId` |
| `availableAnimations`/`Skins`/`Variants` written into host localStorage keys | `settings/spine/available-*` | `services.storage` + `modelCapabilities()` + `CapabilityVocabularySnapshot` |
| hit areas | parsed (`model0.json.hit_areas`) and never surfaced | `hitTest` + a `'pointOfInterest'` descriptor set |
| idle list | card `acting.idleAnimations` with `spine:` prefix | renderer-owned selection; the prefix disappears |

**Host deletes:** the binary-skeleton candidate tables and byte scan
(`display-models.ts:2149-2221`), the `"Variant [Skin]"` composition
(`:2250-2265`), static imports of `spine-preview`/`spine-version`
(`display-models.ts:13-14,24`), `display-models.ts:665-770`'s Spine repair, and the
`spine:...` key parsing in `RendererStage.vue`.

**Fix while here:** `componentState='mounted'` in a `finally` after a load failure
(`Model.vue:641-645`) with no `@error` wired at the call site
(`RendererStage.vue:511-533`); the resolution-ignorant head anchor
(`:1147-1159`); `hitDetectionMode: 'bounds'` falling through to the radial test
(`:156-167`); the dead `view-control` store and its disagreeing bounds.

### 3.2 MMD

**Grow:** manifest (`capabilityDiscovery: 'runtime'`, `headPose: true`, no `view`),
runtime with `deactivate`, provider (`probe` is real here: `validateMMDZip` exists
at `utils/mmd-validator.ts:28-69` with **no caller** today), mount shim, and the cue
sink.

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `previewExpression` prop + broadcast | host-written transient with hand-rolled timers | `ExpressionCue` in a `persistent:false` envelope, `resetAfterMs` |
| `currentMotion` + `oneShotAction` | `settings/mmd/custom-motions`, store | `MotionCue` |
| `morph-overrides` | `settings/mmd/morph-overrides`, read but never written by UI | `ExpressionCue` values, or renderer storage |
| `emotion-action-map`, `emotionMorphs` | store; `setEmotion` has **no caller** so the whole path is dead | `ActCue` (the projection becomes renderer-side) |
| physics/IK/grant/gravity switches | `settings/mmd/{physics-enabled,ik-enabled,grant-enabled,physics-gravity}` | renderer storage |
| materials | `settings/mmd/{available-materials,material-opacity,albedo-glow}` | renderer storage; `available-materials` has no consumer |
| lights/skybox/env | `settings/mmd/scenes/...`, `envEnabled`, `skyBoxIntensity`; the renderer *writes* `directional-light/{position,target}` (`MMD.vue:872-873`) | renderer storage |
| camera | renderer owns and auto-frames; `camera-position`, `cameraDistance`, `trackingMode`, `followSpeed`, `eyeHeight`, `lookAtTarget` are **inert**; only `cameraFOV` is read | renderer storage; `cameraFOV` stays renderer-owned, so MMD declares no `view` |
| placement | `settings/mmd/{scale,position,modelOffset,modelRotationY,rotationY,modelSize,modelOrigin}`; `scale` has two writers with different defaults; `rotationY` (radians, applied) vs `modelRotationY` (degrees, written by the panel) | renderer storage; one key per concept (D5) |
| `mouthOpenSize` x0.7 -> `vowelA` | prop | `mouth.openness`; `audioSource` is declared but never fed (`RendererStage.vue:534-555` omits it) |
| `scaleChange`/`offsetChange` emits | wheel/drag | D5 decision (renderer storage vs pushback channel) |
| morphs | host parses PMX by regex and **truncates to 30** (`display-models.ts:2268-2285`) | `modelCapabilities()`; the 30 cap disappears |
| motions | hardcoded 14 (`stores/mmd.ts:203-218`) + user blobs in localforage `mmd-motion-*` | `modelCapabilities()` + `services.storage` |
| sockets | `MmdSocketResolver` written but **never constructed** | `'pointOfInterest'` descriptors if MMD ever declares `view` |

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

**Grow:** manifest (`capabilityDiscovery: 'static'`, no `headPose` today, no
`view`), runtime with `deactivate`, provider, mount shim, and the cue sink — none of
which exist (no `handle(envelope)`, no `profileId`, no `modelCapabilities()`
anywhere in the package).

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `modelSrc`/`modelFile` props | blob URL + raw bytes | `LoadCue.modelId` (+ renderer-internal resolution via `probe.confirmImport`) |
| `activeExpressions` | `settings/live2d/active-expressions`, `Record<fileName,weight>` | `ExpressionCue` / `ActCue` |
| `currentMotion` | `{group,index}` (+ 4 raw `localStorage` keys) | `MotionCue{key}`; the group+index mechanism stays renderer-internal |
| `modelParameters` | `settings/live2d/parameters`, `Record<paramId,number>` | `SelectionCue{capabilityKind:'parameter'}`, or the renderer's own panel |
| `emotionMappings` | `settings/live2d/emotion-mappings`, 3 live writers | renderer-side projection; AIRI sends tokens |
| `disableFocusAt`, `followSpeed` | `settings/live2d/{disable-focus,follow-speed}` | renderer storage (the cue only overrides the live pointer) |
| idle/cycle list | card `acting.idleAnimations`, `live2d:<group>:<index>` | renderer-owned selection; `ResetCue` motion scope |
| pointer | window-relative px divided by canvas size; template `@wheel`/`@pointer*` plus 2 canvas listeners and 4 window listeners | `RendererPointerService` events in box-relative px (D2 resolved); `disableFocusAt` becomes renderer storage |
| `mouthOpenSize` 0..100 | prop | `mouth.openness` normalized 0..1 |
| `hitAreaHover` | per pointer move, `{name,x,y,hovered}` | `hit-area-change` edges only |
| `captureFrame()` | `Blob \| null` | `ContractResult<Blob>` |
| `live2dApp()` + the host's Pixi bubble | ad-hoc native handle; the host draws inside the canvas | deleted — the renderer draws its own bubble from `CaptionCue`, and `nativeHandle` no longer exists |
| DSL: `dispatchDsl`, `selectDslChoice`, `setVarFloat`, `getDslState` | exposed methods | no contract home — see RFC 9.5/9.12 |
| pose/breath spring + exclusive claim | 6 `BroadcastChannel` messages | no contract home — RFC 9.11 |
| captions | renderer posts `caption-assistant`; the host imports the bubble builder | `CaptionCue` + `ResetCue{scope:'caption'}`; presentation is entirely the renderer's |
| `move`/`change_cos`/`replace_tex` | DSL verbs; `change_cos` is a **no-op** today | `SelectionCue`/`ProfileCue`; `replace_tex` needs texture addressing and is dead (`ports.ts` texture sink never wired) |
| costumes | `GimmickCostume` introspected, never applied | profiles |
| intimacy | `settings/live2d/dsl-intimacy`, `0..100000`, leaks to the host | RFC 9.12 |

**Host deletes:** the Live2D zip/cp437/OPFS imports in `display-models.ts`
(`:10-11,26-27`), the two expression/motion parsers (`:1949-2019`), the
`ParamAngleX`-style parameter panel (`live2d.vue:338-406`,
`live2d-customization.vue:298,317`), the `airi-stores-stage-ui-live2d*` channels,
the renderer store re-export at `stage-ui/src/stores/live2d.ts:1`, and the
dating-sim verb parser that duplicates `command-parser.ts`
(`dating-sim.ts:561-591` -> `RendererStage.vue:377-380`) — and
`HeadTetheredCaption.vue`'s in-canvas bubble plus the `live2dSceneRef` prop chain feeding it.

**Fix while here:** `mounted` set after an error (`Model.vue:1412`); the
`getComputedStyle` theme read and the hidden div (`:1526,2038`); `window.electron`
+ `Notification` (`:1006,118-136`); `window.__LHACK_LAST_ZIP_BUFFER__` (`:96`);
hash route sniffing (`:256-267,665-667,962-963,1482`); `useLive2dTranslator`
calling a translation endpoint and caching labels (`use-live2d-translator.ts:117`).

### 3.4 VRM

**Grow:** manifest (`capabilityDiscovery: 'runtime'`, `headPose: true`,
`occupiesPoint: true`, `dispose: true`, `view` only once a POI set exists), runtime
with `deactivate`, provider, mount shim, cue sink, and `modelCapabilities()` from
the expression manager + `unmappedExpressions` (`VRMModel.vue:689-691`).

| Legacy | Shape / key | Contract target |
| :--- | :--- | :--- |
| `modelSrc` blob URL | host-minted per model | `LoadCue.modelId` |
| `triggerEmotion`/`triggerMotion`/`triggerVfx` + `onTrigger*` | store + `airi-stores-live2d` channel | `ActCue` / `MotionCue` / `VfxCue` |
| `activeExpressions` | `Record<name,weight>`, host-written by card sync | `ExpressionCue` |
| `emotionMappings` | `settings/stage-ui-three/emotionMappings`, **write-only** (nothing reads it) | delete; the renderer's own emote states are the projection |
| `hiddenMeshes` + 4 mesh-visibility methods | `string[]`, `(name,visible)`; the `_<prim>` naming leaks the glTF mechanism | `MeshCue` (and RFC 9.8's duplicate) |
| `lookAtTarget`, `trackingMode`, `followSpeed`, `eyeHeight` | host keys, partly renderer-written | renderer storage; `GazeCue` overrides the live pointer |
| camera | `camera-position`, `cameraDistance`, `cameraFOV` + `OrbitControls` writing two of them back | renderer storage once `view` is declared (D5 + RFC 9.6) |
| `modelOffset`, `scale`, `modelRotationY`, `modelOrigin`, `modelSize` | three writers (`settings/stage-ui-three/*`, `settings/positioning/models`, `pages/index.vue:767`) | renderer storage (D5) |
| `availableExpressions` | `settings/stage-ui-three/availableExpressions`, **never cleared on model switch** | `modelCapabilities()` + `CapabilityVocabularySnapshot` |
| idle | `vrmIdleAnimation`, `vrmIdleCycleEnabled` (the latter is never read), card `idleAnimations` with `live2d:`/`spine:` keys parsed out at `VRMModel.vue:284-288` | renderer-owned cycle; the foreign prefixes disappear |
| custom VRMA | localforage `custom-vrma-animation-<uuid>` + tombstones + `airi:custom-vrma-sync` | `services.storage` (the two `localforage`/`BroadcastChannel` usages) |
| `playStatus{duration,url}` | emitted, forwarded, no consumer | delete (RFC 5.5) |
| `binaryLoaded` | declared exposed/emitted, **never emitted** | delete |
| `getHeadPose()` | `{screenX,screenY,yaw,pitch,roll,modelHeightPx}`, always numeric | `HeadPose`, `null` where unmeasurable |
| `readRenderTargetRegionAtClientPoint` | exposed, call site stubbed | `occupiesPoint` |
| cloth/aura | `AuraController` + `VrmSocketResolver` (10 hardcoded sockets) | renderer-internal; sockets become POIs if `view` is declared |
| outfits | `AiriOutfit` + `applyOutfit` composition on the host | `ProfileCue` + renderer-side `saveProfile` |

**Host deletes:** the glTF JSON-chunk expression parse (`display-models.ts:2036-2085`),
static imports of `vrm-preview` (`:11`), `applyOutfit` and `AiriOutfit`
(`airi-card.ts:1407-1469`), the `settings/stage-ui-three/*` host store keys (37),
and the `vrm-instance-cache.ts` module that has zero callers and is not exported
(`components/Model/vrm-instance-cache.ts:41-81`) while `VRMModel.vue:218-266`
implements its own shallow/deep cleanup, and the `vrmViewerRef` exposure the host
reaches into (`RendererStage.vue:436-445`).

**Fix while here:** the deep import of `stage-ui/src/stores/audio`
(`composables/vrm/lip-sync.ts:11`); `window.vrm`/`window.expressionManager`
(`expression.ts:95-100`); `process.env.NODE_ENV` (`:138`); the second CSS-pixel
conversion in `render-target.ts:60-61`; `useThreeSceneIsTransparentAtPoint`
uncalled.

---

## 4. Phase 6 — shared deletions

First, the host's reaches into renderer viewports: `HeadTetheredCaption.vue` (imports a Live2D
composable and hands it the Pixi app), `HeadTetheredCanvas2D.vue`'s in-canvas drawing, and the
`live2dSceneRef`/`vrmViewerRef`/`spineViewerRef`/`mmdViewerRef` exposures on `RendererStage.vue`
together with the per-format `captureFrame`/`readRenderTargetRegionAtClientPoint` ladders that go with
them — capture and occlusion now come from the mount contract only.

Beyond each renderer's list: the `DisplayModelFormat` enum and every switch on it
(`stage-model.ts:139-156,200-209,262-280`), the capability fields on `DisplayModel`
(`display-models.ts:52-55`), `cueAllowlist`/`compiledWhitelist` on the card
(`airi-card.ts:95,99`), the field-wise capability merge in `sync-engine.ts:17-42`
and its call sites, the `<id>-textures` companion convention, and the four
`readRenderTargetRegionAtClientPoint` / `captureFrame` stubs in
`ControlStripHost.vue:1963-1973`.

## 5. Phase 7 — packaging and transfer

Per renderer: manifest `requirements` (Live2D's `Live2DCubismCore` global and the
Spine licence become declared requirements instead of an `index.html` accident and
a settings toggle), `driverTransfer` bundles so a device restore brings back
renderer settings and not only AIRI's records, and the probe path so "drop a file
and AIRI figures out what it is" keeps working after per-format detection leaves
`display-models.ts`.

## 6. Verification per phase

- Phase 1: stub-renderer test through the bus (load, cue round-trip, ack reasons,
  preview, snapshot write/read, disable).
- Each renderer phase: `pnpm -F @proj-airi/stage-ui-<format> typecheck` plus
  `pnpm -F @proj-airi/stage-ui typecheck`, then a runtime smoke list — load by cue,
  ACT emotion, motion + `animation-finished`, preview generation, capture, hit test
  (where declared), head pose shape, pause/visibility, dispose strategy, and one
  cross-window cue.
- Phase 6: `grep -r "airi-stores-" packages apps` returns nothing, and no host file
  reads a renderer store.

## 7. Risk register

| Risk | Mitigation |
| :--- | :--- |
| A migrated renderer keeps its own listener out of habit | D1 is decided, so this becomes a per-renderer checklist item: the pointer path moves to `services.pointer`, the canvas/window listeners are deleted with it, and the renderer's own coordinate conversion shrinks to "box-relative px into my own space". |
| Live observation (D3) unresolved means the control strip keeps reading renderer stores | Land the replacement read path in phase 1, before any renderer moves. |
| Transform ownership (D5) has three writers, so "reset this model" has no owner | Decide first; the safest default is renderer storage plus `ResetCue`, with the host positioning store deleted per format. |
| Live2D's scripting VM has no contract home | Treat the DSL as renderer-internal (its panel owns the UI) and keep the exposed-method surface out of the mount contract; revisit if the host must drive choices. |
| Deleting host capability parsing removes the "works with no renderer loaded" path | `CapabilityVocabularySnapshot` is written by the renderer and read by the host with nothing mounted — that is the replacement, and it must be populated during the same phase. |

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
| AIRI keeps | `settings/stage/model` (the reference), `settings/positioning/models` only until D5 is decided, card `acting.idleAnimations` only if idle selection stays host-owned (it should not) |
