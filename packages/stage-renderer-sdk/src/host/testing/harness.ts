/**
 * The test harness: fake renderer windows, a manual clock, and a host core wired to the stub driver.
 *
 * What it models, and why each piece has to exist rather than being stubbed out:
 *
 *   - **windows are real participants.** A window owns mounts, holds a cue channel and a registry client,
 *     and answers the manager's renderer requests. Without that, `registerMount`, target resolution,
 *     `NO_TARGET` and window-gone would all be untested;
 *   - **the channel is a pair of message queues**, not a direct call: a settlement that travels back must
 *     go through the same path a real IPC hop takes, so an ordering mistake shows up here;
 *   - **the clock is manual**, so a deadline is an assertion instead of a 15-second wait.
 */
import type {
  ContractFailure,
  ContractResult,
  CueChannel,
  CueEnvelopeInput,
  HostLogger,
  HostRegistryClient,
  HostServices,
  HostToastLevel,
  ManagerChannel,
  ModelDriverEntryKind,
  ModelDriverManager,
  ModelDriverRuntime,
  RendererMountPurpose,
  RendererMountSurfaceKind,
  RendererRequest,
  RendererRequestRefusal,
} from '../../contract'
import type { BrokerScheduler } from '../core/broker'
import type { HostCore } from '../core/host'
import type { DriverStateSnapshot, DriverTableEntry } from '../core/registry'
import type { WindowStorage } from '../storage'
import type { StubDriverState, StubMount } from './stub-driver'

import {
  CueKind,
  CueSource,
  HostWindowKind,
  MODEL_DRIVER_CONTRACT_VERSION,
  RendererRequestRefusal as Refusal,
  RendererMountReadinessState,
} from '../../contract'
import { createHostCore } from '../core/host'
import { createMemoryStoragePort } from '../core/storage'
import { createSilentLogger } from '../logging'
import { createStubDriverState, createStubManagerFactory, createStubMount, createStubRendererHalf, STUB_DRIVER_ID, STUB_MANAGER_SPECIFIER, STUB_MANIFEST, STUB_MANIFEST_SPECIFIER } from './stub-driver'

/** A clock whose time only moves when a test moves it. */
export interface ManualScheduler extends BrokerScheduler {
  advance: (ms: number) => Promise<void>
  pending: () => number
}

export function createManualScheduler(startAt = 1_000): ManualScheduler {
  let now = startAt
  let nextId = 1
  const timers = new Map<number, { at: number, handler: () => void }>()

  return {
    now: () => now,
    setTimeout(handler, ms) {
      const id = nextId++
      timers.set(id, { at: now + ms, handler })
      return id
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    async advance(ms) {
      const target = now + ms
      // Fire in due order, letting the work each timer starts settle before the next one, so a test sees
      // the same ordering an event loop would produce.
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0]
        if (!due)
          break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.handler()
        await Promise.resolve()
        await Promise.resolve()
      }
      now = target
    },
    pending: () => timers.size,
  }
}

interface ChannelPeer {
  send: (message: unknown) => void
  onMessage: (handler: (message: unknown) => void) => () => void
  /** The window went away: nothing this end sends is delivered any more, and nothing arrives. */
  close: () => void
}

/**
 * Two ends of one channel.
 *
 * `host` is what the manager holds; `window` is what the renderer-side half holds. A message sent through
 * one arrives at the other's handlers, and nothing is shared — the same asymmetry a process boundary has.
 */
export function createChannelPair(): { host: ManagerChannel, window: ChannelPeer } {
  const hostHandlers = new Set<(message: unknown) => void>()
  const windowHandlers = new Set<(message: unknown) => void>()

  let closed = false

  const host: ManagerChannel = {
    send(message) {
      // A destroyed window drops the message without an error, which is exactly what a `void` send has to
      // do: the manager cannot be told by the return value, which is why the loss is reported on `onChange`.
      if (closed)
        return
      for (const handler of [...windowHandlers])
        handler(message)
    },
    onMessage(handler) {
      hostHandlers.add(handler)
      return () => hostHandlers.delete(handler)
    },
  }

  const window: ChannelPeer = {
    send(message) {
      if (closed)
        return
      for (const handler of [...hostHandlers])
        handler(message)
    },
    onMessage(handler) {
      windowHandlers.add(handler)
      return () => windowHandlers.delete(handler)
    },
    close() {
      closed = true
      hostHandlers.clear()
      windowHandlers.clear()
    },
  }

  return { host, window }
}

