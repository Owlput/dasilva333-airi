# RFC 0002 — Model Driver Contract

| Field      | Value                                                                                          |
| :--- | :--- |
| Status     | Draft, for review                                                                              |
| Package    | `@proj-airi/stage-renderer-sdk` (contract only)                                                |
| Vocabulary | a **model driver** is the plugin; a *renderer* is what that driver directly drives             |
| Area       | `packages/stage-ui`, `packages/stage-ui-three`, `packages/stage-ui-live2d`, `packages/stage-ui-spine`, `packages/stage-ui-mmd`, `apps/stage-tamagotchi` |

## 1. Summary

AIRI renders avatars with four independent implementations. The host knows all four by name: it
statically imports their scene components, branches per format for import, repair, capability
parsing and preview generation, and reaches into their stores for state it does not own.

This RFC replaces that with one contract. AIRI keeps only what it needs: which character uses which
model, what the user wants the character to do, and where a model is referenced. The **model
driver** owns everything about a format: its bytes, its rig, its storage, its settings UI, its
vocabulary and its rendering.

The contract is built around four actors. A **registry** holds driver declarations, one manager per
driver, and the cue broker. An **adapter** is the interface AIRI provides to resolve a driver's code
and to mint identities. A **manager**, provided by the driver, answers queries about the models the
driver owns and forwards cues to its mounts. A **runtime**, also provided by the driver, runs in a
window that can load, draw or describe a model.

## 2. Goals and non-goals

**Goals**

1. The host never learns a format's vocabulary, storage layout, file structure, etc.
2. Import, validation, repair, capability discovery, preview generation and settings UI move behind
   the driver that can actually perform them.
3. One cue vocabulary and one acknowledgement shape, so the host code stops branching per renderer.
4. A caller names where a model is shown, so a cue, a panel and a capture reach the viewport that
   was meant.
5. A driver's state is strictly the driver's. AIRI only supplies primitives.

**Non-goals**

- No plugin loader, dependency-injection container or discovery mechanism.
- No installation, consent or sandboxing: the drivers are the ones AIRI ships.
- No cloud sync. AIRI and a driver sync separately; a channel for driver-side sync is a later layer.
- No storage medium, key layout, versioning scheme or migration rules for a driver.
- No uniformity forced on formats that genuinely differ. Differences are *declared* through
  capabilities rather than inferred by the host.
- No cancellation outside cues: import, preview, transfer and profile operations run to completion.
- No progress reporting. A long operation reports readiness, not a fraction.
- No channel for a mount to raise host UI.
- No scheduled performance, timeline position or continuous pose stream.

## 3. The rules

Two rules of modularity produce the whole contract.

**One should know what it needs to know, and do what it is best at.** Holding minimal knowledge is
modularity. A component that tries to do everything becomes unreadable and expensive to maintain.

**Never hesitate to ask for help, but do so at a well-defined interface.** When two modules must
cooperate, they cooperate explicitly, because only one of them has the knowledge. A boundary forces
the core problem, the necessity of the interface and the interoperability to be decided.

| Concept          | Owner        | What it is                                                                        |
| :--------------- | :----------- | :-------------------------------------------------------------------------------- |
| Character        | AIRI         | A virtual, "conscious" being, with a "mind" and optionally a "body".              |
| Named model      | AIRI         | A model a character can reference.                                                |
| Raw model        | Model driver | The model's bytes, behaviors, parameters and textures.                            |
| Model            | Model driver | What the driver is ultimately driving.                                            |
| Renderer         | Model driver | What the driver is directly driving.                                              |
| Profile          | Model driver | A group of named persistent states of a model.                                    |
| User input       | AIRI         | Cursor, cues, ACT tokens, plugin-level speech frames.                             |
| Model capability | Model driver | What inputs a driver and its model can respond to.                                |
| Cue              | AIRI         | A signal to perform an action from a vocabulary known at compile time.            |
| ACT token        | Model driver | A signal to perform an action from a vocabulary known only at runtime.            |
| Expression       | Model driver | An action that does not involve animation.                                        |
| Motion           | Model driver | An action that involves animation.                                                |

| Responsibility        | Owner        |
| :-------------------- | :----------- |
| Storage primitives    | AIRI         |
| User input primitives | AIRI         |
| Storage layout        | Model driver |
| Data migration        | Model driver |
| Rendering             | Model driver |
| Model manipulation    | Model driver |

## 4. Architecture

### 4.1 Actors

The driver is split by capability, not by process: a manager half that outlives windows, and a
runtime half that lives in a window.

- A **registry** holds driver declarations, one manager per driver, and the cue broker.
- An **adapter** is the interface a window uses to resolve a driver's code, to mint identities and
  to obtain a service container.
- A **manager** is driver code outside every mount. It holds driver lifecycle and the models the
  driver owns, answers queries about them, and forwards cues to its mounts.
- A **runtime** is driver code in a window, created when a window asks an adapter for it. It may
  host a renderer and/or other code the driver needs on the renderer process.

| Concept  | Owner        | Where                | Count                      |
| :------- | :----------- | :------------------- | :------------------------- |
| Registry | AIRI         | host's choice        | 1                          |
| Adapter  | AIRI         | one per window       | one per window             |
| Manager  | Model driver | Registry | one per driver             |
| Runtime  | Model driver | a window | one per driver per window  |

The manager outlives every mount and every window, and where the host runs it is the host's
decision.

In a single-process host, the manager and the runtime are co-located.
Driver code takes one route on every host.

### 4.2 Communication

AIRI provides the channels and owns the transport. There are three
kinds:

- **registry requests**, which carry a result and can fail: register, update and unregister a mount;
  list or query mounts; deliver a cue addressed to a driver; withdraw a transaction (§9.7); return an
  acknowledgement.
- **delivery**, pushed by the broker to one driver's manager: an envelope, or a cancellation notice
  for one it already delivered.
- **observation**, broadcast and latest-wins, with no acknowledgement and no ordering guarantee.

Every transaction AIRI accepts reaches one settled outcome. A cue names a driver. What the driver
does with it on the way to its mounts is the driver's own protocol, and may include fan-out.

Which transport carries which kind is the host's implementation. A driver never sees a transport.

## 5. Model handling

### 5.1 Identity

