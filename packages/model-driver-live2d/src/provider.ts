/**
 * The Live2D provider entry: the driver's renderer half (RFC 0002 §5.10, §10.2).
 *
 * The adapter starts this module in a window with `startProviderEntry`. It owns the driver's storage, answers the
 * manager's calls over the opaque channel, and is where mounts register so a `deliver` can reach them. The
 * renderer that actually draws Live2D is `./mount`; nothing here imports Pixi, so starting an entry never costs a
 * WebGL context.
 */
import type {
  ContractResult,
  CueAck,
  CueEnvelope,
  CueOutcome,
  CueWithdrawalReport,
  DriverEntryStartOptions,
  DriverProviderEntry,
  HostServices,
  HostStorageInterface,
  ModelCapabilityDescriptor,
  ModelDescriptor,
  ModelDriverRuntime,
  ModelId,
  ModelProfileDescriptor,
  ModelProfileId,
  ModelProfileSaveOptions,
  ModelProvider,
  ModelSummary,
  MountCommand,
  MountCommandAnswer,
  MountQuery,
  MountQueryAnswer,
  MountSelection,
  Unsubscribe,
} from '@proj-airi/stage-renderer-sdk'

import type { Live2DManagerCall, Live2DProviderReply } from './protocol'
import type { StoredLive2DModel } from './storage'

import {
  ActTokenKind,
  ContractFailureCode,
  CueRejection,
  ModelCapabilityKind,
  ModelProfileSaveMode,
} from '@proj-airi/stage-renderer-sdk'

import { importLive2DArchive, probeLive2DArchive } from './import-probe'
import { migrateLive2DEntry, removeRetainedLegacyEntry, restoreLive2DLegacyPayload } from './legacy'
import { LIVE2D_CAPABILITIES, LIVE2D_DRIVER_ID, LIVE2D_MANIFEST } from './manifest'
import {
  publishAllLive2DPrompts,
  publishLive2DPrompt,
  publishPromptsForCommittedModels,
  recordPromptResolution,
  removeStoredPrompt,
} from './prompt'
import { isLive2DManagerCall } from './protocol'
import { live2dSession } from './session'
import {
  listModelRecords,
  purgeAll,
  readModelRecord,
  readProfile,
  removeModelRecord,
  removeProfile as removeStoredProfile,
  writeModelRecord,
  writeProfile,
} from './storage'

const ok = <T>(value: T): ContractResult<T> => ({ ok: true, value })
const fail = (code: ContractFailureCode, message: string): ContractResult<never> => ({ ok: false, error: { code, message } })

const NO_STORAGE = 'The Live2D provider entry is not activated in this window'

function storage(): HostStorageInterface | undefined {
  return live2dSession.hostServices()?.storage
}

function requireStorage(): HostStorageInterface {
  const value = storage()
  if (!value)
    throw new Error(NO_STORAGE)
  return value
}

function descriptorFor(record: StoredLive2DModel): ModelDescriptor {
  return {
    modelDriverId: LIVE2D_DRIVER_ID,
    modelId: record.modelId,
    name: record.name,
    importedAt: record.importedAt,
    ...(record.authorName ? { author: { name: record.authorName } } : {}),
    byteSize: record.byteSize,
    meta: { settingsFile: record.settingsFile },
  }
}

function rowsFor(records: StoredLive2DModel[]): ModelSummary[] {
  return records.flatMap(record => record.profiles.map(profile => ({
    modelDriverId: LIVE2D_DRIVER_ID,
    modelId: record.modelId,
    profileId: profile.profileId,
    name: record.name,
    profileName: profile.name,
    ...(record.authorName ? { author: { name: record.authorName } } : {}),
    // The mount wrote this once it had rendered the model (D-8); a row without one is a model nobody has seen yet.
    ...(record.preview ? { preview: record.preview } : {}),
    byteSize: record.byteSize,
    importedAt: record.importedAt,
  })))
}

