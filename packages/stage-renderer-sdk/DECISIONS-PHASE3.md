# Decision record — Phase 3, Live2D-first slice

Companion to [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §6.3 and to
[`DECISIONS-PHASE0.md`](./DECISIONS-PHASE0.md), [`DECISIONS-PHASE1.md`](./DECISIONS-PHASE1.md) and
[`DECISIONS-PHASE2.md`](./DECISIONS-PHASE2.md). D-numbers from the plan are cited, not redefined.

**Scope: architecture and contract decisions only.** Layout, labels and interaction chrome belong to the components
and to the plan's implementation status; this record says what is true and why, not how a surface looks.

| # | Decision |
| :--- | :--- |
| P3-D1 | Live2D is Phase 3's first driver, and it lives in its own package |
| P3-D2 | Driver storage is the host's storage service, with bytes base64-encoded |
| P3-D3 | Capabilities are declared narrowly, and the rest stay false |
| P3-D4 | Cue delivery combines mounts first-resolved-per-slot |
| P3-D5 | A broken load fails the send; every other refusal is per-slot |
| P3-D6 | `ProfileCue` is acknowledged without being applied |
| P3-D7 | Pointer is used for hit-area edges only; no interaction mode is offered |
| P3-D8 | Import is stored whole; the two-phase probe commits the zip |
| P3-D9 | The adapter mints; the dev route imports through the loader table |
| P3-D10 | `packages/stage-ui-live2d` is frozen, and its copy was removed |
| P3-D11 | Validation ran on the DOM-free half only, and why |
| P3-D12 | The picker selects; the host imports through the driver's `IMPORT` entry |
| P3-D13 | Prompt publication is generated, then authored |
| P3-D14 | A profile body is appearance, applied by the driver |
| P3-D15 | Three panels, one picker, all through the host frames |
| P3-D16 | The order of events in an import, and why it is load-bearing |
| P3-D17 | The order of events when picking a model |
| P3-D18 | The new path is chosen by the card, and the window supplies the adapter |
| P3-D19 | An ACT token is projected by the driver, and a bound character is driven only through it |
| P3-D20 | Migration retains the entry, and a revert reads it back |
| P3-D21 | The driver makes the thumbnail; a row carries it |

## P3-D1 — order and package placement

The plan's D6 orders Spine → MMD → Live2D → VRM. The user directed Live2D first, and a dedicated package
`@proj-airi/model-driver-live2d` rather than `stage-ui-live2d/src/driver/` (D2's colocation). The deviation is
recorded in the plan's §6.3 status note. The benefits, in this order: the driver grows independently of a renderer
whose legacy path must not change; its manager half can be imported by main without the renderer package's Vue and
store dependencies; and deleting the legacy renderer in Phase 8 becomes a package removal rather than a surgery.

**Not decided by this**: whether the other three drivers also move to their own packages. That is a per-phase
decision, and this record does not commit them.

## P3-D2 — storage is the host service, base64 for bytes

The provider uses `HostServices.storage`, not a private IndexedDB. The service is the adapter's driver-scoped
facade, so isolation is structural and `purge`/backup can find the keys later.

The port's `set` path JSON-serializes values. A `Uint8Array` therefore arrives as a numeric-keyed object — silently —
and a `Blob` as `{}`. Since the adapter exposes no raw/binary setter at contract `0.1`, the driver stores the
imported zip as a base64 string. Cost: ~33% on disk and one transient string per load. A dedicated binary store is
Phase 7 transfer work, where the bundle format is specified; inventing one here would be a second storage contract.

## P3-D3 — capabilities declared narrowly

Declared: `probe`, `profiles`, `capabilityDiscovery: static`, `deactivate`, `purge`, `occupiesPoint`, `hitTest`,
`stopAll`, `dispose`, and the cues `expression`, `motion`, `profile`, `gaze`, `caption`, `reset`, `capture`.
Not declared: `prompt`, `panels`, `modelTransfer`, `driverTransfer`, `migration`, `previewModel`, `act`,
`view`, and every interaction mode but `none`.

A capability is a promise the host acts on: `prompt: true` obliges a publication per model and profile, `panels:
true` obliges declarations the host will mount, `migration: true` obliges a retained handover and a revert payload.
Declaring them before they exist would make the host offer empty surfaces and report a fault that cannot be fixed.
The manifest and `rendererCapabilities()` return the same record today because there is nothing resource-dependent
to discover yet; they diverge when a mount path can degrade (e.g. missing Cubism core).

## P3-D4 — delivery combines first-resolved-per-slot

The manager forwards one envelope to the window, and the provider hands it to **every** mount matching the target
address (driver + optional surface + optional purpose). Results combine slot by slot: the first `resolved` outcome
wins, a rejection from one mount does not mask another mount's work, and `handled` is true only when every slot
resolved. A single target's `mountId` is echoed in the ack; with several targets it is omitted because the ack's
`mountId` is explicitly not an address.

When nothing matches, the provider answers a `no-target` rejection in every slot rather than failing: `NO_TARGET`
is the broker's decision when the selection is empty, and this is the same answer for a selection that reached the
driver but no window mount.

## P3-D5 — errors and refusals are different on purpose

A `LoadCue` that fails returns `{ ok: false }` for the whole send, and readiness moves to `model-error`. Nothing
else could be applied to a model that is not there, and the caller needs the reason.

Every other cue settles per slot. An undeclared kind, an unknown expression key, an unsupported gaze mode or reset
scope, and a cue that arrives before a model is loaded (`renderer-not-ready`) are rejections inside a successful
ack, and each also emits `cue-rejected` with the transaction nonce. A refusal is not a failure (RFC §9.4), and
`handled: false` with reasons is more informative than an exception.

## P3-D6 — a profile cue is acknowledged, not applied

Profiles are stored per model and profile (`model/{id}/profile/{profileId}`), and `saveProfile` works with no mount,
as the contract requires. Applying a profile body mid-frame — scale, opacity, parameter presets, costume — is the
appearance slice. Until then `ProfileCue` settles `resolved` because the driver *has* recorded the selection; the
mount applies it on the next load. The host cannot tell the difference between "recorded" and "drawn", which is why
this is recorded here rather than implied.

## P3-D7 — pointer edges only

`RendererMountCapabilities.interactionModes` is `[none]`: the mount does not offer tactile, orbit, drag or
positioning. It **does** subscribe to `services.pointer` for the mount id, purely to diff the hit area under the
pointer and emit `hit-area-change` on enter/leave. That is the driver half of D-3: an edge, never a per-move stream,
and only for a region the renderer itself knows. A future interaction mode is an additive capability, not a change
to this path.

Two details are load-bearing for whoever writes the next query:

- **Point queries are world space.** The stage is scaled by the render resolution so the model draws at CSS size
  without resizing it, which makes world = CSS × resolution. `focus`, `hitTest` and `getBounds` all take world
  coordinates; the model's position and the caption are stage-local, which is CSS by construction. The view converts
  once, in `toWorld` — a query that forgets it is wrong by the resolution factor and looks plausible.
- **`occupiesPoint` is a bounds test, not an alpha test.** That is the answer the library gives for
  `containsPoint` (`getBounds().contains`), and it is what click-through routing needs against a fitted model.
  Alpha-exact routing would cost a `readPixels` stall per pointer move; this is recorded so it is not read as
  per-pixel.

## P3-D8 — import is whole-archive

`probe` accepts exactly one `.zip`. It reads the archive with JSZip to find the settings file and report the
expressions, motion groups and hit areas, and returns one part. Folder imports, multi-archive sets and moc-only
archives are not accepted; they fail with a readable `blockingFindings` entry. The commit writes the zip bytes,
the record and the default profile, and returns one entry per selection.

The record is written **last**: a crash between the bytes and the record leaves an orphan blob that no row lists,
which is the safe direction. `probe` writes nothing.

## P3-D9 — the route imports through the loader table, and the adapter mints

`ModelDriverAdapter` now exposes `mintModelId`/`mintProfileId`, implemented with `createIdMinter()` — the identity
authority the contract's `Adapter` declares. The dev route no longer mints at all: it mounts the host import panel,
which asks the adapter for a pair per confirmed part and passes them to the driver's `IMPORT` entry. **Import stays
on the host side** (P3-D12): the panel is the host's model-import prompt, and no driver surface imports or mints
anything.

The route imports the driver only through the loader table (`driverLoaders.resolve(kind, specifier)`, reached via
`bootstrapModelDriverAdapter`), so it reaches the same module instance the adapter started. A direct
`import '@proj-airi/model-driver-live2d/provider'` would be equivalent at runtime and would break the "only the
loader table imports a driver" invariant, so it is not done.

## P3-D10 — the legacy renderer is untouched

`packages/stage-ui-live2d` was not edited. The user had copied it to `packages/model-driver-live2d` as a starting
point; every copied file was verified byte-identical to the tracked package before deletion, so no work was lost and
the two packages do not drift. The legacy branch, stores, channels, caption path and OPFS cache stay exactly as they
were for the reversal window (D9).

## P3-D11 — what validation could and could not run

Environment: no network, and the pnpm store is missing tarballs (e.g. `@valibot/to-json-schema@1.0.0-rc.0`).
`pnpm install` cannot complete offline; attempts pruned `node_modules` and removed some packages entirely, including
`pixi-live2d-display`, before failing. That damage is not repaired by the driver change and needs a networked
`pnpm install`.

What did run, against the surviving virtual store and with temporary junctions (since removed):

- `tsc --noEmit` over the DOM-free and Node-safe half (`manifest`, `protocol`, `manager`, `storage`, `session`,
  `import-probe`, `provider`, `index`, tests) — clean;
- the three suites through `packages/stage-renderer-sdk/scripts/run-suites.mjs` — 17 assertions passed
  (manifest 6, storage 4, manager 7), after fixing two test-harness mistakes: a probe that answered with no
  `confirmImport` (the shape requires one) and a close-the-window test that closed before the call was on the wire.

What did **not** run: `vue-tsc` over `src/live2d/view.ts` and `src/mount/Live2DMount.vue` (Pixi is gone), the app's
typecheck/build, the guards, and any real mount. Those are the first things to run once `node_modules` is restored,
and they are expected to find SFC-level issues this environment cannot.

**Subsequently (same day).** `node_modules` was restored by a networked `pnpm install`. The deferred checks then ran
and found five real defects in the slice, all now fixed: a `Uint8Array<ArrayBufferLike>` that is not a `BlobPart`, an
`expressionManager` looked for on `InternalModel` instead of its motion manager, a `containsPoint` given a plain point
object, CSS points handed to world-space `focus`/`hitTest` (a silent mis-hit off by the render resolution), and a
`setExpression` that reported success for a name the model does not have. Full state: driver typecheck, app
`typecheck:node` and `typecheck:web` clean; 17 → 40 driver assertions; guards 7/7.

## P3-D12 — the picker selects; the host imports through the driver's `IMPORT` entry

**The rule.** A driver surface never mints an identity, and never commits an import without the host having asked
for it. Import is a host operation: the host owns the dialog, the input, the confirmation, the ids and the binding.
The driver owns its format — reading the bytes and writing them under the ids it is given.

**What was added and then removed.** The first attempt at this slice put an import control in the driver's
picker, which meant the driver minted ids, wrote a model record and a default profile with nobody asked. It was
made to compile by adding an optional `HostServices.ids: { mintModelId, mintProfileId }`. Both are reverted: the
picker lists the models the driver already holds and emits an existing `(modelId, profileId)` pair, and
`HostServices` is back to its Phase 2 shape. Two review objections drove the revert, and both were right — the
service container is not the place for an import authority, and "not imported" is a prompt to the user, not a
background write.

**Where the import code actually lives (this supersedes the "needs a host import entry point" note).** It is
driver code, and the host panel pulls it exactly the way it pulls a mount or a panel. The mechanism is the one
`ModelDriverEntryKind` already is:

- `ModelDriverEntryKind.IMPORT` is the fifth kind. `ModelDriverManager.resolveEntrypoint` answers
  `LIVE2D_IMPORT_SPECIFIER` for it, the adapter imports that module through its loader table, and
  `ModelDriverAdapter.importEntry(driverId)` builds it with this window's container for the driver.
- The module (`packages/model-driver-live2d/src/import.ts`) exports `createImportEntry({ services })` → `{ probe }`.
  `probe` is the provider's two-phase probe (`probeLive2DArchive`), so inspection writes nothing and the commit is
  the `confirmImport` callback on the result. Both import paths (provider `probe` and this entry) publish prompts
  for what they committed.
- AIRI's panel (`ModelImportPanel.vue`) owns the dialog: same files to every driver that can import, merge the
  reports, order by confidence, show `warnings`/`plannedFixes`/`blockingFindings`, ask the **adapter** for one id
  pair per confirmed part, commit. Nothing goes through `ModelDriverManager`, and `probe` is not a manager method.
- Identity is the adapter's: `ModelDriverAdapter.mintModelId`/`mintProfileId` are implemented over
  `createIdMinter()`, so the panel (and any later import surface) asks the same per-window authority the contract
  names, and two panels open at once cannot mint the same id. The driver receives the ids and echoes them back.
- The loader table became **kind-keyed and single-path** in the same slice: `resolve(kind, specifier)` and
  `specifiers(kind)`, one `loadEntryModule` in the adapter. `ModelDriverEntryKind` is the only distinction between
  the modules a driver ships; a module's export shape is typed by the contract, not handled by a separate code
  path. The driver's `./import` entry is one more row.

The dev route no longer carries a host-side import control: it mounts `ModelImportPanel`, which is the same host
surface settings will mount when placement lands (P2-D18). The remaining gap is placement plus the i18n keys.

**How the picker opens the import panel.** The picker never imports; it asks, and it hands the input over. The
picker owns the files — its own `<input type="file">`, a drop target, or a builtin's bytes — and calls the
`requestImport({ files })` callback it is given. The host offers that callback only when it has a surface to open:
`DriverPickerHost` asks `adapter.importEntry(driverId)` and includes the callback only if the driver ships an
`import` entry this window can load, so an absent callback means "do not show an add-model affordance". The frame
opens `ModelImportPanel` with those files and `driverIds: [driverId]`, and turns the first committed part into a
`select`. The promise `requestImport` returns resolves when the panel closes — the only thing the picker is told.
Syncing after an import is the driver's own business: it re-reads its storage, or watches a key it already holds,
and the host relays no result. The panel therefore starts at the **parts** step, not the choose-a-file step, and
only the originating driver's `import` entry is asked. The committed `selection` is a pair AIRI now holds, so nothing
is inferred and nothing is re-minted. It is a host-supplied callback rather than a `HostServices` method because
opening the panel means rendering a host component, and rather than a prop/emit pair because that direction of
communication must not depend on Vue (P3-D12's `HostServices.ids` revert is the same rule).

**Why the picker still does not import.** §7.1 permits a picker to list builtins and import one, but the driver
never does the importing itself: the only builtin this driver ships is "nothing yet", and when one appears it goes
through the same host panel. A picker that called `probe`/`confirmImport` directly would be committing an import
with no confirmation step.

## P3-D13 — prompt publication is generated, then authored

`capabilities.prompt` is now `true`, which is a promise: publish at least once per model **and profile** once
activated, with an empty publication permitted and *no* publication a fault (D5, D-17). What the driver does:

- **Generation.** `buildLive2DPrompt` describes *this* model — its expressions, motions and touchable regions, each
  with the exact token — and deliberately not the generic "start every reply with an ACT token" instruction, which
  belongs to the character's acting prompt. Repeating it here would give the model the rule twice and let the two
  copies drift.
- **Tokens.** `<|ACT:emotion="happy"|>` and `<|ACT:motion="Idle#0"|>` — the marker parser's own short form. Authoring
  derives the list from the text and drops tokens naming something the catalogue does not have, because AIRI trusts
  the published list when it extracts cues: a token list that disagrees with the model makes it play what the prompt
  does not describe.
- **Versioning.** Minted here, monotonic per `(model, profile)`. Activation republishes the **stored** pair rather
  than re-authoring, so a restart is not a version bump; regeneration bumps only when the text actually changed; an
  authored save is `stored + 1`. The one foreign version is the host's arbitrated `max + 1`, recorded through
  `prompt.onResolution` — recorded, not republished, because the host has already stored it (D26).
- **When.** At activation (every model × profile), at import commit (so a freshly imported model never sits in the
  fault state), and on profile creation. Removing a profile removes its prompt with it; a model removal takes the
  whole subtree.

The prompt is stored per profile even though the generated text is initially identical for all of them: the address
AIRI publishes to is `(driver, model, profile)`, so a per-model copy would make a second profile's publication
impossible to express.

## P3-D14 — a profile body is appearance, applied by the driver

`profile.ts` owns the body — `{ scale?, offsetX?, offsetY?, anchorY?, opacity?, expression? }` — and its maths.
`normalizeProfileBody` accepts `unknown` and clamps into usable ranges, so a body from an older driver version, or
(eventually) one converted from a legacy outfit at migration, becomes the default look rather than a crash or a
refused cue. `computeFit` is pure and is the whole placement rule: fit-and-centre with 5% breathing room, multiplied
by `scale`, placed on the `anchorY` line, then offset. `view.ts` is the only caller that also draws, which is why the
geometry is testable without a WebGL context.

Application points, all through that one function: after `load` (the profile arrives with the model), on a `PROFILE`
cue, on `ResetCue` with `scope: profile` (which restores the saved body and is therefore what ends a try-on), and on
`ResetScope.ALL` (whose meaning is "the saved state", and a resting expression is part of it). A `PROFILE` cue on an
envelope with `persistent: false` is applied but **not adopted**: the mount's own state still names the saved profile.

Live editing does not use a cue per slider pixel. A panel writes the profile body to driver storage and the mount
watching that key re-applies it (`storage.watch`) — the arrangement the storage port exists for, and the reason a
profile stays editable with no mount at all.

## P3-D15 — three panels, one picker, all through the host frames

`./panels` declares `live2d-appearance`, `live2d-prompt` and `live2d-capabilities`, with no `surfaces` filter: a
profile is editable with no stage in the window, so narrowing would hide the only UI that can edit it. The host
decides where a panel appears; the driver only says what it has.

- **Capabilities** lists what the catalogue parsed and previews it with **transient** cues (`persistent: false`),
  addressed to the driver — never to a mount, because mount identity is not part of a cue target (§9.2). A preview
  that persisted would silently rewrite the user's appearance, which §11 forbids a panel from doing.
- **Appearance** is profile body editing. It writes driver storage only.
- **Prompt** shows the stored pair and its tokens, saves authored text as the next version, and regenerates from the
  catalogue.
- The **picker** (`./picker`) lists the models and profiles the driver already holds, and proposes an existing pair
  only on the user's explicit selection action: moving through what it shows is local state, not an emit. It
  imports nothing, mints nothing and deletes nothing: those are the host's operations, and the driver doing them in
  the background is what P3-D12 rules out. When it has nothing imported to offer it calls the `requestImport`
  callback its host supplied; `DriverPickerHost` offers that callback only after `adapter.importEntry(driverId)`
  answers, and it opens the same import panel — the picker still never imports or mints (P3-D12, P3-D16).

Both modules are named by the manager and resolved through the renderer's loader table, so all five entry kinds are
now exercised (`provider`, `mount`, `panels`, `picker`, `import`). The dev route mounts the picker, the panels and a `MountHost` over one adapter — production placement
in Settings → Data and the strip popover still waits for a migrated driver (P2-D18), and this route is where the
frames are pressed until then.

## P3-D16 — the order of events in an import

One import, from the moment a surface mounts to the moment a pair exists. The order is the contract: several of
these steps are only safe in this sequence, and the reasons are below the list.

1. **Mount.** `DriverPickerHost` calls `adapter.ensureEntry(driverId)` → `adapter.importEntry(driverId)` →
   `adapter.pickerComponent(driverId)`. The entry starts first so the window has the driver's `HostServices`
   container; `importEntry` is answered next so the host knows whether it can offer `requestImport` before the
   picker renders, and it builds the import module with that same container.
2. **Ask.** The picker takes the files through its own input (or materializes a builtin's bytes) and calls
   `requestImport({ files })`. No driver-native name and no id — the files are the whole payload.
3. **Open with that input.** The frame opens `ModelImportPanel` with those files already supplied, so the panel
   skips its own chooser and probes them immediately. Nothing has been written.
4. **Probe, originating driver only.** `adapter.importEntry(driverId)` → `probe({ files })`. A set a driver chose is
   meaningless to any other driver, so the panel asks exactly the driver the request came from. A driver with no
   `import` entry is **reported**, not hidden. `probe` writes nothing; the answer is `confidence`, `parts`, findings
   and a `confirmImport` callback.
5. **Rank and preselect.** Reports are ordered by descending `confidence`. Parts are preselected only from a report
   with no `blockingFindings`; a blocked part needs the explicit "import anyway" (`force`) — the host does not
   decide that for the user.
6. **Mint, then commit.** Per report, per selected part, **ids first**: `adapter.mintModelId()` and
   `adapter.mintProfileId()` — synchronous, so one selection object is built in a step. Then exactly one
   `confirmImport({ selections, input })` per report.
7. **Settle, per part.** The driver writes the bytes, then the record **last** (a crash leaves an orphan blob no row
   lists, which is the safe direction), settles every selection independently (one bad part must not fail the
   others), and echoes the ids it was given.
8. **Publish.** The wrapped commit publishes a prompt for every committed model's profiles, **after** the record
   exists. A publication for a model with no record is the D-10 fault inverted: a prompt the panel can show for a
   model that does not exist. Both import paths wrap the same commit, so this is not surface-dependent.
9. **Report.** The panel emits `imported` only if at least one entry committed. Per-driver failures are shown, not
   thrown; one driver failing must not erase another driver's commit.
10. **Select.** The frame closes the panel, forwards `imported`, resolves the `requestImport` promise (the only
    thing the picker is told), then emits `select` for the first committed entry. Only now may a pair cross the
    boundary: `select` carries an imported pair, and before step 7 there is no such pair to carry.
11. **Refresh.** The caller pulls rows. A pull is display data only — the cache is never identity — which is why it
    is the last event and not a source for the selection.

**Why the order is load-bearing.**

- *Probe before mint.* Minting before the user has chosen would leave ids in flight for parts that may never be
  committed, and `probe` is the only place the input is ever handed over (§5.3).
- *Mint before commit.* A driver that minted its own id would create an identity AIRI cannot resolve again; a
  commit that minted after writing would leave the bytes under a different id than the record.
- *Commit before publish.* Prompt assembly and the panel's fault check both read the publication; publishing before
  the model exists creates a fault for a model AIRI does not have.
- *Publish before select.* The pair may become the character's binding immediately, and the panel must not observe
  "imported model, no prompt" in the window between the two.
- *Select before refresh is deliberate.* `select` names the committed `selection`, never a row, so a stale cache
  cannot produce a wrong binding.

**Failure ordering.** A probe of an unreadable input answers a report with `confidence: 0` and blocking findings, and
**no id is minted**. A commit that fails to run is an error on that driver and the remaining drivers still commit. A
failure of one selection is settled on that entry and contributes no publication, and the frame selects only an
entry whose `result.ok`. Cancelling the panel mints nothing because minting happens at confirm, not at open.

## P3-D17 — the order of events when picking a model

Picking an **existing** model is a different sequence from importing one: nothing is created, so the whole event is
"propose a pair, then bind it". The order is again the contract.

1. **Mount.** `DriverPickerHost`: `ensureEntry(driverId)` → `importEntry(driverId)` → `pickerComponent(driverId)`.
   The entry starts first so the window has the driver's `HostServices` container; the picker is mounted last
   because its props cannot exist before that container does.
2. **List.** The picker reads **its own** storage (`listModelRecords(services.storage)`) and marks the current
   `modelId`/`profileId`. It does not pull rows: rows are AIRI's display cache of what a manager reported, not the
   authority on what the driver holds (P1-D20). A pull here would make the picker show a stale list as if it were
   the catalogue.
3. **Choose, or fork to import.** The picker offers one of two decisions here, and it is the picker's to offer
   because only it knows what it can present:
   - **3a. An existing pair.** The picker proposes `{ modelId, profileId }` only on the user's explicit selection
     action; browsing the models or profile variants it shows is local state and emits nothing. The pair is an
     **existing** one: no probe, no mint, no write, no prompt publication. The pair travels together because a
     model is addressable only with a profile (§5.2, `ModelSelection`).
   - **3b. Add a model.** When the `requestImport` callback is present, the picker takes the input through its own
     chooser and calls `requestImport({ files })`. Control **forks into the import sequence** (P3-D16 steps 3–9):
     this frame opens `ModelImportPanel` with those files and `driverIds: [driverId]`, only that driver's `import`
     entry probes and commits, and the panel reports what it committed. The frame then rejoins this sequence at
     step 4 by emitting `select` with the committed pair, so **both branches produce the same event and the same
     pair shape**.

   The host tells the picker **only that the panel closed** — `requestImport`'s promise resolves; it does not hand
   over what was imported. Syncing is the driver's: the Live2D picker re-reads its own storage after the await, and
   a driver may instead watch keys it already holds. That division matters because `storage.watch` is exact-key —
   there is no prefix watch — so a *new* model cannot be discovered by watching, and re-reading is why the promise
   resolves. The frame emits `imported` immediately before `select` (in 3b only), for a **host** caller
   that wants to refresh its own rows; that event is the host's, not the picker's.
4. **Relay or originate.** For 3a the frame re-emits `select` unchanged; it does not resolve the pair, translate it,
   or look up a row — the pair already names what AIRI holds. For 3b the frame originates the `select` from the
   committed `selection`, which is the pair the driver wrote under ids the adapter minted.
5. **Bind.** The caller persists `extensions.airi.avatar = { driverId, modelId, profileId }`;
   `modules.displayModelId` stays frozen and untouched (D4). For a replacement, the previous model's prompt is
   cleared from the card **before** the new one is loaded (§7.2), so a load never races a stale snapshot.
6. **Refresh display, after.** The caller may pull rows for its list. A stale cache cannot corrupt the binding,
   because the binding was written from the pair and never from a row.
7. **Load.** A mount given the new pair registers, reaches `ready-for-model`, and receives a `LOAD` cue. The mount
   survives a model change; only a driver change replaces it (§7.2).

**Why the order is load-bearing.**

- *Select before bind.* The picker is a proposal: it has no storage access to AIRI's card and must not write one.
  A picker that persisted would be choosing for the user and could bind a pair the user never confirmed. That is
  also why browsing emits nothing: `select` fires only on the explicit selection action, so no state a list could
  show can change a character.
- *Both branches converge before bind.* Steps 4–7 cannot tell a clicked pair from an imported one, and must not:
  one `select` type carries both, so an import can never grow a binding path of its own or skip the confirmation
  the other path gets. A caller that only needs the pair is entitled not to care which branch produced it.
- *Bind before load.* A load for a pair not yet persisted renders something the character does not reference, and
  the next reconciliation would resolve the old prompt.
- *Pair together.* There is no event that carries only a model id. Switching profile is a `select`, not a mutation
  of the model, and the profile's prompt is what assembly reads afterwards (§10.4).
- *No prompt event on selection itself.* In 3a a prompt-capable driver has already published per model **and
  profile**, so selecting reads the pair that exists; in 3b the import published inside its commit before it
  returned (P3-D16 step 8), so a publication exists by the time `select` fires either way. Republishing on every
  selection would be a version storm (P3-D13).

**What this build actually mounts.** Steps 1–4 and 6–7 run in three mounted callers now: the dev route (which
previews rather than binds), Settings → Model through the host dialog (`DriverModelDialog`), and the stage's
unavailable view through that same dialog. Step 5 — the bind — is the dialog's: `withCardBinding` onto the character
the dialog was opened for, then `updateCard` persists it and `broadcastCardsSync` carries it to every other window, so
the stage re-renders through its mount without either window knowing about the other. The binding seam itself is
implemented and tested in `packages/stage-ui/src/libs/model-drivers/binding.ts`.

**Races and cancellation.** If the model vanished between listing and clicking, the binding still stands and the
load reports `model-missing` — a reference whose referent is missing is not an error (D4), and the picker is not the
authority at bind time. Cancelling emits `cancel` and writes nothing. Import-then-select (P3-D16 step 10) is this
same sequence with step 3's pair produced by a commit instead of a click.

## P3-D18 — the new path is chosen by the card, and the window supplies the adapter

Where a character renders is decided in `RendererStage.vue` from one fact: whether the active card parses to an
`AvatarBinding` (`readCardBinding`). A card with a binding is drawn by a `MountHost` for the driver that binding
names; a card without one keeps the legacy branch, untouched (D9, P3-D10). The two branches are **exclusive**,
because a card can hold both `extensions.airi.avatar` and the frozen `modules.displayModelId` during the reversal
window, and rendering both would draw the character twice.

Three consequences belong to the contract rather than to any surface's design:

1. **The stage imports no driver, no specifier and no app module.** It receives the window's adapter through an
   injection key the app entry provides (`provideModelDriverHost`), because the adapter is composed of app policy —
   the eventa client, the loader table, this window's storage — while `packages/stage-ui` must stay usable by a shell
   that has no adapter at all. A window without one answers §5.6 row 6 (`driver-missing`), not "bound but empty": the
   honest state, and the one that keeps a web or Pocket build from mounting a driver it cannot run.
2. **The verdict comes from `resolveAvatarState`, and its facts are host facts.** The driver's status is read from
   `hostState()`; the model and profile come from a `pullRows()` made for the binding's ids — never from the row cache
   alone, which is a display cache that may predate a removal (P1-D20). Model and profile are separate facts because
   a missing model is not an error and a missing profile is (D4), and a binding whose facts have not arrived yet
   resolves to nothing rather than to the previous character's answer.
3. **The binding write stays in the host's dialog.** `DriverModelDialog` is the only mounted code that calls
   `withCardBinding`: it writes `extensions.airi.avatar` — no `modules.displayModelId` (D10), no driver storage — and
   then, through the window's `HostPromptService`, reconciles the card's prompt snapshot in the same write (§5.4):
   a snapshot that belonged to a different pair is cleared rather than carried across, a same-pair rebind keeps a
   card-only copy so it can seed the store, and a store-reachable failure never blocks the bind. Settings → Model and
   the stage's unavailable view both reach the dialog, so the two routes share one write instead of growing one each,
   and the card's own sync broadcast is what carries the result to every other window.

**What this does not discharge.** The six Phase 2 surfaces' full placement with their i18n keys (P2-D12, P2-D18) and
speech frames remain open. This decision says only where the new path renders, where its binding is written and how the
snapshot follows it.

## P3-D19 — an ACT token is projected by the driver, and a bound character is driven only through it

`ActCue` carries the token verbatim (`<|ACT:emotion="happy"|>`, `<|ACT:motion="Idle#0"|>`), and what a token *means* is
the driver's vocabulary rather than AIRI's: the prompt this driver publishes lists the exact tokens it can perform, and
the mount projects a token against its stored catalogue — `emotion` to the expression with that key, `motion` to the
motion with that key (`group#index`), and anything else to `unknown-key`. AIRI never learns what played; the resolved
acknowledgement says the slot was handled, and completion still echoes the transaction (`animation-finished`), not the
motion.

The host's half is one rule: **a bound character's actions travel over the cue channel, not into a renderer store.**
`ControlStripHost` sends the `ActCue` when the active card has an `AvatarBinding` and the window has an adapter, and the
legacy four-way dispatch runs only otherwise. The condition is the same one the stage uses to choose what to render
(P3-D18), so one character cannot be driven by both paths.

What the projection deliberately does not reproduce: a token carries no intensity, duration or fallback list (`ActCue`
has `actToken` and `meta`), so the legacy per-emotion intensity/duration and its motion-name guessing are absent by
design. A name outside the published list is refused rather than guessed at — the published list is the contract for
what this model can do, and a silent fallback would make the prompt's own vocabulary a lie.

## P3-D20 — migration retains the entry, and a revert reads it back

The driver's half of migration is retention and restore, one model at a time (`./legacy`). `migrate` writes the
handover under `legacy/{modelId}` — the legacy id, meta, placement, prompt, opaque values and the files, base64-encoded
for the same reason model bytes are — and answers `retained: true`. Everything else follows from "retained":

1. **One write, then a no-op.** A repeated offer with the same `legacyModelId` answers the same report and does not
   rewrite the entry: the host may replay `migrate` after a crash between the driver's write and its own marker, and a
   replay that reset `retainedAt` would make a retention look new. A *different* legacy id under the same minted
   `modelId` is refused with `model-id-conflict`: two legacy origins behind one identity leave a revert unable to pick.
2. **`unused` is a promise, not a shrug.** Members this driver will never interpret — `url`, `outfits`, `assets`, the
   legacy prompt (the publication is generated from the catalogue, P3-D13), and every opaque setting key — are named so
   the host keeps them alive itself, and the report warns about the ones a user would notice.
3. **A revert gets the live copy when there is one.** `restoreLegacy` answers the legacy id and the same opaque members
   it received; the bytes come from `model/{id}/bytes` once the model is imported (D-16 keeps only a metadata reference
   to it) and from the retained payload before that. No retained entry is a readable `asset-missing` refusal, never an
   empty payload, because a model imported after cutover has no legacy identity to restore.
4. **Deletion is deletion.** Removing a model removes its retained entry too: keeping hidden bytes after an explicit
   delete would make the deletion a lie and leave a revert target the user already discarded.
5. **Retention does not import.** `migrate` writes nothing into `model/{id}`, so a driver-side refusal mid-run cannot
   leave a row the host never marked. The import that consumes the retained bytes by reference is the next piece, and
   it is the one part of the round trip still open (see the plan's status).

## P3-D21 — the driver makes the thumbnail, and a row carries it

`previewModel: true` is a promise that the driver can produce a thumbnail *for a model it holds*, not that AIRI can
render the format: AIRI never does (D-8). The mount already has the model drawn on its own canvas, so that is where the
image comes from — `capturePreview` fits the canvas into a small square and encodes WebP, deliberately not the
full-resolution `capture` ack, because a row thumbnail has to stay small enough for a list and for driver storage.

Three rules keep it from becoming a second catalogue:

1. **Written once, by the first mount that renders the model.** A record that already has a preview is left alone, so a
   second mount costs nothing and a user's re-render does not rewrite megabytes.
2. **One field, read-modify-write.** `writeModelPreview` only ever touches `preview` on an existing record; a model
   removed between the load and the capture is a no-op, and a record is never created for a thumbnail. The mount
   notifies the manager after the write (`notifyModelsChanged`) so the rows a list reads pick it up.
3. **A missing preview is normal.** A model imported but never mounted has no thumbnail, and the driver's picker falls
   back to a deterministic tone with the model's initial rather than a fake image. The row's `preview` is absent, not
   empty, because "nobody has seen this model yet" and "its thumbnail is blank" are different facts.

## P3-D22 — the host's picker sits beside the driver's, and driver UI is translated by key

Two of the six Phase 2 frames became reachable in this slice — `AiriModelPicker` and `PromptArbitrationDialog` — and
`P2-D12`'s i18n pass travelled with them. What that settled:

1. **A driver-provided picker is optional; the host's list is not.** `DriverModelDialog` — still the only mounted
   binding write — offers two sources for the chosen driver: the driver's `picker` entry and AIRI's own list of
   persisted rows. Both emit the same `{ modelId, profileId }`, so bind → card snapshot → load cannot tell which one
   proposed the pair. The driver frame reports `no-picker` (no entry, or the entry failed to load) instead of leaving
   its own error text as the only content, and the dialog switches sources. Before this, a driver without UI had a
   dead end at the one surface that can bind a model, and the host component existed with no caller (`P2-D18`).
2. **AIRI's list is a host read, and it never imports.** It pulls rows from the manager (a cache read is what the
   stage avoids for the same reason, `P1-D20`), shows the driver's own thumbnails where a row has one, and binds a
   `model-missing` row anyway — a binding is a reference and a missing referent is not an error (D4). Import stays
   the host dialog of §6.5 (`P3-D12`); the host list offers no import affordance at all.
3. **Keys are namespaced per surface, not per package.** Host surfaces use `settings.pages.models.model-drivers.*` and
   the stage overlay uses `stage.model-drivers.prompt-arbitration.*`; driver-provided UI was first written as
   `base.model-drivers.{driver}.*` in `packages/i18n` and **moved into the driver package one revision later**
   (P3-D23), where it is `model-drivers.{driver}.*`. `UnavailableModelReason` gets exactly one key per value through
   `libs/model-drivers/reason.ts`, and a test walks the enum so a contract addition cannot render as a raw
   `model-missing` in the user's language.
4. **A driver's Vue UI may depend on `vue-i18n`.** `model-driver-live2d` declares it (catalog specifier) and its
   picker and panels call `useI18n()` like any host component; the app installs the instance (`legacy: false`). The
   consequence is a real constraint rather than a detail: a host that mounts driver UI must install `vue-i18n`, which
   all three apps and the Histoire stories do. The driver's Node suites stay DOM-free and never touch these
   components, so the fallback runner is unaffected. Panel tab labels (`Appearance`, `Prompt`, `Capabilities`) remain
   driver-declared and untranslated because declarations are built outside a component instance, where `useI18n()`
   cannot be called — the host renders the driver's own name for its own panel.
5. **One locale, as usual.** Only `en` gained keys — the host's two files and the driver's one bundle; the other
   locales fall back through `fallbackLocale: 'en'`, which is how the tree already drifts (`vrm.fps.*` exists in `en`
   and not in `ja`). Still English today, and named here so the next pass finds them: `DriverPanelHost`'s chrome,
   `ModelImportPanel`, `MountHost`'s one failure line, `MigrationScreen`, and the driver's static panel labels.

## P3-D23 — a driver ships the records its own UI shows, and the host merges them

The i18n pass of P3-D22 put the Live2D driver's picker and panel strings in `packages/i18n/src/locales/en/base.yaml`.
That was the wrong home, and moving them is the decision:

1. **The records travel with the driver.** `packages/model-driver-live2d/src/locales/{en,index}.ts` hold every string
   its components render, exported as `@proj-airi/model-driver-live2d/locales`. A driver is a package that a host
   installs; the text a user reads while picking or configuring a Live2D model is part of that package in exactly the
   way its manifest and its panels are. `packages/i18n` keeps host surfaces.
2. **Self-namespacing, because the host merges blind.** Every tree sits under `model-drivers.{format}.*` —
   `model-drivers.live2d.*` today — so the host needs no per-driver path, two drivers cannot collide, and the keys a
   driver uses do not encode where AIRI happens to keep its locale files. The old `base.*` prefix was the giveaway:
   `base`, `settings`, `stage` are the host's *file* split, not a feature namespace, and a portable package should not
   be naming one of them.
3. **Merge at composition, once.** `apps/stage-tamagotchi/src/renderer/libs/model-drivers/locales.ts` lists one bundle
   per installed driver, beside the loader table and the specifier list; `modules/i18n.ts` merges each bundle into the
   instance (`mergeLocaleMessage` per locale, deep, after creation) before the app mounts. This is the composition
   rule the host already follows for the adapter (`provideModelDriverHost` from the app entry): the app knows which
   drivers it ships, so it also knows whose records to load.
4. **A host that mounts driver UI must merge its records.** That is the cost of the move, and it is the same cost as
   knowing which drivers are installed. A host that forgets renders key strings — visibly wrong, not silently broken,
   because a missing message is the key. A missing language falls back to `en` like any other untranslated key.
5. **Alternatives rejected.** *Driver components merge into the host composer from `setup`* (`useI18n()`
   `mergeLocaleMessage` inside each component): a hidden side effect repeated per mount, in host state the host did not
   ask to modify, and invisible to anyone debugging the host's message tree. *A new `ModelDriverEntryKind` for
   locales*: the five kinds exist because the manager resolves **code** an adapter imports; message data is not an
   entry, and the app already lists installed drivers statically. *Keeping the records in `packages/i18n`*: the
   rejected status quo — it ties a driver's UI text to AIRI's release cadence and splits one driver's surface across
   two repositories' files.



