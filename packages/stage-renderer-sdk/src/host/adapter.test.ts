/**
 * The renderer adapter against a fake host: the ordinary paths, one at a time.
 *
 * This suite lives with the adapter because the adapter is part of the contract package: it is the renderer
 * half of RFC 0002, it has no transport of its own, and an application that consumed it would otherwise be the
 * only place its behaviour was ever exercised. Every case here is a path that actually broke in Phase 1 — an
 * entry started twice, an entry replaced under its own mounts, a settlement that arrived before anyone was
 * listening, a readiness step the host refused and nobody noticed.
 *
 * Both sides are faked deliberately, and neither is a mock: `HostClient` is a plain object because it is an
 * interface, and the driver is a small module defined below because the *protocol* between a manager and
 * its window half is the driver's own business — the host never reads it. What is real is the adapter's
 * plumbing: identity caching, the settlement buffer, the entry lifecycle and the message round trip.
 */
import type { CueAck, CueEnvelopeInput, CueWithdrawalReport } from '../contract/cues'
import type { HostLogger, HostServices, ModelPromptPublication, RendererPointerEvent } from '../contract/host-services'
import type { DriverInfo } from '../contract/references'
import type { ContractResult, ModelDriverId } from '../contract/shared'
import type { HostClient, ModelDriverHostState, ModelDriverSubmitAck } from './client'
import type { DriverProviderModule } from './loaders'
import type { WindowStorage } from './storage'

import { describe, expect, it, vi } from 'vitest'

import { CueKind, CueSource } from '../contract/cues'
import { RendererPointerPhase } from '../contract/host-services'
import { DriverStatus } from '../contract/references'
import { ModelDriverEntryKind } from '../contract/registry'
import { ContractFailureCode, RendererMountPurpose, RendererMountReadinessState, RendererMountSurfaceKind } from '../contract/shared'
import { createModelDriverAdapter } from './adapter'

const DRIVER_ID: ModelDriverId = 'ai.moeru.airi.test.adapter'
const PROVIDER_SPECIFIER = '@proj-airi/stage-renderer-sdk/host#testProvider'
const MOUNT_SPECIFIER = '@proj-airi/stage-renderer-sdk/host#testMount'
const PANELS_SPECIFIER = '@proj-airi/stage-renderer-sdk/host#testPanels'
const PICKER_SPECIFIER = '@proj-airi/stage-renderer-sdk/host#testPicker'
const UNKNOWN_SPECIFIER = '@proj-airi/stage-renderer-sdk/host#notInThisBuild'

const SURFACE = RendererMountSurfaceKind.ACTING
const PURPOSE = RendererMountPurpose.ACTING

/**
 * The window's primitives: a map, plus a recorder for prompt publications.
 *
 * This is deliberately everything the adapter is given — no driver namespace, no per-driver map. The adapter
 * composes those, and the isolation test below reads this map to prove it.
 */
function createMemoryWindowStorage() {
  const map = new Map<string, unknown>()
  const published: unknown[] = []

  const store: WindowStorage = {
    async get<T>(key: string) {
      return map.get(key) as T | undefined
    },
    async set(key, value) {
      map.set(key, value)
    },
    async remove(key) {
      map.delete(key)
    },
    async keys(prefix = '') {
      return [...map.keys()].filter(key => key.startsWith(prefix)).sort()
    },
  }

  return { map, published, store }
}

/**
 * The driver, as a module this build ships.
 *
 * It speaks one message: `{ type: 'call', id, method: 'list-models' }`, answered through the `send` the adapter
 * handed it. The protocol is deliberately this small — the adapter must carry whatever a driver says without
 * reading it.
 */
function createProviderModule() {
  const started: Array<{ driverId: ModelDriverId, services: HostServices }> = []
  const resolutions: Array<{ driverId: ModelDriverId, publication: ModelPromptPublication }> = []

  const module: DriverProviderModule = {
    startProviderEntry(options) {
      started.push({ driverId: options.driverId, services: options.services })
      options.services.prompt.onResolution((publication) => {
        resolutions.push({ driverId: options.driverId, publication })
        return { ok: true, value: undefined }
      })

      return {
        onMessage(message) {
          const call = message as { type?: unknown, id?: unknown, method?: unknown } | null
          if (call?.type !== 'call' || typeof call.id !== 'number')
            return

          options.send({
            type: 'result',
            id: call.id,
            value: call.method === 'list-models'
              ? [{ modelDriverId: DRIVER_ID, modelId: 'model_fixture', profileId: 'profile_fixture', name: 'Fixture model' }]
              : null,
          })
        },
      }
    },
  }

  return { module, started, resolutions }
}