AIRI's **adapter** is the sole authority for model and profile identities. It mints an identity when
an import is confirmed, adopts the identities a bundle carries when a model is restored, and
guarantees uniqueness. A driver persists the values it is given, and MUST NOT invent, derive or
rewrite one.

Identities are opaque, globally unique, and stable across transfer, restore and backup. They are not
stable across independent imports: the same payload imported on two hosts MAY yield two identities.

AIRI cannot reference a model or a profile without their identities. Consequently an import always
produces a profile, even for a driver that holds no meaningful profiles.

A model can be in one of four states, discriminated by who may enumerate and reference it. The states are descriptive only.

| State            | AIRI enumerates | AIRI references | Driver enumerates | Driver references | Persists |
| :--------------- | :-------------- | :-------------- | :---------------- | :---------------- | :------- |
| `unimported`     | no              | no              | no                | no                | n/a      |
| `builtin`        | no              | no              | yes               | yes               | driver   |
| `imported`       | yes             | yes             | yes               | yes               | both     |
| `pending-import` | no              | no              | no                | no                | AIRI     |

Builtin models can be enumerated and referenced by the driver, but cannot be linked to a character
unless they go through an import. `pending-import` is a payload AIRI holds with a character but
cannot import yet because no installed driver serves it. It has no identity, so AIRI cannot
enumerate or reference it as a model; it is listed under the character that holds it, not as a
model of its own.

### 5.2 Profiles

A profile is a named persistent state of a model: an outfit, an alternate rig, a set of parameter
values, a composition the driver alone can reproduce. AIRI only names the result.

The driver's profile list is the single authority. A model record does not repeat it, and AIRI
SHOULD NOT keep a copy of what a profile contains — only a name and annotations for profiles it
references.

Saving a profile requires an activated driver. A driver reports the state it currently holds, which
is why a profile can be created during migration or from a settings window while the avatar is
closed. Removal MUST be idempotent.

A model or a profile AIRI still references is not removed. The driver asks AIRI before removing and
AIRI answers with the references it holds; a referenced one is refused with a distinguishable
outcome. The check covers the references AIRI holds, and AIRI promises nothing about a record it
cannot see.

### 5.3 Two-phase import

Import is split into two calls.

The first call is an inspection. AIRI holds the input once, hands the same set of files to every
installed driver that claims unified import, and each driver answers with what it found: one or more
models, each with a stable index within that answer, a display name, descriptive metadata such as
format, size, a suggested profile name and at most a small encoded preview, and a confidence score
for its own answer. The index is the driver's own handle on the input and means nothing to AIRI.
Inspection MUST NOT write to the input. A driver that writes anyway writes into its own namespace and owns what
it wrote; the input and AIRI's own state are untouched.

AIRI orders the reports by confidence and presents them to the user. Import is never automatic, so
the score need not be precise: it orders reports, and the user confirms.

The second call is a commitment. AIRI sends the entries the user confirmed, each paired with a model
identity and a profile identity the adapter minted. The driver answers with one record per imported
model, echoing the identities it was given. AIRI copies the input once per committed entry and
transfers each copy to the ownership of the input when the
transaction ends. A commit settles on its own, a failing one MUST NOT
undo another.

The driver MUST NOT leave a partially written model when a commit fails.

**Where the driver's half lives.** Both calls are the driver's `import` entry — `createImportEntry({ services })`
returning `probe`, whose result carries `confirmImport` — resolved through `ModelDriverManager.resolveEntrypoint`
with `ModelDriverEntryKind.IMPORT` and imported by the adapter's loader table, exactly like the mount, panels and
picker entries. AIRI's import panel calls it; no manager method, host service or separate transport is involved.

### 5.4 Builtin models

A driver MAY ship models of its own: presets, samples, a default it can create on demand.

Importing a builtin is handled by the driver: the driver's own UI offers it, the adapter mints
identities, and the result is an imported model that AIRI can reference. A builtin may be presented
and previewed by the driver's own UI, including its picker (§7.1). It cannot be bound to a card, or
named by a default, before it is imported.

### 5.5 Duplicates and replacement

An identity that is already taken is rejected: a restore or a bundle carrying an identity AIRI holds
is a conflict.

Two models are the same model only when they carry the same identity. AIRI compares no content and
no path reports a duplicate on AIRI's behalf: an ordinary import mints a new identity, so importing
one payload twice produces two models. A driver MAY warn that a payload resembles one it already
holds.

Replacement happens only on the user's explicit "replace" action. It substitutes the model payload
and keeps profiles and settings, unless a reset is also requested. The operations MUST be atomic.

### 5.6 Migration provenance

A migration is not an ordinary import and MUST NOT be expressed as an implicit upsert. The host
writes a marker before committing — which legacy source, which payload digest, which target
identity, and whether it is in progress or done — and passes that provenance with the commit.

### 5.7 Preview and authorship

A driver produces a model's thumbnail, and AIRI stores its own copy. The stored copy is used for
preview without requiring a running driver.

A preview that cannot be produced is reported and MUST NOT fail the import; AIRI stores the copy
when one exists.

Authorship is part of the model, not a decoration on AIRI's side: a name, an optional avatar and an
optional source link travel with the model record and are cached the same way.

### 5.8 Enumeration

AIRI obtains model rows from the manager, and only imported models appear there. A row is one model
in one profile, so a picker can offer the same model in several named states from the same list the
catalogue uses.

Rows are deliberately small, because they cross a process boundary per model per profile: a display
name, the profile's name, an optional short encoded thumbnail rather than a blob, an optional author,
an advisory size and an import timestamp. A failure to answer is an error and MUST NOT be read as
"this driver has no models".

AIRI persists these rows: a disabled driver cannot answer, so its models stay listed and are
presented as unavailable until the driver is enabled again. AIRI uses them for its catalogue, a
character's model chip and the unavailable-model view, and they are the source of AIRI's own picker
for models that are unavailable for a driver reason (§7.3). Rows are not the source of a driver's
picker (§7.1).

AIRI re-enumerates when it needs rows and whenever a manager reports a change (§4.2).

### 5.9 Capabilities per model

What a model can do is discovered on demand, at model level, under the resources currently
available: the expressions, motions, parameters, effects, points of interest and profiles the driver
can actually offer for that model. The answer is not fixed by the model's files, because a
texture-heavy outfit or a memory-hungry motion may be unavailable on this device.

### 5.10 Transfer and deletion

