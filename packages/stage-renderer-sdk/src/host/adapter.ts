/**
 * The per-window adapter: the object AIRI keeps in each renderer window to carry the host's protocol.
 *
 * It owns nothing the host's main process owns. Mounts are registered with the registry and addressed by **its**
 * ids; a transaction is submitted to the broker and settled by it; an entry point is chosen by the manager and
 * only _imported_ here — the adapter never picks an entry. What it does own is per window: this window's
 * identity, the driver entries running in it, and the driver namespaces composed from this window's storage.
 *
 * **It is not the contract's `Adapter`.** The contract describes that endpoint with `mintModelId`,
 * `mintProfileId`, `importRuntime`, `getService`, `getCueChannel` and `openManagerChannel`; this object is the
 * subset a window needs before there is an import flow or a host UI, plus what the window does need
 * (`registerMount`, `setReadiness`, `withdraw`). The rest arrives with the surfaces that exercise it, and until
 * then the contract type is not claimable.
 *
 * **It has no transport.** Everything the host can do to a window, and everything a window can ask the host, goes
 * through `HostClient` (`./client`) and nothing else: no eventa, no Electron, no IPC, no global. The desktop app
 * satisfies that interface over its typed IPC; a test satisfies it with plain functions; a Web or Pocket build
 * will satisfy it in-process. That is what makes this file belong to the contract package rather than to an
 * application.
 *
 * **It composes storage, it is not given it.** The embedder supplies primitives (`WindowStorage`: get, set,
 * remove, a prefix scan) and a prompt sink; this adapter binds a driver id to those primitives, so the namespace
 * is the adapter's job and the primitives stay reusable by anything else in the window. The driver sees only
 * `HostStorageInterface`, with relative keys.
 *
 * Two details are worth knowing before reading the code:
 *
 *   - **acceptance and settlement are two channels, not one.** `send` resolves with a nonce and a promise; the
 *     promise is resolved by the client's settlement push for that correlation value. A settlement can arrive
 *     before the caller has attached its resolver — a round trip through the host and back is not instantaneous —
 *     so early settlements are kept briefly, exactly as the host core does in-process.
 *   - **`subscribe` is a local echo.** The contract's observation feed is bus-wide; a second window observing
 *     another window's envelopes needs a broadcast channel, which no Phase 1 host has. What exists here is what
 *     this window itself sent, which is honest and useful for a dev route and is labelled rather than implied.
 */
import type {
  CueAck,
  CueChannel,
  CueEnvelope,
  CueEnvelopeInput,
  CueSendOptions,
  CueSink,
  CueTransactionReceipt,
  CueWithdrawalReport,
  CueWithdrawalRequest,
} from '../contract/cues'
import type { HostLogger, HostStorageInterface, ModelPromptPublication } from '../contract/host-services'
import type { ModelSummary } from '../contract/references'
import type { EntrypointRequest, EntrypointResolution, MountRegistrationResult } from '../contract/registry'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverId,
  MountId,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../contract/shared'
import type { HostClient, ModelDriverEntryRequest, ModelDriverHostState } from './client'
import type { DriverEntryStartOptions, DriverLoaderTable, DriverProviderEntry } from './loaders'
import type { PromptSink, WindowStorage } from './storage'

import { HostWindowKind } from '../contract/host-services'
import { ModelDriverEntryKind } from '../contract/registry'
import { ContractFailureCode } from '../contract/shared'
import { createConsoleLogger } from './logging'
import { createDriverWindowServices } from './services'
import { createDriverStorage, createDriverStorageHub } from './storage'

export interface ModelDriverAdapterOptions {
  /**
   * The adapter's client to the host's services.
   *
   * An implementation, not a transport: whatever reaches the registry, the broker and the mount table lives
   * behind this one object, which is why the adapter has no idea whether that is IPC, a function call or a
   * channel.
   */
  client: HostClient
  /**
   * This window's storage primitives.
   *
   * Driver-agnostic on purpose: the adapter composes a namespace from them per driver, so the same object can
   * back host records, a panel's data or anything else that lives in this window.
   */
  storage: WindowStorage
  /** Where a published prompt goes. The embedder builds the store from the same primitives. */
  prompts: PromptSink
  /**
   * The specifiers this build can run.
   *
   * Required, not defaulted: "what does this build ship" is host policy, and an adapter that guessed would
   * either ship a fixture into production or refuse a driver the app does contain.
   */
  loaders: DriverLoaderTable
  windowKind?: HostWindowKind
  logger?: HostLogger
}

