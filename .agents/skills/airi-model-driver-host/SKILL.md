---
name: airi-model-driver-host
description: >-
  Build/debug the RFC 0002 stage-driver host: mounts and surfaces, prompt publication and
  arbitration, card avatar binding, speech frames, and the user-requested migration gate.
  Contract shapes live in airi-character-rendering; stage shells in airi-stage-ui-surfaces.
---

# Model driver host (RFC 0002, phases 0–2)

The stage-driver migration moves rendering off `RendererStage` and the four renderer stores onto a contract with a
host half and a driver half. This skill owns the **host**: what AIRI decides and persists. What a driver must
implement is `airi-character-rendering`'s subject; the shells that mount the host are
`airi-stage-ui-surfaces`.

Read the source of truth before changing behaviour:

- `packages/stage-renderer-sdk/IMPLEMENTATION_PLAN.md` — §2 decisions D1–D18, §4 Phase 1, §5 Phase 2, §8.5 guards;
- `packages/stage-renderer-sdk/DECISIONS-PHASE{0,1,2}.md` — the choices each phase made and what they rule out;
- `docs/rfcs/0002-model-driver-contract.md` — normative. If the plan and the RFC disagree, the RFC wins.

## Where things live

| Concern | Path |
| :--- | :--- |
| Contract types, validators, compatibility | `packages/stage-renderer-sdk/src/{contract/,validate.ts,compatibility.ts}` |
| Renderer adapter (transport-free) | `packages/stage-renderer-sdk/src/host/adapter.ts`, `client.ts`, `loaders.ts`, `storage.ts`, `services.ts` |
| Host core: registry, broker, mounts, records, prompts | `packages/stage-renderer-sdk/src/host/core/` |
| Prompt reconciliation / arbitration, avatar table | `src/host/core/prompt-service.ts`, `src/host/core/binding.ts` |
| Pointer conversion (box measured per dispatch, per mount) | `src/host/core/pointer.ts`; the element and listeners are `MountHost.vue` |
| Speech frame bus (observation only) | `src/host/speech.ts` |
| Host service (main's decisions, no Electron) | `src/host/service.ts` |
| Stub driver, harness, in-process host, fixture components | `src/host/testing/` (`./testing` is Vue-free; components are `./testing/components`) |
| Electron resources (windows, IPC, `state.json`) | `apps/stage-tamagotchi/src/main/services/model-drivers/`, `src/shared/model-drivers-eventa.ts` |
| Renderer wiring and loader table | `apps/stage-tamagotchi/src/renderer/libs/model-drivers/` |
| Host UI: mount, panels, picker, migration, arbitration | `packages/stage-ui/src/components/scenes/MountHost.vue`, `components/scenarios/settings/model-drivers/` |
| Card binding and prompt seam, migration service | `packages/stage-ui/src/libs/model-drivers/{binding,prompt,migration}.ts` |
| Guards | `scripts/assert-model-driver-guards.mjs`, `scripts/architecture-guards/legacy-patterns.json`, `scripts/assert-main-dom-free.mjs` |

## Load-bearing invariants

1. **Main holds no web storage.** It owns declarations, flags, the row *cache*, mount descriptors, the broker and
   the entry relay; records, prompts and driver storage live in a renderer. A feature that needs to write a record
   from main has to move to a renderer (P1-D1).
2. **Mount ids are registry-issued.** A renderer cannot construct one; `registerMount` is the only source.
3. **Acceptance is not settlement.** `submit` answers `{ nonce }`; the outcome arrives on the settled push, and
   `NO_TARGET` is a *settled successful* outcome the originating adapter receives — never one it decides.
4. **A mount survives a model change.** Only a driver change replaces it. The model arrives by `LoadCue`, sent when
   the mount reports `ready-for-model` — a cue to a `mounting` mount is `renderer-not-ready`.
5. **The prompt has two homes and one authority.** The driver owns it and its version history; AIRI keeps the
   current publication at `local:model-drivers/prompt/{driver}/{model}/{profile}` (the only assembly input) and the
   card keeps a complete portable snapshot (text **and** tokens). A disagreement is detected by AIRI and arbitrated
   by the user; the host writes `max + 1` and hands the pair back through `HostPromptService.onResolution`
   (P1-D26, §5.4).
6. **A conflicting prompt injects nothing**, and the "conflict" state is re-derived from the two copies rather than
   stored (P2-D1). An empty publication `('', [])` is a value; "nothing published" by a prompt-capable driver is a
   fault.
7. **`extensions.airi.avatar` absent ≡ `{}`**, and legacy is "no `avatar.modelId`" — never "no object". A missing
   model is not an error; a missing profile is (D4, §5.6).
8. **Nothing but the migration/revert path writes `modules.displayModelId`.** It is frozen at cutover (D10).
9. **Speech frames are observation, not cues.** Latest-wins, no ack, no retention; the Stage-Mate sidecar relay is
   the single main crossing (D3, §5.5).
10. **Migration is user-requested, gated by arithmetic, and partial is terminal.** Nothing moves until the user
    asks; normal mode needs the library's size free, progressive needs the largest model's; a park stays on the
    legacy path with a reason and the run continues (D13, D17).
11. **Pointer input is converted once, per mount.** The element's box is read at dispatch time (a mount moves), the
    hub is keyed by registry mount id, points are not clamped and not DPR-scaled, and a mount that unregisters
    releases its subscriptions before the host is asked (P2-D16). A renderer that converts `clientX` itself is
    the violation; the contract says consume `services.pointer`.

## Workflows

**Mount a driver component.** `MountHost` → `adapter.registerMount` (registry id) → `adapter.ensureEntry` (this
window runs the code) → `adapter.mountComponent` (manager names the specifier; the loader table imports it) → props
(no model, no size) → `LoadCue` on `ready-for-model`. Panels and pickers mount through
`DriverPanelHost`/`DriverPickerHost`, which pass `services` from `adapter.servicesFor(driverId)`.
`MountHost` also registers the element's box with `adapter.pointer` and forwards capture-phase events; the renderer
reads them through `services.pointer.subscribe(mountId, …)` (P2-D16).

**Add a driver entry kind or specifier.** Both halves must agree: the manager's `entry` in the driver package, the
app's static `shared/model-driver-specifiers.ts`, and the renderer loader table. The registry refuses a manifest
whose `entry.manager` does not match; the adapter refuses an unknown specifier as `invalid-entrypoint`.

**Reconcile a prompt at activation.** `reconcileModelPromptForCard` → `classifyPromptPair` → seed / store / conflict.
A seed and an arbitration both deliver through `adapter.deliverPromptResolution`, which the service routes to every
window holding a channel or a mount for that driver.

**Run a migration.** Supply `MigrationPorts` from the legacy collector, `buildHandover` lazily one model at a time,
`importModel` without `overwrite`, and `commit` as one transaction (records + profile + card bindings + marker).
Resume relies on the driver's provenance (`findImportedModel`), not on a host-side attempt key.

**Add a guard.** Patterns go only in `scripts/architecture-guards/legacy-patterns.json`; run
`node scripts/assert-model-driver-guards.mjs --update` to freeze them, and delete an allowlist entry in the same
change that fixes its violation (the check fails on a stale entry).

## Verification

```bash
# the contract, adapter, host core, host service, host UI logic and the fixture
pnpm -F @proj-airi/stage-renderer-sdk test      # 17 suites / 269 tests
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck   # node + web (vue-tsc)
node scripts/assert-model-driver-guards.mjs
node scripts/assert-main-dom-free.mjs
```

The IPC contract has two suites in the app that run over a real `broadcast-channel` eventa pair, so neither needs
Electron: `src/main/services/model-drivers/handlers.test.ts` (the invoke table) and
`src/renderer/libs/model-drivers/eventa-client.test.ts` (the `HostClient` mapping). Run them from the repo root:

```bash
node --experimental-transform-types --no-warnings packages/stage-renderer-sdk/scripts/run-suites.mjs \
  apps/stage-tamagotchi/src/main/services/model-drivers/handlers.test.ts \
  apps/stage-tamagotchi/src/renderer/libs/model-drivers/eventa-client.test.ts
```

If `vitest` cannot start (sandbox without child-process stdio), the package ships
`pnpm -F @proj-airi/stage-renderer-sdk test:fallback`, which runs the same suites — any suite in the repository, given
its path — without Vite or esbuild. It now supports `beforeEach`/`afterEach`. A suite needing `vi.fn`, snapshots or
module mocks cannot run there — that is the intended signal, not a bug to work around.

Manual smoke that no suite replaces: the Electron eventa hop (`webContents` identity, `emitTo`, `state.json` on disk),
the shared background window, and the dev routes (`/devtools/model-driver-stub`,
`/devtools/model-driver-vrm-spike`).

## Pitfalls seen in practice

- A channel is part of an **address**: an `any` row-pull channel must not be reused for `acting/acting` (P1-D19).
- A window that self-starts an entry with `ensureEntry` has no manager channel; prompt delivery must also target
  windows holding a mount (P2-D3).
- `rows` and `model-list-changed` are different events: the first is "the cache was just written", the second is
  "re-read the authority" (P1-D20).
- The renderer adapter must not be imported from a host-core module (cycle); host code imports `../contract`.
- The fixture's components import Vue, so they live behind `./testing/components`; adding them to `./testing` breaks
  every Node suite.
- Two windows in one process share module state: the in-process harness passes its session via a callback, never a
  module map (P1-D29).
- The model-driver invokes are a **table** (`services/model-drivers/handlers.ts`) with `resolveSender` and the service
  injected, not fourteen closures inside the composition root: closing over `ipcMain`/`webContents` there is what makes
  the mapping reachable only from a running app (P2-D17).
- Type the eventa client against `EventContext<any, any>`, not the Electron renderer's context type, or a second
  transport means a second client (P2-D17).
- A Vue prop declared as bare `String`/`Object` resolves to `string`/`Record<string, any>`, so a component whose
  contract wants an enum or `HostServices` silently becomes unassignable — use `PropType<T>` (P2-D17).
