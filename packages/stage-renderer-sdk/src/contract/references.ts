/**
 * The records and views AIRI keeps about the models and profiles it references.
 *
 * Owner: AIRI. Renderers never see these types, except that they receive a `modelId` and a
 * `profileId` and treat both as opaque keys — and that the thumbnail they produce and the author
 * they report are the shared shapes in `shared.ts`.
 *
 * Nothing here is renderer-derived storage: no renderer reads or writes these fields, and none of
 * them mirrors a renderer's own layout. What lives here is what AIRI must still know with **no
 * driver installed, no window open and no model mounted** — the name the user gave a model, its
 * cached thumbnail, who made it, and which model a character points at.
 */
import type { ModelId, ModelProfileId } from './model'
import type { ModelAuthor, ModelDriverId, ModelPreview } from './shared'

/**
 * The user-facing annotation AIRI owns about anything it references.
 *
 * A named model and each of its profiles are both things AIRI names, lists, searches and lets
 * the user annotate, so they share one field vocabulary instead of growing two that drift.
 */
export interface HostAnnotationFields {
  displayName: string
  /**
   * The thumbnail AIRI stores and manages for this record.
   *
   * `updatedAt` is stamped here rather than taken from the renderer: AIRI is the side that
   * decides how fresh its own copy is.
   */
  preview?: ModelPreview & { updatedAt: number }
  /**
   * Who made the model, as its driver reported it (`ModelDescriptor.author`).
   *
   * Cached rather than referenced, for the same reason as `preview`: the catalog draws this row with
   * the driver unavailable, and attribution that disappears with a plugin is not attribution. A
   * legacy `authorIcon` asset URL is normalized into `author.icon` during migration — fetched into a
   * `ModelPreview`, or skipped with a warning, never stored as if the URL were the image.
   */
  author?: ModelAuthor
  /**
   * The user's own note.
   *
   * Free text AIRI stores and displays, and never interprets. It is not part of `searchKey`
   * below, which stays limited to the short fields the catalog filter matches on.
   */
  note?: string
  nsfw?: boolean
  groups?: string[]
  tags?: string[]
  /** Lowercased name+tags+groups, used by the catalog filter. */
  searchKey?: string
}

/**
 * AIRI's record about one **named model**: a model a character can reference.
 *
 * The only per-model metadata AIRI owns, and deliberately free of any renderer-specific field.
 * The renderer's own per-model state is its storage, which AIRI never sees; the renderer's asset
 * metadata lives inside its own provider.
 *
 * Deliberately no legacy id: after cutover the frozen `modules.displayModelId` on the cards is the
 * only place a legacy identity survives, and the driver keeps the provenance inside its retained
 * handover. Two copies of it would be two things to keep in sync, and one of them would go stale.
 */
export interface HostNamedModelRecord extends HostAnnotationFields {
  modelId: ModelId
  importedAt: number
  /** The driver that currently serves the asset, when bound. */
  modelDriverId?: ModelDriverId
  /**
   * Which driver the user (or a card) expects to serve this reference.
   *
   * Survives a driver being disabled, so the host can say "this card needs the Live2D driver"
   * instead of silently showing a different avatar.
   */
  modelDriverHint?: ModelDriverId
}

/**
 * AIRI's record about one model profile.
 *
 * The profile's *content* is the renderer's: written through `ModelProvider.saveProfile` and
 * applied through `ProfileCue`. What AIRI keeps is the same kind of name-and-annotation record
 * it keeps for a model, which is why both extend `HostAnnotationFields`.
 *
 * `profileId` is minted by AIRI's Adapter, exactly like `modelId`, so `(modelId, profileId)`
 * addresses a profile without either side inventing a name for the other's storage.
 */
export interface HostModelProfileRecord extends HostAnnotationFields {
  profileId: ModelProfileId
  /** The model this profile belongs to. */
  modelId: ModelId
  /** When AIRI first stored this profile. */
  createdAt: number
  /** The driver that currently serves it, when bound. */
  modelDriverId?: ModelDriverId
}

