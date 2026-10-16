# RFC 0001 — Stage Model Driver Contract

| Field                    | Value                                                                                                                          |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| Status                   | **Draft, for upstream review**                                                                                                 |
| Package                  | `@proj-airi/stage-renderer-sdk` (new, contract-only)                                                                           |
| Vocabulary               | a **model driver** is the plugin; a *renderer* is what that driver directly drives (§4)                                        |
| Area                     | `packages/stage-ui`, `packages/stage-ui-three`, `packages/stage-ui-live2d`, `packages/stage-ui-spine`, `packages/stage-ui-mmd` |
| Supersedes               | the implicit arrangement "each avatar format is a scene component the host statically imports"                                 |
| Reference implementation | the `stage-renderer-sdk` package in this fork: 13 contract files, `tsc --noEmit` + ESLint clean, **no integration yet**        |

> This RFC is written to be reviewed on its own. Section 2 is evidence from the
> current tree, section 5 is the proposed contract, and section 9 lists what the
> contract still cannot express. Those gaps are deliberately **not** settled, and
> they are the part most worth arguing about.

---

## 1. Summary

AIRI renders avatars with four independent implementations (VRM/Three.js, Live2D,
Spine, MMD). The host knows all four by name: it statically imports their scene
components, branches on a format enum for import, repair, capability parsing and
preview generation, and reaches into their Pinia stores for state it does not own.

This RFC proposes replacing that with **one plugin contract**: a model driver publishes a manifest,
a runtime and a model provider; the host mounts a component it never imported and talks to it through
three channels chosen by *shape* rather than by convenience — **props** for what the host samples
every frame plus the live decisions about a mount, **services** for what a renderer pulls, and
**cues** for discrete, acknowledgeable, refusable intent.

The contract contains no format strings (`vrm`, `live2d`, …), no storage layout, and no UI. Its
governing rule is one sentence: **AIRI owns the named model and every record about it; the model
driver owns the raw model, the model, the renderer, the profiles and the storage.** The only handles
the two sides share are `modelId` and `profileId`, both minted by AIRI.

A note on names: the plugin is called a **model driver** throughout — what it drives is a *model*, and
what it drives directly is a *renderer* — and the types follow it (`ModelDriverManifest`,
`ModelDriverRuntime`, `ModelProvider`, `ModelDriverHostServices`). Only the rendering side keeps the
`Renderer*` prefix: `RendererMount*`, `RendererPointerService`, `HeadPose`.

Nothing in the app changes until a renderer is migrated behind it, and each of the
four can be migrated independently (section 8).

---

## 2. Motivation — evidence from the current tree

### 2.1 The host knows every renderer by name

`packages/stage-ui/src/components/scenes/RendererStage.vue` imports all four
scenes statically (lines 3-6):

```ts
import { Live2DScene, useLive2d } from '@proj-airi/stage-ui-live2d'
import { MMDScene, useMmd } from '@proj-airi/stage-ui-mmd'
import { SpineScene } from '@proj-airi/stage-ui-spine'
import { ThreeScene, useModelStore } from '@proj-airi/stage-ui-three'
```

Consequences that are structural rather than cosmetic:

- **Declaring a renderer unwanted does not remove it.** A user who never uses MMD
  still ships and parses its code.
- **The prop surface is a hand-maintained union.** Each scene accepts a different
  subset of props, and the host calls exposed methods through optional chaining.
- **Adding a renderer means editing the host** in several places: the format enum,
  the import/detect/repair path, the preview generator list, the settings panel
  registry.

### 2.2 Renderer state is reached through renderer stores

Five `BroadcastChannel`s carry renderer state today (`airi-stores-live2d`,
`airi-stores-stage-ui-live2d`, `airi-stores-stage-ui-live2d-motion-control`,
`airi-stores-stage-ui-mmd`, `airi-stores-stage-ui-spine`), all fire-and-forget:
they carry no mount target and return no ack. Host UI reads renderer stores
directly for "what is active right now":

