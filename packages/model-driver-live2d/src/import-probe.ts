/**
 * Reading a Live2D `.zip` without rendering it.
 *
 * This is the whole of `probe`'s format work: the driver reports what it found (a settings file, expressions,
 * motion groups, hit areas) and hands back the commit callback. Nothing here touches Pixi — the model is parsed
 * for real only when a mount loads it, which is what keeps `capabilityDiscovery: 'static'` honest.
 */
import type { ContractResult, ModelConfirmOptions, ModelDriverId, ModelId, ModelImportCommit, ModelImportCommitEntry, ModelImportSelection, ModelProbeInput, ModelProbeResult } from '@proj-airi/stage-renderer-sdk'
import type { HostStorageInterface } from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DModel, StoredLive2DMotion } from './storage'

import JSZip from 'jszip'

import { ContractFailureCode } from '@proj-airi/stage-renderer-sdk'

import { bytesToBase64, writeModelBytes, writeModelRecord, writeProfile } from './storage'

const ok = <T>(value: T): ContractResult<T> => ({ ok: true, value })
const fail = (code: ContractFailureCode, message: string): ContractResult<never> => ({ ok: false, error: { code, message } })

export interface Live2DArchiveInspection {
  settingsFile: string | null
  name: string
  expressions: Array<{ key: string, label: string }>
  motions: StoredLive2DMotion[]
  hitAreas: string[]
}

function isMacOSJunk(path: string): boolean {
  const parts = path.split('/')
  return parts.some(part => part === '__MACOSX' || part.startsWith('._') || part === '.DS_Store')
}

function isSettingsPath(path: string): boolean {
  return path.endsWith('.model3.json') || path.endsWith('.model.json')
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/** Case-insensitive lookup of one archive entry, because exports disagree on capitalisation. */
function findEntry(reader: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = reader.file(path)
  if (direct)
    return direct
  const lower = path.toLowerCase()
  const match = Object.keys(reader.files).find(key => key.toLowerCase() === lower && !reader.files[key].dir)
  return match ? reader.file(match) : null
}

/**
 * Inspect one archive.
 *
 * Reads the first settings file it finds (`model3.json` preferred implicitly by archive order), then reports the
 * declared expressions, motion groups and hit areas. A damaged or non-Live2D archive fails with a readable
 * reason rather than a thrown error, because `probe` is the one place a user meets a bad file.
 */
export async function inspectLive2DArchive(file: File): Promise<ContractResult<Live2DArchiveInspection>> {
  let reader: JSZip
  try {
    reader = await JSZip.loadAsync(await file.arrayBuffer())
  }
  catch (error) {
    return fail(ContractFailureCode.UNSUPPORTED_INPUT, `Not a readable zip archive: ${error instanceof Error ? error.message : String(error)}`)
  }

  const paths = Object.keys(reader.files).filter(path => !isMacOSJunk(path) && !reader.files[path].dir)
  const settingsFile = paths.find(isSettingsPath) ?? null
  if (!settingsFile)
    return fail(ContractFailureCode.UNSUPPORTED_INPUT, 'No `.model3.json` settings file in the archive; Live2D imports require one')

  const entry = findEntry(reader, settingsFile)
  if (!entry)
    return fail(ContractFailureCode.ASSET_MISSING, `The settings file \`${settingsFile}\` disappeared from the archive`)

  let settings: Record<string, any>
  try {
    settings = JSON.parse(await entry.async('text'))
  }
  catch (error) {
    return fail(ContractFailureCode.UNSUPPORTED_INPUT, `The settings file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const references = settings.FileReferences ?? settings.fileReferences ?? {}
  if (!references.Moc && !references.moc)
    return fail(ContractFailureCode.UNSUPPORTED_INPUT, 'The settings file declares no `.moc3` file; this archive is not a Cubism 4 model')

  const expressions: Array<{ key: string, label: string }> = []
  for (const expression of references.Expressions ?? references.expressions ?? []) {
    const rawName = typeof expression?.Name === 'string' ? expression.Name : undefined
    const rawFile = typeof expression?.File === 'string' ? expression.File : undefined
    const key = rawName ?? (rawFile ? basename(rawFile).replace(/\.exp3?\.json$/i, '') : undefined)
    if (!key)
      continue
    if (!expressions.some(item => item.key === key))
      expressions.push({ key, label: rawName ?? key })
  }

  const motions: StoredLive2DMotion[] = []
  const groups = references.Motions ?? references.motions ?? {}
  for (const [group, definitions] of Object.entries(groups)) {
    if (!Array.isArray(definitions))
      continue
    definitions.forEach((_definition, index) => {
      motions.push({ key: `${group}#${index}`, group, index })
    })
  }

  const hitAreas: string[] = []
  for (const area of settings.HitAreas ?? []) {
    if (typeof area?.Name === 'string' && !hitAreas.includes(area.Name))
      hitAreas.push(area.Name)
  }

  return ok({
    settingsFile,
    name: file.name.replace(/\.zip$/i, ''),
    expressions,
    motions,
    hitAreas,
  })
}

