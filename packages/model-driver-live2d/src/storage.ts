/**
 * The Live2D driver's own storage layout, inside the namespace the host gives it.
 *
 * Keys are relative; the adapter adds the driver's prefix (`airi-driver-{id}/`) on the way in and strips it on the
 * way out, so this module never learns where the data physically lives (plan §4.6, `host/storage.ts`).
 *
 * ```text
 * model/{modelId}                  StoredLive2DModel — name, byte size, profiles, parsed capability catalog
 * model/{modelId}/bytes            the `.zip` the user imported, base64 (see the note below)
 * model/{modelId}/profile/{id}     a profile body (JSON-safe, driver-defined)
 * ```
 *
 * **Why base64.** `HostServices.storage` is unstorage over IndexedDB, and its `set` path JSON-serializes values:
 * a `Uint8Array` would arrive as `{ "0": 12, "1": 34, … }` — corrupted, and silently so. The adapter exposes no
 * raw/binary setter, so the safe encode is the honest one at this contract revision. The cost is ~33% on disk and
 * a transient string while decoding; a dedicated blob store belongs to the transfer/backup work (Phase 7), where the
 * bundle format is specified, not to this slice.
 */
import type { HostStorageInterface, ModelId, ModelProfileId, Unsubscribe } from '@proj-airi/stage-renderer-sdk'

import type { Live2DProfileBody } from './profile'

export interface StoredLive2DExpression {
  /** Stable across sessions: the expression's `Name` from the model's settings, or the file basename. */
  key: string
  label: string
}

export interface StoredLive2DMotion {
  /** Stable across sessions: `group#index`. */
  key: string
  group: string
  index: number
}

export interface StoredLive2DModel {
  modelId: ModelId
  name: string
  authorName?: string
  importedAt: number
  /** Compressed size of the imported zip. Reported as the row's advisory `byteSize`. */
  byteSize: number
  /** The model settings path inside the zip, when the archive had one. */
  settingsFile: string | null
  profiles: Array<{ profileId: ModelProfileId, name: string }>
  expressions: StoredLive2DExpression[]
  motions: StoredLive2DMotion[]
  hitAreas: string[]
  /**
   * A small encoded thumbnail (a short data URL), written by the first mount that rendered this model.
   *
   * The driver makes its own preview (D-8): AIRI never renders a format, and a row is allowed to be a reference
   * without one. Absent until a mount has loaded the model at least once.
   */
  preview?: string
}

const MODEL_PREFIX = 'model/'

const recordKey = (modelId: ModelId) => `${MODEL_PREFIX}${modelId}`
const bytesKey = (modelId: ModelId) => `${MODEL_PREFIX}${modelId}/bytes`
const profileKey = (modelId: ModelId, profileId: ModelProfileId) => `${MODEL_PREFIX}${modelId}/profile/${profileId}`

export async function listModelRecords(storage: HostStorageInterface): Promise<StoredLive2DModel[]> {
  const keys = await storage.keys()
  const models: StoredLive2DModel[] = []
  for (const key of keys) {
    // A record is exactly `model/{id}`; bytes and profiles are nested under it and are not records.
    if (!key.startsWith(MODEL_PREFIX) || key.slice(MODEL_PREFIX.length).includes('/'))
      continue
    const record = await storage.get<StoredLive2DModel>(key)
    if (record && typeof record === 'object' && typeof record.modelId === 'string')
      models.push(record)
  }
  return models.sort((a, b) => b.importedAt - a.importedAt)
}

export async function readModelRecord(storage: HostStorageInterface, modelId: ModelId): Promise<StoredLive2DModel | undefined> {
  return storage.get<StoredLive2DModel>(recordKey(modelId))
}

export async function writeModelRecord(storage: HostStorageInterface, record: StoredLive2DModel): Promise<void> {
  await storage.set(recordKey(record.modelId), record)
}