/**
 * What a test writes when it mounts something.
 *
 * The string literals are the contract's own values (`RendererMountSurfaceKind` and
 * `RendererMountPurpose` are string enums) and are converted below. A fixture is allowed the convenience;
 * production code is not, which is why the conversion lives here and not in the host core.
 */
export interface MountOptionsInput {
  surface: 'stage' | 'preview' | 'acting' | 'rehearsal'
  purpose: 'stage' | 'acting' | 'chat' | 'rehearsal' | 'preview'
  /** The state the mount is brought to after registration. Default `ready-for-model`. */
  readiness?: 'ready-for-model' | 'model-loaded' | 'mounting'
  failLoad?: ContractFailure
}

export interface FakeWindowOptions {
  windowId: string
  core: HostCore
  driver: StubDriverState
  logger?: HostLogger
  /** Publish an empty pair on activation instead of a text. */
  publishEmpty?: boolean
  /** `true` makes `openProviderEntry` refuse, so a registry fallback can be exercised. */
  refuseEntries?: boolean
  windowKind?: HostWindowKind
  /** Run when the window goes away, before the host is told — a closed window is not a live one. */
  onClosed?: () => void
}

/**
 * One renderer window.
 *
 * It holds mounts, a cue channel and a registry client, and it is what the registry's `requestRenderer`
 * reaches. It contains no Vue and no DOM: Phase 1's stub provider entry is a plain object, and Phase 2 is
 * where a component performs the same protocol.
 */
export interface FakeWindow {
  readonly windowId: string
  readonly mounts: StubMount[]
  /** Every renderer request the window was asked to serve. */
  readonly requests: RendererRequest[]
  /** The services the runtime was activated with, when it has been. */
  readonly services: () => HostServices | undefined
  /** The live runtime, when the window has started one. */
  readonly runtime: () => ModelDriverRuntime | undefined
  readonly registryClient: HostRegistryClient
  readonly cueChannel: CueChannel
  /** Register a mount and return the registry-issued id with it. */
  mount: (options: MountOptionsInput) => Promise<{ mountId: string, mount: StubMount }>
  /** Ask the host for a channel, as an adapter's `openManagerChannel` would. */
  openEntry: (request: RendererRequest) => Promise<{ ok: true, channel: ManagerChannel } | { ok: false, reason: RendererRequestRefusal }>
  close: () => Promise<void>
}

