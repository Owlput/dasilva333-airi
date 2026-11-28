/**
 * The legacy entry the Live2D driver retains for one migrated model, and the payload a revert reads back
 * (§6.5 step 3, D-16, D-9).
 *
 * Two obligations meet here and neither is optional:
 *
 *   - **retain.** `migrate` answers `retained: true` only when the payload is in this driver's own storage. That answer
 *     is what lets the host write `model-migration/{modelId}`; a driver that answered `true` and kept nothing would
 *     strand the model — the legacy copy may be deleted at commit, and a revert would then have no source at all.
 *   - **move, never copy.** The import that follows reads this entry by reference and drops the retained bytes once
 *     the model's own row holds them (D-16, D-17). This module therefore stores the payload **once**, under
 *     `legacy/{modelId}`, and never next to the imported row.
 *
 * The bytes are base64 for the same reason the model bytes are (`storage.ts`): the host's storage port JSON-serializes
 * values, so a `Uint8Array` would arrive as a numeric-keyed object and silently corrupt.
 *
 * What a revert gets is `LegacyRestorePayload`, never an empty shell: when no entry was retained the answer is a
 * readable refusal (`asset-missing`), because a model imported after cutover has no legacy identity to restore and
 * "import nothing" would be a half-revert. Driver data is kept either way, so "migrate again" stays available.
 */
import type {
  ContractResult,
  HostStorageInterface,
  LegacyHandoverAsset,
  LegacyHandoverFile,
  LegacyHandoverMeta,
  LegacyHandoverPlacement,
  LegacyHandoverSettings,
  LegacyRestorePayload,
  ModelDriverLegacyHandoverEntry,
  ModelDriverLegacyHandoverReport,
  ModelId,
} from '@proj-airi/stage-renderer-sdk'

import { ContractFailureCode, LEGACY_HANDOVER_SCHEMA_VERSION } from '@proj-airi/stage-renderer-sdk'

import { LIVE2D_DRIVER_ID } from './manifest'
import { base64ToBytes, bytesToBase64, readModelBytes } from './storage'

const LEGACY_PREFIX = 'legacy/'

const legacyKey = (modelId: ModelId) => `${LEGACY_PREFIX}${modelId}`

/** One retained file, with its bytes already encoded for the storage port. */
interface StoredLegacyFile {
  name: string
  mimeType?: string
  base64: string
}

/** One retained companion asset, with the legacy key it came from. */
interface StoredLegacyAsset extends StoredLegacyFile {
  key: string
  deleted?: boolean
}

/**
 * What is written under `legacy/{modelId}`.
 *
 * Every opaque member of the handover is kept as it arrived: the host interprets none of them (`migration.ts`), and a
 * revert must hand back the same values the legacy path rendered from. `legacyModelId` is provenance, never identity —
 * the model's own id is the one the adapter minted.
 */
export interface StoredLive2DLegacyEntry {
  schemaVersion: number
  modelId: ModelId
  legacyModelId: string
  /** When the host built the handover, as it reported it. */
  createdAt: number
  /** When this driver wrote the entry — a retry keeps the first value, so the retention is not reset by a crash. */
  retainedAt: number
  meta: LegacyHandoverMeta
  settings?: LegacyHandoverSettings
  values?: Record<string, unknown>
  placement?: LegacyHandoverPlacement
  outfits?: unknown[]
  prompt?: string
  url?: string
  files?: StoredLegacyFile[]
  assets?: StoredLegacyAsset[]
}

const ok = <T>(value: T): ContractResult<T> => ({ ok: true, value })
const fail = (code: ContractFailureCode, message: string): ContractResult<never> => ({ ok: false, error: { code, message } })

export async function readRetainedLegacyEntry(
  storage: HostStorageInterface,
  modelId: ModelId,
): Promise<StoredLive2DLegacyEntry | undefined> {
  return storage.get<StoredLive2DLegacyEntry>(legacyKey(modelId))
}

