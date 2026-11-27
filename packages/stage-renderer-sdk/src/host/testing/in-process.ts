/**
 * The in-process host: the real service and the real adapter wired to each other, with no Electron.
 *
 * This is the composition the application runs, minus the process boundary: one `ModelDriverHostService` playing
 * main, one `ModelDriverAdapter` per window playing a renderer, and a transport that hands a `ModelDriverHostPush`
 * straight to the adapter that pretended to receive it. Everything between them is production code — the entry
 * relay and its deadline, the registry's channel cache, the broker's transaction table, the adapter's protocol
 * handling, the stub driver's two halves — so a failure here is a failure the app would have.
 *
 * What it does **not** prove, and cannot: Electron's `webContents` identity, the eventa hop, `state.json` on disk,
 * a `BrowserWindow`, or the shared background window. Those stay embedder resources and manual smoke.
 *
 * Pushes are delivered on a microtask rather than inline. In the app an IPC event is a separate task, and inline
 * delivery would re-enter the service from inside its own call — the adapter answers an entry request by calling
 * back into `entryResult` while `requestRenderer` is still on the stack.
 */
import type { ContractResult, CueAck, ModelDriverId, ModelPromptPublication, ModelSummary } from '../../contract'
import type { ModelDriverAdapter } from '../adapter'
import type { HostClient, ModelDriverEntryRequest, ModelDriverHostState } from '../client'
import type { PromptStore } from '../core/prompts'
import type { DriverStateSnapshot, DriverTableEntry } from '../core/registry'
import type { DriverLoaderTable } from '../loaders'
import type { ModelDriverHostPush, ModelDriverHostService } from '../service'
import type { WindowStorage } from '../storage'
import type { StubDriverState, StubModel } from './stub-driver'
import type { StubWindowSession } from './stub-entry'

import { ModelDriverEntryKind } from '../../contract'
import { createModelDriverAdapter } from '../adapter'
import { createPromptStore } from '../core/prompts'
import { createMemoryStoragePort } from '../core/storage'
import { createSilentLogger } from '../logging'
import { createModelDriverHostService } from '../service'
import { createManualScheduler } from './harness'
import { createStubDriverState, createStubManagerFactory, STUB_DRIVER_ID, STUB_MANAGER_SPECIFIER, STUB_MANIFEST, STUB_MANIFEST_SPECIFIER, STUB_PROVIDER_SPECIFIER } from './stub-driver'
import { startStubProviderEntry } from './stub-entry'

/** One window of the in-process host: its adapter, what its entry created, and a way to take it away. */
export interface InProcessWindow {
  windowId: string
  adapter: ModelDriverAdapter
  /** The session this window's stub entry created, once the entry has run. */
  session: () => StubWindowSession | undefined
  /** This window's prompt store — a separate store over the same primitives, as the app has one per window. */
  prompts: PromptStore
  /** Whether the stub runtime finished activating in this window. */
  activated: () => boolean
  /** Close the window: stop listening, drop its mounts, settle what it left pending. */
  close: () => Promise<void>
}

/** One message the host tried to hand a window, recorded so a test can see a delivery nobody received. */
export interface InProcessPush {
  windowId: string
  kind: ModelDriverHostPush['kind']
  /** `false` when the window was already gone — the app's `emitToWindow` returning `false`. */
  delivered: boolean
  nonce?: number
}

export interface InProcessHost {
  service: ModelDriverHostService
  scheduler: ReturnType<typeof createManualScheduler>
  /** The window's storage primitives, shared by every window — one origin, as in the app. */
  storage: WindowStorage
  /** The manager-side stub state (rows come from the windows, so this is mostly for seeding). */
  driver: StubDriverState
  openWindow: (windowId: string) => Promise<InProcessWindow>
  window: (windowId: string) => InProcessWindow | undefined
  windowIds: () => string[]
  /** The last snapshot the service wrote, as the state file would hold it. */
  snapshot: () => DriverStateSnapshot | undefined
  /** Every push the host attempted, in order. */
  pushes: () => InProcessPush[]
  /** The host state a renderer reads — the same shape `adapter.hostState()` returns. */
  hostState: () => ModelDriverHostState
  /** Rows the registry currently caches for the stub driver. */
  cachedRows: () => ModelSummary[]
  close: () => Promise<void>
}

export interface InProcessHostOptions {
  /** Models every window's stub half starts with. Defaults to one demo model. */
  models?: StubModel[]
  /** How long a window has to answer an entry request. Defaults to the service's ten seconds. */
  entryTimeoutMs?: number
}

/** The model the fixture seeds, so a row pull, a load cue and a capture have something to address. */
export const STUB_DEMO_MODEL: StubModel = {
  modelId: 'model_stub_demo',
  profileId: 'profile_stub_demo',
  name: 'Stub model',
}