export function createFakeWindow(options: FakeWindowOptions): FakeWindow {
  const { core, driver } = options
  const mounts: StubMount[] = []
  const requests: RendererRequest[] = []
  let runtime: ReturnType<typeof createStubRendererHalf> | undefined
  let services: HostServices | undefined
  let peer: { host: ManagerChannel, window: ChannelPeer } | undefined

  const registryClient = core.registryClient(options.windowId)
  const cueChannel = core.cueChannel(options.windowId)

  const buildServices = (): HostServices => {
    const logger = options.logger ?? createSilentLogger()
    return {
      modelDriverId: STUB_DRIVER_ID,
      contract: MODEL_DRIVER_CONTRACT_VERSION,
      log: logger,
      storage: core.driverStorage(STUB_DRIVER_ID),
      prompt: core.promptService(STUB_DRIVER_ID),
      cues: cueChannel,
      pointer: { subscribe: () => () => {} },
      theme: { accentHue: 210, isDark: true, onChange: () => () => {} },
      ui: { toast: (level: HostToastLevel, message: string) => logger.info('toast', level, message) },
      i18n: { t: (key: string) => key, locale: 'en' },
      runtime: { windowKind: options.windowKind ?? HostWindowKind.UNKNOWN, debug: {} },
    }
  }

  const ensureRuntime = async () => {
    if (runtime)
      return runtime

    peer = createChannelPair()
    const half = createStubRendererHalf({
      state: driver,
      mounts,
      windowId: options.windowId,
      notifyModelsChanged: () => peer?.window.send({ type: 'notify', method: 'models-changed' }),
      ...(options.publishEmpty !== undefined ? { publishEmpty: options.publishEmpty } : {}),
    })
    runtime = half

    peer.window.onMessage((message) => {
      half.handleMessage(message, reply => peer?.window.send(reply))
    })

    services = buildServices()
    const activated = await half.runtime.activate(services)
    if (!activated.ok)
      throw new Error(`The stub runtime failed to activate: ${activated.error.message}`)

    return half
  }

  return {
    windowId: options.windowId,
    mounts,
    requests,

    services: () => services,
    runtime: () => runtime?.runtime,

    registryClient,
    cueChannel,

    async mount(mountOptions) {
      const surface = mountOptions.surface as RendererMountSurfaceKind
      const purpose = mountOptions.purpose as RendererMountPurpose
      const mount = createStubMount(
        { surface, purpose, ...(mountOptions.failLoad ? { failLoad: mountOptions.failLoad } : {}) },
        driver,
      )
      const registered = await registryClient.registerMount({
        driverId: STUB_DRIVER_ID,
        surface,
        purpose,
        windowId: options.windowId,
      })
      if (!registered.ok)
        throw new Error(`The host refused the mount: ${registered.reason}`)

      mount.attach(registered.mountId)
      mounts.push(mount)

      // A mount is unaddressable between creation and this response, and readiness does not begin before it:
      // the descriptor starts `unmounted`, so the only legal way in is `mounting` — and any later state is
      // reached by walking the declared transitions rather than by jumping.
      const start = mountOptions.readiness ?? 'ready-for-model'
      const chain = start === 'mounting'
        ? [RendererMountReadinessState.MOUNTING]
        : start === 'model-loaded'
          ? [RendererMountReadinessState.MOUNTING, RendererMountReadinessState.READY_FOR_MODEL, RendererMountReadinessState.LOADING_MODEL, RendererMountReadinessState.MODEL_LOADED]
          : [RendererMountReadinessState.MOUNTING, RendererMountReadinessState.READY_FOR_MODEL]

      for (const state of chain) {
        mount.moveTo(state)
        await core.mounts.update(registered.mountId, { readiness: state })
      }

      return { mountId: registered.mountId, mount }
    },

    async openEntry(request) {
      requests.push(request)
      if (options.refuseEntries)
        return { ok: false, reason: Refusal.ENTRY_FAILED }

      await ensureRuntime()
      // The channel exists only after the entry ran, which is the order the contract describes: the
      // registry asks, the window starts the driver's code, and the channel is what comes back.
      return { ok: true, channel: peer!.host }
    },

    async close() {
      // A destroyed window is not a live one: the transport dies first, then the window leaves the renderer
      // host, and only then is the registry told — so nothing can route a request to it in between.
      peer?.window.close()
      options.onClosed?.()
      await core.windowClosed(options.windowId)
    },
  }
}

/** The sink a window's `ManagerChannel` needs: it must be the *host* end, not the window end. */

export interface TestHost {
  core: HostCore
  driver: StubDriverState
  scheduler: ManualScheduler
  storage: WindowStorage
  openWindow: (windowId: string, options?: Omit<FakeWindowOptions, 'windowId' | 'core' | 'driver'>) => FakeWindow
  /** The background window id, or `undefined` when nothing has asked for it yet. */
  backgroundWindowId: () => string | undefined
  /** How many times the background window was started. */
  backgroundStarts: () => number
  close: () => Promise<void>
}

export interface TestHostOptions {
  storage?: WindowStorage
  scheduler?: ManualScheduler
  state?: DriverStateSnapshot
  logger?: HostLogger
  /** Entry kinds the stub resolves. Defaults to a provider, mount, panels and picker specifier. */
  entries?: Partial<Record<ModelDriverEntryKind, { specifier: string } | null>>
  /** Skip `start()`, for a test that wants to call it with its own table. */
  noStart?: boolean
  publishEmpty?: boolean
  /**
   * Make every window refuse a provider entry, including the shared background one.
   *
   * Per-window refusal is a different case from a total refusal: the registry falls back from a live window to
   * the background window (§4.3), so a test that wants the failure to reach the caller has to refuse in both.
   */
  refuseEntries?: boolean
  /**
   * Replace the first-party table.
   *
   * A registry test has to be able to hand `start()` a declaration that is *wrong* — a `0.0` contract
   * revision, a mismatched id, a manager specifier the table does not load — so the table is a parameter
   * rather than something the harness always builds.
   */
  table?: (state: StubDriverState) => DriverTableEntry[]
}

