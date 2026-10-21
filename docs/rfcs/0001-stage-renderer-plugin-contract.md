# RFC 0001 — Stage Model Driver Contract

| Field                    | Value                                                                                                                          |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| Status                   | **Draft, for upstream review — revision 0.2 (2026-10-21)**                                                                     |
| Package                  | `@proj-airi/stage-renderer-sdk` (new, contract-only)                                                                           |
| Vocabulary               | a **model driver** is the plugin; a *renderer* is what that driver directly drives (§4)                                        |
| Area                     | `packages/stage-ui`, `packages/stage-ui-three`, `packages/stage-ui-live2d`, `packages/stage-ui-spine`, `packages/stage-ui-mmd` |
| Supersedes               | the implicit arrangement "each avatar format is a scene component the host statically imports"                                 |
| Reference implementation | the `stage-renderer-sdk` package in this fork: 12 contract files, `tsc --noEmit` clean, **no integration yet**                  |

> This RFC is written to be reviewed on its own. Section 2 is evidence from the
> current tree, section 5 is the proposed contract, and section 9 lists every gap
> the contract could not express together with its current status — most are closed
> by a ruling, and the ones that remain open are the part most worth arguing about.
>
> **Revision 0.2 (2026-10-20) locks the multi-window decisions:** the host keeps a
> mount registry and cue broker in the Electron main process; capture is a cue, not an
> exposed method; lip sync is a plugin-level analyzer capability, not a renderer
> contract member; imports are two-phase (parts, then AIRI-minted selections) and reject
> an existing id unless the caller explicitly overwrites; cue acks are settled
> `resolved`/`rejected` outcomes rather than a parallel `reason` array; IPC uses
> `@moeru/eventa`. Sections 5.2, 5.4, 5.5, 5.7, 5.8, 8 and 9.12/9.13 reflect this revision.
>
> **Revision 0.2 follow-up (2026-10-21):** imports carry one `files` set (no `file`/companion
> split) and AIRI imports models only; `saveProfile` needs no mount; actor/chat share one semantic
> `stateScope` (preview is the only private scope); the control strip picker is a driver panel;
> head-tethered captions are driver-rendered when the driver declares `caption` and `HeadPose` is
> removed; storage namespace isolation is AIRI-side; cue targets may name a `stateScope`, but the
> first broker is single-mount and fan-out is deferred.
> This release is **first-party only**; the static manifest is read before the runtime, and the
> main-process registry holds manifest/enable state only — real capabilities come from a renderer
> instance.

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
`Renderer*` prefix: `RendererMount*`, `RendererPointerService`.

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
| occlusion query | none queried (WebGL alpha read works)                 | offscreen render target (call site stubbed) | none                              | none                |
| native hit test | native `hitTest` used internally, not exposed         | none                                        | parsed, never surfaced            | none                |
| readiness       | 3-value enum, `finally` sets `mounted` after an error | same                                        | same                              | resets to `pending` |

None of it is declared anywhere: it is discovered by reading four implementations.
Three of the divergences are load-bearing for this RFC:

- **The mouth row is why there is no mouth prop.** Four renderers scale the same number four
  different ways — by 0.75, by 15 as a boolean edge, by 0.7, or by dividing by 100 — so a single
  normalized scalar was a fifth opinion rather than a shared meaning. The renderer taps the speech
  stream and measures it itself (5.7).

- **Head pose is no longer a contract concept.** The three producers returned
  `{screenX, screenY, yaw, pitch, roll, modelHeightPx}` in slightly different shapes, and the
  proposed `HeadPose` would have had to reconcile them. The decision instead moves head-tethered
  caption rendering into a driver that declares `caption`: `CaptionCue` carries the text and
  timing, that driver owns the presentation, and AIRI never asks for a head position. The host may still add its own overlay
  layers outside the renderer's canvas; those layers do not depend on a driver pose.
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

### 2.8 An unwired performance runtime sketch

`packages/stage-ui-three-performance-runtime` (currently imported by nothing)
defines a `PerformanceTimeline` of `speech | viseme | expression | body | marker`
events with millisecond timestamps and an `ActorState` blackboard
(`speech.playheadMs`, `gaze.type: 'screen' | 'world'`, `markers`, `flags`). That is
a *scheduled* model of performance, and the cue model in section 5.4 deliberately
has no timeline. 9.10 records it and **closes** it: nothing implements a scheduler,
so a timeline is a future proposal rather than a gap this contract must express.