export interface ModelDriverAdapter {
  /** This window's host-assigned identity. Resolved once, from the host, never constructed here. */
  windowId: () => Promise<string>
  cues: CueChannel
  registerMount: (input: { driverId: ModelDriverId, surface: RendererMountSurfaceKind, purpose: RendererMountPurpose }) => Promise<MountRegistrationResult>
  unregisterMount: (mountId: MountId) => Promise<void>
  setReadiness: (mountId: MountId, readiness: RendererMountReadinessState) => Promise<ContractResult<void>>
  withdraw: (request: CueWithdrawalRequest) => Promise<ContractResult<CueWithdrawalReport>>
  resolveEntrypoint: (request: EntrypointRequest) => Promise<ContractResult<EntrypointResolution>>
  hostState: () => Promise<ModelDriverHostState>
  pullRows: (driverId: ModelDriverId) => Promise<ContractResult<ModelSummary[]>>
  setEnabled: (driverId: ModelDriverId, enabled: boolean) => Promise<ContractResult<void>>
  /**
   * One driver's namespace, composed from this window's primitives.
   *
   * The driver meets the same object as `HostServices.storage`; a panel or a picker that lives in this window
   * and is not itself a driver gets it here, so both sides of a driver's data address one namespace.
   */
  storageFor: (driverId: ModelDriverId) => HostStorageInterface
  /** Start the entry the host named. Exposed so a dev route can drive it directly if it has to. */
  startEntry: (request: ModelDriverEntryRequest) => Promise<void>
  /**
   * Make this window host a driver's provider entry, whether or not the host asked it to.
   *
   * A window that registered a mount but does not host the entry can never receive a cue — the host steers its
   * channel by address, and a row pull can be served by any live window — so a surface that wants to receive
   * starts the entry itself.
   */
  ensureEntry: (driverId: ModelDriverId) => Promise<ContractResult<void>>
  /** The provider entries running in this window, by driver. */
  entries: () => Map<ModelDriverId, DriverProviderEntry>
  dispose: () => void
}

