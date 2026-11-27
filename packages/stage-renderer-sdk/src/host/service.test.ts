/**
 * The host service: the operations a host process exposes, driven through its ports.
 *
 * This is the suite the Electron main file could never have — it needs no `BrowserWindow`, no `ipcMain` and no
 * file. What it asserts is the behaviour that used to be untestable in the app: the entry relay answers only the
 * window it asked and gives up on a window that never answers, a mount is only addressable in the window that
 * registered it, the snapshot is persisted, and shutdown closes what it started.
 */
import type { ModelDriverHostPush } from './service'

import { describe, expect, it } from 'vitest'

import { ContractFailureCode, ModelDriverEntryKind, MountRegistrationRefusal, RendererMountPurpose, RendererMountReadinessState, RendererMountSurfaceKind } from '../contract'
import { createModelDriverHostService } from './service'
import { createManualScheduler } from './testing/harness'
import { createStubDriverState, createStubManagerFactory, createStubRendererHalf, STUB_DRIVER_ID, STUB_MANAGER_SPECIFIER, STUB_MANIFEST, STUB_MANIFEST_SPECIFIER, STUB_PROVIDER_SPECIFIER } from './testing/stub-driver'

const ENTRIES = {
  [ModelDriverEntryKind.PROVIDER]: { specifier: STUB_PROVIDER_SPECIFIER },
}

const TABLE = [{
  driverId: STUB_DRIVER_ID,
  manifestSpecifier: STUB_MANIFEST_SPECIFIER,
  managerSpecifier: STUB_MANAGER_SPECIFIER,
  loadManifest: async () => STUB_MANIFEST,
  loadManager: async () => createStubManagerFactory({ state: state(), entries: ENTRIES }),
}]

/** The fixture's driver state, created once per test by `createService`. */
let lifecycleState = createStubDriverState()
function state() {
  return lifecycleState
}

interface Fixture {
  service: ReturnType<typeof createModelDriverHostService>
  pushed: { windowId: string, message: ModelDriverHostPush }[]
  writes: number
  closedBackground: number
  scheduler: ReturnType<typeof createManualScheduler>
  windowHalf: ReturnType<typeof createStubRendererHalf>
  /** Windows the service may route to. */
  live: string[]
  /** The first entry request the service pushed, once it has been pushed. */
  entryPush: () => Promise<{ requestId: string, specifier: string }>
}

interface FixtureOptions {
  entryTimeoutMs?: number
  /** Answer entry requests with an error instead of success. */
  refuseEntry?: boolean
  /** Never answer an entry request. */
  silent?: boolean
  /** Whether a background window can be started when no live window serves the request. */
  backgroundAvailable?: boolean
}

function createFixture(options: FixtureOptions = {}): Fixture {
  lifecycleState = createStubDriverState()
  const scheduler = createManualScheduler()
  const pushed: Fixture['pushed'] = []
  const live = ['w1']
  const windowHalf = createStubRendererHalf({ state: lifecycleState, mounts: [] })

  const fixture: Fixture = {
    service: undefined as never,
    pushed,
    writes: 0,
    closedBackground: 0,
    scheduler,
    windowHalf,
    live,
    async entryPush() {
      for (let i = 0; i < 200; i += 1) {
        const entry = pushed.find(push => push.message.kind === 'open-entry')
        if (entry && entry.message.kind === 'open-entry')
          return { requestId: entry.message.requestId, specifier: entry.message.specifier }
        await Promise.resolve()
      }

      throw new Error('the service never pushed an entry request')
    },
  }

  fixture.service = createModelDriverHostService({
    table: TABLE,
    entryTimeoutMs: options.entryTimeoutMs ?? 10_000,
    scheduler,
    windows: {
      liveWindows: () => live,
      ensureBackgroundWindow: async () => (options.backgroundAvailable === false ? null : 'background'),
      backgroundStarted: () => true,
      closeBackgroundWindow: async () => {
        fixture.closedBackground += 1
      },
    },
    state: {
      read: async () => undefined,
      write: async () => {
        fixture.writes += 1
      },
    },
    transport: {
      push(windowId, message) {
        pushed.push({ windowId, message })

        if (message.kind === 'open-entry' && !options.silent) {
          queueMicrotask(() => {
            void fixture.service.entryResult(windowId, options.refuseEntry
              ? { requestId: message.requestId, error: { message: 'the window could not load the entry' } }
              : { requestId: message.requestId })
          })
        }

        // A manager-message is the window half's input; its reply comes back the way a window's would.
        if (message.kind === 'manager-message') {
          queueMicrotask(() => {
            windowHalf.handleMessage(message.message, (reply) => {
              void fixture.service.managerMessage(windowId, { driverId: message.driverId, message: reply })
            })
          })
        }

        return true
      },
    },
  })

  return fixture
}

