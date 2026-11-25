# Phase 0 decisions — contract `0.1`

This is the decision record for **Phase 0** of [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md):
the choices the contract itself had to make while closing C1–C23, and the choices made *about* how the
phase was executed. The plan's §2 records host choices (D1–D18); this file records what the contract
and its files became, so a later reader can tell a deliberate shape from an accident.

Read together with:

- [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) §3 (the gap list this closes) and §2 (host
  decisions D1–D18);
- [`docs/rfcs/0002-model-driver-contract.md`](../../docs/rfcs/0002-model-driver-contract.md) and its
  Phase 0 amendment section;
- `src/contract/*.ts` — every decision below is visible as a comment at the shape it produced.

Each entry has the same form: **decision**, **why**, **what it rules out**. Entries are numbered
`P0-D*` so they cannot be confused with the plan's `D*` or with the driver obligations `D-*`.

---

## Sequence and scope

### P0-D1 — P0.0's separate baseline commit is waived; the RFC amendment shares the Phase 0 commit

P0.0 asked for the `0.0.3` working tree to be pinned as its own commit *before* Phase 0 began, and §3.2
asked for the RFC amendment to be Phase 0's **last** commit. Neither happened: this workspace forbids an
agent from committing proactively, so Phase 0 was implemented on top of the uncommitted tree and the
whole thing landed as one change by the user (`phase 0 throwaway`, plus `manifest fix and lockfile`, on
branch `model-driver-throwaway`), amendment included.

**Why waive rather than reconstruct:** reopening the baseline now means rewriting a commit that already
exists on the branch, for no diagnostic gain. What P0.0 bought was "the reshuffle is a reviewable named
unit, not a working-tree diff" — a single commit containing the reshuffle plus the Phase 0 changes still
gives that. What is genuinely lost is the ability to diff *the baseline the plan was approved against*
from *what Phase 0 changed*; from here, "what Phase 0 changed" has to be read out of this file and the
C-table rather than out of `git diff`.

**Consequence:** exit criterion 6's "the RFC amendment commit is open" is satisfied as
content-in-a-commit, not as its own commit. §0, the plan header and this entry are the record; there is
no baseline tag to point at.

### P0-D2 — Four new files rather than three growing ones

`registry.ts`, `migration.ts`, `validate.ts` and `compatibility.ts` are new modules. The alternatives
were to grow `lifecycle.ts` (manager + registry handle + mounts), `components.ts` (driver-level shapes +
pre-contract payloads) and `shared.ts` (vocabularies + validators).

**Why:** each new file has exactly one reader in mind. `registry.ts` is "what the host gives a manager
and what an adapter may ask the registry" — the seam C22 added. `migration.ts` is one model in and the
same model out — C13 and C23, which are one mechanism read in two directions. `validate.ts` and
`compatibility.ts` are the two things a boundary needs before it trusts data. `lifecycle.ts` and
`components.ts` keep their existing jobs and got no wider.

**Rules out:** a future reader finding `RegistryHandle` next to `ModelDriverRuntime` and assuming a
manager can call a runtime member directly.

### P0-D3 — The declaration names the manager, and `null` is a legal entry answer

`ModelDriverEntryPoints` is now `{ manager: string }`. `provider`, `mount`, `modelPicker` and `panels`
are gone; `ModelDriverManager.resolveEntrypoint` answers
`ContractResult<{ specifier: string } | null>` for a `ModelDriverEntryKind`.

**Why:** RFC §6.1 says the manager is the only declared entry point and knows where the rest of its
code lives. Making that literal is what lets `validateManifest` **refuse** a declaration that still
names renderer modules — the exact shape that would let a DOM-free process pull Vue into main.

`null` rather than an absent member is deliberate: "this driver ships no picker" is an answer, and an
absent optional specifier would invite the host to substitute a default list built from the catalogue,
which only the driver can populate (RFC §7.1).

**Rules out:** a driver shipping two mounts (one per surface) as two manifest fields — it answers per
`{ surface, purpose }` instead.

### P0-D4 — Mount creation moved off the mount registry

`ModelDriverMountRegistry.register` and the `RendererMountRegistration` type are deleted. A mount is
created by `HostRegistryClient.registerMount({ driverId, surface, purpose, windowId })`, which answers
the registry-issued `mountId`; `ModelDriverMountRegistry` keeps `update` / `unregister` / `list` /
`findBy` / `onChanged`.

**Why:** C22 and D1 make the registry the id authority. Keeping a `register(descriptor)` that accepted
a caller-supplied `mountId` next to it would have left a second way to create a mount, and the
"renderer cannot construct a mount id" guarantee would have been a convention rather than a type.

