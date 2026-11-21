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

The contract is built around four actors. A **registry** in the main process holds driver
declarations and the cue broker. An **adapter** in each renderer window resolves a driver's code
and helps it reach host resources. A **manager**, provided by the driver, runs in the main process,
answers queries about the models the driver owns and forwards cues to its mounts. A **runtime**,
also provided by the driver, runs in a renderer window that can load, draw or describe a model.

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

- No plugin loader, dependency-injection container or discovery mechanism. Plugin-ification is a
  later step and this contract is its groundwork. Install, discovery and enable/disable are not part
  of it yet; a driver's code is reached through the manager it declares.
- No storage medium, key layout, versioning scheme or migration rules for a driver.
- No uniformity forced on formats that genuinely differ. Differences are *declared* through
  capabilities rather than inferred by the host.

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

The driver is split across the two processes of an Electron application, because neither half can do
the other's work.

- A **registry** runs in the main process. It holds driver declarations, one manager per driver, and
  the cue broker.
- An **adapter** runs in a renderer window. It can resolve a driver's code and create a service
  container for it. When a window needs to run some model driver code, an adapter is required.
- A **manager** is driver code in the main process. It holds driver lifecycle and the models the
  driver owns, answers queries about them, and forwards cues to its mounts.
- A **runtime** is driver code in a renderer window. It is created when a window requests via an
  adapter. It may host a renderer and/or other code the driver needs on the renderer process.

| Concept  | Owner        | Process  | Count                      |
| :------- | :----------- | :------- | :------------------------- |
| Registry | AIRI         | main     | 1                          |
| Adapter  | AIRI         | renderer | one per window             |
| Manager  | Model driver | main     | one per driver             |
| Runtime  | Model driver | renderer | one per driver per window  |

The manager stays in the main process: it must survive a window closing.

The same model holds in a single-process host: manager and runtime are co-located and the adapter
passes through. Driver code takes one route on every host.

### 4.2 Communication

All cross-process communication uses typed event channels from the project's existing IPC library.
There are three kinds:

- **registry requests**, which carry a result and can fail: register, update and unregister a mount;
  list or query mounts; deliver a cue addressed to a driver; return an acknowledgement.
- **delivery**, pushed by the broker to one driver's manager.
- **observation**, broadcast and latest-wins, with no acknowledgement and no ordering guarantee.

A cue names a driver. What the driver does with it on the way to its mounts is the driver's own
protocol, and may include fan-out. AIRI provides the channel, not the protocol.

## 5. Model handling

### 5.1 Identity

A model and a profile of a model have their own identities. AIRI's **adapter** is the only source of
model and profile identities. It creates them after an import is confirmed and guarantees
uniqueness; a driver persists the values it is given, and MUST NOT invent, derive or rewrite one.

AIRI cannot reference a model or a profile without their identities. Consequently an import always
produces a profile, even for a driver that holds no meaningful profiles.

A model can be in one of four states, discriminated by who may enumerate and reference it.

| State            | AIRI enumerates | AIRI references | Driver enumerates | Driver references | Persists |
| :--------------- | :-------------- | :-------------- | :---------------- | :---------------- | :------- |
| `unimported`     | no              | no              | no                | no                | n/a      |
| `builtin`        | no              | no              | yes               | yes               | driver   |
| `imported`       | yes             | yes             | yes               | yes               | both     |
| `pending-import` | no              | no              | no                | no                | AIRI     |

Builtin models can be enumerated and referenced by the driver, but cannot be linked to a character
unless they go through an import. `pending-import` is a payload AIRI holds with a character but
cannot import yet because no installed driver serves it. It has no identity, so AIRI cannot
enumerate or reference it as a model; it is reachable by the identity of the character that
holds it.

### 5.2 Profiles

A profile is a named persistent state of a model: an outfit, an alternate rig, a set of parameter
values, a composition the driver alone can reproduce. AIRI only names the result.

The driver's profile list is the single authority. A model record does not repeat it, and AIRI SHOULD
NOT keep a copy of what a profile contains — only a name and annotations for profiles it references.

Saving a profile requires an activated driver. A driver reports the state it currently holds, which
is why a profile can be created during migration or from a settings window while the avatar is
closed. Removal MUST be idempotent.

### 5.3 Two-phase import

Import is split into two calls.

