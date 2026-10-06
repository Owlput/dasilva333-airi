/**
 * Who owns which persisted data, and how the host can back it up blindly.
 *
 * Owner: the rules here bind both sides; the *declaration* is the renderer's.
 *
 * Purpose: today ownership is accidental and inconsistent:
 *   - each renderer keeps 10-30 raw localStorage keys of its own
 *     (`settings/stage-ui-three/*`, `settings/live2d/*`, `settings/mmd/*`,
 *     `settings/spine/*`) that the host can neither enumerate nor migrate;
 *   - `settings/mmd/scale` has two writers with different defaults, and
 *     `settings/mmd/render-scale` is written by both the renderer's store and an
 *     otherwise unused host store;
 *   - `activeAnimations` (Spine, per model) is watched, applied and reset but
 *     never written with a value, and `favoriteExpression` (VRM) is only cleared
 *     by `resetModelStore` — nothing sets or reads it;
 *   - per-model transforms are split between the host's positioning store and
 *     renderer-global keys, so "reset this model's position" has no single owner.
 * A declared list makes those conflicts visible and lets AIRI back up opaque
 * renderer state without understanding it.
 */
import type { RendererVocabularySnapshot } from './capabilities'
import type { MaybePromise, ModelReferenceId, RendererAssetId, RendererId } from './shared'

/**
 * `host`   — AIRI writes it; renderers may read through a service.
 * `renderer` — the renderer writes it; AIRI only stores/backs it up verbatim.
 */
export type PersistenceOwner = 'host' | 'renderer'

/**
 * `host-global`    — one value for the whole app (theme, feature toggles).
 * `renderer-global`— one value per renderer (camera, lighting, physics flags).
 * `model-scoped`   — one value per (renderer, model) pair (position/scale,
 *                    selected alt model or outfit, morph overrides, DSL
 *                    affinity). The renderer shards these itself, since only it
 *                    knows how its values are keyed — which means one key may
 *                    hold every model, and the host can then only prune, back up
 *                    and restore whole keys. Merging two devices is likewise the
 *                    renderer's job (`resolveConflict`).
 * `session`        — intentionally not persisted; declared so the host does not
 *                    mistake it for a missing key.
 */
export type PersistenceScope = 'host-global' | 'renderer-global' | 'model-scoped' | 'session'

export type PersistedValueKind = 'json' | 'string' | 'number' | 'boolean' | 'blob'

export interface RendererPersistedValueDescriptor {
  /** Renderer-local key; the host namespaces it per renderer. */
  key: string
  owner: PersistenceOwner
  scope: PersistenceScope
  kind: PersistedValueKind
  /** Bumped when the shape changes; the host runs `migration` on mismatch. */
  schemaVersion: number
  /** Shown in the host's data-management UI. */
  description: string
  /**
   * Whether AIRI includes this value in cloud backup.
   *
   * Purpose: device-specific values (last camera distance, GPU-dependent render
   * scale) should be excluded while user intent (selected alt model or outfit,
   * morph overrides) should not.
   */
  backedUp: boolean
  defaultValue?: unknown
  /** Pure function; must never throw. Returns the value at `schemaVersion`. */
  migration?: (value: unknown, fromVersion: number) => unknown
  /**
   * Resolve a sync conflict for this value.
   *
   * AIRI cannot merge: it does not know which fields are configurable, so it has
   * nothing to merge on. The renderer may present the conflict to the user (the
   * host exposes a dialog primitive as `RendererUiService.choose`), decide it
   * itself, or defer it. Absent = the host falls back to last-write-wins.
   */
  resolveConflict?: (current: unknown, incoming: unknown, context: RendererConflictContext) => MaybePromise<RendererConflictResolution>
}

/** What a renderer decided about one conflicting value. */
export type RendererConflictResolution
  /** Keep what this device already has. */
  = | { action: 'keep-local' }
  /** Take what sync brought in. */
    | { action: 'take-incoming' }
    | { action: 'merged', value: unknown }
    /** Unresolved: keep the local value and ask again later. */
    | { action: 'deferred' }

export interface RendererConflictContext {
  rendererId: RendererId
  /** Present when the conflicting value is model-scoped. */
  referenceId?: ModelReferenceId
  key: string
  /** Where the incoming value came from, when the host knows. */
  source: 'cloud' | 'local-backup' | 'import' | 'unknown'
}

