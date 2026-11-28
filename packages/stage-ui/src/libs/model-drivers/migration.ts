/**
 * The migration service: a user-requested run, one model per pass, over ports (§5.9, D13, D17).
 *
 * **Migration is an action, not a launch-time queue.** Nothing moves until the user asks, declining leaves every
 * character untouched, and a partial result is a terminal state rather than a failure to undo (D13).
 *
 * The service is deliberately a runner over ports rather than a store method:
 *
 *   - it runs in the shared background window on desktop and in the page on Web/Pocket, so it cannot depend on
 *     this window's Pinia stores or on anything Electron-shaped;
 *   - every model is **one pass**: a handover built lazily (one model's bytes in memory), the driver's `migrate`,
 *     a host import, and one commit transaction (§6.5). Nothing is held across iterations;
 *   - it resumes: a model another (crashed) attempt already imported is found through `findImportedModel`, which
 *     is the check-then-skip of §6.5 step 4, and its commit is replayed idempotently;
 *   - it parks instead of failing: a refusal, a `retained: false` or a failed import leaves that model on the
 *     legacy path with a reason, and the run continues to the next one. Every committed model stands.
 *
 * **The storage gate is arithmetic, applied before the driver's first import** (D17). Normal mode needs the whole
 * legacy library's size free; progressive mode needs only the largest model's imported size, because each legacy
 * copy is deleted at its own commit. When the estimate is unavailable the app says so, defaults to progressive —
 * the smallest footprint — and lets the user switch; it never silently guesses.
 */
import type {
  ContractResult,
  LegacyHandoverMeta,
  ModelDriverLegacyHandoverEntry,
  ModelDriverLegacyHandoverReport,
  ModelId,
  ModelProfileId,
} from '@proj-airi/stage-renderer-sdk'

/** Which deletion policy the user chose for this run. Never assumed; progressive is only a *recommendation*. */
export type MigrationMode = 'normal' | 'progressive'

/** One legacy model, as the queue sees it. No bytes: those are collected lazily when the model is reached. */
export interface LegacyModelRow {
  legacyModelId: string
  name: string
  nsfw?: boolean
  groups?: string[]
  tags?: string[]
  searchKeyInputs?: string[]
  /** Whether a character card still binds it. Character-bound models go first. */
  characterBound: boolean
  /** The legacy copy's size on disk, used as the fallback estimate. */
  legacyByteSize: number
  /** The driver's declared post-import size (D-18), which the gate prefers over the compressed legacy size. */
  estimatedImportByteSize?: number
}

export interface MigrationStorageFacts {
  quota: number
  usage: number
}

export interface StorageGateVerdict {
  ok: boolean
  mode: MigrationMode
  /** Whether the app could measure free space at all. */
  measurable: boolean
  free?: number
  required?: number
  /** The model the requirement came from, for progressive mode and the "this cannot ever fit" report. */
  largest?: { legacyModelId: string, name: string, required: number }
  reason?: 'insufficient-space' | 'estimate-unavailable'
  /** When it cannot measure, the mode the app should default to — progressive, the smallest footprint (D17). */
  recommendation?: MigrationMode
  /** A readable sentence the surface shows. */
  message: string
}

/**
 * Decide whether this driver can be migrated in this mode.
 *
 * Both modes are computed even though only one is required: the failure message has to be able to say "progressive
 * would fit" — that is the difference between "free space" and "free space, or delete as you go", which is what
 * the user chooses between.
 */