A driver MAY package one model, or its entire state, as an opaque bundle. AIRI only moves the bytes.
Identity survives the round trip: a restored model lands on the same model and profile identities
the original import established, which is what keeps every existing reference valid.

A driver that persists anything SHOULD be able to delete everything it persisted. Deletion covers
models, profiles, per-model state and the driver's own settings; AIRI clears its records after that
succeeds. A model or profile AIRI still references is refused (§5.2).

## 6. Driver declaration

### 6.1 What a declaration contains

A driver announces itself with a declaration that is read before any of its code runs. It MUST
carry: an identity that is unique among drivers, a human-readable name, a version following semantic
versioning, the contract revision it was built against, a capability claim, the requirements it
needs satisfied, and the entry point to its manager.

The manager is the only entry point the declaration names. It knows where the rest of the driver's
code lives.

### 6.2 Contract compatibility

AIRI MUST accept only drivers whose contract revision is compatible with its own, and MUST reject a
mismatch when it reads the declaration rather than at the first call. Compatibility follows semantic
versioning: the same minor version below one point zero, the same major version from one point zero,
and a patch difference is compatible. Rejection SHOULD include a readable reason, because the
failure MUST be presented to the user.

A driver built against an older minor of the same major runs. What its own revision did not define it
does not report, and the host does not offer the surfaces that depend on it (§6.4).

### 6.3 Requirements and degradation

Requirements state what must exist for the driver to run at all. When a requirement cannot be
satisfied, the driver and AIRI MUST tell the user what will not work, and MUST NOT present the
situation as a hard failure.

### 6.4 Capability claim and capability probe

A driver states what it can do twice, and the two answers have different standing.

The declaration carries a static claim, available without executing anything, so a settings page or
AIRI's own picker can reason about the driver before it runs, and so the host has something to show
when a probe fails.

The live probe is the truth: it reports availability under the resources actually in effect in that
window. A missing grant, a device that cannot hold the model, or memory pressure each take a surface
away, so the claim is a hint and the probe is what a running host acts on. The probe MUST be
complete for the revision the driver was built against: a key that revision did not define is not
reported, and the host does not offer what the key gates. The set of keys is fixed by that revision,
and adding one is a minor change (§6.2).

A host probes, caches the answer and acts on it. A driver may still refuse a cue the probe allowed.

Capabilities cover at least: participation in unified import, preview generation, capability
discovery mode, profile support, per-model transfer, whole-driver transfer, settings panels,
deactivation, purge, legacy migration, the additional cue kinds accepted beyond loading, the
interaction modes the model supports, and the optional mount queries of §8.6.

### 6.5 Loading

Only the manager is declared statically and loaded at startup. Everything else is reached through
it, when a window needs it.

## 7. Selection, replacement and fallback

### 7.1 Selection

The ordinary picker is the driver's. The driver lists the models and profile variants it can serve,
presents them however its format warrants, and owns everything about the choice. AIRI mounts it,
tells it which character is being served and which model that character currently uses, and receives
a model and a profile on user-confirmed choice.

Only imported identities may be returned. A picker MAY list builtin models and MAY let the user choose one, but it
MUST NOT import it itself: it passes the files it has to the `requestImport` callback it is given (absent when the
host has no import surface), which probes them with the originating driver's `import` entry, and only the imported
pair may be returned.

AIRI also provides a picker of its own, for models that are unavailable for a driver reason (§7.3).
It lists what AIRI holds rows for, warns when the chosen model cannot be loaded, and writes the
identities to the character anyway.

### 7.2 Replacement

Choosing a different model for a character replaces the original, it does not add one: persist the
new model identity, clear the previous model's prompt from the card, then send a cue to load the new
model. Failure MUST NOT be silently rolled back into the previous state.

The mount survives a model change. Only a change of driver replaces it.

### 7.3 Unavailable models

A character may name a model that cannot be shown right now. The reasons may be:

| Reason            | Meaning                                                        |
| :---------------- | :------------------------------------------------------------- |
| `driver-unknown`  | No declaration is registered for the driver the binding names. |
| `driver-disabled` | The driver exists and the user turned it off.                  |
| `driver-error`    | The driver exists and is enabled but failed to activate.       |
| `model-missing`   | The driver is healthy and no longer holds this model.          |
| `runtime-error`   | The mount itself failed to render the model.                   |

The model is kept and presented to the user, marked as unavailable. The fallback offers what can
actually be done: enable the driver, choose another model through AIRI's picker, or clear the
binding. Availability is not state (§5.1): an imported model whose driver is temporarily absent is
still imported, and returns unchanged when the driver does.

A legacy reference that no longer resolves is not `model-missing`: it was never a model (§13.2).

### 7.4 Prompt

The prompt of a model in a profile describes how that model should behave and which tokens it
accepts, so only its driver can write it. The driver publishes the prompt of a model and profile,
and keeps the history itself.
Publishing requires an activated driver. A card whose model has published no prompt simply has no
prompt, there is no fallback.

## 8. Mounting

### 8.1 What a mount is

A mount is one driver component rendering one model into one box. AIRI creates the container, mounts
the component, and thereafter only asks questions, listens to events and sends cues. AIRI never
directly reads or writes a mount. Everything visible inside the box is the driver's.

### 8.2 Where a mount is

A mount sits on a **surface**: a slot AIRI knows in advance, such as the standalone actor window,
the chat window, the settings preview or the rehearsal room. A surface is AIRI's vocabulary; a
driver treats it as a routing address.

A **purpose** states what that slot is for, so two actor surfaces can exist — one acting, one
previewing — without the two concepts collapsing into one list of every combination. A purpose
carries meaning: a driver MAY vary its behaviour by it.

A caller names a surface and a purpose; a cue never names a mount. The adapter mints a mount's
identity before the mount and passes it in. The driver's own handle for it is internal.

Surfaces and purposes are fixed by the contract revision: a driver treats an unknown value as an
opaque address, varies its behaviour only for purposes the revision defines, and a new one is a
minor change (§6.2).

### 8.3 What the host assigns

The host tells a mount, as props: its surface and purpose, whether it is paused, whether it is
visible, the accessibility preference for reduced motion, a quality hint when the host is struggling
to keep up, and the interaction mode the host wants — `tactile`, `orbit`, `drag`, `positioning` or
`none`. The host offers only the modes the driver declared (§6.4).

