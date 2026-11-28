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
 * subset a window needs before there is a host UI, plus what the window does need (`registerMount`,
 * `setReadiness`, `withdraw`). The **identity authority is here**, though: `mintModelId`/`mintProfileId` are
 * implemented, because an import flow has to mint before it can commit and no renderer may choose an id. The
 * rest still arrives with the surfaces that exercise it, and until then the contract type is not claimable.
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
  ModelPickerComponent,
  ModelPickerComponentModule,
  RendererMountComponent,
  RendererMountComponentModule,
} from '../contract'
import type { ModelDriverPanelDeclaration, ModelImportEntry, ModelImportEntryModule } from '../contract/components'
import type { HostLogger, HostServices, HostStorageInterface, ModelPromptPublication } from '../contract/host-services'
import type { ModelId, ModelProfileId } from '../contract/model'
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
import type { PointerHub } from './core/pointer'
import type { DriverEntryStartOptions, DriverLoaderTable, DriverPanelsModule, DriverProviderEntry, DriverProviderModule } from './loaders'
import type { PromptSink, WindowStorage } from './storage'

import { HostWindowKind } from '../contract/host-services'
import { ModelDriverEntryKind } from '../contract/registry'
import { ContractFailureCode } from '../contract/shared'
import { createIdMinter } from './core/ids'
import { createPointerHub } from './core/pointer'
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
  /**
   * Mint the identity of a model that is about to be imported (contract `Adapter.mintModelId`).
   *
   * The adapter's authority, not the caller's: a host UI asks for an id before committing an import, and the
   * driver receives that id and must not rewrite it. Synchronous, like the contract's, because a commit is built
   * in one step. Uniqueness is this adapter's guarantee for its window; the record store's create is the final
   * check (`MODEL_ID_CONFLICT`) when the import actually commits (`host/core/ids.ts`).
   */
  mintModelId: () => ModelId
  /** Mint the identity of a model profile, under the same rule as `mintModelId`. */
  mintProfileId: () => ModelProfileId
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
  /**
   * The `HostServices` container this window provides to one driver.
   *
   * Panels and pickers receive it as a prop (`ModelDriverPanelProps.services`), and they are usually mounted
   * from a different window than the mount they edit — so the only object that can hand out the right
   * container is the adapter that built it. It is built on first use (an entry starting, or an import entry
   * being loaded for the driver) and kept for the window's lifetime, so an import writes through the same
   * container the entry will later list from.
   */
  servicesFor: (driverId: ModelDriverId) => HostServices | undefined
  /**
   * Import the mount component the manager named for one address (§5.2 step 2).
   *
   * The manager chooses and this imports; `null` means the driver ships no mount for that address, which is a
   * value (the surface renders nothing) rather than a failure. An unknown specifier is `invalid-entrypoint`.
   */
  mountComponent: (input: {
    driverId: ModelDriverId
    surface: RendererMountSurfaceKind
    purpose: RendererMountPurpose
  }) => Promise<ContractResult<RendererMountComponent | null>>
  /** The driver's panel declarations, or an empty list when it ships none (§5.6). */
  panelDeclarations: (driverId: ModelDriverId) => Promise<ContractResult<ModelDriverPanelDeclaration[]>>
  /** The driver's model picker component, or `null` when it ships none (§5.6). */
  pickerComponent: (driverId: ModelDriverId) => Promise<ContractResult<ModelPickerComponent | null>>
  /**
   * The driver's import surface, or `null` when it ships none (§5.3).
   *
   * Built with this window's container for the driver, so its probe reads and its commit writes inside the
   * driver's own namespace. An import is addressed and loaded exactly like a mount or a panel — the only thing
   * that differs is what the module exports.
   */
  importEntry: (driverId: ModelDriverId) => Promise<ContractResult<ModelImportEntry | null>>
  /**
   * This window's pointer hub (P2-D16, exit criterion 6).
   *
   * The host UI that owns a mount's element measures that element and feeds raw events here; the renderer receives
   * them already in its own box's coordinates through `services.pointer`. One hub per window, keyed by the mount id
   * the registry issued, so two mounts of the same driver in one window cannot see each other's input.
   */
  pointer: PointerHub
  /**
   * Hand a pair the user arbitrated back to the driver that owns it (§5.4, D26).
   *
   * The store and the card were already written by the caller; this is the driver's bookkeeping half, addressed
   * to the window running its entry.
   */
  deliverPromptResolution: (driverId: ModelDriverId, publication: ModelPromptPublication) => Promise<ContractResult<{ delivered: number }>>
  dispose: () => void
}