/**
 * Which model — and which profile of it — a character shows.
 *
 * Both ids were minted by the Adapter at import time and both are held by AIRI, so this record is a
 * reference*, not a copy of driver state: nothing here has to be refreshed when the driver changes
 * something, and nothing here can name a model AIRI cannot address.
 *
 * A character with no binding is the normal case for a character that has no model at all. That is a
 * state, not a failure, and it is not a fallback: there is nothing missing, so nothing is shown as
 * broken.
 */
export interface CharacterModelBinding {
  modelDriverId: ModelDriverId
  modelId: ModelId
  profileId: ModelProfileId
  /** Host clock, milliseconds, when AIRI stored this binding. */
  boundAt: number
}

/**
 * A model payload the user has not confirmed, kept so it can still be imported later.
 *
 * This is AIRI's record, not a model: it has **no `modelId` and no `profileId`**, which is what makes
 * "a reference to something neither side can serve" inexpressible — a `LoadCue` needs a `ModelId`, so
 * a pending payload cannot construct one (C12). AIRI still lists it, keeps it operable and lets the
 * user import it later.
 *
 * `legacyModelId` is a **label**, not an identity: it is the value the legacy record had, useful for
 * showing the user what this is and for resolving an old card reference, and it resolves to no
 * model (RFC §13.2).
 */
export interface PendingModelPayload {
  /** AIRI's own key for the retained bytes. */
  payloadId: string
  /** Which driver the user was importing with, when the payload predates the import. */
  modelDriverHint?: ModelDriverId
  /** Provenance for display only. Never an identity, never adopted as `modelId`. */
  legacyModelId?: string
  /** A name the user recognises; required, because an unnamed payload is unlistable. */
  displayName: string
  /** Host clock, milliseconds. */
  createdAt: number
  /** Size of the retained bytes, for the storage summary. */
  byteSize?: number
}

/**
 * One lightweight row of a driver's model list, as `ModelDriverManager.listModels()` returns it.
 *
 * Deliberately small: it crosses a process boundary per model per profile, so a preview is a small
 * encoded image or absent, never a blob, and nothing here is allowed to grow into "the model".
 *
 * **A row exists only for an imported model.** A builtin model has no AIRI ids, so it cannot be a
 * row; an unimported model is unknown to both sides. What AIRI does with these rows is cache them
 * for the catalog, a card's model chip, an import duplicate check and the unavailable-model view —
 * not use them as the picker's data source, which is the driver's own component.
 */
export interface ModelSummary {
  modelDriverId: ModelDriverId
  modelId: ModelId
  profileId: ModelProfileId
  /** The model's name, as its driver reports it. */
  name: string
  /** The profile's name, when the row is for a profile other than the default one. */
  profileName?: string
  /**
   * Small encoded thumbnail (a short data URL), or absent.
   *
   * Sized for a list row, not for a preview pane: the catalog's full thumbnail is the cached
   * `ModelPreview` on AIRI's own record.
   */
  preview?: string
  /** Who made it; cached with the row so attribution survives the driver being unavailable. */
  author?: ModelAuthor
  /** Advisory size, for a storage summary. May be an estimate. */
  byteSize?: number
  importedAt?: number
}

/**
 * Where a driver stands, as AIRI sees it.
 *
 * AIRI's answer, not the driver's: a driver cannot report its own absence, so this is assembled from
 * the manifest registry (does one exist), the enabled flag (may it run) and the last activation
 * (did it come up).
 */
export enum DriverStatus {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  /** A card references it, but no manifest is registered. */
  NOT_INSTALLED = 'not-installed',
  /** Registered and enabled, but activation failed. */
  ERROR = 'error',
}

/** One driver as a settings page or a fallback view needs it. */
export interface DriverInfo {
  driverId: ModelDriverId
  /** Display name from the manifest; the id when no manifest is registered. */
  name: string
  version?: string
  status: DriverStatus
  /**
   * Whether a `ModelDriverManager` is registered for it.
   *
   * Separate from `status` because "installed but its main-process half failed to load" and "not
   * installed at all" look the same from a card's point of view and need different advice.
   */
  hasManager: boolean
}

