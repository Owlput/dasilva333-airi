# Phase 1 decisions — host core and the stub driver

This is the decision record for **Phase 1** of [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md):
the choices made while building the host core and the host service and wiring them into
`apps/stage-tamagotchi`. The plan's §2 records host choices (D1–D18) and [`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md)
records the contract's; this file records what *this phase* decided, so a later reader can tell a deliberate
shape from an accident.

Read together with:

- the plan's §4 (what Phase 1 must contain) and §4.9 (its exit criteria);
- [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) — where this file and
  the RFC disagree, the RFC wins and the code is wrong;
- the source: every entry below is visible as a comment at the shape it produced.

Each entry has the same form: **decision**, **why**, **what it rules out**. Entries are numbered `P1-D*` so they
cannot be confused with the plan's `D*`, Phase 0's `P0-D*`, or the driver obligations `D-*`.

---

## Shape of the host

### P1-D1 — Main composes three pieces, not `createHostCore`

Electron main creates the mount registry, the driver registry and the cue broker directly. It does **not**
instantiate `createHostCore`. `createHostCore` — with the record store, the prompt store, the minter, the cue
channels and the backup — is what a *renderer* instantiates, and what Web/Pocket will instantiate in-process.

**Why:** `HostCoreDependencies.storage` is mandatory, and main must not have web storage at all (§1.7, §4.2, D1).
Passing a memory port to satisfy the type would have created a record store in main that silently answered from
nothing — the exact "main is holding a second copy" failure the plan spends D1 ruling out. The three pieces main
does need have no storage dependency, so the composition is honest without a fake.

**Rules out:** a later feature "just writing a record from main". There is no record store there to write to; a
change that needs one has to move to a renderer, which is the intended shape.

### P1-D2 — The window identity is the `webContents` id, assigned by the host

A renderer's `windowId` is `w<webContents.id>`, derived in main and handed to the renderer by
`modelDriverIdentifyInvokeEventa`. A renderer never sends its own id: `registerMount` has no `windowId` field at
the IPC boundary, and every other handler resolves the acting window from the IPC sender.

**Why:** `MountRegistrationRequest` carries a `windowId`, and the host core already overwrites it with the sender's
own (§4.3). Leaving the field out of the IPC contract makes that override unconditional rather than defensive. The
same derived id is why no second registry of windows has to be kept: a window that reloads keeps its identity, and
a window that closes takes its mounts with it.

The identify call doubles as the **capability registration**: only a window whose adapter identified itself is
offered to a manager as a renderer (`liveWindows`). The alternative — enumerating `BrowserWindow`s and trying them
— would have had main guessing which windows run the app entry, and a wrong guess costs a 10-second entry timeout.

### P1-D3 — Acceptance and settlement are two IPC channels, and both ends buffer early settlements

`submit` answers `{ nonce, settledImmediately? }` immediately. The outcome arrives later as
`modelDriverCueSettledEventa` pushed to the window that asked, resolved against its correlation value.

**Why:** a `Promise` cannot cross IPC, and awaiting settlement inside the invoke would make acceptance look like an
outcome — the distinction RFC §9.3 exists to preserve. Both ends keep a small map of settlements that arrived
before a caller attached its resolver, because a round trip through main is not instantaneous and an answer must
not be lost to a race it cannot observe.

**Rules out:** a renderer deciding its own settlement. `NO_TARGET` arrives from main as a settled outcome; the
adapter never synthesises one.

### P1-D4 — Entry resolution is relayed, never decided, and only the addressed window may answer

`requestRenderer` → registry → manager naming `{ specifier }` → main relays `modelDriverOpenEntryEventa` to one
window → that window imports the specifier from its loader table and answers
`modelDriverEntryResultInvokeEventa` → main records the result and returns a `ManagerChannel`. An unanswered
request is refused `entry-failed` after 10 s. An answer from a window the request was not sent to is refused.

**Why:** §4.7 gives the manager the choice and the adapter the import. Relaying keeps both true: main never imports
a renderer module, and the loader table never receives a specifier it was not asked for by a manager. The
`requestId` and the sender check make a stray or forged answer a refusal rather than a channel to the wrong window.

**Rules out:** a "fallback entry" when a manager names an unknown specifier. That is `invalid-entrypoint` at the
adapter and `entry-failed` at main; nothing substitutes another module.

### P1-D5 — The manager channel transports `unknown`, per window and driver

`ManagerChannel.send`/`onMessage` move `unknown` in both directions. Main reads nothing inside a message; it looks
up the channel by `(window, driver)` and hands the payload to every listener. The protocol — this fixture's
`call`/`result`/`notify` — belongs to the driver.

**Why:** §4.3 and D3 say so, and the stub is written as two halves precisely so the property is exercised rather
than asserted. A channel per `(window, driver)` also means a closed window drops exactly the channels that pointed
at it.

### P1-D6 — The stub driver is registered only by a development build

`firstPartyDriverTable({ includeStub: is.dev })` and `firstPartyDriverLoaders({ includeStub: import.meta.env.DEV })`
mean a production build ships neither the manager entry nor the provider entry. Both sides load the fixture through
a dynamic `import()`, so even a build that contains the chunk never fetches it.

**Why:** §4.8 wants the fixture to exist and §4.1 wants no host UI shipped; a fixture registered as a production
driver would put a model list nobody asked for in front of a user. The specifier strings live in
`apps/stage-tamagotchi/src/shared/model-driver-specifiers.ts` so the static main table and the renderer loader
table cannot drift, and drift that does happen is caught loudly: the registry refuses a manifest whose `id` or
`entry.manager` does not match, and the adapter refuses an unknown specifier as `invalid-entrypoint`.

**Rules out:** adding a real driver in Phase 1. The four real drivers arrive one per phase (Phase 3+), each adding
its six subpaths and one line in the table.

## The background window

### P1-D7 — The quit gate is "the last counted window closed", not `window-all-closed`

`window-all-closed` can never fire while the background window is open, so main quits when no **quit-relevant**
window is left: every `browser-window-created` window gets a `closed` listener, and the decision is
`shouldQuitNow(BrowserWindow.getAllWindows())` with the background window excluded by its tag. macOS keeps its
existing stay-alive behaviour.

