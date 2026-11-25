/**
 * The provider a model driver implements for the models AIRI references.
 *
 * The host obtains the single instance from `ModelDriverRuntime.provider` (`lifecycle.ts`) and
 * holds it for as long as the driver is active. The provider is about *models*, because that is
 * the only thing AIRI ever asks it for.
 *
 * Two rules:
 *
 * 1. **AIRI imports models, never parts.** A model file and the textures it references arrive
 *    together in `ModelProbeInput.files`; AIRI does not label one of them the main file or mint
 *    an id for another, because a half-model is not something AIRI may ever hold. The driver
 *    decides which files belong to which model and reports the models as `parts`.
 * 2. **AIRI only knows about models.** A model has the Adapter-minted `modelId` it was imported
 *    under; AIRI enumerates it, stores its metadata and points at it by that id. Everything else
 *    inside the renderer — motions, presets, textures replaced after import, and every other
 *    asset — has no id from AIRI and therefore cannot be enumerated by AIRI: it either stays
 *    entirely inside the renderer's storage or travels in the opaque `meta` bag, which AIRI
 *    persists verbatim and never interprets. Those assets are imported through the driver's own
 *    panel or bridge, never through `probe`/`confirmImport`.
 */
import type { CapabilityVocabulary, ModelCapabilityDescriptor } from './capabilities'
import type { ModelId, ModelProfileId } from './model'
import type {
  ContractResult,
  MaybePromise,
  ModelAuthor,
  ModelDriverId,
  ModelPreview,
} from './shared'

export interface ModelProvider {
  /**
   * The driver's stable identity, and the key its catalogue rows carry.
   *
   * Deliberately not a display name: the human-readable one is `ModelDriverManifest.name`,
   * which the host already has from registration. It stays on the provider rather than being
   * inferred from the runtime that returned it, because the host may hand this reference to a
   * part that holds no runtime (an importer, a settings surface, a background sync), and
   * `ModelQuery.modelDriverId` exists so one query object can be given to every provider at once.
   */
  readonly modelDriverId: ModelDriverId

  /**
   * Report how well this renderer can host an incoming input, and hand back the callback that
   * imports it.
   *
   * A renderer MUST NOT refuse a probe-and-import, even when it believes the import is not
   * supported: declining unified import altogether is expressed by omitting `probe`
   * (`ModelDriverCapabilities.probe`), and a renderer that cannot read one particular input
   * answers with a low `confidence` and `blockingFindings` instead.
   */
  probe?: (input: ModelProbeInput) => MaybePromise<ContractResult<ModelProbeResult>>

  /**
   * Enumerate this renderer's own model metadata.
   *
   * The whole catalogue, including rows AIRI holds no reference for: a `ModelDescriptor` without
   * a `modelId` is still enumerated here — it simply cannot be addressed by anything else.
   */
  list: (query?: ModelQuery) => MaybePromise<ContractResult<ModelDescriptor[]>>

  /**
   * Drop one model, and everything the renderer keeps for it.
   *
   * **Idempotent success**: removing a model that is already gone is `ok: true`, not
   * `asset-missing` — there is nothing left to remove, which is the outcome the caller asked for.
   *
   * **The reference gate runs before this call.** A character that still binds the model is the
   * host's fact, not the driver's, so the host refuses first with `MODEL_REFERENCED` and the
   * evidence in `ContractFailure.references` (C11). A driver never has to know a card exists.
   *
   * "Everything" includes the model's profiles: a profile *body* does not outlive its model, so a
   * profile that has to survive the model is one AIRI keeps a record for
   * (`HostModelProfileRecord`) and that `saveProfile` can write again.
   */
  remove: (modelId: ModelId) => MaybePromise<ContractResult<void>>

  /**
   * Generate or refresh a thumbnail.
   *
   * The result is in the shape AIRI stores (`ModelPreview`, `shared.ts`). A descriptor may
   * already carry a preview of its own (`ModelDescriptor.preview`); this member is how one is
   * produced for a model that has none yet, or refreshed.
   *
   * `null` means this model has no thumbnail to give, which is a value rather than a failure.
   * `profileId` asks for the thumbnail of one profile instead of the model.
   */
  preview?: (modelId: ModelId, profileId?: ModelProfileId) => MaybePromise<ContractResult<ModelPreview | null>>