**Rules out:** an adapter registering a mount before it has an id, or a renderer re-registering itself
with a fresh id.

---

## Cues and settlement

### P0-D5 — The envelope dropped `mountId`; the ack kept it

`CueEnvelope.target` is `{ modelDriverId, surface?, purpose? }` and is **required**. `CueAck.mountId`
survives as the one remaining mount identity on the cue path.

**Why:** addressing and attribution are different questions. C2 removes mount addressing because the
manager fans out to every matching mount and a caller must not assume which viewport answered (§9.2).
But the broker still crosses a process boundary and has to reject an ack attributed to a window that
does not own the mount, and it can only do that if the ack names the mount. The field is documented as
*not an address* so nobody starts routing by it.

**Rules out:** a cue addressed to one specific mount. That is now expressible only through
surface+purpose narrowing or through `queryMount`/`commandMount`.

### P0-D6 — Acceptance is a receipt, not an ack

`CueChannel.send` resolves to `ContractResult<CueTransactionReceipt>` where the receipt is
`{ nonce, settled: Promise<ContractResult<CueAck>> }`. `CueAck.requestId` is deleted.

**Why:** §9.3 splits the two facts. The broker can name a transaction the moment it accepts one, and
the outcome is decided later (a load settles at `model-loaded`, not at the first frame). Returning the
ack directly conflated them and forced every caller to wait for work it did not need to wait for.

**Rules out:** correlating by anything other than the nonce. `requestId` was a second correlation value
for the same thing; two values can disagree.

### P0-D7 — Six withdrawal requests, one request type, two bounds

`CueWithdrawalKind` is the six RFC values. `CueWithdrawalRequest` names **either** `nonces` **or**
`address`, exactly one, plus one `modelDriverId`. `CUE_WITHDRAWAL_LIMITS` =
`{ maxNoncesPerRequest: 64, maxReportEntries: 256 }`.

`pop` and `pop-all` are **required** to use `address`: they select "the receiver's newest / every
not-started transaction", and a correlation list would ask a different question ("the newest of these")
whose answer nobody means.

**Why:** RFC §9.7's "one target family, one driver" is the whole rule, and it is cheap to check at the
edge. The bounds are constants in the contract rather than host policy so a test can assert the numbers
and a driver can read them.

**Rules out:** a request that names correlations across two drivers, and an unbounded report.

### P0-D8 — The readiness table is data, and a redundant report is legal

`READINESS_TRANSITIONS` is a frozen record from state to legal successors; `isReady` is true for
`ready-for-model` and `model-loaded` only; `isReadinessTransitionAllowed` treats `from === to` as legal.

**Why:** C9 asks for the transitions to be walkable and an undeclared one to be rejectable. Self
transitions are allowed because a mount may re-emit its state idempotently and a re-emit says nothing
new — treating it as an error would make every mount defensive for no gain.

`model-loaded → loading-model` is declared because "the mount survives a model change" (§5.2): a swap
must not flash an empty stage by routing through `ready-for-model`.

**Rules out:** a mount reporting `model-loaded` after a failed load by going through `ready-for-model`
first, and `mount-error → model-error` (the recovery differs).

### P0-D9 — A prompt is a pair, and "not published" is a state

`ModelPromptPublication` is one value carrying `text`, `tokens`, one `version` and `publishedAt`, keyed
by **driver + model + profile**. `ModelPromptSnapshot` is the same value without the driver id — the
shape a card stores. `ModelDriverCapabilities.prompt` declares that the driver publishes one.

`evaluatePromptPublicationState` separates the four states: `none` (not prompt-capable), `published`
(including `('', [])`), `missing` (prompt-capable, nothing published — a fault), `stale` (an incoming
publication is not strictly newer).

**Why:** D5 requires the two halves to travel together and requires a missing publication to be
distinguishable from a deliberately empty one. Making "empty" and "absent" two states in one function
is the only way a panel can report the bug without also nagging every driver that legitimately has
nothing to say.

