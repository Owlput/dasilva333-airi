/**
 * The renderer's `HostClient`, over a real eventa transport that is not Electron.
 *
 * This is the file that turns the typed IPC contract into the SDK's transport-free interface, and until this suite
 * existed nothing exercised it: the channel names, the payload shapes and the envelope unwrapping on four
 * subscriptions were reviewed by eye only. A wrong channel here is not a crash — an invoke simply never resolves —
 * which is exactly the failure mode a compile and a manual smoke test both miss.
 *
 * The transport is `broadcast-channel` on purpose. Two `BroadcastChannel` objects with one name in one process behave
 * like two processes do: a message posted by one is delivered to the other and never echoed back. So the suite drives
 * the real contract end to end with no Electron, no `ipcMain`, and no mocking of eventa — which is also the
 * demonstration that the client is not tied to one adapter.
 */
import type { CueAck, CueEnvelopeInput, ModelPromptPublication } from '@proj-airi/stage-renderer-sdk'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/broadcast-channel'
import {
  ContractFailureCode,
  CueKind,
  CueSource,
  CueWithdrawalKind,
  ModelDriverEntryKind,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import {
  modelDriverCueSettledEventa,
  modelDriverDeliverPromptResolutionInvokeEventa,
  modelDriverEntryResultInvokeEventa,
  modelDriverIdentifyInvokeEventa,
  modelDriverManagerMessageEventa,
  modelDriverManagerMessageInvokeEventa,
  modelDriverMountReadinessInvokeEventa,
  modelDriverOpenEntryEventa,
  modelDriverPromptResolutionEventa,
  modelDriverPullRowsInvokeEventa,
  modelDriverRegisterMountInvokeEventa,
  modelDriverResolveEntrypointInvokeEventa,
  modelDriverSetEnabledInvokeEventa,
  modelDriverStateInvokeEventa,
  modelDriverSubmitCueInvokeEventa,
  modelDriverUnregisterMountInvokeEventa,
  modelDriverWithdrawCuesInvokeEventa,
} from '../../../shared/model-drivers-eventa'
import { createEventaHostClient } from './eventa-client'

const DRIVER = 'ai.moeru.airi.test.contract' as const
const SURFACE = RendererMountSurfaceKind.ACTING
const PURPOSE = RendererMountPurpose.ACTING

const PUBLICATION: ModelPromptPublication = {
  modelDriverId: DRIVER,
  modelId: 'model_a',
  profileId: 'profile_a',
  text: 'Speak softly.',
  tokens: ['calm'],
  version: 4,
  publishedAt: 1_700_000_000_000,
}

/** The smallest ack the contract accepts: one settled outcome per cue, and none here. */
function ack(nonce: number): CueAck {
  return { nonce, modelDriverId: DRIVER, results: [], handled: true }
}

/** Every pair opened by a test, torn down afterwards so one test's channel cannot leak into the next. */
const opened: Array<() => void> = []
let sequence = 0

/**
 * A main side and a renderer side on one channel name, plus the client under test.
 *
 * `closeOnDispose` so the `BroadcastChannel` objects are released with the contexts; without it the process keeps
 * the channels (and vitest keeps the file) alive after the last assertion.
 */
function createPair() {
  sequence += 1
  const name = `model-drivers-contract-${sequence}`
  const main = createContext(new BroadcastChannel(name), { closeOnDispose: true })
  const renderer = createContext(new BroadcastChannel(name), { closeOnDispose: true })

  opened.push(() => {
    main.dispose()
    renderer.dispose()
  })

  return { main: main.context, client: createEventaHostClient(renderer.context) }
}

afterEach(() => {
  for (const close of opened.splice(0))
    close()
})

/** Resolve on the first value a subscription delivers, so a missing delivery fails as a timeout rather than a hang. */
function nextValue<T>(subscribe: (handler: (value: T) => void) => () => void): Promise<T> {
  return new Promise<T>((resolve) => {
    subscribe(value => resolve(value))
  })
}

describe('the eventa host client', () => {
  it('sends every invoke to the contract it belongs to, in the shape that contract declares', async () => {
    const { main, client } = createPair()
    const calls: string[] = []
    let seen: unknown

    defineInvokeHandler(main, modelDriverIdentifyInvokeEventa, async () => {
      calls.push('identify')
      return { windowId: 'w7' }
    })
    defineInvokeHandler(main, modelDriverRegisterMountInvokeEventa, async (request) => {
      calls.push('register-mount')
      seen = request
      return { ok: true as const, mountId: 'mount_1' }
    })
    defineInvokeHandler(main, modelDriverUnregisterMountInvokeEventa, async (request) => {
      calls.push('unregister-mount')
      seen = request
      return { ok: true as const, value: undefined }
    })
    defineInvokeHandler(main, modelDriverMountReadinessInvokeEventa, async (request) => {
      calls.push('readiness')
      seen = request
      return { ok: true as const, value: undefined }
    })
    defineInvokeHandler(main, modelDriverSubmitCueInvokeEventa, async (request) => {
      calls.push('submit-cue')
      seen = request
      return { ok: true as const, value: { nonce: 42 } }
    })
    defineInvokeHandler(main, modelDriverWithdrawCuesInvokeEventa, async (request) => {
      calls.push('withdraw')
      seen = request
      return { ok: true as const, value: { kind: request.kind, results: [], count: 0 } }
    })
    defineInvokeHandler(main, modelDriverResolveEntrypointInvokeEventa, async (request) => {
      calls.push('resolve-entrypoint')
      seen = request
      return { ok: true as const, value: { specifier: '@proj-airi/x#mount' } }
    })
    defineInvokeHandler(main, modelDriverStateInvokeEventa, async () => {
      calls.push('state')
      return { drivers: [], rows: {}, rowsUpdatedAt: {}, rejections: [], legacyRetention: {}, backgroundWindowStarted: false }
    })
    defineInvokeHandler(main, modelDriverPullRowsInvokeEventa, async (request) => {
      calls.push('pull-rows')
      seen = request
      return { ok: true as const, value: [] }
    })
    defineInvokeHandler(main, modelDriverSetEnabledInvokeEventa, async (request) => {
      calls.push('set-enabled')
      seen = request
      return { ok: true as const, value: undefined }
    })
    defineInvokeHandler(main, modelDriverManagerMessageInvokeEventa, async (request) => {
      calls.push('manager-message')
      seen = request
      return { ok: true as const, value: undefined }
    })
    defineInvokeHandler(main, modelDriverEntryResultInvokeEventa, async (request) => {
      calls.push('entry-result')
      seen = request
      return { ok: true as const, value: undefined }
    })
    defineInvokeHandler(main, modelDriverDeliverPromptResolutionInvokeEventa, async (request) => {
      calls.push('deliver-prompt-resolution')
      seen = request
      return { ok: true as const, value: { delivered: 1 } }
    })

    expect(await client.identify()).toEqual({ windowId: 'w7' })

    expect(await client.registerMount({ driverId: DRIVER, surface: SURFACE, purpose: PURPOSE }))
      .toEqual({ ok: true, mountId: 'mount_1' })
    expect(seen).toEqual({ driverId: DRIVER, surface: SURFACE, purpose: PURPOSE })

    await client.unregisterMount({ mountId: 'mount_1' })
    expect(seen).toEqual({ mountId: 'mount_1' })

    await client.reportReadiness({ mountId: 'mount_1', readiness: RendererMountReadinessState.READY_FOR_MODEL })
    expect(seen).toEqual({ mountId: 'mount_1', readiness: RendererMountReadinessState.READY_FOR_MODEL })

    const envelope: CueEnvelopeInput = {
      cues: [{ kind: CueKind.LOAD, modelId: 'model_a', profileId: 'profile_a' }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: DRIVER, surface: SURFACE, purpose: PURPOSE },
    }
    expect(await client.submitCue({ envelope })).toEqual({ ok: true, value: { nonce: 42 } })
    // The envelope crosses as the request body; `options` is only present when the caller had any.
    expect((seen as { envelope: CueEnvelopeInput }).envelope).toEqual(envelope)

    const report = await client.withdrawCues({ kind: CueWithdrawalKind.CANCEL, modelDriverId: DRIVER })
    expect(report.ok).toBe(true)
    if (report.ok)
      expect(report.value).toEqual({ kind: CueWithdrawalKind.CANCEL, results: [], count: 0 })

    const entrypoint = await client.resolveEntrypoint({ driverId: DRIVER, kind: ModelDriverEntryKind.MOUNT })
    expect(entrypoint.ok).toBe(true)
    if (entrypoint.ok)
      expect(entrypoint.value).toEqual({ specifier: '@proj-airi/x#mount' })

    const state = await client.hostState()
    expect(state.drivers).toEqual([])

    await client.pullRows({ driverId: DRIVER })
    expect(seen).toEqual({ driverId: DRIVER })

    await client.setEnabled({ driverId: DRIVER, enabled: true })
    expect(seen).toEqual({ driverId: DRIVER, enabled: true })

    await client.sendManagerMessage({ driverId: DRIVER, message: { type: 'list-models' } })
    expect(seen).toEqual({ driverId: DRIVER, message: { type: 'list-models' } })

    await client.sendEntryResult({ requestId: 'entry_1' })
    expect(seen).toEqual({ requestId: 'entry_1' })

    const delivered = await client.deliverPromptResolution({ driverId: DRIVER, publication: PUBLICATION })
    expect(delivered).toEqual({ ok: true, value: { delivered: 1 } })
    // The pair travels whole: `delivered: 0` is only meaningful if the publication arrived untouched.
    expect(seen).toEqual({ driverId: DRIVER, publication: PUBLICATION })

    expect(calls).toEqual([
      'identify',
      'register-mount',
      'unregister-mount',
      'readiness',
      'submit-cue',
      'withdraw',
      'resolve-entrypoint',
      'state',
      'pull-rows',
      'set-enabled',
      'manager-message',
      'entry-result',
      'deliver-prompt-resolution',
    ])
  })

  it('hands a push to the client as its body, not as the transport envelope', async () => {
    const { main, client } = createPair()

    const settlement = nextValue<{ nonce: number }>(handler => client.onCueSettled(handler))
    main.emit(modelDriverCueSettledEventa, { nonce: 3, result: { ok: true, value: ack(3) } })
    expect((await settlement).nonce).toBe(3)

    const entry = nextValue<{ requestId: string }>(handler => client.onOpenEntry(handler))
    main.emit(modelDriverOpenEntryEventa, { requestId: 'entry_1', driverId: DRIVER, specifier: '@proj-airi/x#provider' })
    expect((await entry).requestId).toBe('entry_1')

    const manager = nextValue<{ driverId: string, message: unknown }>(handler => client.onManagerMessage(handler))
    main.emit(modelDriverManagerMessageEventa, { driverId: DRIVER, message: { type: 'models' } })
    expect((await manager).message).toEqual({ type: 'models' })

    const resolution = nextValue<{ driverId: string, publication: ModelPromptPublication }>(handler => client.onPromptResolution(handler))
    main.emit(modelDriverPromptResolutionEventa, { driverId: DRIVER, publication: PUBLICATION })
    const delivered = await resolution
    expect(delivered.driverId).toBe(DRIVER)
    expect(delivered.publication).toEqual(PUBLICATION)
  })

  it('ignores a push whose body is empty instead of calling the driver with nothing', async () => {
    const { main, client } = createPair()
    let called = 0
    client.onPromptResolution(() => {
      called += 1
    })

    main.emit(modelDriverPromptResolutionEventa, undefined as never)
    // A round trip that is known to complete, so "not called" is an assertion rather than a guess about timing.
    const settlement = nextValue(handler => client.onCueSettled(handler))
    main.emit(modelDriverCueSettledEventa, { nonce: 1, result: { ok: true, value: ack(1) } })
    await settlement

    expect(called).toBe(0)
  })

  it('stops calling a subscriber once it unsubscribes', async () => {
    const { main, client } = createPair()
    const messages: unknown[] = []
    const stop = client.onManagerMessage(payload => messages.push(payload))

    main.emit(modelDriverManagerMessageEventa, { driverId: DRIVER, message: 'first' })
    const firstSettlement = nextValue(handler => client.onCueSettled(handler))
    main.emit(modelDriverCueSettledEventa, { nonce: 1, result: { ok: true, value: ack(1) } })
    await firstSettlement

    stop()
    main.emit(modelDriverManagerMessageEventa, { driverId: DRIVER, message: 'second' })
    const secondSettlement = nextValue(handler => client.onCueSettled(handler))
    main.emit(modelDriverCueSettledEventa, { nonce: 2, result: { ok: true, value: ack(2) } })
    await secondSettlement

    expect(messages).toEqual([{ driverId: DRIVER, message: 'first' }])
  })

  it('passes a narrowed failure through unchanged rather than throwing', async () => {
    const { main, client } = createPair()
    defineInvokeHandler(main, modelDriverSetEnabledInvokeEventa, async () => ({
      ok: false as const,
      error: { code: ContractFailureCode.DRIVER_UNAVAILABLE, message: 'no manager for this driver' },
    }))

    const result = await client.setEnabled({ driverId: DRIVER, enabled: false })

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error).toEqual({ code: ContractFailureCode.DRIVER_UNAVAILABLE, message: 'no manager for this driver' })
  })
})