  /**
   * Enumerate what one model can do under the resources available right now.
   *
   * Requires `ModelDriverCapabilities.capabilityDiscovery` to be anything but `'none'`. This is
   * the *only* way capabilities are enumerated, including the `capabilityDiscovery: 'runtime'`
   * case: the provider belongs to the same plugin as any mounted instance, so it can read its own
   * live state. There is deliberately no second query on the stage component — capabilities are a
   * renderer concept, not something mounting a viewport needs.
   *
   * This is `ModelDriverRuntime.rendererCapabilities()`' question at model level, and for the same
   * reason: what a model can do is not fixed by its files, because the renderer may have to
   * withhold a texture-heavy outfit, a motion that needs more memory than is left, or a parameter
   * set this device cannot drive. It probes the live model rather than replaying a stored catalogue.
   *
   * Named `modelCapabilities` and not `capabilities` so it cannot be confused with
   * `rendererCapabilities` elsewhere: that one says what the *renderer* supports, this one lists
   * what one *model* contains.
   */
  modelCapabilities?: (modelId: ModelId) => MaybePromise<ContractResult<ModelCapabilityDescriptor[]>>

  /**
   * Enumerate the ACT tokens this model accepts right now.
   *
   * The card editor and the rehearsal room need the token list to offer choices and to check what a
   * card has already mapped; only the driver knows it, and only at runtime (`capabilities.ts`).
   *
   * A live answer, not a stored projection: AIRI keeps no copy, and a driver that has not loaded the
   * model yet may answer with an empty `items` rather than failing. It is **not** the token list a
   * prompt publication carries — that one is bound to one text by one version
   * (`ModelPromptPublication`, `host-services.ts`).
   */
  vocabulary?: (modelId: ModelId) => MaybePromise<ContractResult<CapabilityVocabulary>>

  /**
   * Enumerate the profiles this renderer holds for one model, including the answer "none".
   *
   * This is where "outfits" live under this contract — a named configuration the renderer stores
   * and knows how to compose. The host needs the list to render a quick switch, and there is no
   * `kind` to tell a profile row from a model row apart: two catalogues, `list` and
   * `listProfiles`, are what replaces the classification string AIRI no longer carries.
   *
   * An unknown or emptied model is therefore `ok: true` with no rows rather than `asset-missing`:
   * "this renderer holds nothing for it" is the answer being asked for, and the empty list is what
   * makes the orphan visible. `ok: false` means the question could not be answered at all, and the
   * host MUST NOT read it as "no profiles".
   *
   * Declared as `ModelDriverCapabilities.profiles`, which covers `listProfiles`, `saveProfile`
   * and `removeProfile` as one set: a renderer that declares it implements all three, and one
   * that does not is never asked.
   */
  listProfiles?: (modelId: ModelId) => MaybePromise<ContractResult<ModelProfileDescriptor[]>>

  /**
   * Store the renderer's current state as this profile.
   *
   * `profileId` is minted by AIRI, exactly as on the import path (`ModelImportSelection.profileId`):
   * the renderer never invents an AIRI-facing id.
   *
   * A **registered** driver is enough; no mount is required. When nothing is mounted the driver
   * saves the state it last persisted, so the call also works during migration before the first
   * mount. A driver that needs a live model to answer still has to settle the call rather than
   * leave it pending.
   */
  saveProfile?: (modelId: ModelId, profileId: ModelProfileId, options: ModelProfileSaveOptions) => MaybePromise<ContractResult<ModelProfileDescriptor>>

  /**
   * Drop one profile.
   *
   * **Idempotent success** like `remove`: a profile that is already gone is `ok: true`.
   *
   * Gated by the host before the call, exactly like `remove`: a character still bound to the profile
   * is refused with `PROFILE_REFERENCED` and evidence (C11).
   */
  removeProfile?: (modelId: ModelId, profileId: ModelProfileId) => MaybePromise<ContractResult<void>>

