/**
 * The host service: everything a host process does *with* the host core, minus the process.
 *
 * The host core (`./core/`) owns the registry, the broker, the mounts and the stores, but it answers only
 * through interfaces a host has to wire: a renderer host port, an event handler, a state file. This module is
 * the bundle of behaviour that used to live in Electron main — the operations a window may call, the entry
 * relay and its timeout, the manager-channel dispatch, the `state.json` debounce, the window-closed and
 * shutdown ordering — expressed against four ports:
 *
 *   - **transport** — deliver one message to one window, and say whether it landed;
 *   - **windows** — which renderers are live, start the shared background window, close it at shutdown;
 *   - **state** — read and write the snapshot;
 *   - **scheduler** — timers, so a test does not wait ten seconds for an entry that never answers.
 *
 * What is deliberately *not* here: resolving a sender's identity from an IPC event, creating a
 * `BrowserWindow`, reading a path. Those are the embedder's resources, and every handler below takes a
 * `windowId` the embedder has already attributed rather than trusting a payload to name one.
 */
import type {
  ContractResult,
  CueAck,
  CueEnvelopeInput,
  CueSendOptions,
  CueWithdrawalReport,
  CueWithdrawalRequest,
  EntrypointRequest,
  EntrypointResolution,
  HostLogger,
  ManagerChannel,
  ModelDriverId,
  ModelPromptPublication,
  ModelSummary,
  MountId,
  MountRegistrationResult,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
  RendererRequest,
  RequestRendererResult,
} from '../contract'
import type { ModelDriverHostState } from './client'
import type { BrokerScheduler, CueBroker } from './core/broker'
import type { LiveMountRegistry } from './core/mounts'
import type { DriverRegistry, DriverStateSnapshot, DriverTableEntry } from './core/registry'

import {
  ContractFailureCode,
  ModelDriverEntryKind,
  MountRegistrationRefusal,
  RendererRequestRefusal,
} from '../contract'
import { createCueBroker } from './core/broker'
import { createMountRegistry } from './core/mounts'
import { createDriverRegistry } from './core/registry'
import { createConsoleLogger } from './logging'

export interface ModelDriverHostStateStore {
  /** The snapshot the last run wrote, or `undefined` on a first run. */
  read: () => Promise<DriverStateSnapshot | undefined>
  write: (snapshot: DriverStateSnapshot) => Promise<void>
}

/**
 * One message the host has to hand a window.
 *
 * The host core decides *what* to say; the embedder decides how it reaches a process. Naming the messages
 * rather than exporting an event contract is what keeps this module transport-free: the embedder switches on
 * `kind` and emits its own IPC event.
 */
export type ModelDriverHostPush
  = | { kind: 'cue-settled', nonce: number, result: ContractResult<CueAck> }
    | {
      kind: 'open-entry'
      requestId: string
      driverId: ModelDriverId
      specifier: string
      surface?: RendererMountSurfaceKind
      purpose?: RendererMountPurpose
    }
    | { kind: 'manager-message', driverId: ModelDriverId, message: unknown }
    /**
     * A publication the user arbitrated, on its way back to the driver that owns the prompt (§5.4, D26).
     *
     * Addressed by driver because only the window running that driver's entry can deliver it to
     * `HostPromptService.onResolution`. It carries no ack: the host has already written the store and the card,
     * and the driver's bookkeeping failing is logged rather than retried.
     */
    | { kind: 'prompt-resolution', driverId: ModelDriverId, publication: ModelPromptPublication }

export interface ModelDriverHostTransport {
  /** Deliver one message to one window. `false` means it did not land — a closed window, or a dead context. */
  push: (windowId: string, message: ModelDriverHostPush) => boolean
}

export interface ModelDriverHostWindows {
  /** The windows that identified themselves and can host driver code. Never the background window. */
  liveWindows: () => string[]
  /** Start the shared background window, or `null` when it could not be started. */
  ensureBackgroundWindow: () => Promise<string | null>
  /** Whether it has been started, for the host-state snapshot. */
  backgroundStarted: () => boolean
  /** Close it, if it exists. Called once, at shutdown, after the last state write. */
  closeBackgroundWindow: () => Promise<void>
}

