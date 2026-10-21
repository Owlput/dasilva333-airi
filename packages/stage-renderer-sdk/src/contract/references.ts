/**
 * The records AIRI keeps about the models and profiles it references.
 *
 * Owner: AIRI. Renderers never see these types, except that they receive a `modelId` and a
 * `profileId` and treat both as opaque keys — and that the thumbnail they produce is the shared
 * `ModelPreview` shape (`shared.ts`).
 *
 * Nothing here is renderer-derived: no renderer reads or writes these fields, and none of
 * them mirrors a renderer's own storage layout. Everything AIRI stores about a model and its
 * profiles lives here and nowhere else: one record per kind, sharing one annotation shape so
 * the two cannot drift apart.
 */
import type { ModelId, ModelProfileId } from './model'
import type { ModelDriverId, ModelPreview } from './shared'

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
   * The small icon the card/author UI shows for this model.
   *
   * Separate from `preview`: a model can have a large thumbnail and no author icon, or an icon
   * that is not a crop of the thumbnail. Legacy display models carry `authorIcon` as an asset
   * URL, so migration has to normalize it into `ModelPreview` (fetch it, or skip it with a
   * warning) rather than storing the URL as if it were a data URL.
   */
  authorIcon?: ModelPreview
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
 * The renderer's own per-model state is declared separately and stored opaquely
 * (`ModelScopedState`), and the renderer's asset metadata lives inside its own provider.
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
 * `profileId` is minted by AIRI, exactly like `modelId`, so `(modelId, profileId)` addresses a
 * profile without either side inventing a name for the other's storage.
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