const DEFAULT_ENTRIES = {
  provider: { specifier: '@proj-airi/stage-renderer-sdk/testing#stubProvider' },
  mount: { specifier: '@proj-airi/stage-renderer-sdk/testing#stubMount' },
  panels: { specifier: '@proj-airi/stage-renderer-sdk/testing#stubPanels' },
  picker: { specifier: '@proj-airi/stage-renderer-sdk/testing#stubPicker' },
} as const

export async function createTestHost(options: TestHostOptions = {}): Promise<TestHost> {
  const storage = options.storage ?? createMemoryStoragePort()
  const scheduler = options.scheduler ?? createManualScheduler()
  const driver = createStubDriverState()
  const windows = new Map<string, FakeWindow>()
  let background: FakeWindow | undefined
  let backgroundStarts = 0

  const core = createHostCore({
    storage,
    scheduler,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.state ? { state: options.state } : {}),
    rendererHost: {
      liveWindows: () => [...windows.keys()],
      async ensureBackgroundWindow() {
        if (background)
          return background.windowId
        backgroundStarts += 1
        background = createFakeWindow({
          windowId: 'background',
          core,
          driver,
          windowKind: HostWindowKind.UNKNOWN,
          ...(options.publishEmpty !== undefined ? { publishEmpty: options.publishEmpty } : {}),
          ...(options.refuseEntries !== undefined ? { refuseEntries: options.refuseEntries } : {}),
          ...(options.logger ? { logger: options.logger } : {}),
        })
        windows.set('background', background)
        return background.windowId
      },
      async openProviderEntry(windowId, request) {
        const window = windows.get(windowId)
        if (!window)
          return { ok: false, reason: Refusal.WINDOW_UNAVAILABLE }
        return window.openEntry(request)
      },
    },
  })

  const entries = options.entries ?? DEFAULT_ENTRIES
  const table = options.table
    ? options.table(driver)
    : [{
        driverId: STUB_DRIVER_ID,
        manifestSpecifier: STUB_MANIFEST_SPECIFIER,
        managerSpecifier: STUB_MANAGER_SPECIFIER,
        loadManifest: async () => STUB_MANIFEST,
        loadManager: async () => createStubManagerFactory({
          state: driver,
          entries: Object.fromEntries(
            Object.entries(entries).map(([kind, value]) => [kind, value ?? null]),
          ) as Record<ModelDriverEntryKind, { specifier: string } | null>,
        }),
      }]

  if (!options.noStart)
    await core.start(table)

  return {
    core,
    driver,
    scheduler,
    storage,
    openWindow(windowId, windowOptions = {}) {
      const window = createFakeWindow({
        windowId,
        core,
        driver,
        ...(options.publishEmpty !== undefined ? { publishEmpty: options.publishEmpty } : {}),
        ...(options.refuseEntries !== undefined ? { refuseEntries: options.refuseEntries } : {}),
        ...(options.logger ? { logger: options.logger } : {}),
        ...windowOptions,
        // A closed window must stop being a candidate for `requestRenderer`, or a test could never show that
        // the manager was told to ask again rather than served by the window it just lost.
        onClosed: () => {
          windows.delete(windowId)
          windowOptions.onClosed?.()
        },
      })
      windows.set(windowId, window)
      return window
    },
    backgroundWindowId: () => background?.windowId,
    backgroundStarts: () => backgroundStarts,
    async close() {
      await core.shutdown()
    },
  }
}

/** The manager the host created, for assertions that need to reach it. */
export function managerOf(core: HostCore): ModelDriverManager | undefined {
  return core.registry.get(STUB_DRIVER_ID)
}

/**
 * A cue envelope input that needs no ceremony.
 *
 * `cues` must be non-empty (the validator enforces it), so a caller that only wants "one transaction to the
 * acting mount" writes `envelope('acting')` and gets one `act` cue addressed at the stub driver.
 */
export function envelope(purpose: 'stage' | 'acting' | 'chat' | 'rehearsal' | 'preview' = 'acting'): CueEnvelopeInput {
  return {
    cues: [{ kind: CueKind.ACT, actToken: 'happy' }],
    source: CueSource.HOST,
    override: false,
    target: { modelDriverId: STUB_DRIVER_ID, purpose: purpose as RendererMountPurpose },
  }
}

/** Unwrap a `ContractResult`, failing the test with the contract's own message. */
export function unwrap<T>(result: ContractResult<T>): T {
  if (!result.ok)
    throw new Error(`Expected success, got ${result.error.code}: ${result.error.message}`)
  return result.value
}