It is a sketch, not an implementation: `SchedulerHandlers` is a type nothing invokes, no code
advances `playheadMs`, and there is no clock, no player and no adapter — 210 lines total, being
event/timeline types plus one Pinia store. Upstream deleted the package whole in #1194 ("vrm
performance tracing and better lifecycle management"); this fork re-added it verbatim in a
rebase-restore commit, which is why it is back with nothing importing it. Its value is the data
model, not the code.

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
- **No scripting language and no VM.** A script that sequences motions, expressions and outfit
  changes is character content: it belongs to the card, AIRI interprets it, and what reaches a driver
  is the action it can already perform (a cue). The contract carries the actions, never the script
  that picks them — which also means a model bundle is not a place to author behaviour.

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
| User input      | AIRI         | Cursor, cues, ACT tokens, plugin-level speech frames, etc.                         |
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
  requirements: ModelDriverRequirements // webgl/wasm/opfs/worker/audioContext/dom/globals/storage
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
  migrate?: (hostState: ModelDriverMigrationInput) => MaybePromise<ContractResult<ModelDriverMigrationReport>> // 5.9
}
```

**Why activation exists at all.** Today a renderer is "whatever the host statically imported": there is
no activation step, no way to be disabled, no place to report "I am running degraded", and no agreed
teardown semantics. No renderer in this workspace handles `webglcontextlost`, Live2D and Spine force
`window.location.reload()` on HMR dispose, and VRM needs a deep/shallow dispose distinction the host
cannot express. Activating explicitly, reporting requirements and declaring a dispose strategy turn all
of that into contract instead of folklore. Activation itself MUST NOT mount anything: it wires services,
checks requirements (globals, WASM, OPFS) and reports degradations.

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

This registry is **renderer-side**: `get()` returns a live `ModelDriverRuntime`. The main process keeps
a separate manifest/enable registry, whose information is no richer than the static manifest; it never
holds a runtime and never answers `rendererCapabilities()`.

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
`ModelDriverPanelDeclaration.hostSurfaces` (`settings`/`popover`/`inline`) lets a driver contribute
the control strip's expression/motion/wardrobe picker; the host supplies only the popover shell and
anchor, and a driver that does not declare `popover` is simply not offered there. Absent means
`settings` only, so a settings panel is never pushed into the strip by default.

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
`confidence`; AIRI never carries the bytes. `probe` is **read-only** and is handed
only the payload: it answers with `parts: ModelImportPart[]` — one entry per model the
input expands to, each with a name and display metadata. The user selects which parts
to import; AIRI then mints a `modelId` (and optional default `profileId`) for each
selected part and calls `confirmImport({ selections })`. The renderer must persist
under exactly those ids and must not invent one. Declining unified import is expressed
by omitting `probe`, not by failing: `unsupported-input` is a real error, so a probe
that returns it is a broken probe rather than a verdict on whose input it was. A
renderer that cannot read a particular input reports that as a *successful* probe with
low `confidence` and `blockingFindings`, and the user may still overrule it with
`force`.

**A duplicate id is a conflict, not an upsert.** `confirmImport` answers
`MODEL_ID_CONFLICT` when `(modelDriverId, modelId)` already exists. Only an explicit
user "replace this model" action, or a migration carrying a `migration` marker, may set
`overwrite: true`; the import path that a user reaches by dropping a file never does.
The overwrite keeps the model's profiles and settings unless `resetProfiles` is also
set, and writes the new payload atomically so a crash cannot leave a half-replaced model.

**All files of a model are one import.** A model file and the textures its materials reference are
one thing: no id, no second storage entry, never listed. AIRI has no companion category at all —
they arrive in the same `files` array and the driver resolves which file is which. This deletes the
host's `<modelId>-textures` convention, which today has to be excluded from enumeration, remembered
at two delete sites, re-fetched before preview regeneration, and uploaded as a second cloud payload
per model. MMD's `textureMap` prop is the same case in the mount contract: a texture set is required
to use the model at all, so the renderer keeps it as part of the model's own storage and resolves
its own relative texture paths. It must not become a prop.

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
`probe` is the only place the input is ever handed over. It returns **all** parts in one answer — a
single-model package has exactly one — and `confirmImport` receives the user's selection with the ids
AIRI minted, not the original bytes again.

**`files` is one set, with no companion field.** A model and the textures it references arrive
together; `files.length === 1` is the single-file case. AIRI cannot know which file a driver treats
as the model and which as an attachment, so it does not try. That also fixes the boundary: AIRI
imports **models only**. Motions, VRMA, presets, replacement textures and every other non-model
asset are imported through the driver's own panel or bridge, never through `probe`/
`confirmImport`; AIRI mints no id for them and does not enumerate them.

**A registered driver is enough to save a profile.** `saveProfile` does not require a mounted
instance: the driver saves the state it last persisted, so migration can create profile bodies
before the first mount.

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
  purge: boolean
  migration: boolean
  cues: Exclude<CueKind, CueKind.LOAD>[]
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
  model, or memory pressure). Whoever holds the probe uses the probe; a *failed*
  probe means "could not determine", so the hint stays a usable fallback rather
  than a verdict that the renderer is useless.

`'caption'` is an **optional** entry in `cues`: a driver that can show text, including head-tethered
presentation, declares it and owns that rendering; one that cannot omits it and the host does not
send the cue. Omission is a supported answer. Whether AIRI draws its own host overlay fallback is a
host decision outside this contract — permitted, not required, and not allowed to depend on a driver
`HeadPose`. Sending a caption to a driver that did not declare it is `unsupported-cue`.

`profiles` is one field for all three profile members (`listProfiles`, `saveProfile`, `removeProfile`)
because they are one ability: a renderer that can list a profile can store it. `saveProfile` itself
needs only a registered driver, not a live mount. AIRI needs the answer to
know whether its own profile records can have bodies behind them at all. `driverTransfer` is what makes
a driver movable: without it, a device restore brings back AIRI's own records and leaves the driver
empty, so the host can say so *before* a backup instead of after a restore. `migration` is the same
kind of answer for the one-time handover of pre-contract settings (5.9): without it those settings have
nowhere to go, so the host says so once and drops them. `purge` is what makes "delete all data" and
uninstall complete: the host cannot enumerate a driver's storage, so the driver must delete its own
bytes (models, profiles, per-model state and settings), and the host clears its catalogue records only
after that succeeds.

It is **not** `Partial<...>`: a missing field would have to be read as `false` at
every use site, which turns "I did not say" into a silent denial and puts a
null-coercion in front of every member. A renderer that cannot do something says
`false`; one that forgot to say is a plugin the loader can reject.

The kinds a model can be enumerated in:

```ts
type ModelCapabilityKind
  = | 'expression' | 'motion'
    | 'outfitStyle' | 'outfitGroup' | 'altModel'
    | 'parameter' | 'mesh' | 'vfx'
    | 'pointOfInterest' // a place the renderer can put its camera (5.4)
```

There is no `morph` kind. A vertex morph, a blend shape and a parameter preset are one thing to a
caller — one addressable expression unit — and a format that has only the geometry level (MMD)
still offers expression units, so it declares them as `'expression'`. What is behind the unit, and
which native name a token resolves onto, is the driver's own mapping (9.8).

`capabilityDiscovery` records a real difference rather than a preference: Live2D
and Spine can be enumerated from the package bytes, VRM only after the model is
loaded and the expression manager exists, and a renderer with no capability model
says `none`. `'none'` and declaring the `'view'` cue contradict each other, and so
does `'pointOfInterest'` belonging to the vocabulary AIRI prompts with: points of
interest exist *only* as capability descriptors, so a renderer without a capability
model has no camera target to name, and a camera target is not a token family
(`ActTokenKind`) so it never belongs in a prompt.

A descriptor's `key` is opaque to AIRI but must stay stable across sessions. The renderer's own
records — labels, toggles, ACT mappings, profiles — point at it, and AIRI replays it as the token,
so renaming one orphans both; and because the label lives in that same record, a user renaming a
capability never moves the key. That is also why the *label* the user sees is not read back from
AIRI's side.

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
  target?: {
    modelDriverId?: ModelDriverId
    modelId?: ModelId
    mountId?: string // one mount; required by the first broker
    stateScope?: string // every mount sharing this scope; rejected until fan-out lands
    surface?: RendererMountSurfaceKind
  }
}

interface CueAck {
  nonce: OperationNonce
  mountId?: string // required on the wire: the single mount that answered
  requestId?: string // required on the broker path; a direct in-process sink may omit it
  results: CueOutcome[] // index-aligned; every slot is a settled outcome
  handled: boolean // results.every(result => result.status === 'resolved')
}

type CueOutcome = CueResolved | CueRejected

interface CueResolved {
  status: 'resolved'
  value: CueResult
}

interface CueRejected {
  status: 'rejected'
  reason: CueRejection
}

type CueResult
  = | { kind: 'capture', mime: string, data: ArrayBuffer, width: number, height: number }
    | { [K in Exclude<CueKind, 'capture'>]: { kind: K } }[Exclude<CueKind, 'capture'>]

type CueRejection
  = | 'unsupported-cue' | 'unknown-key' | 'renderer-not-ready' | 'no-model'
    | 'suppressed-by-mode' | 'superseded' | 'busy'
```

The rules that matter for review:

**A scope can be a target — in a later revision.** `target.stateScope` is the long-term way to keep
the actor window and a chat-side stage in lockstep, and `target.mountId` remains the way to address
exactly one. The first broker accepts only `mountId`; a `stateScope` target is rejected with
`INVALID_ENVELOPE` rather than silently routed to one of its mounts. Fan-out and its aggregate ack
(one slot resolved only when every target resolved it, no single `mountId`) are a follow-up, because
the settle and timeout rules for several answerers are not settled yet.

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
   results array is sized to the transaction, so one frame per cue would allocate an
   ack per frame and ask a question a stream cannot answer. That is why the pointer
   is a service: events a renderer subscribes to, not a value the host restates. The
   same rule now applies to speech: the plugin registers a **plugin-level analyzer**
   (`HostSpeechAnalyzerService`), and the host publishes low-rate frames outside the
   cue vocabulary; no `AudioNode` crosses a realm and no mouth scalar is sent as a cue.