| Consumer                                                                                     | Reads                                                                                                                                                 |
| :------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage-ui/src/components/scenarios/layout/ControlStrip.vue:945-1144`                         | `modelStore.activeExpressions`, `live2dStore.currentMotion`, `live2dStore.activeExpressions`, `mmdStore.currentMotion`, `spineStore.currentAnimation` |
| `stage-ui/src/components/scenarios/settings/model-settings/ModelCustomizer.vue:361,430,441`  | the same, per format                                                                                                                                  |
| `stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:338-406`               | writes `modelParameters.angleX/angleY/angleZ/leftEyeOpen/...`                                                                                         |
| `stage-ui/src/components/scenarios/settings/model-settings/live2d-customization.vue:298,317` | writes `modelParameters[param.id]` for arbitrary parameter ids                                                                                        |

The last two are the sharpest: **the host contains UI hardcoded to one renderer's
parameter names** (`ParamAngleX` and friends). Under the contract that UI is a
renderer-provided panel, and the host no longer knows the names exist.

### 2.3 One host component calls into a renderer's internals

`packages/stage-ui/src/components/scenes/HeadTetheredCaption.vue` (a host
component) imports `attachLive2DHeadTetheredCaption` from
`@proj-airi/stage-ui-live2d/composables/live2d` and hands it the renderer's live
Pixi application (`:128`); that code injects a `BatchRenderer` and draws a speech
bubble inside the renderer's own canvas, reading `ParamAngleX/Y/Z` every frame for
its perspective effect. The renderer's app object travels host -> renderer as a ref
(`RendererStage.vue:563`), and the text arrives on the caption subsystem's own
channel (`airi-caption-overlay`) — which the renderer also posts to from inside
itself (`stage-ui-live2d/src/components/scenes/live2d/Model.vue:988-998`).

This is the clearest example of a host/renderer boundary that does not exist yet,
and it is also the case the current contract handles worst (section 9.4).

### 2.4 Renderer settings are ambient localStorage

Grepping the four renderer packages plus the desktop renderer for literal
`settings/(stage-ui-three|live2d|mmd|spine)/...` keys yields **99 distinct keys**
(11 Live2D, 39 MMD, 12 Spine, 37 VRM), and the stores also read keys built at
runtime. The host can neither enumerate nor migrate them, and several are already
corrupt:

- `settings/mmd/scale` — two writers with different defaults (`1` in
  `stage-ui-mmd/src/stores/mmd.ts:221`, `0.1` in `stores/view-control.ts:14`), both
  read (`MMD.vue:216,224`);
- `settings/mmd/render-scale` — written by the renderer store
  (`stores/mmd.ts:173`) and by an otherwise unread host store
  (`stage-ui/src/stores/settings/mmd.ts:6`);
- `settings/mmd/rotationY` (radians, read by the render loop) vs
  `settings/mmd/modelRotationY` (degrees, written by the Placement slider) — the
  slider cannot move the model;
- `settings/live2d/emotion-mappings` has three live writers
  (`airi-card.ts:877`, `ControlStripHost.vue:240`,
  `ModelCustomizer.vue:269,347`).

### 2.5 Capability lists are computed twice and disagree

For every one of the four formats the host builds its own list by parsing the
package and the renderer builds another from the loaded runtime:

| Format | Host parse                                                                                                                                                             | Runtime truth                           |
| :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| VRM    | glTF JSON chunk: VRM 0.x `blendShapeGroups`, `VRMC_vrm.expressions`, `extras.targetNames` (`display-models.ts:2036-2085`)                                              | `VRMModel.vue:691` (expression manager) |
| Live2D | `.exp3` scan + `FileReferences.Motions` (`display-models.ts:1957-2009`)                                                                                                | `live2d/Model.vue:777,1211,1222,1255`   |
| Spine  | JSON skeletons when readable; **hardcoded 5-skin / 40-animation candidate tables plus a length-prefixed byte scan** for binary `.skel` (`display-models.ts:2149-2221`) | `spine/Model.vue:271,469,470`           |
| MMD    | UTF-16 regex over PMX, **`slice(0, 30)`** (`display-models.ts:2268-2285`)                                                                                              | `MMD.vue:714,737`                       |

The settings UI then deliberately ignores the runtime list
(`ModelCustomizer.vue:350-353`), and neither list is obviously the truth.

### 2.6 The input surfaces differ in ways nobody declared

Audited divergences between the four implementations:

| aspect          | Live2D                                                | VRM                                         | Spine                             | MMD                 |
| :-------------- | :---------------------------------------------------- | :------------------------------------------ | :-------------------------------- | :------------------ |
| mouth input     | `0..100` -> `0..1`                                    | `0..1` (x0.75)                              | `0..1` (x15, boolean edge)        | `0..1` (x0.7)       |
| audio source    | no                                                    | yes (`wlipsync`)                            | no                                | wired, never fed    |
| focus/gaze      | `focusAt` in **window** space                         | `useMouse()` in **viewport** space          | none                              | cursor position     |
| head pose       | **missing**                                           | yes                                         | yes (`yaw`/`pitch` hardcoded `0`) | yes                 |
| capture         | `Blob \| null`                                        | `Blob \| null`                              | `Blob \| null`                    | yes                 |
| occlusion query | none                                                  | offscreen render target (call site stubbed) | none                              | none                |
| native hit test | native `hitTest` used internally, not exposed         | none                                        | parsed, never surfaced            | none                |
| readiness       | 3-value enum, `finally` sets `mounted` after an error | same                                        | same                              | resets to `pending` |

None of it is declared anywhere: it is discovered by reading four implementations.
Two of the divergences are load-bearing for this RFC:

- **No renderer produces a head pose in the contract's shape.** All three
  producers return `{screenX, screenY, yaw, pitch, roll, modelHeightPx}` while the
  proposed `HeadPose` is `{position: {x, y}, yaw, pitch, roll, modelHeightPx}` with
  `null` for an axis a rig cannot measure. Spine's `yaw`/`pitch` are literally
  hardcoded `0` (`spine/Model.vue:1169-1170`), which the contract must read as
  "unknown", and VRM always fabricates `modelHeightPx`
  (`ThreeScene.vue:476`) where the contract wants `null` when unmeasurable.
- **No renderer produces a point of interest.** `ViewCue` has no address today in
  any of the four (VRM/MMD have an enumerable 10-name socket list behind
  `VrmSocketResolver`/`MmdSocketResolver`, neither of which is exposed, and the
  MMD resolver is never even constructed).

### 2.7 Pointer interaction cannot be centralized today

All four bind their own DOM listeners for drag/pinch/wheel:

- Live2D: `@wheel`/`@pointerdown/move/up/cancel` in the template
  (`components/scenes/Live2D.vue:239-243`), plus
  `canvasEl.addEventListener('mousemove' | 'click')`
  (`live2d/Model.vue:1954-1955`);
- Spine: four canvas listeners (`spine/Model.vue:124-128`) and four window-level
  ones (`gesture-interaction.ts:456-472`);
- MMD: `MMD.vue:970-974`;
- VRM: `ThreeScene.vue:561-565`, `useMouse()` (`VRMModel.vue:158`), four window
  listeners for cloth (`VRMModel.vue:177-199`) and `OrbitControls` on the
  renderer's own canvas (`OrbitControls.vue:186`).

The pointer is also not in one space: Live2D receives **window-relative** CSS px
and divides by `props.width/height` (`motion-manager.ts:287-299`), VRM's
`useMouse()` raycast uses `window.innerWidth/innerHeight`
(`VRMModel.vue:515-516`), Spine converts to **buffer** px
(`gesture-interaction.ts:296-308`) and compares against
`canvasEl.width/2 + bone.worldX`. Any contract that says "the host owns the
pointer" has to give renderers a replacement, and this one does: one host-side conversion plus
`RendererPointerService` (5.7), so the conventions above become migration inputs instead of four
permanent coordinate spaces.

### 2.8 An unwired performance runtime shows where the design is heading

`packages/stage-ui-three-performance-runtime` (currently imported by nothing)
defines a `PerformanceTimeline` of `speech | viseme | expression | body | marker`
events with millisecond timestamps and an `ActorState` blackboard
(`speech.playheadMs`, `gaze.type: 'screen' | 'world'`, `markers`, `flags`). That is
a *scheduled* model of performance, and the cue model in section 5.4 deliberately
has no timeline. Section 9.10 treats that gap honestly instead of claiming the cue
model covers it.

### 2.9 There is no profile concept at all

`LoadCue.profileId`, `ProfileCue`, `HostModelProfileRecord` and
`ModelScopedState.profileId` have **no host-side reality**: no `profileId`
exists anywhere in the mount path, and "outfits" are instead an `AiriOutfit[]` on
the character card (`airi-card.ts:102-111`) plus a copy on the model record, with
the composition algorithm ("a base zeroes the other bases", "an overlay toggles
off when already on") implemented in host code and followed by a poke into one
renderer's store (`airi-card.ts:1423-1469` -> `shouldUpdateView()`).

### 2.10 Why a contract rather than a fifth refactor

Every previous fix in this area was local: a new prop, a new store, another
`if (format === ...)`. The costs above are not bugs in those fixes, they are the
shape of the arrangement. The contract exists so the next renderer is a plugin
rather than five host edits.

---

## 3. Goals and non-goals

**Goals**

1. A renderer can live **outside this monorepo**: it declares what it can do and
   the host mounts it without importing it.
2. The host never learns a format's vocabulary, storage layout, or rig.
3. Import, capability discovery, preview generation, repair and validation move
   behind the renderer that can actually do them.
4. One cue vocabulary and one ack shape, so the ACT pipeline, the settings UI and
   the control strip stop branching per renderer.
5. Per-renderer state becomes the renderer's own, with the host supplying storage
   primitives and one readable projection.
6. A renderer can be disabled, and a whole renderer can be moved between devices as
   one opaque bundle.

**Non-goals**

- No plugin loader, no DI container, no discovery mechanism — the existing plugin
  host keeps owning enable/disable/load/unload. `entry.runtime` is a specifier the
  *loader* resolves.
- No storage medium or layout decisions for renderer: the renderer owns keys, shape,
  versioning and migration.
- No forcing the four existing renderers to share behavior they genuinely do not
  share (Live2D has no camera, VRM has no hit regions). Differences are *declared*
  through capabilities instead of inferred.

---

## 4. The rules

Two rules of modularity, and then the ownership they produce.

**One should know what it needs to know, and do what it is best at.**

Holding only minimal knowledge is not being lazy, it is about modularity. Trying to
"do it all" only results in increased maintenance load and poorly readable code.

**Never hesitate to ask for help, but do so at an well-defined interface.**

When modules need to cooperate, never defer doing so, because only the other side has the knowledge.
Asking for help at an explicit boundary forces an evaluation to be made about the core problem,
necessity of the interface, the design, and interoperability. Ultimately, this enhances modularity and
efficiency.

Take model import as an example.

| Knowledge                                        | Owner        | Result                                                       |
| :----------------------------------------------- | :----------- | :----------------------------------------------------------- |
| What the model is in its binary form.            | User         | User can do "import anyways".                                |
| How to parse the model from its binary form.     | Model driver | Renderers only need to be responsible for their own format.  |
| How to store the model in its binary form.       | AIRI         | AIRI does not need to understand any model format.           |

| Interface               | Reason                                            |
| :---------------------- | :------------------------------------------------ |
| `ModelProvider`         | AIRI does not know what a model physically is.    |
| `HostStorageInterface`  | Model driver does not know where to store the bytes. |

### 4.1 Ownership

| Concept         | Owner        | What it is                                                                        |
| :-------------- | :----------- | :-------------------------------------------------------------------------------- |
| Character       | AIRI         | A virtual, "conscious" being, with a "mind" and optionally a "body".              |
| Named model     | AIRI         | A model that a character can reference.                                           |
| Raw model       | Model driver | The model itself, its behaviors, parameters, textures, etc.                       |
| Model           | Model driver | What the model driver is ultimately driving.                                      |
| Renderer        | Model driver | What the model driver is directly driving.                                        |
| Profile         | Model driver | A group of named persistent states of an avatar.                                  |
| User input      | AIRI         | Cursor, lip-sync audio, cues, ACT tokens, etc.                                    |
| Model capability| Model driver | What kinds of inputs a model driver and its model can respond to.                 |
| Cue             | AIRI         | A signal for model driver to perform actions with a vocabulary known at compile time. |
| ACT token       | Model driver | A signal for model driver to perform actions with a vocabulary known at runtime.  |
| Expression      | Model driver | An action performed by an avatar that does not involve animations.                |
| Motion          | Model driver | An action performed by an avatar that involves animations.                        |

| Responsibility       | Owner        |
| :------------------- | :----------- |
| Storage primitives   | AIRI         |
| User input primitives| AIRI         |
| Storage layout       | Model driver |
| Data migration       | Model driver |
| Rendering            | Model driver |
| Model manipulation   | Model driver |

`Cue` and `ACT token` are the pair this RFC is most often misread on: the *transport* and the cue
kinds are compile-time facts (AIRI ships them), while the vocabulary an ACT token may use is known
only at runtime and belongs to the model driver. That is why `ActCue` travels on the cue channel
rather than on a channel of its own: how a token is delivered is decided when AIRI is built, and what
it means is decided when a model is loaded.

### 4.2 The governing rule

> **AIRI owns the named model and every record about it. The model driver owns the raw model, the
> model, the renderer, the profiles and the storage.**

- AIRI stores *records*: the id a character card points at, the catalogue row, tags
  and groups, and a preview snapshot for when the owning driver is unavailable.
- The model driver owns *the rest*: bytes, format validation and repair, preview
  generation, capability enumeration, every per-model setting and every migration.

The only handles the two sides share are `modelId` and `profileId`. AIRI mints
both — the `modelId` before the import, the default `profileId` before the import
too — so a driver never invents an AIRI-facing name, and AIRI never holds a
driver-internal one.

One part of the rule already holds end to end and can be kept as is: the single
model identity that flows card -> `settings/stage/model` -> `stageModelSelected` ->
`:model-id` is exactly the value `LoadCue.modelId` carries, and stored previews are
already a compressed data URL on the record with an AIRI-stamped `updatedAt`
(`local:sync-metadata/preview-updated/<id>`), which is the `ModelPreview` shape.



---

## 5. Design

### 5.1 Identity (`model.ts`)

```ts
type ModelId = string // AIRI-minted, e.g. `display-model-<nanoid>`
type ModelProfileId = string // AIRI-minted
```

Nothing else identifies a model. In particular `modelDriverId` answers "who serves
this right now", not "what is this", so a reference survives its renderer being
disabled or replaced.

### 5.2 The plugin (`manifest.ts`, `lifecycle.ts`, `provider.ts`)

A model driver publishes:

```ts
interface ModelDriverManifest {
  id: ModelDriverId // e.g. `ai.moeru.airi.stage.live2d`
  name: string
  driverVersion: string
  contractVersion: ModelDriverContractVersion // checked when the host reads the manifest
  capabilities: ModelDriverCapabilities // static hint (5.3)
  requirements: ModelDriverRequirements // webgl/wasm/opfs/worker/audioContext/dom/globals/license/storage
  entry: { runtime: string } // required; the loader resolves it
}