function capabilitiesFor(record: StoredLive2DModel): ModelCapabilityDescriptor[] {
  return [
    ...record.expressions.map(expression => ({
      key: expression.key,
      kind: ModelCapabilityKind.EXPRESSION,
      label: expression.label,
    })),
    ...record.motions.map(motion => ({
      key: motion.key,
      kind: ModelCapabilityKind.MOTION,
      label: `${motion.group} #${motion.index}`,
      group: [motion.group],
    })),
    ...record.hitAreas.map(area => ({
      key: area,
      kind: ModelCapabilityKind.POINT_OF_INTEREST,
      label: area,
    })),
  ]
}

const provider: ModelProvider = {
  modelDriverId: LIVE2D_DRIVER_ID,

  async list(): Promise<ContractResult<ModelDescriptor[]>> {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
    const records = await listModelRecords(store)
    return ok(records.map(descriptorFor))
  },

  async remove(modelId) {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
    // Idempotent success: removing what is already gone is the outcome the caller asked for. The retained legacy entry
    // goes with the model — an explicit deletion leaves nothing to revert to, and keeping hidden bytes would make the
    // deletion a lie.
    await removeModelRecord(store, modelId)
    await removeRetainedLegacyEntry(store, modelId)
    live2dSession.notifyModelsChanged()
    return ok(undefined)
  },

  async probe(input) {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
    const probed = await probeLive2DArchive({
      input,
      storage: store,
      driverId: LIVE2D_DRIVER_ID,
      notify: () => live2dSession.notifyModelsChanged(),
    })
    if (!probed.ok)
      return probed

    // An import that commits ends with a publication for every imported profile: a prompt-capable driver holding a
    // model it has never spoken about is exactly the fault D-10 forbids, and it would surface the moment the user
    // opened the model's panel. Wrapping the commit keeps one code path — the two-phase import and the one-call
    // helper both go through this callback.
    const commit = probed.value.confirmImport
    return ok({
      ...probed.value,
      confirmImport: async (confirm) => {
        const committed = await commit(confirm)
        const services = live2dSession.hostServices()
        if (committed.ok && services) {
          await publishPromptsForCommittedModels(
            services,
            committed.value.entries.filter(entry => entry.result.ok).map(entry => entry.selection.modelId),
          )
        }
        return committed
      },
    })
  },

  async modelCapabilities(modelId) {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
    const record = await readModelRecord(store, modelId)
    // An unknown model is "nothing to enumerate", not a failure: the host never reads `ok: false` as "none".
    return ok(record ? capabilitiesFor(record) : [])
  },

  async vocabulary(modelId) {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
    const record = await readModelRecord(store, modelId)
    if (!record)
      return ok({ items: [] })
    return ok({
      items: [
        ...record.expressions.map(expression => ({
          key: expression.key,
          tokenKind: ActTokenKind.EMOTION,
          label: expression.label,
        })),
        ...record.motions.map(motion => ({
          key: motion.key,
          tokenKind: ActTokenKind.MOTION,
          label: `${motion.group} #${motion.index}`,
        })),
      ],
      instructions: 'Use ACT tokens to change the Live2D expression or play a motion.',
    })
  },

  async listProfiles(modelId): Promise<ContractResult<ModelProfileDescriptor[]>> {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
    const record = await readModelRecord(store, modelId)
    return ok(record ? record.profiles.map(profile => ({ profileId: profile.profileId, name: profile.name })) : [])
  },

  async saveProfile(modelId, profileId, options: ModelProfileSaveOptions) {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)

    const record = await readModelRecord(store, modelId)
    if (!record)
      return fail(ContractFailureCode.ASSET_MISSING, `No Live2D model \`${modelId}\``)

    const existing = await readProfile(store, modelId, profileId)
    if (options.mode === ModelProfileSaveMode.CREATE_IF_NOT_EXISTS && existing)
      return ok({ profileId, name: existing.name })

    const name = options.name ?? existing?.name ?? 'Default'
    await writeProfile(store, modelId, { profileId, name, body: existing?.body ?? {} })

    if (!record.profiles.some(profile => profile.profileId === profileId)) {
      record.profiles.push({ profileId, name })
      await writeModelRecord(store, record)
    }

    // A profile is a new address for a prompt, so it gets a publication now rather than a fault until the next
    // activation. No services means no entry in this window, and the next activation publishes instead.
    const services = live2dSession.hostServices()
    if (services)
      await publishLive2DPrompt({ services, record, profileId })

    // A profile is saveable with no mount: the body here is driver state, not a live renderer's state (D-9).
    return ok({ profileId, name })
  },

  async removeProfile(modelId, profileId) {
    const store = storage()
    if (!store)
      return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)

    await removeStoredProfile(store, modelId, profileId)
    // The prompt is per profile, so it goes with it rather than outliving the address it described (D5).
    await removeStoredPrompt(store, modelId, profileId)
    const record = await readModelRecord(store, modelId)
    if (record) {
      record.profiles = record.profiles.filter(profile => profile.profileId !== profileId)
      await writeModelRecord(store, record)
    }
    live2dSession.notifyModelsChanged()
    return ok(undefined)
  },
}