**Why:** D11 says the window is never part of the quit decision. Without this, adding the window would have made
the app unquittable — a hidden window with no close affordance is exactly the shape that silently prevents
`window-all-closed`. The predicate is a pure function in `windows/background/policy.ts` so the rule is inspectable
and testable rather than an emergent property of three event handlers.

Two details the first draft got wrong, kept here because both are invisible until the app is used:

- **One close reaches the decision twice.** When the last counted window closes, `window-all-closed` fires *and*
  that window's own `closed` listener runs, so the hooks would tear down twice. The gate is therefore a one-shot
  latch; it is reset whenever *any* window is created, because on macOS the app deliberately outlives its windows
  and `activate` builds a new one — a latch that survived that would skip teardown on the second close. Resetting
  on any creation rather than only a quit-relevant one is deliberate: `browser-window-created` fires synchronously
  inside `new BrowserWindow()`, before the background window has been tagged, so a tag-based filter would read the
  wrong answer at that moment.
- **The window list is read a tick later.** Electron can emit `error` *after* `closed` when a window failed to
  load, and a window in that state is still in `getAllWindows()`. Deciding synchronously in the `closed` handler
  would therefore answer "a window is left" for a window that is already gone, so the predicate is asked from
  `setImmediate`.

### P1-D8 — Consumers are named claims; the window still lives until shutdown

`acquire(reason)`/`release(reason)` record a `Set` of reasons, not a counter. A retried request cannot leak a
claim, and a claim is released on completion. Releasing the last claim does **not** close the window: D11 and §4.2
step 5 say a started background window lives until shutdown, so a `release` only drops the claim.

**Why:** a counter would have to be paired perfectly across two call sites in two phases (a manager request and the
migration runtime), and an unpaired `acquire` would leave a phantom consumer forever. Named claims are idempotent,
readable in a diagnostics surface, and make the "who still needs this" question answerable.

`start` is single-flight, a failed start is not remembered (a later request may retry), and `isStarted` asks whether
the window is *alive* rather than whether a start once succeeded — a window the user closed is not a started
lifecycle.

### P1-D9 — `backgroundThrottling: false` is declared as data

The required `webPreferences` are exported as `BACKGROUND_WINDOW_WEB_PREFERENCES` and spread at the one place the
window is created, and the policy test asserts the value.

**Why:** it is the whole reason the window exists (§4.1, D11), it is invisible in behaviour until a deadline is
late, and Electron gives no way to observe it from a unit test without Electron. Declaring it as data puts the
requirement next to the rule it serves and lets a test fail if someone removes it.

## Persistence and process boundaries

### P1-D10 — IPC failures are narrowed to `{ code, message }`

`ContractFailure`'s `cause` and `details` are opaque and not structured-cloneable in general, so every failure
crossing the boundary is rebuilt from its code and message, and the adapter reconstructs a `ContractFailure` on the
other side.

**Why:** a serialization failure here surfaces as a broken invoke rather than as the driver error it stands for,
which is the least debuggable outcome available. Losing `cause` across a process boundary is the cost; the message
is the part a user is shown.

### P1-D11 — `state.json` is written atomically, serialized and debounced

Writes go to `state.json.tmp` and are renamed into place; concurrent writes are chained so two snapshots never
interleave; flag and row events are debounced by 250 ms and flushed at shutdown and immediately after `start()`.
A missing or corrupt file degrades to the default snapshot with a warning.

**Why:** the flags in this file are the difference between "the driver the user turned off" and "a driver that
silently re-enables itself", so a torn write is a user-visible trust failure, not a cosmetic one. Degrading rather
than throwing keeps a corrupt file from being a boot failure over a display cache.

### P1-D12 — The SDK is source-only and is bundled into main

`@proj-airi/stage-renderer-sdk` (and, at the time this was written, `@proj-airi/stage-driver-host` — P1-D27 merged
it into the SDK) is a `devDependency` of the app, listed in `electron.vite.config.ts`'s aliases (both processes),
and mapped in the root `tsconfig.json` (plus the app's `tsconfig.web.json`, whose `paths` replace the root's rather
than merging).

**Why:** the app's `externalizeDeps` externalizes `dependencies`, so a source-only workspace package listed as a
dependency would be `require`d at runtime from a `src/*.ts` entry point and fail in a packaged build. `stage-shared`
is the precedent: a source-only package in `devDependencies` gets bundled.

The paths mappings exist because this workspace cannot run `pnpm install` (its store database is unavailable in the
authoring environment), so the workspace packages are not linked into `node_modules`. They are harmless once the
packages are linked and are what make `tsc` usable today. **A real `pnpm install` must run before this branch is
published**, to relink the workspace and refresh the lockfile.

### P1-D13 — Web/Pocket in-process hosts are deferred to Phase 2

`apps/stage-web` and `apps/stage-pocket` get no `libs/model-drivers/` in Phase 1.

**Why:** §4.1 lists them, but nothing in Phase 1 consumes them: the dev-only stub route is an Electron route, both
apps' typechecks are heavy and were not part of this phase's verified surface, and a module with no importer is
unverifiable dead code in two applications. The host core is platform-neutral by construction (ports for storage and
windows, no Electron, no DOM), so the Phase 2 host UI is where the in-process composition gets written — next to
the surface that uses it.

**Rules out:** claiming §4.1's table is fully literal. This is the one row deliberately deferred, and it is
recorded here rather than quietly skipped.

### P1-D14 — Two `HostServices` members are inert, and `subscribe` is local

`pointer` accepts subscriptions and never calls them; `theme` reports accent hue 0 and light mode; the adapter's
`CueChannel.subscribe` observes the envelopes this window sent, not the bus-wide stream.

**Why:** the pointer conversion belongs to the overlay work in Phase 2 (§5.3) and a synthetic pointer stream would
give a mount a second coordinate space that nothing can reconcile. Theme comes from the app's settings store, which
is Phase 2's host UI. Bus-wide observation needs a broadcast channel, which is Phase 2 too. Each is documented at
its member, and the contract already says a missing or reduced service is a reduction in capability rather than a
crash.

**Rules out:** a mount in Phase 1 that reacts to the pointer or to the theme. The dev route does not need either,
and the first real mount (Phase 3) gets them when the host has a container to measure.

## Verification

### P1-D15 — The build assertion is a standalone script, and it was verified by breaking it

`scripts/assert-main-dom-free.mjs` walks main's import graph with TypeScript's own module resolution, skipping
type-only imports and third-party internals, and separately checks driver manager modules for renderer imports.