export interface Live2DProbeOptions {
  input: ModelProbeInput
  storage: HostStorageInterface
  driverId: ModelDriverId
  /** Called after a committed import, so the manager can be told to pull rows again. */
  notify: () => void
}

/**
 * `ModelProvider.probe` for this driver.
 *
 * The input is one archive (Live2D's distributable shape). A selection carries the adapter-minted ids; the
 * driver never invents one, and each selected entry settles independently (C21).
 */
export async function probeLive2DArchive(options: Live2DProbeOptions): Promise<ContractResult<ModelProbeResult>> {
  const archive = options.input.files.length === 1 ? options.input.files[0] : undefined
  if (!archive || !archive.name.toLowerCase().endsWith('.zip')) {
    return ok({
      confidence: 0,
      parts: [],
      blockingFindings: ['Live2D import expects a single `.zip` archive'],
      // Required by the shape even though `parts` is empty and there is nothing to select: a probe that cannot read
      // an input still answers with the commit callback, and the commit refuses with the same finding.
      confirmImport: () => Promise.resolve<ContractResult<ModelImportCommit>>(fail(ContractFailureCode.UNSUPPORTED_INPUT, 'Live2D import expects a single `.zip` archive')),
    })
  }

  const inspected = await inspectLive2DArchive(archive)
  if (!inspected.ok)
    return inspected

  const inspection = inspected.value
  const commit = (confirm: ModelConfirmOptions): Promise<ContractResult<ModelImportCommit>> =>
    commitLive2DImport({
      archive,
      inspection,
      storage: options.storage,
      driverId: options.driverId,
      selections: confirm.selections,
      notify: options.notify,
    })

  return ok({
    confidence: 1,
    name: inspection.name,
    parts: [{
      partIndex: 0,
      name: inspection.name,
      meta: { format: 'live2d-zip', sizeBytes: archive.size },
    }],
    confirmImport: commit,
  })
}

interface CommitOptions {
  archive: File
  inspection: Live2DArchiveInspection
  storage: HostStorageInterface
  driverId: ModelDriverId
  selections: ModelImportSelection[]
  notify: () => void
}

async function commitLive2DImport(options: CommitOptions): Promise<ContractResult<ModelImportCommit>> {
  const { archive, inspection, storage, driverId, selections, notify } = options
  const bytes = new Uint8Array(await archive.arrayBuffer())
  const encoded = bytesToBase64(bytes)
  const entries: ModelImportCommitEntry[] = []

  for (const selection of selections) {
    try {
      const record: StoredLive2DModel = {
        modelId: selection.modelId,
        name: selection.name ?? inspection.name,
        importedAt: Date.now(),
        byteSize: archive.size,
        settingsFile: inspection.settingsFile,
        profiles: [{ profileId: selection.profileId, name: 'Default' }],
        expressions: inspection.expressions,
        motions: inspection.motions,
        hitAreas: inspection.hitAreas,
      }
      // Write the record last: a half-written import that never appears in `listModels` is the safe failure.
      await writeModelBytes(storage, selection.modelId, encoded)
      await writeProfile(storage, selection.modelId, {
        profileId: selection.profileId,
        name: 'Default',
        body: {},
      })
      await writeModelRecord(storage, record)

      entries.push({
        selection,
        result: ok({
          modelDriverId: driverId,
          modelId: selection.modelId,
          name: record.name,
          importedAt: record.importedAt,
          byteSize: record.byteSize,
          meta: { settingsFile: record.settingsFile },
        }),
      })
    }
    catch (error) {
      entries.push({
        selection,
        result: fail(ContractFailureCode.INTERNAL, `Could not store the Live2D model: ${error instanceof Error ? error.message : String(error)}`),
      })
    }
  }

  notify()
  return ok({ entries })
}

/**
 * The one-call import a driver surface (today: the dev route) uses.
 *
 * Mints nothing: the caller passes ids the host minted, exactly as the two-phase import does, so this helper is
 * convenience over the same commit path rather than a second import implementation.
 */
export async function importLive2DArchive(options: {
  file: File
  storage: HostStorageInterface
  driverId: ModelDriverId
  modelId: ModelId
  profileId: string
  notify: () => void
}): Promise<ContractResult<{ name: string }>> {
  const inspected = await inspectLive2DArchive(options.file)
  if (!inspected.ok)
    return inspected

  const commit = await commitLive2DImport({
    archive: options.file,
    inspection: inspected.value,
    storage: options.storage,
    driverId: options.driverId,
    selections: [{ partIndex: 0, modelId: options.modelId, profileId: options.profileId, name: inspected.value.name }],
    notify: options.notify,
  })
  if (!commit.ok)
    return commit

  const entry = commit.value.entries[0]
  if (!entry || !entry.result.ok)
    return entry?.result ?? fail(ContractFailureCode.INTERNAL, 'The import committed no entry')

  return ok({ name: inspected.value.name })
}