  /**
   * Opaque bundle for backup/restore of one model.
   *
   * The bundle carries the descriptor it was exported with, so `modelId` — the identity AIRI
   * minted before the original import — is what makes a restore land on the same asset instead of
   * minting a new one. The host routes a bundle by its descriptor's `modelDriverId`, so one
   * restored from another device reaches the renderer that can actually read it.
   *
   * This one *does* fail when the model is gone (`asset-missing`): the caller asked for something
   * present and it is not there — the opposite of the idempotent removals above.
   */
  export?: (modelId: ModelId) => MaybePromise<ContractResult<ModelTransferBundle>>
  import?: (bundle: ModelTransferBundle) => MaybePromise<ContractResult<ModelDescriptor>>
}

export interface ModelProbeInput {
  /**
   * Every file of the input, in one set: a single model is `files.length === 1`, and a model plus
   * the textures it references is the same set.
   *
   * AIRI deliberately has no separate `file` or companion field. Splitting the input would make
   * AIRI decide which file is the model and which is an attachment — a driver-native distinction
   * AIRI cannot make. It has to reach `probe`, not only `confirmImport`: `probe` is the only place
   * the input is ever handed over. The input carries **no ids**: `probe` is a read-only
   * inspection, and the Adapter mints the ids only after the user has chosen which parts to import.
   */
  files: File[]
  /** Names aligned with `files`, when the payload came from a directory pick. */
  fileNames?: string[]
  /**
   * A remote input, for a model that is not on disk yet.
   *
   * Mutually exclusive with `files`: a probe reads one input, and mixing a download with a picked
   * directory would make `parts` describe two unrelated packages.
   */
  url?: string
}

/**
 * The same input, as `confirmImport` receives it.
 *
 * The commit gets the input itself and not only the part indices, because a driver that must **move**
 * rather than copy (D-16) has to consume the payload the probe read. An absent input is legal and
 * means "no bytes this time": a retry after a crash, a restore, or a migration whose payload the
 * driver already retained by reference all commit without re-reading anything.
 */
export type ModelImportInput = ModelProbeInput

/** Display metadata for one model inside an import package. */
export interface ModelImportPartMeta {
  /** Driver-native format hint, for display only. */
  format: string
  /** Optional lightweight preview data URL (already encoded); never raw model bytes. */
  previewDataUrl?: string
  /** A name AIRI may pre-fill for the part's default profile. */
  suggestedProfileName?: string
  sizeBytes?: number
}

/** One model the probe found inside the input. */
export interface ModelImportPart {
  /** Stable within this probe result; `confirmImport` uses it to address the part. */
  partIndex: number
  name: string
  meta: ModelImportPartMeta
}

/** One model the user chose to import, with the ids the Adapter minted for it. */
export interface ModelImportSelection {
  partIndex: number
  /**
   * Adapter-minted model id. The renderer MUST persist the asset under exactly this value and MUST
   * NOT invent or rewrite an AIRI-facing id.
   */
  modelId: ModelId
  /**
   * Adapter-minted default profile id.
   *
   * Always supplied, so an imported model is addressable as `{ modelId, profileId }` from the moment
   * it exists — the same pair a `LoadCue`, a `ModelSelection` and a `CharacterModelBinding` carry. A
   * driver that cannot hold profiles ignores it; there is no import path that produces a model with
   * no profile, because that would be a model AIRI could not fully address.
   */
  profileId: ModelProfileId
  /** Override the part's display name. */
  name?: string
}

/** Where a migration-sourced import came from. */
export type ModelImportSource = 'legacy-display-model' | 'legacy-backup' | 'legacy-preset'

/**
 * Migration provenance.
 *
 * Purely informational: it tells a catalogue row where the model came from. It is **not** an
 * authorization to overwrite — migration's import *is* the create (D8), so there is nothing to
 * overwrite and no marker that could authorize it.
 */
export interface ModelImportMigration {
  source: ModelImportSource
  /** The legacy identity the model came from, for provenance display only. */
  sourceId: string
  /** A hash of the payload, so a retried import can be recognised as the same work. */
  payloadHash: string
}