The vocabulary (11 kinds). The kinds themselves are the *compile-time* half — AIRI ships them — while
the token a `ACT` cue carries belongs to the renderer and is known only at runtime (§4.1):

| Kind         | Payload                                                                      | Notes                                                                                 |
| :----------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| `load`       | `modelId`, `profileId?`                                                      | the only way a mount is told what to show; accepted by every renderer                 |
| `ACT`        | `actToken`                                                                   | **the renderer projects the token**; AIRI never learns the projection                 |
| `expression` | `key`, `value?` (0..1), `resetAfterMs?`                                      | direct addressing of one renderer-native unit                                         |
| `motion`     | `key`, `repeat?` (-1 forever / 1 once), `crossfadeMs?`                       | one id, whatever addressing the format uses underneath                                |
| `vfx`        | `effect`, `durationMs?`                                                      |                                                                                       |
| `profile`    | `profileId`                                                                  | **no payload**: the renderer already stored the body under that id                    |
| `gaze`       | `mode: none \| pointer \| camera \| target`, `point?`                        | sole purpose: temporarily override the live pointer the renderer follows              |
| `view`       | `pointOfInterestId`, `zoom?` (relative)                                      | moves the renderer's own camera; **declaring `view` is an ownership statement**       |
| `caption`    | `text`, `utteranceId`, `segments?`, `language?`, `elapsedMs?`                | **the renderer owns text and captions**: content only, never position, font or colour |
| `reset`      | `scope: expression \| motion \| profile \| gaze \| view \| caption \| all`   |                                                                                       |
| `capture`    | **empty payload**                                                            | **returns bytes through the ack**, not through an exposed method; the renderer captures its own canvas, chooses the encoding and reports the actual `CaptureResult`; capture must be the only cue in its envelope |

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
  `scope: view` hands framing back to the renderer's default, and `scope: transform`
  does the same for the model's own placement, which lives in the same `values` record.
- **`profile` carries no body.** What is an `AiriOutfit` on the card today — name,
  icon, mesh names, expression weights, plus `type: base | overlay` — becomes a
  renderer-stored configuration, because the composition rules are the renderer's:
  the host currently implements "an overlay toggles off when already on", "a base
  zeroes the other bases", then pokes one renderer's store to refresh. AIRI mints
  `profileId`, keeps `displayName`/`note`/`preview`, sends the cue, and cannot
  decompose it into anything smaller: no cue sets a part or a raw parameter.

Smaller choices, recorded because each one replaced a shape that drifted:

- **A raw parameter and a visible part are both out of scope.** `selection` (a `capabilityKind`
  plus a number or boolean) and `mesh` (a boolean on a glTF part) each let AIRI drive a renderer's
  internals one mechanism lower than intent, which is the reach-through this contract exists to
  end. Both are deleted: appearance is a `ProfileCue`, and a renderer that wants a calibration
  slider owns the panel that moves it.
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
  profile has no expiry, an utterance has none either, and a gaze override holds until it is released;
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
- **Eligibility is not failure.** A reference this renderer does not hold is a rejected outcome
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
  surface: RendererMountSurfaceKind // 'stage' | 'preview' | 'actor' | 'rehearsal'
}
// no mouth prop and no audio service: lip sync is a plugin-level analyzer (5.7), outside this contract

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
  occupiesPoint?: (point: RendererMountPoint) => boolean // "is anything drawn here"
  hitTest?: (point: RendererMountPoint) => RendererMountHitArea | null // "which region is here"
  stopAll?: () => void
  dispose?: (strategy: 'shallow' | 'deep') => void
  cues: CueSink // required; includes `capture`
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
  that a method can only be called by whoever holds the mount. Capture is the clearest
  case: a selfie may be triggered from the main window, which does not hold the actor
  mount, so `capture` is a cue and its bytes come back in the ack. Nothing that hands the
  caller the renderer's viewport belongs there either, for the reason in the bullet above.