**Why:** §4.7 asks CI to fail if a renderer runtime module is reachable from the main entry. A vitest test would
have needed the same resolution and would have been un-runnable in the authoring environment; a script needs
neither a build nor an Electron process and is one line in CI. It was verified empirically: a temporary
`import { ref } from 'vue'` in a main-process module made it exit 1 with the file and line, and removing it restored
exit 0 (139 modules reachable, none a renderer runtime module; it was 133 before the host-side storage helpers moved
into the SDK, which added those modules to main's graph).

**Correction (2026-11-27).** Two things were wrong above. The count is now **142** after the host core, service and
storage moved into this package (P1-D27). More importantly, the manager half inspected **nothing**: it matched
`src/driver/manager.ts` (no such file — no driver package exists until Phase 3) plus one literal path at
`packages/stage-driver-host/src/testing/stub-driver.ts`, which P1-D27 deleted. The set was empty, so the pass returned
no violations for the trivial reason, and the script still printed OK. The path now points at
[`src/host/testing/stub-driver.ts`](./src/host/testing/stub-driver.ts), and the OK line reports how many
manager/convention modules were inspected, so an empty set is visible next time instead of silent.

### P1-D16 — Contract over plan: a closed window settles `window-gone`, never `aborted`

`ModelDriverHostService.shutdown` is the only path that settles `aborted`. A window going away settles
`window-gone` (delivered) or `cancelled` (undelivered) through `broker.windowClosed`, and the host core settles
whatever the broker did not know about as `window-gone`.

**Why:** RFC §9.6 reserves `aborted` for "the host aborted the work", and a closed window did not abort anything —
the contract wins over plan §4.4 step 8 and §4.9 criterion 2, which said `aborted`. Both are corrected to match.

A related ordering rule is structural: `windowClosed` settles the broker **before** dropping the mounts, because
`unregisterWindow` emits a change that pumps the broker — and a pump with no candidates would settle queued work
as `NO_TARGET`, which claims nothing ever matched for a transaction that was waiting on exactly the window that
just went away.

### P1-D17 — What the host-core suites can and cannot claim

`vitest` cannot run inside the authoring sandbox — its transform pipeline spawns a child process with piped
stdio, which the sandbox denies (`spawn EPERM`) — so the suites were executed by hand with
`pnpm -F @proj-airi/stage-renderer-sdk test` (they lived in `@proj-airi/stage-driver-host` at the time; P1-D27
merged that package into this one). The first full run was **63 passed, 3 failed**. Every failure was
in the fixture or in a test's own expectation, not in the host core:

1. **The stub cached its channels on the driver state.** `StubDriverState.channels` outlived the manager that
   filled it, so after `restartManagers` the *new* manager found a channel in the cache and returned it
   **without wiring its reply routing** — the wiring happens where the channel is opened. Its first `listModels`
   then waited for a reply nobody routed, and the test timed out at 5 s. The cache now lives in the manager
   closure, which is the honest model: a channel belongs to the manager that opened it, and the registry's own
   cache is what makes a *second* request reuse it. Correlations also moved to a module-level counter, because
   after a restart two instances can be wired to the same channel object and each routes replies into its own
   `waiting` map; per-instance ids would let the released instance consume the live one's reply.
2. **`requestRenderer` does not fail just because a live window refused the entry** — it falls back to the
   shared background window (§4.3). The test asserted a total failure from a single refusing window, so it was
   asserting the opposite of the design. It now refuses in every window, and a second test pins the fallback:
   a refusing live renderer is not the driver's answer.
3. **A `HostServices` object only exists after a window has run the provider entry.** The storage-namespace
   test read `services()` after mounting, but mounting a descriptor does not activate a runtime; it now opens
   the entry first, which is also what makes the test prove the property it names — two windows, two services
   objects, one namespace.

What the suites mean, precisely: the broker, registry, records and host suites assert against the real host
core with a fake renderer; the background-window suite asserts the policy with no Electron at all. Nothing here
executes an IPC hop, a `BrowserWindow`, IndexedDB or the unstorage prefix mapping.

**Update (2026-11-27).** Run outside the sandbox by the project owner. `pnpm -F @proj-airi/stage-renderer-sdk test`
→ **9 files, 193 tests, all passing** (1.72 s), so criterion 1 is executed by the real runner, not only by the
committed fallback — and the two agree exactly, which is the useful part: the fallback was introduced as a
workaround and has now been checked against the thing it stands in for. `pnpm vitest run --project
@proj-airi/stage-tamagotchi` → **10 files, 66 tests, all passing**, which includes the 13 policy cases of criterion 7,
so the app-level suite is executed too. (`-F @proj-airi/stage-tamagotchi test` remains wrong: that package has no
`test` script.) What is still uncovered is the Electron half — the eventa hop, `webContents` identity, `state.json`
on disk and the `BrowserWindow` — which no suite here touches (P1-D29).

The three fixes above were then re-checked one case at a time by executing those four paths under Node's type
transform instead of `vitest` — all four pass — but a **full re-run is still owed** before this count is
evidence rather than a claim.

The declared commands:

```bash
# the host core and host service suites (this package has a `test` script)
pnpm -F @proj-airi/stage-renderer-sdk test

# the app's suites — the app has no `test` script, and `pnpm -F @proj-airi/stage-tamagotchi test`
# matches nothing and exits 0, so it looks like a passing run and is not one
pnpm vitest run apps/stage-tamagotchi
```

This entry exists so the phase's evidence is not overstated: the plan's §4.9 lists the criteria and this
record marks which are proven by execution and which by review plus typecheck.

### P1-D18 — The dev route ships, and is inert outside development

`pages/devtools/model-driver-stub.vue` is a file-based route, so — like every other `/devtools/*` page in this
app — it is present in a production bundle. §4.9's criterion 6 says "no host UI module is shipped", which that
would contradict by one file. Rather than redefine the criterion, the page now carries an
`import.meta.env.DEV` guard: outside development it renders one line of text, and its eager
`bootstrapModelDriverAdapter()` call is skipped.

**Why not exclude the file from the build?** The app has no dev-only route mechanism — `unplugin-vue-router`
turns the folder into routes for every build, and the ten sibling devtools pages ship the same way. Inventing an
exclusion path for one page would be a build-config change to protect a page that is already harmless: the stub
driver is only registered when `is.dev` (P1-D6), so in production every button on it could only answer
`driver-disabled`. The guard makes that visible instead of leaving a screen that silently fails.

**Rules out:** claiming the route is absent from production, and claiming it does anything there.

### P1-D19 — A channel is part of an address, and a running entry is never restarted for it

Found by the first manual run of the dev route, which is exactly what that run is for. The page pulled rows
before registering its mount, and the pull never returned: `whenStubSession` timed out after 5 s. The pull had
made main ask *the stage window* — the first live window, with no mount at all — to start the stub's provider
entry. Three defects sat behind that, the third only visible once the first two were fixed:

1. **Reader: the channel cache was address-blind.** `requestRenderer` reused "any channel this driver already
   has", so a channel opened to answer a row pull (an *unaddressed* request: "any window that can run this
   code") was later reused for `{ surface: 'acting', purpose: 'acting' }`. That delivered the cue to a window
   holding no acting mount, which could only answer `NO_TARGET`, while the window that did hold the mount never
   heard about it. The cache is now keyed by window, driver **and the address the channel was opened for**, and
   step 1 only matches an identical address; every other request goes through the ranking, which prefers a
   window that actually holds a matching mount. One window can therefore hold several channels for one driver
   (an unaddressed one and one per surface it serves), which is what `(window, driver)` authentication in the
   contract already allowed.
2. **Writer: the adapter replaced a running entry.** A second request for the same driver's entry called
   `entries.get(driverId)?.dispose?.()` and started a fresh half. Once the fix above makes two channels to the
   same window normal, that would have killed the half owning the window's mounts and answered the host with a
   channel to a half that knows nothing about them — the mounts would silently become unreachable. A running
   entry now answers the request id and is left alone.
3. **A pull binds the unaddressed channel wherever it happens to land, and that is legitimate.** The second
   manual run did the pull *first* (by hand, before pressing Register) and it was served by the stage window.
   The page then registered a mount and re-pulled: the `any` channel was already cached to a window with no
   mount, and the fixture had no way to make this window host the entry. Ordering the page's own buttons was not
   enough, because a user can press anything in any order — and so can any other surface. The real answer is an
   explicit one: `ensureEntry(driverId)` on the adapter, which resolves the driver's provider specifier through
   the host and starts the entry in *this* window without pretending to answer a host request. The host's next
   addressed request ranks the mount-holding window first and finds the entry already there.

**What this says about the design, not just the fixture:** "which window serves an unaddressed request" and
"which window holds the mount" are independent questions, and the contract answers only the second one
(`registerMount` carries the window). A window that wants to receive therefore cannot rely on being chosen — it
has to host the entry itself. Phase 2's panels will need exactly this, so `ensureEntry` is an adapter API rather
than a dev-route workaround.

**Rules out:** treating "any channel for this driver" as good enough for an addressed delivery, treating a
repeated entry request as a reason to restart a window's driver half, and treating a locally started entry as
an answer to a host request it never made.

### P1-D20 — The window is the authority for model metadata; main's rows are a projection that follows it

Model records live in **web storage**, in a renderer, because main has none (§1.7, D1). The driver's own half
gives them their meaning: an id, a profile, what the model is. Main can therefore never be the authority for a
model list — and it is not: `listModels()` is a manager call that main serves by asking *a renderer* over the
manager channel, and `registry.rows` is the answer cached so a picker can paint before a renderer is asked
(§4.3).

The cache was nevertheless treated as if it were the truth in one place, and it drifted: a driver's
`onModelsChanged` signal and a *completed* pull both emitted `{ kind: 'rows' }`. Main persisted on `rows` and
never re-read, so a driver that added or removed a model left `state.json` holding the old list until some
surface happened to pull — the host would show a model that no longer existed, or hide one that did.

Now the two are different events. `model-list-changed` means "the authority moved — go read it"; `rows` means
"the cache was just written from a real read". Main re-pulls on `model-list-changed` (§4.3's pull path,
unchanged), so the projection follows the window within one round trip, and a pull cannot be mistaken for a
change signal — which would loop.

The dev route shows the split directly: **"This window (authoritative)"** reads `stubSession(...).state.models`,
the half's own data, and **"Host cache"** reads what main kept. A difference between them is a stale cache, not
a disagreement about the truth.

**Deliberately not done:** removing `rows` from `state.json` and from `ModelDriverHostState`. The plan wants the
row cache to survive a restart (§4.9 criterion 3) and a picker to paint without waiting for a window, so main
keeps the projection. If main should hold *nothing* — a full synchronize-on-open model — that is a plan change,
not a cleanup, and it should be decided as one.

**Rules out:** persisting a projection without re-reading the authority, using one event for "it changed" and
"it was just read", and showing a window another window's view of the model list as if it were its own.

### P1-D21 — The renderer half takes a port, so the ordinary paths have tests

Until now the two halves that meet at the IPC boundary — the renderer adapter and the main service — had no
tests at all, and every defect that survived Phase 1 lived in one of them. The adapter could not be imported
outside Electron because it built its transport from a preload context and its storage from the app's database.

`createModelDriverAdapter` now takes `{ client, storage }`:

- **`HostClient`** is the whole host surface in one object — the ten invokes, the two messages that carry
  one out, the three pushes, and the one addressed prompt delivery — implemented by
  `createEventaHostClient(context)` over the typed IPC the app ships, so production is unchanged apart from where
  the wiring lives.
- **storage** is injected rather than imported, so `@proj-airi/stage-ui/database/storage` is now reached only from
  `bootstrapModelDriverAdapter`. The adapter has no database of its own.

`adapter.test.ts` then exercises the ordinary paths against a faked host and the **real** stub provider entry:
identity resolved once, a mount registered with the host's id, a readiness step whose refusal is reported rather
than swallowed, a cue accepted with the host's nonce and settled by the pushed event, a settlement that arrives
before the caller attached, a settlement the host decided at acceptance, an entry started once and reused for a
second request, a manager-channel round trip through the real half, and a disposed adapter that stops listening.

**Why the host is faked and the driver is not:** the interesting half of this file is the adapter's protocol
handling, and the port is exactly the interface that protocol has. Faking the *driver* would have removed the
only part that exercises a real message exchange.

**What is still not covered, deliberately:** the main service — `services/model-drivers/index.ts`. It attributes
senders through `raw.ipcMainEvent.sender`, pushes per window with `createContext(ipcMain, window)`, and owns the
background window, so testing it means either mocking `ipcMain` faithfully enough to test the mock, or moving
those two facts behind a transport port. That is the next seam, not a cleanup to sneak in here.

**Superseded in part by P1-D24:** the adapter and this suite no longer live in the app. The port above made the
adapter transport-free, so both moved into `packages/stage-renderer-sdk/src/host/`, and the app keeps only the
eventa implementation (`eventa-client.ts`). One detail of this entry no longer holds: the suite's driver is a small
module defined in the test rather than the host package's stub, because the SDK cannot depend on the host that
depends on it.

## Package ownership

### P1-D24 — The renderer adapter belongs to the contract package, and its transport is a port

The adapter was app code, and its test was app code, for two reasons that turned out to be one: it was built from
an eventa context and from the app's database. P1-D21 removed the second (storage is injected). This entry removes
the first, and then follows the consequence.

**The adapter has no transport.** `HostClient` (`src/host/client.ts`) is the whole host surface — the ten
invokes a renderer may ask for, the two that carry a message out, and the three pushes the host may send it —
expressed in contract types. `createModelDriverAdapter` takes `{ client, storage, prompts, loaders }` and nothing
else: no `context`, no eventa client, no loader table of its own, and no per-driver storage. The eventa implementation moved to the app
(`renderer/libs/model-drivers/eventa-client.ts`), which is now the only file in the app that mentions eventa for
model drivers. Two things were extracted with the adapter because they
are part of its interface rather than of any application: `DriverLoaderTable` and the module shape it resolves
(`src/host/loaders.ts`), and the `HostServices` container the adapter builds for a driver (`src/host/services.ts`,
moved verbatim from the app — it only ever imported the contract).

**The four transport DTOs moved with it.** `ModelDriverFailure`, `ModelDriverSubmitAck`, `ModelDriverHostState`
and `ModelDriverWindowIdentity` describe what the port carries, so they cannot live in an app the SDK would then
have to import. The app's IPC contract (`shared/model-drivers-eventa.ts`) imports them and re-exports them, so
nothing that consumes the IPC contract had to change. The port also returns `ContractResult` rather than the
narrowed `ModelDriverResult`, which removed the adapter's own `toFailure` rebuild: the narrowed failure already
satisfies the contract's result shape (P1-D10).

**`loaders` is required, not defaulted.** The adapter used to fall back to the app's loader table. That made "what
does this build ship" a fact the adapter guessed, and it is the one policy the SDK cannot own: a default would
either carry the fixture into production or refuse a driver the app contains. Every caller now names its table.

**Why the SDK and not a fifth package.** The adapter is the renderer half of RFC 0002, and after this change it
depends on nothing but the contract. A `stage-driver-renderer` package would hold one module and one interface, and
every embedder would import two packages to get one concept. If Web or Pocket want a different service container
or a different loader table, both are already parameters.

**What this costs, stated rather than discovered later:**

1. **The package is no longer "contract only".** `README.md`, `package.json` and `src/index.ts` said so and are
   updated; the runtime-value paragraph in the README now names the adapter too.
2. **The adapter suite no longer runs against the real stub.** At the time, `@proj-airi/stage-driver-host` depended
   on this package, so a devDependency back from the SDK to the host would have been a workspace cycle (P1-D27
   removed that constraint by merging the package in). The manager-channel round
   trip therefore uses a small driver module defined in the test, and the *real* half is exercised end-to-end only
   by the dev route. The alternative — leaving the suite in the app — is what this entry exists to end: the app has
   no `test` script, so `pnpm -F @proj-airi/stage-tamagotchi test` matches nothing and exits 0 (P1-D17), and a suite
   that a per-workspace CI never runs is coverage on paper.
3. **The adapter suite's assertions are unchanged**, all nine of them; only the driver it talks to changed.

**Named for its direction, not the subsystem.** The interface is `HostClient`, the file `src/host/client.ts`, and
the adapter's option is `client`. It was `ModelDriverHostPort`, which named the subsystem and read like a driver
boundary; neither end is outside the host. `HostClient` pairs with the contract's own `HostRegistryClient`: both
are client objects a window holds, and the name says which way the calls go.

**Rules out:** an adapter that has a transport branch instead of a port; an SDK that imports the host; a test suite
that lives in a workspace whose `test` script does not exist; and treating "the app passes a port today" as the
same thing as "the adapter is portable".

### P1-D25 — Storage is layered, and the adapter composes the driver namespace

Three layers, each aware only of the one below it:

1. **the application supplies primitives.** `WindowStorage` — get, set, remove, a prefix scan — knows nothing
   about drivers, records or layout, so any subsystem in the window can take the same object. The app's
   `createUnstoragePort` turns its `unstorage` instance into one, under `local:`.
2. **the adapter composes a namespace per driver.** `createDriverStorage` binds one primitives object to one
   driver id, adds `airi-driver-<driverId>/` on the way in, strips it on the way out, scopes `keys()`, and routes
   `watch` through a per-window hub. `adapter.storageFor(driverId)` is that namespace.
3. **the driver sees `HostStorageInterface`.** Relative keys, its own namespace, no idea where it lives.

**What moved.** `HostStoragePort` was the host package's own name for the primitive; it is now `WindowStorage` in
the contract package, because the adapter needs it and the SDK cannot import the host. `createDriverStorage`, its
`DriverStorageHub` and `driverStorageRoot` moved from `packages/stage-driver-host/src/storage.ts` to
`packages/stage-renderer-sdk/src/host/storage.ts`; the host's `storage.ts` is now only the in-memory backend, and
the host core's `createHost` imports the facade from the SDK (the dependency already pointed that way). The app's
`createRendererHostStorage` no longer composes namespaces: it returns primitives plus the host's record and prompt
stores, and the adapter takes `{ storage, prompts }`.

**Why the adapter and not the embedder.** The adapter is the only object that knows which driver is running and
hands it services, and it is per window, which is the scope a namespace and its `watch` hub need. Doing it in the
embedder also meant two hubs: the app's `storageFor` and the adapter's would have been separate, so a panel and a
driver in one window would not have seen each other's writes.

**Documented limit, not a promise:** `watch` fans out inside the window that hosts the adapter. Three places
claimed an internal `airi:driver-storage:<driverId>` cross-window channel — the old comment on
`DriverStorageOptions`, `docs/data-catalog.md` and plan §4.6 — and no code ever opened one. All three now say there
is no cross-window relay. Implementing one is a transport job for the layer that owns a broadcast channel, and it
would slot into the hub, which is exactly why the hub is the adapter's.

**Rules out:** an embedder that has to know a driver id to hand out storage; two hubs for one window; a driver
facade that lives in the host core, which has no storage and never will.

## Prompt ownership

### P1-D26 — The driver owns the prompt; AIRI holds a copy and detects the conflict

Ruled by the project owner, and it supersedes the prompt half of D5 and §5.4, and the `prompt-archive` key P0.5
introduced:

- **the driver** versions the prompt, stores it, and tracks its modifications — the version history is the
  driver's record, kept by the driver the way a repository tracks revisions;
- **AIRI** keeps the *current* publication so `buildSystemPrompt` never waits for a window (the contract's own
  reason for `HostPromptService`), keeps the card's portable snapshot, **detects** a disagreement between the two,
  and hands the choice to the user;
- **the losing copy is not AIRI's to keep.** `PromptStore` no longer has `archive`/`listArchive`, and
  `local:model-drivers/prompt-archive/…` no longer exists. A superseded publication is replaced.

Concretely, the code changed in three places: the store keeps `publish` (strictly-newer wins), `get`, `list`,
`stateFor` and `remove`, and nothing else; the `prompt-archive` key space is gone from `keys.ts`; the records suite
now asserts the negative — one key per binding after two publications, and no archive prefix — instead of
"archives a losing publication complete". The backup test no longer seeds or restores an archived loser, because
there is nothing to carry beyond the current pair.

**What this costs, stated plainly:** the conflict surface (§5.4, Phase 2) can still show both copies — the store's
current publication and the card's snapshot — because those are the two AIRI actually holds. It can no longer show
*earlier* versions, because AIRI never kept them.

**Open consequence, now closed: the channel is two-way.** `HostPromptService` gained `onResolution`, the
host→driver half: after an arbitration the host writes the winner (with a version strictly newer than every copy
it saw) and hands that pair to the driver, so the driver's history records what AIRI now holds and the driver's
next publication continues from that version instead of being discarded as stale. Delivery runs through the
adapter's client (`HostClient.onPromptResolution`, the app's `modelDriverPromptResolutionEventa`), addressed by
driver because only the window running that driver's entry can deliver it. The in-process host core accepts the
subscription and does not call it — there is no arbitration surface yet (§5.4 is Phase 2) — which is the same
shape `pointer` has taken since Phase 1 (P1-D14). No producer exists today; the arbitration surface is what will
emit it, and until then the capability is a contract the host must satisfy rather than a stream anything sends on.