The container's box is the viewport. The host passes no size, and a mount measures its own
container.

Two prop families are deliberate. Host decisions that can change while a mount lives are props,
because a prop is a value the host can restate. Streams of events are services a renderer subscribes
to, never props, because the host has nothing to restate while nothing is happening.

### 8.4 Readiness

A mount reports its own readiness, and the vocabulary distinguishes causes rather than collapsing
them into "mounted":

| State              | Meaning                                             |
| :----------------- | :-------------------------------------------------- |
| `unmounted`        | Nothing is mounted.                                 |
| `mounting`         | The mount is initialising.                           |
| `ready-for-model`  | No model loaded; ready to accept one.               |
| `loading-model`    | A model is loading.                                 |
| `model-loaded`     | A model is loaded and renderable.                   |
| `model-error`      | The model itself cannot be shown.                   |
| `mount-error`      | The mount itself cannot operate.                    |

The distinction matters because "this model is broken" and "this renderer is broken" lead to
different recoveries, and a mount that reports success after a failed load makes every downstream
decision wrong. The states, the transitions between them and which states count as ready are part of
the contract. A host decides what to do about an illegal transition, never what is legal. A change
to any of it is a new major version.

### 8.5 Events

A mount reports: readiness changes, the first real frame presented, changes in context validity,
disposal, failures, changes in the interaction region under the pointer, the correlation value of a
motion that finished, and cues it could not handle with a reason.

Two of these are edge-triggered by design. Interaction regions report entering and leaving only,
never per pointer move, because the host already has the pointer and a stream of the same fact would
double it. A finished motion reports its transaction's correlation value, so a caller with several
motions in flight can tell which ended — there is no start or progress counterpart, because
scheduling the next animation belongs to whoever owns the mixer.

A cue may reach several mounts, so one transaction can produce this report once per mount.

### 8.6 Queries

A mount MAY answer four questions, each declared through capabilities so the host can decide whether
to offer the UI that needs it:

- whether anything is drawn at a point, which the host uses for click-through and fade decisions at
  window level;
- which interaction region covers a point, which exists for regions *AIRI* adds rather than regions
  the model defines;
- stop whatever is playing, used on pause and teardown;
- release resources, with the host choosing shallow or deep release.

These are questions about one viewport. The window that created the mount asks its own instance; a
request from anywhere else names a surface and a purpose, and the driver resolves it. Capture follows
the same rule (§9.6): from outside the creating window it names a surface and a purpose, and the
driver decides which mount answers.

Capture is deliberately not a query. It is a transaction addressed to one driver, it can be refused,
and it can fail — so it is a cue with a result (§9.6).

## 9. Cues

### 9.1 An envelope is a transaction

Cues travel in envelopes. The cues in one envelope are applied together and MUST NOT be left
half-applied, which is why a multi-part change — a profile and an expression together — is one
envelope rather than two.

An envelope names its source, whether it overrides what is already there, whether it is persistent,
the time it was created and a correlation value. A non-persistent envelope is a preview: applied
transiently, never saved, never becoming the renderer's stored state. Loading, resetting and
captioning have no transient form.

Senders MUST NOT stream cues for continuous manipulation. Anything continuous is a prop or a
subscribed stream; a stream of cues would allocate a transaction and an acknowledgement per frame.

The sender MUST NOT rely on the order of cues inside an envelope. The order in which a driver
applies them is its own choice.

### 9.2 Addressing

An envelope names a driver, and where inside it the cues apply: a surface, optionally refined by a
purpose. The broker delivers it to that driver's manager. The manager forwards it to the mounts that
match, over its own protocol, and may fan out to several of them.

An envelope does not name a mount. A surface is stable while mount identity is not. A surface or a purpose may match several mounts, because a window can be
duplicated; the driver decides how to answer a transaction whose cues produce multiple results, and a
caller MUST NOT assume which viewport answered.

### 9.3 Acknowledgement

An acknowledgement carries the correlation value it answers, the driver that answered, one outcome
per cue, and a convenience derived from them. A transaction has one answer and one settled state.
When an envelope reached several mounts, the driver decides each cue's outcome and whether the
envelope is handled.

The cue that could not be applied carries the reason; the others are left blank. A driver MAY attach
debug messages to the non-offending ones.

The acknowledgement is settled when the outcome is decided, not when the renderer accepts the
request. A load therefore settles once the mount reports the model loaded, not at the first frame,
which keeps "the loading indicator may go away" as a separate and earlier fact.

A transaction is accepted before it settles. The broker returns its correlation value when it
accepts it, so a caller can name a transaction that is still in flight; the acknowledgement arrives
when the outcome is decided.

### 9.4 Refusal and failure

A refusal means the cue was considered and not applied: not supported, unknown key, renderer not
ready, no model loaded, suppressed by policy, made moot by a newer transaction, or busy. Each is a
successful transaction with an unapplied outcome, never an exception and never a transport failure.
The reasons are fixed by the contract revision; adding one is a minor change.

A failure means the operation did not succeed: the asset is missing or corrupt, the input could not
be read at all, the driver is unavailable, a required service was never provided, the identity
conflicts, encoding failed, the deadline passed, it was withdrawn before it started, it was stopped
while running, the window that received it went away, or an unexpected internal error occurred. A
failure is reported once, as the result of the call, and the same fact reaches everyone else as a
readiness state and an error event.

A transaction that did not run to an outcome settles as `cancelled`, `aborted` or `error` (§9.7).

The two vocabularies MUST NOT be merged. A renderer that reports one as the other makes every retry
and every message wrong.

### 9.5 The vocabulary

- **load** — put one model, optionally in one profile, on this mount.
- **act** — run one ACT token. The token travels verbatim and the driver projects it; the
  vocabulary behind it is the driver's and is known only at runtime.
- **expression** — set one expression unit to a normalised value, optionally with a hold time
  before the renderer's saved state resumes.
- **motion** — play one motion by the identity the driver listed, with an optional repeat count
  where the asset's own declaration is honoured by default, and an optional crossfade.
- **effect** — trigger one visual effect family for an optional duration.
- **profile** — switch to a named profile.
- **gaze** — override where the model looks, with the live pointer, a point on screen, a point of
  interest, or nothing for a reset.
