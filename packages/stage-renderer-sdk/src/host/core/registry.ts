/**
 * The driver registry: declarations, managers, enable flags, row cache and renderer requests (§4.2).
 *
 * This is the main-process half of the host. It holds exactly what the plan says it may hold — the
 * declarations it read, the enabled flags it persisted, the managers it created, the last successful row
 * pull — and nothing else. In particular it holds **no runtime, no probe result and no storage**: a
 * runtime only exists in a renderer window, a probe result is that window's answer, and storage lives
 * there too (D1). A manager that needs any of them asks `requestRenderer` and works in a window.
 *
 * Three rules from §4.2/§4.3 are structural here rather than documented elsewhere:
 *
 *   - **declarations are read before any driver code runs.** A manifest is validated (shape, then
 *     contract revision, then `entry.manager` against the table) *before* the manager module is loaded, so
 *     a driver this build cannot speak to never has code evaluated on its behalf;
 *   - **the registry owns one manager per driver, created once and released at shutdown.** There is no
 *     election, no lock and no ownership handoff;
 *   - **a manager gets a `RegistryHandle` and no storage.** The handle is the only way it can reach a
 *     window, which is what keeps an id, a model list and a prompt from being answered in main.
 */
import type {
  ContractFailure,
  ContractResult,
  DriverInfo,
  EntrypointRequest,
  EntrypointResolution,
  HostLogger,
  ManagerChannel,
  ModelDriverId,
  ModelDriverManager,
  ModelDriverManagerFactory,
  ModelDriverManifest,
  ModelSummary,
  RegistryHandle,
  RendererMountPurpose,
  RendererMountSurfaceKind,
  RendererRequest,
  RequestRendererResult,
  Unsubscribe,
} from '../../contract'
import type { LiveMountRegistry } from './mounts'

import {
  ContractFailureCode,
  DriverStatus,
  RendererRequestRefusal,
} from '../../contract'
import { validateManifest } from '../../validate'
/** One window's pipe to a driver's renderer half, tagged with the address it was opened for. */
interface ManagerChannelEntry {
  windowId: string
  driverId: ModelDriverId
  channel: ManagerChannel
  surface?: RendererMountSurfaceKind
  purpose?: RendererMountPurpose
}

/**
 * A window that can run a driver's renderer code.
 *
 * The registry does not open windows: it asks. That is the whole seam between "the host decides policy"
 * and "Electron owns a `BrowserWindow`" — and it is why the same registry runs unchanged in Web/Pocket,
 * where the only window is the page itself.
 */
export interface RendererHostPort {
  /** Renderer windows that are live right now, excluding the shared background window. */
  liveWindows: () => string[]
  /** Bring the shared background window up (lazily, once) and return its id, or `null` when it cannot start. */
  ensureBackgroundWindow: () => Promise<string | null>
  /**
   * Run one driver's provider entry in one window and open a manager channel to it.
   *
   * `driver-disabled` and `shutting-down` are decided here by the registry before this is called, so an
   * implementation only answers the two window-shaped refusals: `window-unavailable` and `entry-failed`.
   */
  openProviderEntry: (
    windowId: string,
    request: RendererRequest,
  ) => Promise<{ ok: true, channel: ManagerChannel } | { ok: false, reason: RendererRequestRefusal }>
}

/** One driver the host knows how to load, named statically so main never imports an unchecked specifier. */
export interface DriverTableEntry {
  /** The id this entry expects the declaration to carry; a mismatch is refused as a wrong module. */
  driverId: ModelDriverId
  /** The manifest module's specifier, for diagnostics. */
  manifestSpecifier: string
  /** The specifier `manifest.entry.manager` must name. */
  managerSpecifier: string
  /** Loads and returns the manifest module's exported declaration. */
  loadManifest: () => Promise<unknown>
  /** Loads and returns the manager module's `createManager`. */
  loadManager: () => Promise<ModelDriverManagerFactory>
}