The first call is an inspection. AIRI holds the input once, hands the same set of files to every
installed driver that claims unified import, and each driver answers with what it found: one or more
models, each with a stable index within that answer, a display name, descriptive metadata such as
format, size, a suggested profile name and at most a small encoded preview, and a confidence score
for its own answer. The index is the driver's own handle on the input and means nothing to AIRI.
Inspection SHOULD not modify persistent states or the supplied input.

AIRI orders the reports by confidence and presents them to the user. Import is never automatic, so the score need not be precise: it orders reports, and
the user confirms.

The second call is a commitment. AIRI sends the entries the user confirmed, each paired with a model
identity and a profile identity the adapter minted. The driver answers with one record per imported
model, echoing the identities it was given. AIRI transfers the ownership of the input when the transaction ends.

The driver MUST NOT leave a partially written model when a commit fails.

### 5.4 Builtin models

A driver MAY ship models of its own: presets, samples, a default it can create on demand.

Importing a builtin is handled by the driver: the driver's own UI offers it, the adapter mints
identities, and the result is an imported model that AIRI can reference. A builtin cannot be
previewed through a mount, bound to a card, or referenced by a default, before it is imported.

### 5.5 Duplicates and replacement

An existing identity is rejected by default. AIRI's ordinary paths — a file drop, a directory pick,
a character card, a migration in progress — MUST report duplicates as a distinguishable conflict.

Replacement happens only when the user's explicit "replace" action. It substitutes the model payload
and keeps profiles and settings, unless a reset is also requested. The operations MUST be atomic.

### 5.6 Migration provenance

A migration is not an ordinary import and MUST NOT be expressed as an implicit upsert. The host
writes a marker before committing — which legacy source, which payload digest, which target
identity, and whether it is in progress or done — and passes that provenance with the commit.

### 5.7 Preview and authorship

A driver produces a model's thumbnail, and AIRI stores its own copy. The stored copy is used for
preview without requiring a running driver.

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

AIRI persists these rows: a disabled driver cannot answer, so
its models stay listed and are presented as unavailable until the driver is enabled again. AIRI uses
them for its catalogue, a character's model chip, duplicate detection and the unavailable-model
view. AIRI MUST NOT use them as the picker's data source; the picker is the driver's own component
(§7.1).

### 5.9 Capabilities and vocabulary per model

What a model can do is discovered on demand, at model level, under the resources currently
available: the expressions, motions, parameters, effects, points of interest and profiles the driver
can actually offer for that model. The answer is not fixed by the model's files, because a
texture-heavy outfit or a memory-hungry motion may be unavailable on this device.

The ACT token vocabulary a model accepts is answered separately, so AIRI can extract tokens from a
model's response without the driver reading that response. AIRI stores neither answer: both can
change without anyone being told, and a cached copy would describe a model that no longer exists.
Both SHOULD be stable while a model is loaded, because AIRI injects tokens into prompts and a
vocabulary that changes every turn destroys prefix caching.

The vocabulary reaches prompts only through the publication in §10.4.

### 5.10 Transfer and deletion

A driver MAY package one model, or its entire state, as an opaque bundle. AIRI only moves the bytes.
Identity survives the round trip: a restored model lands on the same model and profile identities
the original import established, which is what keeps every existing reference valid.

A driver that persists anything SHOULD be able to delete everything it persisted. Deletion covers
models, profiles, per-model state and the driver's own settings; AIRI clears its records after that
succeeds.

## 6. Driver declaration

### 6.1 What a declaration contains

A driver announces itself with a declaration that is read before any of its code runs. It MUST
carry: an identity that is unique among drivers, a human-readable name, a version following semantic
versioning, the contract revision it was built against, a capability claim, the requirements it
needs satisfied, and the entry point to its manager.

The manager is the only entry point the declaration names. It knows where the rest of the driver's
code lives.

### 6.2 Contract compatibility

AIRI MUST accept only drivers whose contract revision it can speak, and MUST reject a mismatch when
it reads the declaration rather than at the first call. Rejection SHOULD include a readable reason,
because the failure is a user-visible one. While the contract is below one point zero,
compatibility is exact: minor revisions are not interoperable. A version range becomes available only
once the contract itself is stable.

### 6.3 Requirements and degradation