export async function removeModelRecord(storage: HostStorageInterface, modelId: ModelId): Promise<void> {
  await storage.remove(bytesKey(modelId))
  await storage.remove(recordKey(modelId))
  // Profiles do not outlive their model, so remove every profile body under it too.
  for (const key of await storage.keys()) {
    if (key.startsWith(`${recordKey(modelId)}/profile/`))
      await storage.remove(key)
  }
}

export async function readModelBytes(storage: HostStorageInterface, modelId: ModelId): Promise<string | undefined> {
  return storage.get<string>(bytesKey(modelId))
}

export async function writeModelBytes(storage: HostStorageInterface, modelId: ModelId, base64: string): Promise<void> {
  await storage.set(bytesKey(modelId), base64)
}

/**
 * Attach a thumbnail to an existing model, leaving everything else on the record alone.
 *
 * Deliberately a read-modify-write of one field rather than a second record: the record is the driver's description of
 * the model, and a preview that rewrote the catalogue (or created a record for a model that is gone) would be a second
 * source of truth. A missing record is a no-op — the model was removed between the load and the capture.
 */
export async function writeModelPreview(storage: HostStorageInterface, modelId: ModelId, preview: string): Promise<boolean> {
  const record = await readModelRecord(storage, modelId)
  if (!record)
    return false
  await writeModelRecord(storage, { ...record, preview })
  return true
}

export interface StoredLive2DProfile {
  profileId: ModelProfileId
  name: string
  /** Driver-defined body; a profile is converted from legacy outfits by the driver, never by the host (D-9). */
  body: Live2DProfileBody
}

export async function readProfile(storage: HostStorageInterface, modelId: ModelId, profileId: ModelProfileId): Promise<StoredLive2DProfile | undefined> {
  return storage.get<StoredLive2DProfile>(profileKey(modelId, profileId))
}

export async function writeProfile(storage: HostStorageInterface, modelId: ModelId, profile: StoredLive2DProfile): Promise<void> {
  await storage.set(profileKey(modelId, profile.profileId), profile)
}

export async function removeProfile(storage: HostStorageInterface, modelId: ModelId, profileId: ModelProfileId): Promise<void> {
  await storage.remove(profileKey(modelId, profileId))
}

/**
 * Write one profile's body, keeping its name.
 *
 * The body is replaced wholesale: it is a small, complete value, and merging a partial write into a stored one
 * would leave a member the UI can no longer clear. Absent profile answers `undefined` rather than inventing one.
 */
export async function writeProfileBody(
  storage: HostStorageInterface,
  modelId: ModelId,
  profileId: ModelProfileId,
  body: Live2DProfileBody,
): Promise<StoredLive2DProfile | undefined> {
  const existing = await readProfile(storage, modelId, profileId)
  if (!existing)
    return undefined
  const next: StoredLive2DProfile = { ...existing, body }
  await writeProfile(storage, modelId, next)
  return next
}

/**
 * Observe one profile.
 *
 * This is the cross-window route the storage port exists for: a panel in the settings window writes a slider, and
 * the mount in the actor window re-applies it without either knowing about the other. The mount only listens while
 * that profile is the one it shows.
 */
export function watchProfile(
  storage: HostStorageInterface,
  modelId: ModelId,
  profileId: ModelProfileId,
  handler: (profile: StoredLive2DProfile | undefined) => void,
): Unsubscribe {
  return storage.watch<StoredLive2DProfile | undefined>(profileKey(modelId, profileId), value => handler(value))
}

/** Delete every byte this driver persisted. `purge` is the only complete deletion path (RFC §5.10). */
export async function purgeAll(storage: HostStorageInterface): Promise<void> {
  for (const key of await storage.keys())
    await storage.remove(key)
}

/**
 * Base64 → bytes, without the call-stack blowup `String.fromCharCode(...bytes)` causes above ~100k entries.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Bytes → base64, chunked for the same reason. */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  return btoa(binary)
}
