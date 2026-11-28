/**
 * The model-driver invoke table, driven without Electron.
 *
 * `handlers.ts` is the IPC half of the host: thirteen invokes in, one host-service call out. It used to live inline in
 * the composition root, where the only way to reach it was through `ipcMain` and a real `webContents` — so the
 * mapping, the sender attribution and the "no sender" refusals were never executed by anything but the app.
 *
 * What this suite proves, with a real eventa transport (`broadcast-channel`, as the renderer suite does) and a
 * recording fake in place of the host service:
 *
 *   - the sender is resolved from eventa's raw metadata and interpreted by the composition root, never read from the
 *     payload — and every window-scoped invoke passes that window id to the service;
 *   - an invoke with no attributable sender is refused with the vocabulary the contract already has, and the service
 *     is not called at all;
 *   - the five invokes that are not window-scoped work with no sender, because they address a driver or the host.
 */
import type { HostLogger } from '@proj-airi/stage-renderer-sdk'
import type { CueEnvelopeInput } from '@proj-airi/stage-renderer-sdk'

import type { ModelDriverHandlerControl } from './handlers'

import { defineInvoke } from '@moeru/eventa'
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
  modelDriverDeliverPromptResolutionInvokeEventa,
  modelDriverEntryResultInvokeEventa,
  modelDriverIdentifyInvokeEventa,
  modelDriverManagerMessageInvokeEventa,
  modelDriverMountReadinessInvokeEventa,
  modelDriverPullRowsInvokeEventa,
  modelDriverRegisterMountInvokeEventa,
  modelDriverResolveEntrypointInvokeEventa,
  modelDriverSetEnabledInvokeEventa,
  modelDriverStateInvokeEventa,
  modelDriverSubmitCueInvokeEventa,
  modelDriverUnregisterMountInvokeEventa,
  modelDriverWithdrawCuesInvokeEventa,
} from '../../../shared/model-drivers-eventa'
import { registerModelDriverHandlers, resolveIpcSender } from './handlers'

const DRIVER = 'ai.moeru.airi.test.handlers' as const
const SURFACE = RendererMountSurfaceKind.ACTING
const PURPOSE = RendererMountPurpose.ACTING
const WINDOW = { windowId: 'w7', tag: 7 }

const HOST_STATE = {
  drivers: [],
  rows: {},
  rowsUpdatedAt: {},
  rejections: [],
  legacyRetention: {},
  backgroundWindowStarted: false,
}

const PUBLICATION = {
  modelDriverId: DRIVER,
  modelId: 'model_a',
  profileId: 'profile_a',
  text: 'Speak softly.',
  tokens: ['calm'],
  version: 4,
  publishedAt: 1_700_000_000_000,
}

const SILENT: HostLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

interface RecordedCall {
  method: string
  args: unknown[]
}

/** The host service as the table sees it: every method records, and answers with the shallowest valid value. */
function createControl() {
  const calls: RecordedCall[] = []
  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args })
  }

  const control: ModelDriverHandlerControl = {
    registerMount: async (windowId, request) => {
      record('registerMount', [windowId, request])
      return { ok: true, mountId: 'mount_1' }
    },
    unregisterMount: async (windowId, mountId) => {
      record('unregisterMount', [windowId, mountId])
      return { ok: true, value: undefined }
    },
    reportReadiness: async (windowId, request) => {
      record('reportReadiness', [windowId, request])
      return { ok: true, value: undefined }
    },
    submitCue: async (windowId, envelope, options) => {
      record('submitCue', [windowId, envelope, options])
      return { ok: true, value: { nonce: 9 } }
    },
    withdraw: async (request) => {
      record('withdraw', [request])
      return { ok: true, value: { kind: request.kind, results: [], count: 0 } }
    },
    resolveEntrypoint: async (request) => {
      record('resolveEntrypoint', [request])
      return { ok: true, value: { specifier: '@proj-airi/x#mount' } }
    },
    snapshot: () => {
      record('snapshot', [])
      return HOST_STATE
    },
    setEnabled: async (request) => {
      record('setEnabled', [request])
      return { ok: true, value: undefined }
    },
    pullRows: async (request) => {
      record('pullRows', [request])
      return { ok: true, value: [] }
    },
    entryResult: async (windowId, payload) => {
      record('entryResult', [windowId, payload])
      return { ok: true, value: undefined }
    },
    managerMessage: async (windowId, payload) => {
      record('managerMessage', [windowId, payload])
      return { ok: true, value: undefined }
    },
    deliverPromptResolution: async (windowId, payload) => {
      record('deliverPromptResolution', [windowId, payload])
      return { ok: true, value: { delivered: 2 } }
    },
  }

  return { control, calls }
}

