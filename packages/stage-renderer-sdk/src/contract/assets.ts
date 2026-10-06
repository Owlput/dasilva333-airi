/**
 * The asset side of the boundary.
 *
 * Owner: the renderer plugin implements the provider and owns the bytes; AIRI
 * keeps only references (see `references.ts`).
 *
 * Purpose: today one host store owns every renderer's assets — localforage keys
 * `display-model-<nanoid>` and `<id>-textures` — statically imports all four
 * renderer preview generators, and contains each format's detection, validation
 * and repair inline. Moving the provider behind this interface is what lets a
 * renderer live outside this monorepo.
 *
 * ## How a payload can relate to a model
 *
 * Exactly two shapes exist; anything else is a storage detail leaking into the
 * contract.
 *
 * 1. **Part of the payload.** Required to use the model at all — a model file and
 *    the textures its materials reference. It travels inside the handle returned
 *    by `read()` (a single `File`, or the whole set as `File[]`), has no id of its
 *    own and no separate storage entry, because AIRI must never be able to hold an
 *    unusable half of a model.
 * 2. **An independent asset.** Has its own id, its own `kind`, its own storage and
 *    its own lifecycle. AIRI lists it, stores its metadata and points at it by id;
 *    it does not model how one asset relates to another. Whether an asset is an
 *    alternative texture set, an outfit's files or something else, and whether it
 *    is referenced by anything, is the renderer's business: such relationships
 *    either stay entirely inside the renderer's storage or travel in the opaque
 *    `meta` bag, which AIRI persists verbatim and never interprets.
 *
 * There is deliberately no third "attached" shape: a payload with its own storage
 * key but no identity. That is what this package called a `sidecar` in its first
 * revision, and it is exactly what produced the host's `<modelId>-textures`
 * suffix convention — a key that had to be excluded from model enumeration,
 * remembered at two separate delete sites, fetched again before preview
 * regeneration, and uploaded as a second cloud payload per model.
 */
import type { RendererCapabilityDescriptor } from './capabilities'
import type {
  AssetKind,
  MaybePromise,
  RendererAssetId,
  RendererId,
  RendererResult,
} from './shared'

export interface RendererAssetProvider {
  readonly rendererId: RendererId
  readonly kinds: AssetKind[]

  /**
   * Decide whether this renderer can host an incoming input.
   *
   * Purpose: keeps unified import working once per-format detection leaves the
   * host. Every enabled renderer is asked; the host arbitrates by confidence and
   * surfaces the winner's warnings before committing.
   */
  probe?: (input: AssetProbeInput) => MaybePromise<RendererResult<AssetProbeResult | null>>

  /** Enumerate this renderer's own asset metadata. */
  list: (query?: AssetQuery) => MaybePromise<RendererResult<AssetDescriptor[]>>

  /** Hand the host everything it needs to mount the asset on stage. */
  read: (assetId: RendererAssetId) => MaybePromise<RendererResult<StageAssetHandle>>

  /**
   * Persist a new asset (or several, when one input expands into many).
   *
   * Purpose: one package can legitimately contain multiple models — the host
   * repairs Live2D multi-model zips by splitting them and re-importing each part,
   * which is why this returns a list.
   */
  write: (input: AssetWriteInput) => MaybePromise<RendererResult<AssetDescriptor[]>>

  remove: (assetId: RendererAssetId) => MaybePromise<RendererResult<void>>

  /** Generate or refresh a thumbnail. Only the owner can do this. */
  preview?: (assetId: RendererAssetId) => MaybePromise<RendererResult<AssetPreview | null>>

  /**
   * Enumerate what the asset can do.
   *
   * The renderer owns the resulting record (labels, usable flags, mappings and
   * the UI for them); this is only the host's read path, and `capabilities.ts`
   * describes the one projection AIRI is allowed to keep.
   */
  capabilities?: (assetId: RendererAssetId) => MaybePromise<RendererResult<RendererCapabilityDescriptor[]>>

