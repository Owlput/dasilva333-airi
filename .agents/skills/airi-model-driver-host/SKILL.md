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
| Host UI: mount, panels, picker, migration, arbitration | `packages/stage-ui/src/components/scenes/MountHost.vue`, `components/scenarios/settings/model-drivers/` (the Phase 2 frames; the real stage and Settings → Model use `DriverModelDialog` + `DriverPickerHost`, `RendererStage` renders the new path and raises `PromptArbitrationDialog` at activation, and `AiriModelPicker` is the binding dialog's fallback source — `MigrationScreen` is the only frame still unplaced, P2-D18. `ModelImportPanel` is mounted by the dev route, by Settings → Model through the dialog, and on `requestImport` by `DriverPickerHost`. Keys: host surfaces `settings.pages.models.model-drivers.*`, the stage overlay `stage.model-drivers.prompt-arbitration.*`; a driver's own records travel in its package under `model-drivers.{driver}.*` and the app merges them) |
| Card binding and prompt seam, migration service | `packages/stage-ui/src/libs/model-drivers/{binding,prompt,migration}.ts` |
| First real driver (Phase 3, Live2D first) | `packages/model-driver-live2d/` — `src/{manifest,manager}.ts` (DOM-free), `src/{provider,prompt,profile}.ts` (storage, probe/import, prompt publication, appearance), `src/import.ts` (the `IMPORT` entry the host import panel calls), `src/mount/Live2DMount.vue` + `src/live2d/view.ts` (per-instance Pixi), `src/panels/` (appearance, prompt, capabilities), `src/picker/`; dev route `apps/stage-tamagotchi/src/renderer/pages/devtools/model-driver-live2d.vue` mounts `ModelImportPanel`, the driver's own picker and panels around one `MountHost` |
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
`DriverPanelHost`/`DriverPickerHost`, which pass `services` from `adapter.servicesFor(driverId)` — read **after**
`ensureEntry` resolves, because the map behind `servicesFor` is not reactive.
`MountHost` also registers the element's box with `adapter.pointer` and forwards capture-phase events; the renderer
reads them through `services.pointer.subscribe(mountId, …)` (P2-D16).

**Render the new path on the stage.** `RendererStage.vue` reads the active card (`readCardBinding`): a card that
parses to an `AvatarBinding` renders a `MountHost` for that driver, a card without one keeps every legacy scene
branch. The two are exclusive — a card can hold both fields during the reversal window — and the verdict comes from
`resolveAvatarState` over host facts (`libs/model-drivers/avatar-state.ts`: `hostState()` for the driver status,
`pullRows()` for the model and profile), so a model the driver no longer holds shows `UnavailableModelView` rather
than an empty mount. The stage imports no app module: the adapter arrives through `provideModelDriverHost`, provided by
the app entry (`App.vue`) after first paint, and an undefined adapter means `driver-missing` (web/Pocket). The same
injection carries the window's `HostPromptService`, which the binding dialog uses to reconcile the card's prompt
snapshot in the same write (§5.4). User actions that need to bind a model open `DriverModelDialog`, which is the only
mounted caller of `bindCardModel`/`withCardBinding`; it writes `extensions.airi.avatar` and never
`modules.displayModelId` (P3-D18).

**Add a driver entry kind or specifier.** Both halves must agree: the manager's `entry` in the driver package, the
app's static `shared/model-driver-specifiers.ts`, and the renderer loader table. The registry refuses a manifest
whose `entry.manager` does not match; the adapter refuses an unknown specifier as `invalid-entrypoint`. The loader
table is keyed by `ModelDriverEntryKind` and has one lookup (`resolve(kind, specifier)`); add a row, not a code
path. Kinds today: `provider`, `mount`, `panels`, `picker`, `import`.

**Reconcile a prompt at activation.** `reconcileModelPromptForCard` → `classifyPromptPair` → seed / store / conflict.
A seed and an arbitration both deliver through `adapter.deliverPromptResolution`, which the service routes to every
window holding a channel or a mount for that driver.