That is also the one place the host mints a version (`max + 1`), which the contract's `version` doc now says
explicitly: the driver owns monotonicity for its own publications, and an arbitration is the host writing on the
user's behalf.

**Rules out:** AIRI archiving prompt history; reading an absent publication as an empty one; and treating the
driver's `version` as something AIRI may mint.

### P1-D23 — A closed window's channel is reported on the manager's change bus

**The defect.** `windowClosed` cleared the registry's channel cache and touched nothing else. A manager keeps the
channel it opened — it must, because reopening one restarts the entry — so after the window serving an address
closed, the manager kept sending on a dead pipe. `ManagerChannel.send` is `void`, and main's implementation
discards `emitToWindow`'s `false` for a destroyed window, so nothing failed and nothing was logged. The first pull
routed there waited for a reply that could never arrive: `refreshRows` never resolved, no `rows` was emitted, and
the row cache kept its last value for the rest of the session — indistinguishable from "the list has not changed".

**The ruling.** The channel is *used* by the driver but *provided and maintained* by the registry: the registry
opens it, caches it, and is the only party told the window died. So the registry reports the loss, on the change
bus that already exists — `RegistryHandle.onChange` — instead of gaining a member of its own. That is also why
`onChange` was not enough as it stood: it delivered a zero-argument call, so it carried no subject to report.

