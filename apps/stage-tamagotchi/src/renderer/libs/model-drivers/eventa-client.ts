/**
 * The adapter's host client, over this app's typed IPC.
 *
 * This is the only file in the app that turns `eventa` into `HostClient`. Everything that interface promises —
 * identity, mounts, readiness, cues, entry points, host state, the manager channel — is one invoke or one
 * subscription here, and the adapter above it never learns that any of this exists
 * (`packages/stage-renderer-sdk/src/host/client.ts`). A second implementation (a BroadcastChannel one, an
 * in-process one) is a second object, not a branch in the adapter.
 *
 * Two conversions happen here and nowhere else:
 *
 *   - **failures are already narrowed.** The contracts answer with `{ code, message }` rather than a
 *     `ContractFailure`, because `cause` and `details` are not structured-cloneable in general (P1-D10). That
 *     shape satisfies the interface's `ContractResult` directly, so there is nothing to rebuild.
 *   - **a pushed event has an envelope.** `context.on` hands over `{ body }`; the client hands over the body.
 */
import type { createContext } from '@moeru/eventa/adapters/electron/renderer'
import type { HostClient } from '@proj-airi/stage-renderer-sdk'

import { defineInvoke } from '@moeru/eventa'

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

export type RendererEventContext = ReturnType<typeof createContext>['context']

/** The host client, over the typed IPC this app ships. */
export function createEventaHostClient(context: RendererEventContext): HostClient {
  const identify = defineInvoke(context, modelDriverIdentifyInvokeEventa)
  const registerMount = defineInvoke(context, modelDriverRegisterMountInvokeEventa)
  const unregisterMount = defineInvoke(context, modelDriverUnregisterMountInvokeEventa)
  const reportReadiness = defineInvoke(context, modelDriverMountReadinessInvokeEventa)
  const submitCue = defineInvoke(context, modelDriverSubmitCueInvokeEventa)
  const withdrawCues = defineInvoke(context, modelDriverWithdrawCuesInvokeEventa)
  const resolveEntrypoint = defineInvoke(context, modelDriverResolveEntrypointInvokeEventa)
  const hostState = defineInvoke(context, modelDriverStateInvokeEventa)
  const pullRows = defineInvoke(context, modelDriverPullRowsInvokeEventa)
  const setEnabled = defineInvoke(context, modelDriverSetEnabledInvokeEventa)
  const sendEntryResult = defineInvoke(context, modelDriverEntryResultInvokeEventa)
  const sendManagerMessage = defineInvoke(context, modelDriverManagerMessageInvokeEventa)
  const deliverPromptResolution = defineInvoke(context, modelDriverDeliverPromptResolutionInvokeEventa)

  return {
    identify,
    registerMount,
    unregisterMount,
    reportReadiness,
    withdrawCues,
    resolveEntrypoint,
    hostState,
    pullRows,
    setEnabled,
    submitCue,
    sendManagerMessage,
    sendEntryResult,
    deliverPromptResolution,
    onCueSettled: handler =>
      context.on(modelDriverCueSettledEventa, (event) => {
        if (event?.body)
          handler(event.body)
      }),
    onOpenEntry: handler =>
      context.on(modelDriverOpenEntryEventa, (event) => {
        if (event?.body)
          handler(event.body)
      }),
    onManagerMessage: handler =>
      context.on(modelDriverManagerMessageEventa, (event) => {
        if (event?.body)
          handler(event.body)
      }),
    onPromptResolution: handler =>
      context.on(modelDriverPromptResolutionEventa, (event) => {
        if (event?.body)
          handler(event.body)
      }),
  }
}
