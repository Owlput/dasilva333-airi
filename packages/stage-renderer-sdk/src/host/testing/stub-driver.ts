/**
 * The stub driver: a complete, DOM-free fake of the other half of the contract (§4.8, P1-D27).
 *
 * It exists so the host can be proven before any real renderer moves: without a driver that answers
 * `listModels`, accepts a delivery, retains a handover and refuses a cue, Phase 2's migration service and
 * all of §9.3 would have nothing to run against.
 *
 * Three properties make it a *test* fixture rather than a toy:
 *
 *   - **it is two halves.** A `ModelDriverManager` in "main" and a `ModelDriverRuntime` in a window, talking
 *     only through the `ManagerChannel` the registry hands over — so `requestRenderer`, channel messaging
 *     and row pulls are exercised, not simulated in one object;
 *   - **the channel protocol is the driver's own.** The host transports `unknown` messages and never looks
 *     inside one, so this fixture's little `call`/`result` protocol is also a demonstration of that;
 *   - **it can fail on demand**, because the interesting host behaviour is failure handling.
 */
import type {
  CapabilityVocabulary,
  ContractFailure,
  ContractResult,
  CueAck,
  CueEnvelope,
  CueOutcome,
  CueWithdrawalOutcome,
  CueWithdrawalReport,
  CueWithdrawalRequest,
  EntrypointResolution,
  HostServices,
  LegacyRestorePayload,
  ManagerChannel,
  ModelCapabilityDescriptor,
  ModelConfirmOptions,
  ModelDescriptor,
  ModelDriverActivationReport,
  ModelDriverCapabilities,
  ModelDriverEntryKind,
  ModelDriverImportReport,
  ModelDriverLegacyHandoverEntry,
  ModelDriverLegacyHandoverReport,
  ModelDriverManager,
  ModelDriverManifest,
  ModelDriverRuntime,
  ModelDriverTransferBundle,
  ModelId,
  ModelImportCommit,
  ModelProfileDescriptor,
  ModelProfileId,
  ModelPromptPublication,
  ModelProvider,
  ModelSummary,
  ModelTransferBundle,
  MountCommandAnswer,
  MountQueryAnswer,
  MountSelection,
  RegistryHandle,
  RendererMountHitArea,
  RendererMountPoint,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../../contract'

import {
  ActTokenKind,
  CapabilityDiscoveryMode,
  ContractFailureCode,
  CueKind,
  CueRejection,
  ModelCapabilityKind,
  RendererMountReadinessState as Readiness,
  RendererMountInteractionMode,
  CueWithdrawalOutcome as WithdrawalOutcome,
} from '../../contract'

export const STUB_DRIVER_ID = 'ai.moeru.airi.test.stub'
export const STUB_MANIFEST_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubManifest'
export const STUB_MANAGER_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubManager'
/**
 * The provider entry a manager names when it asks for renderer code (§4.7 step 3).
 *
 * `resolveEntrypoint` returns this string; the adapter's loader table maps it to the module that builds the
 * window half below. It is declared here, beside the rest of the fixture's specifiers, so the manager half
 * and the loader table cannot disagree about it.
 */
export const STUB_PROVIDER_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubProvider'
export const STUB_MOUNT_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubMount'
export const STUB_PANEL_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubPanels'
export const STUB_PICKER_SPECIFIER = '@proj-airi/stage-renderer-sdk/testing#stubPicker'

/** The capabilities a stub declares. Complete by construction — `validateManifest` checks every key. */
export const STUB_CAPABILITIES: ModelDriverCapabilities = {
  probe: true,
  previewModel: true,
  capabilityDiscovery: CapabilityDiscoveryMode.STATIC,
  profiles: true,
  prompt: true,
  modelTransfer: true,
  driverTransfer: true,
  panels: true,
  deactivate: true,
  purge: true,
  migration: true,
  cues: [CueKind.ACT, CueKind.EXPRESSION, CueKind.MOTION, CueKind.EFFECT, CueKind.PROFILE, CueKind.GAZE, CueKind.CAPTURE, CueKind.RESET, CueKind.CAPTION],
  interactionModes: [RendererMountInteractionMode.NONE, RendererMountInteractionMode.TACTILE],
  occupiesPoint: true,
  hitTest: true,
  stopAll: true,
  dispose: true,
}

export const STUB_MANIFEST: ModelDriverManifest = {
  id: STUB_DRIVER_ID,
  name: 'Stub Stage Driver',
  driverVersion: '0.1.0',
  contractVersion: { major: 0, minor: 1 },
  capabilities: STUB_CAPABILITIES,
  requirements: { wasm: false },
  entry: { manager: STUB_MANAGER_SPECIFIER },
}

const ok = <T>(value: T): ContractResult<T> => ({ ok: true, value })
const fail = (code: ContractFailureCode, message: string): ContractResult<never> => ({ ok: false, error: { code, message } })

// -------------------------------------------------------------------------------------------------
// The driver's own state (its "storage", as far as the host is concerned)
// -------------------------------------------------------------------------------------------------

export interface StubModel {
  modelId: ModelId
  profileId: ModelProfileId
  name: string
  authorName?: string
}

export interface StubDriverState {
  models: Map<ModelId, StubModel>
  /** What `migrate` retained, by model id — the revert path reads from here. */
  retained: Map<ModelId, ModelDriverLegacyHandoverEntry>
  modelBundles: Map<ModelId, Blob>
  driverBundle?: Blob
  publications: Map<string, ModelPromptPublication>
  /**
   * Publications the **host handed back** through `HostPromptService.onResolution` (§5.4, D26).
   *
   * The driver's own record of what AIRI now holds: a seeded card copy and an arbitrated winner both arrive here,
   * and the fixture continues its version numbering from them — which is exactly the obligation a real driver has.
   */
  resolutions: ModelPromptPublication[]
  /** The services each window was activated with, by window id. */
  services: Map<string, HostServices>
  activations: number
  deactivations: number
  purges: number
  /** Scripted failures: the interesting host behaviour is what happens when the driver refuses. */
  failures: {
    listModels?: ContractFailure
    deliver?: ContractFailure
    confirmImport?: ContractFailure
    restore?: ContractFailure
    migrate?: ContractFailure
    /**
     * Drop a handover instead of retaining it (D8's `retained: false`).
     *
     * The host must then write no migration marker and delete nothing, so the fixture has to be able to refuse by
     * reporting rather than by failing.
     */
    retain?: false
    /**
     * Answer an ack that names another driver or another correlation.
     *
     * The broker must discard it rather than settle the caller with someone else's outcome, so the fixture
     * has to be able to produce one.
     */
    misattributeAck?: 'driver' | 'nonce'
  }
  /** Every envelope the window-side half was given, in order. */
  delivered: CueEnvelope[]
  /**
   * When set, a delivery blocks on this promise before answering.
   *
   * It is how a test holds a transaction in `running` — the broker marks a transaction running before it
   * hands it to the driver — so `abort-current`, `abort` and `dump` have a real running transaction to
   * address instead of a settled one.
   */
  deliverGate?: Promise<void>
}

export function createStubDriverState(): StubDriverState {
  return {
    models: new Map(),
    retained: new Map(),
    modelBundles: new Map(),
    publications: new Map(),
    resolutions: [],
    services: new Map(),
    activations: 0,
    deactivations: 0,
    purges: 0,
    failures: {},
    delivered: [],
  }
}

// -------------------------------------------------------------------------------------------------
// A mount: readiness, cue handling, hit testing, capture
// -------------------------------------------------------------------------------------------------

export interface StubMountOptions {
  surface: RendererMountSurfaceKind
  purpose: RendererMountPurpose
  /**
   * A `load` this mount must fail, so a host can be shown the difference between "refused" and "broke".
   *
   * Reported in the result-envelope error branch, exactly as `LoadCue` requires, with readiness going to
   * `model-error`.
   */
  failLoad?: ContractFailure
}

/**
 * The stub's mount.
 *
 * Not a component: Phase 1 proves the **protocol** (readiness, delivery, capture, hit testing) and Phase 2
 * is where a Vue component wraps exactly this. Keeping it a plain object is what lets the whole protocol be
 * tested in Node with no DOM.
 */
export interface StubMount {
  readonly surface: RendererMountSurfaceKind
  readonly purpose: RendererMountPurpose
  readonly modelIds: ModelId[]
  received: CueEnvelope[]
  readiness: () => RendererMountReadinessState
  /** Move readiness, as a mount's own lifecycle would. The host validates the transition. */
  moveTo: (state: RendererMountReadinessState) => void
  /** The fake window calls this once the host has issued the mount id, so an ack can carry it. */
  attach: (mountId: string) => void
  handle: (envelope: CueEnvelope) => Promise<ContractResult<CueAck>>
  occupiesPoint: (point: RendererMountPoint) => boolean
  hitTest: (point: RendererMountPoint) => RendererMountHitArea | null
}

export function createStubMount(options: StubMountOptions, state: StubDriverState): StubMount {
  let readiness: RendererMountReadinessState = Readiness.UNMOUNTED
  let mountId: string | undefined
  const modelIds: ModelId[] = []

  const mount: StubMount = {
    surface: options.surface,
    purpose: options.purpose,
    modelIds,
    received: [],

    readiness: () => readiness,

    moveTo: (next) => {
      readiness = next
    },

    attach: (id) => {
      mountId = id
    },

    async handle(envelope) {
      mount.received.push(envelope)
      state.delivered.push(envelope)

      const results: CueOutcome[] = []

      for (const cue of envelope.cues) {
        if (cue.kind === CueKind.LOAD) {
          if (options.failLoad) {
            readiness = Readiness.MODEL_ERROR
            // A load that broke is the whole send's failure: the caller needs the reason, and the other
            // slots were never going to be applied to a model that is not there.
            return { ok: false, error: options.failLoad }
          }

          const model = state.models.get(cue.modelId)
          if (!model) {
            readiness = Readiness.MODEL_ERROR
            return fail(ContractFailureCode.ASSET_MISSING, `No model \`${cue.modelId}\``)
          }

          readiness = Readiness.LOADING_MODEL
          if (!modelIds.includes(cue.modelId))
            modelIds.push(cue.modelId)
          readiness = Readiness.MODEL_LOADED
          results.push({ status: 'resolved', value: { kind: CueKind.LOAD } })
          continue
        }

        if (!STUB_CAPABILITIES.cues.includes(cue.kind)) {
          results.push({
            status: 'rejected',
            reason: CueRejection.UNSUPPORTED_CUE,
            message: `\`${cue.kind}\` is not declared`,
          })
          continue
        }

        if (cue.kind === CueKind.CAPTURE) {
          results.push({
            status: 'resolved',
            value: { kind: CueKind.CAPTURE, mime: 'image/png', data: new ArrayBuffer(16), width: 2, height: 2 },
          })
          continue
        }

        results.push({ status: 'resolved', value: { kind: cue.kind } })
      }

      return ok({
        nonce: envelope.nonce,
        modelDriverId: STUB_DRIVER_ID,
        ...(mountId ? { mountId } : {}),
        results,
        handled: results.every(result => result.status === 'resolved'),
      })
    },

    occupiesPoint: point => point.x >= 0 && point.y >= 0,
    hitTest: point => (point.x >= 0 && point.y >= 0 ? { areaId: 'head', name: 'Head' } : null),
  }

  return mount
}

// -------------------------------------------------------------------------------------------------
// The channel protocol (the driver's own; the host never reads it)
// -------------------------------------------------------------------------------------------------

type StubCall
  = | { type: 'call', id: number, method: 'list-models' }
    | { type: 'call', id: number, method: 'deliver', envelope: CueEnvelope }
    | { type: 'call', id: number, method: 'withdraw', request: CueWithdrawalRequest }
    | { type: 'call', id: number, method: 'query-mount', selection: MountSelection, query: { kind: 'readiness' } }
    | { type: 'call', id: number, method: 'command-mount', selection: MountSelection }

type StubReply
  = | { type: 'result', id: number, value: unknown }
    | { type: 'error', id: number, error: ContractFailure }
    | { type: 'notify', method: 'models-changed' }

function isStubCall(message: unknown): message is StubCall {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'call'
}

function isStubReply(message: unknown): message is StubReply {
  return typeof message === 'object' && message !== null && typeof (message as { type?: unknown }).type === 'string'
}

// -------------------------------------------------------------------------------------------------
// The window half: runtime + provider
// -------------------------------------------------------------------------------------------------

export interface StubRuntimeOptions {
  state: StubDriverState
  /** This window's mounts. The window-side half filters them by the envelope's target. */
  mounts: StubMount[]
  /** `true` (default) publishes a prompt for every known model when activated, as a prompt-capable driver must. */
  publishOnActivate?: boolean
  /** Publish an empty pair instead of a text, to prove `('', [])` is a value. */
  publishEmpty?: boolean
  windowId?: string
  /**
   * Tell the manager this window's model list changed.
   *
   * The renderer half is the side that writes a model, so it is the side that says so; the manager forwards
   * `model-list-changed` to the registry, which pulls. That whole path exists so the row cache is never pushed
   * rows.
   */
  notifyModelsChanged?: () => void
}

export interface StubRendererHalf {
  runtime: ModelDriverRuntime
  /** Feed one manager-channel message in. Replies go back through `reply`. */
  handleMessage: (message: unknown, reply: (message: StubReply) => void) => void
}

function promptFor(state: StubDriverState, model: StubModel, empty: boolean): ModelPromptPublication {
  const key = `${model.modelId}/${model.profileId}`
  const version = (state.publications.get(key)?.version ?? 0) + 1
  return {
    modelDriverId: STUB_DRIVER_ID,
    modelId: model.modelId,
    profileId: model.profileId,
    text: empty ? '' : `You are rendering ${model.name}.`,
    tokens: empty ? [] : ['happy'],
    version,
    publishedAt: Date.now(),
  }
}

export function createStubRendererHalf(options: StubRuntimeOptions): StubRendererHalf {
  const { state, mounts } = options
  const publishOnActivate = options.publishOnActivate ?? true
  const publishEmpty = options.publishEmpty ?? false
  const modelListeners = new Set<() => void>()

  const notifyModelsChanged = () => {
    for (const listener of [...modelListeners])
      listener()
    options.notifyModelsChanged?.()
  }

  const descriptorFor = (model: Pick<StubModel, 'modelId' | 'name' | 'authorName'>): ModelDescriptor => ({
    modelDriverId: STUB_DRIVER_ID,
    modelId: model.modelId,
    name: model.name,
    importedAt: Date.now(),
    ...(model.authorName ? { author: { name: model.authorName } } : {}),
  })

  const commit = (confirm: ModelConfirmOptions): ContractResult<ModelImportCommit> => {
    if (state.failures.confirmImport)
      return { ok: false, error: state.failures.confirmImport }

    // Per-entry settlement (C21): one bad part does not fail the commit or roll back the others.
    const entries = confirm.selections.map((selection) => {
      const stored: StubModel = {
        modelId: selection.modelId,
        profileId: selection.profileId,
        name: selection.name ?? 'Stub model',
      }
      state.models.set(stored.modelId, stored)
      return { selection, result: ok(descriptorFor(stored)) }
    })

    notifyModelsChanged()
    return ok({ entries })
  }

  const provider: ModelProvider = {
    modelDriverId: STUB_DRIVER_ID,

    list: () => ok([...state.models.values()].map(descriptorFor)),

    async remove(modelId) {
      // Idempotent success: removing what is already gone is the outcome the caller asked for.
      state.models.delete(modelId)
      state.retained.delete(modelId)
      notifyModelsChanged()
      return ok(undefined)
    },

    probe(input) {
      if (input.files.length === 0 && !input.url)
        return fail(ContractFailureCode.UNSUPPORTED_INPUT, 'The stub needs at least one file or a url')
      // Two-phase import: `probe` writes nothing and hands back the callback that commits (C21).
      return ok({
        confidence: 1,
        name: input.fileNames?.[0] ?? 'Stub package',
        parts: [{ partIndex: 0, name: 'Stub model', meta: { format: 'stub' } }],
        confirmImport: commit,
      })
    },

    preview: () => ok(null),

    modelCapabilities() {
      const items: ModelCapabilityDescriptor[] = [
        { key: 'happy', kind: ModelCapabilityKind.EXPRESSION, label: 'Happy' },
        { key: 'wave', kind: ModelCapabilityKind.MOTION, label: 'Wave' },
        { key: 'sparkle', kind: ModelCapabilityKind.EFFECT, label: 'Sparkle' },
        { key: 'face', kind: ModelCapabilityKind.POINT_OF_INTEREST, label: 'Face' },
      ]
      return ok(items)
    },

    vocabulary() {
      const vocabulary: CapabilityVocabulary = {
        items: [
          { key: 'happy', tokenKind: ActTokenKind.EMOTION, label: 'Happy' },
          { key: 'wave', tokenKind: ActTokenKind.MOTION, label: 'Wave' },
        ],
        instructions: 'Use ACT tokens to act.',
      }
      return ok(vocabulary)
    },

    listProfiles(modelId) {
      const model = state.models.get(modelId)
      if (!model)
        return ok([])
      const profiles: ModelProfileDescriptor[] = [{ profileId: model.profileId, name: 'Default' }]
      return ok(profiles)
    },

    saveProfile: (_modelId, profileId) => ok({ profileId, name: 'Saved' }),

    removeProfile: () => ok(undefined),

    export(modelId) {
      const model = state.models.get(modelId)
      if (!model)
        return fail(ContractFailureCode.ASSET_MISSING, `No model \`${modelId}\``)
      const transfer: ModelTransferBundle = {
        descriptor: descriptorFor(model),
        payload: state.modelBundles.get(modelId) ?? new Blob([modelId]),
      }
      return ok(transfer)
    },

    import(bundle) {
      state.modelBundles.set(bundle.descriptor.modelId ?? 'unknown', bundle.payload)
      return ok(bundle.descriptor)
    },
  }

  const runtime: ModelDriverRuntime = {
    manifest: STUB_MANIFEST,
    provider,

    async activate(injected): Promise<ContractResult<ModelDriverActivationReport>> {
      state.activations += 1
      if (options.windowId)
        state.services.set(options.windowId, injected)

      // The host→driver half (D26): a seeded card copy or an arbitrated winner arrives here, is recorded in the
      // driver's own history, and becomes the version its next publication continues from.
      injected.prompt.onResolution(async (publication) => {
        state.resolutions.push(publication)
        state.publications.set(`${publication.modelId}/${publication.profileId}`, publication)
        return ok(undefined)
      })

      // A prompt-capable driver MUST publish at least once per model and profile once activated (D5).
      if (publishOnActivate) {
        for (const model of state.models.values()) {
          const publication = promptFor(state, model, publishEmpty)
          state.publications.set(`${model.modelId}/${model.profileId}`, publication)
          injected.prompt.publish(publication)
        }
      }

      return ok({ warnings: [] })
    },

    async deactivate() {
      state.deactivations += 1
    },

    // Complete, and the same record the declaration carries: the stub has no resource limits to discover,
    // which is what makes it a deterministic fixture.
    rendererCapabilities: () => ok(STUB_CAPABILITIES),

    export() {
      const bundle: ModelDriverTransferBundle = {
        modelDriverId: STUB_DRIVER_ID,
        payload: state.driverBundle ?? new Blob([JSON.stringify([...state.models.keys()])]),
      }
      return ok(bundle)
    },

    async import(bundle) {
      state.driverBundle = bundle.payload
      const report: ModelDriverImportReport = { warnings: [] }
      return ok(report)
    },

    purge() {
      state.purges += 1
      state.models.clear()
      state.retained.clear()
      state.modelBundles.clear()
      state.driverBundle = undefined
      return ok(undefined)
    },

    migrate(entry: ModelDriverLegacyHandoverEntry): ContractResult<ModelDriverLegacyHandoverReport> {
      if (state.failures.migrate)
        return { ok: false, error: state.failures.migrate }

      // A driver that cannot keep the payload says so instead of failing: the model then stays legacy-shaped and
      // the host writes no marker (D8).
      if (state.failures.retain === false)
        return ok({ retained: false, warnings: ['The fixture was told not to retain this handover'] })

      // Retain, never copy: the retained entry holds the *same* `Uint8Array` instances the handover carried,
      // which is what makes "move-import" observable rather than merely claimed (D-16).
      state.retained.set(entry.modelId, entry)
      return ok({ retained: true, unused: [], warnings: [] })
    },

    restoreLegacy(modelId): ContractResult<LegacyRestorePayload> {
      if (state.failures.restore)
        return { ok: false, error: state.failures.restore }

      const retained = state.retained.get(modelId)
      if (!retained)
        return fail(ContractFailureCode.ASSET_MISSING, `No retained legacy entry for \`${modelId}\``)

      return ok({
        schemaVersion: retained.schemaVersion,
        driverId: STUB_DRIVER_ID,
        modelId: retained.modelId,
        legacyModelId: retained.legacyModelId,
        meta: retained.meta,
        ...(retained.values ? { values: retained.values } : {}),
        ...(retained.placement ? { placement: retained.placement } : {}),
        ...(retained.outfits ? { outfits: retained.outfits } : {}),
        ...(retained.prompt ? { prompt: retained.prompt } : {}),
        ...(retained.files ? { files: retained.files } : {}),
        ...(retained.url ? { url: retained.url } : {}),
        ...(retained.assets ? { assets: retained.assets } : {}),
      })
    },
  }

  const handleMessage = (message: unknown, reply: (message: StubReply) => void) => {
    if (!isStubCall(message))
      return

    const call = message
    switch (call.method) {
      case 'list-models': {
        if (state.failures.listModels) {
          reply({ type: 'error', id: call.id, error: state.failures.listModels })
          return
        }
        // One row per model **profile**, which is what a picker offers "model X in outfit B" from.
        const rows: ModelSummary[] = [...state.models.values()].map(model => ({
          modelDriverId: STUB_DRIVER_ID,
          modelId: model.modelId,
          profileId: model.profileId,
          name: model.name,
          ...(model.authorName ? { author: { name: model.authorName } } : {}),
        }))
        reply({ type: 'result', id: call.id, value: rows })
        return
      }

      case 'deliver': {
        if (state.failures.deliver) {
          reply({ type: 'error', id: call.id, error: state.failures.deliver })
          return
        }

        const envelope = call.envelope
        // The window resolves the target against its own mounts: a mount knows its surface and purpose,
        // and the envelope names them. This is the fan-out the manager owns (RFC §4.2).
        const matched = mounts.filter((mount) => {
          if (envelope.target.surface !== undefined && mount.surface !== envelope.target.surface)
            return false
          if (envelope.target.purpose !== undefined && mount.purpose !== envelope.target.purpose)
            return false
          return true
        })

        if (matched.length === 0) {
          reply({
            type: 'result',
            id: call.id,
            value: {
              nonce: envelope.nonce,
              modelDriverId: STUB_DRIVER_ID,
              results: envelope.cues.map(() => ({ status: 'rejected' as const, reason: CueRejection.NO_TARGET })),
              handled: false,
            } satisfies CueAck,
          })
          return
        }

        void (async () => {
          if (state.deliverGate)
            await state.deliverGate

          // The first matching mount answers. A real driver may combine several mounts' outcomes; the
          // contract leaves that decision to the driver, not to the host.
          const answer = await matched[0].handle(envelope)
          if (answer.ok && state.failures.misattributeAck) {
            const ack: CueAck = state.failures.misattributeAck === 'driver'
              ? { ...answer.value, modelDriverId: 'ai.moeru.airi.someone.else' }
              : { ...answer.value, nonce: answer.value.nonce + 1000 }
            reply({ type: 'result', id: call.id, value: ack })
            return
          }
          reply({
            type: 'result',
            id: call.id,
            value: answer.ok ? answer.value : { failure: answer.error },
          })
        })()
        return
      }

      case 'withdraw': {
        const request = call.request
        const report: CueWithdrawalReport = {
          kind: request.kind,
          results: [{ outcome: WithdrawalOutcome.EMPTY as CueWithdrawalOutcome }],
          count: 0,
        }
        reply({ type: 'result', id: call.id, value: report })
        return
      }

      case 'query-mount': {
        const answers: MountQueryAnswer[] = mounts
          .filter(mount => matchesSelection(mount, call.selection))
          .map(mount => ({ kind: 'readiness' as const, mountId: 'stub', readiness: mount.readiness() }))
        reply({ type: 'result', id: call.id, value: answers })
        return
      }

      case 'command-mount': {
        const answers: MountCommandAnswer[] = mounts
          .filter(mount => matchesSelection(mount, call.selection))
          .map(() => ({ mountId: 'stub' }))
        reply({ type: 'result', id: call.id, value: answers })
      }
    }
  }

  return { runtime, handleMessage }
}

function matchesSelection(mount: StubMount, selection: MountSelection): boolean {
  if (selection.surface !== undefined && mount.surface !== selection.surface)
    return false
  if (selection.purpose !== undefined && mount.purpose !== selection.purpose)
    return false
  return true
}

// -------------------------------------------------------------------------------------------------
// The main half: manager
// -------------------------------------------------------------------------------------------------

export interface StubManagerOptions {
  state: StubDriverState
  /** Which specifiers this stub resolves for each entry kind. `null` means "this driver ships none". */
  entries?: Partial<Record<ModelDriverEntryKind, EntrypointResolution>>
}

/**
 * Correlations for the stub's control protocol, process-wide rather than per manager.
 *
 * After a restart two manager instances can be wired to the same channel object (the window's entry is
 * reused), and each routes replies into its own `waiting` map. A per-manager counter would let the two use
 * the same id, so the released instance could consume the live one's reply. Monotonic ids make every reply
 * match exactly the call that asked for it.
 */
let nextCallId = 0

/**
 * The factory the registry calls.
 *
 * Every answer that needs model data goes through `requestRenderer` and the channel, in that order — the
 * only path a real manager has. A test that exercises this therefore also exercises the registry's renderer
 * policy, the channel transport and the row pull.
 */
export function createStubManagerFactory(options: StubManagerOptions): (handle: RegistryHandle) => ModelDriverManager {
  const { state } = options
  const entries = options.entries ?? {}

  return (handle): ModelDriverManager => {
    const waiting = new Map<number, { key: string, resolve: (value: unknown) => void, reject: (error: ContractFailure) => void }>()
    const handlers = new Set<() => void>()
    /**
     * The channels this manager holds, by `${surface}/${purpose}`.
     *
     * Held by the manager, not on `state`: a channel's reply routing is wired by the manager that opened it,
     * so a main-process restart — which creates a new manager — has to ask the registry for a renderer again.
     * A cache on `state` would hand the new instance a channel it never subscribed to, and every call on it
     * would wait for a reply nobody routes. That is exactly what `restartManagers` promises, so the fixture
     * must be able to show it.
     */
    const channels = new Map<string, ManagerChannel>()

    const channelKey = (surface?: RendererMountSurfaceKind, purpose?: RendererMountPurpose) =>
      `${surface ?? '*'}/${purpose ?? '*'}`

    // One in-flight request per channel, memoized. Two concurrent deliveries must not open two channels:
    // that would give one manager two pipes to the same window, and the second pipe's answers would race
    // the first's — which is exactly the FIFO guarantee the host is being tested for.
    const opening = new Map<string, Promise<ContractResult<ManagerChannel>>>()

    const ensureChannel = (
      surface?: RendererMountSurfaceKind,
      purpose?: RendererMountPurpose,
    ): Promise<ContractResult<ManagerChannel>> => {
      const key = channelKey(surface, purpose)
      const existing = channels.get(key)
      if (existing)
        return Promise.resolve(ok(existing))

      const inFlight = opening.get(key)
      if (inFlight)
        return inFlight

      const pending = (async (): Promise<ContractResult<ManagerChannel>> => {
        const requested = await handle.requestRenderer({
          driverId: STUB_DRIVER_ID,
          ...(surface ? { surface } : {}),
          ...(purpose ? { purpose } : {}),
        })
        if (!requested.ok)
          return fail(ContractFailureCode.DRIVER_UNAVAILABLE, `No renderer could run the stub driver: ${requested.reason}`)

        channels.set(key, requested.channel)
        requested.channel.onMessage((message) => {
          if (!isStubReply(message))
            return
          if (message.type === 'notify') {
            for (const handler of [...handlers])
              handler()
            return
          }
          const waitingCall = waiting.get(message.id)
          if (!waitingCall)
            return
          waiting.delete(message.id)
          if (message.type === 'error')
            waitingCall.reject(message.error)
          else
            waitingCall.resolve(message.value)
        })
        return ok(requested.channel)
      })()

      opening.set(key, pending)
      void pending.finally(() => opening.delete(key))
      return pending
    }

    // A channel is the registry's object: it opened it, cached it, and it is the only party told when the
    // window behind it died. The registry reports the address here, so the manager drops its own copy and
    // fails whatever was already in flight on it — the next call asks for a renderer again, which is the
    // recovery the contract's `requestRenderer` already describes (P1-D23).
    handle.onChange((change) => {
      if (change.kind !== 'channel-closed')
        return

      const key = channelKey(change.surface, change.purpose)
      if (!channels.has(key))
        return

      channels.delete(key)
      opening.delete(key)

      for (const [id, pending] of [...waiting]) {
        if (pending.key !== key)
          continue
        waiting.delete(id)
        pending.reject({
          code: ContractFailureCode.WINDOW_GONE,
          message: `Window \`${change.windowId}\` closed while a call was in flight`,
        })
      }
    })

    const call = async <T>(
      surface: RendererMountSurfaceKind | undefined,
      purpose: RendererMountPurpose | undefined,
      payload: Record<string, unknown>,
    ): Promise<ContractResult<T>> => {
      const key = channelKey(surface, purpose)
      const channel = await ensureChannel(surface, purpose)
      if (!channel.ok)
        return channel

      const id = nextCallId += 1
      const answer = new Promise<T>((resolve, reject) => {
        waiting.set(id, { key, resolve: resolve as (value: unknown) => void, reject })
      })
      channel.value.send({ type: 'call', id, ...payload })

      try {
        return ok(await answer)
      }
      catch (error) {
        return { ok: false, error: error as ContractFailure }
      }
    }

    return {
      modelDriverId: STUB_DRIVER_ID,

      listModels: () => call<ModelSummary[]>(undefined, undefined, { method: 'list-models' }),

      resolveEntrypoint: async request => ok(entries[request.kind] ?? null),

      async deliver(envelope) {
        if (state.failures.deliver)
          return { ok: false, error: state.failures.deliver }

        const answer = await call<CueAck>(envelope.target.surface, envelope.target.purpose, {
          method: 'deliver',
          envelope,
        })
        if (!answer.ok)
          return answer

        // The window half reports a load failure as `{ failure }` rather than as an ack, because a load
        // that broke is the whole send's error (LoadCue).
        const value = answer.value as unknown as { failure?: ContractFailure }
        if (value.failure)
          return { ok: false, error: value.failure }
        return ok(answer.value)
      },

      async withdraw(request) {
        const answer = await call<CueWithdrawalReport>(request.address?.surface, request.address?.purpose, {
          method: 'withdraw',
          request,
        })
        if (!answer.ok)
          return answer
        return ok({ ...answer.value, kind: request.kind })
      },

      onModelsChanged(handler) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },

      queryMount: (selection, query) =>
        call<MountQueryAnswer[]>(selection.surface, selection.purpose, {
          method: 'query-mount',
          selection,
          query: query as { kind: 'readiness' },
        }),

      commandMount: selection =>
        call<MountCommandAnswer[]>(selection.surface, selection.purpose, { method: 'command-mount', selection }),
    }
  }
}
