/**
 * The records AIRI keeps about the models and profiles it references.
 *
 * Owner: AIRI. Renderers never see these types, except that they receive a `modelId` and a
 * `profileId` and treat both as opaque keys.
 *
 * Nothing here is renderer-derived: no renderer reads or writes these fields, and none of
 * them mirrors a renderer's own storage layout. Everything AIRI stores about a model and its
 * profiles lives here and nowhere else: one record per kind, sharing one annotation shape so
 * the two cannot drift apart.
 */
import type { ModelId, ModelProfileId } from './model'
import type { ModelDriverId } from './shared'

/**
 * A model's stored thumbnail.
 *
 * Owned by AIRI: a renderer *produces* one (`ModelProvider.preview`) and does not keep it,
 * while the catalog has to render with nothing mounted and with the owning driver unavailable
 * or uninstalled.
 *
 * Stored as a data URL rather than a `Blob`, because this value is persisted inside a reactive
 * record.
 */
export interface ModelPreview {
  /** The encoded image. Required: a preview AIRI holds is an image. */
  dataUrl: string
  /** Intrinsic pixel size, so a catalog can lay a row out before the image decodes. */
  width?: number
  height?: number
}

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