describe('model driver host service', () => {
  it('loads the table, creates the manager and writes the normalized snapshot', async () => {
    const fixture = createFixture()
    await fixture.service.start()

    const snapshot = fixture.service.snapshot()
    expect(snapshot.drivers).toHaveLength(1)
    expect(snapshot.drivers[0].driverId).toBe(STUB_DRIVER_ID)
    expect(snapshot.backgroundWindowStarted).toBe(true)
    // Boot writes once, so a refused declaration is recorded where the next boot reads it.
    expect(fixture.writes).toBe(1)
  })

  it('relays a provider entry to the window and returns the rows the manager read', async () => {
    const fixture = createFixture()
    await fixture.service.start()

    const rows = await fixture.service.pullRows({ driverId: STUB_DRIVER_ID })
    expect(rows.ok).toBe(true)

    // The pull went through the entry relay: the manager named the specifier, and the window was asked for it.
    const entry = fixture.pushed.find(push => push.message.kind === 'open-entry')
    expect(entry?.windowId).toBe('w1')
    expect(entry?.message).toMatchObject({ driverId: STUB_DRIVER_ID, specifier: STUB_PROVIDER_SPECIFIER })
  })

  it('refuses an entry no window answers instead of waiting forever', async () => {
    // No background window to fall back to, so one unanswered request is the whole failure.
    const fixture = createFixture({ silent: true, backgroundAvailable: false, entryTimeoutMs: 50 })
    await fixture.service.start()

    const pull = fixture.service.pullRows({ driverId: STUB_DRIVER_ID })
    // Wait until the request is actually on the wire, so its deadline exists before the clock moves.
    await fixture.entryPush()
    await fixture.scheduler.advance(100)
    const rows = await pull

    expect(rows.ok).toBe(false)
    if (!rows.ok)
      expect(rows.error.code).toBe(ContractFailureCode.DRIVER_UNAVAILABLE)
  })

  it('accepts an entry answer only from the window it asked', async () => {
    const fixture = createFixture({ silent: true })
    await fixture.service.start()

    void fixture.service.pullRows({ driverId: STUB_DRIVER_ID })
    const entry = await fixture.entryPush()

    const stranger = await fixture.service.entryResult('w2', { requestId: entry.requestId })
    expect(stranger.ok).toBe(false)
  })

  it('refuses a mount in a window that does not own it, and drops mounts when the window goes', async () => {
    const fixture = createFixture()
    await fixture.service.start()

    const registered = await fixture.service.registerMount('w1', {
      driverId: STUB_DRIVER_ID,
      surface: RendererMountSurfaceKind.STAGE,
      purpose: RendererMountPurpose.STAGE,
    })
    expect(registered.ok).toBe(true)

    // A readiness report from another window is not about a mount that window holds.
    const foreign = await fixture.service.reportReadiness('w2', {
      mountId: (registered as { mountId: string }).mountId,
      readiness: RendererMountReadinessState.MOUNTING,
    })
    expect(foreign.ok).toBe(false)

    await fixture.service.windowClosed('w1')
    expect(await fixture.service.mounts.list()).toHaveLength(0)
  })

  it('closes the background window and flushes state at shutdown, once', async () => {
    const fixture = createFixture()
    await fixture.service.start()

    await fixture.service.shutdown()
    await fixture.service.shutdown()

    expect(fixture.closedBackground).toBe(1)
    // Boot + shutdown, never a third write for a second shutdown.
    expect(fixture.writes).toBe(2)
  })

  it('refuses a mount while the user has the driver turned off', async () => {
    const fixture = createFixture()
    await fixture.service.start()

    await fixture.service.setEnabled({ driverId: STUB_DRIVER_ID, enabled: false })
    const refused = await fixture.service.registerMount('w1', {
      driverId: STUB_DRIVER_ID,
      surface: RendererMountSurfaceKind.STAGE,
      purpose: RendererMountPurpose.STAGE,
    })

    expect(refused).toEqual({ ok: false, reason: MountRegistrationRefusal.DRIVER_DISABLED })
  })
})