  /**
   * Opaque bundle for backup/restore.
   *
   * `import` must accept a caller-supplied `assetId` so that a restored device
   * keeps the same `(rendererId, assetId)` mapping the host's references point at.
   */
  export?: (assetId: RendererAssetId) => MaybePromise<RendererResult<AssetTransferBundle>>
  import?: (bundle: AssetTransferBundle) => MaybePromise<RendererResult<AssetDescriptor>>
}

export interface AssetProbeInput {
  file?: File
  url?: string
  /** Names hint when the payload is a directory pick (Live2D accepts one). */
  fileNames?: string[]
}

export interface AssetProbeResult {
  kind: AssetKind
  /** 0..1. The host picks the highest-confidence claimant. */
  confidence: number
  /** Suggested display name, usually derived from the file name. */
  name?: string
  /** Non-fatal findings worth showing before the user commits (today: the audit modal). */
  warnings?: string[]
  /** Repairs the renderer would apply on import, described for the user. */
  plannedFixes?: string[]
  /** Set when the input cannot be imported as-is. */
  blockingFindings?: string[]
}

export interface AssetQuery {
  kinds?: AssetKind[]
  nameContains?: string
  limit?: number
  offset?: number
}

/**
 * What AIRI stores about an asset it does not own.
 *
 * `meta` is opaque on purpose: AIRI persists it verbatim and must not validate
 * it, because the renderer that wrote it may be newer than AIRI.
 */
export interface AssetDescriptor {
  assetId: RendererAssetId
  kind: AssetKind
  name: string
  importedAt: number
  preview?: AssetPreview
  /** Advisory; the renderer computes it, the host only displays it. */
  byteSize?: number
  /**
   * Renderer-owned metadata, including any relationship this asset has to other
   * assets. AIRI persists it verbatim and never interprets it.
   *
   * Obligation this puts on the renderer: AIRI prunes, restores and deletes assets
   * independently, so a reference inside `meta` may point at an asset that is
   * absent on this device. Loading must degrade gracefully rather than fail.
   */
  meta?: unknown
}

/**
 * Thumbnail representation.
 *
 * Purpose: keep both shapes, because they serve different consumers. The host
 * currently stores compressed data URLs so it can list the catalog from a
 * lightweight record, while a live blob is what the settings UI renders.
 */
export interface AssetPreview {
  blob?: Blob
  dataUrl?: string
  width?: number
  height?: number
  generatedAt?: number
}

/**
 * The handoff used to mount an asset on stage.
 *
 * Purpose: today this is always a host-created blob URL with a delayed revoke,
 * plus a `#<filename>` fragment hack because blob URLs have no extension for
 * loaders to sniff. Making the transport explicit forces a lifetime rule — the
 * host keeps a `url` handle alive until the renderer releases it, instead of
 * revoking it on a timer — and lets a renderer receive a whole set at once: a
 * directory pick (Live2D) or a model with its required companions (MMD) is
 * simply `File[]`.
 */
export type StageAssetSource
  = | { transport: 'url', url: string, mimeType?: string, fileName?: string }
    | { transport: 'file', file: File[] }

export interface StageAssetHandle {
  assetId: RendererAssetId
  kind: AssetKind
  source: StageAssetSource
  /** Advisory renderer-side hints (entry file, expected sibling files). */
  hints?: Record<string, unknown>
  /**
   * Release this handle. The host may then revoke any URL it created.
   * Idempotent.
   */
  release: () => MaybePromise<void>
}

export interface AssetWriteInput {
  name: string
  /** The payload, in whichever transport the import path produced. */
  file?: File
  files?: File[]
  url?: string
  kind?: AssetKind
  /** Opaque renderer metadata to persist alongside the asset. */
  meta?: unknown
  /**
   * Restore path only: re-create this exact asset id.
   *
   * Purpose: the host's references point at `(rendererId, assetId)`; a restored
   * device must not end up with a different id for the same asset.
   */
  assetId?: RendererAssetId
}

/**
 * An asset packaged for off-device storage.
 *
 * Purpose: AIRI promises cross-device continuity, and a renderer plugin may have
 * no cloud access of its own, so the host must be able to move the payload
 * without understanding it.
 */
export interface AssetTransferBundle {
  descriptor: AssetDescriptor
  payload: Blob
}