- **view** — put the renderer's camera on a place the renderer has named, at an optional relative
  distance. Which parts of a model are worth looking at is a fact about the rig.
- **caption** — render text the driver draws itself, optionally with a sentence split, a language,
  and how far into the utterance playback already is. Formatting is not expressible.
- **reset** — hand one thing back to the renderer's saved state: an expression, a motion, an effect,
  a profile, a gaze override, the camera, the model's transform, a caption, or all of them.
- **capture** — encode what this mount currently shows (§9.6).

A driver declares the cue kinds it accepts beyond loading, and may refuse the rest. The kinds are
fixed by the contract revision; adding one is a minor change.

### 9.6 Delivery guarantees

Delivery is ordered per addressed driver and does not wait for completion: two envelopes for one
driver may be in flight together, and the driver chooses how to handle them.

A correlation value is created by the broker for the whole application, so two windows cannot mint
the same one; a renderer compares values only against other transactions on its own mount, where an
older one is stale.

A caller may ask that a transaction be dropped rather than delivered when the target is not ready.
Dropping is a choice and not a failure: it resolves successfully with an unapplied outcome in every
slot. A caller may also give a deadline, after which a transaction that has not settled ends as
`error` rather than waiting forever. The deadline is final and stops nothing: the work may continue, and
an acknowledgement that arrives afterwards is discarded rather than settling it a second time.

When a window goes away its mounts leave the registry and every pending transaction for them ends:
`cancelled` if the broker never delivered it, `aborted` if it did. A caller is never left waiting on
a renderer that no longer exists. AIRI owns delivery and settlement, and no transaction is lost
without an outcome.

### 9.7 Cancellation

Cancellation covers cue transactions. Import, preview, transfer and profile
operations run to completion and cannot be cancelled.

A transaction is in one of these states:

| State | Meaning |
| :--- | :--- |
| `submitted` | The broker has accepted it and it has not reached the receiver. |
| `queued` | The receiver holds it and has not started it. |
| `running` | The receiver is performing it. |
| `complete` | It finished and its acknowledgement is settled. |
| `cancelled` | It was withdrawn before it started and will not be performed. |
| `aborted` | It started and was stopped before it finished. |
| `error` | It did not succeed: it broke, or its deadline passed. |

`complete`, `cancelled`, `aborted` and `error` are terminal state.

Six requests withdraw work. Each names its target: correlation values, or a surface and purpose. A
request that names no target is malformed, and a request addresses one driver: values belonging to
two drivers are not named together.

| Request | Withdraws, within the target | When a target is already running |
| :--- | :--- | :--- |
| `cancel` | transactions that have not started | refused: the transaction continues |
| `abort` | any non-terminal transaction | the receiver decides |
| `pop` | the receiver's newest transaction that has not started | not applicable |
| `pop-all` | every transaction of that receiver that has not started | not applicable |
| `abort-current` | the running transaction | the receiver decides |
| `dump` | every non-terminal transaction of that receiver | the receiver decides |

`cancel`, `pop` and `pop-all` withdraw a transaction that has not started and settle it `cancelled`;
they never stop one that is running. `abort` and `dump` also reach a running one: the receiver decides
whether to stop it, which settles it `aborted`, or to finish it, which settles it with its own
outcome. Withdrawing a transaction that has not started settles it `cancelled`.

Queue boundaries are the driver's own: it may keep one queue or several, as long as the target it was
given selects the transactions the request withdraws. A withdrawal request has no deadline; a caller
that no longer cares stops waiting, and reports nothing.

A request resolves against the state the transaction has reached. One the broker has not delivered is
settled by the broker and never reaches the receiver; one it has delivered is settled by the receiver. A
targeted request applies first to what the broker still holds, then to the receiver's queue.

A request answers with one result per target it was given or selected:

| Request | Target not started (`submitted`, `queued`) | Target running | Target terminal | Target without a record |
| :--- | :--- | :--- | :--- | :--- |
| `cancel` | `cancelled` | refused; reports `running`, and the transaction continues | reported as it settled | `unknown` |
| `abort` | `cancelled` | `requested`; settles `aborted` or with its own outcome | reported as it settled | `unknown`, or `empty` when the target is a surface and purpose |
| `pop` | `cancelled` for the receiver's newest that has not started | not applicable | not applicable | `empty` |
| `pop-all` | `cancelled` for each | not applicable; running transactions are left alone | not applicable | `empty` |
| `dump` | `cancelled` for each | `requested`; settles `aborted` or with its own outcome | not applicable | `empty` |

A request naming one correlation answers with that result; one naming several answers with one entry
per correlation and a count; a request naming a surface and purpose answers with the correlations it
affected and a count. The broker MAY keep a record of what has been handled, and answer with a
non-`unknown` result for recent transactions.

The host bounds the number of correlation values a request may name and the size of a report; a
malformed request fails.

A correlation value names a transaction for the whole application; any caller that holds one may
address it.

A withdrawal travels on the same ordered path as the envelope. A driver stops at an atomic boundary and MUST NOT leave an envelope half-applied. Cancellation
only addresses a transaction.

Cancellation stops work, not state. Handing applied state back is `reset` (§9.5).

## 10. Host services

### 10.1 What is injected

A runtime is handed one container at activation: a logger, driver-namespaced storage, the prompt
channel, the cue channel, pointer input, host theme, user-facing messaging, localization, ambient
runtime facts, an optional platform bridge and an optional diagnostics sink.

The container is the pull side of the contract. It carries ambient facts that cannot change while an
instance lives, and capabilities a driver may decline. Anything that is a decision about one mount is
a prop on that mount; anything discrete and refusable is a cue.

A missing optional service is a reduction in capability. What a driver cannot do under the resources
in effect is answered by its probe, which the host reads before offering the corresponding UI.

### 10.2 Storage

AIRI only offers storage primitives: get, set, observe, and remove storage keys.

Storage is isolated per driver, and the host enforces the isolation: a driver cannot read another
driver's data. Each instance receives its own handle, and all handles of one driver address the same
namespace. Two windows may write to it at once; making concurrent writes converge is the driver's
responsibility.

The driver manages everything below the namespace level. A manager reaches storage by asking the
host for an adapter, and the host may run the driver's non-rendering code in a window of its
choosing. If the host cannot provide an adapter, the driver reports the failure; AIRI supplies the
interface and the driver handles its own cases.