**Open the import panel from a picker.** A picker never imports. It obtains the input itself (its own
`<input type="file">`, a drop, or a builtin's bytes), shows the affordance only when the host supplied the
`requestImport` callback (`DriverPickerHost` offers it only when `adapter.importEntry(driverId)` answers), and calls
`requestImport({ files })`. The frame opens `ModelImportPanel` with `:files` and `driverIds: [driverId]`, so the
panel skips its chooser, probes only that driver's `import` entry, and turns the first committed `selection` into a
`select`. The callback returns a promise that resolves when the panel closes — the only signal the picker gets.
Adding a `HostServices` method for this is wrong — opening the panel renders a host component, which a service
cannot do — and it is a callback rather than a prop/emit pair so the picker contract does not depend on Vue.

**Picking is a proposal, not a write.** A mounted picker lists its own driver storage (never the row cache) and
keeps its selection local: only an explicit user action emits `select({ modelId, profileId })` — an existing pair,
no probe, no mint, no publication. The caller binds `extensions.airi.avatar` and only then loads; the mount survives
the change. Order: select → bind → load (P3-D17). The picker may instead **fork to import** by calling
`requestImport({ files })`; the frame opens the panel and returns a committed pair through the same `select`, so
both branches feed the same bind and nothing downstream can tell them apart. The promise resolves when the panel
closes and nothing else is handed back; the driver then syncs its own storage — the host never relays the imported
rows.

**Run a migration.** Supply `MigrationPorts` from the legacy collector, `buildHandover` lazily one model at a time,
`importModel` without `overwrite`, and `commit` as one transaction (records + profile + card bindings + marker).
Resume relies on the driver's provenance (`findImportedModel`), not on a host-side attempt key.

The driver half is retention and restore (`packages/model-driver-live2d/src/legacy.ts`, P3-D20): `migrate` writes the
entry once under `legacy/{modelId}` (files base64), answers `retained: true`, names in `unused` every member it will
never interpret, and is a no-op on replay — a repeat must keep the first `retainedAt`, and a *different* legacy id
under the same minted `modelId` is `model-id-conflict`. `restoreLegacy` answers the legacy id plus the same opaque
members, preferring the imported row's bytes over the retained copy, and refuses `asset-missing` when no origin was
retained. `remove` deletes the retained entry with the model; `purge` takes everything. The import that consumes a
retained entry by reference is **not built yet**: the contract's `confirmImport` note allows a commit with no `input`,
but nothing can obtain `confirmImport` without a probe over files, so `migrate` must not import on its own.

**Drive a bound character with ACT.** `ActCue` carries the token verbatim; the driver owns the meaning. The Live2D
manifest declares `CueKind.ACT`, `./act` projects the published forms (`<|ACT:emotion="…"|>`, `<|ACT:motion="…"|>`) and
the mount applies them through the same code path as an expression/motion cue. The host sends the cue only when the
active card is bound and this window has an adapter (`ControlStripHost`), and its legacy four-way store dispatch runs
otherwise — the same condition the stage uses to pick what renders, so one character is never driven twice. A token the
catalogue does not name is refused as `unknown-key`; it is never guessed into a fallback motion.

**Add a guard.** Patterns go only in `scripts/architecture-guards/legacy-patterns.json`; run
`node scripts/assert-model-driver-guards.mjs --update` to freeze them, and delete an allowlist entry in the same
change that fixes its violation (the check fails on a stale entry).

## Verification

```bash
# the contract, adapter, host core, host service, host UI logic and the fixture
pnpm -F @proj-airi/stage-renderer-sdk test      # 22 suites / 323 tests
pnpm -F @proj-airi/stage-renderer-sdk typecheck
pnpm -F @proj-airi/model-driver-live2d typecheck
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck   # node + web (vue-tsc)
node scripts/assert-model-driver-guards.mjs
node scripts/assert-main-dom-free.mjs
```

The Live2D driver's nine suites (57 assertions) run without `vitest` through the fallback runner, because they are
pure TS and node ports:

```bash
pnpm -F @proj-airi/stage-renderer-sdk exec node --experimental-transform-types --no-warnings \
  scripts/run-suites.mjs ../../packages/model-driver-live2d/src/{manifest,storage,manager,prompt,profile,panels,import,legacy,act}.test.ts
```

The IPC contract has two suites in the app that run over a real `broadcast-channel` eventa pair, so neither needs
Electron: `src/main/services/model-drivers/handlers.test.ts` (the invoke table) and
`src/renderer/libs/model-drivers/eventa-client.test.ts` (the `HostClient` mapping). Run them from the repo root:

```bash
node --experimental-transform-types --no-warnings packages/stage-renderer-sdk/scripts/run-suites.mjs \
  apps/stage-tamagotchi/src/main/services/model-drivers/handlers.test.ts \
  apps/stage-tamagotchi/src/renderer/libs/model-drivers/eventa-client.test.ts
```

The host UI logic in `packages/stage-ui/src/libs/model-drivers/` is Vue-reactive but has no `.vue` file, so the same
fallback runner covers it without a component renderer:

```bash
pnpm -F @proj-airi/stage-renderer-sdk exec node --experimental-transform-types --no-warnings \
  scripts/run-suites.mjs ../../packages/stage-ui/src/libs/model-drivers/binding.test.ts \
  ../../packages/stage-ui/src/libs/model-drivers/prompt.test.ts \
  ../../packages/stage-ui/src/libs/model-drivers/migration.test.ts \
  ../../packages/stage-ui/src/libs/model-drivers/avatar-state.test.ts \
  ../../packages/stage-ui/src/libs/model-drivers/reason.test.ts
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
- The six host frames were unplaced until the Live2D slice; "a panel renders in settings" is still only true where a
  frame is mounted. Today the placed ones are `MountHost` (in `RendererStage` and the dev routes), `DriverPanelHost`
  in Settings → Model, `DriverPickerHost` plus `AiriModelPicker` through `DriverModelDialog` (the dialog switches to
  AIRI's list when the driver frame emits `no-picker`), `PromptArbitrationDialog` from `RendererStage` at activation,
  and `ModelImportPanel` through the dialog and the picker's `requestImport`; `MigrationScreen` is not mounted
  anywhere real. An empty panel list looks identical to a working one, so check the mount site before believing a
  surface works (P2-D18, P3-D18, P3-D22).
- **Driver UI text ships in the driver package, and the host merges it.** A driver's components are mounted by
  whatever host wants them, so their records live with the driver — `packages/model-driver-live2d/src/locales/{en,index}.ts`,
  exported as `./locales`, namespaced `model-drivers.{driver}.*` — not in `packages/i18n`, whose `base`/`settings`/`stage`
  roots are the host's file split rather than a feature namespace. `model-driver-live2d` declares `vue-i18n` (catalog)
  and its picker/panels call `useI18n()`; the **app** merges each installed driver's bundle
  (`renderer/libs/model-drivers/locales.ts` lists them, `modules/i18n.ts` calls `mergeLocaleMessage` before mount). A
  host that mounts driver UI without merging renders key strings — visibly wrong, not broken. A driver's Node suites
  stay DOM-free and never load these components, so the fallback runner is unaffected. Panel tab labels come from the
  driver's declarations, which are built outside a component instance and cannot call `useI18n()` — they stay
  driver-declared names (P3-D22, P3-D23).
- `adapter.servicesFor(driverId)` reads a plain `Map`, so a `computed` that calls it **before** `ensureEntry` resolves
  caches `undefined` for that frame's whole life and the picker never mounts. Read it after the entry starts and put
  it in a `ref` (`DriverPickerHost` does).
- A card can hold both `extensions.airi.avatar` and the frozen `modules.displayModelId` during the reversal window:
  the stage branches on the binding and must not also render the legacy scene, or the character is drawn twice
  (P3-D18). The same rule governs actions: a bound card's ACT tokens go over the cue channel and must not also reach
  `live2dStore.triggerEmotion`/`triggerMotion` (P3-D19).
- A driver's `migrate` retains; it does not import. Importing there would leave a row behind when the host records a
  refusal and would make the host's check-then-skip (§6.5 step 4) skip a model the host never marked (P3-D20).
- **A preview is a driver product, written by the mount that rendered the model** (P3-D21). `writeModelPreview` is a
  one-field read-modify-write on an existing record and a no-op when the model is gone; never let it create a record,
  and never let it write on every mount — a record that already has a preview is left alone.
- **A driver never mints an identity and never imports unasked.** Import is the host's dialog — input, probe,
  confirmation, minted ids, commit, bind — and the driver supplies the code that reads its format and writes the
  bytes: the `IMPORT` entry, `createImportEntry({ services })` → `{ probe }`, loaded through `resolveEntrypoint`
  and the loader table exactly like a mount. `ModelImportPanel.vue` is the host half and owns the merge, the
  confirmation and the ids — it asks `adapter.mintModelId()`/`mintProfileId()`, never a local minter, so two
  panels cannot collide; `ModelDriverAdapter.importEntry(driverId)` builds the driver half with the window's
  container. A picker that imported a model itself would create it in the background with nobody asked (P3-D12);
  it asks with `requestImport` instead, and the host frame opens the panel. Nothing is added to
  `ModelDriverManager` or `HostServices` for this.
- **Prompt publication is an obligation, not a nicety.** Setting `capabilities.prompt: true` promises at least one
  publication per model **and profile** after activation; publish the *stored* pair on activation (a re-mint per restart
  is a version storm), bump only when the text actually changed, and record the host's arbitrated version through
  `prompt.onResolution` instead of republishing it (P3-D13).
- **A profile body is driver state, applied through one pure function.** `computeFit` is the placement rule; the view is
  its only drawing caller. A `PROFILE` cue with `persistent: false` is a try-on — apply it, but do not adopt it as the
  mount's saved profile, or `ResetScope.PROFILE` will restore the try-on. Live edits arrive through `storage.watch`, not
  a cue per slider move (P3-D14).
- **`HostServices.storage` JSON-serializes values.** It is unstorage over IndexedDB, so a `Uint8Array` stored through
  it comes back as a numeric-keyed object, silently. The Live2D driver stores its `.zip` as base64 for that reason
  (`packages/model-driver-live2d/src/storage.ts`); a driver that needs real binary needs a raw setter or its own
  blob store, not `set()`.
- A real driver's `./mount` module must have a **default export**, and the provider entry must forward `deliver` to the
  mounts it registered in the window — `MountHost` never calls `exposed.cues.handle` itself.
- Pinning the new driver package into the lockfile by hand (offline machine): add its importer block and the app's
  `link:../../packages/...` entry, then `pnpm install --offline --frozen-lockfile --ignore-scripts`. The offline
  store may be missing a tarball for an unrelated app; that is why frozen (no re-resolution) is required.
