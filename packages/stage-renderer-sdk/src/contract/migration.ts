/**
 * Pre-contract data handed to a driver, and the reverse payload that lets a character go back.
 *
 * Owner: AIRI builds the handover and consumes the restore payload; the driver interprets both and
 * never sees AIRI's storage layout. AIRI is a **byte custodian, never an interpreter** (D14): the
 * `values`, `outfits`, `files`, `assets`, `prompt` and `url` members are opaque wholes that AIRI
 * collects and writes as-is. It performs no format parsing and no outfit conversion — converting a
 * legacy outfit into a driver profile is driver work (D-9).
 *
 * Two shapes, one direction each:
 *
 *   - `ModelDriverLegacyHandoverEntry` — one model going **into** a driver during migration. One
 *     entry per call, because the offer is per model and lazily materialised: one model's bytes are
 *     in memory at a time, never the whole library (D8, D17).
 *   - `LegacyRestorePayload` — the same model coming **back out**, when the user reverts a character
 *     to the legacy path during the reversal window (D9, C23).
 *
 * The reversal payload exists because AIRI's own legacy copies may already be gone: after the
 * cutover the driver's retained entry is the only complete copy, so a revert that could not ask the
 * driver would have nothing to restore.
 */
import type { ModelId } from './model'
import type { ModelDriverId } from './shared'

/** The schema version these two payloads carry. AIRI refuses one it does not know. */
export const LEGACY_HANDOVER_SCHEMA_VERSION = 1

/**
 * One file (or asset) as AIRI collected it.
 *
 * `Uint8Array` rather than `Blob`/`File`: the handover is a value that crosses an Electron IPC
 * boundary and must survive structured cloning and a JSON-shaped backup envelope without a second
 * copy, and the driver copies it into its own storage exactly once (move-import, D-16).
 */
export interface LegacyHandoverFile {
  /** Path or name, as the legacy record had it. A MMD texture keeps its relative path here. */
  name: string
  mimeType?: string
  bytes: Uint8Array
}

/** A companion asset such as an MMD texture map entry, with its own tombstone flag. */
export interface LegacyHandoverAsset extends LegacyHandoverFile {
  /** The legacy key the asset was stored under (AIRI's own name, not a driver's). */
  key: string
  /** The legacy record remembered this asset as deleted; the driver must not resurrect it. */
  deleted?: boolean
}

/** Placement, in AIRI's legacy model space. */
export interface LegacyHandoverPlacement {
  x: number
  y: number
  scale: number
}

/**
 * The legacy label and metadata of one model.
 *
 * Needed because migration's import **is** the create (D8): there is no pre-registered host record,
 * so the host record is written from the import result plus these values. `preview` and author are
 * deliberately absent — AIRI collects those itself, separately, and a driver re-derives capability
 * lists rather than receiving them.
 */
export interface LegacyHandoverMeta {
  name: string
  nsfw?: boolean
  groups?: string[]
  tags?: string[]
  /** Inputs the legacy catalog filter was built from; the host rebuilds `searchKey` from them. */
  searchKeyInputs?: string[]
}

/**
 * The window-global settings that described one model at collection time.
 *
 * Some legacy values are not per-model — one parameter override map, one expression-alias table,
 * applied to whichever model happened to be on screen. Without `selectedModelId` a driver could only
 * guess which model they described, and guessing would attach them to the wrong one.
 */
export interface LegacyHandoverSettings {
  selectedModelId?: string
  values: Record<string, unknown>
}

/**
 * One model handed to a driver, once.
 *
 * Idempotent: the host may send an identical entry again after a crash between the driver's write
 * and the host's marker, so a driver MUST absorb a repeat as a no-op. The adapter has already minted
 * `modelId` when this is built, so the entry names the identity the import will commit under and the
 * driver never mints one.
 */
export interface ModelDriverLegacyHandoverEntry {
  schemaVersion: typeof LEGACY_HANDOVER_SCHEMA_VERSION
  driverId: ModelDriverId
  createdAt: number
  /** Fresh, adapter-minted (D4): never the legacy id. */
  modelId: ModelId
  /**
   * The old `DisplayModel.id`.
   *
   * Provenance, not identity: it is what a revert restores the card's frozen `modules.displayModelId`
   * to, and it is what the host matches cards on when it writes their bindings. It is never adopted
   * as `modelId` (D4, D18).
   */
  legacyModelId: string
  meta: LegacyHandoverMeta
  /** Window-global values at collection time, plus the model they described. */
  settings: LegacyHandoverSettings
  /** Per-model settings, raw and uninterpreted. */
  values?: Record<string, unknown>
  placement?: LegacyHandoverPlacement
  /** Legacy outfits. Converted by the driver, never by the host (D14, D-9). */
  outfits?: unknown[]
  /** `acting.modelExpressionPrompt` as it stood at cutover; frozen, never restored (D10). */
  prompt?: string
  /** The model bytes: one file for a single-file format, model plus textures for a package. */
  files?: LegacyHandoverFile[]
  /** A URL/preset model: nothing to copy, and the driver decides whether it can hold one. */
  url?: string
  /** Companion assets carried beside the model bytes. */
  assets?: LegacyHandoverAsset[]
}

/**
 * What the driver did with a handover.
 *
 * `retained` is the whole gate: a driver that drops the payload reports `false`, and the host then
 * writes **no** `model-migration` marker — the model stays legacy-shaped and the driver never
 * completes (D8). A `true` means the bytes are in the driver's own storage and a later revert can
 * emit them from there.
 *
 * There is deliberately no `absorbed` boolean and no per-driver aggregate: "did this model transfer"
 * is `retained`, and "did the whole driver transfer" is the presence of a marker per model.
 */
export interface ModelDriverLegacyHandoverReport {
  /** The driver kept the payload in its own storage. */
  retained: boolean
  /** Legacy keys or values the driver did not interpret; the host keeps those alive. */
  unused?: string[]
  /** Non-fatal problems worth surfacing; everything not named here was absorbed. */
  warnings?: string[]
}

/**
 * One model's retained legacy entry, handed back for a revert.
 *
 * The mirror of `ModelDriverLegacyHandoverEntry`, produced by the driver from its own storage. It
 * carries the **legacy id** so the legacy import can recreate the record under the preserved
 * identity, and the same opaque members the handover carried so the legacy path renders again.
 *
 * Opaque to the RFC in exactly the same way: the host writes what it is given and interprets none
 * of `values`, `outfits`, `files`, `assets`, `prompt` or `url`.
 */
export interface LegacyRestorePayload {
  schemaVersion: typeof LEGACY_HANDOVER_SCHEMA_VERSION
  driverId: ModelDriverId
  /** The model the driver retained this entry for. */
  modelId: ModelId
  /** The identity the legacy record must be recreated under. */
  legacyModelId: string
  meta: LegacyHandoverMeta
  values?: Record<string, unknown>
  placement?: LegacyHandoverPlacement
  outfits?: unknown[]
  prompt?: string
  files?: LegacyHandoverFile[]
  url?: string
  assets?: LegacyHandoverAsset[]
}
