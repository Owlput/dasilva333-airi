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
> [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md)
> (RFC 0002). The original
> [`docs/rfcs/0001-stage-renderer-plugin-contract.md`](../../docs/rfcs/0001-stage-renderer-plugin-contract.md)
> is kept as the historical record and is superseded where it conflicts.
>
> How the contract reaches the application — host core, driver hosting, per-format
> cutover, data migration and validation — is sequenced in
> [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

## Concepts and responsibilities

| Concept | Owner | What it is |
| :--- | :--- | :--- |
| AIRI | - | The host application that orchestrates user input, LLM output, and their representations. |
| Character | AIRI | A virtual, "conscious" being, with a "mind" and optionally a "body". |
| Model driver | - | A layer that translates character intents to instructions on how to manipulate the character's visual representation. |
| Model | Model driver | A character's visual representation, in current context. |
| Raw model | Model driver | Binary representation of a model, its behaviors, parameters, textures, etc. |
| Registry | AIRI (main) | Driver manifests, one manager per driver, the mount registry and the cue broker. |
| Manager | Model driver (main) | The driver's main-process half: lifecycle and the model list. Holds no runtime. |
| Adapter | AIRI (renderer, one per window) | Generic host: resolves the driver's modules, creates the services, hosts mounts and lightweight provider instances, registers the mounts it creates. Owns no Vue tree and decides no visibility. |
| Runtime | Model driver (renderer, one per driver per window) | The object `activate()` returns: the provider, the capability probe, transfer and purge. |
| Provider | Model driver (renderer) | The model catalogue: probe/import, list, remove, profiles, previews, capabilities, vocabulary. |
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

The interfaces that carry the split:

| Interface | Reason |
|:--- |:--- |
| `ModelProvider` | AIRI does not know what a model physically is. |
| `HostStorageInterface` | Model driver does not know where to store the bytes. |
| `ModelDriverManager` | AIRI needs a model list where there is no DOM to produce one. |
| `ModelDriverRuntime` | What a renderer can do is only knowable inside a renderer. |

Everything below that level — mount surfaces, panels, the model picker, host services, readiness,
the failure envelope — is a mechanism these concepts are expressed through, and is described by the
file map and the RFC.

Two absences are deliberate and load-bearing:

- **No state scope.** Every mount is independent; actor and chat are two mounts, not two views of one
  state. Control that must reach both is sent to each `mountId`.
- **No per-model snapshot.** AIRI never stores, restores or interprets renderer state. A driver's
  state is its own storage; the one value AIRI carries across a mount is the current model's prompt,
  which the driver writes and AIRI keeps in the character card.

## Driver registration and loading mounts

note: move this to design document. this section only covers behaviors on electron.

1. On driver discovery, AIRI reads the driver's static manifest, registers the driver in the main-process registry, instantiates its `ModelDriverManager`, and stores both in the registry. **This happens before any driver code runs.**
2. When a window first needs to render a model, that interface creates the window's Adapter and states a mount intent to the registry: a `modelDriverId`, a `purpose`, and a `mountId` the wrapper has already minted. The Adapter resolves the manifest's `mount` entry and returns the component; the interface mounts it.
3. The mounted component receives its services as props, is registered by the Adapter (registry `register`, `update` on readiness changes, `unregister` on unmount), and starts rendering when a `LoadCue` arrives.
4. The Manager reaches the renderer side only through the adapter channel the registry hands it. No main-process object holds a runtime, a mount or a probed capability.
5. Panels and the model picker are mounted the same way, from their own manifest entries, and need no mount and no loaded model. Choosing a model is not a panel: it is the driver's `modelPicker`, and it emits only imported ids.

AIRI directly manages the registry on the main process, and communicates with adapters in renderer windows for actually mounting a specified runtime and providing resources and channels to the runtime.
The emitted events from the mount are interpreted by AIRI.

## File map

| File | Implements | Purpose |
| :--- | :--- | :--- |
| `src/contract/shared.ts` | both | ids, result envelope, failure codes, readiness, mount surface and purpose, geometry, the stored preview and author shapes |
| `src/contract/model.ts` | AIRI | the identities (`ModelId`, `ModelProfileId`, `CharacterId`) and a model's state (`unimported` / `builtin` / `imported` / `pending-import`) |
| `src/contract/manifest.ts` | driver | what a driver declares statically: id, capability hint, requirements, and the module entry points for each half |
| `src/contract/lifecycle.ts` | both | the main-process manager, the renderer runtime (capability probe, transfer, purge, migrate), the host registry, and the cross-window mount registry |
| `src/contract/provider.ts` | driver | model provider: two-phase probe (`files`/`url` → `parts`) + `confirmImport(selections)` / list / remove / preview / modelCapabilities / vocabulary / profiles / model transfer |
| `src/contract/components.ts` | driver | driver-level UI: settings panels, the model picker and its `select` contract, and the opaque bundle that moves a whole driver |
| `src/contract/capabilities.ts` | driver | capability kinds, the renderer's descriptors, and the ACT token vocabulary |
| `src/contract/renderer-mount.ts` | renderer | one mounted viewport: props, emits, exposed methods (the cue sink, the occlusion query, the interaction hit test), readiness; capture travels as a cue, not as a method |
| `src/contract/cues.ts` | both | one transactional cue vocabulary and one ack shape for everything the avatar is asked to do |
| `src/contract/host-services.ts` | AIRI | the service container injected at activation: log, driver-namespaced storage, the prompt channel, cues, the pointer stream, theme, runtime facts, bridge |
| `src/contract/references.ts` | AIRI | every record and view AIRI keeps with no driver available: the named model, its profiles, the character's model binding, the lightweight model summary, driver status, and why a model is unavailable |
| `src/contract/plugin-port.ts` | AIRI | the plugin-level speech analyzer: the frame stream that replaced a driver-side `AudioNode` |

## Deliberate non-goals

- No implementation, no dependency-injection container, no plugin loader — the
  existing plugin host owns discovery and enable/disable, and each driver declares its own entries.
- No format knowledge.
- No integration with `display-models.ts` or `RendererStage.vue` yet.
- No decision about *where* renderer state is physically stored, and no declaration of
  *what* it contains: AIRI provides the primitives and the medium, the model driver owns the
  layout, the versioning and every migration.
- No state channel and no state scope: neither a snapshot AIRI could restore nor a scope name it
  could route by.
- No audio graph: a renderer never receives an `AudioContext` or an `AudioNode`, because neither
  crosses a realm. Lip sync arrives as frames.
- No runtime value that is not a closed vocabulary a renderer must produce, plus the contract
  revision. Every closed vocabulary is an `enum`, so its members are named, documented and
  exhaustively checkable where a consumer switches on one. Everything else is a type. There is also
  no `./types` subpath, because `.` is already the whole contract.

## Validation

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
```

`tsc --noEmit` only; there is no runtime to test.