const opened: Array<() => void> = []
let sequence = 0

/** A main-side context the table registers on, and a renderer-side one to invoke from. */
function createPair() {
  sequence += 1
  const name = `model-drivers-handlers-${sequence}`
  const main = createContext(new BroadcastChannel(name), { closeOnDispose: true })
  const renderer = createContext(new BroadcastChannel(name), { closeOnDispose: true })

  opened.push(() => {
    main.dispose()
    renderer.dispose()
  })

  return { main: main.context, renderer: renderer.context }
}

afterEach(() => {
  for (const close of opened.splice(0))
    close()
})

/** Typed as the contract's input so `kind` narrows to the load cue instead of widening to the whole enum. */
function envelope(): CueEnvelopeInput {
  return {
    cues: [{ kind: CueKind.LOAD, modelId: 'model_a', profileId: 'profile_a' }],
    source: CueSource.USER,
    override: true,
    target: { modelDriverId: DRIVER, surface: SURFACE, purpose: PURPOSE },
  }
}

describe('reading the sender', () => {
  it('takes it from eventa\'s raw metadata, and reports nothing when there is none', () => {
    const sender = { id: 7, isDestroyed: () => false }

    expect(resolveIpcSender({ raw: { ipcMainEvent: { sender } } })).toBe(sender)
    expect(resolveIpcSender({ raw: {} })).toBeUndefined()
    expect(resolveIpcSender({})).toBeUndefined()
    expect(resolveIpcSender(undefined)).toBeUndefined()
  })
})