`isPromptPublicationNewer` compares **only** `version`. Comparing `publishedAt` would make a device
clock the arbiter, and two devices can disagree about the time without either being wrong. Equal
versions with different content are a *conflict* (Phase 2's arbitration), not a newer publication.

**Rules out:** a per-model prompt without a profile, and a host that tries to mint or increment the
version itself.

---

## Migration, revert and records

### P0-D10 — `migrate` and `restoreLegacy` both live on the runtime, under one capability

Both per-model operations are members of `ModelDriverRuntime`, and `ModelDriverCapabilities.migration`
covers both.

**Why:** the alternative was a new `legacyRestore` flag and/or moving them to the provider. Neither
buys anything: `migration` already means "this driver can bridge pre-contract data", and both methods
name a model the driver retained. Splitting the flag would let a driver claim one direction and fail
the other, which is exactly the half-working state D9 refuses.

**Rules out:** a driver advertised as migratable that cannot serve a revert.

### P0-D11 — `confirmImport` settles per entry and receives the input

`ModelConfirmOptions` gains `input?: ModelProbeInput`; `confirmImport` answers
`ContractResult<ModelImportCommit>` where the commit carries one
`ModelImportCommitEntry { selection, result }` per selection, in order.

**Why:** C21 asks for two things that only make sense together. Per-entry settlement means one bad part
of a package does not lose the good ones. The input is what makes **move-import** possible: the driver
must consume the bytes the probe read rather than copy them, and it cannot do that if it only receives
part indices (D-16, D17).

`input` is optional because three legitimate commits have no bytes: a retry after a crash, a restore,
and a migration whose payload the driver already retained by reference.

**Rules out:** reading `confirmImport`'s result as an array of descriptors, and any migration path
setting `overwrite`.

### P0-D12 — The reference gate is the host's, and it carries evidence

`ContractFailureCode` gains `model-referenced` and `profile-referenced`, and `ContractFailure` gains
`references: HostReferenceEvidence[]`. The gate runs **before** `remove` / `removeProfile` / `purge`.

**Why:** a driver cannot know a card binds a model, and should not have to. Putting the refusal in the
host — with the character id and name attached — makes the UI able to say *which* character stands in
the way, which is the user's next action. A driver that never learns about cards also never invents a
policy about them.

**Rules out:** a driver reporting "in use" with no way to name the user.

### P0-D13 — The binding → reason mapping has a fixed precedence, in the contract

`classifyBindingAvailability` maps `DriverStatus` + record presence + runtime failure onto
`UnavailableModelReason`, in this order: driver → runtime failure → model record → profile record.

**Why:** C16 keeps two vocabularies and asks for the mapping to be documented. Three views were going
to implement three orders, and the order decides *which* reason wins when a card has both a missing
model and a disabled driver. The outer explanation is the more actionable one, so the driver wins; and
`profile-missing` is last because it is only meaningful once the model resolved.

`profile-missing` is the one reason that is an **error** rather than a lost referent: losing a model is
normal, an internally inconsistent binding is not (§5.6 row 7).

**Rules out:** a view deriving a reason of its own.

### P0-D14 — `invalid-entrypoint` is a failure code C6 did not list

C6 enumerates the failure-code additions and `invalid-entrypoint` is not among them, but C15 requires
"an unknown specifier is `invalid-entrypoint` with a readable reason". It was added.

**Why:** C15 has no other way to report a manager naming a module the adapter cannot import, and
inventing a substitution is exactly what D2 forbids. The code is listed in the RFC amendment with the
revision it arrived in.

**Rules out:** an adapter falling back to a default entry.

---

## Vocabulary

### P0-D15 — `effect` replaced `vfx` for the capability kind and the cue, not for the ACT token family

`ModelCapabilityKind.EFFECT = 'effect'`, `CueKind.EFFECT = 'effect'`, `EffectCue`,
`ResetScope.EFFECT`. `ActTokenKind.VFX = 'vfx'` keeps its spelling.

**Why:** RFC §9.5 calls the cue `effect`, and a descriptor kind and the cue that addresses it must read
the same. But `ActTokenKind` is a family that appears *inside prompt text* (`ACT vfx(...)`), which is
character content written years ago; renaming it would invalidate every card that contains a token.
Two vocabularies that look alike, deliberately left different, with the reason recorded at both sites.

**Rules out:** a card token being silently repointed by a contract rename.

### P0-D16 — "Beyond load" is a type, not a sentence

`OptionalCueKind = Exclude<CueKind, CueKind.LOAD>`, and `ModelDriverCapabilities.cues` is
`OptionalCueKind[]`. `assertCapabilityCompleteness` rejects `load` as a runtime double-check.

**Why:** every mount must handle a load, so declaring it says nothing; a declaration that could list it
would describe a viewport that can never load anything. A union exclusion makes the wrong value
untypeable, which is stronger than the prose that already said so.

**Rules out:** a driver declaring `load` among optional kinds and a host believing it.

### P0-D17 — `CueTarget` is required and names one driver

`target` is not optional on `CueEnvelope`; `modelDriverId` is required inside it; `surface` and
`purpose` are optional AND-filters.

**Why:** §4.4's first action is "validate the envelope … a routable target", and a transaction with no
target has no correct destination. Making it optional would have produced a validation branch that
always rejects — a shape that invites code which forgets it.

**Rules out:** a broadcast transaction. Fan-out happens *inside* one driver, by the manager.

---

## Documents and execution

### P0-D18 — Validators are hand-written; the package stays dependency-free

`validate.ts` uses small local guards, not a schema library. The package's only dependencies are `vue`
(types) and `vitest` (dev).

**Why:** the contract is source-only and private, but a validation library would make every consumer —
and eventually a third-party driver's own toolchain — inherit the choice. The checks needed are shallow
and few, and they must produce **readable reasons**, which is a writing task more than a parsing one.

**Trade-off accepted:** the validators are hand-maintained alongside the interfaces. `validate.test.ts`
covers them, and `contract.test.ts` holds the exhaustive enums so adding a member forces a test update.

### P0-D19 — The data catalog documents keys no source writes yet

P0.5 asked for the model-driver keys (`prompt`, `prompt-archive`, markers) in `docs/data-catalog.md`,
and Phase 0 has no writer for them. `docs/data-catalog.md` §3.2.1 therefore states, in the first
paragraph, that **no source in this tree writes these keys yet** and that Phase 1 starts writing them.

**Why:** a catalog that quietly lists unimplemented keys teaches the next reader that the code exists;
a catalog that omits them loses the shape the contract just froze. Saying both is the only honest
option. The same edit corrects §3.2 and §8.5 against the actual `display-models.ts` source
(`DisplayModelCloud`, the shared annotation block, the `preset-*`/URL ids, the tombstone key).

### P0-D20 — The RFC amendment is written as its own section, not woven through

The amendment is one appended section of RFC 0002 listing the added symbols (`RegistryHandle`,
`registerMount`, `LegacyRestorePayload`, `PendingModelPayload`, `isContractCompatible`,
`profile-missing`, `invalid-entrypoint`), the per-model handover, the atomic publication pair, the
`ACTING` rename and the entry-point narrowing.

**Why:** the RFC is the normative source, and a diff spread over 800 lines makes it impossible to see
what Phase 0 added. One section can be reviewed as the amendment it is, and once applied the
Appendix C conformance map is true rather than aspirational (§3.2).

---

## Validation and closed-out items

| Check | Result |
| :--- | :--- |
| `tsc --noEmit` (package tsconfig, includes `src/**/*.test.ts`) | clean |
| `vitest run` over `src/**/*.test.ts` | 82 tests, 2 files, all passing |
| Zero app importers (`stage-renderer-sdk` outside the package) | unchanged — still nothing imports it |
| Lockfile importer for the package | present, with `vitest` (`4.0.18`) and `vue` resolved |
| Catalog parity, run manually because `scripts/audit-test-catalog.mjs` shells out through `pnpm exec` | 161 suites discovered by `vitest list`, 180 paths in `docs/project-testing-parity.md`, **both new suites documented**, 0 broken catalog paths |

What closed out after the fact, and how:

1. **Commits** (P0-D1): the user committed Phase 0 as one change plus a follow-up.
2. **`pnpm`** could not open its store database in the authoring session, so validation ran the
   underlying binaries directly (`node node_modules/typescript/bin/tsc`,
   `node node_modules/vitest/vitest.mjs run --root packages/stage-renderer-sdk`); the declared
   `test`/`typecheck` scripts are the same commands.
3. **A real defect this surfaced:** the package declared `"vitest": "catalog:"`, but `vitest` lives in
   the **named** catalog in `pnpm-workspace.yaml`, so the specifier has to be `catalog:vitest` — every
   other package in the workspace already did that, and this one was the only outlier. Fixed in
   `manifest fix and lockfile`, which also wrote the missing lockfile importer.
4. **`docs/project-testing-parity.md`** gains the two new suites. Running the catalog audit's two checks
   by hand shows **9 pre-existing undocumented suites** elsewhere in the monorepo (`image-journal`,
   `lighting`, two browser-mode settings suites, `use-autonomous-cues`, `model-capabilities`,
   `cache-utils`, `onboarding`, `card.schema`). They are unrelated to Phase 0 and were deliberately not
   papered over here: `node scripts/audit-test-catalog.mjs` will fail on them until they are documented,
   and that is a separate change.
