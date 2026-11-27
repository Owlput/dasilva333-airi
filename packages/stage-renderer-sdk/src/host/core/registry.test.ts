/**
 * The driver registry: declarations before code, one manager per driver, flags, rows and renderer
 * requests.
 *
 * The tests follow §4.2's startup sequence, because that order is the thing being protected: a declaration
 * is validated *before* any driver code is loaded, and a driver this build cannot speak to never gets a
 * manager. Several of these cases exist only to prove a refusal, which is most of what a registry does on a
 * bad day.
 */
import type { RegistryHandle } from '../../contract'
import type { StubDriverState } from '../testing/stub-driver'
import type { DriverRegistryEvent, DriverTableEntry } from './registry'

import { describe, expect, it } from 'vitest'

import {
  ContractFailureCode,
  DriverStatus,
  ModelDriverEntryKind,
  RendererMountPurpose,
  RendererMountSurfaceKind,
  RendererRequestRefusal,
} from '../../contract'
import { createTestHost, envelope, unwrap } from '../testing/harness'
import {
  createStubManagerFactory,
  STUB_DRIVER_ID,
  STUB_MANAGER_SPECIFIER,
  STUB_MANIFEST,
  STUB_MANIFEST_SPECIFIER,
  STUB_MOUNT_SPECIFIER,
} from '../testing/stub-driver'

/** A table whose declaration is replaced, for the refusal cases. */
function tableWith(declaration: unknown, managerSpecifier = STUB_MANAGER_SPECIFIER): (state: StubDriverState) => DriverTableEntry[] {
  return state => [{
    driverId: STUB_DRIVER_ID,
    manifestSpecifier: STUB_MANIFEST_SPECIFIER,
    managerSpecifier,
    loadManifest: async () => declaration,
    loadManager: async () => createStubManagerFactory({ state }),
  }]
}

