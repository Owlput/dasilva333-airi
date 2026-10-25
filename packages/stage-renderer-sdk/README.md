# @proj-airi/stage-renderer-sdk

Contract between AIRI and a **model driver** (VRM / Live2D / Spine / MMD
today, and anything else later).

> **Status: contract only.** No implementation. Nothing in this workspace imports
> this package yet — it exists so the model driver boundary can be reviewed before
> any existing code moves behind it. This release is **first-party only**: the package
> stays `private` and source-only; third-party distribution is deferred until the
> contract and renderer host are stable. See "Deliberate non-goals".
>
> This file states the concepts, the ownership and the file map. The reasoning
> behind every shape in the package — what the current tree does instead, what was
> rejected, and what the contract still cannot express — lives in
> [`docs/rfcs/0001-stage-renderer-plugin-contract.md`](../../docs/rfcs/0001-stage-renderer-plugin-contract.md).

## Concepts and responsibilities

| Concept | Owner | What it is |
| :--- | :--- | :--- |
| AIRI | - | The host application that orchestrates user input, LLM output, and their representations. |
| Character | AIRI | A virtual, "conscious" being, with a "mind" and optionally a "body". |
| Model driver | - | A layer that translates character intents to instructions on how to manipulate the character's visual representation. |
| Model | Model driver | A character's visual representation, in current context. |
| Raw model | Model driver | Binary representation of a model, its behaviors, parameters, textures, etc. |
| Registry | AIRI | A center registry for all registered model drivers. |
| Manager | Model driver | What the registry holds for model driver to manage its own mounted runtimes. |
| Adapter | AIRI | What actually provides resources and forwards signals from AIRI. |
| Runtime | Model driver | An object that receives host resources, signals, and directly manages a renderer. |
| Mount | Model driver | A Vue component with a runtime and a renderer that renders a model. |
| Service | AIRI | A channel for runtime to receive host resources and signals. |
| Renderer | Model driver | What the model driver is directly driving, that renders a model to screen. |
| Named model | AIRI | A model that a character can reference. |
| Profile | Model driver | A group of named persistent states of a model. |
| User input | AIRI | Cursor, cues, ACT tokens, plugin-level speech frames, etc. |
| Model capability | Model driver | What kinds of inputs a model driver and its model can respond to. |
| Cue | AIRI | A signal for model driver to perform actions with a vocabulary known at compile time. |
| ACT token | Model driver | A signal for model driver to perform actions with a vocabulary known at runtime. |
| Expression | Model driver | An action performed by an avatar that does not involve animations. |
| Motion | Model driver | An action performed by an avatar that involves animations. |

| Responsibility | Owner |
|:--- |:--- |
| Storage primitives | AIRI |
| User input primitives| AIRI |
| Storage layout | Model driver |
| Data migration | Model driver |
| Rendering | Model driver |
| Model manipulation| Model driver |

The two interfaces that carry the split:

| Interface | Reason |
|:--- | :--- |
| `ModelProvider` | AIRI does not know what a model physically is. |
| `HostStorageInterface` | Model driver does not know where to store the bytes. |

Everything below that level — mount surfaces, panels, host services, readiness, the
failure envelope, the state scope — is a mechanism these concepts are expressed
through, and is described by the file map and the RFC.

## Driver registration and loading mounts

note: move this to design document. this section only covers behaviors on electron.

1. On driver discovery, AIRI find `ModelDriverManifest`, register the driver on driver registry, instantiate a manager on the electron main process, and store it in the registry.
2. When AIRI want to mount a renderer for a model, AIRI reads the model manifest and look for the driver in registry.
3. If the driver is found, AIRI will receive the path to load a component that hosts a runtime and its renderer.
4. The component gets mounted by AIRI, reports back to its manager in the registry, and receives resources and channels from the adapter on the parent component. The component is a mount.
5. The runtime receives signals from AIRI to, for example, load a model.

AIRI directly manages the registry on the main process, and communicates with adapters on renderer windows for actually mounting a specified runtime and providing resources and channels to the runtime.
The emitted events from the mount are interpreted by AIRI.

## File map

| File | Implements | Purpose |
| :--- | :--- | :--- |
| `src/contract/shared.ts` | both | ids, result envelope, failure codes, readiness, geometry, the stored preview shape |
| `src/contract/manifest.ts` | driver | what a model driver declares: id, the capability hint (`ModelDriverCapabilities`), requirements, entry points |
| `src/contract/host-services.ts` | AIRI | the service container injected at activation (log, storage primitives with change watch, the per-model state channel, cues, the pointer stream, theme, runtime facts, bridge) plus the plugin-level speech analyzer types |
| `src/contract/provider.ts` | driver | model provider: two-phase probe (`files` → `parts`) + `confirmImport(selections)` / list / remove / preview / modelCapabilities / profiles / model transfer; AIRI imports models only, other assets use the driver's own channel |
| `src/contract/capabilities.ts` | driver | capability kinds, the renderer's descriptors, and the vocabulary snapshot AIRI reads |
| `src/contract/renderer-mount.ts` | renderer | one mounted viewport: props, emits, exposed methods (the cue sink, the occlusion query, the interaction hit test), readiness; capture travels as a cue, not as a method |
| `src/contract/cues.ts` | both | one transactional cue vocabulary and one ack shape for everything the avatar is asked to do |
| `src/contract/persistence.ts` | both | the one model-scoped state channel AIRI holds, partitioned by `stateScope`, and the full-state rule it works by; no storage declarations |
| `src/contract/lifecycle.ts` | both | activation, the runtime object (the `rendererCapabilities()` probe, panels, whole-driver transfer), the requirements report, host registry, and the cross-window mount registry |
| `src/contract/references.ts` | AIRI | every record AIRI itself keeps — the named model and its profiles — on one annotation shape |
| `src/contract/renderer.ts` | driver | driver-level concepts: settings/control-strip panels (`hostSurfaces`/`hostSurface`), and the opaque bundle that moves a whole driver |
| `src/contract/model.ts` | AIRI | the two identities AIRI mints: the model reference and its profile |

## Deliberate non-goals

- No implementation, no dependency-injection container, no plugin loader — the
  existing plugin host owns discovery, enable/disable and load/unload.
- No format knowledge.
- No integration with `display-models.ts` or `RendererStage.vue` yet.
- No decision about *where* renderer state is physically stored, and no declaration of
  *what* it contains: AIRI provides the primitives and the medium, the model driver owns the
  layout, the versioning and every migration.
- No runtime value that is not a closed vocabulary a renderer must produce, plus the contract
  revision. Every closed vocabulary is an `enum`, so its members are named, documented and
  exhaustively checkable where a consumer switches on one. Everything else is a type. There is also
  no `./types` subpath, because `.` is already the whole contract.

## Validation

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
```

`tsc --noEmit` only; there is no runtime to test.