The route is the same on every host, including a single-process one.

### 10.3 Pointer input

A renderer receives pointer input through the contract. Events are delivered per mount, subscribed
by mount identity, and only a live mount created by this host may subscribe. The host provides a
pointer position relative to the top-left corner of the container's box, in CSS pixels, if any.

The runtime MAY attach its own pointer event listeners, but pointer events that happen outside of
the renderer window can only be listened on the service.

### 10.4 Prompt

The prompt is text, not structure. AIRI does not parse it and composes nothing into it.

A driver publishes the prompt and the ACT token list of a model in a profile as one pair, versioned
per model and profile. The list is what AIRI extracts cues with. The driver guarantees the two are
in sync and owns the version's monotonicity. AIRI compares them and surfaces a mismatch to the user:
a list older than the prompt is a fault.

A driver republishes when the profile changes, whether or not either half changed. AIRI keeps the
last publication it received, writes the prompt into a character card only while that model and
profile are the ones the character uses, and holds no history and no version ledger. The copy exists
so a model's prompt survives a driver that is not running.

AIRI never waits for a publication and never falls back to an older pair. It composes with the newest
pair it holds; a model with no publication has no prompt (§7.4) and still loads.

The prompt SHOULD stay stable for the length of a conversation. A profile switch is the exception:
it changes the pair and the prompt in the card, and the cost to prefix caching is accepted.

### 10.5 Theme, messaging, localization and runtime facts

Theme is the one setting whose ownership runs host to renderer: accent hue and light or dark is a
host-wide appearance decision, so it cannot move into driver storage without every driver inventing
its own idea of the current theme. A driver re-tints on an observation (§4.2) and never writes it.

Everything else that looks like a setting — render scale, physics switches, blink and idle flags,
camera framing — belongs to the driver and lives in its storage. The container also carries its host
surface, debug switches, transient user messaging with an optional confirmation, localized strings,
and a trace sink.

## 11. Driver UI

### 11.1 Panels

A driver contributes panels: tabs in a settings page, a popover in the control strip, an inline block
in a card editor. A panel is the driver's own UI for its own capability record — labels, usable and
favorite toggles, idle selection, ACT mappings, outfit profiles, calibration — because only the
driver can parse the asset and only the driver can express how its capabilities combine.

The host provides the frame and says which surface and host chrome the panel is rendered into. The
panel carries driver code and a channel to the driver's manager. How it finds a mount, whose
readiness it reads and what it edits is the driver's implementation.

Panels declare where they are worth appearing. The host lists a panel only in the chrome it
declared; a driver that declares nothing for a surface is simply not offered there, and the host does
not invent a substitute.

A panel never writes AIRI state: it edits driver storage — which a live mount observes — or sends
cues. There is no host-side draft to publish and no global "current model" to change.

### 11.2 Settings and selection are separate

A settings panel edits a model the user already has. A picker answers which model, or which profile,
the character should use, including the ones only the driver can see. Keeping them apart lets
selection be offered from a card editor, a fallback view and the control strip without duplicating
per-format UI, and lets the host show a driver's settings while refusing to guess at a model list.

## 12. Speech

The host owns the audio graph and publishes low-rate frames
carrying a timestamp, an amplitude, and optionally mouth openness or a detected viseme. The stream is
observer-style: latest-wins, no acknowledgement.

AIRI provides a default analyzer, and the host runs it once for every driver that does not provide
its own. A driver that measures differently provides its own; the declaration does not name it, and
the manager answers a request for it and knows where it is. A driver's analyzer produces its own
frames only and never changes another driver's. A driver that wants lip sync subscribes to the frames
and maps them onto its own rig. It never receives raw audio input.

## 13. Migration of pre-contract data

### 13.1 Settings AIRI already holds

A driver that replaces an in-tree renderer inherits settings AIRI has stored for years under its own
key names. They are AIRI's data in AIRI's shape, have no home in driver storage, and are
unrecoverable once the legacy code is deleted, so the contract carries exactly one channel for them.

The host offers the bag once per driver, after activation and before the first mount: the legacy
values that belong to that driver by AIRI's own names, plus the model that was selected when the bag
was written, because some of those values are window-global and applied to whichever model happened
to be on screen. Without that identity a driver could only guess which model they described. The bag
is scoped to one driver.

The driver absorbs the whole bag. The host deletes the bag once the driver acknowledges it, then writes a marker. A
crash between the driver's write and the marker re-offers the same bag, so absorbing it must be
idempotent.

The bag is not a schema. Its keys are AIRI's history and disappear with the migration code that
writes them; a driver must not store them and the host must not interpret what the driver did with
them. A driver that never existed outside this contract answers that it has nothing to inherit, and
the host drops the bag instead of keeping it forever.

### 13.2 Models and references

Legacy models and model-bearing character cards are imported inside the transaction that reads them.
The user confirms the models, the adapter mints identities, the import commits, and only then does
the card or the migration record point at them. Writing a card first and importing afterwards is
forbidden: a crash in between leaves a reference nothing can serve.

A legacy reference is not an identity. AIRI resolves it by exact legacy id, then by the alias table
the migration ships, then by asking the user what the model was. A reference that none of these
resolves is no model: the binding is cleared, the user chooses another through a driver's picker, and
the result is never presented as an unavailable model (§7.3).

A model the user does not confirm is neither deleted nor imported. It becomes a pending payload:
AIRI keeps it, lists it and keeps it operable, and it can be imported later. The legacy id travels
with the payload as a label, not as an identity, and resolves to no model.

A preset is a builtin (§5.4), so it is imported rather than special-cased, and the imported copy is
thereafter an ordinary model. A card that references a builtin imports it inside the card's own
confirmation.

A legacy preview that is an address rather than an image is fetched during migration and stored, or
skipped with a warning — never stored as if the address were the image.

Legacy deletions are recorded rather than performed silently. A deleted key or asset that is not
remembered will come back from an old backup or a second device; the contract therefore requires
deletion to leave a durable marker that export and restore both respect.

### 13.3 The two stores during migration

Formats migrate one at a time, so AIRI holds two sources at once: models still in its own storage,
and the rows a migrated driver reports. AIRI lists everything it holds without a model identity as
one list — legacy models under their legacy identities, pending payloads, and driver rows beside
them.