/**
 * Why a character's model cannot be shown right now.
 *
 * AIRI's own vocabulary, used by the unavailable-model view it renders (`UnavailableModelView` in
 * stage-ui, not part of this SDK). It exists here because the same reasons are produced by more than
 * one consumer — the stage, the character settings page, the card editor — and two vocabularies for
 * one failure would drift.
 *
 * None of these change a model's `ModelState`: an imported model whose driver is temporarily missing
 * is still imported, and comes back unchanged when the driver does.
 */
export enum UnavailableModelReason {
  /** The binding names a driver no manifest is registered for. */
  DRIVER_UNKNOWN = 'driver-unknown',
  /** The driver exists and the user turned it off. */
  DRIVER_DISABLED = 'driver-disabled',
  /** The driver exists and is enabled, but failed to activate or errored while serving. */
  DRIVER_ERROR = 'driver-error',
  /** The driver is fine and no longer holds this model: deleted, or never restored. */
  MODEL_MISSING = 'model-missing',
  /**
   * The model resolves and the profile it names does not.
   *
   * The one value here that is an **error rather than a missing referent**: losing a model is
   * normal, but a binding whose three ids disagree with each other is internally inconsistent and
   * the user has to choose a profile (D4 row 7). Reported by the driver as
   * `ContractFailureCode.PROFILE_MISSING`.
   */
  PROFILE_MISSING = 'profile-missing',
  /** The mount itself failed to render the model. */
  RUNTIME_ERROR = 'runtime-error',
}

/**
 * What resolving a character's binding produced.
 *
 * `reason` is absent only when the binding renders.
 */
export type BindingAvailability
  = | { available: true }
    | { available: false, reason: UnavailableModelReason }

/** What AIRI knows about one character binding when it decides whether the model can render. */
export interface BindingAvailabilityInput {
  /** The driver's status, or `'absent'` when the binding names a driver AIRI has no manifest for. */
  driver: DriverStatus | 'absent'
  /** AIRI holds a `HostNamedModelRecord` for the binding's `modelId`. */
  modelRecordPresent: boolean
  /** AIRI holds a `HostModelProfileRecord` for the binding's `profileId`. */
  profileRecordPresent: boolean
  /** The mount reported a failure while rendering this binding. */
  runtimeFailed?: boolean
}

/**
 * Map the facts AIRI holds onto the one reason it shows the user.
 *
 * The order is fixed and is the whole point of having a function rather than three ad-hoc `if`s in
 * three views — it decides which reason wins when more than one could apply:
 *
 *   1. the driver (an absent or disabled driver explains every model it would have served);
 *   2. a runtime failure of the mount that was already trying;
 *   3. the model record (the outer referent — losing it loses the profile's question too);
 *   4. the profile record (the only *inconsistent* case, `UnavailableModelReason.PROFILE_MISSING`).
 *
 * `DriverStatus` and `UnavailableModelReason` stay two vocabularies (C16) because they answer
 * different questions — "how is the driver" versus "why can this character not render" — and this
 * function is the single documented bridge between them. `profile-missing` has no `DriverStatus`
 * counterpart; it is reported by the driver, never derived from a driver's health.
 */
export function classifyBindingAvailability(input: BindingAvailabilityInput): BindingAvailability {
  // Order matters: each step explains strictly more than the one after it.
  switch (input.driver) {
    case 'absent':
      return { available: false, reason: UnavailableModelReason.DRIVER_UNKNOWN }
    case DriverStatus.NOT_INSTALLED:
      return { available: false, reason: UnavailableModelReason.DRIVER_UNKNOWN }
    case DriverStatus.DISABLED:
      return { available: false, reason: UnavailableModelReason.DRIVER_DISABLED }
    case DriverStatus.ERROR:
      return { available: false, reason: UnavailableModelReason.DRIVER_ERROR }
    case DriverStatus.ENABLED:
      break
  }

  if (input.runtimeFailed)
    return { available: false, reason: UnavailableModelReason.RUNTIME_ERROR }

  if (!input.modelRecordPresent)
    return { available: false, reason: UnavailableModelReason.MODEL_MISSING }

  if (!input.profileRecordPresent)
    return { available: false, reason: UnavailableModelReason.PROFILE_MISSING }

  return { available: true }
}