export interface ModelConfirmOptions {
  /**
   * The models to import, in one transaction.
   *
   * An array even for one part, so a multi-model package is the same call as a single-file import
   * rather than a second shape: the caller selects, mints ids, and passes them together. The driver
   * MUST import exactly these parts — no more, no fewer — and MUST write them atomically, so a
   * failure leaves none of them behind.
   */
  selections: ModelImportSelection[]
  /**
   * The input the probe read, when the driver still needs its bytes.
   *
   * Present for an ordinary import; absent for a migration that retained its payload by reference, a
   * retry after a crash, or a restore. Receiving the input here — and not a file per selection — is
   * what lets a driver **move** the bytes instead of copying them (D-16, D17).
   */
  input?: ModelImportInput
  /**
   * Import despite `blockingFindings`.
   *
   * The host sets this only after the user explicitly accepts the findings; a low `confidence`
   * never requires it, because confidence is not a verdict on whether the input may be imported.
   */
  force?: boolean
  /**
   * Replace an existing `(modelDriverId, modelId)`.
   *
   * **The user's "replace this model" action only.** A normal import MUST NOT set this, and no
   * migration path ever does (D18): migration's import is the create, so a duplicate id there is a
   * `MODEL_ID_CONFLICT` to resolve with the user — reassign, skip, or explicitly replace — never a
   * silent overwrite.
   */
  overwrite?: boolean
  /** Clear the stored profiles when overwriting. Default `false`: keep the user's profiles. */
  resetProfiles?: boolean
  /** Migration-only provenance; absent for user-initiated imports. Never authorization. */
  migration?: ModelImportMigration
}

/**
 * One selection's own outcome, inside a commit.
 *
 * **Per-entry settlement** (C21): one part failing does not fail the commit and does not roll back
 * the others, so a package with one bad model still yields the good ones. The driver MUST settle every
 * selection it was given, in the order it was given them.
 */
export interface ModelImportCommitEntry {
  /** The selection this entry answers, echoed exactly. */
  selection: ModelImportSelection
  /** This entry's outcome: the stored descriptor, or why this one part could not be committed. */
  result: ContractResult<ModelDescriptor>
}

/** What a commit did, one entry per selection. */
export interface ModelImportCommit {
  entries: ModelImportCommitEntry[]
}

export interface ModelProbeResult {
  /** 0..1: how well this renderer can host the input. */
  confidence: number
  /** Suggested package display name, usually derived from the file name. */
  name?: string
  /** Non-fatal findings worth showing before the user commits. */
  warnings?: string[]
  /** Repairs the renderer would apply on import, described for the user. */
  plannedFixes?: string[]
  /** Why this renderer cannot read the input as-is. */
  blockingFindings?: string[]
  /**
   * Every model this input expands to.
   *
   * A single-model package has exactly one part. `probe` writes nothing: the parts are a
   * description, and the host only commits the ones the user selects. This is also the
   * multi-model id boundary — the driver reports names and metadata, the Adapter mints ids.
   */
  parts: ModelImportPart[]
  /**
   * Import the selected parts under the ids the Adapter minted.
   *
   * Answers **one entry per selection**, in the order given, each with its own outcome (C21): a part
   * that cannot be committed is reported there and leaves the rest committed, and the whole call fails
   * only when the transaction itself could not run. A driver MUST NOT return an entry for a part the
   * caller did not select, and MUST NOT mint or rewrite an id — the Adapter guarantees uniqueness, and
   * a second identity for one asset is an asset AIRI can never address again.
   *
   * The descriptors a successful entry carries echo the exact `modelId` and `profileId` they were
   * given.
   */
  confirmImport: (options: ModelConfirmOptions) => MaybePromise<ContractResult<ModelImportCommit>>
}

/**
 * What the host asks a provider to enumerate.
 *
 * `modelDriverId` is part of the query because the host may hand one query object to every
 * enabled driver and merge the answers: a provider replies only when the id is its own, and stays
 * silent otherwise. A merged list can be filtered the same way without asking anyone, since every
 * `ModelDescriptor` carries its `modelDriverId` too.
 */