interface ModelDriverRuntime {
  readonly manifest: ModelDriverManifest
  readonly provider: ModelProvider // required
  activate: (services: ModelDriverHostServices) => Promise<ContractResult<ModelDriverActivationReport>>
  deactivate?: () => Promise<void>
  rendererCapabilities: () => MaybePromise<ContractResult<ModelDriverCapabilities>> // the probe
  resolveMountComponent: () => Promise<RendererMountComponentFactory> // a factory, not a module path
  readonly panels?: ModelDriverPanelDeclaration[]
  export?: () => MaybePromise<ContractResult<ModelDriverTransferBundle>>
  import?: (bundle: ModelDriverTransferBundle) => MaybePromise<ContractResult<ModelDriverImportReport>>
}
```

**Why activation exists at all.** Today a renderer is "whatever the host statically imported": there is
no activation step, no way to be disabled, no place to report "I am running degraded", and no agreed
teardown semantics. No renderer in this workspace handles `webglcontextlost`, Live2D and Spine force
`window.location.reload()` on HMR dispose, and VRM needs a deep/shallow dispose distinction the host
cannot express. Activating explicitly, reporting requirements and declaring a dispose strategy turn all
of that into contract instead of folklore. Activation itself MUST NOT mount anything: it wires services,
checks requirements (globals, WASM, OPFS, licence) and reports degradations.

**Why the capability probe is on the runtime and not on the manifest.** `ModelDriverManifest.capabilities`
is a static claim, readable without executing the driver, so a loader or a picker can use it and the host
has something before activation. `rendererCapabilities()` is the truth under the resources actually in
effect, and only a running instance can answer it. A *failed* probe means "could not determine", not
"nothing is available", so the hint stays a usable fallback rather than a verdict that the driver is
useless. What activation deliberately cannot report is a capability the driver had to give up: that is
the probe's answer, and a second list here would be two sources for one answer.

**Why `ModelDriverHostRegistry` carries no availability state.** The registry is the *only* static fact
AIRI has about whether a named model can be served: that its driver exists and is enabled. Everything
past that — whether the driver still holds the asset, whether it can still read or load it — is only
knowable from an instance, so it is produced at runtime (`ModelProvider.list`, a `ContractResult`
failure, the mount's own `error` emit). Availability is therefore a runtime fact, not a stored one, and
there is no enum to keep in sync with those answers.

**Why the cue sink is on the mount, not the runtime.** One renderer can be mounted on a live stage, in a
settings preview and in a rehearsal room at once; each mount receives only the transactions addressed to
it (5.4).

**Why the provider is a member of the runtime rather than an injected service.** "The models I hold" is
the driver's own implementation, not a capability the host grants it. It is reached from the runtime but
not owned there: the host may hand the reference to a part that never saw the runtime (an importer, a
settings surface, a background sync), which is why the provider carries its own `modelDriverId`.

**Why panels are declared on the runtime as factories.** The driver owns its capability record *and* the
UI for it (labels, usable/favourite toggles, idle selection, ACT mappings, outfit profiles), so the host
mounts the driver's own component instead of keeping per-format editors in host code — `ModelCustomizer.vue`
is one host component with per-renderer branches, a hardcoded 8-outfit cap and renderer-specific
side-effects. They are factories rather than manifest strings for the same reason `resolveMountComponent`
is: nothing interprets a raw `.vue` at runtime. Host obligations toward a panel are three: the host
provides the frame (title, tabs, scrolling, padding) and the panel fills the body; a driver that is
unavailable gets no panel at all, only a read-only list built from its `vocabulary`; and `readOnly`
covers the case where the driver *is* available but this mount must not edit. A panel never writes the
snapshot itself — only the mounted instance does — so two windows cannot race on `revision`.

The provider is the non-mount half:

```ts
interface ModelProvider {
  readonly modelDriverId: ModelDriverId
  probe?: (input: ModelProbeInput) => MaybePromise<ContractResult<ModelProbeResult>>
  list: (query?: ModelQuery) => MaybePromise<ContractResult<ModelDescriptor[]>>
  remove: (modelId: ModelId) => MaybePromise<ContractResult<void>> // idempotent success
  preview?: (modelId: ModelId, profileId?: ModelProfileId) => MaybePromise<ContractResult<ModelPreview | null>>
  modelCapabilities?: (modelId: ModelId) => MaybePromise<ContractResult<ModelCapabilityDescriptor[]>>
  listProfiles?: (modelId: ModelId) => MaybePromise<ContractResult<ModelProfileDescriptor[]>>
  saveProfile?: (modelId, profileId, options) => MaybePromise<ContractResult<ModelProfileDescriptor>>
  removeProfile?: (modelId: ModelId, profileId: ModelProfileId) => MaybePromise<ContractResult<void>>
  export?: (modelId: ModelId) => MaybePromise<ContractResult<ModelTransferBundle>>
  import?: (bundle: ModelTransferBundle) => MaybePromise<ContractResult<ModelDescriptor>>
}
```

**Unified import is preserved, and it is the only import path.** The host asks
every enabled renderer how well it can host an input and arbitrates by
`confidence`; AIRI never carries the bytes — `probe` is handed the identities it
just minted and answers with `confirmImport`, the callback that does the work.
Declining unified import is expressed by omitting `probe`, not by failing:
`unsupported-input` is a real error, so a probe that returns it is a broken probe
rather than a verdict on whose input it was. A renderer that cannot read a
particular input reports that as a *successful* probe with low `confidence` and
`blockingFindings`, and the user may still overrule it with `force`.

**Companions are never catalogue entries.** A model file and the textures its
materials reference are one thing: no id, no second storage entry, never listed.
This deletes the host's `<modelId>-textures` convention, which today has to be
excluded from enumeration, remembered at two delete sites, re-fetched before
preview regeneration, and uploaded as a second cloud payload per model. MMD's
`textureMap` prop is the same case in the mount contract: a texture set is required
to use the model at all, so the renderer keeps it as part of the model's own storage
and resolves its own relative texture paths. It must not become a prop.

**AIRI only knows what has an id it minted.** A model row without a `modelId` is still enumerated by
`list()` — a builtin the driver ships, which never went through the import path — and its absence means
exactly one thing: this row can be enumerated but not addressed. AIRI must not mint a reference to such a
row and a driver must not invent one to fill the gap. Everything else the driver holds either stays in
its own storage or travels in the opaque `meta` bag, which AIRI persists verbatim and never interprets.

**Two catalogues replace the asset class.** `list` is models, `listProfiles` is profiles, and there is
no `kind` string to tell a row of one kind from a row of the other — which is exactly the classification
string AIRI used to carry, and the reason the two lists drifted apart. `listProfiles` answering "none" is
a success with no rows, not `asset-missing`: an unknown model is how the orphan becomes visible, while
`ok: false` means the question could not be answered at all and must not be read as "no profiles".

**`modelCapabilities()` is the only way capabilities are enumerated.** Including the
`capabilityDiscovery: 'runtime'` case: the provider belongs to the same plugin as any mounted instance,
so it can read its own live state, and there is deliberately no second capability query on the stage
component.

**A descriptor may carry its own preview.** A catalogue row is exactly where a thumbnail is wanted, and a
driver that already has one should not be asked per model. AIRI stores what it gets
(`HostAnnotationFields.preview`, stamping `updatedAt`) rather than rendering it directly, so the
catalogue keeps working with no driver at all; `preview()` is how a stored copy is produced or refreshed,
and both sources deliver the same shape. Profile labels are suggestions for the same reason: AIRI keeps
its own `displayName`, so a rename never has to go back to the driver.

**A profile save mode has no default.** `upsert` overwrites state the user may have spent time on, so the
caller has to say which one it means.

**`files` has to reach `probe`, not only `confirmImport`.** With the payload's second round trip gone,
`probe` is the only place the input is ever handed over — and `confirmImport` returns a list because one
input can legitimately expand into several models (a multi-model package is split and each part
imported).

**One query object, many providers.** `ModelQuery.modelDriverId` exists so the host can hand the same
query to every enabled driver and merge the answers: a provider replies only when the id is its own, and
every `ModelDescriptor` carries its `modelDriverId` so a merged list can be filtered the same way without
asking anyone.

**Removals are idempotent, exports are not.** Removing what is already gone is the outcome the caller
asked for (`ok: true`), and "everything" includes the model's profiles — a profile *body* does not
outlive its model, so one that has to survive is a record AIRI keeps and `saveProfile` can write again.
`export` is the opposite case: the caller asked for something present and it is not there, so
`asset-missing` is the correct answer. That is why both shapes exist.

**A transfer bundle carries the descriptor it was exported with**, so `modelId` is what makes a restore
land on the same asset instead of minting a new one, and the host routes the bundle by its descriptor's
`modelDriverId`.

**A whole-driver bundle is opaque by construction.** There is no field describing what is inside: a
description would be a storage detail AIRI must not learn, and it would go stale the moment the driver
changes. What an import could not restore is reported as warnings, because a partly restored driver is
more useful to the user than a failed one; a driver that could restore nothing reports a failure through
the envelope instead.

### 5.3 Capabilities (`capabilities.ts`, `manifest.ts`)

```ts
interface ModelDriverCapabilities {
  probe: boolean
  previewModel: boolean
  capabilityDiscovery: 'static' | 'runtime' | 'none'
  profiles: boolean
  modelTransfer: boolean
  driverTransfer: boolean
  panels: boolean
  deactivate: boolean
  cues: Exclude<CueKind, CueKind.LOAD>[]
  headPose: boolean
  occupiesPoint: boolean
  hitTest: boolean
  stopAll: boolean
  dispose: boolean
}
```

Every field is required in **both** answers. This is the shape of two things, and
the difference is the point:

- `ModelDriverManifest.capabilities` — a **static claim**, readable without running
  the renderer, so a loader or a picker has something before activation;
- `ModelDriverRuntime.rendererCapabilities()` — the **truth** under the
  resources actually in effect (a missing OPFS grant, a GPU that cannot hold the
  model, a declined licence). Whoever holds the probe uses the probe; a *failed*
  probe means "could not determine", so the hint stays a usable fallback rather
  than a verdict that the renderer is useless.

`profiles` is one field for all three profile members (`listProfiles`, `saveProfile`, `removeProfile`)
because they are one ability: a renderer that can list a profile can store it. AIRI needs the answer to
know whether its own profile records can have bodies behind them at all. `driverTransfer` is what makes
a driver movable: without it, a device restore brings back AIRI's own records and leaves the driver
empty, so the host can say so *before* a backup instead of after a restore.

It is **not** `Partial<...>`: a missing field would have to be read as `false` at
every use site, which turns "I did not say" into a silent denial and puts a
null-coercion in front of every member. A renderer that cannot do something says
`false`; one that forgot to say is a plugin the loader can reject.

The kinds a model can be enumerated in:

```ts
type ModelCapabilityKind
  = | 'expression' | 'morph' | 'motion'
    | 'outfitStyle' | 'outfitGroup' | 'altModel'
    | 'parameter' | 'mesh' | 'vfx'
    | 'pointOfInterest' // a place the renderer can put its camera (5.4)