A model has one owning source. A driver's cutover imports and commits every model the user
confirmed, moves the rest into AIRI's pending payloads, and only then removes the legacy rendering
path for that format. After the cutover that slice leaves AIRI's storage, and the legacy store is
deleted when the last driver has migrated.

A backup written before this contract is read by a legacy reader that imports fully during restore
and writes deletion markers for what it consumed. The reader SHOULD live as long as the legacy backup
format can be restored; the format carries a version, and an explicit cutoff declares older backups
unsupported.

## Appendix A: Recommended order of events

### 1. Resolving drivers

1. At startup, AIRI registers the declarations it ships.
2. For each registered driver, AIRI creates its manager.

### 2. Mounting a component

A component is mounted

1. When AIRI needs to render or select a model, it asks the registry for a mount identity — which
   driver, which surface and purpose — and the registry issues one; the adapter then resolves the
   corresponding entry point by asking that driver's manager.
2. The interface mounts the returned component, then receives its services as props.
3. Driver UI is mounted the same way, from its own entrypoint.

An adapter hands out three things on request: an entry point for the purpose it was asked for,
containing code to run and/or a component to mount; a channel to the driver's manager; the service
container. The last two require authenticating with the manager, and the registry grants a runtime
access to resources only after that succeeds. The authentication between runtimes and managers is the
driver's implementation.

## Amendment 1 — contract `0.1` (Phase 0)

This amendment is normative. It records what the published contract of `0.1` contains beyond the body
above, so that the conformance map in the implementation plan is true rather than aspirational. Every
item below landed in `@proj-airi/stage-renderer-sdk` before any host code depended on it; nothing in
the application imports the package yet.

### A1.1 Added symbols

| Symbol | What it fixes |
| :--- | :--- |
| `RegistryHandle` (`log`, `requestRenderer`, `listDrivers`, `isEnabled`, `onChange`) | A manager runs where there is no DOM, so it needs a way to ask for a renderer — and it gets **no storage**, because main has no IndexedDB. |
| `ModelDriverManagerFactory` | The shape the `entry.manager` module exports: `createManager(handle)`, called once, owning no window and no storage. |
| `RequestRendererResult` / `RendererRequestRefusal` | The four host-owned refusal reasons (`window-unavailable`, `entry-failed`, `driver-disabled`, `shutting-down`), so a driver never invents one. |
| `ManagerChannel` | The opaque manager↔window message pair (`send`/`onMessage`). The host transports it and does not interpret it; the pair `(window, driver)` is the whole authentication. |
| `MountId` + `HostRegistryClient.registerMount` | Mount identities are **issued by the registry**, never minted by a renderer. A mount is unaddressable between creation and the answer, and readiness does not begin before it. |
| `ModelDriverEntryKind` + `EntrypointRequest` + `EntrypointResolution` | `ModelDriverManager.resolveEntrypoint` answers which module implements `provider`/`mount`/`panels`/`picker`/`import` for a given surface and purpose, and `null` for a kind the driver does not ship. The kind is the only distinction between them, and the adapter's loader table is keyed by it. |
| `LegacyRestorePayload` | The data path for a revert: one model's retained pre-contract entry, carrying the **legacy identity** the legacy record is recreated under. |
| `PendingModelPayload` | A payload the user did not confirm: AIRI's record, with **no `modelId` and no `profileId`**, so it cannot construct a `LoadCue` and `pending-import` is not a model state. This supersedes the `pending-import` row of §5.1: a state that only exists inside a transaction was a fifth value every reader had to handle, while a payload with no identity is not a model at all. |
| `isContractCompatible` + `compatibility.ts` | The compatibility predicate, with a readable rejection. A pre-1.0 revision must match the host minor exactly, which is what refuses a `0.0.x` manifest. |
| `ContractFailureCode.PROFILE_MISSING` | The one unavailable-model reason that is an error rather than a lost referent: a binding whose model resolves and whose profile does not. |
| `ContractFailureCode.INVALID_ENTRYPOINT` | The manager named a module the adapter cannot import. The adapter never substitutes a default. |
| `ContractFailureCode.MODEL_REFERENCED` / `PROFILE_REFERENCED` / `CANCELLED` / `WINDOW_GONE` | The reference gate's two refusals (with `ContractFailure.references` naming the character), the never-ran settlement, and the window that went away — distinct from `aborted`, which ran and was stopped. |
| `ContractFailureCode.CONTRACT_VERSION_MISMATCH` | The revision refusal, raised when the declaration is read. |
| `READINESS_TRANSITIONS`, `isReady`, `isReadinessTransitionAllowed`, `assertReadinessTransition` | §8.4's states, transitions and readiness as data rather than prose. Only `ready-for-model` and `model-loaded` are ready; a redundant re-emit is legal and is not a transition. |
| `ModelDriverManager.deliver` / `withdraw` / `onModelsChanged` / `queryMount` / `commandMount` / `resolveSpeechAnalyzer` | Manager-side delivery, the six withdrawals, the enumeration-change nudge, the two cross-window query paths of §8.6, and the analyzer request of §12. |
| `CueTransactionState`, `CueWithdrawalKind`, `CueWithdrawalRequest`, `CueWithdrawalReport`, `CueWithdrawalOutcome`, `CUE_WITHDRAWAL_LIMITS` | §9.7 as values: seven states, six requests, one result per target, and the host's bounds (64 correlations per request, 256 report entries). |
| `CueTransactionReceipt` | The acceptance/settlement split of §9.3: `{ nonce, settled }`, where `settled` resolves when the outcome is decided. |
| `ModelPromptPublication` + `ModelPromptSnapshot` | §10.4's pair, versioned per model **and** profile. |
| `ModelCapabilityKind.EFFECT`, `EffectCue`, `ResetScope.EFFECT`, `GazeMode.POINT_OF_INTEREST`, `CueRejection.NO_TARGET`, `OptionalCueKind` | The §9.5 vocabulary deltas, and "those beyond loading" as a type. |
| Host reference evidence, `classifyBindingAvailability` | The one documented bridge between `DriverStatus` and `UnavailableModelReason`, with a fixed precedence. |

### A1.2 Cue addressing and acknowledgement

