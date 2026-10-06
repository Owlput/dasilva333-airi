/**
 * AIRI-side model references and their failure states.
 *
 * Owner: AIRI implements this; renderers never see these types, except that they
 * receive a `modelReferenceId` and must treat it as an opaque key.
 *
 * Purpose: replace the implicit assumption that all renderers share one asset id
 * space. What a character card stores is a *reference*; what actually resolves it
 * is a `(rendererId, assetId)` pair owned by one renderer plugin. Because
 * renderers become installable and optional, an unresolved reference is a normal
 * state rather than an error:
 *   - the renderer is disabled by the user,
 *   - the renderer is not installed at all,
 *   - the renderer no longer supports the kind the reference was created for,
 *   - the asset is missing locally (pruned, or never restored on this device),
 *   - the reference was never bound (imported card, unknown model).
 * Today the host collapses all of these into "model not found" plus a fallback to
 * a default preset, which loses the user's intent and cannot offer a repair.
 */

import type { StageAssetHandle } from './assets'
import type {
  AssetKind,
  ModelReferenceId,
  RendererAssetId,
  RendererId,
  Unsubscribe,
} from './shared'

export type ModelReferenceOrigin
  /** Shipped preset declared as a URL by a renderer; never imported. */
  = | 'preset'
    /** The user imported it on this device. */
    | 'user'
    /** Restored from cloud backup. */
    | 'cloud'
    /** Brought in by a card or an export bundle. */
    | 'imported'

/**
 * The host's durable pointer to a model.
 *
 * `rendererId`/`assetId` are optional: a reference can exist before it is bound
 * (card import) or after its renderer disappeared (uninstall).
 */
export interface ModelReference {
  referenceId: ModelReferenceId
  displayName: string
  importedAt: number
  origin: ModelReferenceOrigin
  rendererId?: RendererId
  assetId?: RendererAssetId
  kind?: AssetKind
  /** Pointer to a cached preview so the catalog can render without the renderer. */
  previewRef?: string
  /**
   * Which renderer the user (or a card) expects to serve this reference.
   *
   * Purpose: survives a renderer being disabled, so the host can say "this card
   * needs the Live2D renderer" instead of silently showing a different avatar.
   */
  rendererHint?: RendererId
}

/** Cheap availability verdict for catalog rows, without resolving a handle. */
export type ModelReferenceAvailability
  = | 'available'
    | 'renderer-disabled'
    | 'renderer-missing'
    | 'kind-unsupported'
    | 'asset-missing'
    | 'unbound'

export interface ModelReferenceListRow {
  referenceId: ModelReferenceId
  displayName: string
  importedAt: number
  rendererId?: RendererId
  kind?: AssetKind
  previewUrl?: string
  availability: ModelReferenceAvailability
}

/**
 * The full resolution result, including everything the host needs to explain
 * itself to the user.
 */
export type ModelReferenceResolution
  = | { status: 'resolved', reference: ModelReference, handle: StageAssetHandle }
    | { status: 'renderer-disabled', reference: ModelReference, rendererId: RendererId, enableHint?: string }
    | { status: 'renderer-missing', reference: ModelReference, rendererId: RendererId, installHint?: string }
    | { status: 'kind-unsupported', reference: ModelReference, rendererId: RendererId, kind: AssetKind, supportedKinds: AssetKind[] }
    | { status: 'asset-missing', reference: ModelReference, rendererId: RendererId, assetId: RendererAssetId, restorableFrom?: Array<'cloud' | 'local-backup' | 'origin'> }
    | { status: 'unbound', reference: ModelReference }

/**
 * What AIRI must expose so the stage can turn a card's `displayModelId` into
 * something mountable.
 *
 * Purpose: keeps `displayModelId` a single opaque string, so the card schema and
 * every existing consumer stay valid while the renderer behind it changes.
 */
export interface ModelReferenceResolver {
  resolve: (referenceId: ModelReferenceId) => Promise<ModelReferenceResolution>
  list: () => Promise<ModelReferenceListRow[]>
  /** Bind an existing reference to a renderer asset (after import or restore). */
  bind: (referenceId: ModelReferenceId, binding: { rendererId: RendererId, assetId: RendererAssetId, kind?: AssetKind }) => Promise<void>
  /** Drop the binding but keep the reference, e.g. after removing a local copy. */
  unbind: (referenceId: ModelReferenceId) => Promise<void>
  /** Subscribe to reference or renderer-registry changes that affect resolution. */
  subscribe: (handler: () => void) => Unsubscribe
}