```

`capabilityDiscovery` records a real difference rather than a preference: Live2D
and Spine can be enumerated from the package bytes, VRM only after the model is
loaded and the expression manager exists, and a renderer with no capability model
says `none`. `'none'` and declaring the `'view'` cue contradict each other, and so
does `'pointOfInterest'` belonging to the vocabulary AIRI prompts with: points of
interest exist *only* as capability descriptors, so a renderer without a capability
model has no camera target to name, and a camera target is not a token family
(`ActTokenKind`) so it never belongs in a prompt.

A descriptor's `key` is opaque to AIRI but must stay stable across sessions, because AIRI persists
mappings that point at it — which is exactly why the *label* the user sees is stored in the renderer's
own record rather than read back from AIRI's side.

Capability *records* — labels, usable/favourite toggles, idle-cycle selection,
every ACT mapping, and the UI for how capabilities combine — belong to the
renderer, and so does the UI for them (5.2). AIRI keeps exactly one projection,
read-only, because prompts are built while nothing is mounted:

```ts
interface CapabilityVocabularySnapshot {
  items: { key: string, tokenKind: 'emotion' | 'motion' | 'vfx', label: string }[]
  instructions?: string
  updatedAt: number
}
```

Its stability requirement is a real constraint: AIRI injects it into prompts, so a
vocabulary that changes every turn destroys prompt-prefix caching.

### 5.4 Cues (`cues.ts`)

**A cue is a discrete, acknowledgeable, refusable intent.** An envelope is a
transaction:

```ts
interface CueEnvelope<C extends Cue = Cue> {
  cues: C[] // applied together, never in sequence
  source: 'user' | 'agent' | 'card' | 'renderer' | 'host' | 'external'
  persistent?: boolean // false = preview: transient, never saved
  nonce: OperationNonce
  at: number
  target?: { modelDriverId?: ModelDriverId, modelId?: ModelId, mountId?: string, surface?: RendererMountSurfaceKind }
}

interface CueAck {
  nonce: OperationNonce
  reason: (CueRejection | undefined)[] // index-aligned; undefined = applied
  handled: boolean // reason.every(r => r === undefined)
}

type CueRejection
  = | 'unsupported-cue' | 'unknown-key' | 'renderer-not-ready' | 'no-model'
    | 'suppressed-by-mode' | 'superseded' | 'busy'
```

The rules that matter for review:

1. **Refusal is not failure.** Every `CueRejection` value is an ordinary outcome:
   the send resolves `ok: true` with `handled: false`. `ok: false` is reserved for
   an operation that was *attempted and broke*, which is why a dropped transaction
   (`dropIfNotReady`), a refused cue and a superseded one all look the same from
   the caller's side.
2. **Exactly one order is requested, as a recommendation:** apply a `load` member
   before the others, and the rest together once it lands. Every other kind
   presupposes a model, so "an expression and a load at the same time" describes nothing.
   A renderer that fails the load leaves the rest unapplied and reports that same
   reason in every remaining slot, so the tail stays all-or-nothing.
3. **Across envelopes the host owes one property: FIFO per addressed mount** —
   delivery order, not serialization. Two envelopes for one mount may be in flight
   at once, which is why `superseded` stays a real outcome and the ack echoes the
   `nonce`. There is deliberately no "expression before motion" protocol.
4. **`superseded` is not `aborted`.** Being overtaken by something newer is normal
   operation; being dropped because the mount went away or the caller cancelled is
   a failure (`ContractFailureCode.aborted`). A renderer must not report one as
   the other.
5. **A `load` ack settles when the outcome is decided**, not when the renderer
   accepts it: a successful slot counts as applied at
   `RendererMountReadinessState.MODEL_LOADED`, not at `first-frame` (which keeps
   its separate meaning: the loading UI can go away). If the renderer cannot settle
   at all — it was disposed, disabled, or replaced — the **host** settles the
   caller's promise with `aborted`: a caller must never be left waiting on a
   renderer that is gone.
6. **A per-frame stream must never become a cue.** `send` returns an ack whose
   reason array is sized to the transaction, so one frame per cue would allocate an
   ack per frame and ask a question a stream cannot answer. That is why mouth
   openness is a prop and the pointer is a service: a value the host restates, versus
   events a renderer subscribes to. (Two Live2D streams violate this today —
   section 9.11.)

The vocabulary (12 kinds). The kinds themselves are the *compile-time* half — AIRI ships them — while
the token a `ACT` cue carries belongs to the renderer and is known only at runtime (§4.1):

| Kind         | Payload                                                                      | Notes                                                                                 |
| :----------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| `load`       | `modelId`, `profileId?`                                                      | the only way a mount is told what to show; accepted by every renderer                 |
| `ACT`        | `actToken`                                                                   | **the renderer projects the token**; AIRI never learns the projection                 |
| `expression` | `key`, `value?` (0..1), `resetAfterMs?`                                      | direct addressing of one renderer-native unit                                         |
| `motion`     | `key`, `repeat?` (-1 forever / 1 once), `crossfadeMs?`                       | one id, whatever addressing the format uses underneath                                |
| `vfx`        | `effect`, `durationMs?`                                                      |                                                                                       |
| `mesh`       | `key`, `value: boolean`                                                      | raw visibility, driven by calibration UI                                              |
| `selection`  | `select: { capabilityKind, key, value? }[]`                                  | kind-agnostic state assignment; `value` makes the "off" side expressible              |
| `profile`    | `profileId`                                                                  | **no payload**: the renderer already stored the body under that id                    |
| `gaze`       | `mode: none \| pointer \| camera \| target`, `point?`                        | sole purpose: temporarily override the live pointer the renderer follows              |
| `view`       | `pointOfInterestId`, `zoom?` (relative)                                      | moves the renderer's own camera; **declaring `view` is an ownership statement**       |
| `caption`    | `text`, `utteranceId`, `segments?`, `language?`, `elapsedMs?`                | **the renderer owns text and captions**: content only, never position, font or colour |
| `reset`      | `scope: expression \| motion \| selection \| gaze \| view \| caption \| all` |                                                                                       |

Three of these are worth defending explicitly:

- **`ACT` carries a token, not a renderer key.** Today the projection table is
  two renderer-store keys written by the host's card sync
  (`settings/live2d/emotion-mappings`, `settings/stage-ui-three/emotionMappings`),
  i.e. the host keeps a copy of renderer knowledge and keeps it in step — and one
  of the two is write-only (nothing reads `emotionMappings`; VRM renders through
  its own built-in emote states). Under the contract AIRI states the intent the
  prompt (or card, or user) expressed and never learns what it played. A caller
  that wants one specific unit uses `expression`.
- **`view` has no absolute camera values, and no way to grow them.** Position,
  distance, FOV and look-at are the renderer's own state. Two of the four
  renderers have no camera at all (Live2D, Spine — only a 2D model transform) and
  MMD owns and auto-frames one, so an absolute placement would be unhonourable for
  most of them, and for the ones that do have a host-written camera today (VRM) it
  would be a second writer of the same value — exactly how `settings/mmd/scale`
  acquired two. The caller says *where* (a point-of-interest id) and *how tight*
  (relative zoom); everything else is the renderer's. `ResetCue` with
  `scope: view` hands framing back to the renderer's default.
- **`profile` carries no body.** What is an `AiriOutfit` on the card today — name,
  icon, mesh names, expression weights, plus `type: base | overlay` — becomes a
  renderer-stored configuration, because the composition rules are the renderer's:
  the host currently implements "an overlay toggles off when already on", "a base
  zeroes the other bases", then pokes one renderer's store to refresh. AIRI mints
  `profileId`, keeps `displayName`/`note`/`preview`, sends the cue, and must not
  decompose a profile into `selection` cues of its own.

Smaller choices, recorded because each one replaced a shape that drifted:

- **A raw numeric parameter is `selection`, not a cue kind of its own.** `capabilityKind: 'parameter'`
  with a numeric `value` says the same thing one mechanism lower, and two ways to say one thing is what
  this contract exists to remove. The same reasoning keeps `mesh` as a *kind-agnostic* selection target
  as well: `MeshCue` exists for the calibration UI's explicit boolean, not as a second vocabulary.
- **`expression` and `motion` are the two shapes of "run this named action"**, matching the concept
  split in §4.1: an action that does not involve animation, and one that does.
- **A motion is addressed by exactly one id, and repetition is one number.** Live2D addresses motions by
  group + index while VRM/MMD/Spine use names, so a `group`/`index` pair on the cue would have exposed
  one renderer's mechanism to every caller and left the cue unable to say which of the two it meant. A
  motion the renderer cannot name by one id is a motion it does not offer, and naming one it never
  listed is `unknown-key`. `repeat` replaced a `loop` boolean plus a separate `oneShot` flag, which could
  contradict itself ("interject and keep looping"); "play once" is simply `repeat: 1`.
- **The ack echoes the `nonce`.** A caller with several transactions in flight can have a late ack
  arrive over `BroadcastChannel` or IPC, where it is otherwise indistinguishable from the answer to
  whatever was sent next.
- **A dropped transaction is answered by the host, not the renderer.** Not delivering is the host's
  decision, so a dropped envelope comes back `ok: true` with `renderer-not-ready` in every slot, and the
  renderer is never consulted about a model it is not rendering. That is also why a refusal, a drop and
  a supersede all look the same from the caller's side.
- **The channel is deliberately transport-agnostic**: in-process for the mounted stage,
  `BroadcastChannel` between windows, IPC for remote actors. Today those are three per-driver
  implementations with different channel names, and a window that forgets to instantiate the matching
  store silently drops every cue.
- **A `reset` scope exists because three of these intents have no duration of their own.** A transient
  selection has no expiry, an utterance has none either, and a gaze override holds until it is released;
  `view` is the fourth case, handing framing back to the renderer's default.
- **`gaze` overrides the live pointer rather than being a second pointer.** All four modes answer one
  question — which target replaces the pointer — with `'pointer'` being the answer that ends the
  override, so the cue stays one override instead of a gaze configuration.
- **A caption is a replacement, not an append.** A host that synthesizes one sentence at a time re-sends
  the growing utterance, and `utteranceId` is what lets the renderer keep its own highlight progress
  instead of restarting on every update; `elapsedMs` is what lets a cue that arrives mid-sentence start
  where playback actually is, without either side sharing a clock.
- **`retryable` on a failure is a hint, not a policy.** AIRI owns everything about retrying that a
  caller sees — how many attempts, how long between them, what the user is offered — so nothing may
  depend on the value: a renderer must not withhold work it could do because it set `false`, and the
  host must not turn `true` into an automatic loop. Absent means the renderer has no opinion, never "do
  not retry".
- **Eligibility is not failure.** A reference this renderer does not hold is a slot reason
  (`unknown-key`), so the send succeeds with `handled: false` rather than failing.

### 5.5 One mounted viewport (`renderer-mount.ts`)

```ts
interface RendererMountProps {
  modelDriverId?: ModelDriverId
  mountId: string // this mount's identity; a per-mount service is addressed by it
  stateScope: string // host-minted opaque *sharing* key (5.6); not a mount identity
  paused: boolean // required: the host decided it before mounting
  visible: boolean
  reducedMotion?: boolean
  qualityHint?: 'full' | 'reduced'
  viewport?: { width: number, height: number, devicePixelRatio?: number } // the drawing box
  interactionMode?: 'tactile' | 'orbit' | 'drag' | 'positioning' | 'none' // policy, not a host filter
  mouth?: { openness?: number, audioSource?: AudioBufferSourceNode } // normalized 0..1
  surface: RendererMountSurfaceKind // 'stage' | 'preview' | 'actor' | 'rehearsal'
}

