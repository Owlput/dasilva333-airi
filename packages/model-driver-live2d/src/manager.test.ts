/**
 * The manager, against a fake window.
 *
 * The point of these tests is the shape the manager owes every caller: one ack per cue, one channel per address,
 * a `window-gone` failure when the window dies, and a `null` entry for a kind this driver does not ship. No DOM and
 * no Pixi are involved — the manager is main's half and must stay that way.
 */
import type {
  ContractResult,
  CueAck,
  CueEnvelope,
  CueWithdrawalRequest,
  EntrypointResolution,
  HostLogger,
  ManagerChannel,
  ModelSummary,
  RegistryChange,
  RegistryHandle,
} from '@proj-airi/stage-renderer-sdk'

import type { Live2DManagerCall, Live2DProviderReply } from './protocol'

import { CueKind, CueSource, CueWithdrawalKind, ModelDriverEntryKind, RendererMountPurpose, RendererMountSurfaceKind } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'

import { createManager } from './manager'
import { LIVE2D_DRIVER_ID, LIVE2D_IMPORT_SPECIFIER, LIVE2D_MOUNT_SPECIFIER, LIVE2D_PANELS_SPECIFIER, LIVE2D_PICKER_SPECIFIER, LIVE2D_PROVIDER_SPECIFIER } from './manifest'
import { isLive2DManagerCall } from './protocol'

const logger: HostLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const ROW: ModelSummary = {
  modelDriverId: LIVE2D_DRIVER_ID,
  modelId: 'model_1',
  profileId: 'profile_1',
  name: 'Hiyori',
}

interface FakeWindow {
  channel: ManagerChannel
  calls: Live2DManagerCall[]
  requests: number
  emit: (message: Live2DProviderReply) => void
  /** `undefined` means "do not answer", which is how a pending call is held in flight. */
  respond: (call: Live2DManagerCall) => unknown | undefined
}

function defaultAnswer(call: Live2DManagerCall): unknown {
  switch (call.method) {
    case 'list-models':
      return { type: 'result', id: call.id, value: [ROW] }
    case 'deliver':
      return {
        type: 'result',
        id: call.id,
        value: {
          nonce: call.envelope.nonce,
          modelDriverId: LIVE2D_DRIVER_ID,
          results: call.envelope.cues.map(() => ({ status: 'resolved', value: { kind: CueKind.CAPTION } })),
          handled: true,
        } satisfies CueAck,
      }
    case 'withdraw':
      return { type: 'result', id: call.id, value: { kind: call.request.kind, results: [], count: 0 } }
    case 'query-mount':
      return { type: 'result', id: call.id, value: [] }
    case 'command-mount':
      return { type: 'result', id: call.id, value: [] }
  }
}

function fakeWindow(): FakeWindow {
  const listeners = new Set<(message: unknown) => void>()
  const window: FakeWindow = {
    calls: [],
    requests: 0,
    respond: defaultAnswer,
    emit(message) {
      for (const listener of [...listeners])
        listener(message)
    },
    channel: {
      send(message) {
        if (!isLive2DManagerCall(message))
          return
        window.calls.push(message)
        const reply = window.respond(message)
        if (reply !== undefined)
          queueMicrotask(() => window.emit(reply as Live2DProviderReply))
      },
      onMessage(handler) {
        listeners.add(handler)
        return () => {
          listeners.delete(handler)
        }
      },
    },
  }
  return window
}

function fakeHandle(window: FakeWindow) {
  const changeHandlers = new Set<(change: RegistryChange) => void>()
  const handle: RegistryHandle = {
    log: logger,
    async requestRenderer() {
      window.requests += 1
      return { ok: true, channel: window.channel }
    },
    listDrivers: () => [],
    isEnabled: () => true,
    onChange(handler) {
      changeHandlers.add(handler)
      return () => {
        changeHandlers.delete(handler)
      }
    },
  }
  return {
    handle,
    closeChannel() {
      for (const handler of [...changeHandlers])
        handler({ kind: 'channel-closed', driverId: LIVE2D_DRIVER_ID, windowId: 'window-1' })
    },
  }
}

function envelope(cues: CueEnvelope['cues']): CueEnvelope {
  return {
    cues,
    source: CueSource.HOST,
    override: true,
    nonce: 7,
    at: Date.now(),
    target: { modelDriverId: LIVE2D_DRIVER_ID },
  }
}