/** Every retained entry, for a diagnostics surface or a transfer bundle (Phase 7). */
export async function listRetainedLegacyEntries(storage: HostStorageInterface): Promise<StoredLive2DLegacyEntry[]> {
  const entries: StoredLive2DLegacyEntry[] = []
  for (const key of await storage.keys()) {
    if (!key.startsWith(LEGACY_PREFIX))
      continue
    const entry = await storage.get<StoredLive2DLegacyEntry>(key)
    if (entry && typeof entry === 'object' && typeof entry.modelId === 'string')
      entries.push(entry)
  }
  return entries
}

export async function removeRetainedLegacyEntry(storage: HostStorageInterface, modelId: ModelId): Promise<void> {
  await storage.remove(legacyKey(modelId))
}

function toStoredFile(file: LegacyHandoverFile): StoredLegacyFile {
  return {
    name: file.name,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    base64: bytesToBase64(file.bytes),
  }
}

function toStoredAsset(asset: LegacyHandoverAsset): StoredLegacyAsset {
  return {
    ...toStoredFile(asset),
    key: asset.key,
    ...(asset.deleted !== undefined ? { deleted: asset.deleted } : {}),
  }
}

function fromStoredFile(file: StoredLegacyFile): LegacyHandoverFile {
  return {
    name: file.name,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    bytes: base64ToBytes(file.base64),
  }
}

function fromStoredAsset(asset: StoredLegacyAsset): LegacyHandoverAsset {
  return {
    ...fromStoredFile(asset),
    key: asset.key,
    ...(asset.deleted !== undefined ? { deleted: asset.deleted } : {}),
  }
}

/**
 * Which members this driver will **never** interpret, named for the host so it keeps them alive itself.
 *
 * Being on this list is not an error: `url` names a preset the driver cannot import, `outfits` is legacy-shaped
 * appearance it does not convert yet, `assets` are companion files a Live2D zip carries inside itself, and a
 * per-model or window-global setting key is one this driver has no reader for. What is *not* on it — `meta`,
 * `placement`, `files` — is either used by the host record or consumed by the import that follows.
 */
export function unusedLegacyMembers(entry: ModelDriverLegacyHandoverEntry): string[] {
  const unused: string[] = []
  if (entry.url)
    unused.push('url')
  if (entry.outfits && entry.outfits.length > 0)
    unused.push('outfits')
  if (entry.assets && entry.assets.length > 0)
    unused.push('assets')
  // Retained for the revert, but the publication this driver makes is generated from the model's own catalogue
  // (P3-D13). Saying so is better than claiming a legacy prompt became the new one.
  if (entry.prompt !== undefined)
    unused.push('prompt')
  for (const key of Object.keys(entry.settings?.values ?? {}).sort())
    unused.push(`settings.values.${key}`)
  for (const key of Object.keys(entry.values ?? {}).sort())
    unused.push(`values.${key}`)
  return unused
}

function warningsFor(entry: ModelDriverLegacyHandoverEntry): string[] {
  const warnings: string[] = []
  if (entry.url && !entry.files?.length)
    warnings.push('This legacy model was a URL or preset, so there are no bytes to import; the entry is kept for a revert')
  if (entry.outfits && entry.outfits.length > 0)
    warnings.push('Legacy outfits are retained for a revert but are not converted to Live2D profiles yet')
  if (entry.assets && entry.assets.length > 0)
    warnings.push('Companion assets are retained for a revert; a Live2D archive carries its own files')
  if (entry.prompt !== undefined)
    warnings.push('The legacy prompt is retained for a revert; the published prompt is generated from the model catalogue')
  return warnings
}

/**
 * Retain one model's legacy entry. Idempotent by contract, and it writes nothing else.
 *
 * A repeat after a crash — the driver wrote and the host's marker did not — must not fail and must not overwrite the
 * retained copy: the first write already carries the bytes a revert needs, and re-encoding them would be work with no
 * new information. A *different* legacy id under the same minted `modelId` is the one conflict this answers, because
 * accepting it would mean two legacy origins share one identity and a revert could only pick one.
 */