interface RendererMountEmits {
  'state-change': (state: RendererMountReadinessState) => void
  'first-frame': () => void
  'context-change': (isContextValid: boolean) => void
  'disposed': () => void
  'error': (failure: ContractFailure) => void
  'hit-area-change': (change: { areaId: string, entered: boolean }) => void // edges only
  'animation-finished': (nonce: OperationNonce) => void
  'cue-rejected': (payload: { nonce, index, kind, reason }) => void
}

interface RendererMountExposed {
  captureFrame: () => Promise<ContractResult<Blob>> // required
  getHeadPose?: () => HeadPose | null
  occupiesPoint?: (point: RendererMountPoint) => boolean // "is anything drawn here"
  hitTest?: (point: RendererMountPoint) => RendererMountHitArea | null // "which region is here"
  stopAll?: () => void
  dispose?: (strategy: 'shallow' | 'deep') => void
  cues: CueSink // required
}
```

Design rules that generated this shape:

- **Three families belong on a prop:** the value the host samples every frame, the live
  host decisions about this mount, and what the host assigns to the mount itself
  (`modelDriverId`, `mountId`, `stateScope`, `surface`). Everything else a renderer pulls from
  services; discrete intents arrive as cues. A prop carries a *value* the host can restate on
  every render; a stream of *events* is a service, which is why the pointer lives in
  `RendererPointerService` and not here.
- **The host never touches a renderer's viewport.** It holds no handle to the renderer's drawing
  surface, its graphics context, its camera or its scene graph. Everything visible — the model,
  the effects, and any text or caption — is drawn by the renderer inside the box
  (`RendererMountViewport`) it was given. That rule is what removes `nativeHandle`, and what makes
  a renderer's own pointer listeners unnecessary rather than merely discouraged.
- **`exposed` returns data or tears the mount down.** Nothing that needs a target,
  an ack, a preview, or delivery to a mount the caller does not hold belongs in the
  method bag — that is a cue, and the only reason a method bag cannot replace it is
  that a method can only be called by whoever holds the mount. Nothing that hands the caller
  the renderer's viewport belongs there either, for the reason in the bullet above.
- **`occupiesPoint` and `hitTest` are different questions.** The first is about the
  viewport ("should a click reach the app behind the window; should the actor fade
  so it stops blocking what is behind it"), the second about the model ("where does
  an interaction item *AIRI* added land"). A renderer may answer either without the
  other; sensitivity (how much alpha counts) is the renderer's own policy and
  deliberately not a parameter or a host setting. Both exist in renderer code today
  and neither is reachable: `ControlStripHost.vue:1963-1973` stubs the occlusion
  read to `null` and `RendererStage.vue:166-170` answers `null` for every format
  except VRM.
- **`animation-finished` echoes the `nonce`, and there is no start/status
  counterpart.** The only renderer that ever emitted a start status sent a resolved
  `url` that no consumer could map back to a motion, and what its consumer did with
  it — wait out a motion before starting the next idle cycle — is animation
  scheduling, which belongs to the renderer that owns the mixer. (`playStatus` is
  still emitted by VRM and forwarded by `RendererStage.vue:507` with no listener.)
- **One coordinate space, one conversion, and pointer input arrives as events.**
  `RendererMountPoint` is box-relative CSS pixels, exactly
  `clientX - box.getBoundingClientRect().left`: no `devicePixelRatio` multiplication, no
  normalization into the box size, no translation into model space — the renderer does all of
  those itself. The pointer reaches a renderer only through `RendererPointerService`, which
  delivers `down`/`move`/`up`/`cancel`/`enter`/`leave`/`wheel` with `pointerId`, `button`,
  `buttons` and `modifiers`, so edges and multi-touch are expressible and a renderer has no
  reason to attach a listener of its own. A subscription names one mount, because a renderer
  mounted twice has two boxes.
- **`HeadPose` uses `null`, never `0`, for an axis a rig cannot express** (zero is a
  real rotation reading), and `modelHeightPx: number | null` rather than a
  fabricated fraction of the viewport. A renderer with no head bone at all answers `null` from
  `getHeadPose` instead of three null axes, and the host has its own fallback for a missing or
  unreasonable height.
- **There is no settings bag on the mount.** `RendererStage.vue` passes shadow/blink/idle flags,
  physics switches, mix duration and render scale as a union of per-renderer props, and an opaque
  `settings` object would have kept doing it — the same shape that gave `settings/mmd/scale` two
  writers. The renderer owns those values and reads them from `services.storage`. The camera is the
  same case at its most visible: the host writes VRM's `cameraPosition`/`cameraDistance`/`cameraFOV`
  and its look-at target today, which cannot coexist with a `ViewCue` over the same value.
- **Theme hue is the only setting where the split runs the other way.** The host owns it and a
  renderer only reads it (`services.theme`, re-tinting on `onChange`), because it is a host-wide
  appearance decision: otherwise every renderer invents its own idea of the current theme.
- **All mouth input with bounds 0..100 is normalized to 0..1.** The four renderers multiply the same
  value by 0.75, by 15, by 0.7, or divide it by 100; the conversion is the renderer's and the host
  sends one meaning.
- **Emit is a mount concern, and the set is closed.** `state-change`, `first-frame`,
  `context-change`, `disposed`, `error`, plus the two push channels (`hit-area-change`,
  `animation-finished`) and `cue-rejected`. A plugin-level lifecycle event does not exist, because the
  plugin is not what is on stage.
- **`hit-area-change` is edge-triggered, not a stream.** One message per change — entered, left — so
  moving inside one region says nothing; Live2D re-emits per pointer move today, which is the reading
  the name had to stop inviting. What only the renderer can notice is a change *it* caused: the model
  turned, so the region under a still pointer is a different one. For the region under a point right
  now, the host asks (`hitTest`), and the payload carries no coordinate because the host already has
  the pointer and a second copy could only disagree with it. `areaId` is spelled the same in both
  directions.
- **`captureFrame` is required and goes through the result envelope.** `null` would have to be read as
  failure by every caller anyway: the producer resolved `null` when it had no canvas and `toBlob`
  hands back `null` when the encode fails, so absence and breakage are one answer here — `internal`
  when the render or the encode failed, `aborted` when the mount was torn down mid-capture.
- **`stopAll` and `dispose` are separate because they answer different questions**: stop what is
  playing (pause, teardown) versus release what is held. `dispose` takes the strategy because the
  choice is the caller's, never the renderer's: only the caller knows whether it is about to mount the
  same model again (`shallow`) or is done with it (`deep`).
- **`reducedMotion` is a preference, not a load decision.** The user asked for less animation and it
  stays asked, which is why it is not folded into `qualityHint` — that one reports what the *host* is
  currently struggling with, and asks the renderer to lower quality unless the user disabled it.
- **`surface` stays a host-surface word.** Its values name where a mount sits (`stage`, `preview`,
  `actor`, `rehearsal`) and cue routing uses them, so a settings preview never animates the live
  stage — which is also why a cue with no surface is never delivered to a `preview` mount.
- **`mountId` is required and it is not `stateScope`.** Several mounts can share one scope, and several
  scopes can live on one surface, so only a per-mount identity can name one of them — for a cue
  (`target.mountId`) and for a per-mount service subscription alike.

### 5.6 State (`persistence.ts`)

```ts
interface ModelScopedState {
  stateScope: string // the whole key
  surface: RendererMountSurfaceKind // a label, not a key
  modelId: ModelId
  modelDriverId: ModelDriverId
  values: Record<string, unknown> // opaque to AIRI
  vocabulary: CapabilityVocabularySnapshot // required
  profileId: ModelProfileId // required
  revision: number
  updatedAt: number
}