// -------------------------------------------------------------------------------------------------
// Cue delivery: the manager's `deliver` call, forwarded to this window's mounts
// -------------------------------------------------------------------------------------------------

async function deliver(envelope: CueEnvelope): Promise<ContractResult<CueAck>> {
  const targets = live2dSession.mountsFor(envelope.target.surface, envelope.target.purpose)
  if (targets.length === 0)
    return ok(rejectedAck(envelope))

  const merged: CueOutcome[] = envelope.cues.map(() => ({ status: 'rejected', reason: CueRejection.NO_TARGET }))
  let lastError: { code: ContractFailureCode, message: string } | undefined

  for (const target of targets) {
    let answer: ContractResult<CueAck>
    try {
      answer = await target.sink.handle(envelope)
    }
    catch (error) {
      return fail(ContractFailureCode.INTERNAL, `Live2D mount \`${target.mountId}\` threw while handling a cue: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!answer.ok) {
      lastError = answer.error
      continue
    }
    answer.value.results.forEach((outcome, index) => {
      // First resolved outcome wins per slot; a rejection from one mount does not hide another mount's work.
      if (outcome.status === 'resolved' || merged[index].status !== 'resolved')
        merged[index] = outcome
    })
  }

  if (merged.every(outcome => outcome.status === 'rejected') && lastError)
    return { ok: false, error: lastError }

  return ok({
    nonce: envelope.nonce,
    modelDriverId: LIVE2D_DRIVER_ID,
    ...(targets.length === 1 ? { mountId: targets[0].mountId } : {}),
    results: merged,
    handled: merged.every(outcome => outcome.status === 'resolved'),
  })
}

function rejectedAck(envelope: CueEnvelope): CueAck {
  return {
    nonce: envelope.nonce,
    modelDriverId: LIVE2D_DRIVER_ID,
    results: envelope.cues.map(() => ({ status: 'rejected', reason: CueRejection.NO_TARGET })),
    handled: false,
  }
}

function matches(mount: { surface: string, purpose: string }, selection: MountSelection): boolean {
  if (selection.surface !== undefined && mount.surface !== selection.surface)
    return false
  if (selection.purpose !== undefined && mount.purpose !== selection.purpose)
    return false
  return true
}

async function queryMount(selection: MountSelection, query: MountQuery): Promise<MountQueryAnswer[]> {
  return live2dSession.allMounts()
    .filter(mount => matches(mount, selection))
    .map((mount) => {
      if (query.kind === 'readiness')
        return { kind: 'readiness' as const, mountId: mount.mountId, readiness: mount.readiness() }
      if (query.kind === 'occupiesPoint')
        return { kind: 'occupiesPoint' as const, mountId: mount.mountId, occupies: mount.occupiesPoint(query.point) }
      return { kind: 'hitTest' as const, mountId: mount.mountId, area: mount.hitTest(query.point) }
    })
}

async function commandMount(selection: MountSelection, command: MountCommand): Promise<MountCommandAnswer[]> {
  const mounts = live2dSession.allMounts().filter(mount => matches(mount, selection))
  for (const mount of mounts) {
    if (command.kind === 'stopAll')
      mount.stopAll()
    else
      mount.dispose(command.strategy)
  }
  return mounts.map(mount => ({ mountId: mount.mountId }))
}

// -------------------------------------------------------------------------------------------------
// The entry
// -------------------------------------------------------------------------------------------------

/**
 * What the adapter calls for `@proj-airi/model-driver-live2d/provider`.
 *
 * The session is attached before the runtime activates so a call that arrives immediately after startup already
 * finds this window's storage; activation itself is reported through the runtime, not through this function.
 */
export function startProviderEntry(options: DriverEntryStartOptions): DriverProviderEntry {
  live2dSession.attach({ services: options.services, send: options.send })

  const runtime = createRuntime()
  void runtime.activate(options.services).then((report) => {
    if (!report.ok)
      options.services.log.error('live2d', 'Activation failed', report.error)
    else if (report.value.warnings?.length)
      options.services.log.warn('live2d', report.value.warnings.join('; '))
  })

  return {
    onMessage: (message) => {
      if (!isLive2DManagerCall(message))
        return
      void handleCall(message, options.send)
    },
    dispose() {
      live2dSession.detach()
    },
  }
}

async function handleCall(call: Live2DManagerCall, reply: (message: Live2DProviderReply) => void): Promise<void> {
  try {
    switch (call.method) {
      case 'list-models': {
        const store = storage()
        if (!store) {
          reply({ type: 'error', id: call.id, error: { code: ContractFailureCode.DRIVER_UNAVAILABLE, message: NO_STORAGE } })
          return
        }
        const records = await listModelRecords(store)
        reply({ type: 'result', id: call.id, value: rowsFor(records) })
        return
      }

      case 'deliver': {
        const answer = await deliver(call.envelope)
        // A broken load is the whole send's error, so it travels as `{ failure }` inside a result and the
        // manager turns it back into `ok: false`. Everything else is a normal ack.
        reply({
          type: 'result',
          id: call.id,
          value: answer.ok ? answer.value : { failure: answer.error },
        })
        return
      }

      case 'withdraw': {
        // This driver applies cues immediately and queues nothing, so there is nothing left to withdraw.
        const report: CueWithdrawalReport = { kind: call.request.kind, results: [], count: 0 }
        reply({ type: 'result', id: call.id, value: report })
        return
      }

      case 'query-mount': {
        reply({ type: 'result', id: call.id, value: await queryMount(call.selection, call.query) })
        return
      }

      case 'command-mount': {
        reply({ type: 'result', id: call.id, value: await commandMount(call.selection, call.command) })
      }
    }
  }
  catch (error) {
    reply({
      type: 'error',
      id: call.id,
      error: {
        code: ContractFailureCode.INTERNAL,
        message: `The Live2D driver failed to answer \`${call.method}\`: ${error instanceof Error ? error.message : String(error)}`,
      },
    })
  }
}

