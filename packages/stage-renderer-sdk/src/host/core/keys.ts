/**
 * The key space of every record the host owns for the model driver contract.
 *
 * One module so that "what does the host persist, and under what key" has a single answer. The keys
 * are the ones [`docs/data-catalog.md`](../../../../../docs/data-catalog.md) §3.2.1 documents; a key that is not
 * here does not exist.
 *
 * Two conventions, and both matter:
 *
 *   - **no `local:` prefix.** The catalog writes `local:model-drivers/...` because that is what the
 *     unstorage instance in the renderer sees. This package addresses the window's storage primitives
 *     (`WindowStorage`, from the contract package), and the implementation (unstorage in a renderer, an
 *     in-memory map in a test) is what adds or drops the backend prefix. Hard-coding `local:` here would
 *     make the primitive unusable from anything that is not unstorage.
 *   - **every key lives under {@link HOST_STORAGE_ROOT}**, including the migration markers, so that a
 *     backup, a purge and a "what does the host own" question are each one prefix scan rather than a
 *     list someone has to remember to extend.
 */

/** The one prefix the host owns. A backup and a purge are both defined against it. */
export const HOST_STORAGE_ROOT = 'model-drivers'

export const HOST_STORAGE_KEYS = {
  root: HOST_STORAGE_ROOT,

  models: `${HOST_STORAGE_ROOT}/models/`,
  model: (modelId: string) => `${HOST_STORAGE_ROOT}/models/${modelId}`,

  profiles: `${HOST_STORAGE_ROOT}/profiles/`,
  profile: (profileId: string) => `${HOST_STORAGE_ROOT}/profiles/${profileId}`,

  prompts: `${HOST_STORAGE_ROOT}/prompt/`,
  prompt: (driverId: string, modelId: string, profileId: string) =>
    `${HOST_STORAGE_ROOT}/prompt/${driverId}/${modelId}/${profileId}`,

  pending: (payloadId: string) => `${HOST_STORAGE_ROOT}/pending/${payloadId}`,
  pendingRoot: `${HOST_STORAGE_ROOT}/pending/`,

  /** Canonical from Phase 1; the legacy `sync-metadata/deleted-models/{id}` keeps being read. */
  deleted: (modelId: string) => `${HOST_STORAGE_ROOT}/deleted/${modelId}`,
  deletedRoot: `${HOST_STORAGE_ROOT}/deleted/`,

  /**
   * Markers are under the root even though the plan writes them shorthand as `model-migration/{id}`.
   * A marker the host writes belongs to the host's own key space; splitting it out of the prefix would
   * mean a backup and a purge each needed a second rule.
   */
  modelMigrationMarker: (modelId: string) => `${HOST_STORAGE_ROOT}/markers/model-migration/${modelId}`,
  modelMigrationMarkers: `${HOST_STORAGE_ROOT}/markers/model-migration/`,
  driverMigrationMarker: (driverId: string) => `${HOST_STORAGE_ROOT}/markers/driver-migration/${driverId}`,
  driverMigrationMarkers: `${HOST_STORAGE_ROOT}/markers/driver-migration/`,

  /** The opaque bundle a driver's `export()` produced. The host never reads inside one. */
  driverBundle: (driverId: string) => `${HOST_STORAGE_ROOT}/driver-bundle/${driverId}`,
  driverBundles: `${HOST_STORAGE_ROOT}/driver-bundle/`,
} as const

/* The driver-scoped storage prefix is `driverStorageRoot` in the contract package: the namespace layout belongs
 * to the renderer adapter that composes it, not to the host's record key space. */