describe('driver registry', () => {
  it('creates one manager per enabled driver and reports it', async () => {
    const host = await createTestHost()

    const drivers = host.core.registry.listDrivers()
    expect(drivers).toHaveLength(1)
    expect(drivers[0]).toMatchObject({
      driverId: STUB_DRIVER_ID,
      name: STUB_MANIFEST.name,
      version: STUB_MANIFEST.driverVersion,
      status: DriverStatus.ENABLED,
      hasManager: true,
    })
    expect(host.core.registry.get(STUB_DRIVER_ID)).toBeDefined()
  })

  it('gives the manager a handle with no storage on it', async () => {
    let captured: RegistryHandle | undefined
    const host = await createTestHost({
      table: (state) => {
        const factory = createStubManagerFactory({ state })
        return [{
          driverId: STUB_DRIVER_ID,
          manifestSpecifier: STUB_MANIFEST_SPECIFIER,
          managerSpecifier: STUB_MANAGER_SPECIFIER,
          loadManifest: async () => STUB_MANIFEST,
          loadManager: async () => (handle) => {
            captured = handle
            return factory(handle)
          },
        }]
      },
    })

    expect(captured).toBeDefined()
    // Main has no IndexedDB (D1), so the handle carries no storage: a manager that needs data asks for a
    // renderer and uses the driver's storage inside it.
    expect('storage' in (captured as unknown as Record<string, unknown>)).toBe(false)
    expect(typeof captured!.requestRenderer).toBe('function')
    expect(typeof captured!.listDrivers).toBe('function')
    expect(typeof captured!.isEnabled).toBe('function')
    expect(typeof captured!.onChange).toBe('function')
    expect(host.core.registry.isEnabled(STUB_DRIVER_ID)).toBe(true)
  })

  it('refuses a declaration built against another contract revision', async () => {
    const host = await createTestHost({
      table: tableWith({ ...STUB_MANIFEST, contractVersion: { major: 0, minor: 0 } }),
    })

    const [driver] = host.core.registry.listDrivers()
    expect(driver.status).toBe(DriverStatus.NOT_INSTALLED)
    expect(driver.hasManager).toBe(false)
    expect(host.core.registry.get(STUB_DRIVER_ID)).toBeUndefined()

    const [rejection] = host.core.registry.rejections()
    expect(rejection.error.code).toBe(ContractFailureCode.CONTRACT_VERSION_MISMATCH)
    expect(rejection.error.message).toContain('0.0')
  })

  it('refuses a module whose declaration names another driver', async () => {
    const host = await createTestHost({
      table: tableWith({ ...STUB_MANIFEST, id: 'ai.moeru.airi.someone.else' }),
    })
    expect(host.core.registry.rejections()[0].error.message).toContain('declares')
    expect(host.core.registry.get(STUB_DRIVER_ID)).toBeUndefined()
  })

  it('refuses a declaration whose manager entry is not the specifier the table loads', async () => {
    const host = await createTestHost({
      table: tableWith(STUB_MANIFEST, '@proj-airi/stage-ui-three/driver/manager'),
    })
    const [rejection] = host.core.registry.rejections()
    expect(rejection.error.code).toBe(ContractFailureCode.INVALID_ENTRYPOINT)
    expect(rejection.error.message).toContain('entry.manager')
  })

  it('refuses a declaration that names an entry other than the manager', async () => {
    const host = await createTestHost({
      table: tableWith({ ...STUB_MANIFEST, entry: { manager: STUB_MANAGER_SPECIFIER, mount: STUB_MOUNT_SPECIFIER } }),
    })
    const [rejection] = host.core.registry.rejections()
    expect(rejection.error.code).toBe(ContractFailureCode.INVALID_PACKAGE)
    expect(rejection.error.message).toContain('manager')
  })

  it('refuses a declaration whose capabilities are incomplete', async () => {
    const { prompt, ...incomplete } = STUB_MANIFEST.capabilities
    void prompt
    const host = await createTestHost({
      table: tableWith({ ...STUB_MANIFEST, capabilities: incomplete }),
    })
    expect(host.core.registry.rejections()[0].error.message).toContain('prompt')
  })

  describe('enable flags', () => {
    it('releases the manager when disabled and creates one again when enabled', async () => {
      const host = await createTestHost()
      const first = host.core.registry.get(STUB_DRIVER_ID)

      unwrap(await host.core.registry.setEnabled(STUB_DRIVER_ID, false))
      expect(host.core.registry.isEnabled(STUB_DRIVER_ID)).toBe(false)
      expect(host.core.registry.get(STUB_DRIVER_ID)).toBeUndefined()

      // A refused mount is a user-facing answer, not an error.
      const window = host.openWindow('control-strip')
      const refused = await window.registryClient.registerMount({
        driverId: STUB_DRIVER_ID,
        surface: RendererMountSurfaceKind.ACTING,
        purpose: RendererMountPurpose.ACTING,
        windowId: 'control-strip',
      })
      expect(refused).toEqual({ ok: false, reason: 'driver-disabled' })

      unwrap(await host.core.registry.setEnabled(STUB_DRIVER_ID, true))
      const second = host.core.registry.get(STUB_DRIVER_ID)
      expect(second).toBeDefined()
      expect(second).not.toBe(first)
    })

    it('keeps the disabled flag in the persisted snapshot', async () => {
      const host = await createTestHost()
      unwrap(await host.core.registry.setEnabled(STUB_DRIVER_ID, false))
      expect(host.core.registry.snapshot().enabled[STUB_DRIVER_ID]).toBe(false)
    })

    it('refuses to enable a driver it has no declaration for', async () => {
      const host = await createTestHost()
      const result = await host.core.registry.setEnabled('ai.moeru.airi.unknown', true)
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error.code).toBe(ContractFailureCode.DRIVER_UNAVAILABLE)
    })
  })

  describe('row cache', () => {
    it('pulls rows through a renderer request and caches them', async () => {
      const host = await createTestHost()
      const window = host.openWindow('control-strip')
      await window.mount({ surface: 'acting', purpose: 'acting' })

      host.driver.models.set('model_a', { modelId: 'model_a', profileId: 'profile_a', name: 'A' })

      const rows = unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ modelId: 'model_a', profileId: 'profile_a', name: 'A' })

      // The pull happened over the manager channel, after the registry asked the window for the entry.
      expect(window.requests.length).toBeGreaterThan(0)
      expect(host.core.registry.getRows(STUB_DRIVER_ID)).toHaveLength(1)
      expect(host.core.registry.snapshot().rows[STUB_DRIVER_ID]).toHaveLength(1)
    })

    it('never overwrites the cache with a failed pull', async () => {
      const host = await createTestHost()
      const window = host.openWindow('control-strip')
      await window.mount({ surface: 'acting', purpose: 'acting' })

      host.driver.models.set('model_a', { modelId: 'model_a', profileId: 'profile_a', name: 'A' })
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

      host.driver.failures.listModels = { code: ContractFailureCode.INTERNAL, message: 'storage gone' }
      const failed = await host.core.registry.refreshRows(STUB_DRIVER_ID)
      expect(failed.ok).toBe(false)

      // `ok: false` is never read as "this driver has no models".
      expect(host.core.registry.getRows(STUB_DRIVER_ID)).toHaveLength(1)
    })

    it('re-reads the window when the driver says its list changed, and never pushes rows', async () => {
      const host = await createTestHost()
      const window = host.openWindow('control-strip')
      await window.mount({ surface: 'acting', purpose: 'acting' })
      host.driver.models.set('model_a', { modelId: 'model_a', profileId: 'profile_a', name: 'A' })
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

      const events: string[] = []
      host.core.registry.onEvent((event) => {
        events.push(event.kind)
      })

      // The renderer half writes a model and says so. The signal carries no rows: the cache is written only by
      // a pull, and the host takes that pull itself rather than waiting for a surface to ask (P1-D20).
      const runtime = window.runtime()
      expect(runtime).toBeDefined()
      unwrap(await runtime!.provider.remove('model_a'))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(events[0]).toBe('model-list-changed')
      expect(events).toContain('rows')
      expect(host.core.registry.getRows(STUB_DRIVER_ID)).toHaveLength(0)
    })
  })

  describe('manager restart', () => {
    it('re-creates the managers, keeps the rows and asks a window for code again', async () => {
      const host = await createTestHost()
      const window = host.openWindow('control-strip')
      await window.mount({ surface: 'acting', purpose: 'acting' })

      host.driver.models.set('model_a', { modelId: 'model_a', profileId: 'profile_a', name: 'A' })
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

      const before = host.core.registry.get(STUB_DRIVER_ID)
      const requestsBefore = window.requests.length

      await host.core.registry.restartManagers()

      const after = host.core.registry.get(STUB_DRIVER_ID)
      expect(after).toBeDefined()
      expect(after).not.toBe(before)
      // Rows are a display cache, so they survive a restart; the channel does not, so the next pull has to
      // ask for renderer code again.
      expect(host.core.registry.getRows(STUB_DRIVER_ID)).toHaveLength(1)

      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))
      expect(window.requests.length).toBeGreaterThan(requestsBefore)
    })
  })

  describe('entry resolution', () => {
    it('answers the specifier the driver named, and null for a kind it does not ship', async () => {
      const host = await createTestHost({ entries: { provider: { specifier: 'x/provider' }, mount: { specifier: 'x/mount' }, panels: null, picker: null } })

      const mount = unwrap(await host.core.registry.resolveEntrypoint({
        driverId: STUB_DRIVER_ID,
        kind: ModelDriverEntryKind.MOUNT,
      }))
      expect(mount).toEqual({ specifier: 'x/mount' })

      const picker = unwrap(await host.core.registry.resolveEntrypoint({
        driverId: STUB_DRIVER_ID,
        kind: ModelDriverEntryKind.PICKER,
      }))
      // `null` is a value, not a failure: the host shows no UI there instead of inventing one.
      expect(picker).toBeNull()
    })

    it('fails for a driver it has no manager for', async () => {
      const host = await createTestHost()
      unwrap(await host.core.registry.setEnabled(STUB_DRIVER_ID, false))
      const result = await host.core.registry.resolveEntrypoint({ driverId: STUB_DRIVER_ID, kind: ModelDriverEntryKind.MOUNT })
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error.code).toBe(ContractFailureCode.DRIVER_UNAVAILABLE)
    })
  })

  describe('renderer requests', () => {
    it('reuses the channel the driver already has', async () => {
      const host = await createTestHost()
      const window = host.openWindow('control-strip')
      await window.mount({ surface: 'acting', purpose: 'acting' })
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

      const manager = host.core.registry.get(STUB_DRIVER_ID)!
      const handleRequest = await manager.listModels()
      expect(handleRequest.ok).toBe(true)

      const requestsAfterFirst = window.requests.length
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))
      // The second pull reuses the open channel: no second entry was started in the window.
      expect(window.requests.length).toBe(requestsAfterFirst)
    })

    it('starts the shared background window when no renderer is live', async () => {
      const host = await createTestHost()
      expect(host.backgroundWindowId()).toBeUndefined()

      host.driver.models.set('model_a', { modelId: 'model_a', profileId: 'profile_a', name: 'A' })

      // A background window is only created on a request that cannot reuse a renderer.
      const rows = await host.core.registry.refreshRows(STUB_DRIVER_ID)
      expect(rows.ok).toBe(true)
      expect(host.backgroundWindowId()).toBe('background')
      expect(host.backgroundStarts()).toBe(1)

      // A second pull reuses the channel that window opened.
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))
      expect(host.backgroundStarts()).toBe(1)
    })

    it('answers the driver-disabled refusal', async () => {
      const host = await createTestHost()
      unwrap(await host.core.registry.setEnabled(STUB_DRIVER_ID, false))
      const manager = host.core.registry.get(STUB_DRIVER_ID)
      expect(manager).toBeUndefined()
    })

    it('sends an addressed delivery to the window holding the mount, not the one that answered a pull', async () => {
      const host = await createTestHost()
      const puller = host.openWindow('puller')
      const actor = host.openWindow('actor')

      // A window with an unrelated mount answers the row pull, so the manager's unaddressed channel points
      // there. This is the shape of a real session: the stage window answers first because it exists first.
      const unmoved = await puller.mount({ surface: 'stage', purpose: 'stage' })
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

      // Only the second window holds an acting mount.
      const acting = await actor.mount({ surface: 'acting', purpose: 'acting' })

      unwrap(await unwrap(await puller.cueChannel.send(envelope('acting'))).settled)
      // Reusing the pull's channel here would deliver to a window that can only answer `NO_TARGET`.
      expect(acting.mount.received).toHaveLength(1)
      expect(unmoved.mount.received).toHaveLength(0)
    })

    it('answers shutting-down once the host is released', async () => {
      const host = await createTestHost()
      // Keep a live window so a request would otherwise succeed.
      host.openWindow('control-strip')
      await host.core.shutdown()

      const result = await host.core.registry.requestRenderer({ driverId: STUB_DRIVER_ID })
      expect(result).toEqual({ ok: false, reason: RendererRequestRefusal.SHUTTING_DOWN })
    })

    it('propagates an entry failure when no window can serve it', async () => {
      // Both the live window and the background window refuse: the registry tries each in turn (§4.3) and
      // the caller sees the refusal rather than a phantom success.
      const host = await createTestHost({ refuseEntries: true })
      host.openWindow('control-strip')

      const result = await host.core.registry.requestRenderer({ driverId: STUB_DRIVER_ID })
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toBe(RendererRequestRefusal.ENTRY_FAILED)
    })

    it('falls back to the background window when the live renderer refuses the entry', async () => {
      const host = await createTestHost()
      host.openWindow('control-strip', { refuseEntries: true })

      const result = await host.core.registry.requestRenderer({ driverId: STUB_DRIVER_ID })
      // A window that cannot start the entry is not the driver's answer: the shared window gets the next
      // attempt, so one busy or tearing-down renderer does not break a row pull (§4.3).
      expect(result.ok).toBe(true)
      expect(host.backgroundStarts()).toBe(1)
    })

    it('reports the channel a closed window was serving, addressed to its driver', async () => {
      const host = await createTestHost()
      const first = host.openWindow('one')
      await first.mount({ surface: 'stage', purpose: 'stage' })
      // The pull is what opens the manager's channel to this window.
      unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

      const closed: DriverRegistryEvent[] = []
      host.core.registry.onEvent((event) => {
        if (event.kind === 'channel-closed')
          closed.push(event)
      })

      // A window that served nothing has nothing to report.
      const idle = host.openWindow('idle')
      await idle.close()
      expect(closed).toHaveLength(0)

      await first.close()

      // The manager cannot observe a window dying and its `send` cannot fail, so the registry — which owns the
      // channel — is the party that says which address was lost (P1-D23).
      expect(closed).toEqual([{ kind: 'channel-closed', driverId: STUB_DRIVER_ID, windowId: 'one' }])
    })
  })
})
