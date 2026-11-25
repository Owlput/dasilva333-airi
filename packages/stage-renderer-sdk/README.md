# @proj-airi/stage-renderer-sdk

Contract between AIRI and a **model driver** (VRM / Live2D / Spine / MMD
today, and anything else later).

> **Status: contract only, at `0.1`.** No implementation. Nothing in this workspace imports
> this package yet — it exists so the model driver boundary can be reviewed before
> any existing code moves behind it. `0.1` is the first shipped contract shape, produced by Phase 0
> of [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md); `0.0.x` was a draft and is refused by
> `isContractCompatible`. This release is **first-party only**: the package
> stays `private` and source-only; third-party distribution is deferred until the
> contract and renderer host are stable. See "Deliberate non-goals".
>
> This file states the concepts, the ownership and the file map. The reasoning
> behind every shape in the package — what the current tree does instead, what was
> rejected, and what the contract still cannot express — lives in
> [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md)
> (RFC 0002). The choices this package makes *beyond* that RFC — `RegistryHandle`,
> `LegacyRestorePayload`, `PendingModelPayload`, `isContractCompatible`, `profile-missing` — are
> recorded in [`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md), and RFC 0002 carries an amendment
> section listing them. The original
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
  state. A cue names a driver plus a surface/purpose, and the manager fans it out to the mounts that
  match.
- **No per-model snapshot.** AIRI never stores, restores or interprets renderer state. A driver's
  state is its own storage; the one value AIRI carries across a mount is the current model's prompt
  and token list, published as one versioned pair and kept in the character card as a snapshot.

## Driver registration and loading mounts

note: move this to design document. this section only covers behaviors on electron.

1. On driver discovery, AIRI reads the driver's static manifest, registers the driver in the main-process registry, instantiates its `ModelDriverManager`, and stores both in the registry. **This happens before any driver code runs.** The declaration names only `entry.manager`; everything else the manager resolves on demand.
2. When a window first needs to render a model, that interface says so to the registry, which **issues the `mountId`** through `HostRegistryClient.registerMount({ driverId, surface, purpose, windowId })` (`registerMount` is the adapter's registry client). A mount is unaddressable until that resolves. The Adapter then asks the manager which module implements `ModelDriverEntryKind.MOUNT` (`requestEntrypoint`) and imports what the manager named through its own build-time loader table.
3. The mounted component receives its services as props, is tracked by the registry (readiness `update`s, `unregister` on unmount), and starts rendering when a `LoadCue` arrives.
4. The Manager reaches the renderer side only through the adapter channel the registry hands it. No main-process object holds a runtime, a mount or a probed capability.
5. Panels and the model picker are resolved the same way, through `resolveEntrypoint` with their own entry kinds, and need no mount and no loaded model. Choosing a model is not a panel: it is the driver's picker module, and it emits only imported ids.

AIRI directly manages the registry on the main process, and communicates with adapters in renderer windows for actually mounting a specified runtime and providing resources and channels to the runtime.
The emitted events from the mount are interpreted by AIRI.

## File map

| File | Implements | Purpose |
| :--- | :--- | :--- |
| `src/contract/shared.ts` | both | ids (including `MountId`), result envelope, failure codes, readiness states, `READINESS_TRANSITIONS` + `isReady`, mount surface and purpose, geometry, the stored preview and author shapes, reference-gate evidence |
| `src/contract/model.ts` | AIRI | the identities (`ModelId`, `ModelProfileId`, `CharacterId`) and a model's state (`unimported` / `builtin` / `imported`) |
| `src/contract/manifest.ts` | driver | what a driver declares statically: id, capability hint (including whether it publishes a prompt and which interaction modes it supports), requirements, and the one entry point it names — its manager |
| `src/contract/registry.ts` | AIRI | the manager's registry handle (`log`, `requestRenderer`, `listDrivers`, `isEnabled`, `onChange`), the opaque `ManagerChannel`, entry kinds and resolution types, and the adapter's registry client with `registerMount` — the only source of mount ids |
| `src/contract/adapter.ts` | AIRI (renderer) | the window's adapter: mints `modelId`/`profileId`, never a mount id; requests entry points; loads and activates the runtime; hands out the service container and the manager channel |
| `src/contract/lifecycle.ts` | both | the main-process manager (rows, entry resolution, delivery, withdrawal, mount queries/commands, analyzer request) with its `createManager(handle)` factory shape, and the renderer runtime (capability probe, transfer, purge, per-model migration and revert), plus the cross-window mount registry |
| `src/contract/provider.ts` | driver | model provider: two-phase probe (`files`/`url` → `parts`) + `confirmImport(selections, input)` settling each entry on its own / list / remove / preview / modelCapabilities / vocabulary / profiles / model transfer |
| `src/contract/components.ts` | driver | driver-level UI: settings panels, the model picker and its `select` contract, and the opaque bundle that moves a whole driver |
| `src/contract/capabilities.ts` | driver | capability kinds (including `effect` and `pointOfInterest`), the renderer's descriptors, and the ACT token vocabulary |
| `src/contract/renderer-mount.ts` | renderer | one mounted viewport: props (no size — the container is the viewport), emits, exposed methods (the cue sink, the occlusion query, the interaction hit test), readiness; capture travels as a cue, not as a method |
| `src/contract/cues.ts` | both | one transactional cue vocabulary addressed by driver + surface + purpose, the ack (answering driver, per-slot outcomes, no `requestId`), the acceptance/settlement split, seven transaction states and six withdrawal requests with their bounds |
| `src/contract/migration.ts` | both | one legacy model going into a driver (`ModelDriverLegacyHandoverEntry` → report `retained`/`unused`) and one coming back out for a revert (`LegacyRestorePayload`, carrying the legacy id) |
| `src/contract/host-services.ts` | AIRI | the service container injected at activation: log, driver-namespaced storage, the prompt channel (`ModelPromptPublication` — text and tokens as one versioned pair), cues, the pointer stream, theme, runtime facts, bridge |
| `src/contract/references.ts` | AIRI | every record and view AIRI keeps with no driver available: the named model, its profiles, the character's model binding, the lightweight model summary, the pending payload, driver status, why a model is unavailable, and the one mapping between those last two |
| `src/contract/plugin-port.ts` | AIRI | the plugin-level speech analyzer: the frame stream that replaced a driver-side `AudioNode` |
| `src/compatibility.ts` | AIRI | `isContractCompatible`: same minor below 1.0, same-or-older minor from 1.0, with a readable rejection |
| `src/validate.ts` | AIRI | the executable checks: declaration (including that `entry` names nothing but the manager), capability completeness, envelope rules, ack shape, withdrawal requests, prompt publication and its fault state, readiness transitions |

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
  revision, the declared readiness transitions, the withdrawal bounds, the capability key set, the
  validators and the compatibility predicate. Every closed vocabulary is an `enum`, so its members are
  named, documented and exhaustively checkable where a consumer switches on one. Everything else is a
  type. There is also no `./types` subpath, because `.` is already the whole contract.

## Validation

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/stage-renderer-sdk test
```

`tsc --noEmit` covers `src/**` (so the `@ts-expect-error` assertions in `contract.test.ts` are checked
at compile time). The `vitest` suite has no runtime to exercise: it checks the shapes, the enums, the
one status mapping, the readiness transition table, the withdrawal bounds and the validators. There is
still **no implementation** — nothing in this workspace imports the package.