Requirements state what must exist for the driver to run at all. When a requirement cannot be
satisfied, the driver and AIRI MUST tell the user what will not work, and MUST NOT present the
situation as a hard failure.

### 6.4 Capability claim and capability probe

A driver states what it can do twice, and the two answers have different standing.

The declaration carries a static claim, available without executing anything, so a loader, a picker
or a settings page can reason about the driver before it runs, and so the host has something to show
when a probe fails.

The live probe is the truth: it reports availability under the resources actually in effect in that
window. A missing grant, a device that cannot hold the model, or memory pressure each take a surface
away, so the claim is a hint and the probe is what a running host acts on. The probe MUST be
complete rather than sparse.

Capabilities cover at least: participation in unified import, preview generation, capability
discovery mode, profile support, per-model transfer, whole-driver transfer, settings panels,
deactivation, purge, legacy migration, the additional cue kinds accepted beyond loading, and the
optional mount queries of §8.6.

### 6.5 Loading

Only the manager is declared statically and loaded at startup. Everything else is reached through
it, when a window needs it.

## 7. Selection, replacement and fallback

### 7.1 Selection

The driver provides that UI and owns everything about the choice: listing its models and profile
variants. AIRI mounts it, tells it which character is being served and which model that character
currently uses. Upon confirmation, a model and a profile is emitted to AIRI.

Only imported identities may be returned. A picker MAY list builtin models and MAY let the user
choose one, but it MUST import it first and return the imported pair.

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
actually be done: enable the driver, install it when an install source exists, choose another model,
or clear the binding. Availability is not state (§5.1): an imported model whose driver is
temporarily absent is still imported, and returns unchanged when the driver does.

### 7.4 Prompt

A model's prompt describes how that model should behave and which tokens it accepts, so only its
driver can write it. The driver publishes the prompt of a model, and keeps the history itself.
Publishing requires an activated driver. A card whose model has published no prompt simply has no
prompt, there is no fallback.

## 8. Mounting

### 8.1 What a mount is

A mount is one driver component rendering one model into one box. AIRI creates the container, mounts
the component, and thereafter only asks questions, listens to events and sends cues. AIRI never
directly reads or writes a mount. Everything visible inside the box is the driver's.

### 8.2 Where a mount is

A mount sits on a **surface**: a slot AIRI knows in advance, such as the standalone actor window, the
chat window, the settings preview or the rehearsal room. A **purpose** states what that slot is for,
so two actor surfaces can exist — one acting, one previewing — without the two concepts collapsing
into one list of every combination.

AIRI names a surface and a purpose. It never names a mount. A mount's own identity is the driver's
handle, created before the mount and used inside the driver.

### 8.3 What the host assigns

The host tells a mount, as props: its surface and purpose, whether it is paused, whether it is
visible, the accessibility preference for reduced motion, and a quality hint when the host is
struggling to keep up.

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
decision wrong.

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
request from anywhere else names a surface and a purpose, and the driver resolves it.

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

No envelope names a mount. A caller that wants two surfaces to do the same thing sends one envelope
for each, and does not have to know how many mounts exist behind either.

### 9.3 Acknowledgement

An acknowledgement carries the correlation value it answers, the driver that answered, one outcome
per cue, and a convenience derived from them.

Atomicity is per mount. An envelope that one mount applied and another refused is still one answer:
whether that counts as a success is the driver's decision, and a driver that finds such a partial
failure acceptable reports the envelope as handled.

The cue that could not be applied carries the reason; the others are left blank. A driver MAY attach
debug messages to the non-offending ones.

The acknowledgement is settled when the outcome is decided, not when the renderer accepts the
request. A load therefore settles once the mount reports the model loaded, not at the first frame,
which keeps "the loading indicator may go away" as a separate and earlier fact.

### 9.4 Refusal and failure

A refusal means the cue was considered and not applied: not supported, unknown key, renderer not
ready, no model loaded, suppressed by policy, made moot by a newer transaction, or busy. Each is a
successful transaction with an unapplied outcome, never an exception and never a transport failure.

A failure means the operation was attempted and broke: the asset is missing or corrupt, the input
could not be read at all, the driver is unavailable, a required service was never provided, the
identity conflicts, encoding failed, the deadline passed, the work was abandoned, or an unexpected
internal error occurred. A failure is reported once, as the result of the call, and the same fact
reaches everyone else as a readiness state and an error event.

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
- **reset** — hand one thing back to the renderer's saved state: an expression, a motion, a profile,
  a gaze override, the camera, the model's transform, a caption, or all of them.