interface HostStateTransferPort {
  writeSnapshot: (snapshot: ModelScopedState) => Promise<void>
  readSnapshot: (stateScope: string) => Promise<ModelScopedState | undefined>
}
```

- **A scope, not a model and not a mount.** Every mount in a scope reads and writes
  the same state; a scope outlives any particular mount; one scope is one record —
  which is why `readSnapshot` takes the scope and nothing else. The sharing policy
  (today: all mounts of a surface share one scope, each `preview` mount gets its
  own) is the host's and can change without touching the contract.
- **The name is opaque and host-minted**, under a reserved prefix, and never equal
  to a `RendererMountSurfaceKind` value, so a renderer cannot learn the policy by
  reading names.
- **The renderer is the only writer**, and every hand-over is the *complete* state —
  never a patch, a delta or a per-value negotiation, because only the renderer
  knows the shape of what it stored.
- **`vocabulary` and `profileId` are required**, because "this renderer has no
  vocabulary" and "nothing is written yet" must not be the same `undefined`: a
  prompt builder cannot act on that ambiguity. An empty `items` is how a renderer
  states the first. AIRI reads these from a **shared** scope (the live stage's
  first), never a single-mount one, so a draft the user is still trying cannot
  become what a prompt believes the model looks like.
- **Unconfirmed changes never reach the snapshot**: that is what `persistent: false`
  on a cue expresses.
- **A scope that belongs to a single mount is discarded when it unmounts.** Nothing else can read it,
  and keeping it would let a later preview inherit a draft.
- **A scope's name is stable while its state lives.** Renaming orphans the records, so the host either
  migrates them with the rename or discards them deliberately; it never leaves a renderer reading an
  empty scope and concluding that the model has no state.
- **`values` is where a renderer puts its own per-model settings** — transform, selection, morph
  overrides, and the camera for a renderer that owns one — under its own keys, which is what lets
  "reset this model's state" and "move this model's settings with the model" have a single home.
- **Only a mounted instance writes.** A settings panel edits the renderer's own store and lets the
  mount of its scope publish; if nothing is mounted, nothing writes, and the edit lands the next time
  one of that scope's mounts is up. That is also what stops two windows racing on `revision`.

### 5.7 Host services (`host-services.ts`)

Injected at activation: `modelDriverId`, `contract` (a mirror of the manifest
revision, so a renderer can branch without reaching for its own manifest), `log`,
`storage` (get/set/remove/keys — primitives only, and `keys()` is for the renderer
to enumerate *its own* namespace, not so the host can), `state`, `cues`, `audio` (the shared
`AudioContext` and a monotonic clock), `pointer` (per-mount pointer events, subscribed to by
`mountId`, and the only pointer a renderer may read), `theme` (`accentHue`, `isDark`, `onChange`),
`ui` (toast, optional confirm), `i18n`, `runtime` (`windowKind`, `debug`),
optional `bridge` (Electron IPC / webview messaging) and `diagnostics`.

The rules that make this a container rather than a grab bag:

- **Only facts that cannot change while an instance is alive are ambient.** The host owns pausing
  (window lifecycle, power throttling, a settings preview) and a renderer must never self-pause, but
  *which mount* is paused is a decision about that mount, so pause, visibility, reduced motion and
  quality are props on it (`RendererMountProps`).
- **A missing optional service is a reduction in capability, not a crash.** What the renderer cannot do
  under the resources actually in effect is answered by `rendererCapabilities()`, which the host reads
  before offering the corresponding UI. `bridge` is absent in plain web builds for exactly this reason,
  and Live2D's OS notifications move onto it.
- **A stream is a subscription here, never a prop.** `pointer` is one; a renderer keeps the last point
  it saw and moves toward it in its own frame loop, because the host has nothing to restate while the
  pointer is still.
- **Requirements the host has to satisfy before activation live in the manifest, not in prose.**
  `requirements.globalScripts` is how "the app's `index.html` happens to include a script tag" becomes
  a declaration — Live2D's Cubism Core today, and MMD's Ammo, which currently attaches itself to
  `globalThis`.
- **Storage primitives are not a schema.** Which keys exist, what shape they have, which are worth
  backing up and how an older value becomes a newer one are the driver's business; AIRI is never told,
  and a whole driver moves as one opaque bundle (`driverTransfer`).

Why services at all: every renderer in this workspace currently reaches for ambient
host state instead — `stage-ui-three` and `stage-ui-mmd` deep-import
`useAudioContext` through an undeclared relative path
(`composables/vrm/lip-sync.ts:11`, `composables/mmd/lip-sync.ts:21`); Live2D and
Spine sniff `window.location.hash` to decide whether audio may play; Live2D builds
its projection colour by reading a hidden DOM element's computed style
(`live2d/Model.vue:1526`) and calls `window.electron.ipcRenderer` for OS
notifications (`:1006`); Live2D requires a `Live2DCubismCore` global that each
app's `index.html` happens to inject, and MMD attaches Ammo to `globalThis`
(`utils/ammo.ts:39`). None of that exists for a renderer installed from outside
the monorepo.

`theme` is the one setting where ownership runs host -> renderer, deliberately: it
is a host-wide appearance decision, so it cannot move into renderer storage without
every renderer inventing its own idea of the current theme.

### 5.8 Versioning (`shared.ts`, `host-services.ts`)

`MODEL_DRIVER_CONTRACT_VERSION = { major: 0, minor: 1 }`. The host checks
`manifest.contractVersion` **when it reads the manifest**, before activation, and
refuses a plugin it cannot speak — so no service container is ever built for it,
and `ModelDriverHostServices.contract` can only ever repeat the validated value. There
is no downgrade path and no negotiated subset of the service interface.

The package exports exactly two runtime values: that constant, and
`RendererMountReadinessState`, which is a value because a renderer *produces* a
state rather than only type-checking against it:

```ts
enum RendererMountReadinessState {
  UNMOUNTED = 'unmounted',
  MOUNTING = 'mounting',
  READY_FOR_MODEL = 'ready-for-model',
  LOADING_MODEL = 'loading-model',
  MODEL_LOADED = 'model-loaded',
  MODEL_ERROR = 'model-error',
  MOUNT_ERROR = 'mount-error',
}
```

String values on purpose: readiness crosses `BroadcastChannel` and IPC and is
compared by the host, so numeric ordinals would put member order into the contract
and force a plugin the host never imports to know the numbering. All four
renderers today expose a 3-value `'pending' | 'loading' | 'mounted'` instead, and
Live2D, Spine and VRM set `mounted` in a `finally` block after a load error, so
"this model is broken" is not distinguishable from "this is fine".
---

## 6. Worked examples

### 6.1 "Load this character's avatar"

```ts
const modelToLoad = { modelId: 'display-model-abc', profileId: 'profile-default' }
const loadModelEnvelope = { cues: [modelToLoad], source: 'card', nonce: 7, at: 0, target: { surface: 'stage' } }
// renderer: state-change -> loading-model ... MODEL_LOADED
const loadModelAck = { nonce: 7, reason: [undefined], handled: true } // settled at MODEL_LOADED, not first-frame
```

### 6.2 "The ACT stream says happy"

Before: the card sync writes `emotionMappings` into two renderer stores, and each
renderer store exposes `triggerEmotion` over its own channel with its own return
shape (`boolean` for Live2D, `void` elsewhere), so the caller cannot tell "played"
from "I have no such expression".

After:

```ts
const envelope = { cues: [{ kind: 'ACT', actToken: 'happy' }], source: 'agent' }
```

The renderer projects `happy` onto what it actually plays. AIRI stores no mapping.

### 6.3 "Try on an outfit, then keep it"

```ts
const tryOutfitEnvelope = { cues: [{ kind: 'profile', profileId: 'p-outfit-2' }], persistent: false } // try-on
const commitOutfitEnvelope = { cues: [{ kind: 'profile', profileId: 'p-outfit-2' }] } // commit
```

The renderer never persists the first, and the snapshot revision never moves.

### 6.4 "The user hits the camera-cycle button"

Before: the control strip toggles `useModelStore().interactionMode` — a *VRM*
store field that `RendererStage.vue:547` then passes to MMD as
`:interaction-mode`, so a VRM default (`'tactile'`) silently disables MMD's wheel
handler and its orbit mode.

After: the host sets the `interactionMode` prop on the addressed mount, and a
camera move is a `ViewCue` carrying a `pointOfInterestId` the renderer enumerated
at runtime. The host never writes camera position/distance/FOV again.

---

## 7. Rejected alternatives

| Alternative                                                                                                               | Why not                                                                                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the format enum; add `mmd`/`vrm` branches as needed                                                                  | The branch count is the problem, not any one branch. A third-party renderer can never be added.                                                                                                                                                                          |
| An opaque `settings` bag prop per renderer                                                                                | It keeps the host as a *second writer* of renderer-owned values — the failure that already produced two writers on `settings/mmd/scale`. Renderer settings come from `services.storage`.                                                                                 |
| Capabilities as one optional-fields object (`features?`)                                                                  | Optionality makes "I do not implement this" and "I forgot to say" the same answer, and several optional members (`profiles`, `panels`, `deactivate`, `stopAll`, `dispose`) had no way to be declared at all. Hence one all-required shape answered twice (hint + probe). |
| `Partial<ModelDriverCapabilities>`                                                                                        | A missing field becomes a silent denial at every use site, with a null-coercion in front of each member.                                                                                                                                                                 |
| Per-value persistence declarations (an earlier `PersistenceOwner` / `PersistedValueKind` / per-value conflict resolution) | A declaration of a renderer's storage is a report of its internals, and it rots the moment the renderer changes. Replaced by primitives plus one complete-state snapshot per scope.                                                                                      |
| Cues with sequencing (`then`, dependency lists, priorities)                                                               | Only one order is genuinely required (`load` first, because everything else presupposes a model). Anything more asks the host to reason about opaque intent.                                                                                                             |
| A `reload` cue                                                                                                            | It was `load` with the model left out, which made "re-mount what you already have" a special case the host had to implement alone. A renderer sends `LoadCue` addressed at its own `modelId`.                                                                            |
| Leaving the in-canvas speech bubble as a host-drawn overlay behind an escape hatch                                        | It is the arrangement that made a host component import a renderer composable and hand it the renderer's own graphics objects. Text became a cue (`CaptionCue`) and the renderer draws it, so the hatch went away with it.                                               |
| Forcing all four renderers to support mouth, gaze, camera and hit test                                                    | The differences are real (Live2D has no camera; VRM has no hit regions). Declaring them costs less than pretending.                                                                                                                                                      |
| Deleting `ModelDriverManifest.capabilities` and keeping only the probe                                                    | Then a loader, a picker or a settings page would have to *execute* a renderer to know anything about it — which is what "can be disabled without shipping its code" forbids. The hint is kept and explicitly marked as a hint.                                           |

---

## 8. Migration and rollout

The contract is additive: nothing in the app changes until a renderer is migrated.
Recommended order, cheapest first, each step shippable on its own:

| Step | Work                                                                                                                                                                                                                                                                         | Why this order                                                                                                                                                                                                                        |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Land the contract package (no integration)                                                                                                                                                                                                                                   | Reviewable without behavior risk.                                                                                                                                                                                                     |
| 1    | Host scaffolding: `stateScope` minting, one cue bus (in-process + `BroadcastChannel`) replacing the five renderer channels, `services.storage` primitives, the snapshot record, manifest validation, `HostNamedModelRecord`/`HostModelProfileRecord`, `profileId` minting | Everything else depends on it; it can be tested against a stub renderer.                                                                                                                                                              |
| 2    | **Spine** behind the contract                                                                                                                                                                                                                                                | Smallest surface: variants/skins are already `selection`-shaped, no camera, no lip sync, no blink. Proves mount + cue + panel with the least churn.                                                                                   |
| 3    | **MMD**                                                                                                                                                                                                                                                                      | Exposes the settings-ownership failure modes cheaply (`scale`, `rotationY` vs `modelRotationY`, six inert camera keys, the unread `modelOffset`/`modelRotationY` pair).                                                               |
| 4    | **Live2D**                                                                                                                                                                                                                                                                   | Exercises `parameter`, `mesh`, `expression`, a scripting VM, hit areas and the capability model; also the first renderer whose mouse-focus and in-canvas caption paths have to be rebuilt on the pointer service and the caption cue. |
| 5    | **VRM**                                                                                                                                                                                                                                                                      | Most entangled: host-written camera with two writers, a third writer in the positioning store, mesh visibility, auras, emotion mappings, custom VRMA blobs. Last on purpose.                                                          |
| 6    | Delete what the contract replaces                                                                                                                                                                                                                                            | See the list below.                                                                                                                                                                                                                   |
| 7    | Plugin packaging, enable/disable, probe, license/globals requirements, transfer bundles (incl. cloud sync)                                                                                                                                                                   | Turns "runs behind the contract" into "can live outside the monorepo".                                                                                                                                                                |

Host-side state to move into renderer storage during steps 2-5 (99 literal keys
today, of which these are load-bearing): camera position/distance/FOV/look-at,
follow speed, eye height, model origin/offset/scale/rotation, render scale, physics
switches, idle-cycle and blink flags, `activeExpressions`, `availableExpressions`,
`emotionMappings`, favourites, `morph-overrides`, material opacity/glow, light and
skybox values, `available-motions` / `current-motion` / `motion-map`, Spine
skins/variants/animations, MMD custom and deleted motions, and Live2D's
`settings/live2d/parameters` + `disable-focus` + `follow-speed`.

Host code that becomes dead and should be deleted in step 6 (each verified to have
no remaining consumer once the renderer owns the concern):

- the `playStatus` chain (`VRMModel.vue`, `ThreeScene.vue`, `RendererStage.vue:507`)
  — its single consumer went away with the actor-window split, and the emit carries
  a resolved `url`;
- host-side capability parsing, including Spine's hardcoded binary candidate tables
  and MMD's 30-morph truncation, plus `sync-engine.ts`'s field-wise capability
  merge;
- per-format validation/repair and preview generation in `display-models.ts`,
  including the `<id>-textures` localforage companion convention;
- `DisplayModel` capability fields (`expressionCapabilities`,
  `motionCapabilities`, `vfxMappings`, `outfits`, the legacy `emotionMappings`
  key) and the card's `cueAllowlist` / `compiledWhitelist`;
- `applyOutfit` / `AiriOutfit` on the card -> profiles;
- the five `airi-stores-*` channels and the per-renderer `triggerEmotion` /
  `triggerMotion` / `triggerVfx` / `playOneShotAction` / `selectVariantAndSkin` /
  `previewExpression` / `resetState` entry points;
- `settings/mmd/render-scale`'s second writer and the `rotationY`/`modelRotationY`
  duplicate;
- the two stubbed call sites that never had an implementation
  (`ControlStripHost.vue:1963-1973`) once the real ones exist.

Because the tree is developed directly on `main`, the rollout above is expressed as
an ordered set of reviewable steps rather than one change: each renderer migration
touches one renderer package, the host scaffolding, and the deletion list for that
renderer only.

---

## 9. Known gaps — what the contract cannot express yet

These are open. They are listed here rather than papered over, each with the
closest existing concept, because they are the part of this RFC most worth
attacking. Every one was found by reading the four implementations.

### 9.1 Gestures, multi-touch and pointer edges — **resolved**

**Resolved:** pointer input is a **service**, not a prop. `RendererPointerService` (5.7) delivers
`down`, `move`, `up`, `cancel`, `enter`, `leave` and `wheel` to one named mount, each event carrying
`pointerId`, `pointerType`, `button`, `buttons`, `wheel` and `modifiers` in `RendererMountPoint`
space, so press/release edges, wheels and multi-touch are expressible and a renderer has a reason not
to attach a listener of its own. `mountId` is what a subscription names, and it is also what a cue
addresses when one surface holds several mounts. The problem it replaced is kept below as the record
of why the contract changed shape here.

`RendererMountProps.focusAt` carried a position and nothing else. There was no
pointer id, no button state, no `pointerdown`/`pointerup` edge, no wheel delta and
no second touch point — yet all four renderers implement drag, pinch and wheel
themselves (2.7), each with its own coordinate conversion. Live2D's
`handlePointerDown/Move/Up` implement press-drag and two-finger pinch and emit
`offsetChange`/`scaleChange` back to the host
(`components/scenes/Live2D.vue:130-214`); Spine's gesture engine binds four canvas
listeners and four window listeners and runs a spring-damper on the pulled bone
(`gesture-interaction.ts:378-472`); VRM reads `useMouse()` and window mouse events
and owns an `OrbitControls` instance.

The contract currently *says* the renderer must not bind its own DOM listeners
while giving it no way to obey, and `interactionMode` is a policy string with no
corresponding input channel. Options:

- **(a)** widen the pointer into a host-sampled pointer state (`{ point, buttons,
  pointerId, delta, wheelDelta }`) plus discrete edge events (`pointerdown`,
  `pointerup`, `gesture`) — the edges are discrete and ackable, so they could be
  cue-shaped, but they are also gesture-frequency and would need a
  fire-and-forget variant;
- **(b)** keep listeners renderer-side and drop the "host owns the pointer" rule for
  gestures, keeping it only for hover/`focusAt`;
- **(c)** give the renderer a host-provided interaction surface it subscribes to.

**Chosen: (a), as a subscription rather than a prop** — pointer events are a stream, and `focusAt`
was a value. Taking it as a service resolves the contradiction instead of documenting it: a renderer
now has a channel for everything it used to bind listeners for, so "do not attach your own" is a
rule it can obey.

### 9.2 The draft's own note about pointer producers — **corrected**

`shared.ts` claims every existing producer already reads the pointer as
canvas-relative ("Live2D's mouse-focus plugin normalizes against the canvas' own
width and height itself"). It does not: the host hands Live2D **window-relative**
CSS px (`apps/stage-web/src/pages/index.vue:246-249` uses `useMouse()`;
`apps/stage-tamagotchi/.../stores/window.ts:12` uses `useElectronRelativeMouse`),
and the renderer then divides by `props.width/height`
(`motion-manager.ts:287-299`) — so it is only correct while the canvas fills the
window. VRM's `useMouse()` raycast has the same shape
(`VRMModel.vue:515-516`). The claim must be corrected before migration, and the
host must subtract the canvas rect exactly once (which is what the contract's
`RendererMountPoint` wants).

**Resolved:** the note is rewritten. `RendererMountPoint` is now defined as box-relative CSS pixels
with the conversion performed once host-side, the note names all three wrong conventions as migration
inputs, and the evidence above stays as the reason the space needed one definition.

### 9.3 Live observation of renderer state

The only signals a renderer sends are lifecycle, `hit-area-change`,
`animation-finished` and `cue-rejected`. There is no way to ask "what is playing
right now" or to be told when the *renderer itself* changed state (its idle cycle,
its DSL VM, another window's cue). The host reads renderer stores for exactly this
today (`ControlStrip.vue:945-1144`, `ModelCustomizer.vue:361,430,441`), and the
per-model snapshot does not substitute: it is persist-shaped (revision-guarded,
complete-state), AIRI reads only `vocabulary` and `profileId` from it, and
`persistent: false` previews are deliberately excluded — so a preview mount's
current state is unobservable by design.

Options: an observation emit (`selection-changed` carrying capability keys), a
renderer-originated cue kind (`CueSource` already includes `'renderer'`), or a
read-only `activeSelection()` member on the mount. **Not settled.**

### 9.4 Text and captions, and any host UI drawn inside the renderer's canvas — **resolved**

**Resolved:** text and captions belong entirely to the renderer. `CaptionCue` carries the utterance,
its sentence split with timing, an `utteranceId` so a growing utterance keeps one highlight rather
than restarting, and `elapsedMs` so a cue arriving mid-sentence starts where playback is; it never
carries a position, font or colour. A renderer that cannot draw text leaves `'caption'` out of its
declared cues and refuses the transaction, and `ResetCue` with `scope: 'caption'` takes it down.
`nativeHandle` is deleted, because the host no longer draws inside a renderer's canvas at all. The
problem it replaced is kept below.

Live2D draws a head-tethered comic bubble *inside its own WebGL canvas*, today by
the host importing a renderer composable and handing it the Pixi app (2.3), and the
renderer itself also posts caption segments to the host's caption channel from
inside its motion-start handler (`live2d/Model.vue:988-998`). The bubble needs
text, sentence-sync timing, paragraph sentiment and its own theme — none of which
has a channel: not a prop (it is not sampled per frame), not a service (it is not a
fact), and no cue kind carries content. `nativeHandle` is an escape hatch for
*reaching* the canvas, not for *feeding* it, and `mouth.openness` is the only
speech-adjacent value in the contract.

This also blocks the reverse direction: a host overlay cannot be placed inside the
renderer's canvas except through `nativeHandle` plus a private coordinate
convention.

Options: a renderer-declared "in-canvas overlay" capability with a host-provided
text/segment service; a `caption`/`speech` cue family; or a ruling that in-canvas
overlays are renderer-owned UI driven by an injected service.

**Chosen: the cue family, with fully renderer-owned presentation.** The cue carries content and
timing only, and the host's own in-canvas bubble (a host component importing a renderer composable)
is deleted rather than generalized. What stays open is only the *progress* question — a renderer
that receives the first cue mid-sentence needs a starting offset, which is what `elapsedMs` is for;
whether that is enough for word-level sync in every renderer is a migration question, not a contract
gap.

### 9.5 Renderer->host interaction round-trips (menus, choices, notifications)

Live2D's DSL can present a choice tree and suspend its chain until one is selected,
and the round-trip travels on its own channel (`live2d-dsl-bridge`: `dsl-choices
{ requestId, text, choices[] }`, `dsl-choice-selected { requestId, choiceIndex }`,
`dsl-intimacy-changed`). `RendererMountEmits` is a closed set with no way to say
"the renderer is asking the user something", and `CueChannel.subscribe` is
explicitly for observers rather than for a request/response pair. The same renderer
also raises OS notifications through `window.electron.ipcRenderer`
(`live2d/Model.vue:1006`), which `services.bridge` can carry but which nothing
declares as an intent.

Options: a host-service request/response port for renderer-initiated prompts, or a
cue kind whose ack carries the answer. **Not settled.**

### 9.6 View pushback (the renderer telling the host where the model ended up)

Live2D emits `scaleChange` / `offsetChange`, MMD emits the same two
(`MMD.vue:241,274`), and VRM's `OrbitControls` writes `cameraPosition` /
`cameraDistance` back into a store. The contract has no renderer->host view
channel: `ViewCue` and `ResetCue` with `scope: view` are host->renderer only. That
is arguably correct once the renderer owns its camera and its own transform — but
the host currently owns a *third* copy of position/scale in
`settings/positioning/models`, and every drag round-trips through it (the renderer
emits, the host stores, the host passes it back as `xOffset`/`yOffset`/`scale`).
The migration has to decide which copy dies. **Not settled.**

### 9.7 Addressing one of several mounts on the same surface — **resolved**

**Resolved:** `RendererMountProps.mountId` is the mount's own host-minted identity, and
`CueEnvelope.target.mountId` addresses it. `stateScope` was the wrong key for this and stays the
*sharing* key: several mounts can share one scope, so a scope cannot name one of them. The same
`mountId` is what a `RendererPointerService` subscription names, because a per-mount service has the
same problem as a per-mount cue.

### 9.8 Addressing ambiguity between `expression`, `morph` and `mesh`

`ModelCapabilityKind` distinguishes `expression` from `morph`, but
`ExpressionCue` does not say which kind its `key` addresses; and `mesh` is
reachable both through `MeshCue` (`value: boolean`) and through
`SelectionCue{ capabilityKind: 'mesh', value?: number | boolean }` — two ways to
say one thing, with two value shapes. Two ways to say one thing is what this
contract exists to remove. Options: one addressing cue per capability kind, or an
explicit `capabilityKind` on the addressing cue, and then dropping the duplicate.
**Needs a ruling.**

### 9.9 Nothing enumerates a point of interest yet

`ViewCue` requires a `'pointOfInterest'` descriptor from
`modelCapabilities(modelId)`, and no renderer produces one (2.6). This is a
migration item rather than a contract defect, but it means the first renderer to
declare `'view'` also has to invent the enumeration — and the natural candidates
already exist and are unexposed: Spine's resolved head bone
(`spine/Model.vue:1138-1142`), VRM's and MMD's ten-name socket tables
(`VrmSocketResolver.getAvailableSockets()`,
`MmdSocketResolver.MMD_BONE_DICTIONARY`), and Live2D's hit-area names (read once
for a console log, `live2d/Model.vue:760-761`). **Open.**

### 9.10 Timeline, visemes and scheduled performance

The cue model is transactional with no sequencing, by design. The unwired
`stage-ui-three-performance-runtime` (2.8) wants a *timeline*: `speech`, `viseme`,
`expression`, `body` and `marker` events at millisecond offsets, plus a playhead.
`mouth.openness` is a single scalar, there is no viseme vocabulary, and
`animation-finished` is one-shot. Both Live2D and MMD already blend five to six
visemes internally with attack/release constants of their own, so the current shape
is "the host sends one number, the renderer invents the mouths". Whether
performance timing belongs to AIRI (scheduling cues from a timeline, one at a
time) or to the renderer (given a timeline, drives itself) is a design question
this RFC does not answer. **Not settled.**

### 9.11 Continuous pose streams and exclusive-owner leases

Live2D has two host->renderer streams that are *not* representable today: a
motion-control spring (`live2d-motion-control-set/release`,
`live2d-breath-control-set/release`) carrying a continuous pose, and an
exclusive-claim protocol (`...-claim-exclusive` / `...-release-exclusive`) that
lets one producer own the avatar's body. Both travel as discrete
`BroadcastChannel` messages, which is exactly the case the contract forbids for a
per-frame stream (`cues.ts`), and there is no prop for a pose. A lease is not a
stream either: it is a discrete, ackable intent that needs a *holder* concept.
**Not settled**; the closest existing concept is `RendererMountProps`, which has no
pose member.

### 9.12 Audio output, beat/tempo, and the scripting VM's verb set

The Live2D DSL has eight verbs and a VarFloat/intimacy/time-limit instruction set
(`packages/live2d-runtime/src/dsl/command-parser.ts:55-99`,
`interpreter.ts`), and several have no home in the contract:

| Verb / fact                                 | Closest concept                | Missing                                                                                                                                                                            |
| :------------------------------------------ | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_mtn Group#lane:item`                 | `MotionCue.key`                | lane and item sub-selection (deliberately excluded from the cue)                                                                                                                   |
| `stop_sound <channel>`                      | none                           | the contract has **no audio-output cue**; `HostAudioInterface` is only `getContext`/`now`                                                                                          |
| `replace_tex <i> <file>`                    | `MeshCue` / `SelectionCue`     | texture-index addressing                                                                                                                                                           |
| `motions enable/disable <group>`            | `ResetCue` motion scope        | a per-group pool gate                                                                                                                                                              |
| `Intimacy` bonus plus `Min`/`Max` gates     | none                           | a persistent per-model scalar (it lives in renderer storage and today leaks to the host over `dsl-intimacy-changed`, where a dating-sim store folds `delta` into its own variable) |
| beat styling (`punchy-v`, `sway-sine`, ...) | `HostAudioInterface.now()`     | a host-published beat/tempo signal; `now()` is a clock, not an event, and the renderer today consumes a `beat-sync` host signal with no contract channel                           |