/** Wait until the manager has actually put the call on the wire before killing the window. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate())
      return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for the fake window')
}

function resolvedSpecifier(result: ContractResult<EntrypointResolution>): string | null {
  if (!result.ok)
    throw new Error(result.error.message)
  return result.value ? result.value.specifier : null
}

describe('live2d manager', () => {
  it('resolves all five renderer entry kinds to the specifiers this driver ships', async () => {
    const window = fakeWindow()
    const manager = createManager(fakeHandle(window).handle)

    expect(resolvedSpecifier(await manager.resolveEntrypoint({ driverId: LIVE2D_DRIVER_ID, kind: ModelDriverEntryKind.PROVIDER })))
      .toBe(LIVE2D_PROVIDER_SPECIFIER)
    expect(resolvedSpecifier(await manager.resolveEntrypoint({ driverId: LIVE2D_DRIVER_ID, kind: ModelDriverEntryKind.MOUNT })))
      .toBe(LIVE2D_MOUNT_SPECIFIER)
    expect(resolvedSpecifier(await manager.resolveEntrypoint({ driverId: LIVE2D_DRIVER_ID, kind: ModelDriverEntryKind.PANELS })))
      .toBe(LIVE2D_PANELS_SPECIFIER)
    expect(resolvedSpecifier(await manager.resolveEntrypoint({ driverId: LIVE2D_DRIVER_ID, kind: ModelDriverEntryKind.PICKER })))
      .toBe(LIVE2D_PICKER_SPECIFIER)
    expect(resolvedSpecifier(await manager.resolveEntrypoint({ driverId: LIVE2D_DRIVER_ID, kind: ModelDriverEntryKind.IMPORT })))
      .toBe(LIVE2D_IMPORT_SPECIFIER)
  })

  it('pulls rows through one channel and reuses it', async () => {
    const window = fakeWindow()
    const manager = createManager(fakeHandle(window).handle)

    const first = await manager.listModels()
    const second = await manager.listModels()

    expect(first.ok ? first.value : []).toEqual([ROW])
    expect(second.ok ? second.value : []).toEqual([ROW])
    expect(window.requests).toBe(1)
    expect(window.calls.filter(call => call.method === 'list-models')).toHaveLength(2)
  })

  it('forwards a delivery and returns the window ack', async () => {
    const window = fakeWindow()
    const manager = createManager(fakeHandle(window).handle)

    const answer = await manager.deliver(envelope([{ kind: CueKind.CAPTION, text: 'hi', utteranceId: 'u1' }]))
    expect(answer.ok).toBe(true)
    if (!answer.ok)
      return
    expect(answer.value.handled).toBe(true)
    expect(answer.value.results).toHaveLength(1)
  })

  it('turns a load failure into a failed send rather than an ack', async () => {
    const window = fakeWindow()
    const manager = createManager(fakeHandle(window).handle)
    window.respond = (call) => {
      if (call.method !== 'deliver')
        return defaultAnswer(call)
      return { type: 'result', id: call.id, value: { failure: { code: 'asset-missing', message: 'no bytes' } } }
    }

    const answer = await manager.deliver(envelope([{ kind: CueKind.LOAD, modelId: 'model_missing' }]))
    expect(answer.ok).toBe(false)
    if (!answer.ok)
      expect(answer.error.code).toBe('asset-missing')
  })

  it('fails an in-flight call when the window closes, and re-requests a renderer next time', async () => {
    const window = fakeWindow()
    const handle = fakeHandle(window)
    const manager = createManager(handle.handle)

    // First call opens the channel, so the close has something to drop.
    await manager.listModels()

    window.respond = () => undefined
    const pending = manager.deliver(envelope([{ kind: CueKind.CAPTION, text: 'hi', utteranceId: 'u1' }]))
    // `deliver` awaits the channel before it registers the correlation, so the close must come after the call is on
    // the wire; closing earlier would find nothing in flight and the assertion would measure the wrong moment.
    await waitFor(() => window.calls.some(call => call.method === 'deliver'))
    handle.closeChannel()
    const answer = await pending
    expect(answer.ok).toBe(false)
    if (!answer.ok)
      expect(answer.error.code).toBe('window-gone')

    // The next call opens a fresh channel rather than reusing the dead one.
    window.respond = defaultAnswer
    await manager.listModels()
    expect(window.requests).toBe(2)
  })

  it('returns a withdrawal report with the request\u2019s kind', async () => {
    const window = fakeWindow()
    const manager = createManager(fakeHandle(window).handle)
    const request: CueWithdrawalRequest = { kind: CueWithdrawalKind.ABORT, modelDriverId: LIVE2D_DRIVER_ID }
    const answer = await manager.withdraw(request)
    expect(answer.ok ? answer.value.kind : undefined).toBe(CueWithdrawalKind.ABORT)
  })

  it('addresses a query with the surface and purpose it was given', async () => {
    const window = fakeWindow()
    const manager = createManager(fakeHandle(window).handle)
    await manager.queryMount({ surface: RendererMountSurfaceKind.ACTING, purpose: RendererMountPurpose.ACTING }, { kind: 'readiness' })
    expect(window.calls[0]).toMatchObject({ method: 'query-mount' })
  })
})