const HOST_STATE: ModelDriverHostState = {
  drivers: [{
    driverId: DRIVER_ID,
    name: 'Test Driver',
    version: '0.1.0',
    status: DriverStatus.ENABLED,
    hasManager: true,
  } satisfies DriverInfo],
  rows: {},
  rowsUpdatedAt: {},
  rejections: [],
  legacyRetention: {},
  backgroundWindowStarted: false,
}

function ack(handled: boolean, nonce = 1): ContractResult<CueAck> {
  return {
    ok: true,
    value: { nonce, modelDriverId: DRIVER_ID, handled, results: [] },
  }
}

/**
 * The host, as the adapter sees it.
 *
 * Every member records what it was asked and answers the way a host does, including the two shapes that
 * matter: a settlement is pushed rather than returned, and an entry request is answered by the window rather
 * than by the call.
 */
function createFakeHost(options: {
  settleAtAccept?: boolean
  settleOnPush?: boolean
  refuseReadiness?: boolean
  /** Refuse the unregister, as a host does when the window has already gone. */
  failUnregister?: boolean
  /** Refuse the enable flag write, as a host does while it is shutting down. */
  failSetEnabled?: boolean
  /** Override what the manager answers for one entry kind; `null` means "this driver ships none". */
  entrypoints?: Partial<Record<ModelDriverEntryKind, string | null>>
} = {}) {
  const calls = {
    identify: 0,
    registerMount: [] as Array<{ driverId: string, surface: RendererMountSurfaceKind, purpose: RendererMountPurpose }>,
    readiness: [] as RendererMountReadinessState[],
    submitCue: [] as CueEnvelopeInput[],
    managerMessages: [] as unknown[],
    entryResults: [] as Array<{ requestId: string, error?: { code: string, message: string } }>,
    promptResolutions: [] as Array<{ driverId: string, publication: ModelPromptPublication }>,
  }

  let mounts = 0
  let nonces = 0
  const settledHandlers = new Set<(settlement: { nonce: number, result: ContractResult<CueAck> }) => void>()
  const openEntryHandlers = new Set<(request: { requestId: string, driverId: string, specifier: string }) => void>()
  const managerMessageHandlers = new Set<(payload: { driverId: string, message: unknown }) => void>()
  const promptResolutionHandlers = new Set<(payload: { driverId: ModelDriverId, publication: ModelPromptPublication }) => void>()

  const client: HostClient = {
    async identify() {
      calls.identify += 1
      return { windowId: 'w7' }
    },

    async registerMount(request) {
      calls.registerMount.push(request)
      mounts += 1
      return { ok: true, mountId: `mount_${mounts}` }
    },

    async unregisterMount() {
      if (options.failUnregister) {
        return {
          ok: false,
          error: { code: ContractFailureCode.INTERNAL, message: 'the window that owned the mount is gone' },
        }
      }
      return { ok: true, value: undefined }
    },

    async reportReadiness(request) {
      calls.readiness.push(request.readiness)
      if (options.refuseReadiness) {
        return {
          ok: false,
          error: { code: 'invalid-readiness-transition' as never, message: 'not reachable from unmounted' },
        }
      }
      return { ok: true, value: undefined }
    },

    async withdrawCues() {
      return { ok: true, value: { kind: 'abort', count: 0, results: [] } as unknown as CueWithdrawalReport }
    },

    async resolveEntrypoint(request) {
      const declared = options.entrypoints?.[request.kind]
      if (declared === null)
        return { ok: true, value: null }
      if (declared !== undefined)
        return { ok: true, value: { specifier: declared } }

      switch (request.kind) {
        case ModelDriverEntryKind.MOUNT:
          return { ok: true, value: { specifier: MOUNT_SPECIFIER } }
        case ModelDriverEntryKind.PANELS:
          return { ok: true, value: { specifier: PANELS_SPECIFIER } }
        case ModelDriverEntryKind.PICKER:
          return { ok: true, value: { specifier: PICKER_SPECIFIER } }
        default:
          return { ok: true, value: { specifier: PROVIDER_SPECIFIER } }
      }
    },

    async hostState() {
      return HOST_STATE
    },

    async pullRows() {
      return { ok: true, value: [] }
    },

    async setEnabled() {
      if (options.failSetEnabled) {
        return {
          ok: false,
          error: { code: ContractFailureCode.INTERNAL, message: 'the host is shutting down' },
        }
      }
      return { ok: true, value: undefined }
    },

    async submitCue(request) {
      calls.submitCue.push(request.envelope)
      nonces += 1
      const settledImmediately = options.settleAtAccept ? ack(false, nonces) : undefined
      const submitted: ModelDriverSubmitAck = { nonce: nonces, ...(settledImmediately ? { settledImmediately } : {}) }

      // A settlement that arrives while `submitCue` is still returning: the adapter has to keep it, because the
      // caller has no resolver attached yet.
      if (options.settleOnPush) {
        for (const handler of [...settledHandlers])
          handler({ nonce: nonces, result: ack(true, nonces) })
      }

      return { ok: true, value: submitted }
    },

    async sendManagerMessage(payload) {
      calls.managerMessages.push(payload.message)
      return { ok: true, value: undefined }
    },

    async sendEntryResult(payload) {
      calls.entryResults.push(payload)
      return { ok: true, value: undefined }
    },

    async deliverPromptResolution(payload) {
      calls.promptResolutions.push(payload)
      const handlers = [...promptResolutionHandlers]
      for (const handler of handlers)
        handler(payload)
      return { ok: true, value: { delivered: handlers.length } }
    },

    onCueSettled(handler) {
      settledHandlers.add(handler)
      return () => settledHandlers.delete(handler)
    },

    onOpenEntry(handler) {
      openEntryHandlers.add(handler)
      return () => openEntryHandlers.delete(handler)
    },

    onManagerMessage(handler) {
      managerMessageHandlers.add(handler)
      return () => managerMessageHandlers.delete(handler)
    },

    onPromptResolution(handler) {
      promptResolutionHandlers.add(handler)
      return () => promptResolutionHandlers.delete(handler)
    },
  }

  return {
    client,
    calls,
    settle(nonce: number, handled = true) {
      for (const handler of [...settledHandlers])
        handler({ nonce, result: ack(handled) })
    },
    openEntry(requestId: string) {
      for (const handler of [...openEntryHandlers])
        handler({ requestId, driverId: DRIVER_ID, specifier: PROVIDER_SPECIFIER })
    },
    managerMessage(message: unknown) {
      for (const handler of [...managerMessageHandlers])
        handler({ driverId: DRIVER_ID, message })
    },
    promptResolution(driverId: ModelDriverId, publication: ModelPromptPublication) {
      for (const handler of [...promptResolutionHandlers])
        handler({ driverId, publication })
    },
  }
}

