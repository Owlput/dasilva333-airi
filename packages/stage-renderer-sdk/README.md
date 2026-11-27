# @proj-airi/stage-renderer-sdk

Contract between AIRI and a **model driver** (VRM / Live2D / Spine / MMD
today, and anything else later).

> **Status: contract, renderer adapter, host core and host service, at `0.1`.** The contract shapes are `0.1`,
> the first shipped shape, produced by Phase 0 of
> [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md); `0.0.x` was a draft and is refused by
> `isContractCompatible`. Phase 1 moved the renderer adapter here (`src/host/`, P1-D24): it has no
> transport of its own and is written against `HostClient`, which the desktop app satisfies over
> its typed IPC and a Web/Pocket build will satisfy in-process. It also moved the host here (P1-D27), so the
> package has three entries: `.` for the contract and adapter, `./host` for the host core and the host service
> that turns it into the operations a host process exposes, and `./testing` for the stub driver and harness.
> This release is **first-party only**: the
> package stays `private` and source-only; third-party distribution is deferred until the contract and
> renderer host are stable. See "Deliberate non-goals".
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
| `src/contract/registry.ts` | AIRI | the manager's registry handle (`log`, `requestRenderer`, `listDrivers`, `isEnabled`, `onChange` — driver-level changes plus the addressed `channel-closed` report), the opaque `ManagerChannel`, entry kinds and resolution types, and the adapter's registry client with `registerMount` — the only source of mount ids |
| `src/contract/adapter.ts` | AIRI (renderer) | the window's adapter: mints `modelId`/`profileId`, never a mount id; requests entry points; loads and activates the runtime; hands out the service container and the manager channel |
| `src/contract/lifecycle.ts` | both | the main-process manager (rows, entry resolution, delivery, withdrawal, mount queries/commands, analyzer request) with its `createManager(handle)` factory shape, and the renderer runtime (capability probe, transfer, purge, per-model migration and revert), plus the cross-window mount registry |
| `src/contract/provider.ts` | driver | model provider: two-phase probe (`files`/`url` → `parts`) + `confirmImport(selections, input)` settling each entry on its own / list / remove / preview / modelCapabilities / vocabulary / profiles / model transfer |
| `src/contract/components.ts` | driver | driver-level UI: settings panels, the model picker and its `select` contract, and the opaque bundle that moves a whole driver |
| `src/contract/capabilities.ts` | driver | capability kinds (including `effect` and `pointOfInterest`), the renderer's descriptors, and the ACT token vocabulary |
| `src/contract/renderer-mount.ts` | renderer | one mounted viewport: props (no size — the container is the viewport), emits, exposed methods (the cue sink, the occlusion query, the interaction hit test), readiness; capture travels as a cue, not as a method |
| `src/contract/cues.ts` | both | one transactional cue vocabulary addressed by driver + surface + purpose, the ack (answering driver, per-slot outcomes, no `requestId`), the acceptance/settlement split, seven transaction states and six withdrawal requests with their bounds |
| `src/contract/migration.ts` | both | one legacy model going into a driver (`ModelDriverLegacyHandoverEntry` → report `retained`/`unused`) and one coming back out for a revert (`LegacyRestorePayload`, carrying the legacy id) |
| `src/contract/host-services.ts` | AIRI | the service container injected at activation: log, driver-namespaced storage, the prompt channel (`ModelPromptPublication` — text and tokens as one versioned pair — published by the driver and, after an arbitration, handed back through `onResolution`), cues, the pointer stream, theme, runtime facts, bridge |
| `src/contract/references.ts` | AIRI | every record and view AIRI keeps with no driver available: the named model, its profiles, the character's model binding, the lightweight model summary, the pending payload, driver status, why a model is unavailable, and the one mapping between those last two |
| `src/contract/plugin-port.ts` | AIRI | the plugin-level speech analyzer: the frame stream that replaced a driver-side `AudioNode` |
| `src/compatibility.ts` | AIRI | `isContractCompatible`: same minor below 1.0, same-or-older minor from 1.0, with a readable rejection |
| `src/validate.ts` | AIRI | the executable checks: declaration (including that `entry` names nothing but the manager), capability completeness, envelope rules, ack shape, withdrawal requests, prompt publication and its fault state, readiness transitions |
| `src/host/client.ts` | AIRI (renderer) | the adapter's client interface to the host's services (`identify`, mounts, readiness, cues, entry points, host state, the manager channel) plus the four value shapes it carries, so a renderer needs no transport |
| `src/host/adapter.ts` | AIRI (renderer) | the per-window adapter: identity resolved once, mount registration, the cue channel with its settlement buffer, entry start/reuse/ensure, the per-driver storage namespaces composed from the window's primitives, and `dispose`. Takes `{ client, storage, prompts, loaders }` and nothing app-specific |
| `src/host/loaders.ts` | AIRI | the loader-table interface: a specifier becomes a module only through a table the build owns, and an unknown specifier is `invalid-entrypoint` |
| `src/host/services.ts` | AIRI | the `HostServices` container a driver is activated with, including the two members that are deliberately inert until a host surface exists |
| `src/host/storage.ts` | AIRI (renderer) | the window's storage primitives (`WindowStorage`: get, set, remove, a prefix scan — driver-agnostic and reusable), the prompt sink, and the one function that composes a driver's namespace from them (`createDriverStorage`) with its in-window `watch` hub |
| `src/host/logging.ts` | AIRI | the default `HostLogger` (console, `[driver]`-prefixed) and the silent one the host core uses when no logger is given, so an embedder needs no logging dependency |
| `src/host/core/registry.ts` | AIRI (host) | the driver registry: declarations read before any manager code, one manager per enabled driver, the row cache and enable flags, `requestRenderer` and its reuse/fallback order, entry resolution, the persisted snapshot |
| `src/host/core/broker.ts` | AIRI (host) | the cue broker and transaction table: validation, one correlation counter, acceptance versus settlement, FIFO, `NO_TARGET`, deadlines, the six withdrawals, window-gone |
| `src/host/core/mounts.ts` | AIRI (host) | the live mount registry: registry-issued ids, descriptors only, readiness transitions, change notifications |
| `src/host/core/records.ts`, `src/host/core/prompts.ts`, `src/host/core/keys.ts`, `src/host/core/ids.ts` | AIRI (host) | the host's own records (models, profiles, markers, pending payloads), the current prompt copy, the storage key space and the id minters |
| `src/host/core/host.ts` | AIRI (host) | `createHostCore`: the in-process composition of registry, broker, mounts, records and prompts over one `WindowStorage` |
| `src/host/core/storage.ts` | AIRI (host) | the in-memory storage backend the harness and the tests use |
| `src/host/service.ts` | AIRI (host) | the host service: the operations a host process exposes (`registerMount`, `submitCue`, `pullRows`, `setEnabled`, the entry relay, manager messages) plus the `state.json` debounce and the window-closed/shutdown ordering, written against transport, window, state and scheduler ports |
| `src/host/testing/stub-driver.ts`, `src/host/testing/harness.ts` | AIRI (fixture) | the stub driver (manifest, manager, runtime, provider, mount, panels, picker, the full migration surface) and the harness every host suite drives |
| `src/host/testing/in-process.ts`, `src/host/testing/stub-entry.ts` | AIRI (fixture) | the in-process host — the real service and one real adapter per window joined by a loopback transport — and the stub's provider entry with the session it creates; what `src/host/in-process.test.ts` drives |
| `scripts/run-suites.mjs`, `scripts/suite-assertions.mjs` | CI / local | the fallback that executes the suites where `vitest` cannot start — no Vite, no esbuild, no child process: suite discovery, the module-resolution hooks, and the small `describe`/`it`/`expect` subset. It reads nothing outside this package, which is why it lives here and not in the repository's `scripts/` |