export async function migrateLive2DEntry(
  storage: HostStorageInterface,
  entry: ModelDriverLegacyHandoverEntry,
): Promise<ContractResult<ModelDriverLegacyHandoverReport>> {
  if (entry.schemaVersion !== LEGACY_HANDOVER_SCHEMA_VERSION) {
    return fail(
      ContractFailureCode.UNSUPPORTED_INPUT,
      `This driver reads legacy handover schema ${LEGACY_HANDOVER_SCHEMA_VERSION}, not ${entry.schemaVersion}`,
    )
  }
  if (entry.driverId !== LIVE2D_DRIVER_ID) {
    return fail(
      ContractFailureCode.UNSUPPORTED_INPUT,
      `This handover is for \`${entry.driverId}\`; the Live2D driver is \`${LIVE2D_DRIVER_ID}\``,
    )
  }
  if (!entry.modelId || !entry.legacyModelId) {
    return fail(ContractFailureCode.INVALID_ENVELOPE, 'A handover needs both the minted `modelId` and the `legacyModelId`')
  }

  const existing = await readRetainedLegacyEntry(storage, entry.modelId)
  if (existing && existing.legacyModelId !== entry.legacyModelId) {
    return fail(
      ContractFailureCode.MODEL_ID_CONFLICT,
      `\`${entry.modelId}\` already retains legacy model \`${existing.legacyModelId}\`; refusing to replace it with \`${entry.legacyModelId}\``,
    )
  }

  const report: ModelDriverLegacyHandoverReport = {
    retained: true,
    unused: unusedLegacyMembers(entry),
    warnings: warningsFor(entry),
  }

  // A repeated offer is the same offer. Answer with the same report and leave the retained bytes as they are.
  if (existing)
    return ok(report)

  const retained: StoredLive2DLegacyEntry = {
    schemaVersion: LEGACY_HANDOVER_SCHEMA_VERSION,
    modelId: entry.modelId,
    legacyModelId: entry.legacyModelId,
    createdAt: entry.createdAt,
    retainedAt: Date.now(),
    meta: entry.meta,
    ...(entry.settings ? { settings: entry.settings } : {}),
    ...(entry.values ? { values: entry.values } : {}),
    ...(entry.placement ? { placement: entry.placement } : {}),
    ...(entry.outfits ? { outfits: entry.outfits } : {}),
    ...(entry.prompt !== undefined ? { prompt: entry.prompt } : {}),
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.files && entry.files.length > 0 ? { files: entry.files.map(toStoredFile) } : {}),
    ...(entry.assets && entry.assets.length > 0 ? { assets: entry.assets.map(toStoredAsset) } : {}),
  }

  await storage.set(legacyKey(entry.modelId), retained)
  return ok(report)
}

/**
 * Re-emit one model's retained legacy entry for a revert.
 *
 * The bytes come from the imported row when it exists — that is the live copy, and D-16 keeps only a metadata
 * reference to it — and from the retained payload otherwise (a model retained but not imported yet). The retained
 * entry is **not** deleted: the contract keeps driver data either way, so the same model can be migrated again.
 */
export async function restoreLive2DLegacyPayload(
  storage: HostStorageInterface,
  modelId: ModelId,
): Promise<ContractResult<LegacyRestorePayload>> {
  const retained = await readRetainedLegacyEntry(storage, modelId)
  if (!retained) {
    return fail(
      ContractFailureCode.ASSET_MISSING,
      `The Live2D driver kept no legacy entry for \`${modelId}\`, so there is no legacy identity to restore`,
    )
  }

  const rowBytes = await readModelBytes(storage, modelId)
  const files = rowBytes
    ? [{ name: `${retained.legacyModelId}.zip`, bytes: base64ToBytes(rowBytes) }]
    : (retained.files ?? []).map(fromStoredFile)

  return ok({
    schemaVersion: LEGACY_HANDOVER_SCHEMA_VERSION,
    driverId: LIVE2D_DRIVER_ID,
    modelId: retained.modelId,
    legacyModelId: retained.legacyModelId,
    meta: retained.meta,
    ...(retained.values ? { values: retained.values } : {}),
    ...(retained.placement ? { placement: retained.placement } : {}),
    ...(retained.outfits ? { outfits: retained.outfits } : {}),
    ...(retained.prompt !== undefined ? { prompt: retained.prompt } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(retained.url ? { url: retained.url } : {}),
    ...(retained.assets && retained.assets.length > 0 ? { assets: retained.assets.map(fromStoredAsset) } : {}),
  })
}