export interface ModelQuery {
  modelDriverId?: ModelDriverId
  nameContains?: string
  limit?: number
  offset?: number
}

/**
 * What a renderer should return when enumerating the models it has.
 *
 * `meta` is opaque on purpose: AIRI persists it verbatim and MUST NOT validate it, because the
 * renderer that wrote it may be newer than AIRI.
 */
export interface ModelDescriptor {
  /** The driver that owns this model. */
  modelDriverId: ModelDriverId
  /**
   * The identity the Adapter minted before this asset was imported (`ModelImportSelection.modelId`).
   *
   * The whole identity of a model, and the only key AIRI ever holds.
   *
   * Optional, and its absence is what makes a model `builtin`: the driver ships it and can enumerate
   * and load it, while AIRI can neither list it nor reference it. Importing it
   * (`probe` → `confirmImport`) gives it an id, and from then on the row is `imported`.
   */
  modelId?: ModelId
  /**
   * A suggested name that can be overridden by AIRI, or fallback to when AIRI does not know the
   * model.
   */
  name: string
  importedAt: number
  /**
   * Who made it, when the driver knows.
   *
   * Travels with the model rather than in a driver-side settings blob, so AIRI can show attribution
   * with the driver uninstalled. `shared.ts` explains the shape's ownership.
   */
  author?: ModelAuthor
  /**
   * Advisory; the renderer computes it, the host only displays it.
   * The value CAN be an estimate.
   */
  byteSize?: number
  /**
   * The model's thumbnail, in the shape AIRI stores (`ModelPreview`).
   *
   * A descriptor is allowed to carry one, because a catalogue row is exactly where a thumbnail is
   * wanted and a renderer that already has it should not be asked again per model. What AIRI does
   * with it is store it (`HostAnnotationFields.preview`, stamping `updatedAt`) rather than render
   * it directly, so the catalogue keeps working with no renderer at all.
   *
   * Absent is not an error: `preview()` is then how that stored copy is produced or refreshed, and
   * both sources deliver the same value in the same shape.
   */
  preview?: ModelPreview
  /**
   * Metadata opaque to AIRI. AIRI MUST NOT interpret it, and SHOULD present it as-is.
   *
   * Deliberately where renderer-specific extras belong: this record carries no profile list, because
   * `listProfiles` is the one authority for that and a second one here would drift from it.
   */
  meta?: unknown
}

/**
 * A profile, as the renderer describes it.
 *
 * The label is only a suggestion: AIRI keeps its own `displayName` for the profile
 * (`HostModelProfileRecord`), so a rename never has to go back to the renderer and the catalog
 * does not depend on a renderer being loaded to be readable.
 */
export interface ModelProfileDescriptor {
  profileId: ModelProfileId
  /**
   * A suggested name that can be overridden by AIRI, or fallback to when AIRI does not know the
   * profile.
   *
   * Follow the same i18n rule as `ModelDriverPanelDeclaration.label`.
   */
  name: string
  /** Renderer-owned extras (the composition rules' inputs). Opaque to AIRI. */
  meta?: unknown
}

export enum ModelProfileSaveMode {
  /** Create it, or replace an existing profile's content with the current state. */
  UPSERT = 'upsert',
  /** Create it only when absent; an existing profile is returned untouched. */
  CREATE_IF_NOT_EXISTS = 'create-if-not-exists',
}

export interface ModelProfileSaveOptions {
  /**
   * Required, and there is deliberately no default: `upsert` overwrites state the user may have
   * spent time on, so the caller has to say which one it means.
   */
  mode: ModelProfileSaveMode
  /**
   * Initial profile name, same meaning as `ModelProfileDescriptor.name`; ignored when the profile
   * already exists.
   */
  name?: string
}

/**
 * A model packaged for off-device storage.
 *
 * AIRI promises cross-device continuity and a renderer may have no cloud access of its own, so the
 * host moves the payload without understanding it. `descriptor.modelId` is what lets the restored
 * copy land on the same identity the original import minted — and a bundle always carries one,
 * because it was produced by `export(modelId)` for a model AIRI references.
 */
export interface ModelTransferBundle {
  descriptor: ModelDescriptor
  payload: Blob
}