## Deliberate non-goals

- No transport, no dependency-injection container, no plugin loader — the existing plugin host owns
  discovery and enable/disable, and each driver declares its own entries. The renderer adapter takes an
  injected `HostClient`, injected storage primitives and an injected loader table, so Electron, eventa,
  IPC, the database and "which
  specifiers does this build ship" all stay in the application.
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
  validators, the compatibility predicate and the adapter's own implementation (`src/host/`). Every
  closed vocabulary is an `enum`, so its members are named, documented and exhaustively checkable where
  a consumer switches on one. Everything else is a type. There is also no `./types` subpath, because `.`
  is already the whole contract.

## Validation

```bash
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/stage-renderer-sdk test
```

`tsc --noEmit` covers `src/**` (so the `@ts-expect-error` assertions in `contract.test.ts` are checked
at compile time). Nine files cover the contract's shapes, enums, readiness transitions, withdrawal table
and validators; the renderer adapter against a faked host port; the host core (registry, broker, mounts,
records, prompts, backup); the host service against four ports; and the in-process host, which composes the
real service with real adapters over a loopback transport and asserts the chain the dev route demonstrates.
What no headless suite covers is the part only Electron has — the `webContents` identity, the eventa hop,
`state.json` on disk, the `BrowserWindow` and the shared background window — and a manual run of
`/devtools/model-driver-stub` is smoke for exactly those.

Where the real runner cannot start — Vite bundles its config with esbuild, and esbuild needs a child
process — the same files run through a fallback that ships with this package:

```bash
pnpm -F @proj-airi/stage-renderer-sdk test:fallback
# or, with an explicit Node: node --experimental-transform-types --no-warnings scripts/run-suites.mjs
```

[`scripts/run-suites.mjs`](./scripts/run-suites.mjs) resolves the package's entries and imports every
`*.test.ts` under `src/`; [`scripts/suite-assertions.mjs`](./scripts/suite-assertions.mjs) is the subset of
vitest's API those files use. Neither reads anything outside this package, which is why they live here
rather than in the repository's `scripts/`. The fallback exists so a spawn-restricted environment can still
produce executed evidence. It is not a second framework: it has no transform, mocking or reporters, a suite
that needs `vi.fn`/`beforeEach` fails loudly rather than silently passing, and
`pnpm -F @proj-airi/stage-renderer-sdk test` remains the authoritative command.