async function createAdapter(options: Parameters<typeof createFakeHost>[0] = {}, logger?: HostLogger) {
  const host = createFakeHost(options)
  const driver = createProviderModule()
  const memory = createMemoryWindowStorage()
  // The four renderer entries a driver ships, as this build would map them. The components are opaque objects:
  // what the adapter owes is *the module the manager named*, not a rendering.
  const mountComponent = { name: 'TestMount' }
  const pickerComponent = { name: 'TestPicker' }
  const panels = [{ id: 'test-panel', label: 'Test panel', component: async () => ({ default: { name: 'TestPanel' } }) }]

  const adapter = await createModelDriverAdapter({
    client: host.client,
    storage: memory.store,
    ...(logger ? { logger } : {}),
    prompts: {
      async publish(publication) {
        memory.published.push(publication)
        return { ok: true, value: undefined }
      },
    },
    loaders: {
      providers: () => [PROVIDER_SPECIFIER],
      resolveProvider: specifier => (specifier === PROVIDER_SPECIFIER ? async () => driver.module : undefined),
      mounts: () => [MOUNT_SPECIFIER],
      resolveMount: specifier => (specifier === MOUNT_SPECIFIER ? async () => ({ default: mountComponent as never }) : undefined),
      panels: () => [PANELS_SPECIFIER],
      resolvePanels: specifier => (specifier === PANELS_SPECIFIER ? async () => ({ declarations: () => panels as never }) : undefined),
      pickers: () => [PICKER_SPECIFIER],
      resolvePicker: specifier => (specifier === PICKER_SPECIFIER ? async () => ({ default: pickerComponent as never }) : undefined),
    },
  })
  return { memory, host, adapter, driver, mountComponent, pickerComponent, panels }
}