§9.2's rule is now the only shape: `CueEnvelope.target` is required and names
`{ modelDriverId, surface?, purpose? }`, and the envelope names **no mount**. §9.3's split is explicit:
`send` resolves with a receipt (`{ nonce, settled }`), the broker mints the nonce on acceptance, and
the acknowledgement — which names the answering `modelDriverId` and may carry driver debug text —
arrives when the outcome is decided. The host-minted `requestId` is removed; it was a second
correlation value for the same fact.

`CueAck.mountId` remains, for one purpose only: a broker that crosses a process boundary rejects an ack
attributed to a window that does not own the mount. It is **not** an address, and no caller routes by
it.

`NO_TARGET` is the broker's decision, delivered to the originating adapter as a settled transaction with
`handled: false` and one rejected outcome per slot. It is not delivered to, or decided by, a renderer.

### A1.3 The declaration, and where the rest of the code lives

§6.1 is now literal. `ModelDriverEntryPoints` is `{ manager: string }` and nothing else; a declaration
that also names `provider`, `mount`, `panels`, `picker` or `import` is refused by `validateManifest`, because that
is the shape that lets a DOM-free process pull renderer code into main. Everything else is resolved at
the moment a window needs it (§6.5), by the manager, and imported by the adapter through its own loader
table. The kind set is those five entries and `ModelDriverEntryKind` is the only distinction between them: the
loader table is keyed by kind, and what a module exports is the contract's answer per kind — a component for
`mount`/`picker`, declarations for `panels`, `startProviderEntry` for `provider`, `createImportEntry` for `import`.
`capabilities.interactionModes` (§6.4) and `capabilities.prompt` (§10.4, D5) join the capability
key set, which a probe must report completely.

### A1.4 Mounts, readiness and queries

A mount's identity comes from the registry (§A1.1), not from the adapter; Appendix A's earlier wording
("the mount identity the adapter minted beforehand") is superseded. No size is passed: the container's
box **is** the viewport, and a mount measures its own container — `RendererMountProps.viewport` is
removed, along with the `RendererMountViewport` shape.

§8.6's queries are reachable from outside the creating window: `ModelDriverManager.queryMount` and
`commandMount` take a selection (`surface`, `purpose`, and optionally `modelId`/`characterId`) and
answer one entry per mount that matched. An empty answer is a successful "nothing matched", not an
error. The live-instance members stay for the window that created the mount.

### A1.5 Pre-contract data is per model, in both directions

§13.1's bag is superseded by a **per-model** handover, because the offer is made per model and
materialised lazily — one model's bytes in memory at a time, never the whole library:

```ts
interface ModelDriverLegacyHandoverEntry {
  schemaVersion: 1
  driverId: ModelDriverId
  createdAt: number
  modelId: ModelId // fresh, adapter-minted
  legacyModelId: string // provenance, and what a revert restores
  meta: { name: string, nsfw?: boolean, groups?: string[], tags?: string[], searchKeyInputs?: string[] }
  settings: { selectedModelId?: string, values: Record<string, unknown> } // window-global values, and the model they described
  values?: Record<string, unknown>
  placement?: { x: number, y: number, scale: number }
  outfits?: unknown[]
  prompt?: string
  files?: Array<{ name: string, mimeType?: string, bytes: Uint8Array }>
  url?: string
  assets?: Array<{ key: string, mimeType?: string, bytes: Uint8Array, deleted?: boolean }>
}

interface ModelDriverLegacyHandoverReport {
  retained: boolean // the driver kept the payload in its own storage
  unused?: string[]
  warnings?: string[]
}
```

`migrate(entry)` absorbs one entry and reports `retained`; a `retained: false` means the host writes no
migration marker and the model stays legacy-shaped. There is no `absorbed` boolean and no per-driver
aggregate — "did this model transfer" is `retained`, and "did the whole driver transfer" is a marker per
model. The driver MUST retain what it received and consume it **by reference** on import, so the
retained entry and the imported row are never two copies of the same bytes.

The reverse direction is `ModelDriverRuntime.restoreLegacy(modelId) → LegacyRestorePayload`, which
carries the same members back plus the legacy identity. It refuses — readably, never by returning an
empty payload — when the model has no retained pre-contract origin. `capabilities.migration` covers both
directions.

`confirmImport` gains the probe input (`input?`, absent for a retry, a restore, or a payload already
retained) and settles **one entry per selection**, so one uncommittable part of a package leaves the
others committed. `ModelImportMigration` is provenance only: no migration path sets `overwrite`, because
migration's import is the create.

### A1.6 The prompt is one versioned pair

§10.4's pair is `ModelPromptPublication` — `{ modelDriverId, modelId, profileId, text, tokens, version,
publishedAt }` — and the card's copy is `ModelPromptSnapshot`, the same value without the driver id. A
publication that is not **strictly newer by `version`** never supersedes the held one and is discarded;
`publishedAt` is not an ordering input, because device clocks disagree. An empty publication
(`text: ''`, `tokens: []`) is a valid publication and is stored as one; a prompt-capable driver that has
published nothing for a model it serves is a runtime fault surfaced in its panel, never an implicit
empty prompt and never a migration gate.

### A1.7 Vocabulary deltas

- The surface, purpose and host-window value `ACTOR` is renamed **`ACTING`** (`'acting'`).
- The cue kind and capability kind are `effect`; `ActTokenKind.VFX` keeps its spelling because it names
  a family that appears inside prompt text.
- `CueKind.ACT` is spelled `'act'`.
- `ResetScope` gains `effect`.
- `GazeMode` gains `pointOfInterest`, and `GazeCue` carries `pointOfInterestId` for it.
- A declared cue list is "the kinds **beyond** loading": `load` cannot be declared, because every mount
  must handle it.
- `load`, `reset` and `caption` have no transient form: an envelope with `persistent: false` carrying
  one of them is malformed.
- `ContractFailureCode.RENDERER_UNAVAILABLE` is renamed **`DRIVER_UNAVAILABLE`**, because the missing
  thing is the driver and not one of its mounts.
- `UnavailableModelReason` gains **`profile-missing`**, the only reason that is an error rather than a
  lost referent, and it is reported by the driver (via `ContractFailureCode.PROFILE_MISSING`) rather
  than derived from a driver's health.

### A1.8 What this amendment does not change

Capture remains a cue, not a query (§8.6). A mount remains independent, with no state scope and no
snapshot. Speech stays latest-wins observation and never travels as a cue (§12). Panels still never
write AIRI state (§11.1), and settings remain separate from selection (§11.2).