export interface DriverStateSnapshot {
  version: 1
  /** Persisted enable flags. Absent means "first run", which defaults to enabled. */
  enabled: Record<ModelDriverId, boolean>
  /** The last successful row pull per driver, for display while no renderer is up. */
  rows: Record<ModelDriverId, ModelSummary[]>
  /** When each of those pulls happened. */
  rowsUpdatedAt: Record<ModelDriverId, number>
  /**
   * `legacy-retention/{driverId}`, owned by main's `state.json` (§4.5).
   *
   * Reserved here because the snapshot is the single owner of the persisted host state; migration (Phase
   * 2) is the only writer.
   */
  legacyRetention: Record<ModelDriverId, boolean>
}

export function emptyDriverStateSnapshot(): DriverStateSnapshot {
  return { version: 1, enabled: {}, rows: {}, rowsUpdatedAt: {}, legacyRetention: {} }
}

/** A declaration the host refused, with the reason it can show. */
export interface DriverRejection {
  driverId: ModelDriverId
  specifier: string
  error: ContractFailure
}

/**
 * Something the registry changed or was told.
 *
 * `model-list-changed` is deliberately not `rows`: a driver saying "my list changed" carries no list, and a
 * host that could not tell the two apart would either persist a cache it never refreshed or re-pull on its own
 * completed pull and loop. `model-list-changed` means "the authoritative store moved — go read it"; `rows`
 * means "the cache was just written from a real read".
 *
 * `channel-closed` exists because the registry owns the channel: it opened it, cached it, and it is the only
 * party told when the window died. The manager that was using it cannot see that, so the loss is reported here
 * and forwarded to that manager alone (P1-D23).
 */
export type DriverRegistryEvent
  = | { kind: 'declarations' }
    | { kind: 'flags', driverId: ModelDriverId }
    | { kind: 'rows', driverId: ModelDriverId }
    | { kind: 'model-list-changed', driverId: ModelDriverId }
    | { kind: 'manager', driverId: ModelDriverId, ok: boolean }
    | {
      kind: 'channel-closed'
      driverId: ModelDriverId
      windowId: string
      surface?: RendererMountSurfaceKind
      purpose?: RendererMountPurpose
    }

export interface DriverRegistryDependencies {
  mounts: LiveMountRegistry
  rendererHost: RendererHostPort
  logger: HostLogger
  now?: () => number
}

export interface DriverRegistry {
  /**
   * Read the table, validate every declaration, then create the managers.
   *
   * Called once at startup, before anything else touches a driver. Loading is separated from creation so
   * the "declarations before code" order is visible in one place rather than implied by call order.
   */
  load: (entries: DriverTableEntry[], state?: DriverStateSnapshot) => Promise<void>
  listDrivers: () => DriverInfo[]
  get: (driverId: ModelDriverId) => ModelDriverManager | undefined
  manifestOf: (driverId: ModelDriverId) => ModelDriverManifest | undefined
  isEnabled: (driverId: ModelDriverId) => boolean
  isKnown: (driverId: ModelDriverId) => boolean
  setEnabled: (driverId: ModelDriverId, enabled: boolean) => Promise<ContractResult<void>>
  /** Pull one driver's rows. The cache is written **only** from a successful pull. */
  refreshRows: (driverId: ModelDriverId) => Promise<ContractResult<ModelSummary[]>>
  getRows: (driverId: ModelDriverId) => ModelSummary[]
  /** Cache rows the app already has (a restored snapshot). Never used as a source of truth. */
  primeRows: (rows: Record<ModelDriverId, ModelSummary[]>, at?: Record<ModelDriverId, number>) => void
  requestRenderer: (request: RendererRequest) => Promise<RequestRendererResult>
  /**
   * A window went away: every channel it served is gone, the next request has to open one again, and each
   * manager that held one is told which address it lost (`channel-closed`).
   *
   * Window-scoped because that is the event. The caller does not have to know which drivers had channels
   * there — and a window that served an entry without ever mounting the driver must not be missed.
   */
  forgetManagerChannels: (windowId: string) => void
  resolveEntrypoint: (request: EntrypointRequest) => Promise<ContractResult<EntrypointResolution>>
  /** Re-create every manager, as a main-process restart does (§4.9 criterion 3). Rows survive. */
  restartManagers: () => Promise<void>
  release: () => Promise<void>
  /**
   * Record whether the driver has retained the legacy copies of its models (`legacy-retention/{driverId}`).
   *
   * Reserved for migration (Phase 2). It lives in this snapshot because `state.json` is the **single
   * owner** of that flag (§4.5): a renderer reads it over IPC and never writes it, so keeping a second
   * copy anywhere would be a second answer.
   */
  setLegacyRetention: (driverId: ModelDriverId, retained: boolean) => void
  snapshot: () => DriverStateSnapshot
  rejections: () => DriverRejection[]
  onEvent: (handler: (event: DriverRegistryEvent) => void) => Unsubscribe
}