function envelope(): CueEnvelopeInput {
  return {
    cues: [{ kind: CueKind.LOAD, modelId: 'model_fixture', profileId: 'profile_fixture' }],
    source: CueSource.USER,
    override: true,
    target: { modelDriverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
  }
}

describe('model driver adapter', () => {
  it('asks the host for its identity once, however often it is asked', async () => {
    const { host, adapter } = await createAdapter()

    expect(await adapter.windowId()).toBe('w7')
    expect(await adapter.windowId()).toBe('w7')
    expect(host.calls.identify).toBe(1)
  })

  it('registers a mount and keeps the id the host issued', async () => {
    const { host, adapter } = await createAdapter()

    const registered = await adapter.registerMount({ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE })

    expect(registered).toEqual({ ok: true, mountId: 'mount_1' })
    expect(host.calls.registerMount).toEqual([{ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE }])
  })

  it('walks readiness and reports a refused step instead of claiming success', async () => {
    const { host, adapter } = await createAdapter({ refuseReadiness: true })
    const registered = await adapter.registerMount({ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    if (!registered.ok)
      throw new Error('the host refused the mount')

    const result = await adapter.setReadiness(registered.mountId, RendererMountReadinessState.MOUNTING)

    expect(host.calls.readiness).toEqual([RendererMountReadinessState.MOUNTING])
    expect(result.ok).toBe(false)
  })

  it('sends a cue, keeps the host nonce, and settles on the pushed event', async () => {
    const { host, adapter } = await createAdapter()

    const receipt = await adapter.cues.send(envelope())
    if (!receipt.ok)
      throw new Error(`the host refused the cue: ${receipt.error.message}`)

    // The correlation value is the host's: the renderer never mints one.
    expect(receipt.value.nonce).toBe(1)
    expect(host.calls.submitCue).toEqual([envelope()])

    host.settle(1)
    expect(await receipt.value.settled).toEqual(ack(true))
  })

  it('keeps a settlement that arrived before the caller could attach', async () => {
    const { adapter } = await createAdapter({ settleOnPush: true })

    const receipt = await adapter.cues.send(envelope())
    if (!receipt.ok)
      throw new Error('the host refused the cue')

    // No `settle()` call: the answer was pushed while `submitCue` was still returning.
    expect(await receipt.value.settled).toEqual(ack(true))
  })

  it('uses the settlement the host decided at acceptance, without waiting for another', async () => {
    const { adapter } = await createAdapter({ settleAtAccept: true })

    const receipt = await adapter.cues.send(envelope())
    if (!receipt.ok)
      throw new Error('the host refused the cue')

    expect(await receipt.value.settled).toEqual(ack(false))
  })

  it('starts the driver entry once, and answers a repeated host request without restarting it', async () => {
    const { host, adapter, driver } = await createAdapter()

    const first = await adapter.ensureEntry(DRIVER_ID)
    const second = await adapter.ensureEntry(DRIVER_ID)
    expect(first.ok && second.ok).toBe(true)
    expect(adapter.entries().size).toBe(1)
    expect(driver.started).toHaveLength(1)

    // The host now asks for the entry it can already reach: the window must answer, not replace the half that
    // owns this window's mounts.
    host.openEntry('entry_1')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(host.calls.entryResults).toEqual([{ requestId: 'entry_1' }])
    expect(adapter.entries().size).toBe(1)
    expect(driver.started).toHaveLength(1)
  })

  it('carries the manager channel into the running entry and back out', async () => {
    const { host, adapter } = await createAdapter()
    await adapter.ensureEntry(DRIVER_ID)

    // A driver-protocol call, answered by the driver half on the other side of the adapter's plumbing.
    host.managerMessage({ type: 'call', id: 1, method: 'list-models' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(host.calls.managerMessages).toEqual([
      {
        type: 'result',
        id: 1,
        value: [expect.objectContaining({ modelId: 'model_fixture', profileId: 'profile_fixture' })],
      },
    ])
  })

  it('composes one namespace per driver from the window primitives', async () => {
    const { memory, adapter, driver } = await createAdapter()
    const second: ModelDriverId = 'ai.moeru.airi.test.adapter.second'

    await adapter.ensureEntry(DRIVER_ID)
    await adapter.ensureEntry(second)

    const firstStorage = driver.started.find(entry => entry.driverId === DRIVER_ID)?.services.storage
    const secondStorage = driver.started.find(entry => entry.driverId === second)?.services.storage
    if (!firstStorage || !secondStorage)
      throw new Error('both entries should have started')

    await firstStorage.set('settings', { volume: 0.5 })

    // The same key in another namespace is a different key, and `keys()` sees only its own root.
    expect(await firstStorage.get('settings')).toEqual({ volume: 0.5 })
    expect(await secondStorage.get('settings')).toBeUndefined()
    expect(await secondStorage.keys()).toEqual([])

    // A panel in this window reaches the same namespace through the adapter, without being the driver.
    expect(await adapter.storageFor(DRIVER_ID).get('settings')).toEqual({ volume: 0.5 })

    // What the embedder gave the adapter is primitives: the composed path is the adapter's doing.
    expect([...memory.map.keys()]).toEqual([`airi-driver-${DRIVER_ID}/settings`])
  })

  it('hands a resolved publication back to the driver that owns it', async () => {
    const { host, adapter, driver } = await createAdapter()
    await adapter.ensureEntry(DRIVER_ID)

    const publication: ModelPromptPublication = {
      modelDriverId: DRIVER_ID,
      modelId: 'model_fixture',
      profileId: 'profile_fixture',
      text: 'Resolved by the user.',
      tokens: ['happy'],
      version: 7,
      publishedAt: 1_000,
    }

    host.promptResolution(DRIVER_ID, publication)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(driver.resolutions).toEqual([{ driverId: DRIVER_ID, publication }])

    // A resolution for a driver this window does not run has nothing to deliver to, and is dropped rather than
    // treated as an error: the host addresses the window that runs the driver, and a broadcast is not one.
    host.promptResolution('ai.moeru.airi.test.adapter.absent', publication)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(driver.resolutions).toHaveLength(1)
  })

  it('imports the mount, panels and picker entries the manager named', async () => {
    const { adapter, mountComponent, pickerComponent, panels } = await createAdapter()

    const mount = await adapter.mountComponent({ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    expect(mount.ok).toBe(true)
    if (mount.ok)
      expect(mount.value).toBe(mountComponent as never)

    const declarations = await adapter.panelDeclarations(DRIVER_ID)
    expect(declarations.ok).toBe(true)
    if (declarations.ok)
      expect(declarations.value).toEqual(panels as never)

    const picker = await adapter.pickerComponent(DRIVER_ID)
    expect(picker.ok).toBe(true)
    if (picker.ok)
      expect(picker.value).toBe(pickerComponent as never)
  })

  it('treats "this driver ships no such entry" as a value, not a failure', async () => {
    const { adapter } = await createAdapter({
      entrypoints: { [ModelDriverEntryKind.MOUNT]: null, [ModelDriverEntryKind.PICKER]: null },
    })

    const mount = await adapter.mountComponent({ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    expect(mount).toEqual({ ok: true, value: null })

    const picker = await adapter.pickerComponent(DRIVER_ID)
    expect(picker).toEqual({ ok: true, value: null })
  })

  it('refuses an entry specifier this build cannot resolve as invalid-entrypoint', async () => {
    const { adapter } = await createAdapter({ entrypoints: { [ModelDriverEntryKind.MOUNT]: UNKNOWN_SPECIFIER } })

    const mount = await adapter.mountComponent({ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    expect(mount.ok).toBe(false)
    if (!mount.ok)
      expect(mount.error.code).toBe(ContractFailureCode.INVALID_ENTRYPOINT)
  })

  it('exposes the services a panel or picker is mounted with, once the entry has started', async () => {
    const { adapter, driver } = await createAdapter()
    expect(adapter.servicesFor(DRIVER_ID)).toBeUndefined()

    await adapter.ensureEntry(DRIVER_ID)

    const services = adapter.servicesFor(DRIVER_ID)
    expect(services).toBe(driver.started[0]?.services)
    // The panel prop and the driver's activation see one container, not two shapes of the same thing.
    expect(services?.modelDriverId).toBe(DRIVER_ID)
  })

  it('converts this window\'s pointer events into the box of the mount they happened in', async () => {
    const { adapter } = await createAdapter()
    await adapter.ensureEntry(DRIVER_ID)

    const services = adapter.servicesFor(DRIVER_ID)
    expect(services).toBeDefined()
    if (!services)
      return

    // Two mounts in one window is exactly the case a single global coordinate space breaks (exit criterion 6).
    adapter.pointer.setBox('mount_a', { left: 100, top: 50 })
    adapter.pointer.setBox('mount_b', { left: 0, top: 0 })
    const first: RendererPointerEvent[] = []
    const second: RendererPointerEvent[] = []
    services.pointer.subscribe('mount_a', event => first.push(event))
    services.pointer.subscribe('mount_b', event => second.push(event))

    adapter.pointer.dispatch('mount_a', {
      phase: RendererPointerPhase.MOVE,
      pointerId: 7,
      clientX: 130,
      clientY: 80,
      pointerType: 'mouse',
    })

    expect(first).toHaveLength(1)
    expect(first[0]?.point).toEqual({ x: 30, y: 30 })
    expect(second).toHaveLength(0)

    // Unmounting releases the subscription with the element, so a later event for that id reaches nobody.
    await adapter.unregisterMount('mount_a')
    adapter.pointer.dispatch('mount_a', { phase: RendererPointerPhase.MOVE, pointerId: 7, clientX: 130, clientY: 80 })
    expect(first).toHaveLength(1)
  })

  it('asks the host to deliver an arbitrated publication, and reports how many windows heard it', async () => {
    const { host, adapter, driver } = await createAdapter()
    await adapter.ensureEntry(DRIVER_ID)

    const publication: ModelPromptPublication = {
      modelDriverId: DRIVER_ID,
      modelId: 'model_fixture',
      profileId: 'profile_fixture',
      text: 'Arbitrated.',
      tokens: [],
      version: 9,
      publishedAt: 2_000,
    }

    const result = await adapter.deliverPromptResolution(DRIVER_ID, publication)
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.value.delivered).toBe(1)

    // The fake host loops the delivery straight back, which is what the real service does over IPC: the driver's own
    // handler is the thing that records the decision (P1-D26).
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(host.calls.promptResolutions).toHaveLength(1)
    expect(driver.resolutions.at(-1)?.publication.version).toBe(9)
  })

  it('stops listening once disposed', async () => {
    const { host, adapter } = await createAdapter()
    const receipt = await adapter.cues.send(envelope())
    if (!receipt.ok)
      throw new Error('the host refused the cue')

    adapter.dispose()
    host.settle(1)

    // Nothing is waiting any more, so the settlement is dropped rather than delivered into a disposed adapter.
    expect(await Promise.race([
      receipt.value.settled.then(() => 'settled'),
      Promise.resolve('still waiting'),
    ])).toBe('still waiting')
  })

  it('warns instead of throwing when the host cannot release a mount', async () => {
    const logger: HostLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const { adapter } = await createAdapter({ failUnregister: true }, logger)
    const registered = await adapter.registerMount({ driverId: DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    if (!registered.ok)
      throw new Error('the host refused the mount')

    // Unmounting is what happens when a window is already going away, so a refusal must not become an exception in
    // the unmount path: the subscription is released either way, and the failure is reported as a warning.
    await expect(adapter.unregisterMount(registered.mountId)).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith(
      'model-drivers',
      expect.stringContaining(`Could not unregister mount \`${registered.mountId}\``),
    )
  })

  it('resolves an entrypoint through the host and does not decide for it', async () => {
    const { adapter } = await createAdapter()

    const resolved = await adapter.resolveEntrypoint({ driverId: DRIVER_ID, kind: ModelDriverEntryKind.MOUNT, surface: SURFACE, purpose: PURPOSE })

    // The manager chooses and this only carries the answer: a specifier this build does not have stays the
    // adapter's refusal, and it never substitutes one of its own.
    expect(resolved).toEqual({ ok: true, value: { specifier: MOUNT_SPECIFIER } })
  })

  it('narrows a successful enable and passes a refusal through untouched', async () => {
    const allowed = await createAdapter()
    expect(await allowed.adapter.setEnabled(DRIVER_ID, true)).toEqual({ ok: true, value: undefined })

    const refused = await createAdapter({ failSetEnabled: true })
    const result = await refused.adapter.setEnabled(DRIVER_ID, false)

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toBe('the host is shutting down')
  })
})