- **capture** — encode what this mount currently shows (§9.6).

A driver declares the cue kinds it accepts beyond loading, and may refuse the rest.

### 9.6 Delivery guarantees

Delivery is ordered per addressed driver and does not wait for completion: two envelopes for one
driver may be in flight together, and the driver chooses how to handle them.

A correlation value is created by the broker for the whole application, so two windows cannot mint
the same one; a renderer compares values only against other transactions on its own mount, where an
older one is stale.

A caller may ask that a transaction be dropped rather than delivered when the target is not ready.
Dropping is a choice and not a failure: it resolves successfully with an unapplied outcome in every
slot. A caller may also give a deadline, after which the send ends as a timeout rather than waiting
forever.

When a window goes away its mounts leave the registry and every pending transaction for them ends as
abandoned; a caller is never left waiting on a renderer that no longer exists.

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
namespace. The driver manages everything below the namespace level.

A manager reaches storage by asking the host for an adapter. The host may run the driver's
non-rendering code in a window of its choosing. If the host cannot provide an adapter, the driver reports the failure; AIRI
supplies the interface and the driver handles its own cases.

The route is the same on every host, including a single-process one.

### 10.3 Pointer input

A renderer receives pointer input through the contract. Events are delivered per mount, subscribed
by mount identity, and only a live mount created by this host may subscribe. The host provides a
pointer position relative to the top-right corner of the container, if any.

The runtime MAY attach its own pointer event listeners, but pointer events that happen outside of
the renderer window can only be listened on the service.

### 10.4 Prompt

The prompt channel is the container's only push member.

The prompt is text, not structure. AIRI does not parse it and composes nothing into it.

A driver publishes a model's prompt and its ACT token list as one pair, versioned per model. The list is what AIRI extracts cues with. The driver guarantees the two are in sync and owns the version's monotonicity.
AIRI compares them and surfaces a mismatch to the user: a list older than the prompt is a fault.

AIRI keeps the last publication per driver and model, and writes the prompt into a character card
only while that model is the one the character uses.

The prompt SHOULD stay stable for the length of a conversation. It may change while the user is
experimenting with prompting or ACT tokens, and a change takes effect only when both halves are
published.

### 10.5 Theme, messaging, localization and runtime facts

Theme is the one setting whose ownership runs host to renderer: accent hue and light or dark is a
host-wide appearance decision, so it cannot move into driver storage without every driver inventing
its own idea of the current theme. A driver re-tints when notified and never writes it.

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

The host provides the frame and the panel fills the body. A panel is told which model it edits, which
profile is shown, which mount it is paired with when there is one, which surface and which host
chrome it is rendered into, the readiness of its mount, and whether it is read-only. It is also told
the same service container the runtime received, so a panel edits driver storage directly instead of
asking the host to hold a draft.

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

Lip sync used to be a driver concern: the host handed the renderer an audio node and the renderer
sampled it. That is impossible once the audio device and the avatar live in different windows, and it
was never possible across processes.

The replacement is a host-level analyzer. The host owns the audio graph and publishes low-rate frames
carrying a timestamp, an amplitude, and optionally mouth openness or a detected viseme. The stream is
observer-style: latest-wins, no acknowledgement, never a cue.

AIRI provides a default analyzer. A driver that measures differently provides its own; the
declaration does not name it, and the manager knows where it is. A driver that wants lip sync
subscribes to the frames and maps them onto its own rig. It never receives an audio context or an
audio node, and the contract carries no mouth scalar. The distinction between "this analyzer has no
mouth concept" and "the mouth is closed" must be preserved, because they lead to different rendering.

## 13. Migration of pre-contract data

### 13.1 Settings AIRI already holds

A driver that replaces an in-tree renderer inherits settings AIRI has stored for years under its own
key names. They are AIRI's data in AIRI's shape, have no home in driver storage, and are
unrecoverable once the legacy code is deleted, so the contract carries exactly one channel for them.

The host offers the bag once per driver, after activation and before the first mount: the legacy
values by AIRI's own names, plus the model that was selected when the bag was written, because some
of those values are window-global and applied to whichever model happened to be on screen. Without
that identity a driver could only guess which model they described.