export function assessMigrationStorage(input: {
  mode: MigrationMode
  estimate: MigrationStorageFacts | undefined
  rows: readonly LegacyModelRow[]
}): StorageGateVerdict {
  if (!input.estimate) {
    return {
      ok: input.mode === 'progressive',
      mode: input.mode,
      measurable: false,
      reason: 'estimate-unavailable',
      recommendation: 'progressive',
      message: 'This device cannot report free space, so this app cannot tell you whether the migration fits. Progressive deletion — which removes each legacy copy as its model is committed — is the smallest footprint and is recommended; you can switch at any time.',
    }
  }

  const free = Math.max(0, input.estimate.quota - input.estimate.usage)
  const normalRequired = input.rows.reduce((total, row) => total + row.legacyByteSize, 0)
  const largest = input.rows.reduce<LegacyModelRow | undefined>((worst, row) => {
    if (!worst)
      return row
    return importSizeOf(row) > importSizeOf(worst) ? row : worst
  }, undefined)
  const progressiveRequired = largest ? importSizeOf(largest) : 0
  const required = input.mode === 'normal' ? normalRequired : progressiveRequired

  if (free >= required) {
    return {
      ok: true,
      mode: input.mode,
      measurable: true,
      free,
      required,
      ...(largest ? { largest: { legacyModelId: largest.legacyModelId, name: largest.name, required: importSizeOf(largest) } } : {}),
      message: input.mode === 'normal'
        ? `${formatBytes(required)} of free space is needed; this device has ${formatBytes(free)}.`
        : `The largest model needs ${formatBytes(required)} of free space; this device has ${formatBytes(free)}.`,
    }
  }

  const progressiveWouldFit = free >= progressiveRequired
  return {
    ok: false,
    mode: input.mode,
    measurable: true,
    free,
    required,
    ...(largest ? { largest: { legacyModelId: largest.legacyModelId, name: largest.name, required: importSizeOf(largest) } } : {}),
    reason: 'insufficient-space',
    recommendation: progressiveWouldFit && input.mode === 'normal' ? 'progressive' : undefined,
    message: input.mode === 'normal'
      ? `${formatBytes(required)} of free space is needed and only ${formatBytes(free)} is available.${progressiveWouldFit ? ' Enabling progressive deletion would fit.' : ''}`
      : `The largest model needs ${formatBytes(required)} and only ${formatBytes(free)} is available, so it can never be migrated on this device until space is freed.`,
  }
}

/** The gate prefers the driver's declared import size over the compressed legacy archive (D-18). */
export function importSizeOf(row: LegacyModelRow): number {
  return row.estimatedImportByteSize ?? row.legacyByteSize
}

/** What the runner may do. Every member is supplied by the app; none of them is a store the runner owns. */
export interface MigrationPorts {
  /** Every legacy model of this driver, as the collector sees them. Character-bound ones are ordered first here. */
  listLegacyModels: () => Promise<LegacyModelRow[]>
  /**
   * Whether the driver already holds a model imported from this legacy id.
   *
   * This is the *resume* path: the driver retains the legacy id inside its handover, so a crashed attempt is found
   * before minting a second identity for the same asset (§6.5 step 4).
   */
  findImportedModel: (legacyModelId: string) => Promise<{ modelId: ModelId, profileId: ModelProfileId } | undefined>
  mintModelId: () => ModelId
  mintProfileId: () => ModelProfileId
  /** Build one model's handover. The bytes are collected here and nowhere earlier (D8, D17). */
  buildHandover: (input: {
    modelId: ModelId
    profileId: ModelProfileId
    row: LegacyModelRow
  }) => Promise<Omit<ModelDriverLegacyHandoverEntry, 'schemaVersion' | 'driverId' | 'createdAt'>>
  /** Hand it to the driver. A refusal or `retained: false` parks the model; it never stops the run. */
  migrate: (entry: ModelDriverLegacyHandoverEntry) => Promise<ContractResult<ModelDriverLegacyHandoverReport>>
  /**
   * The import round trip for one model: probe/probe-equivalent size check, then `confirmImport` without
   * `overwrite` — the import *is* the create (D8). The driver consumes its retained payload by reference.
   */
  importModel: (input: {
    modelId: ModelId
    profileId: ModelProfileId
    row: LegacyModelRow
  }) => Promise<ContractResult<void>>
  /**
   * The one host transaction: records, profile, the card bindings for every card that still names the legacy id,
   * and `model-migration/{modelId}` (§6.5 step 5). Idempotent, so a resumed model can replay it.
   */
  commit: (input: {
    modelId: ModelId
    profileId: ModelProfileId
    row: LegacyModelRow
    /** The meta the handover carried, which is what the host record is written from. */
    meta: LegacyHandoverMeta
  }) => Promise<ContractResult<void>>
  /** Progressive deletion: remove this model's legacy copy now that its commit stands. */
  deleteLegacyCopy: (legacyModelId: string) => Promise<ContractResult<void> | void>
  hasModelMarker: (modelId: ModelId) => Promise<boolean>
  hasDriverMarker: () => Promise<boolean>
  /** Written once every known legacy model of the driver has a marker (D8 completeness). */
  writeDriverMarker: () => Promise<void>
  estimateStorage: () => Promise<MigrationStorageFacts | undefined>
}

export type MigrationOutcomeStatus = 'migrated' | 'resumed' | 'parked'

export interface MigrationModelOutcome {
  legacyModelId: string
  name: string
  status: MigrationOutcomeStatus
  modelId?: ModelId
  /** Why it was parked, for the "needs attention" badge. */
  reason?: 'driver-refused' | 'retained-false' | 'import-failed' | 'commit-failed' | 'quota'
  message?: string
  /** A progressive-deletion failure: the model migrated, the legacy copy remains — always the safe direction. */
  warning?: string
}

