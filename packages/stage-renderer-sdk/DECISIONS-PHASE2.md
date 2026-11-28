# Phase 2 decisions — mounts, host surfaces, prompt and the migration service

This is the decision record for **Phase 2** of [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md): the choices
made while building the mount host, the prompt service and arbitration, the panels/pickers, the speech transport
guard, the migration service and its surfaces, the four-way entry table, and the architecture guards.

Read together with:

- the plan's §5 (what Phase 2 must contain) and §5.8 (its exit criteria);
- [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) — where this file and
  the RFC disagree, the RFC wins and the code is wrong;
- [`DECISIONS-PHASE1.md`](./DECISIONS-PHASE1.md) for the host core and the stub this phase builds on.

Entries are numbered `P2-D*` so they cannot be confused with the plan's `D*`, Phase 0's `P0-D*`, Phase 1's
`P1-D*`, or the driver obligations `D-*`.

---

## The prompt

### P2-D1 — One classifier decides the pair; assembly and activation both use it

§5.4's table is six rows, and two different places need the answer: activation (which may *act* — seed the store) and
prompt assembly (which may only *read*). Writing the table twice would be the bug the table exists to prevent, so
`classifyPromptPair({ binding, device, snapshot })` is a pure function in the host core and both paths call it.

The consequence that matters: **a conflict suppresses injection by being re-derived, not by being stored.** The
plan says "the character carries a 'prompt conflict' flag"; a stored flag can go stale after an arbitration, a
rebind or a driver republication, so `injectable()` re-classifies from the two copies AIRI already holds and returns
nothing for a conflict. It is cheap (two in-memory values) and it cannot disagree with the surface that shows the
dialog.

**Raised once per distinct version pair.** A driver that republishes on every activation must not turn a standing
disagreement into a dialog the user dismisses repeatedly, so `reconcile` reports `raise: true` only the first time
it sees a given `(device.version, card.version)` pair. The set lives in memory on purpose: "raised once" is a
property of a session's UI, and persisting it would let a conflict stay silent forever on another device.

### P2-D2 — Seeding hands the pair back to the driver

The table's third row — "the card is the only copy" — says *seeded to the store at activation (text and tokens); the
counter is set so the next publication is strictly newer*. That is not just a store write. A driver with a fresh
empty history would publish `version: 1` next, and the store would discard it as stale against the card's `12`.

So seeding delivers the seeded pair through the same `onResolution` path an arbitration uses. The driver's own
numbering continues from what AIRI now holds, and the stub fixture proves it: `prompt-flow.test.ts` asserts the
driver recorded version `12` after a card-only seed.

### P2-D3 — The renderer→main half of `onResolution` did not exist, and now does

Phase 1 built the host→driver half (P1-D26: `HostPromptService.onResolution`, delivered over
`modelDriverPromptResolutionEventa`), but nothing could *produce* one: the arbitration surface is Phase 2, and it
lives in a renderer, while the delivery is addressed to the window running the driver's entry.

`HostClient.deliverPromptResolution({ driverId, publication })` is that missing half: the window that arbitrated
writes the store and the card, then asks main to hand the pair back. `ModelDriverHostPush` gained
`{ kind: 'prompt-resolution' }`, and the service delivers it to every window holding a **manager channel or a live
mount** for that driver.

**Why both.** The in-process suite found the gap: a surface starts its own entry with `ensureEntry` (P1-D19), so a
window can run a driver's code with no manager channel ever having been opened to it. Addressing only by channel
would have failed exactly the case the plan says panels need — while the mount list is the registry's own record of
"this window runs this driver". `delivered: 0` is reported rather than swallowed: "the driver never heard about the
decision" is a fact a diagnostics surface should be able to show.

---

## The binding

### P2-D4 — The avatar table is pure, and the card helpers never touch the frozen field

`resolveAvatarState` (host core) takes the facts — driver status, model/profile presence, whether the legacy
renderer still exists — and returns the row, whether it renders, whether it is an error, and the action. It reads no
card, no store and no record, which is what lets §5.6's eight rows be asserted as a table with no Pinia.

`packages/stage-ui/src/libs/model-drivers/binding.ts` is the card seam: read, write, clear, resolve. Two rules are
enforced there rather than in each view:

- **`{}` and absent are the same state**, and neither is materialized on read;
- **nothing in it writes `extensions.airi.modules.displayModelId`.** A helper that took a card and returned one with
  the frozen field changed is the exact bug guard 9 forbids (D10). `withCardBindingCleared` writes `avatar: {}` and
  leaves the frozen id alone, because the revert transaction writes that id from the driver's
  `LegacyRestorePayload` (D9), in one transaction.

---

## Renderer entries and surfaces

### P2-D5 — The loader table resolves four kinds, and "ships none" is `null`

`DriverLoaderTable` gained `resolveMount`/`resolvePanels`/`resolvePicker` and the matching `mounts()`/`panels()`/
`pickers()` lists. They are **required**, not optional: a table that omits a kind cannot answer the startup check
§4.7 asks for, and an optional member would make "this build has no panel loader" indistinguishable from "this build
has no panels".

The manager's `null` (a driver that ships no such entry) is a **value**, not a failure: the adapter answers
`{ ok: true, value: null }` and the surface renders nothing. Only an *unknown specifier* is `invalid-entrypoint`.
The app's table maps all four to the fixture behind `includeStub`; the in-process harness deliberately resolves only
the provider, because it has no Vue.

### P2-D6 — The fixture's components are a fourth subpath, so the harness stays Vue-free

The stub's mount/panel/picker are render-function components (`defineComponent` + `h`), not SFCs: an SFC would need
an SFC build in a package whose only renderer dependency is `vue` itself. They live behind
`@proj-airi/stage-renderer-sdk/testing/components` rather than in `./testing`, because the Node suites import
`./testing` and a barrel that pulled Vue in would break every one of them. The package therefore has four entries,
and the app's Vite aliases match `/testing/components` before `/testing`.

The components read the fixture's **per-window** stub session (`stubWindowSession`), which the app's own entry
registers. It is deliberately not auto-registered by `startStubProviderEntry`: the in-process harness runs two
windows in one module instance, and an auto-populated map would let the second overwrite the first (the same reason
P1-D29 refused a module map).

### P2-D7 — The adapter hands out the `HostServices` a panel is mounted with

`ModelDriverPanelProps.services` is required by the contract, and a panel usually lives in a different window than
the mount it edits. The only object that built that container is the adapter, so `adapter.servicesFor(driverId)`
returns it, and `MountHost`/`DriverPanelHost` start this window's entry (`ensureEntry`) before asking. A window with
no running entry answers `undefined` and the host shows the fallback rather than mounting a panel against a lie.

### P2-D8 — MountHost sends the load on `ready-for-model`, and a model change is a cue

`MountHost` registers the mount, starts the entry in its own window, resolves the component through the manager and
mounts it with props. It sends the `LoadCue` **when the mount reports `ready-for-model`**: a cue to a `mounting`
mount is refused `renderer-not-ready`, and queueing one would race the driver's own first frame. A `model` prop
change re-arms the same load instead of remounting, because the mount survives a model change and only a driver
change replaces it (§5.6).

The two rules from the contract are obeyed structurally: there is no size prop (the container is the viewport) and
no model prop (the model arrives by cue).

---

## Speech

### P2-D9 — The frame bus has no cue channel, and the sidecar relay is one named port

`createSpeechFrameBus` cannot send a cue: it is not given a `CueChannel`, and its publish path is a local fan-out, a
broadcast port and the `sidecarRelay` port — the single documented main crossing (§5.5, D3). A frame that is not a
frame is dropped rather than fanned out; a `mouthOpen` outside `0..1` is refused rather than sent as a sentinel,
because "no mouth concept" is absent, not `0`.

The behavioural half of guard 10 is `transport.test.ts`: thirty frames create no broker transaction and deliver no
cue, a `speech-frame` cue is refused by the validator and by `assertNotSpeechCue`, and a cue that addresses the stub
mount still works while frames flow. The source half — no production file invents the cue kind — is the
`speech-as-cue` guard.

---

## Migration

### P2-D10 — A ports-only runner in stage-ui, and resume by driver provenance

The service lives at `packages/stage-ui/src/libs/model-drivers/migration.ts` as the plan says, but it takes ports and
owns no store: it runs in the shared background window on desktop and in the page on Web/Pocket, one model's bytes at
a time, and it must be testable without a Pinia, a window or an IndexedDB. `migration.test.ts` drives it that way.

**Resume is `findImportedModel(legacyModelId)`, not a host-side attempt record.** §6.5 step 4 says a retry re-uses
the ids a crashed attempt already committed, and the check-then-skip is against *the driver's own rows* — the driver
retains the legacy id inside its handover, so it, not AIRI, is the authority on "did I already import this". A
host-side attempt key would have been a second source of truth for exactly the thing the driver owns (D8, D14) and
would have needed a new key the plan's framework does not document.