Whether any of this belongs in the contract or entirely inside a renderer panel is
open, but the intimacy scalar is the one with a host consumer today. **Not
settled.**

### 9.13 Re-import, repair and payload replacement

`ModelProbeInput.modelId` is minted by AIRI *before* the import, and nothing states
what an import under an id that already exists means. Today the host repairs Live2D
multi-model zips by splitting and re-importing parts, which replaces an existing
model's payload rather than creating a new model. **Open.**

### 9.14 Load progress

`RendererMountReadinessState.LOADING_MODEL` is a single state; a multi-second VRM
or Live2D load reports no progress (VRM even emits a `loadingProgress` number that
nothing consumes). `first-frame` only ends it. Probably non-blocking — the host can
show an indeterminate indicator — listed for completeness. **Open, low priority.**

### 9.15 Cancel/abort as a cue

If a cancel member is ever added, one question returns: may it jump the host's FIFO
queue? A cancel is a statement *about* a transaction rather than a precondition of
its siblings, so "cancel first" would be the one genuine priority anyone has asked
for — and admitting it reopens "then why not motion before expression". No such member
exists yet. **Open.**

---

## 10. Validation

The contract package is types only, so the checks are mechanical:

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck   # tsc --noEmit; there is no runtime to test
```

Plus two greps that should stay empty as the contract is edited: no format strings
(`vrm|live2d|spine|mmd`) outside comments, and no runtime export beyond the two in
5.8. Integration steps validate per renderer with that renderer's workspace
typecheck (`pnpm -F @proj-airi/stage-ui-<format> typecheck`) plus a runtime smoke
test: load, cue round-trip, preview generation, capture, hit test, head pose.

---

## Appendix A — what the four implementations do today

Recorded so reviewers can judge how much of section 5 is shape and how much is one
tree's accident.

| aspect                 | Live2D                          | VRM                                                                                       | Spine                                         | MMD                                           |
| :--------------------- | :------------------------------ | :---------------------------------------------------------------------------------------- | :-------------------------------------------- | :-------------------------------------------- |
| camera                 | none (2D transform)             | renderer-local `PerspectiveCamera`, but four host-written keys plus `scale`/`modelOffset` | none (skeleton transform)                     | owns + auto-frames; six camera keys are inert |
| lip sync               | `openness` 0..100               | `openness` 0..1 x0.75, or an `AudioBufferSourceNode` via wLipSync                         | boolean edge from `openness`, bone offset x15 | wLipSync wired, never fed                     |
| gaze                   | `focusAt` (window space)        | `useMouse()` (viewport space)                                                             | none                                          | cursor position                               |
| head pose              | missing                         | yes                                                                                       | yes (`yaw`/`pitch` = 0)                       | yes                                           |
| capture                | `Blob \| null`                  | `Blob \| null`                                                                            | `Blob \| null`                                | yes                                           |
| occlusion              | none                            | offscreen render target (call site stubbed)                                               | none                                          | none                                          |
| native hit test        | native `hitTest`, internal only | none                                                                                      | parsed, never surfaced                        | none                                          |
| expressions            | `exp3.json` + blend modes       | runtime expression manager + unlocked morphs                                              | skins/variants                                | morphs (host truncates to 30)                 |
| motions                | group + index, DSL groups       | named `.vrma` clips + user blobs                                                          | named animations, variants                    | VMD + custom motions                          |
| capability discovery   | from the package                | after load only                                                                           | from the package                              | from the runtime                              |
| renderer settings keys | 11                              | 37                                                                                        | 12                                            | 39                                            |
| pointer listeners      | template (5) + canvas (2)       | `useMouse` + window (4) + OrbitControls                                                   | canvas (4) + window (4)                       | template (5)                                  |
| readiness              | 3-value, `mounted` after error  | 3-value                                                                                   | 3-value, `mounted` after error                | 3-value, `pending` after error                |

## Appendix B — package layout

| File                | Owner    | Content                                                           |
| :------------------ | :------- | :---------------------------------------------------------------- |
| `shared.ts`         | both     | ids, result envelope, failure codes, readiness, geometry          |
| `manifest.ts`       | driver   | identity, capability hint, requirements, entry points             |
| `provider.ts`       | driver   | the model catalogue and every operation on a model                |
| `capabilities.ts`   | driver   | capability kinds, descriptors, the vocabulary snapshot AIRI reads |
| `cues.ts`           | both     | the transaction vocabulary and the ack shape                      |
| `renderer-mount.ts` | renderer | one mounted viewport: props, emits, exposed                       |
| `host-services.ts`  | AIRI     | the service container injected at activation                      |
| `persistence.ts`    | both     | the one model-scoped state channel, partitioned by `stateScope`   |
| `lifecycle.ts`      | both     | activation, the runtime object, the host registry                 |
| `renderer.ts`       | driver   | panels, and the opaque bundle that moves a whole driver           |
| `references.ts`     | AIRI     | every record AIRI itself keeps                                    |
| `model.ts`          | AIRI     | the two identities AIRI mints                                     |