function createRuntime(): ModelDriverRuntime {
  /** The `onResolution` subscription, so an activate/deactivate cycle never registers the handler twice. */
  let detachPromptResolution: Unsubscribe | undefined

  return {
    manifest: LIVE2D_MANIFEST,
    provider,

    async activate(services: HostServices) {
      // The session is attached by `startProviderEntry`; re-attaching here keeps `activate` meaningful on its
      // own (a test or an in-process host can call it directly).
      live2dSession.attach({ services })

      const warnings: string[] = []
      if (!(globalThis as { Live2DCubismCore?: unknown }).Live2DCubismCore)
        warnings.push('The Cubism 4 core (`live2dcubismcore.min.js`) is not installed in this window; Live2D mounts will fail to load')

      // Enumerate once so a `listModels` immediately after activation has a warm path, and publish every stored
      // prompt: D-10's "at least once per model and profile once activated". A failure here is not activation
      // failure — the host will ask again, and a publication can be made by the panel — so it becomes a warning.
      try {
        const records = await listModelRecords(services.storage)
        await publishAllLive2DPrompts(services, records)
      }
      catch (error) {
        warnings.push(`Could not publish the model prompts: ${error instanceof Error ? error.message : String(error)}`)
      }

      // The host hands an arbitrated pair back here (D26). Recording it — including the host's version — is what
      // keeps this driver's next publication strictly newer than the copy AIRI now holds.
      detachPromptResolution?.()
      detachPromptResolution = services.prompt.onResolution(async (publication) => {
        try {
          await recordPromptResolution(services.storage, publication)
          return ok(undefined)
        }
        catch (error) {
          return fail(ContractFailureCode.INTERNAL, `Could not record the resolved Live2D prompt: ${error instanceof Error ? error.message : String(error)}`)
        }
      })

      return ok({ warnings })
    },

    async deactivate() {
      detachPromptResolution?.()
      detachPromptResolution = undefined
      live2dSession.detach()
    },

    rendererCapabilities: () => ok(LIVE2D_CAPABILITIES),

    /**
     * Retain one model's pre-contract entry (§6.5 step 3, D-16).
     *
     * Everything the driver can do with it later is in `./legacy`: the entry lands once under `legacy/{modelId}`, and
     * a repeat offer is answered without a second write. Nothing is imported here — the host's import round trip is
     * what creates the row, and a `migrate` that also imported would leave the model present when the host recorded a
     * refusal.
     */
    async migrate(entry) {
      const store = storage()
      if (!store)
        return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
      const result = await migrateLive2DEntry(store, entry)
      if (result.ok)
        live2dSession.notifyModelsChanged()
      return result
    },

    /** The data path of a revert: the retained legacy identity and the bytes, or a refusal that says why not. */
    async restoreLegacy(modelId) {
      const store = storage()
      if (!store)
        return fail(ContractFailureCode.DRIVER_UNAVAILABLE, NO_STORAGE)
      return restoreLive2DLegacyPayload(store, modelId)
    },

    async purge() {
      await purgeAll(requireStorage())
      live2dSession.notifyModelsChanged()
      return ok(undefined)
    },
  }
}

/**
 * Import one archive into this window's driver storage.
 *
 * Exported for the dev route (and, later, the driver's own picker): the two-phase `probe` → `confirmImport` path
 * is what the host uses; this is a convenience over the same commit code, and it still takes host-minted ids.
 */
export async function importLive2DModel(options: {
  file: File
  modelId: ModelId
  profileId: ModelProfileId
  services: HostServices
}): Promise<ContractResult<{ name: string }>> {
  return importLive2DArchive({
    file: options.file,
    storage: options.services.storage,
    driverId: LIVE2D_DRIVER_ID,
    modelId: options.modelId,
    profileId: options.profileId,
    notify: () => live2dSession.notifyModelsChanged(),
  })
}

/** The row list, for a driver surface that wants it without a manager round trip. */
export async function listLive2DModels(services: HostServices): Promise<ModelSummary[]> {
  return rowsFor(await listModelRecords(services.storage))
}

/** The one model's stored record, for a mount or a panel. */
export function readLive2DModel(modelId: ModelId): Promise<StoredLive2DModel | undefined> {
  return readModelRecord(requireStorage(), modelId)
}

/** Re-exported so a surface can name the driver id without importing the manifest separately. */
export { LIVE2D_DRIVER_ID }