/**
 * Optional blob-shaped state a renderer keeps outside key/value storage
 * (custom animations, extracted texture sets, OPFS caches).
 *
 * The host treats the payload as opaque and only needs the prefix/namespace in
 * order to enumerate and delete it.
 */
export interface RendererBlobStateDescriptor {
  /** Namespace or key prefix owned by the renderer. */
  prefix: string
  description: string
  backedUp: boolean
}

export interface RendererPersistedStateManifest {
  rendererId: RendererId
  values: RendererPersistedValueDescriptor[]
  blobs?: RendererBlobStateDescriptor[]
}

/**
 * AIRI's own record about a model reference.
 *
 * Purpose: this is the *only* per-model metadata AIRI owns. It is deliberately
 * free of any renderer-specific field: the renderer's own per-model state is
 * declared separately and stored opaquely, and the renderer's asset metadata
 * lives inside the renderer's own provider.
 */
export interface HostModelMetadataRecord {
  referenceId: ModelReferenceId
  displayName: string
  importedAt: number
  /** Renderer that currently owns the asset, when bound. */
  rendererId?: RendererId
  /** Asset inside that renderer, when bound. */
  assetId?: RendererAssetId
  /** Opaque asset class, for display and for guessing a renderer on import. */
  kind?: string
  preview?: { dataUrl?: string, updatedAt?: number }
  nsfw?: boolean
  groups?: string[]
  tags?: string[]
  /** Lowercased name+tags+groups, used by the catalog filter. */
  searchKey?: string
}

/**
 * A renderer's per-model state, kept by the host as an uninterpreted snapshot.
 *
 * Purpose: gives "reset per-model state" and "move this model's settings with the
 * model" a single home while leaving the values entirely to the renderer. Today
 * this is split between the host's positioning store and renderer-global keys
 * that are keyed by a model id *inside* one shared value, so a single model's
 * slice can be neither pruned nor moved.
 *
 * Rules:
 *   - the **renderer is the only writer**. The host keeps the latest snapshot and
 *     never writes one back into renderer storage; restoring means handing the
 *     snapshot to the renderer, which resolves it through `resolveConflict`.
 *   - `values` stays opaque to AIRI, so the renderer may put its per-model
 *     transform, selection and morph overrides in there under its own keys.
 *   - `vocabulary` is the single part AIRI reads, for prompts built while nothing
 *     is mounted.
 */
export interface ModelScopedRendererState {
  referenceId: ModelReferenceId
  rendererId: RendererId
  /** Declared keys only; unknown keys are tolerated for forward compatibility. */
  values: Record<string, unknown>
  /** Written by the renderer together with `values`; read-only for AIRI. */
  vocabulary?: RendererVocabularySnapshot
  /** Monotonic, bumped by the renderer on every write. AIRI never writes it. */
  revision: number
  updatedAt: number
}

/**
 * What the host must implement so a renderer's settings survive a device move,
 * plus the snapshot channel its per-model state travels through.
 */
export interface RendererStateTransferPort {
  exportState: (rendererId: RendererId) => Promise<RendererPersistedStateManifest>
  /** Apply a previously exported manifest, running migrations as needed. */
  importState: (manifest: RendererPersistedStateManifest, values: Record<string, unknown>) => Promise<void>
  /**
   * Store a snapshot the renderer just produced.
   *
   * Only the **mounted** instance may call this — whichever mount is on screen
   * (`stage`, `preview`, `actor` or `rehearsal`). A settings panel edits the
   * renderer's own store and lets the mounted instance publish, so two windows
   * never race on `revision`. If nothing is mounted, nothing writes: the panel's
   * edits land in the snapshot when the renderer is next mounted.
   *
   * The host keeps the snapshot verbatim and never writes it back into renderer
   * storage; it ignores a write that is not newer than the one it holds, and
   * restoring means handing the snapshot to the renderer to merge.
   */
  writeSnapshot: (snapshot: ModelScopedRendererState) => Promise<void>
  /** The last snapshot the renderer wrote for this model, if any. */
  readSnapshot: (rendererId: RendererId, referenceId: ModelReferenceId) => Promise<ModelScopedRendererState | undefined>
}