export interface ModelDriverHostServiceOptions {
  /** The static first-party table (§4.2 step 1). */
  table: DriverTableEntry[]
  state: ModelDriverHostStateStore
  transport: ModelDriverHostTransport
  windows: ModelDriverHostWindows
  logger?: HostLogger
  /** How long a window has to answer an entry request before it is refused (§4.3 `entry-failed`). */
  entryTimeoutMs?: number
  scheduler?: BrokerScheduler
}

export interface ModelDriverHostService {
  readonly mounts: LiveMountRegistry
  readonly registry: DriverRegistry
  readonly broker: CueBroker
  /** Read the declarations, create the managers, write the normalized state. Called once, at startup. */
  start: () => Promise<void>
  snapshot: () => ModelDriverHostState
  /** A window went away: drop its mounts, its channels and everything it left waiting. */
  windowClosed: (windowId: string) => Promise<void>
  shutdown: () => Promise<void>

  registerMount: (windowId: string, request: {
    driverId: ModelDriverId
    surface: RendererMountSurfaceKind
    purpose: RendererMountPurpose
  }) => Promise<MountRegistrationResult>
  unregisterMount: (windowId: string, mountId: MountId) => Promise<ContractResult<void>>
  reportReadiness: (windowId: string, request: {
    mountId: MountId
    readiness: RendererMountReadinessState
  }) => Promise<ContractResult<void>>
  submitCue: (windowId: string, envelope: CueEnvelopeInput, options?: CueSendOptions) => Promise<ContractResult<{
    nonce: number
    settledImmediately?: ContractResult<CueAck>
  }>>
  withdraw: (request: CueWithdrawalRequest) => Promise<ContractResult<CueWithdrawalReport>>
  resolveEntrypoint: (request: EntrypointRequest) => Promise<ContractResult<EntrypointResolution>>
  setEnabled: (request: { driverId: ModelDriverId, enabled: boolean }) => Promise<ContractResult<void>>
  pullRows: (request: { driverId: ModelDriverId }) => Promise<ContractResult<ModelSummary[]>>
  /** A window's answer to an entry request it was sent. Only that window, and only once. */
  entryResult: (windowId: string, payload: { requestId: string, error?: { message: string } }) => Promise<ContractResult<void>>
  /** A message the manager sent down its channel, attributed to the window that sent it. */
  managerMessage: (windowId: string, payload: { driverId: ModelDriverId, message: unknown }) => Promise<ContractResult<void>>
  /**
   * Hand an arbitrated publication back to the driver that owns it (§5.4, D26).
   *
   * The caller is the window that ran the arbitration (its card and store write already committed); this delivers
   * the pair to every window holding a manager channel for that driver, which in practice is the one running its
   * entry. `delivered: 0` is not an error the user can act on — it means no window is running the driver right
   * now — but it is reported rather than swallowed, because "the driver never heard about the decision" is a
   * fact a diagnostics surface should be able to show.
   */
  deliverPromptResolution: (windowId: string, payload: {
    driverId: ModelDriverId
    publication: ModelPromptPublication
  }) => Promise<ContractResult<{ delivered: number }>>
}

const DEFAULT_ENTRY_TIMEOUT_MS = 10_000
/** Collapse boot-time bursts of flag/row events into one write. */
const PERSIST_DEBOUNCE_MS = 250

interface PendingEntry {
  windowId: string
  timer: unknown
  resolve: (result: { ok: true } | { ok: false, message: string } | undefined) => void
}

interface ChannelEntry {
  windowId: string
  driverId: ModelDriverId
  handlers: Set<(message: unknown) => void>
}

const okVoid = (): { ok: true, value: undefined } => ({ ok: true, value: undefined })