export async function createModelDriverAdapter(options: ModelDriverAdapterOptions): Promise<ModelDriverAdapter> {
  const logger = options.logger ?? createConsoleLogger()
  const { client, loaders, prompts, storage } = options

  const unsubscribe: Array<() => void> = []
  const entries = new Map<ModelDriverId, DriverProviderEntry>()

  /**
   * The handlers drivers registered for a resolved prompt, by driver.
   *
   * Per driver because one window can host several drivers' entries, and a resolution is addressed to exactly the
   * driver whose prompt the user arbitrated.
   */
  const promptResolutions = new Map<
    ModelDriverId,
    Set<(publication: ModelPromptPublication) => MaybePromise<ContractResult<void>>>
  >()

  // One hub per window, because two handles in the same window must see each other's writes; the hub is keyed by
  // driver, so two drivers in the same window stay separate. Nothing here reaches another window: see the note
  // on `DriverStorageHub`.
  const storageHub = createDriverStorageHub()
  const storageFor = (driverId: ModelDriverId) => createDriverStorage({ store: storage, driverId, hub: storageHub })

  // --- identity -----------------------------------------------------------------------------------

  let identity: Promise<string> | undefined
  const windowId = (): Promise<string> => {
    identity ??= client.identify().then(result => result.windowId)
    return identity
  }

  // --- settlements --------------------------------------------------------------------------------

  const waiting = new Map<number, (result: ContractResult<CueAck>) => void>()
  const earlySettlements = new Map<number, ContractResult<CueAck>>()

  unsubscribe.push(client.onCueSettled((payload) => {
    const resolve = waiting.get(payload.nonce)
    if (resolve) {
      waiting.delete(payload.nonce)
      resolve(payload.result)
      return
    }

    // A settlement that beat the caller's resolver is kept briefly: an answer must not be lost because the
    // promise had not been attached yet.
    earlySettlements.set(payload.nonce, payload.result)
    if (earlySettlements.size > 64) {
      const oldest = earlySettlements.keys().next()
      if (!oldest.done)
        earlySettlements.delete(oldest.value)
    }
  }))

  // --- observations (this window's own sends, see the header comment) -------------------------------

  const observers = new Set<CueSink>()

  const cues: CueChannel = {
    async send(input: CueEnvelopeInput, sendOptions?: CueSendOptions): Promise<ContractResult<CueTransactionReceipt>> {
      const submitted = await client.submitCue({ envelope: input, ...(sendOptions ? { options: sendOptions } : {}) })
      if (!submitted.ok)
        return submitted

      const { nonce, settledImmediately } = submitted.value

      // The broker mints the correlation value, so the echoed envelope carries the host's, not the caller's.
      const envelope: CueEnvelope = { ...input, nonce, at: Date.now() }
      for (const observer of [...observers]) {
        try {
          void observer.handle(envelope)
        }
        catch {
          // An observer must not be able to break a send it is only watching.
        }
      }

      if (settledImmediately)
        return { ok: true, value: { nonce, settled: Promise.resolve(settledImmediately) } }

      const early = earlySettlements.get(nonce)
      if (early) {
        earlySettlements.delete(nonce)
        return { ok: true, value: { nonce, settled: Promise.resolve(early) } }
      }

      const settled = new Promise<ContractResult<CueAck>>((resolve) => {
        waiting.set(nonce, resolve)
      })
      return { ok: true, value: { nonce, settled } }
    },

    subscribe(handler) {
      observers.add(handler)
      return () => {
        observers.delete(handler)
      }
    },
  }

  // --- entries ------------------------------------------------------------------------------------

  /**
   * Start a driver's provider entry in this window, or return the one already running.
   *
   * This is the only place a window starts driver code. It is deliberately separate from reporting: the host
   * asks for an entry and needs an answer, while a window's own surface (a dev route now, a panels host later)
   * needs the entry running without having been asked. Mixing the two would make a locally started entry look
   * like an answer to a request the host never sent, which main refuses.
   */
  const startProviderEntry = async (
    driverId: ModelDriverId,
    specifier: string,
  ): Promise<ContractResult<DriverProviderEntry>> => {
    const load = loaders.resolveProvider(specifier)
    if (!load) {
      return {
        ok: false,
        error: {
          code: ContractFailureCode.INVALID_ENTRYPOINT,
          message: `This build has no loader for \`${specifier}\``,
        },
      }
    }

    try {
      const module = await load()
      const startOptions: DriverEntryStartOptions = {
        driverId,
        services: createDriverWindowServices({
          driverId,
          cues,
          storage: storageFor(driverId),
          prompt: {
            publish: (publication) => {
              void prompts.publish(publication).then((result) => {
                if (!result.ok)
                  logger.error(driverId, `Rejected prompt publication: ${result.error.message}`)
              })
            },
            onResolution: (handler) => {
              const handlers = promptResolutions.get(driverId) ?? new Set()
              handlers.add(handler)
              promptResolutions.set(driverId, handlers)
              return () => {
                handlers.delete(handler)
              }
            },
          },
          logger,
          windowKind: options.windowKind ?? HostWindowKind.UNKNOWN,
        }),
        send: (message) => {
          void client.sendManagerMessage({ driverId, message })
        },
      }

      const entry = await module.startProviderEntry(startOptions)
      entries.set(driverId, entry)
      return { ok: true, value: entry }
    }
    catch (error) {
      logger.error(driverId, 'The provider entry failed to start', error)
      return {
        ok: false,
        error: {
          code: ContractFailureCode.INTERNAL,
          message: `The provider entry for \`${driverId}\` failed to start: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  }

  const startEntry = async (request: ModelDriverEntryRequest): Promise<void> => {
    // The host asks for a driver's entry per address (`any`, then a surface), and a second request for a driver
    // whose entry is already running here must not restart it: the running half owns the mounts this window
    // registered, so replacing it would orphan every one of them and answer the host with a channel to a half
    // that knows nothing about them.
    if (entries.has(request.driverId)) {
      await client.sendEntryResult({ requestId: request.requestId })
      return
    }

    const started = await startProviderEntry(request.driverId, request.specifier)
    await client.sendEntryResult(started.ok
      ? { requestId: request.requestId }
      : { requestId: request.requestId, error: { code: started.error.code, message: started.error.message } })
  }

  /**
   * Make this window host a driver's entry, whether or not the host ever asked it to.
   *
   * Needed because the host steers its *channel* by address, not by who is asking: a row pull can be served by
   * any live window, so the window that ends up holding a mount is not necessarily the one the host chose. A
   * window that has registered a mount but does not host the entry can never receive a cue, so it starts the
   * entry itself and the next addressed request finds it here.
   */
  const ensureEntry = async (driverId: ModelDriverId): Promise<ContractResult<void>> => {
    if (entries.has(driverId))
      return { ok: true, value: undefined }

    const resolved = await client.resolveEntrypoint({ driverId, kind: ModelDriverEntryKind.PROVIDER })
    if (!resolved.ok)
      return resolved
    if (!resolved.value) {
      return {
        ok: false,
        error: {
          code: ContractFailureCode.INVALID_ENTRYPOINT,
          message: `Driver \`${driverId}\` ships no provider entry`,
        },
      }
    }

    const started = await startProviderEntry(driverId, resolved.value.specifier)
    return started.ok ? { ok: true, value: undefined } : started
  }

  unsubscribe.push(client.onOpenEntry((request) => {
    void startEntry(request)
  }))

  unsubscribe.push(client.onManagerMessage((payload) => {
    entries.get(payload.driverId)?.onMessage(payload.message)
  }))

  unsubscribe.push(client.onPromptResolution((payload) => {
    const handlers = promptResolutions.get(payload.driverId)
    if (!handlers)
      return

    // One handler failing — or refusing to record — must not stop the others or break the delivery itself: the
    // host has already committed the resolution to the store and the card, so this is the driver's bookkeeping,
    // not the decision.
    for (const handler of [...handlers]) {
      void (async () => {
        try {
          const result = await handler(payload.publication)
          if (!result.ok)
            logger.warn('model-drivers', `Driver \`${payload.driverId}\` did not record the resolved prompt: ${result.error.message}`)
        }
        catch (error) {
          logger.error(payload.driverId, 'A driver threw while recording a resolved prompt', error)
        }
      })()
    }
  }))

  // --- mounts -------------------------------------------------------------------------------------

  const adapter: ModelDriverAdapter = {
    windowId,
    cues,

    registerMount: async ({ driverId, surface, purpose }) => {
      // The identity is resolved first, so the host has a window to register the mount in before it issues an id.
      await windowId()
      return client.registerMount({ driverId, surface, purpose })
    },

    async unregisterMount(mountId) {
      const result = await client.unregisterMount({ mountId })
      if (!result.ok)
        logger.warn('model-drivers', `Could not unregister mount \`${mountId}\`: ${result.error.message}`)
    },

    async setReadiness(mountId, readiness) {
      // A refused transition is an error, not a warning: the host refuses a state the machine cannot reach, so
      // a caller that swallowed this would go on believing a mount is ready when it is still unmounted — and a
      // mount that is not ready never receives a cue.
      const result = await client.reportReadiness({ mountId, readiness })
      if (!result.ok)
        logger.warn('model-drivers', `Refused readiness \`${readiness}\` for \`${mountId}\`: ${result.error.message}`)
      return result
    },

    withdraw: request => client.withdrawCues(request),

    resolveEntrypoint: request => client.resolveEntrypoint(request),

    hostState: () => client.hostState(),

    pullRows: driverId => client.pullRows({ driverId }),

    async setEnabled(driverId, enabled) {
      const result = await client.setEnabled({ driverId, enabled })
      return result.ok ? { ok: true, value: undefined } : result
    },

    storageFor,

    startEntry,
    ensureEntry,

    entries: () => entries,

    dispose() {
      for (const stop of unsubscribe.splice(0))
        stop()
      for (const entry of entries.values())
        entry.dispose?.()
      entries.clear()
      promptResolutions.clear()
      waiting.clear()
      earlySettlements.clear()
      observers.clear()
    },
  }

  return adapter
}