export interface MigrationReport {
  driverId: string
  mode: MigrationMode
  gate: StorageGateVerdict
  /** The driver never started because the gate blocked it, or it is already complete. */
  blocked: boolean
  alreadyComplete: boolean
  total: number
  migrated: number
  parked: number
  results: MigrationModelOutcome[]
  /** Every model of this driver transferred. Only then is the driver's terminal marker written. */
  complete: boolean
  /** Some models stayed legacy-shaped; terminal, never rolled back (D13). */
  partial: boolean
  driverMarkerWritten: boolean
  /** `N of M`, the one number Settings → Data shows. */
  summary: string
}

export interface MigrationRunInput {
  driverId: string
  mode: MigrationMode
  ports: MigrationPorts
  /** Called after each model, for the progress surface. */
  onProgress?: (report: MigrationReport) => void
  /** Asked between models; a quit or a crash stops the loop with what committed left committed. */
  shouldStop?: () => boolean
}

/** Order the queue: character-bound models first, then the rest, both stable by name. */
export function orderMigrationQueue(rows: readonly LegacyModelRow[]): LegacyModelRow[] {
  return [...rows].sort((left, right) => {
    if (left.characterBound !== right.characterBound)
      return left.characterBound ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}

/**
 * Run one driver's migration.
 *
 * Nothing here decides *whether* to run — that is the user's answer to the screen — and nothing here retries a
 * park: the next run picks the parked models up again, which is why the queue is rebuilt from the legacy
 * collector rather than from the previous run's report.
 */
export async function runDriverMigration(input: MigrationRunInput): Promise<MigrationReport> {
  const { driverId, mode, ports } = input

  if (await ports.hasDriverMarker()) {
    return done({
      driverId,
      mode,
      gate: idleGate(mode, 'Every model of this driver has already been migrated.'),
      blocked: false,
      alreadyComplete: true,
      total: 0,
      results: [],
      driverMarkerWritten: true,
    })
  }

  const rows = orderMigrationQueue(await ports.listLegacyModels())
  const gate = assessMigrationStorage({ mode, estimate: await ports.estimateStorage(), rows })

  if (!gate.ok) {
    // Blocked before the driver's first import: nothing is created, so the failure costs nothing (D17).
    return done({
      driverId,
      mode,
      gate,
      blocked: true,
      alreadyComplete: false,
      total: rows.length,
      results: [],
      driverMarkerWritten: false,
    })
  }

  const results: MigrationModelOutcome[] = []

  for (const row of rows) {
    if (input.shouldStop?.())
      break

    results.push(await migrateOne({ ports, row, driverId, mode }))
    input.onProgress?.(buildReport({ driverId, mode, gate, total: rows.length, results, driverMarkerWritten: false }))
  }

  const complete = results.length === rows.length && results.every(result => result.status !== 'parked')
  if (complete)
    await ports.writeDriverMarker()

  const report = buildReport({
    driverId,
    mode,
    gate,
    total: rows.length,
    results,
    driverMarkerWritten: complete,
  })
  input.onProgress?.(report)
  return report
}

async function migrateOne(input: {
  ports: MigrationPorts
  row: LegacyModelRow
  driverId: string
  mode: MigrationMode
}): Promise<MigrationModelOutcome> {
  const { ports, row, driverId, mode } = input

  // Resume: a previous attempt may have imported this model and died before the marker. Replaying the commit is
  // what finishes it, and no second identity is minted for the same asset.
  const existing = await ports.findImportedModel(row.legacyModelId)
  if (existing) {
    const commit = await ports.commit({
      modelId: existing.modelId,
      profileId: existing.profileId,
      row,
      meta: metaOf(row),
    })
    if (!commit.ok)
      return parked(row, 'commit-failed', commit.error.message, existing.modelId)

    const warning = await maybeDeleteLegacy({ ports, row, mode })
    return { legacyModelId: row.legacyModelId, name: row.name, status: 'resumed', modelId: existing.modelId, ...(warning ? { warning } : {}) }
  }

  const modelId = ports.mintModelId()
  const profileId = ports.mintProfileId()
  const handover = await ports.buildHandover({ modelId, profileId, row })

  const entry: ModelDriverLegacyHandoverEntry = {
    schemaVersion: 1,
    driverId,
    createdAt: Date.now(),
    ...handover,
    modelId,
  }

  const migrated = await ports.migrate(entry)
  if (!migrated.ok)
    return parked(row, 'driver-refused', migrated.error.message, modelId)
  if (!migrated.value.retained) {
    // The driver kept nothing, so a revert could not restore this model. No marker, nothing deleted (D8).
    return parked(row, 'retained-false', 'The driver did not retain the migration payload, so it cannot be reverted', modelId)
  }

  const imported = await ports.importModel({ modelId, profileId, row })
  if (!imported.ok) {
    // Failure pattern 3: a shortfall mid-run parks this model and leaves every committed model standing. The
    // contract has no dedicated quota code, so the reason is read from the driver's own message rather than
    // invented — a heuristic, and labelled as one where it is used.
    const quota = /quota|space|storage/i.test(imported.error.message)
    return parked(row, quota ? 'quota' : 'import-failed', imported.error.message, modelId)
  }

  const commit = await ports.commit({ modelId, profileId, row, meta: metaOf(row) })
  if (!commit.ok)
    return parked(row, 'commit-failed', commit.error.message, modelId)

  const warning = await maybeDeleteLegacy({ ports, row, mode })
  return { legacyModelId: row.legacyModelId, name: row.name, status: 'migrated', modelId, ...(warning ? { warning } : {}) }
}

/**
 * Delete the legacy copy when the policy is progressive.
 *
 * A failure here is a warning, never a park: the model is committed either way, and the copy remaining is always
 * the safe direction (failure pattern 5).
 */
async function maybeDeleteLegacy(input: {
  ports: MigrationPorts
  row: LegacyModelRow
  mode: MigrationMode
}): Promise<string | undefined> {
  if (input.mode !== 'progressive')
    return undefined

  try {
    const result = await input.ports.deleteLegacyCopy(input.row.legacyModelId)
    if (result && 'ok' in result && !result.ok)
      return `The legacy copy could not be deleted: ${result.error.message}`
  }
  catch (error) {
    return `The legacy copy could not be deleted: ${error instanceof Error ? error.message : String(error)}`
  }
  return undefined
}

function metaOf(row: LegacyModelRow): LegacyHandoverMeta {
  return {
    name: row.name,
    ...(row.nsfw !== undefined ? { nsfw: row.nsfw } : {}),
    ...(row.groups ? { groups: row.groups } : {}),
    ...(row.tags ? { tags: row.tags } : {}),
    ...(row.searchKeyInputs ? { searchKeyInputs: row.searchKeyInputs } : {}),
  }
}

function parked(row: LegacyModelRow, reason: NonNullable<MigrationModelOutcome['reason']>, message: string, modelId: ModelId): MigrationModelOutcome {
  return { legacyModelId: row.legacyModelId, name: row.name, status: 'parked', modelId, reason, message }
}

function idleGate(mode: MigrationMode, message: string): StorageGateVerdict {
  return { ok: true, mode, measurable: true, message }
}

function buildReport(input: {
  driverId: string
  mode: MigrationMode
  gate: StorageGateVerdict
  total: number
  results: MigrationModelOutcome[]
  driverMarkerWritten: boolean
}): MigrationReport {
  const migrated = input.results.filter(result => result.status !== 'parked').length
  const parked = input.results.filter(result => result.status === 'parked').length
  const complete = input.results.length === input.total && parked === 0

  return {
    driverId: input.driverId,
    mode: input.mode,
    gate: input.gate,
    blocked: false,
    alreadyComplete: false,
    total: input.total,
    migrated,
    parked,
    results: input.results,
    complete,
    partial: parked > 0 || input.results.length < input.total,
    driverMarkerWritten: input.driverMarkerWritten,
    summary: `${migrated} of ${input.total}`,
  }
}

function done(input: {
  driverId: string
  mode: MigrationMode
  gate: StorageGateVerdict
  blocked: boolean
  alreadyComplete: boolean
  total: number
  results: MigrationModelOutcome[]
  driverMarkerWritten: boolean
}): MigrationReport {
  return {
    driverId: input.driverId,
    mode: input.mode,
    gate: input.gate,
    blocked: input.blocked,
    alreadyComplete: input.alreadyComplete,
    total: input.total,
    migrated: input.results.filter(result => result.status !== 'parked').length,
    parked: input.results.filter(result => result.status === 'parked').length,
    results: input.results,
    complete: input.alreadyComplete || (input.results.length === input.total && input.results.every(result => result.status !== 'parked')),
    partial: false,
    driverMarkerWritten: input.driverMarkerWritten,
    summary: `${input.results.filter(result => result.status !== 'parked').length} of ${input.total}`,
  }
}

/** `16.4 MB`, the unit the storage screen shows. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