export function createDriverRegistry(deps: DriverRegistryDependencies): DriverRegistry {
  const now = deps.now ?? Date.now
  const logger = deps.logger

  const entries = new Map<ModelDriverId, DriverTableEntry>()
  const manifests = new Map<ModelDriverId, ModelDriverManifest>()
  const managers = new Map<ModelDriverId, ModelDriverManager>()
  const managerErrors = new Map<ModelDriverId, ContractFailure>()
  const enabled = new Map<ModelDriverId, boolean>()
  const rows = new Map<ModelDriverId, ModelSummary[]>()
  const rowsUpdatedAt = new Map<ModelDriverId, number>()
  const legacyRetention = new Map<ModelDriverId, boolean>()
  const rejections = new Map<ModelDriverId, DriverRejection>()
  /**
   * Channels to renderers, keyed by window, driver **and the address the channel was opened for**.
   *
   * The address is part of the identity because a channel is one window's pipe, and a window is only the right
   * pipe for a given address if it holds a mount there. A pull that asks for "any renderer" may be served by a
   * window with no `acting` mount at all; reusing that channel for a `{ surface: 'acting' }` delivery would send
   * the cue to a window that can only answer `NO_TARGET` while the window that does hold the mount never hears
   * about it.
   */
  const channels = new Map<string, ManagerChannelEntry>()
  const handlers = new Set<(event: DriverRegistryEvent) => void>()
  const modelSubscriptions = new Map<ModelDriverId, Unsubscribe>()
  /** The `onChange` subscriptions each live manager made, dropped with it. */
  const handleDisposers = new Map<ModelDriverId, () => void>()

  let shuttingDown = false
  let loaded = false

  const channelKey = (
    windowId: string,
    driverId: ModelDriverId,
    surface?: RendererMountSurfaceKind,
    purpose?: RendererMountPurpose,
  ) => `${windowId}\u0000${driverId}\u0000${surface ?? '*'}\u0000${purpose ?? '*'}`

  // Assigned at the end of this factory: `handleFor` and the manager factory refer to the registry object itself,
  // and the object cannot exist before the functions it is built from.
  let registry: DriverRegistry

  const emit = (event: DriverRegistryEvent) => {
    for (const handler of [...handlers]) {
      try {
        handler(event)
      }
      catch {
        // One listener throwing must not stop the host from emitting the others.
      }
    }
  }

  const statusOf = (driverId: ModelDriverId): DriverStatus => {
    if (!manifests.has(driverId))
      return DriverStatus.NOT_INSTALLED
    if (managerErrors.has(driverId))
      return DriverStatus.ERROR
    return enabled.get(driverId) ? DriverStatus.ENABLED : DriverStatus.DISABLED
  }

  const isEnabled = (driverId: ModelDriverId): boolean => {
    if (!manifests.has(driverId))
      return false
    return enabled.get(driverId) ?? true
  }

  /**
   * One handle per manager instance, and the subscriptions that instance made.
   *
   * A manager is not given a dispose verb by the contract, so the host has to own the teardown: without this,
   * every restart would leave the released manager subscribed to `onChange`, still reacting to channels that
   * belong to a manager that no longer exists.
   */
  const createHandle = (driverId: ModelDriverId): { handle: RegistryHandle, dispose: () => void } => {
    const subscriptions = new Set<Unsubscribe>()

    const handle: RegistryHandle = {
      log: logger,
      requestRenderer: async request => registry.requestRenderer({ ...request, driverId }),
      listDrivers: () => registry.listDrivers(),
      isEnabled: id => isEnabled(id),
      // A manager hears about driver-level changes and about its own lost channels, and nothing else: a row
      // write is the host's bookkeeping, and `model-list-changed` came from this very manager.
      onChange: (handler) => {
        const unsubscribe = registry.onEvent((event) => {
          if (event.kind === 'channel-closed') {
            if (event.driverId !== driverId)
              return
            handler({
              kind: 'channel-closed',
              driverId: event.driverId,
              windowId: event.windowId,
              ...(event.surface === undefined ? {} : { surface: event.surface }),
              ...(event.purpose === undefined ? {} : { purpose: event.purpose }),
            })
            return
          }

          if (event.kind === 'rows' || event.kind === 'model-list-changed')
            return

          handler({ kind: 'drivers' })
        })

        const off = () => {
          subscriptions.delete(off)
          unsubscribe()
        }
        subscriptions.add(off)
        return off
      },
    }

    return {
      handle,
      dispose: () => {
        for (const off of [...subscriptions])
          off()
      },
    }
  }

  const createManagerFor = async (driverId: ModelDriverId): Promise<boolean> => {
    const entry = entries.get(driverId)
    if (!entry)
      return false

    let dispose: (() => void) | undefined

    try {
      const factory = await entry.loadManager()
      const created = createHandle(driverId)
      dispose = created.dispose
      const manager = await factory(created.handle)
      if (!manager || typeof manager.deliver !== 'function') {
        dispose()
        throw new TypeError('createManager returned something that is not a ModelDriverManager')
      }
      managers.set(driverId, manager)
      handleDisposers.set(driverId, dispose)
      managerErrors.delete(driverId)

      // A manager saying "my list changed" is a signal to pull, never a payload: the row cache is written by
      // `refreshRows` from a successful pull only (§4.3). The re-read happens *here*, in the host core, rather
      // than in every embedder: the window is the authority (P1-D20), a host that only re-read when some
      // surface asked would persist a stale projection, and the pull emits `rows` rather than this event, so
      // the read cannot start another one.
      const unsubscribe = manager.onModelsChanged(() => {
        emit({ kind: 'model-list-changed', driverId })
        void registry.refreshRows(driverId)
      })
      modelSubscriptions.set(driverId, unsubscribe)

      emit({ kind: 'manager', driverId, ok: true })
      return true
    }
    catch (error) {
      // A manager that subscribed before throwing must not stay attached to a registry that discarded it.
      dispose?.()
      handleDisposers.delete(driverId)
      const failure: ContractFailure = {
        code: ContractFailureCode.INTERNAL,
        message: `Driver \`${driverId}\` failed to create a manager`,
        cause: error,
      }
      managerErrors.set(driverId, failure)
      logger.error('model-drivers', failure.message, error)
      emit({ kind: 'manager', driverId, ok: false })
      return false
    }
  }

  const releaseManager = (driverId: ModelDriverId) => {
    modelSubscriptions.get(driverId)?.()
    modelSubscriptions.delete(driverId)
    handleDisposers.get(driverId)?.()
    handleDisposers.delete(driverId)
    managers.delete(driverId)
  }

  registry = {
    async load(table, state) {
      if (loaded) {
        // A second `load` would replace managers that windows already hold channels to. Restarting is
        // `restartManagers`, which is explicit about it.
        logger.warn('model-drivers', 'load() called twice; ignoring the second table')
        return
      }
      loaded = true

      const snapshot = state ?? emptyDriverStateSnapshot()

      // --- 1. declarations only ---------------------------------------------------------------
      for (const entry of table) {
        entries.set(entry.driverId, entry)

        let declared: unknown
        try {
          declared = await entry.loadManifest()
        }
        catch (error) {
          rejections.set(entry.driverId, {
            driverId: entry.driverId,
            specifier: entry.manifestSpecifier,
            error: {
              code: ContractFailureCode.INTERNAL,
              message: `Could not load the declaration of \`${entry.driverId}\``,
              cause: error,
            },
          })
          continue
        }

        // The table is static, so a module that is not the one the table named is refused before its
        // manager is ever loaded.
        const validated = validateManifest(declared)
        if (!validated.ok) {
          rejections.set(entry.driverId, { driverId: entry.driverId, specifier: entry.manifestSpecifier, error: validated.error })
          logger.error('model-drivers', `Refused declaration for \`${entry.driverId}\`: ${validated.error.message}`)
          continue
        }

        const manifest = validated.value
        if (manifest.id !== entry.driverId) {
          rejections.set(entry.driverId, {
            driverId: entry.driverId,
            specifier: entry.manifestSpecifier,
            error: {
              code: ContractFailureCode.INVALID_PACKAGE,
              message: `The table names \`${entry.driverId}\` but the module declares \`${manifest.id}\``,
            },
          })
          continue
        }

        if (manifest.entry.manager !== entry.managerSpecifier) {
          rejections.set(entry.driverId, {
            driverId: entry.driverId,
            specifier: entry.manifestSpecifier,
            error: {
              code: ContractFailureCode.INVALID_ENTRYPOINT,
              message: `\`entry.manager\` names \`${manifest.entry.manager}\` but the table loads \`${entry.managerSpecifier}\``,
            },
          })
          continue
        }

        manifests.set(entry.driverId, manifest)
        rejections.delete(entry.driverId)
        // First run defaults to enabled; a persisted flag wins, including a persisted `false`.
        enabled.set(entry.driverId, snapshot.enabled[entry.driverId] ?? true)
      }

      for (const [driverId, cached] of Object.entries(snapshot.rows))
        rows.set(driverId, cached)
      for (const [driverId, at] of Object.entries(snapshot.rowsUpdatedAt))
        rowsUpdatedAt.set(driverId, at)
      for (const [driverId, retained] of Object.entries(snapshot.legacyRetention))
        legacyRetention.set(driverId, retained)

      emit({ kind: 'declarations' })

      // --- 2. managers, for the declarations that survived --------------------------------------
      // Only for enabled drivers: `setEnabled(false)` releases the manager, so creating one for a driver
      // the user turned off would make the flag mean two different things depending on when it was read.
      for (const driverId of manifests.keys()) {
        if (enabled.get(driverId) ?? true)
          await createManagerFor(driverId)
      }
    },

    listDrivers() {
      const ids = new Set<ModelDriverId>([...manifests.keys(), ...rejections.keys()])
      return [...ids].sort().map<DriverInfo>((driverId) => {
        const manifest = manifests.get(driverId)
        return {
          driverId,
          name: manifest?.name ?? driverId,
          ...(manifest ? { version: manifest.driverVersion } : {}),
          status: statusOf(driverId),
          hasManager: managers.has(driverId),
        }
      })
    },

    get: driverId => managers.get(driverId),

    manifestOf: driverId => manifests.get(driverId),

    isEnabled,

    isKnown: driverId => manifests.has(driverId),

    async setEnabled(driverId, next) {
      if (!manifests.has(driverId)) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.DRIVER_UNAVAILABLE,
            message: `No driver \`${driverId}\` is registered`,
          },
        }
      }

      enabled.set(driverId, next)
      emit({ kind: 'flags', driverId })

      if (next) {
        // Enabling a driver that failed to create a manager retries creation: the user's action is the
        // only thing that could have changed since, and leaving a permanently broken manager registered
        // would make the toggle a no-op.
        if (!managers.has(driverId))
          await createManagerFor(driverId)
      }
      else {
        // Disabling releases the manager, so nothing of it can answer after the user turned it off.
        releaseManager(driverId)
      }

      return { ok: true, value: undefined }
    },

    async refreshRows(driverId) {
      const manager = managers.get(driverId)
      if (!manager) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.DRIVER_UNAVAILABLE,
            message: `Driver \`${driverId}\` has no manager`,
          },
        }
      }

      let result: ContractResult<ModelSummary[]>
      try {
        result = await manager.listModels()
      }
      catch (error) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.INTERNAL,
            message: `Driver \`${driverId}\` threw while listing models`,
            cause: error,
          },
        }
      }

      if (!result.ok) {
        // Never override `ok: false`: a failed pull leaves the previous cache in place, because a stale
        // list is a better answer than an empty one.
        logger.warn('model-drivers', `Listing models failed for \`${driverId}\`: ${result.error.message}`)
        return result
      }

      rows.set(driverId, result.value)
      rowsUpdatedAt.set(driverId, now())
      emit({ kind: 'rows', driverId })
      return result
    },

    getRows: driverId => rows.get(driverId) ?? [],

    primeRows(cached, at) {
      for (const [driverId, value] of Object.entries(cached))
        rows.set(driverId, value)
      for (const [driverId, value] of Object.entries(at ?? {}))
        rowsUpdatedAt.set(driverId, value)
    },

    async requestRenderer(request) {
      if (shuttingDown)
        return { ok: false, reason: RendererRequestRefusal.SHUTTING_DOWN }

      if (!isEnabled(request.driverId))
        return { ok: false, reason: RendererRequestRefusal.DRIVER_DISABLED }

      // 1. A channel this driver already has *for this address* is the cheapest reuse there is: the entry is
      //    running in that window and nothing has to be started. The address has to match, because the window
      //    that answered "any renderer" for a row pull may hold no mount for the surface a cue names.
      for (const cached of channels.values()) {
        if (cached.driverId !== request.driverId)
          continue
        if (cached.surface !== request.surface || cached.purpose !== request.purpose)
          continue
        return { ok: true, channel: cached.channel }
      }

      // 2. A live renderer that already serves the named surface, then any live renderer.
      let lastReason: RendererRequestRefusal | undefined
      for (const windowId of rankWindows(request)) {
        const opened = await deps.rendererHost.openProviderEntry(windowId, request)
        if (opened.ok) {
          channels.set(channelKey(windowId, request.driverId, request.surface, request.purpose), {
            windowId,
            driverId: request.driverId,
            channel: opened.channel,
            ...(request.surface === undefined ? {} : { surface: request.surface }),
            ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
          })
          return { ok: true, channel: opened.channel }
        }
        lastReason = opened.reason
      }

      // 3. The shared background window, which is what makes a request work when no stage is open.
      const backgroundId = await deps.rendererHost.ensureBackgroundWindow()
      if (backgroundId === null)
        return { ok: false, reason: lastReason ?? RendererRequestRefusal.WINDOW_UNAVAILABLE }

      const opened = await deps.rendererHost.openProviderEntry(backgroundId, request)
      if (opened.ok) {
        channels.set(channelKey(backgroundId, request.driverId, request.surface, request.purpose), {
          windowId: backgroundId,
          driverId: request.driverId,
          channel: opened.channel,
          ...(request.surface === undefined ? {} : { surface: request.surface }),
          ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
        })
        return { ok: true, channel: opened.channel }
      }
      return { ok: false, reason: opened.reason }
    },

    forgetManagerChannels(windowId) {
      // Every address that window was serving: the entry it hosted is gone, so none of them may be reused.
      // Collected first, then deleted, then reported — a manager reacting to the report may ask for a renderer
      // immediately, and a new channel must not be collected by this same pass.
      const closed: ManagerChannelEntry[] = []
      for (const [key, cached] of channels) {
        if (cached.windowId !== windowId)
          continue
        channels.delete(key)
        closed.push(cached)
      }

      for (const cached of closed) {
        emit({
          kind: 'channel-closed',
          driverId: cached.driverId,
          windowId: cached.windowId,
          ...(cached.surface === undefined ? {} : { surface: cached.surface }),
          ...(cached.purpose === undefined ? {} : { purpose: cached.purpose }),
        })
      }
    },

    async resolveEntrypoint(request) {
      const manager = managers.get(request.driverId)
      if (!manager) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.DRIVER_UNAVAILABLE,
            message: `Driver \`${request.driverId}\` has no manager to resolve an entry point`,
          },
        }
      }
      try {
        return await manager.resolveEntrypoint(request)
      }
      catch (error) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.INVALID_ENTRYPOINT,
            message: `Driver \`${request.driverId}\` threw while resolving an entry point`,
            cause: error,
          },
        }
      }
    },

    async restartManagers() {
      // A main-process restart does not lose persisted state: flags and rows stay, managers are re-created,
      // and every channel is gone — so the next pull asks a window for the driver's code again.
      for (const driverId of [...managers.keys()])
        releaseManager(driverId)
      channels.clear()
      for (const driverId of manifests.keys()) {
        if (enabled.get(driverId) ?? true)
          await createManagerFor(driverId)
      }
    },

    async release() {
      shuttingDown = true
      for (const unsubscribe of modelSubscriptions.values()) {
        try {
          unsubscribe()
        }
        catch {
          // Releasing a subscription twice is not a reason to leave a manager attached.
        }
      }
      modelSubscriptions.clear()
      for (const dispose of handleDisposers.values()) {
        try {
          dispose()
        }
        catch {
          // Same rule for a manager's own subscriptions: teardown continues.
        }
      }
      handleDisposers.clear()
      // Managers have no lifecycle verb of their own (D1): `deactivate` belongs to the runtime, which lives
      // in a window. Dropping the reference is the whole of the registry's teardown.
      managers.clear()
      channels.clear()
    },

    setLegacyRetention(driverId, retained) {
      legacyRetention.set(driverId, retained)
    },

    snapshot() {
      const state = emptyDriverStateSnapshot()
      for (const [driverId, value] of enabled)
        state.enabled[driverId] = value
      for (const [driverId, value] of rows)
        state.rows[driverId] = value
      for (const [driverId, value] of rowsUpdatedAt)
        state.rowsUpdatedAt[driverId] = value
      for (const [driverId, retained] of legacyRetention)
        state.legacyRetention[driverId] = retained
      return state
    },

    rejections: () => [...rejections.values()],

    onEvent(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }

  /** Live windows ranked by how well they can serve the request: surface-serving first. */
  function rankWindows(request: RendererRequest): string[] {
    const live = deps.rendererHost.liveWindows()
    const serving = new Set(
      deps.mounts
        .snapshot()
        .filter((mount) => {
          if (request.surface !== undefined && mount.surface !== request.surface)
            return false
          if (request.purpose !== undefined && mount.purpose !== request.purpose)
            return false
          return true
        })
        .map(mount => mount.windowId),
    )

    return [...live].sort((left, right) => {
      const leftServing = serving.has(left) ? 0 : 1
      const rightServing = serving.has(right) ? 0 : 1
      return leftServing - rightServing
    })
  }

  return registry
}