**What changed.**

1. `RegistryChange` replaces the zero-argument handler: `{ kind: 'drivers' }` for a driver-level change and
   `{ kind: 'channel-closed', driverId, windowId, surface?, purpose? }` for a lost channel. `onChange` no longer
   fires for `rows` (host bookkeeping) or for `model-list-changed` (the manager's own echo, which would be a
   feedback loop through the manager that produced it).
2. `forgetManagerChannel(windowId, driverId)` became `forgetManagerChannels(windowId)`. The event is a *window*
   going away, and the per-driver form made the report depend on the caller remembering which drivers had
   channels there — the app tracked that in `channelDrivers`, the in-process host derived it from mounts, and a
   window that served an entry without mounting the driver (the background window's whole job) was missed by
   both. Entries are collected, deleted, then reported, so a manager that re-requests on the report cannot have
   its new channel swept by the same pass.
3. Each manager's subscriptions are disposed with that manager. The contract gives a manager no teardown verb
   (D1), so without this a released manager would keep reacting to channels that belong to a manager that no
   longer exists.
4. The stub manager is the reference implementation of the obligation: it drops the closed address, rejects what
   was in flight on it with `WINDOW_GONE`, and lets the next `listModels` call `requestRenderer` again — which is
   the recovery the contract's own `RegistryHandle` doc already described.

**Why not the alternatives.** A `send` that reports failure changes an approved signature and still leaves every
driver to check it; a manager-side deadline cannot tell a dead window from a slow one, and the one that would be
safe against a cold `listModels` is too long to be useful for the case it exists for. Both remain available to a
driver as defence in depth — neither is needed for correctness now.

**Residual.** The registry can only report what it is told. A renderer that dies without the host hearing a close
event, and a driver that never answers on a live channel, still hang the pull; a deadline in `refreshRows` would
turn those into logged misses rather than fixing them, and is not implemented.

**Rules out:** reading "the registry forgot the channel" as "the manager forgot the channel"; making `send` the
failure channel; and treating a window close as a driver-level change — it is addressed, and it reaches only the
driver whose channel it was.

### P1-D27 — The SDK owns the host, and the app owns the resources

**The question that produced this.** Nothing separated `@proj-airi/stage-driver-host` from this package except a
line in the plan's artifact table. They had identical `tsconfig.json`, both were `private` and source-only, both
were bundled into main through the same alias mechanism, and the host package's only dependency was this one — so
it could not compile without the package it was supposedly separate from. The duplicate `createConsoleLogger`
(the same function in both packages, the host copy importing `HostLogger` from here) was the proof: the boundary
was already porous.

**The decision.** The package is merged into `@proj-airi/stage-renderer-sdk` and deleted. Three entries, one
package:

- `.` — the contract and the transport-free renderer adapter, unchanged for renderers;
- `./host` — the host core (`src/host/core/`: registry, broker, mounts, records, prompts, ids, keys, backup) and the
  host service (`src/host/service.ts`);
- `./testing` — the stub driver and the harness, so the fixture stays out of a production import.

**The service is the real move.** What used to be `apps/stage-tamagotchi/src/main/services/model-drivers/index.ts`
was ~640 lines of behaviour and ~40 lines of Electron: the operations a window may call, the entry relay and its
ten-second deadline, the manager-channel dispatch, the `state.json` debounce, the window-closed ordering and the
shutdown sequence. It now lives in `src/host/service.ts` against four ports — **transport** (push one message to
one window), **windows** (live windows, the background window), **state** (read/write the snapshot) and
**scheduler** (timers) — and the app file is the composition root that supplies exactly those. The `switch` over
`ModelDriverHostPush` in main is now the whole of the host's transport knowledge, and `senderOf` is the whole of
its identity policy: a handler receives a `windowId` the embedder attributed, never one from the payload.

**Why it could not stay where it was.** The plan's split produced an untestable seam: main's service could only be
exercised by launching Electron, so the entry relay, the deadline and the window-closed ordering were "covered by
review". A behaviour that cannot be executed cannot be asserted, and the four-port shape is what makes
`service.test.ts` possible without a `BrowserWindow`, an `ipcMain` or a file.

**What this rules out:** a second host implementation per embedder (Web/Pocket reuse the same service with their
own ports); treating the SDK entry as "contract only" (that was P1-D24's sentence and is now wrong twice); and
adding a capability to main's wiring that is not a resource — if it decides something, it belongs in `service.ts`
with a test.

**What it costs, stated rather than discovered later:** the SDK now has three entry points, so a renderer that
imports `.` must not also import `./host` (the alias order in `electron.vite.config.ts` is load-bearing); main's
`state.json` and `BrowserWindow` knowledge is untested there and remains manual smoke; and the app's
`model-driver-specifiers.ts` had to learn the new fixture specifier
(`@proj-airi/stage-renderer-sdk/testing#stubManager`), because the registry compares the manifest's
`entry.manager` against the table's specifier exactly.

## Withdrawal coverage

### P1-D28 — Every withdrawal kind is asserted against every state §9.7 gives it, and two silent readings are pinned

The withdrawal block asserted seven cases: `cancel` on a queued transaction, `cancel` refused on a running one,
`abort-current`, `pop` and `pop-all`, `dump`, an unknown correlation and the 64-value bound. That covered the
shapes and left the rules unasserted — `abort` had no broker case at all (only `validate.test.ts` named it),
nothing met a terminally settled target, no addressed selection matched nothing, `pop`/`pop-all`/`dump` were
never asked while a transaction was also running, and the 256-entry report cap was unexercised.

Thirteen cases now pin the table: `abort` in all four of its result states (queued → `cancelled`, running →
`requested` and then the driver's own settlement, terminal → `settled`, an address that matches nothing →
`empty`), `cancel` against an address that names another purpose, `abort-current` with nothing running, with one
running, with two running, and with named values, `pop` and `pop-all` beside a running transaction, `dump`
producing one report with a cancelled queue entry and a requested running one, `dump` against a terminal target,
the report cap with its exact count, and a malformed request that must withdraw nothing. `broker.test.ts` goes
from 21 to 34 cases.

**Two readings are pinned, not decided.** Writing the missing cases surfaced two places where §9.7 does not
answer, and inventing an answer inside a test would be worse than the gap:

1. **`abort-current` has no row in the result table.** The rule above that table — one result per target given or
   selected — would ask for an entry per named correlation, but "the running transaction" is singular. The
   broker answers for the running one only, so a request that also names a queued value gets no entry for it.
   The alternatives are to answer per named value, or to refuse `abort-current` with `nonces` the way `pop` and
   `pop-all` are already refused by the validator; either is a contract decision.
2. **`dump`'s terminal row is "not applicable".** The broker applies one rule to every kind outside the queue
   and reports the state the transaction settled with. Matching the RFC would mean special-casing a kind that
   already shares its branch with `abort`.

Both carry a `// NOTICE:` at the assertion, so changing either has to fail the test rather than pass silently.

**How it ran.** `vitest` still cannot spawn in the authoring environment (P1-D17): Vite bundles
`vitest.config.ts` with esbuild, and esbuild spawns its service binary through `child_process` with piped
stdio, which the sandbox refuses — before any test file loads, so no pool setting can avoid it. All eight
suites therefore run through the fallback this package ships at `scripts/run-suites.mjs`, which registers
resolution hooks for the package's three entries and every extensionless relative import, discovers the
suite files itself, and stands in a deliberately small `describe`/`it`/`expect` from
`scripts/suite-assertions.mjs` — including `expect.objectContaining`, which the adapter suite needs and a
strict deep comparison cannot express. **183 passed, 0 failed.**

**Why it is committed, and why it lives in this package.** It was local twice and rebuilt twice, and each
rebuild re-found the same four defects (directory-before-file resolution, the missing asymmetric matcher,
matchers nested inside plain objects, and the import order), because a procedure that lives only in a
session is not a procedure. It is in this package rather than in the repository's `scripts/` because it
reads nothing outside this package: it derives its source directory from its own location, resolves only
this package's entries, and discovers only `src/**/*.test.ts`. The cost of committing it is a second runner
that can drift from vitest's semantics; the mitigations are that it aliases the `vitest` specifier to a
documented subset rather than a re-implementation, that anything outside that subset fails loudly instead of
passing, and that CI still runs the real command. `pnpm -F @proj-airi/stage-renderer-sdk test` remains the
authoritative one, and this count is only evidence until it confirms the same numbers in a build environment.

## Headless evidence for the dev route

### P1-D29 — The chain the dev route demonstrated is asserted in-process, and the route is smoke

**The gap.** §4.9 criterion 2's end-to-end proof was `/devtools/model-driver-stub`: a page a human presses. Every
behaviour it showed had a unit suite, but the *composition* — the real service talking to the real adapter over a
transport, with the stub driver on both sides of the manager channel — had none. A page cannot be a regression test,
and the phase's evidence said so in parentheses: "the dev route is pending a re-run".

**What is now asserted.** `src/host/in-process.test.ts` (10 cases) drives `createInProcessHost`, which wires the
real `createModelDriverHostService` and one real `createModelDriverAdapter` per window through a loopback transport:

1. a row pull relays an entry request to a live window and caches what the driver answered;
2. the mount id is registry-issued, a skipped readiness step is refused, the declared walk is accepted;
3. a load cue settles with the mount answering and applying the model;
4. capture returns bytes in the settlement;
5. a cue at an empty surface settles `NO_TARGET` and delivers nothing;
6. two windows hold distinct mounts while sharing one host and one storage origin, and a cue reaches exactly one;
7. a withdrawal through the adapter cancels queued work, and a request naming no target is refused;
8. activation publishes into the window's prompt store;
9. host state is readable and a mount unregisters;
10. a closing window loses its mounts and its settlement is pushed to nobody.

**Four details that are decisions, not incidental:**

- **Pushes are delivered on a microtask.** The adapter answers an entry request by calling back into
  `service.entryResult` while `requestRenderer` is still on the stack; inline delivery would re-enter the service
  from inside its own call. A microtask is also closer to what an IPC hop does than a direct call is.
- **The fixture has no background window** (`ensureBackgroundWindow → null`). It has no `BrowserWindow`, and
  inventing one would either duplicate the service's fallback or hide it. The fallback is covered in
  `registry.test.ts`; here the port says "this host has none".
- **The session is handed to `onSession`, not kept in a module map.** In one process two windows can host the same
  driver, and a map keyed by driver would let the second window's session overwrite the first's. The application
  keeps its map because its module instance is per window; that is the only place the map is correct.
- **A closed window's settlement is asserted as *attempted and undelivered*** (`pushes()` records
  `delivered: false`), not as `receipt.settled`. The adapter that would settle the caller is the window that is
  gone, so nothing can settle it — which is exactly the app's shape, where `emitToWindow` returns `false` for a
  destroyed window. Asserting the settlement promise here would have hung the suite, which is how this distinction
  was found.

**The bug the route had.** Its "Abort current" button sent `{ kind: 'abort-current', modelDriverId }` with no
target. §9.7 requires exactly one target, so the host refused every press and the button could only ever print a
failure. It now passes the address, and `in-process.test.ts` pins both the working withdrawal and the refusal of the
malformed one — so the fix cannot silently regress into the shape that was broken.

**Deduplication.** The app's `renderer/libs/model-drivers/stub-entry.ts` now delegates to the SDK's
`startStubProviderEntry`, keeping only its per-window session registry and `whenStubSession`. The fixture exists
once; the app keeps what is genuinely app-shaped.

**What the route is still for.** `webContents` identity, the eventa hop, `state.json` on disk, the `BrowserWindow`,
and the shared background window. The page is now smoke for those, and its header says so. The plan's §4.9 row 2
records the split.

## Known gaps

One gap remains, recorded rather than fixed. P1-D23 was found in the same audit pass and is now a decision
earlier in this record: its only honest fix was contract-shaped, and contract churn is free before the phase gate
rather than after it.

### P1-D22 — A model-list change reported by several windows is neither coalesced nor ordered

`onModelsChanged` is a nudge, and the registry treats every nudge the same way: emit `model-list-changed`, then
start `refreshRows` for that driver. Nothing on that path deduplicates — not the registry, not the manager
contract, not the row cache. Six things follow.

1. **N notifications, N reads.** A manager may hold several channels to one driver, one per address it was asked
   for, and each can carry the notify. A `*/*` pull channel in one window plus an `acting/*` cue channel in
   another therefore produce two events and two overlapping `listModels()` calls for one store change. The cost
   is one redundant round trip per notify, bounded by the number of channels rather than unbounded — but the read
   is not free: it is a full `listModels()` in some renderer.
2. **The pull lands on the first cached channel, not on the window that notified.** `requestRenderer` step 1
   returns the first address-matching channel in insertion order, so the second window's notification is answered
   through the first window's pipe. Harmless while records live in shared web storage — the read is the same store
   through a different pipe — and wrong the moment a driver keeps any per-window state.
3. **Last writer wins, and the loser can be the older read.** `refreshRows` writes `rows` and `rowsUpdatedAt`
   unconditionally on success. Read A (taken before a store write) can reply after read B (taken after it), leaving
   the cache holding the *older* list stamped with the *later* time, and main persists it as if fresh. It
   self-corrects on the next notify — which may never come — and nothing prevents it in between.
4. **A driver must key its in-flight reads, and the contract does not say so.** Two overlapping `listModels()` calls
   are safe only if the manager routes replies by correlation. The stub does (a process-wide monotonic id and an
   id-keyed waiting map); a driver with a single pending-reply slot would hand one window's list to the other
   window's read. That obligation is currently implicit in `ModelDriverManager.listModels`, which says nothing
   about reentrancy.
5. **Nothing stops a pull storm.** The only loop-breaker is that a completed pull emits `rows` and never
   `model-list-changed`. A driver that notifies from inside `listModels` loops forever, and the host does not
   notice.
6. **Windows cannot actually report this yet.** The adapter has no notify member, and `startProviderEntry` builds
   the window half without `notifyModelsChanged`, so the only code that can emit the signal is the test harness.
   The single-window re-read is tested; two windows notifying is not.

**The fix, when it is made,** is two small things in `refreshRows`: one in-flight pull per driver with a dirty
flag, so N notifications cost two reads instead of N; and a generation captured at the start of a read and
re-checked before the write, so a superseded reply is discarded rather than persisted. Together they remove the
out-of-order staleness and the reentrancy requirement in one change, which is the reason to do them together
rather than as two.

**Rules out:** treating "the window said it changed" as a per-call signal (it is a hint to re-read, and hints
coalesce), and treating a completed pull as newer than every pull still in flight.