The driver absorbs what it recognises and reports the rest. The host deletes only the entries a
driver did not report as unused, and then writes a marker. A crash between the driver's write and the
marker re-offers the same bag, so absorbing it must be idempotent.

The bag is not a schema. Its keys are AIRI's history and disappear with the migration code that
writes them; a driver must not store them and the host must not interpret what the driver did with
them. A driver that never existed outside this contract answers that it has nothing to inherit, and
the host drops the bag instead of keeping it forever.

### 13.2 Models and presets

Legacy models, presets and model-bearing character cards are imported inside the transaction that
reads them. The user confirms the models, the adapter mints identities, the import commits, and only
then does the card or the migration record point at them. Writing a card first and importing
afterwards is forbidden: a crash in between leaves a reference nothing can serve.

A preset is a builtin (§5.4), so it is imported rather than special-cased, and the imported copy is
thereafter an ordinary model. A legacy preview that is an address rather than an image is fetched
during migration and stored, or skipped with a warning — never stored as if the address were the
image.

Legacy deletions are recorded rather than performed silently. A deleted key or asset that is not
remembered will come back from an old backup, a second device, or a cloud restore; the contract
therefore requires deletion to leave a durable marker that export, restore and remote reconciliation
all respect.

## 14. Unresolved aspects and recommended resolutions

The following are not settled. Each states the gap and the resolution recommended for the next
revision; until one is adopted, the implementing side takes the recommended path and records it in
code.

**Custom motion and animation assets in sync.** Per-asset sync would move a motion library without
its model; model-level bundles are simpler but coarser. *Recommended:* ship model-level bundles now
and treat per-asset sync as a later driver capability, because AIRI has no identity for an asset it
does not reference.

**Reading pre-contract backups.** A backup written before this contract has none of the identities
it now requires. *Recommended:* one legacy reader that imports fully during restore, writes deletion
markers for what it consumed, and is dropped after one release.

**Two model stores during the transition.** While formats migrate one at a time both stores hold
models. *Recommended:* a catalogue facade that reads the union and writes only to the new side, with
a per-driver switch, so the legacy store becomes read-only and needs no second migration.

**Panels that need no model.** A panel is told which model it edits, yet some driver settings are
global. *Recommended:* let a panel declare itself model-independent and receive no model identity,
instead of inventing a placeholder model.

**One driver, several windows, one storage.** Two windows may activate one driver and both may
mutate its models; the namespace is shared but nothing serialises writers. *Recommended:* have the
adapter serialise mutations per driver, and rely on the marker rules of §5.6 so a retry from either
window converges.

**Progress and cancellation of a long operation.** Nothing reports how far an import has got, and
nothing can abandon a load. *Recommended:* add a per-transaction observation stream carrying a
fraction and an optional stage, and express cancellation as a non-persistent reset aimed at the
transaction's correlation value, where a driver either honours it or settles the original request and
says it was too late.

**Returning data from a mount to host UI.** A driver that wants the user to choose something inside
its own canvas — a menu, a set of options, a confirmation — has no channel back. *Recommended:* one
generic host-answered request carrying an opaque payload and a correlation, rather than an event per
interaction.

**The remaining surface.** Scheduled performance, timeline position and continuous pose streams were
gaps in the previous revision and remain gaps. *Recommended:* keep them out until a consumer exists,
and prefer extending the cue vocabulary over adding a second streaming channel.

## Appendix A: Recommended order of events

### 1. Scanning for drivers

1. At startup, AIRI scans for driver declarations and registers them.
2. For each registered driver, AIRI creates its manager.

### 2. Mounting a component

A component is mounted

1. When AIRI needs to render or select a model, it tells the adapter what it wants — which driver,
   which surface and purpose, and the mount identity the wrapper minted beforehand — and the adapter
   resolves the corresponding entry point.
2. The interface mounts the returned component, then receives its services as props.
3. Driver UI is mounted the same way, from its own entrypoint.

An adapter hands out three things on request: an entry point for the purpose it was asked for,
containing code to run and/or a component to mount; a channel to the driver's manager; the service
container. The last two require authenticating with the manager, and the registry grants a runtime
access to resources only after that succeeds. The authentication between runtimes and managers is the
driver's implementation.