describe('the invoke table', () => {
  it('attributes every window-scoped invoke to the resolved sender and passes its payload through', async () => {
    const { main, renderer } = createPair()
    const { control, calls } = createControl()
    const identified: unknown[] = []

    registerModelDriverHandlers({
      context: main,
      control,
      resolveSender: () => WINDOW,
      onIdentified: sender => identified.push(sender),
      logger: SILENT,
    })

    expect(await defineInvoke(renderer, modelDriverIdentifyInvokeEventa)()).toEqual({ windowId: 'w7' })
    expect(identified).toEqual([WINDOW])

    expect(await defineInvoke(renderer, modelDriverRegisterMountInvokeEventa)({ driverId: DRIVER, surface: SURFACE, purpose: PURPOSE }))
      .toEqual({ ok: true, mountId: 'mount_1' })
    expect(calls.at(-1)).toEqual({ method: 'registerMount', args: ['w7', { driverId: DRIVER, surface: SURFACE, purpose: PURPOSE }] })

    await defineInvoke(renderer, modelDriverMountReadinessInvokeEventa)({ mountId: 'mount_1', readiness: RendererMountReadinessState.READY_FOR_MODEL })
    expect(calls.at(-1)).toEqual({
      method: 'reportReadiness',
      args: ['w7', { mountId: 'mount_1', readiness: RendererMountReadinessState.READY_FOR_MODEL }],
    })

    await defineInvoke(renderer, modelDriverUnregisterMountInvokeEventa)({ mountId: 'mount_1' })
    expect(calls.at(-1)).toEqual({ method: 'unregisterMount', args: ['w7', 'mount_1'] })

    await defineInvoke(renderer, modelDriverSubmitCueInvokeEventa)({ envelope: envelope() })
    expect(calls.at(-1)).toEqual({ method: 'submitCue', args: ['w7', envelope(), undefined] })

    await defineInvoke(renderer, modelDriverManagerMessageInvokeEventa)({ driverId: DRIVER, message: { type: 'models' } })
    expect(calls.at(-1)).toEqual({ method: 'managerMessage', args: ['w7', { driverId: DRIVER, message: { type: 'models' } }] })

    await defineInvoke(renderer, modelDriverEntryResultInvokeEventa)({ requestId: 'entry_1' })
    expect(calls.at(-1)).toEqual({ method: 'entryResult', args: ['w7', { requestId: 'entry_1' }] })

    const delivered = await defineInvoke(renderer, modelDriverDeliverPromptResolutionInvokeEventa)({ driverId: DRIVER, publication: PUBLICATION })
    expect(delivered).toEqual({ ok: true, value: { delivered: 2 } })
    // The window that ran the arbitration is the one the service is told about; the driver and the pair are untouched.
    expect(calls.at(-1)).toEqual({ method: 'deliverPromptResolution', args: ['w7', { driverId: DRIVER, publication: PUBLICATION }] })
  })

  it('serves the invokes that are not window-scoped without a sender', async () => {
    const { main, renderer } = createPair()
    const { control, calls } = createControl()

    registerModelDriverHandlers({ context: main, control, resolveSender: () => undefined, logger: SILENT })

    expect(await defineInvoke(renderer, modelDriverStateInvokeEventa)()).toEqual(HOST_STATE)
    expect(calls.at(-1)).toEqual({ method: 'snapshot', args: [] })

    await defineInvoke(renderer, modelDriverPullRowsInvokeEventa)({ driverId: DRIVER })
    expect(calls.at(-1)).toEqual({ method: 'pullRows', args: [{ driverId: DRIVER }] })

    await defineInvoke(renderer, modelDriverSetEnabledInvokeEventa)({ driverId: DRIVER, enabled: true })
    expect(calls.at(-1)).toEqual({ method: 'setEnabled', args: [{ driverId: DRIVER, enabled: true }] })

    await defineInvoke(renderer, modelDriverWithdrawCuesInvokeEventa)({ kind: CueWithdrawalKind.CANCEL, modelDriverId: DRIVER })
    expect(calls.at(-1)).toEqual({ method: 'withdraw', args: [{ kind: CueWithdrawalKind.CANCEL, modelDriverId: DRIVER }] })

    await defineInvoke(renderer, modelDriverResolveEntrypointInvokeEventa)({ driverId: DRIVER, kind: ModelDriverEntryKind.MOUNT })
    expect(calls.at(-1)).toEqual({ method: 'resolveEntrypoint', args: [{ driverId: DRIVER, kind: ModelDriverEntryKind.MOUNT }] })
  })

  it('refuses every window-scoped invoke when the transport cannot attribute a sender', async () => {
    const { main, renderer } = createPair()
    const { control, calls } = createControl()

    registerModelDriverHandlers({ context: main, control, resolveSender: () => undefined, logger: SILENT })

    const refusal = (what: string) => ({
      ok: false,
      error: { code: ContractFailureCode.INTERNAL, message: `No window to attribute the ${what} to` },
    })

    expect(await defineInvoke(renderer, modelDriverIdentifyInvokeEventa)()).toEqual({ windowId: '' })
    // Registration has its own vocabulary for "this cannot be a window", so it is not the generic refusal.
    expect(await defineInvoke(renderer, modelDriverRegisterMountInvokeEventa)({ driverId: DRIVER, surface: SURFACE, purpose: PURPOSE }))
      .toEqual({ ok: false, reason: 'shutting-down' })
    expect(await defineInvoke(renderer, modelDriverMountReadinessInvokeEventa)({ mountId: 'mount_1', readiness: RendererMountReadinessState.MOUNTING }))
      .toEqual(refusal('readiness report'))
    expect(await defineInvoke(renderer, modelDriverUnregisterMountInvokeEventa)({ mountId: 'mount_1' }))
      .toEqual(refusal('unregistration'))
    expect(await defineInvoke(renderer, modelDriverSubmitCueInvokeEventa)({ envelope: envelope() }))
      .toEqual(refusal('transaction'))
    expect(await defineInvoke(renderer, modelDriverEntryResultInvokeEventa)({ requestId: 'entry_1' }))
      .toEqual(refusal('entry result'))
    expect(await defineInvoke(renderer, modelDriverManagerMessageInvokeEventa)({ driverId: DRIVER, message: 'ping' }))
      .toEqual(refusal('manager message'))
    expect(await defineInvoke(renderer, modelDriverDeliverPromptResolutionInvokeEventa)({ driverId: DRIVER, publication: PUBLICATION }))
      .toEqual(refusal('prompt resolution'))

    // Not one of them reached the service: a refusal is the answer, not a call made with a guessed window.
    expect(calls).toEqual([])
  })
})