export async function createModelDriverAdapter(options: ModelDriverAdapterOptions): Promise<ModelDriverAdapter> {
  const logger = options.logger ?? createConsoleLogger()
  const { client, loaders, prompts, storage } = options

  const unsubscribe: Array<() => void> = []
  /**
   * This window's identity authority.
   *
   * One per adapter, not one per import flow: two panels open at once must not mint the same id, and the ids are
   * this window's to hand out — the same rule that makes the host core's minter the app's only source
   * (`host/core/ids.ts`). The record store answers the final "is this id free" question when an import commits.
   */
  const minter = createIdMinter()
  const entries = new Map<ModelDriverId, DriverProviderEntry>()
  /**
   * The services container this window provides to one driver, by driver.
   *
   * Kept beside `entries` rather than on `DriverProviderEntry`, because the entry is the driver's object and the
   * container is the host's: a panel or picker receives the container as a prop and must not have to reach into
   * the driver's module to find it. Built on demand (`ensureServices`), because an import entry needs the same
   * container without starting a provider first.
   */
  const services = new Map<ModelDriverId, HostServices>()

  /**
   * This window's pointer route (P2-D16).
   *
   * One per adapter rather than per driver: a mount id is unique in a window, and the host UI that measures a box does
   * not know or care which driver's component it contains. Every driver's container receives the same service, so a
   * panel and a mount of the same driver cannot disagree about where the pointer is.
   */
  const pointer = createPointerHub({
    onError: (mountId, error) => logger.warn('model-drivers', `A pointer handler for \`${mountId}\` threw`, error),
  })

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
   * The container this window provides to one driver, built on first use.
   *
   * One per `(window, driver)` for the window's lifetime. Two things read it: the provider entry, which is
   * activated with it, and the import entry, which is built with it. A second container would be a second
   * `HostServices.contract` that could disagree, and an import writing through a different storage handle than
   * the entry that later lists the model is exactly the split the driver must not see.
   */
  const ensureServices = (driverId: ModelDriverId): HostServices => {
    const existing = services.get(driverId)
    if (existing)
      return existing

    const created = createDriverWindowServices({
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
      pointer: pointer.service,
    })
    services.set(driverId, created)
    return created
  }

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
    const load = loaders.resolve(ModelDriverEntryKind.PROVIDER, specifier)
    if (!load) {
      return invalidEntrypoint(`This build has no provider module for \`${specifier}\``)
    }

    try {
      const module = (await load()) as DriverProviderModule
      const startOptions: DriverEntryStartOptions = {
        driverId,
        services: ensureServices(driverId),
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

  // --- renderer entries: one path for every kind (§5.2 step 2, §5.6) -------------------------------

  /**
   * Ask the manager which specifier an entry kind resolves to.
   *
   * `null` is the manager saying "this driver ships none of that", which is a value: the host shows no UI there
   * rather than substituting a default.
   */
  const entrySpecifier = async (request: EntrypointRequest): Promise<ContractResult<string | null>> => {
    const resolved = await client.resolveEntrypoint(request)
    if (!resolved.ok)
      return resolved
    return { ok: true, value: resolved.value === null ? null : resolved.value.specifier }
  }

  const invalidEntrypoint = (message: string): { ok: false, error: { code: ContractFailureCode, message: string } } => ({
    ok: false,
    error: { code: ContractFailureCode.INVALID_ENTRYPOINT, message },
  })

  /**
   * Resolve one kind, import the module the manager named, and hand back whatever it exported.
   *
   * There is deliberately **one** function here rather than one per kind: `ModelDriverEntryKind` is the only
   * distinction, so the kind selects the specifier and nothing else. `null` means the driver ships none of that
   * kind. What the module must export is the contract's answer per kind, and each caller below narrows it — a
   * mount module's `default`, a panels module's declarations, an import module's `createImportEntry`.
   */
  const loadEntryModule = async (request: EntrypointRequest): Promise<ContractResult<unknown>> => {
    const specifier = await entrySpecifier(request)
    if (!specifier.ok)
      return specifier
    if (specifier.value === null)
      return { ok: true, value: null }

    // The adapter imports what the manager named, through this window's build-time table. It makes no decision.
    const load = loaders.resolve(request.kind, specifier.value)
    if (!load)
      return invalidEntrypoint(`This build ships no \`${request.kind}\` module for \`${specifier.value}\``)

    try {
      return { ok: true, value: await load() }
    }
    catch (error) {
      return invalidEntrypoint(`The \`${request.kind}\` module \`${specifier.value}\` failed to load: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const mountComponent = async (input: {
    driverId: ModelDriverId
    surface: RendererMountSurfaceKind
    purpose: RendererMountPurpose
  }): Promise<ContractResult<RendererMountComponent | null>> => {
    const loaded = await loadEntryModule({
      driverId: input.driverId,
      kind: ModelDriverEntryKind.MOUNT,
      surface: input.surface,
      purpose: input.purpose,
    })
    if (!loaded.ok)
      return loaded
    if (loaded.value === null)
      return { ok: true, value: null }
    return { ok: true, value: (loaded.value as RendererMountComponentModule).default }
  }

  const panelDeclarations = async (driverId: ModelDriverId): Promise<ContractResult<ModelDriverPanelDeclaration[]>> => {
    const loaded = await loadEntryModule({ driverId, kind: ModelDriverEntryKind.PANELS })
    if (!loaded.ok)
      return loaded
    if (loaded.value === null)
      return { ok: true, value: [] }

    const module = loaded.value as DriverPanelsModule
    // Two shapes are allowed, because a driver may need its own state to name its tabs: a constant list, or a
    // function it computes lazily. A module that has neither is a declaration bug, not an empty driver.
    try {
      const declarations = 'declarations' in module
        ? await module.declarations()
        : module.default
      if (!Array.isArray(declarations))
        return invalidEntrypoint('The panels module did not resolve a declaration list')
      return { ok: true, value: declarations }
    }
    catch (error) {
      return invalidEntrypoint(`The panels module failed to resolve its declarations: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const pickerComponent = async (driverId: ModelDriverId): Promise<ContractResult<ModelPickerComponent | null>> => {
    const loaded = await loadEntryModule({ driverId, kind: ModelDriverEntryKind.PICKER })
    if (!loaded.ok)
      return loaded
    if (loaded.value === null)
      return { ok: true, value: null }
    return { ok: true, value: (loaded.value as ModelPickerComponentModule).default }
  }

  const importEntry = async (driverId: ModelDriverId): Promise<ContractResult<ModelImportEntry | null>> => {
    const loaded = await loadEntryModule({ driverId, kind: ModelDriverEntryKind.IMPORT })
    if (!loaded.ok)
      return loaded
    if (loaded.value === null)
      return { ok: true, value: null }

    try {
      // The module is a factory over the window's container, so the probe and the commit address the driver's own
      // namespace without the host having to start a provider first.
      return {
        ok: true,
        value: await (loaded.value as ModelImportEntryModule).createImportEntry({ services: ensureServices(driverId) }),
      }
    }
    catch (error) {
      return invalidEntrypoint(`The import module failed to build an entry: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

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
    mintModelId: () => minter.mintModelId(),
    mintProfileId: () => minter.mintProfileId(),
    cues,

    registerMount: async ({ driverId, surface, purpose }) => {
      // The identity is resolved first, so the host has a window to register the mount in before it issues an id.
      await windowId()
      return client.registerMount({ driverId, surface, purpose })
    },

    async unregisterMount(mountId) {
      // Released before the host is asked, because the element this window was measuring is already going away: a
      // subscription kept for it would be a listener on a box nothing measures. The host's answer does not change
      // that (P2-D16).
      pointer.release(mountId)
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

    servicesFor: driverId => services.get(driverId),

    mountComponent,
    panelDeclarations,
    pickerComponent,
    importEntry,

    deliverPromptResolution: (driverId, publication) => client.deliverPromptResolution({ driverId, publication }),

    pointer,

    dispose() {
      for (const stop of unsubscribe.splice(0))
        stop()
      for (const entry of entries.values())
        entry.dispose?.()
      entries.clear()
      services.clear()
      promptResolutions.clear()
      waiting.clear()
      earlySettlements.clear()
      observers.clear()
      pointer.dispose()
    },
  }

  return adapter
}
