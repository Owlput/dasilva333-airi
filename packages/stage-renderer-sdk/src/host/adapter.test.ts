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
import type { HostServices, ModelPromptPublication } from '../contract/host-services'
import type { DriverInfo } from '../contract/references'
import type { ContractResult, ModelDriverId } from '../contract/shared'
import type { HostClient, ModelDriverHostState, ModelDriverSubmitAck } from './client'
import type { DriverProviderModule } from './loaders'
import type { WindowStorage } from './storage'

import { describe, expect, it } from 'vitest'

import { CueKind, CueSource } from '../contract/cues'
import { DriverStatus } from '../contract/references'
import {
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../contract/shared'
import { createModelDriverAdapter } from './adapter'

const DRIVER_ID: ModelDriverId = 'ai.moeru.airi.test.adapter'
const PROVIDER_SPECIFIER = '@proj-airi/stage-renderer-sdk/host#testProvider'

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
function createFakeHost(options: { settleAtAccept?: boolean, settleOnPush?: boolean, refuseReadiness?: boolean } = {}) {
  const calls = {
    identify: 0,
    registerMount: [] as Array<{ driverId: string, surface: RendererMountSurfaceKind, purpose: RendererMountPurpose }>,
    readiness: [] as RendererMountReadinessState[],
    submitCue: [] as CueEnvelopeInput[],
    managerMessages: [] as unknown[],
    entryResults: [] as Array<{ requestId: string, error?: { code: string, message: string } }>,
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

    async resolveEntrypoint() {
      return { ok: true, value: { specifier: PROVIDER_SPECIFIER } }
    },

    async hostState() {
      return HOST_STATE
    },

    async pullRows() {
      return { ok: true, value: [] }
    },

    async setEnabled() {
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

async function createAdapter(options: Parameters<typeof createFakeHost>[0] = {}) {
  const host = createFakeHost(options)
  const driver = createProviderModule()
  const memory = createMemoryWindowStorage()
  const adapter = await createModelDriverAdapter({
    client: host.client,
    storage: memory.store,
    prompts: {
      async publish(publication) {
        memory.published.push(publication)
        return { ok: true, value: undefined }
      },
    },
    loaders: {
      providers: () => [PROVIDER_SPECIFIER],
      resolveProvider: specifier => (specifier === PROVIDER_SPECIFIER ? async () => driver.module : undefined),
    },
  })
  return { memory, host, adapter, driver }
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
})
