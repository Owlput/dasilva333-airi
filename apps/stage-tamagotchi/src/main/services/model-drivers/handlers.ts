/**
 * The model-driver invokes, as one registration table (§4.1).
 *
 * This module exists so the IPC half is *testable without Electron*. Everything here is a mapping — invoke contract
 * in, one service call out — and the two facts it needs from the process are injected rather than imported:
 *
 *   - **`resolveSender`** answers "which window sent this". In the app it reads
 *     `options.raw.ipcMainEvent.sender`; in a test it is a function returning a fixed window. The sender is never
 *     read from the payload, because a renderer must not be able to act as another window (§4.3).
 *   - **`control`** is the host service. The app passes the real `createModelDriverHostService`; a test passes a
 *     recorder. No decision lives here, so nothing is lost by replacing it.
 *
 * The composition root (`./index.ts`) keeps the Electron-specific parts: `webContents` identity, window lookup, the
 * push transport and `state.json`. That is why the same table can be driven over a broadcast-channel context in the
 * suite beside this file, and why a second transport (Web/Pocket, P2-D13) does not need a second table.
 */
import type { EventContext, Handler } from '@moeru/eventa'
import type { ContractResult, CueAck, CueEnvelopeInput, CueSendOptions, CueWithdrawalReport, CueWithdrawalRequest, EntrypointRequest, EntrypointResolution, HostLogger, ModelDriverHostState, ModelDriverId, ModelPromptPublication, ModelSummary, MountId, MountRegistrationResult, RendererMountPurpose, RendererMountReadinessState, RendererMountSurfaceKind } from '@proj-airi/stage-renderer-sdk'

import type { ModelDriverFailure } from '../../../shared/model-drivers-eventa'

import { defineInvokeHandler } from '@moeru/eventa'
import {
  ContractFailureCode,
  MountRegistrationRefusal,
} from '@proj-airi/stage-renderer-sdk'

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

/**
 * The window an invoke came from, as this table needs it.
 *
 * `tag` is whatever the transport uses to find the window again — a `webContents` id in Electron. The table never
 * interprets it; it only hands it back to the composition root when a window identifies itself.
 */
export interface InvokeSender {
  windowId: string
  tag: number
}

/** The subset of the host service this table calls. */
export interface ModelDriverHandlerControl {
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
  snapshot: () => ModelDriverHostState
  setEnabled: (request: { driverId: ModelDriverId, enabled: boolean }) => Promise<ContractResult<void>>
  pullRows: (request: { driverId: ModelDriverId }) => Promise<ContractResult<ModelSummary[]>>
  entryResult: (windowId: string, payload: { requestId: string, error?: { message: string } }) => Promise<ContractResult<void>>
  managerMessage: (windowId: string, payload: { driverId: ModelDriverId, message: unknown }) => Promise<ContractResult<void>>
  deliverPromptResolution: (windowId: string, payload: {
    driverId: ModelDriverId
    publication: ModelPromptPublication
  }) => Promise<ContractResult<{ delivered: number }>>
}

export interface RegisterModelDriverHandlersOptions {
  /** The process's global eventa context. Any adapter; this table never names one. */
  context: EventContext<any, any>
  control: ModelDriverHandlerControl
  /** The sender of an invoke, or `undefined` when the transport cannot attribute one. */
  resolveSender: (handlerOptions: unknown) => InvokeSender | undefined
  /** A window identified itself. The composition root records `tag` so it can address it later. */
  onIdentified?: (sender: InvokeSender) => void
  logger: HostLogger
}

/**
 * The `webContents` a handler was invoked by, read from eventa's raw metadata.
 *
 * Exported and pure so the Electron-specific extraction is covered by the suite: an invoke with no sender metadata —
 * a test harness, a transport that cannot attribute a sender — yields `undefined`, which every window-scoped handler
 * turns into a refusal rather than a guess.
 */
export function resolveIpcSender(
  handlerOptions: unknown,
): { id: number, isDestroyed: () => boolean } | undefined {
  const patched = handlerOptions as { raw?: { ipcMainEvent?: { sender?: { id: number, isDestroyed: () => boolean } } } } | undefined
  return patched?.raw?.ipcMainEvent?.sender
}

export function registerModelDriverHandlers(options: RegisterModelDriverHandlersOptions): void {
  const { context, control, resolveSender, logger } = options

  const fail = (error: { code: ContractFailureCode, message: string }): { ok: false, error: ModelDriverFailure } => ({
    ok: false,
    error: { code: error.code, message: error.message },
  })

  const noWindow = (what: string) => fail({
    code: ContractFailureCode.INTERNAL,
    message: `No window to attribute the ${what} to`,
  })

  defineInvokeHandler(context, modelDriverIdentifyInvokeEventa, async (_payload, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return { windowId: '' }

    options.onIdentified?.(sender)
    logger.debug('model-drivers', `Renderer \`${sender.windowId}\` identified itself as able to host driver code`)
    return { windowId: sender.windowId }
  })

  defineInvokeHandler(context, modelDriverRegisterMountInvokeEventa, async (request, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    // A registration with no sender is not a window a mount can live in. Reported as a shutdown refusal because the
    // mount-registration vocabulary has no better word and the case is not reachable over IPC.
    if (!sender)
      return { ok: false, reason: MountRegistrationRefusal.SHUTTING_DOWN }

    return control.registerMount(sender.windowId, request)
  })

  defineInvokeHandler(context, modelDriverMountReadinessInvokeEventa, async (request, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return noWindow('readiness report')

    return control.reportReadiness(sender.windowId, request)
  })

  defineInvokeHandler(context, modelDriverUnregisterMountInvokeEventa, async (request, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return noWindow('unregistration')

    return control.unregisterMount(sender.windowId, request.mountId)
  })

  defineInvokeHandler(context, modelDriverSubmitCueInvokeEventa, async (payload, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return noWindow('transaction')

    return control.submitCue(sender.windowId, payload.envelope, payload.options)
  })

  defineInvokeHandler(context, modelDriverWithdrawCuesInvokeEventa, async request => control.withdraw(request))
  defineInvokeHandler(context, modelDriverResolveEntrypointInvokeEventa, async request => control.resolveEntrypoint(request))
  defineInvokeHandler(context, modelDriverStateInvokeEventa, async () => control.snapshot())
  defineInvokeHandler(context, modelDriverSetEnabledInvokeEventa, async request => control.setEnabled(request))
  defineInvokeHandler(context, modelDriverPullRowsInvokeEventa, async request => control.pullRows(request))

  defineInvokeHandler(context, modelDriverEntryResultInvokeEventa, async (payload, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return noWindow('entry result')

    return control.entryResult(sender.windowId, payload)
  })

  defineInvokeHandler(context, modelDriverManagerMessageInvokeEventa, async (payload, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return noWindow('manager message')

    return control.managerMessage(sender.windowId, payload)
  })

  defineInvokeHandler(context, modelDriverDeliverPromptResolutionInvokeEventa, async (payload, handlerOptions) => {
    const sender = resolveSender(handlerOptions)
    if (!sender)
      return noWindow('prompt resolution')

    return control.deliverPromptResolution(sender.windowId, payload)
  })
}

/** The handler type this table's callbacks must satisfy; re-exported so a test can type its recorder. */
export type ModelDriverInvokeHandler<Res, Req> = Handler<Res, Req, EventContext<any, any>, any>