**Two honest limits, labelled rather than hidden:**

- **Quota detection is a heuristic.** The contract has no `insufficient-storage` failure code, so a park is
  classified as `quota` only when the driver's own message mentions space, quota or storage. The park happens
  either way; only the reason string and the suggested remedy depend on it.
- **Partial is terminal.** A stop between models, a park or a failed deletion leaves what committed committed and
  reports `N of M`. Nothing is rolled back, and the next run rebuilds the queue from the legacy collector rather
  than from the previous report, so a parked model is retried and a skipped one is not lost.

---

## Guards, environment and surfaces

### P2-D11 — Guards are a script with a generated allowlist, and the shrink rule is enforced

`scripts/assert-model-driver-guards.mjs` reads seven patterns from `scripts/architecture-guards/legacy-patterns.json`
— the single exempt path, because a guard that contained its own patterns would fail its own scan. The allowlist was
generated once, at Phase 2 start, with `--update`, and the check asserts three things: no new match outside the
list, every allowlisted file still matches (an entry that no longer does has been fixed and must be removed), and
nothing else in the tree mentions the patterns.

**Tests are skipped** (`skipTestFiles`, on by default). A suite's literal `{ displayModelId: 'x' }` is a fixture,
not a writer, and a suite importing a renderer store harms nothing; including them would have put a dozen test paths
in the allowlist and buried the one production write that matters. Nothing is lost: the guards that need real
execution are suites, not scans.

The counts at freeze (second generation, after the test skip): renderer imports 48, renderer store channels 5,
format settings keys 17, legacy renderer seams 31, `display-model-` 10, `displayModelId` writes 29, speech-as-cue 1
— 1,990 source files scanned, all seven guards green. Two guards are behavioural and asserted where they can be
executed: the main bundle assertion (Phase 1) and the speech transport suite (this phase).

### P2-D12 — New host surfaces ship literal English strings, and the i18n pass is owed

`MountHost`, `DriverPanelHost`, `DriverPickerHost`, `AiriModelPicker`, `UnavailableModelView`,
`PromptArbitrationDialog` and `MigrationScreen` carry their copy inline. The repository rule is that translations
live in `packages/i18n`, and this is a deliberate, recorded deviation rather than an oversight: adding keys needs
the yaml manager and ten locales, and none of these surfaces is reachable by a user in Phase 2 (the only route that
mounts them is the dev spike). **Before the first format cutover (Phase 3) the keys must be added**, or these
surfaces ship untranslated.

### P2-D13 — Web/Pocket in-process hosts are still deferred, now for the same reason as before

P1-D13 deferred them to Phase 2 because nothing consumed them. Phase 2 built the *host UI* that would consume them,
but that UI is mounted by Electron's dev route only, and both web apps' typechecks are outside the surface this
session could run (no `node_modules`). The host UI is platform-neutral by construction — it takes the adapter as a
prop and never imports Electron — so the remaining work is composition, next to the surface that needs it.

**Rules out:** claiming §4.1's Web/Pocket row is literal. It is deferred a second time, explicitly.

### P2-D14 — The VRM spike is a route plus a report, and it gates Phase 3

`apps/stage-tamagotchi/src/renderer/pages/devtools/model-driver-vrm-spike.vue` mounts the stub on all five Phase 2
surfaces at once and runs the VRM-specific checks (per-instance state, the mandatory two-mount case, capture in the
ack, `occupiesPoint`/`hitTest` reachability, profiles as outfits, prompt publication). Its conclusions are
[`VRM-SPIKE.md`](./VRM-SPIKE.md).

**The spike reports two obligations as unproven by the fixture, not as failures.** The stub never emits
`hit-area-change` or `animation-finished`, so D-3 and D-2 are confirmed by the contract and remain driver work; the
spike cannot certify a shape it never exercises. Everything else it can reach, it reaches through the real host.

### P2-D15 — What this session could and could not execute

`vitest` cannot start in this environment and never could here: Vite bundles `vitest.config.ts` with `esbuild`, and the
sandbox refuses the esbuild service spawn (`spawn EPERM`) before a single suite is loaded — so no `--pool` or reporter
flag helps. The dependencies were installed part-way through the phase, which changed what *can* be run: `tsc` and
`vue-tsc` need no child process, so the typechecks ran and are now part of the evidence rather than a gap. What was
executed:

- **the SDK's 17 suites through the committed fallback runner** (`node --experimental-transform-types
  scripts/run-suites.mjs`, from `packages/stage-renderer-sdk`): **17 suites, 269 tests, 0 failed**. That is the
  Phase 1 nine suites (193) plus this phase's eight — `core/binding.test.ts`, `core/prompt-service.test.ts`,
  `prompt-flow.test.ts`, `pointer.test.ts`, `transport.test.ts`, `storage.test.ts`, `entry.test.ts` and
  `stub-driver.test.ts` — plus six cases added inside the existing adapter suite (11 → 17);
- **the stage-ui and app model-driver suites through the same runner**, given explicit paths: **5 suites, 42 tests,
  0 failed** — the three stage-ui suites (33) and the two app suites this phase added for the IPC contract (9). The
  app suites open a real `broadcast-channel` eventa pair per test, so the runner gained `beforeEach`/`afterEach`;
  they are the first suites in this repository to exercise a model-driver contract over a transport that is not
  Electron. Executing all of them was worth it rather than ritual: **two product/test defects surfaced that review had
  missed** — `withCardBinding` dropped the card's existing snapshot on a rebind that carried none, contradicting its
  own documented rule (fixed by carrying the card's copy forward; `classifyPromptPair` already reads such a snapshot as
  `foreign` for the new binding, so it cannot leak into another model's prompt), and the quota-park scenario seeded the
  fake's `failImport` flag while also expecting its second import to succeed, which parked both models (test fixed,
  not the service). Both were invisible to `node --check`, which only proves a file parses;
- **three typechecks, all clean**: `tsc --noEmit` in `packages/stage-renderer-sdk`, `vue-tsc --noEmit` in
  `packages/stage-ui`, and the app's `typecheck:node` + `typecheck:web`. This is where the phase's deepest defects were
  found, because `import type` and Vue prop declarations are erased before any suite runs: `RendererMountPoint`
  imported from a module that only declares it (TS2459); the fixture's mount/panel/picker declared `String`/`Object`
  props where the contract wants an enum or `HostServices`, which made all three components unassignable to their
  contract types behind a cast; `MountHost` sending `kind: 'load'` as a string where `CueKind.LOAD` is required;
  an unused `active` computed in the panel frame; and contract-failure codes written as string literals in the
  migration suite instead of the enum. Ten errors in total, none reachable by a runtime suite;
- **`node scripts/assert-main-dom-free.mjs`**, which Phase 1 recorded as unrunnable: it needs `typescript`, and now
  that it is installed the assertion runs — **147 modules reachable from the main entry, no renderer runtime module
  among them**, with two main-side aliases it cannot follow named explicitly. Phase 1's bundle claim is verified for
  this tree, not merely carried forward;
- **the architecture guards**: `node scripts/assert-model-driver-guards.mjs` green over 1,995 files (7 guards).

What is **owed and not claimed**: `vitest` itself (the sandbox blocks it, so the fallback runner remains the evidence
for every suite above), `node scripts/audit-test-catalog.mjs` (it shells out through `cmd.exe`, denied here), and the
VRM spike page by hand. The plan's §5.8 evidence table records each criterion's state against exactly this list.

### P2-D16 — Pointer input: one conversion, in the window that owns the element

Exit criterion 6 asks that pointer events arrive box-relative for one mount while a second mount is unaffected. Phase 1
recorded `HostServices.pointer` as inert (P1-D14) on the grounds that a conversion needs a box to measure. That is
true, and the box exists the moment a surface mounts — so this criterion was implementable in Phase 2, not deferred
to the overlay work, and it is now implemented.

**Where the conversion lives.** `host/core/pointer.ts` is the pure half: a hub keyed by registry-issued mount id, a
conversion function, and the `RendererPointerService` a driver receives. `MountHost.vue` is the impure half: it owns
the element the mount draws in, measures it, and forwards DOM events. The SDK keeps its no-DOM rule, and the only
place that knows a rectangle exists is the host UI that already had the element.

**One hub per window, not per driver.** A mount id is unique in a window, and the UI measuring a box does not know or
care which driver's component sits inside it. Every driver's container receives the same service, so a panel and a
mount of one driver cannot disagree about where the pointer is.

**The box is a function, read per dispatch.** Layout, scrolling, a window resize and a drag all move a box while the
mount lives; a rectangle captured at subscribe time would convert every later gesture against geometry that no longer
exists. The hub asks the source only when it has at least one subscriber, so a pointer move over a mount nobody is
observing costs nothing — no `getBoundingClientRect`, no allocation.

**Capture-phase listeners on the mount's own element.** A renderer that calls `stopPropagation` in its own handler
must not be able to starve itself of the stream it is supposed to read, and the host is the documented route; the
contract's "MUST NOT convert a second time" then means the renderer consumes the service instead of `clientX`. Each
mount forwards only its own element's events, which is what makes a second mount unaffected structurally rather than
by a filter.

**Release before the host is asked.** `unregisterMount` drops the mount's box and subscriptions before awaiting the
host: the element is going away either way, and a subscription kept for it would be a listener on a box nothing
measures.

**No clamping, no DPR scaling, contained exceptions.** A captured gesture legitimately leaves the box, so negative and
over-range points are preserved; the contract's space is CSS pixels, so scaling stays the renderer's business; and one
renderer's throwing handler is reported to the hub's `onError` and does not stop the other subscribers.

**Evidence.** `pointer.test.ts` (14 cases: the conversion, two mounts side by side, negative/over-range, box re-read
per dispatch, no measurement without subscribers, an unknown mount accepted and never called, unsubscribe and release,
a stale unsubscribe from a released mount not silencing a new subscription for the same id, a contained exception,
`dispose`, and every field of the translated event including the wheel unit and the clock) plus one adapter case that
proves the container a driver is activated with receives the adapter's own hub.
**Not claimed:** `MountHost.vue`'s listeners and `getBoundingClientRect` are not executed by any suite here — a Node
suite has no DOM — so the wiring at the element is review and the dev spike page, while everything it delegates to is
asserted.

### P2-D17 — The IPC half is a transport-agnostic table, so the mapping is testable

The review question that produced this decision was blunt: *are these invokes testable, or is the only way to exercise
them a running Electron app?* The answer was the latter, and the fix was not a new abstraction layer — eventa already
is the abstraction, and this repository already uses seven of its adapters (`electron/main`, `electron/renderer`,
`broadcast-channel`, `event-target`, `webworkers`, `webworkers/worker`, `websocket/native`). A hand-rolled
`Transport` interface beside it would have been a second, weaker copy of the same idea.

Three changes, each with the same shape — move the decision behind a value the test can supply:

1. **The invoke table is its own module.** `apps/stage-tamagotchi/src/main/services/model-drivers/handlers.ts` holds
   the thirteen `defineInvokeHandler` registrations, parameterised by `resolveSender` (which window sent this) and
   `control` (the host service). The composition root keeps what only it can do: `webContents` → window id, the push
   transport, `state.json`, window-closed. `resolveIpcSender` is exported and pure, so the Electron-specific
   `raw.ipcMainEvent.sender` extraction is asserted directly, including its absence.
2. **The client is typed against eventa's generic context**, not `ReturnType<typeof createContext>['context']` from
   `electron/renderer`. `HostClientContext = EventContext<any, any>` means the same client can be constructed over a
   `broadcast-channel`, `event-target` or worker context — which is what Web/Pocket (P2-D13) needs, and what makes the
   suite real rather than mocked.
3. **The fixture components declare their contract types.** `String as PropType<RendererMountPurpose>` and
   `Object as PropType<HostServices>` instead of bare `String`/`Object`: a bare declaration resolves the prop to
   `string`, which silently made the stub mount/panel/picker unassignable to `RendererMountComponent`,
   `ModelDriverPanelComponent` and `ModelPickerComponent` — hidden by a cast until `tsc` ran.

**What this buys.** Both sides of the contract now run against a real transport in Node: `handlers.test.ts` drives the
table with a fake service and asserts sender attribution, payload pass-through and the `INTERNAL` / `shutting-down`
refusals; `eventa-client.test.ts` drives all thirteen invokes and four pushes through `createEventaHostClient`. A
mistyped channel name fails a test instead of hanging an invoke nobody made in development.

**What it does not buy.** The section that decides *which* `webContents` is a window (`windowIdOf(sender.id)`) and the
push transport (`emitTo` → `createContext(ipcMain, window)`) are still Electron-bound and unpinned; they are small, and
pinning them would mean mocking `BrowserWindow`, which is a worse trade than leaving them to the manual smoke list.
The app suite remains the honest boundary: the table is tested, the process plumbing is reviewed.