- **`occupiesPoint` and `hitTest` are different questions.** The first is about the
  viewport ("should a click reach the app behind the window; should the actor fade
  so it stops blocking what is behind it"), the second about the model ("where does
  an interaction item *AIRI* added land"). A renderer may answer either without the
  other; sensitivity (how much alpha counts) is the renderer's own policy and
  deliberately not a parameter or a host setting. Both exist in this tree today and
  neither is reachable: the occlusion read is stubbed twice (`ControlStripHost.vue:1963-1973`
  returns `null`, `RendererStage.vue:166-170` answers for VRM only), and the pixel read that
  would serve the other three is host code with no consumer (`composables/canvas-alpha.ts:19,161`
  — `gl.readPixels` over a circle, then a CPU re-check). Each works for any WebGL canvas, Pixi's
  included; what the migration moves into the renderer is the read itself, along with that
  renderer's own `preserveDrawingBuffer` policy.
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
- **There is no head pose and no host-drawn caption.** Head-tethered text is a `CaptionCue` the
  driver renders inside its own canvas. The host may add its own layers outside that canvas, but it
  does not ask the renderer where the head is, so the old `HeadPose` shape and its `null`-vs-`0`
  problem are gone rather than reconciled.
- **There is no settings bag on the mount.** `RendererStage.vue` passes shadow/blink/idle flags,
  physics switches, mix duration and render scale as a union of per-renderer props, and an opaque
  `settings` object would have kept doing it — the same shape that gave `settings/mmd/scale` two
  writers. The renderer owns those values and reads them from `services.storage`. The camera is the
  same case at its most visible: the host writes VRM's `cameraPosition`/`cameraDistance`/`cameraFOV`
  and its look-at target today, which cannot coexist with a `ViewCue` over the same value.
- **Theme hue is the only setting where the split runs the other way.** The host owns it and a
  renderer only reads it (`services.theme`, re-tinting on `onChange`), because it is a host-wide
  appearance decision: otherwise every renderer invents its own idea of the current theme.
- **No mouth value is normalized by the host, because none is sent.** The four renderers multiply the
  same number by 0.75, by 15, by 0.7, or divide it by 100 — which is exactly the kind of per-format
  opinion that belongs where the mouth is measured. That measurement is now **plugin-level**: the
  plugin registers an analyzer against the host's audio source, and the renderer subscribes to the
  analyzer's frame stream itself. The mount contract carries neither an `AudioNode` nor a mouth scalar.
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
- **`capture` is a cue, not an exposed method.** A selfie can be triggered from a window that does
  not hold the actor mount, and a method can only be called by whoever holds the component reference.
  The cue returns encoded bytes in `CueAck.results`; its payload is empty, and the renderer captures
  everything its own canvas holds and chooses the format — the caller does not name a background,
  quality or width. Capture must be the only cue in its envelope; a failed encode is `capture-failed`
  on the result envelope, never an empty success.
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
  (`target.mountId`) and for a per-mount service subscription alike. A cue that *should* hit every
  mount sharing a scope names `target.stateScope` instead; that is the actor + chat case.

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
  which is why `readSnapshot` takes the scope and nothing else. A scope has semantic
  identity and does **not** include `modelId`: switching the model updates the record,
  it does not mint a new scope. **Every non-preview mount reuses the shared scope**
  (actor, chat, rehearsal, main stage); only each `preview` mount gets its own. That
  policy is the host's and can change without touching the contract.
- **The name is opaque and host-minted**, under a reserved prefix, and never equal
  to a `RendererMountSurfaceKind` value, so a renderer cannot learn the policy by
  reading names.
- **The authoritative copy lives in the main process in Electron.** A renderer publishes over
  IPC; main keeps the snapshot, broadcasts the accepted revision, and is what builds prompts even
  when the actor is in another window. A mount unmount clears that scope's prompt publication.
- **The renderer is the only writer**, and every hand-over is the *complete* state —
  never a patch, a delta or a per-value negotiation, because only the renderer
  knows the shape of what it stored.
- **`vocabulary` and `profileId` are required**, because "this renderer has no
  vocabulary" and "nothing is written yet" must not be the same `undefined`: a
  prompt builder cannot act on that ambiguity. An empty `items` is how a renderer
  states the first. AIRI reads these from the **shared** scope (actor, chat and the main stage all
  publish into it), never a preview scope, so a draft the user is still trying cannot become what a
  prompt believes the model looks like.
- **Unconfirmed changes never reach the snapshot**: that is what `persistent: false`
  on a cue expresses.
- **A preview scope is discarded when its mount unmounts.** Nothing else can read it, and keeping it
  would let a later preview inherit a draft.
- **A scope's name is stable while its state lives.** Renaming orphans the records, so the host either
  migrates them with the rename or discards them deliberately; it never leaves a renderer reading an
  empty scope and concluding that the model has no state.
- **`values` is where a renderer puts its own per-model settings** — transform, selection, expression
  overrides, and the camera for a renderer that owns one — under its own keys, which is what lets
  "reset this model's state" and "move this model's settings with the model" have a single home.
- **Only a mounted instance writes.** A settings panel edits the renderer's own store and lets the
  mount of its scope publish; if nothing is mounted, nothing writes, and the edit lands the next time
  one of that scope's mounts is up. That is also what stops two windows racing on `revision`.
- **Active state is not part of this record**, even when `values` happens to hold the same facts: a
  snapshot is persist-shaped, complete and revision-guarded, while a prompt wants one volatile line
  that AIRI phrases itself. That travels on `prompt` (5.7), from the same scope and under the same
  "publish what the model is, not what the user is trying" rule.

### 5.7 Host services (`host-services.ts`)

Injected at activation: `modelDriverId`, `contract` (a mirror of the manifest
revision, so a renderer can branch without reaching for its own manifest), `log`,
`storage` (get/set/remove/keys/watch — primitives only; every key is relative, the host enforces
the driver namespace invisibly, and `keys()` only returns that namespace), `state`, `prompt` (the live state of a
mounted model, in the vocabulary AIRI already holds), `cues`, `pointer` (per-mount pointer
events, subscribed to by `mountId`, and the only pointer a renderer may read), `theme`
(`accentHue`, `isDark`, `onChange`), `ui` (toast, optional confirm), `i18n`, `runtime`
(`windowKind`, `debug`), optional `bridge` (Electron IPC / webview messaging, host-side
channel allowlist) and `diagnostics`. There is deliberately **no `audio` service**: speech analysis is a
plugin-level `HostSpeechAnalyzerService`, not part of the renderer contract.

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
- **`prompt` is the one push member, and it carries keys rather than text.** A prompt has to describe
  what the model has on *now*, and only the renderer knows that — but `values` is opaque and AIRI may
  not read renderer stores. So the mounted instance publishes `{ stateScope, activeKeys }` and AIRI
  words the line from the `label` it already holds, at the tail, because it changes every turn (5.3
  states the same rule for `vocabulary`). A driver that could submit prose could submit instructions;
  an unconfirmed change stays on a `persistent: false` cue, as it does for the snapshot.
- **Speech arrives as a plugin-level analyzer, not as a renderer service.** A plugin registers an
  analyzer module against the host's audio source (`HostSpeechAnalyzerService`); the host loads it in
  the window that owns the `AudioContext` and publishes low-rate `SpeechAnalysisFrame`s. The
  renderer contract no longer carries an `AudioNode`, an `AudioContext`, or a mouth scalar: an
  `AudioNode` cannot cross a realm, and a per-frame value would violate the cue rule. The plugin
  that wants lip sync subscribes to the frame stream itself and maps `mouthOpen`/`viseme` to its own
  rig. There is no second stream — outside audio is captured in a separate window (9.12 records why
  beats stay host-only).
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

`MODEL_DRIVER_CONTRACT_VERSION = { major: 0, minor: 2 }`. The host checks
`manifest.contractVersion` **when it reads the manifest**, before activation, and
refuses a plugin it cannot speak — so no service container is ever built for it,
and `ModelDriverHostServices.contract` can only ever repeat the validated value. There
is no downgrade path and no negotiated subset of the service interface.

`RendererMountReadinessState` is a vocabulary a renderer *produces* rather than only
type-checks against:

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

### 5.9 Migration of pre-contract settings (`renderer.ts`, `lifecycle.ts`)

A driver that replaces an in-tree renderer inherits settings AIRI has stored under its own keys for
years (`settings/live2d/*`, `settings/stage-ui-three/*`, `settings/positioning/models`, the per-model
alias tables). They are AIRI's data in AIRI's shape, they have no home in the driver's storage, and
they are unrecoverable once the legacy code is deleted — so the contract carries exactly one channel
for them:

```ts
interface ModelDriverRuntime {
  migrate?: (hostState: ModelDriverMigrationInput) => MaybePromise<ContractResult<ModelDriverMigrationReport>>
}

interface ModelDriverMigrationInput {
  // Shape not final: the per-model profile mapping has not been designed yet.
  entries: Record<string, unknown> // the legacy values, by AIRI's own key names
  selectedModelId?: ModelId // which model the window-global values described
}
interface ModelDriverMigrationReport {
  unused?: string[] // entries the driver did not absorb; the host keeps those keys
  warnings?: string[]
}
```

Rules:

- **Once per driver, after `activate`, before the first mount.** The host holds a per-driver list of
  legacy keys; while any of them still exists it builds the bag and offers it once, then never again
  for that driver.
- **The host owns deletion.** It removes an entry only when the report does not name it `unused`, and
  then writes a marker. A crash between the driver's write and the marker re-offers the same bag, so
  `migrate` MUST be idempotent.
- **The bag is not a schema.** Its keys are AIRI's history and disappear with the migration code that
  writes them, so a driver MUST NOT store them and the host MUST NOT interpret what the driver did
  with them.
- **`selectedModelId` exists because the legacy values are window-global.** One parameter map and one
  alias table applied to whichever model happened to be on screen; without the id a driver could only
  guess which model they described, and a guess would attach them to the wrong one.
- **Not the transfer path.** `import(bundle)` restores the driver's own format and must not depend on
  AIRI's old key names. A driver that never had a life before this contract answers
  `capabilities.migration: false`, and the host drops the bag instead of keeping it forever.

The alternative — pre-seeding `services.storage` with a reserved key — was rejected because the
delete, retry and "what did you actually absorb" semantics would then live in an undocumented string.

---

### 5.10 Cross-window mounts (`lifecycle.ts`, `shared/eventa.ts`)

The contract assumes a host that can find a mount. In Electron that host is split: the control
strip and TTS live in the main window, the live avatar in the actor window, and chat mounts a
second view of the same shared scope (only calibration/settings previews are private). A cue
addressed to a `mountId` therefore needs a centre, not a method bag; a `stateScope` fan-out is a
later revision of the same centre.

The host keeps a **mount registry** in the Electron main process:

```ts
interface RendererMountDescriptor {
  mountId: string
  modelDriverId: ModelDriverId
  modelId?: ModelId
  surface: RendererMountSurfaceKind
  stateScope: string
  windowId: string
  readiness: RendererMountReadinessState
  updatedAt: number
}

// The mounting host mints `mountId` as a UUID and passes it as a prop; the broker stamps `windowId` from the sender.
type RendererMountRegistration = Omit<RendererMountDescriptor, 'updatedAt' | 'windowId'> & { windowId?: string }

interface RendererMountQuery {
  surface?: RendererMountSurfaceKind
  stateScope?: string
  windowId?: string
  modelId?: ModelId
  modelDriverId?: ModelDriverId
}

interface ModelDriverMountRegistry {
  register: (descriptor: RendererMountRegistration) => Promise<ContractResult<RendererMountDescriptor>>
  update: (mountId: string, patch: Partial<Omit<RendererMountDescriptor, 'mountId' | 'windowId' | 'updatedAt'>>) => Promise<ContractResult<RendererMountDescriptor>>
  unregister: (mountId: string) => Promise<ContractResult<void>>
  list: () => Promise<RendererMountDescriptor[]>
  findBy: (query: RendererMountQuery) => Promise<RendererMountDescriptor[]>
  onChanged: (handler: (mounts: RendererMountDescriptor[]) => void) => Unsubscribe
}
```

The same process keeps the **cue broker**: it mints a global nonce, queues FIFO per addressed mount,
holds the pending-request table, applies `timeoutMs`, and answers `no-model`/`renderer-not-ready`
itself when there is no mount to ask. The first broker is **single-mount**: `target.mountId` is
required, one request has one answerer, and `target.stateScope` is rejected with
`INVALID_ENVELOPE` rather than silently routed to one of its mounts. Fan-out to every mount in a
scope, with an aggregated per-slot ack, is a follow-up once its settle and timeout rules are
settled. Renderers send and receive over `@moeru/eventa` contracts in
`apps/stage-tamagotchi/src/shared/eventa.ts` (`stageRendererMountRegister/Update/Unregister/List`,
`stageRendererCueSend/Deliver/Ack`, `stageRendererSpeechFrame`). BroadcastChannel remains suitable
for observer-style state (the speech frames use it), but it cannot carry an ack, so it is not the
cue transport.

`mountId` is globally unique: the mounting host mints it as a UUID before mounting, and the
registry rejects a duplicate from any window rather than generating or rewriting the value. The id
is retired when its window is destroyed; every pending send for that window settles `aborted`,
never hangs. A renderer ack is accepted only from the `webContents` that registered the mount, which
is what makes a `mountId` a routing address rather than a claim.

The broker is deliberately **usable-first**: an in-memory map, a counter and a pending table are
enough for the first Electron slice. Persistence, reconnection and backpressure are optimisations
that must not change the registry or ack semantics.

### 5.11 Speech analysis (`host-services.ts`, plugin layer)

`HostSpeechAnalyzerService` is exported from the SDK but is **not** part of
`ModelDriverHostServices`. A plugin registers `{ pluginId, entry, options }`; the host loads the
analyzer module in the window that owns the `AudioContext` and publishes `SpeechAnalysisFrame`
(`at`, `rms`, optional `mouthOpen`/`viseme`) at roughly 30 Hz. The stream is observer-style: it
travels over an eventa BroadcastChannel context, not over the request/reply IPC path and not
through the main broker. It is latest-wins and has no ack; it must never be modelled as a cue.
`unregister` is idempotent and stops the stream.

Phase 1 of the migration may publish a host-computed frame from the existing main-window analyser
before the plugin loader exists; the contract shape does not change when the analyzer moves into a
plugin.

## 6. Worked examples

### 6.1 "Load this character's avatar"

```ts
const modelToLoad = { kind: 'load', modelId: 'display-model-abc', profileId: 'profile-default' }
const loadModelEnvelope = { cues: [modelToLoad], source: 'card', nonce: 7, at: 0, target: { surface: 'stage' } }
// renderer: state-change -> loading-model ... MODEL_LOADED
const loadModelAck = { nonce: 7, results: [{ status: 'resolved', value: { kind: 'load' } }], handled: true }
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
| 1    | Host scaffolding: mount registry + cue broker in the Electron main process over `@moeru/eventa`, `stateScope` minting, the cue round-trip replacing the five renderer channels, `services.storage` primitives with change watch, the snapshot record, static-manifest validation (runtime only in the renderer), `HostNamedModelRecord`/`HostModelProfileRecord`, `profileId` minting | Everything else depends on it; it can be tested against a stub renderer. The registry makes `mountId` a routing address before any renderer migrates. |
| 2    | **Spine** behind the contract                                                                                                                                                                                                                                                | Smallest surface: variants/skins are already `selection`-shaped, no camera, no lip sync, no blink. Proves mount + cue + panel with the least churn.                                                                                   |
| 3    | **MMD**                                                                                                                                                                                                                                                                      | Exposes the settings-ownership failure modes cheaply (`scale`, `rotationY` vs `modelRotationY`, six inert camera keys, the unread `modelOffset`/`modelRotationY` pair).                                                               |
| 4    | **Live2D**                                                                                                                                                                                                                                                                   | Exercises `parameter`, `mesh`, `expression`, a card-driven script calling its actions, hit areas and the capability model; also the first renderer whose mouse-focus and in-canvas caption paths have to be rebuilt on the pointer service and the caption cue. |
| 5    | **VRM**                                                                                                                                                                                                                                                                      | Most entangled: host-written camera with two writers, a third writer in the positioning store, mesh visibility, auras, emotion mappings, custom VRMA blobs. Last on purpose.                                                          |
| 6    | Delete what the contract replaces                                                                                                                                                                                                                                            | See the list below.                                                                                                                                                                                                                   |
| 7    | First-party packaging, enable/disable, static manifest, probe, globals requirements, transfer bundles (incl. cloud sync)                                                                                                                                                      | Completes the first-party path. Third-party dist/publish/loader is explicitly deferred until the contract and runtime are stable; this release does not promise "can live outside the monorepo".                                           |

**Manifest first, runtime second.** The main process discovers and validates a static driver manifest
(`id`, `contractVersion`, `entrypoints`, `requirements`, `capabilities` hint) and keeps only that plus
the enabled flag. The renderer then loads the runtime and calls `activate()`; `rendererCapabilities()`
is answered by that live instance because only the window has a DOM, WebGL and an `AudioContext`.
The main registry therefore carries no more information than the manifest and must not expose a
claimed capability result.

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

**Status: open for 9.9, 9.14; closed for the rest.** Each item declares
its own `Status:` line directly under its heading; `closed` means the question is answered or ruled
out, and the text stays as the record of what was decided.

**Nothing without an implementation is in scope.** A gap is only worth a contract member when an
implementation in this tree already needs it, so a feature nobody has built is a future proposal,
not a hole in this contract. Every item below was found by reading the four implementations.

### 9.1 Gestures, multi-touch and pointer edges

**Status: closed** — resolved as a pointer service (5.7); the text below is the record.

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

### 9.2 The draft's own note about pointer producers

**Status: closed** — the draft's note was wrong and the contract no longer repeats it; the text
below keeps the correction.

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

**Status: closed** — resolved as a driver-owned publication in AIRI's own vocabulary (5.7); the text
below is the record.

**Resolved: the direction flips.** `ModelDriverHostServices.prompt` takes
`{ stateScope, activeKeys }` from a mounted instance, and AIRI words the prompt line itself from the
`CapabilityVocabularyItem.label` it already stores — AIRI owns the vocabulary and the sentence, the
renderer only says which of its own units are on. The prompt consumer that forced the question
(`stores/chat/context-providers/expressions.ts:14-51`, called from `chat.ts:600-602`) is deleted
rather than ported: it imported both renderer stores, so it could describe only whichever renderer
happened to be mounted in that window, and nothing at all with the stage window closed. The host's
other live-state readers — the control strip's expression, motion and wardrobe pickers — become
driver panels (5.2), so no host surface displays active state any more.

Three rules keep the channel from becoming the reach-through it replaced. The payload is vocabulary
keys, **never prose**: a driver that could submit text could submit instructions, and the sentence is
AIRI's. The host drops a key its current vocabulary does not list, because that list is the contract
for what a prompt may name. The contribution is **volatile and tail-placed** — the same stability
requirement that makes `vocabulary` a required, stable list (5.3) is why active state cannot live in
it. Appearance stays a `ProfileCue` and its id is read from the snapshot, so "what the character is
wearing" never depends on this channel.

The problem it replaced, kept as the record:

The only signals a renderer sent were lifecycle, `hit-area-change`,
`animation-finished` and `cue-rejected`. There was no way to ask "what is playing
right now" or to be told when the *renderer itself* changed state (its idle cycle,
its DSL VM, another window's cue). The host read renderer stores for exactly this
(`ControlStrip.vue:945-1144`, `ModelCustomizer.vue:361,430,441`), and the
per-model snapshot did not substitute: it is persist-shaped (revision-guarded,
complete-state), AIRI reads only `vocabulary` and `profileId` from it, and
`persistent: false` previews are deliberately excluded.

**Rejected:** an observation emit, a renderer-originated cue kind, and a read-only `activeState()`
member on the mount. All three are pull-shaped — they let the host ask — and none of them carries
AIRI's vocabulary, so each would hand back renderer-internal names for the host to re-label.

### 9.4 Text and captions, and any host UI drawn inside the renderer's canvas

**Status: closed** — resolved as the caption family; the text below is the record.

**Resolved:** text and captions belong entirely to the renderer. `CaptionCue` carries the utterance,
its sentence split with timing, an `utteranceId` so a growing utterance keeps one highlight rather
than restarting, and `elapsedMs` so a cue arriving mid-sentence starts where playback is; it never
carries a position, font or colour. **It is an optional capability**: a driver that can show text,
including head-tethered presentation, declares `'caption'` and owns that rendering; one that cannot
leaves it out and the host does not send the cue. Omission is supported rather than degraded. AIRI
may choose to draw its own host overlay fallback, which is a host decision outside this contract —
permitted, not required, and not allowed to depend on a driver `HeadPose`. Sending a caption to a
driver that did not declare it is `unsupported-cue`. `ResetCue` with `scope: 'caption'` takes it
down. `nativeHandle` is deleted, because the host no longer draws inside a renderer's canvas; it may
still add its own layers outside that canvas. The problem it replaced is kept below.

Live2D draws a head-tethered comic bubble *inside its own WebGL canvas*, today by
the host importing a renderer composable and handing it the Pixi app (2.3), and the
renderer itself also posts caption segments to the host's caption channel from
inside its motion-start handler (`live2d/Model.vue:988-998`). The bubble needs
text, sentence-sync timing, paragraph sentiment and its own theme — none of which
has a channel: not a prop (it is not sampled per frame), not a service (it is not a
fact), and no cue kind carries content. `nativeHandle` is an escape hatch for
*reaching* the canvas, not for *feeding* it, and the audio service is the only
speech-adjacent channel in the contract — a stream, not the text being spoken.

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

**Status: closed** — ruled not a model-driver concern: a menu is conversation content. Who owns the
script that raised it is settled by the same ruling (a card owns its script, a bundle does not); the
text below is the record.

**Ruled out of the contract.** Which options exist, and what picking one means, is authored by the LLM
and the gameplay layer, not by the character's visual form, so no driver needs a channel to ask the
user anything. The host already owns both the question and the overlay that draws it
(`DatingSimOverlay.vue`, fed by `stores/dating-sim.ts`), and `HostUiService` already covers the two
things a renderer may legitimately raise on its own: a toast, and a confirm only it can phrase. A
renderer-initiated menu in the contract would instead let a model bundle's script compete with the
conversation for one overlay, which is a content-authority question rather than a rendering one. The
notification half of this item needs no member either: `services.bridge` carries it, and a *declared*
notification permission would be a manifest question, not a channel.

**The record.** Live2D's DSL can present a choice tree and suspend its chain until one is selected,
and the round-trip travels on its own channel (`live2d-dsl-bridge`: `dsl-choices
{ requestId, text, choices[] }`, `dsl-choice-selected { requestId, choiceIndex }`,
`dsl-intimacy-changed`). `RendererMountEmits` is a closed set with no way to say
"the renderer is asking the user something", and `CueChannel.subscribe` is
explicitly for observers rather than for a request/response pair. The same renderer
also raises OS notifications through `window.electron.ipcRenderer`
(`live2d/Model.vue:1006`), which `services.bridge` can carry but which nothing
declares as an intent.

What made this look like a contract gap is that the *trigger* is model-bundled script: a DSL manifest
ships `Choices` entries, and the VM raises a menu when its chain reaches one. So today the option text
is authored by whoever wrote the model's script, while the list it lands in belongs to the
conversation layer — shared with LLM-authored options and distinguished only by a `dsl:` id prefix.
The ruling that settles it is ownership, not a channel: a script is character content, so it belongs
to the card and AIRI runs it (3, non-goals), and a model bundle stops being a place where behaviour is
authored. The migration of the two existing script runners is a card-schema question, not a contract
one.

### 9.6 View pushback (the renderer telling the host where the model ended up)

**Status: closed** — resolved by ownership: the renderer owns the model's transform, so there is
nothing to push back to and no copy to keep in step.

**Ruled: placement and the settings behind it are the renderer's.** Position, scale, rotation and the
camera are per-model settings like render scale or physics, so they live in the renderer's own storage
and travel in its snapshot (`values`) — never as a host copy that every drag round-trips through. The
pushback question dissolved rather than being answered: `scaleChange` / `offsetChange` existed so the
host could restate the value it had stored, and with no stored value there is no emit to send. What the
host keeps is a **reset** — `ResetCue` with `scope: 'transform'` — because "put this model back" is a
discrete user action about a value the host does not own, exactly as `VIEW` already does for the
camera.

Two consequences belong to migration rather than to the contract: the host keys
(`settings/positioning/models`, `settings/live2d/{position,scale}`, `settings/mmd/{position,rotationY}`,
`settings/spine/{position,scale}`, `settings/stage-ui-three/{modelOffset,modelRotationY}`) have to be
imported once into renderer storage or users lose their layout, and Stage-Mate — a fourth writer that
moves the model over IPC — has to reach the driver instead of a host store.

The problem it replaced, kept as the record: Live2D emitted `scaleChange` / `offsetChange`, MMD emitted
the same two (`MMD.vue:241,274`), and VRM's `OrbitControls` wrote `cameraPosition` / `cameraDistance`
back into a store. The contract had no renderer->host view channel, `ViewCue` and `ResetCue` with
`scope: view` were host->renderer only, and the host kept a *third* copy of position/scale in
`settings/positioning/models` that every drag round-tripped through.

### 9.7 Addressing one of several mounts on the same surface

**Status: closed** — resolved by `mountId`; the text below is the record.

**Resolved:** `RendererMountProps.mountId` is the mount's own host-minted identity, and
`CueEnvelope.target.mountId` addresses it. `stateScope` was the wrong key for this and stays the
*sharing* key: several mounts can share one scope, so a scope cannot name one of them. The same
`mountId` is what a `RendererPointerService` subscription names, because a per-mount service has the
same problem as a per-mount cue.

### 9.8 Addressing ambiguity between `expression` and `morph`

**Status: closed** — both halves are ruled: `SelectionCue` and `MeshCue` are deleted, and there is
no `morph` capability kind.

**Ruled.** `SelectionCue` and `MeshCue` are both deleted: a kind-agnostic "set
this capability key to this value" cue, and a boolean on a named part, each let
AIRI drive a renderer's internals one mechanism lower than intent. Appearance —
which parts are shown, which outfit composes them, how two outfits interact — is
the renderer's, so AIRI names a `ProfileCue` and composes nothing itself.

**Also ruled.** There is no `morph` capability kind. `ExpressionCue.key` addresses
one expression unit, and a format whose expressions are vertex morphs (MMD) or
blend shapes (VRM, once the loader registers the unregistered ones) still exposes
one id per unit. Three things follow, and they are the same rule seen three ways:

- the kind records **which ACT token family may address a descriptor**, not how
  the format stores it — so the two cannot disagree about what a cue named;
- a renderer must not enumerate one unit twice under two kinds: `ActTokenKind`
  has no `morph` family, so a `morph` descriptor could never enter the vocabulary
  AIRI prompts with, and the unit would exist only for a cue that already
  addresses it;
- a token that differs from the driver's native name (`mmdStore.morphMappings`
  today maps raw morph → label, and `ControlStripHost.vue:409-423` reverse-looks
  it up at fire time) is an **alias table the driver keeps itself**. AIRI stores
  the token and never the native name, which is what makes a rename a driver-local
  edit rather than a card migration.

### 9.9 Nothing enumerates a point of interest yet

**Status: open** — the implementations exist as socket tables (`VrmSocketResolver`,
`MmdSocketResolver`, Live2D hit areas), so this is a missing enumeration, not a missing feature.

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

**Status: closed** — nothing implements a timeline, so it is out of scope (see below).

The cue model is transactional with no sequencing, by design. The unwired
`stage-ui-three-performance-runtime` (2.8) describes a *timeline*: `speech`, `viseme`,
`expression`, `body` and `marker` events at millisecond offsets, plus a playhead.
It has no scheduler, no playhead advance and no consumer, and no other code in the
tree keeps a performance clock, so this is a design sketch rather than an
implementation the contract is missing. There is no viseme vocabulary at all — a driver
derives its mouths from the speech stream — and `animation-finished` is one-shot. Both Live2D and MMD
already blend five to six visemes internally with attack/release constants of their
own, so the current shape is "the host sends one number, the renderer invents the
mouths" — which is enough while nothing schedules anything finer.

**Closed, not erased from the record.** If a performance timeline is ever built, whether timing
belongs to AIRI (scheduling cues from a timeline, one at a time) or to the renderer (given a
timeline, drives itself) is a question for that proposal. Until then the contract stays
unscheduled.

### 9.11 Continuous pose streams and exclusive-owner leases

**Status: closed** — ruled driver-internal: no pose member, no stream cue, no lease.

Live2D has two host->renderer streams in this tree that the contract deliberately does **not**
represent: a motion-control spring (`live2d-motion-control-set/release`,
`live2d-breath-control-set/release`) carrying a continuous pose, and an
exclusive-claim protocol (`...-claim-exclusive` / `...-release-exclusive`) that
lets one producer own the avatar's body. Both travel as discrete
`BroadcastChannel` messages, which is exactly the case the contract forbids for a
per-frame stream (`cues.ts`), and there is no prop for a pose.

**Ruled.** Neither belongs in the contract, and the fact that the contract cannot express them is
not a gap in it. A pose is a renderer's *output*, never its input: the renderer owns its body, so
an engine that synthesises ambient motion is an internal, like its physics, its blink loop or its
spring bones. There is therefore no `pose` member on `RendererMountProps`, no stream cue, and no
lease — a lease arbitrates between producers, and a renderer with no external producer has nothing
to arbitrate.

What the host keeps is one fact and one gate. The plugin-level speech analyzer
(`HostSpeechAnalyzerService`) is how a driver knows the character is talking, and how loudly — the
plugin maps the analyzer's frames to its own rig; the on/off, profile and intensity of an ambient
engine are driver settings behind a driver panel (5.2), never a cue.

**The authoring case survives the ruling.** A workbench that tunes the engine while watching it —
fit, seed, profile, method — is a driver-internal surface too (5.2), driving the same instance
in-process. It needs no lease: with one producer inside one renderer, there is nobody to arbitrate
with.

**Why the streams exist at all.** They are the by-product of putting the generator on the host
side, not of a capability the contract lacks. In this tree the generator
(`stage-ui/src/features/motions/live2d/`) publishes 13 axes at 30 Hz over
`airi-stores-stage-ui-live2d-motion-control`, and the renderer applies them through
`useMotionUpdatePluginManualControl`. Nothing claims the lease: `claimExclusiveControl` and
`releaseExclusiveControl` have no caller, so the consumer's `isExclusive` check is permanently
false. Moving the engine behind the mount deletes the store, the channel and both lease messages
together, and leaves the two surfaces above.

### 9.12 Audio output, beat/tempo, and the scripting VM's verb set

**Status: closed, revised 2026-10-20** — audio output, the beat and the verb set stay out of the
renderer contract, and **speech reading is now plugin-level**: `HostSpeechAnalyzerService` replaces
the old `HostAudioInterface` tap.

The Live2D DSL has eight verbs and a VarFloat/intimacy/time-limit instruction set
(`packages/live2d-runtime/src/dsl/command-parser.ts:55-99`,
`interpreter.ts`). The table is what each verb wanted; the rulings below say which of those wants stay
outside the contract:

| Verb / fact                                 | Closest concept                | Missing                                                                                                                                                                            |
| :------------------------------------------ | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_mtn Group#lane:item`                 | `MotionCue.key`                | lane and item sub-selection (deliberately excluded from the cue)                                                                                                                   |
| `stop_sound <channel>`                      | none                           | the contract has **no audio-output cue**, and speech analysis is a plugin-level analyzer, never a channel to control |
| `replace_tex <i> <file>`                    | none                           | texture-index addressing; `SelectionCue` was the only candidate and is deleted (9.8), so this stays renderer-internal                                                              |
| `motions enable/disable <group>`            | `ResetCue` motion scope        | a per-group pool gate                                                                                                                                                              |
| `Intimacy` bonus plus `Min`/`Max` gates     | none                           | a persistent per-model scalar (it lives in renderer storage and today leaks to the host over `dsl-intimacy-changed`, where a dating-sim store folds `delta` into its own variable) |
| beat styling (`punchy-v`, `sway-sine`, ...) | none                           | the contract has no beat stream: the only outside capture the app can make lives in another window, and its node cannot be handed over (below)                                   |

**Ruled out of the contract: the verb set, the intimacy scalar, audio playback and the beat.**

- *The verb set.* A scripting VM is not a renderer concept. The card owns the script and AIRI
  interprets it (3, non-goals), so what reaches a driver is the action it can already perform:
  `start_mtn Group#lane:item` is a `MotionCue`, and the lane/item sub-selection is the driver's own
  alias table (5.3), not a cue field. `replace_tex` stays inside the renderer as well — a texture
  index is raw addressing, which is the one thing AIRI must not drive, and a different texture is a
  different profile.
- *The intimacy scalar.* It is **character state**, not a per-model renderer fact, so it belongs in
  the character's variable space. The `dsl-intimacy-changed` hop that folded a renderer-side delta
  into the host's dating-sim store disappears with the ownership rather than being promoted to a cue.
- *Audio playback.* `stop_sound` needs no member: audio playback is the host's, so a card script asks
  the host, not the renderer.
- *The beat.* Not a contract member, and not a driver's job for now. The only audio the app captures
  from outside itself comes from a dedicated hidden window
  (`apps/stage-tamagotchi/src/main/windows/beat-sync/`), whose `AudioContext` and `AudioNode` cannot
  be handed to a renderer running in another window: a node does not cross a realm, and the capture
  handler is one app-wide `defaultSession` handler that the window owning it resets to `null`
  (`packages/electron-screen-capture/src/main/index.ts:146-151,228-239`). A `CAPTURE` stream was
  therefore a promise no host could keep, so it is kept out of the renderer contract entirely rather
  than shipped as one. Beat sync is a **host feature, temporarily unavailable to drivers**; a first-party
  driver may read the plugin-layer channel directly as a stopgap, which is explicitly outside this
  contract and costs it portability. Speech analysis is unaffected: it is a plugin-level analyzer
  (`HostSpeechAnalyzerService`), and its frames cross windows as data, not as an `AudioNode`.

**Where the detector stays.** The detector that exists today is not fed by the speech graph: a
dedicated Electron window captures **system audio**, runs an analyser worklet
(`apps/stage-tamagotchi/src/main/windows/beat-sync/`) and signals beats over `airi::beat-sync`, which
is what lets an avatar dance to music played by something else. It stays exactly there. This section
used to call that window "the host doing a renderer's measuring for it" and plan to shrink the host to
handing over the captured node; the node cannot be handed over, so the plan is withdrawn and the
window keeps its job. Moving the capture into the renderer's own window is the only shape that would
put the node in the renderer's graph, and it needs the app-wide display-media handler to become
per-window and ties capture to the stage window's lifetime — the opposite of what a background music
detector wants, and not worth it for a secondary feature.

**The capability gate closes with the rest.** The only producer of `motions enable/disable` is the
model-bundled DSL, which applies it to its own pools; the host-side parser that dispatches the same
verb (`dating-sim.ts:561-591`) is exported and **never called anywhere in the tree**, so nothing
card-side asks the host for a gate. Its two live consumers are inside the renderer, and they already
agree with each other: `interpreter.ts` keeps a `motionGroupEnabled` map, the adapter mirrors it, and
`Model.vue` honours it when selecting a motion (including through the model's idle-group alias) and
when a gate closes by stopping the motion that is already looping. What is left on the host is a user
preference — idle animations on or off, `settings/live2d/idle-animation-enabled`, passed down as a
prop and honoured in `motion-manager.ts` — and that is ambient motion, which 9.11 already ruled the
driver's. So the gate is not a gap: it is the driver's own bookkeeping, and if a card-authored script
ever needs to say "hold still", that is a feature to design together with the card DSL rather than a
member this contract owes.

### 9.13 Re-import, repair and payload replacement

**Status: closed (2026-10-20)** — the host already repairs and re-imports today, so the missing
statement mattered; the answer is "conflict by default, explicit overwrite by exception".

`probe` no longer receives an id: it returns `parts`, and AIRI mints a `modelId` per selected part
before `confirmImport`. `confirmImport` answers `MODEL_ID_CONFLICT` when `(modelDriverId, modelId)`
already exists. Only an explicit user "replace" action, or a migration carrying a `migration` marker
(`source`, `sourceId`, `payloadHash`), may set `overwrite: true`; the host writes a `pending` marker,
runs the atomic replace, marks it `done`, and only then deletes the legacy blob. A retry with the same
marker is a no-op when `done` and a safe replay when `pending`. The Live2D multi-model repair path is
exactly this migration case; normal drop/card imports never overwrite.

### 9.14 Load progress

**Status: open, low priority.**

`RendererMountReadinessState.LOADING_MODEL` is a single state; a multi-second VRM
or Live2D load reports no progress (VRM even emits a `loadingProgress` number that
nothing consumes). `first-frame` only ends it. Probably non-blocking — the host can
show an indeterminate indicator — listed for completeness. **Open, low priority.**

### 9.15 Cancel/abort as a cue

**Status: closed** — no cancel member exists and nothing in the tree asks for one; a cancel cue
would be a new proposal, not a gap here.

If a cancel member is ever added, one question returns: may it jump the host's FIFO
queue? A cancel is a statement *about* a transaction rather than a precondition of
its siblings, so "cancel first" would be the one genuine priority anyone has asked
for — and admitting it reopens "then why not motion before expression". No such member
exists yet, so the ordering question is a proposal for whenever one is added rather
than a gap here.

### 9.16 Pre-contract settings have no handover

**Status: closed** — decided and written into the contract (5.9), because the migration cannot delete
years of AIRI-owned renderer settings without one.

`services.storage` starts empty for a driver and `import(bundle)` moves the driver's own format, so
neither can carry what AIRI stored before the contract existed: the per-renderer setting namespaces,
the placement table and the per-model alias tables. The contract now carries
`ModelDriverRuntime.migrate(hostState)` and `ModelDriverCapabilities.migration`: the host offers its
legacy bag once, deletes only the entries the driver did not report as `unused`, and retries
idempotently after a crash. A driver that never lived outside this contract answers `false`, and its
legacy bag (if any) is dropped rather than kept forever.

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
| occlusion              | none queried (alpha read works) | offscreen render target (call site stubbed)                                               | none                                          | none                                          |
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