export function createModelDriverHostService(options: ModelDriverHostServiceOptions): ModelDriverHostService {
  const logger = options.logger ?? createConsoleLogger()
  const scheduler: BrokerScheduler = options.scheduler ?? {
    now: () => Date.now(),
    setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  }
  const entryTimeoutMs = options.entryTimeoutMs ?? DEFAULT_ENTRY_TIMEOUT_MS

  const windows = options.windows
  const transport = options.transport

  /** Entry requests waiting for a window to answer. */
  const pendingEntries = new Map<string, PendingEntry>()
  /** Manager channels, per window and driver. */
  const channels = new Map<string, ChannelEntry>()

  let entrySequence = 0
  let shuttingDown = false
  let persistTimer: unknown
  let writeChain: Promise<void> = Promise.resolve()

  const channelKey = (windowId: string, driverId: ModelDriverId) => `${windowId}\u0000${driverId}`

  const mounts = createMountRegistry()

  const registry = createDriverRegistry({
    mounts,
    rendererHost: {
      liveWindows: () => windows.liveWindows(),
      ensureBackgroundWindow: () => windows.ensureBackgroundWindow(),
      openProviderEntry: (windowId, request) => openProviderEntry(windowId, request),
    },
    logger,
  })

  const broker = createCueBroker({
    mounts,
    getManager: driverId => registry.get(driverId),
    isDriverKnown: driverId => registry.isKnown(driverId),
    logger,
    scheduler,
    deliver: (windowId, nonce, result) => {
      // Acceptance already happened; this is the settlement, delivered to the adapter that asked rather than
      // decided there (§4.4 step 7).
      transport.push(windowId, { kind: 'cue-settled', nonce, result })
    },
  })

  // A mount moving to a ready state is what makes a queued transaction deliverable (§4.4 step 3).
  mounts.onChanged(() => broker.pump())

  const flushState = (): Promise<void> => {
    if (persistTimer !== undefined) {
      scheduler.clearTimeout(persistTimer)
      persistTimer = undefined
    }

    const snapshot: DriverStateSnapshot = registry.snapshot()
    writeChain = writeChain
      .then(() => options.state.write(snapshot))
      .catch((error) => {
        logger.warn('model-drivers', 'Could not write the host state file', error)
      })
    return writeChain
  }

  const schedulePersist = () => {
    if (persistTimer !== undefined)
      scheduler.clearTimeout(persistTimer)
    persistTimer = scheduler.setTimeout(() => {
      persistTimer = undefined
      void flushState()
    }, PERSIST_DEBOUNCE_MS)
  }

  registry.onEvent((event) => {
    // `rows` means the cache was just written from a real read, so it is worth persisting. The re-read on a
    // `model-list-changed` happens in the host core, not here (P1-D20).
    if (event.kind === 'flags' || event.kind === 'rows')
      schedulePersist()
  })

  const channelFor = (windowId: string, driverId: ModelDriverId): ManagerChannel => {
    const key = channelKey(windowId, driverId)
    const existing = channels.get(key)
    if (existing) {
      return {
        send: message => transport.push(windowId, { kind: 'manager-message', driverId, message }),
        onMessage: (handler) => {
          existing.handlers.add(handler)
          return () => {
            existing.handlers.delete(handler)
          }
        },
      }
    }

    const entry: ChannelEntry = { windowId, driverId, handlers: new Set() }
    channels.set(key, entry)

    return {
      send: message => transport.push(windowId, { kind: 'manager-message', driverId, message }),
      onMessage: (handler) => {
        entry.handlers.add(handler)
        return () => {
          entry.handlers.delete(handler)
        }
      },
    }
  }

  /**
   * Ask one window for a driver's provider entry (§4.3 `openProviderEntry`).
   *
   * The manager names the specifier — this function only relays it; the window imports it through its own
   * loader table (§4.7 step 3-4). A window that never answers is refused rather than awaited forever.
   */
  async function openProviderEntry(windowId: string, request: RendererRequest): Promise<RequestRendererResult> {
    const resolution = await registry.resolveEntrypoint({
      driverId: request.driverId,
      kind: ModelDriverEntryKind.PROVIDER,
      ...(request.surface !== undefined ? { surface: request.surface } : {}),
      ...(request.purpose !== undefined ? { purpose: request.purpose } : {}),
    })

    if (!resolution.ok) {
      logger.warn('model-drivers', `No provider entry for \`${request.driverId}\`: ${resolution.error.message}`)
      return { ok: false, reason: RendererRequestRefusal.ENTRY_FAILED }
    }
    if (resolution.value === null) {
      // `null` means "this driver ships no provider entry", which is a declaration problem, not a window one.
      logger.warn('model-drivers', `Driver \`${request.driverId}\` resolved no provider entry`)
      return { ok: false, reason: RendererRequestRefusal.ENTRY_FAILED }
    }

    const specifier = resolution.value.specifier

    entrySequence += 1
    const requestId = `entry_${entrySequence}`

    const answer = await new Promise<{ ok: true } | { ok: false, message: string } | undefined>((resolve) => {
      const timer = scheduler.setTimeout(() => {
        pendingEntries.delete(requestId)
        logger.warn('model-drivers', `Window \`${windowId}\` did not answer entry request \`${requestId}\``)
        resolve(undefined)
      }, entryTimeoutMs)

      pendingEntries.set(requestId, { windowId, timer, resolve })

      const delivered = transport.push(windowId, {
        kind: 'open-entry',
        requestId,
        driverId: request.driverId,
        specifier,
        ...(request.surface !== undefined ? { surface: request.surface } : {}),
        ...(request.purpose !== undefined ? { purpose: request.purpose } : {}),
      })

      if (!delivered) {
        scheduler.clearTimeout(timer)
        pendingEntries.delete(requestId)
        resolve(undefined)
      }
    })

    if (!answer || !answer.ok)
      return { ok: false, reason: RendererRequestRefusal.ENTRY_FAILED }

    return { ok: true, channel: channelFor(windowId, request.driverId) }
  }

  function snapshot(): ModelDriverHostState {
    const state = registry.snapshot()
    return {
      drivers: registry.listDrivers(),
      rows: state.rows,
      rowsUpdatedAt: state.rowsUpdatedAt,
      rejections: registry.rejections().map(rejection => ({
        driverId: rejection.driverId,
        message: rejection.error.message,
      })),
      legacyRetention: state.legacyRetention,
      backgroundWindowStarted: windows.backgroundStarted(),
    }
  }

  return {
    mounts,
    registry,
    broker,

    async start() {
      const persisted = await options.state.read()
      await registry.load(options.table, persisted)
      // Writing once at boot normalizes the file: first run creates it, and a refused declaration is recorded
      // where the next boot will read the same flags.
      await flushState()
    },

    snapshot,

    async windowClosed(windowId) {
      for (const [requestId, pending] of [...pendingEntries]) {
        if (pending.windowId !== windowId)
          continue
        scheduler.clearTimeout(pending.timer)
        pendingEntries.delete(requestId)
        pending.resolve(undefined)
      }

      // The transactions are settled before the mounts are dropped, because unregistering emits a change that
      // pumps the broker — and a pump with no candidates would settle queued work `NO_TARGET` instead of
      // reporting that the window it was waiting on went away (§4.4 step 8).
      const affected = new Set((await mounts.findBy({ windowId })).map(mount => mount.modelDriverId))
      broker.windowClosed({ windowId, drivers: affected })

      await mounts.unregisterWindow(windowId)

      registry.forgetManagerChannels(windowId)

      for (const key of [...channels.keys()]) {
        if (key.startsWith(`${windowId}\u0000`))
          channels.delete(key)
      }
    },

    async shutdown() {
      if (shuttingDown)
        return
      shuttingDown = true

      broker.shutdown()

      for (const [requestId, pending] of [...pendingEntries]) {
        scheduler.clearTimeout(pending.timer)
        pendingEntries.delete(requestId)
        pending.resolve(undefined)
      }

      await registry.release()
      await flushState()

      channels.clear()

      // The host started the window for the registry, so the host closes it (D11, §4.3 `Quit`).
      await windows.closeBackgroundWindow()
    },

    async registerMount(windowId, request) {
      if (shuttingDown)
        return { ok: false, reason: MountRegistrationRefusal.SHUTTING_DOWN }

      if (!registry.isEnabled(request.driverId))
        return { ok: false, reason: MountRegistrationRefusal.DRIVER_DISABLED }

      const descriptor = await mounts.issue({
        driverId: request.driverId,
        surface: request.surface,
        purpose: request.purpose,
        windowId,
      })

      return { ok: true, mountId: descriptor.mountId }
    },

    async unregisterMount(windowId, mountId) {
      const owned = (await mounts.findBy({ windowId })).some(mount => mount.mountId === mountId)
      if (!owned)
        return fail(ContractFailureCode.INTERNAL, `Mount \`${mountId}\` is not live in this window`)

      const result = await mounts.unregister(mountId)
      return result.ok ? okVoid() : result
    },

    async reportReadiness(windowId, request) {
      const owned = (await mounts.findBy({ windowId })).some(mount => mount.mountId === request.mountId)
      if (!owned)
        return fail(ContractFailureCode.INTERNAL, `Mount \`${request.mountId}\` is not live in this window`)

      const updated = await mounts.update(request.mountId, { readiness: request.readiness })
      return updated.ok ? okVoid() : updated
    },

    async submitCue(windowId, envelope, sendOptions) {
      const submitted = await broker.submit(windowId, envelope, sendOptions)
      if (!submitted.ok)
        return submitted

      return {
        ok: true,
        value: {
          nonce: submitted.value.nonce,
          ...(submitted.value.immediate ? { settledImmediately: submitted.value.immediate } : {}),
        },
      }
    },

    withdraw: request => broker.withdraw(request),
    resolveEntrypoint: request => registry.resolveEntrypoint(request),
    setEnabled: request => registry.setEnabled(request.driverId, request.enabled),
    pullRows: request => registry.refreshRows(request.driverId),

    async entryResult(windowId, payload) {
      const pending = pendingEntries.get(payload.requestId)

      // Only the window the request went to may answer it, and only once.
      if (!pending || pending.windowId !== windowId)
        return fail(ContractFailureCode.INTERNAL, `Entry request \`${payload.requestId}\` was not sent to this window`)

      scheduler.clearTimeout(pending.timer)
      pendingEntries.delete(payload.requestId)
      pending.resolve(payload.error ? { ok: false, message: payload.error.message } : { ok: true })
      return okVoid()
    },

    async managerMessage(windowId, payload) {
      const channel = channels.get(channelKey(windowId, payload.driverId))
      if (!channel)
        return fail(ContractFailureCode.INTERNAL, `No manager channel for \`${payload.driverId}\` in this window`)

      for (const handler of [...channel.handlers]) {
        try {
          handler(payload.message)
        }
        catch (error) {
          logger.warn('model-drivers', `A manager-channel listener threw for \`${payload.driverId}\``, error)
        }
      }

      return okVoid()
    },

    async deliverPromptResolution(_windowId, payload) {
      // Two kinds of window can run a driver's code, and neither implies the other (P1-D19): the one the manager
      // opened a channel to, and the one holding a mount — a surface starts its own entry with `ensureEntry`, so a
      // window can run the driver without any manager channel ever existing for it. Both are addressed by driver.
      const channelWindows = [...channels.entries()]
        .filter(([, channel]) => channel.driverId === payload.driverId)
        .map(([key]) => key.slice(0, key.indexOf('\u0000')))
      const mountWindows = (await mounts.findBy({ modelDriverId: payload.driverId }))
        .map(mount => mount.windowId)

      // Addressed by driver, not broadcast: a window that does not run this driver's entry has nothing to hand
      // the pair to, and the adapter drops it if it does arrive (it is a missing capability, not an error).
      let delivered = 0
      for (const target of new Set([...channelWindows, ...mountWindows])) {
        const landed = transport.push(target, {
          kind: 'prompt-resolution',
          driverId: payload.driverId,
          publication: payload.publication,
        })
        if (landed)
          delivered += 1
      }

      if (delivered === 0) {
        return fail(
          ContractFailureCode.DRIVER_UNAVAILABLE,
          `No window is running \`${payload.driverId}\`, so the resolved prompt could not be handed back to it`,
        )
      }

      return { ok: true, value: { delivered } }
    },
  }
}

function fail(code: ContractFailureCode, message: string): { ok: false, error: { code: ContractFailureCode, message: string } } {
  return { ok: false, error: { code, message } }
}