export async function createInProcessHost(options: InProcessHostOptions = {}): Promise<InProcessHost> {
  const models = options.models ?? [STUB_DEMO_MODEL]
  const storage = createMemoryStoragePort()
  const scheduler = createManualScheduler()
  const logger = createSilentLogger()
  const driver = createStubDriverState()

  const windows = new Map<string, InProcessWindow>()
  const onPush = new Map<string, (push: ModelDriverHostPush) => void>()
  const pushes: InProcessPush[] = []

  let snapshot: DriverStateSnapshot | undefined

  const table: DriverTableEntry[] = [{
    driverId: STUB_DRIVER_ID,
    manifestSpecifier: STUB_MANIFEST_SPECIFIER,
    managerSpecifier: STUB_MANAGER_SPECIFIER,
    loadManifest: async () => STUB_MANIFEST,
    loadManager: async () => createStubManagerFactory({
      state: driver,
      entries: { [ModelDriverEntryKind.PROVIDER]: { specifier: STUB_PROVIDER_SPECIFIER } },
    }),
  }]

  const service = createModelDriverHostService({
    table,
    state: {
      read: async () => snapshot,
      write: async (next) => {
        snapshot = next
      },
    },
    transport: {
      push(windowId, message) {
        const deliver = onPush.get(windowId)
        pushes.push({
          windowId,
          kind: message.kind,
          delivered: Boolean(deliver),
          ...(message.kind === 'cue-settled' ? { nonce: message.nonce } : {}),
        })
        // `false` is what the service treats as a dead window, so an unknown id must not be swallowed.
        if (!deliver)
          return false
        deliver(message)
        return true
      },
    },
    windows: {
      liveWindows: () => [...onPush.keys()],
      // This host has no background window: every renderer here is a window the caller opened. The service's
      // fallback is written against the port, so a host that has one supplies it and this one says it does not.
      ensureBackgroundWindow: async () => null,
      backgroundStarted: () => false,
      closeBackgroundWindow: async () => {},
    },
    scheduler,
    logger,
    ...(options.entryTimeoutMs !== undefined ? { entryTimeoutMs: options.entryTimeoutMs } : {}),
  })

  await service.start()

  const openWindow = async (windowId: string): Promise<InProcessWindow> => {
    if (windows.has(windowId))
      throw new Error(`Window \`${windowId}\` is already open`)

    const settlements = new Set<(settlement: { nonce: number, result: ContractResult<CueAck> }) => void>()
    const entryRequests = new Set<(request: ModelDriverEntryRequest) => void>()
    const managerMessages = new Set<(payload: { driverId: ModelDriverId, message: unknown }) => void>()
    const promptResolutions = new Set<(payload: { driverId: ModelDriverId, publication: ModelPromptPublication }) => void>()

    let session: StubWindowSession | undefined

    const subscribe = <T>(set: Set<T>, handler: T) => {
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    }

    const client: HostClient = {
      identify: async () => ({ windowId }),
      registerMount: request => service.registerMount(windowId, request),
      unregisterMount: request => service.unregisterMount(windowId, request.mountId),
      reportReadiness: request => service.reportReadiness(windowId, request),
      withdrawCues: request => service.withdraw(request),
      resolveEntrypoint: request => service.resolveEntrypoint(request),
      hostState: async () => service.snapshot(),
      pullRows: request => service.pullRows(request),
      setEnabled: request => service.setEnabled(request),
      submitCue: request => service.submitCue(windowId, request.envelope, request.options),
      sendManagerMessage: payload => service.managerMessage(windowId, payload),
      sendEntryResult: payload => service.entryResult(windowId, payload),
      onCueSettled: handler => subscribe(settlements, handler),
      onOpenEntry: handler => subscribe(entryRequests, handler),
      onManagerMessage: handler => subscribe(managerMessages, handler),
      onPromptResolution: handler => subscribe(promptResolutions, handler),
    }

    const deliver = (push: ModelDriverHostPush) => {
      queueMicrotask(() => {
        if (push.kind === 'cue-settled') {
          for (const handler of [...settlements])
            handler({ nonce: push.nonce, result: push.result })
          return
        }
        if (push.kind === 'open-entry') {
          for (const handler of [...entryRequests]) {
            handler({
              requestId: push.requestId,
              driverId: push.driverId,
              specifier: push.specifier,
              ...(push.surface ? { surface: push.surface } : {}),
              ...(push.purpose ? { purpose: push.purpose } : {}),
            })
          }
          return
        }
        for (const handler of [...managerMessages])
          handler({ driverId: push.driverId, message: push.message })
      })
    }

    // The loader table is per window, because the provider module it resolves is where a window's session is
    // created: the specifier is the same string in every window, and the closure is what keeps them apart.
    const loaders: DriverLoaderTable = {
      resolveProvider: (specifier) => {
        if (specifier !== STUB_PROVIDER_SPECIFIER)
          return undefined
        return async () => ({
          startProviderEntry: entry => startStubProviderEntry({
            ...entry,
            models,
            onSession: (created) => {
              session = created
            },
          }),
        })
      },
      providers: () => [STUB_PROVIDER_SPECIFIER],
    }

    const prompts = createPromptStore(storage)

    const adapter = await createModelDriverAdapter({
      client,
      storage,
      prompts,
      loaders,
      logger,
    })

    onPush.set(windowId, deliver)
    const opened: InProcessWindow = {
      windowId,
      adapter,
      session: () => session,
      prompts,
      activated: () => session?.activated() ?? false,
      async close() {
        onPush.delete(windowId)
        windows.delete(windowId)
        adapter.dispose()
        await service.windowClosed(windowId)
      },
    }
    windows.set(windowId, opened)
    return opened
  }

  return {
    service,
    scheduler,
    storage,
    driver,
    openWindow,
    window: windowId => windows.get(windowId),
    windowIds: () => [...windows.keys()],
    pushes: () => [...pushes],
    snapshot: () => snapshot,
    hostState: () => service.snapshot(),
    cachedRows: () => service.registry.getRows(STUB_DRIVER_ID),
    async close() {
      await service.shutdown()
      windows.clear()
      onPush.clear()
    },
  }
}
