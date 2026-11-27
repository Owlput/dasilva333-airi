/**
 * Typed IPC for the model-driver host (RFC 0002, plan §4.1).
 *
 * Two rules shape this contract and both come from the plan rather than from taste:
 *
 *   - **main is the registry, the renderer is the endpoint.** A renderer may ask to register a mount, send
 *     a cue, withdraw work, resolve an entry point or read the driver list. It may not mint a mount id, and
 *     the host overwrites the sender's window identity rather than trusting the request's copy (§4.3).
 *   - **a receipt is not an ack.** `submit` answers with the correlation value immediately; the outcome
 *     arrives later on `modelDriverCueSettledEventa` for the window that asked. Sending a promise over IPC
 *     is not a thing, and waiting for settlement inside the invoke would make acceptance look like an
 *     outcome — the exact distinction the contract spends §9.3 on.
 *
 * Every failure is narrowed to `{ code, message }` before it crosses the process boundary: `ContractFailure`
 * carries an opaque `cause` and `details` that are not structured-cloneable in general, and a serialization
 * failure here would surface as a broken invoke rather than as the driver error it stands for.
 *
 * The four value shapes the transport carries — the narrowed failure, the submit receipt, the host-state
 * projection and the window identity — are the contract package's (`host/client.ts`), because the renderer
 * adapter is written against them and it lives there too. This file re-exports them so a consumer of the IPC
 * contract does not have to know which package defines each one.
 */
import type {
  ContractResult,
  CueAck,
  CueEnvelopeInput,
  CueSendOptions,
  CueWithdrawalReport,
  CueWithdrawalRequest,
  EntrypointRequest,
  EntrypointResolution,
  ModelDriverFailure,
  ModelDriverHostState,
  ModelDriverId,
  ModelDriverSubmitAck,
  ModelDriverWindowIdentity,
  ModelPromptPublication,
  ModelSummary,
  MountId,
  MountRegistrationResult,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export type {
  ModelDriverFailure,
  ModelDriverHostState,
  ModelDriverSubmitAck,
  ModelDriverWindowIdentity,
} from '@proj-airi/stage-renderer-sdk'

/** `ContractResult` with the failure narrowed; what every invoke below answers with. */
export type ModelDriverResult<T>
  = | { ok: true, value: T }
    | { ok: false, error: ModelDriverFailure }

// -------------------------------------------------------------------------------------------------
// Renderer -> main
// -------------------------------------------------------------------------------------------------

/** Who am I? Asked once per adapter, before it registers anything. */
export const modelDriverIdentifyInvokeEventa = defineInvokeEventa<ModelDriverWindowIdentity>(
  'eventa:invoke:model-drivers:identify',
)

/**
 * Register a mount and receive its registry-issued id.
 *
 * `windowId` is deliberately absent from the request: the registry uses the sender's own window, and a
 * request that carried one would be a request to register a mount in someone else's window.
 */
export const modelDriverRegisterMountInvokeEventa = defineInvokeEventa<
  MountRegistrationResult,
  { driverId: ModelDriverId, surface: RendererMountSurfaceKind, purpose: RendererMountPurpose }
>('eventa:invoke:model-drivers:mount:register')

/** A mount moved readiness. The host validates the transition (§8.4). */
export const modelDriverMountReadinessInvokeEventa = defineInvokeEventa<
  ModelDriverResult<void>,
  { mountId: MountId, readiness: RendererMountReadinessState }
>('eventa:invoke:model-drivers:mount:readiness')

/** A mount unmounted. Unregistering is a host event; this is the window telling it one happened. */
export const modelDriverUnregisterMountInvokeEventa = defineInvokeEventa<
  ModelDriverResult<void>,
  { mountId: MountId }
>('eventa:invoke:model-drivers:mount:unregister')

/** Send one cue transaction. Acceptance only; the outcome arrives on the settled event. */
export const modelDriverSubmitCueInvokeEventa = defineInvokeEventa<
  ModelDriverResult<ModelDriverSubmitAck>,
  { envelope: CueEnvelopeInput, options?: CueSendOptions }
>('eventa:invoke:model-drivers:cue:submit')

/** Ask a driver's manager to withdraw work (RFC §9.7). */
export const modelDriverWithdrawCuesInvokeEventa = defineInvokeEventa<
  ModelDriverResult<CueWithdrawalReport>,
  CueWithdrawalRequest
>('eventa:invoke:model-drivers:cue:withdraw')

/** Ask a manager which specifier this build should import for an entry kind (§4.7 step 1-2). */
export const modelDriverResolveEntrypointInvokeEventa = defineInvokeEventa<
  ModelDriverResult<EntrypointResolution>,
  EntrypointRequest
>('eventa:invoke:model-drivers:entrypoint:resolve')

/** Read the driver list, rows and refusals. */
export const modelDriverStateInvokeEventa = defineInvokeEventa<ModelDriverHostState>(
  'eventa:invoke:model-drivers:state',
)

/** Turn a driver on or off. Persisted by main in `state.json` (§4.5). */
export const modelDriverSetEnabledInvokeEventa = defineInvokeEventa<
  ModelDriverResult<void>,
  { driverId: ModelDriverId, enabled: boolean }
>('eventa:invoke:model-drivers:set-enabled')

/** Pull one driver's rows. Never a push: the cache is written from a successful pull only (§4.3). */
export const modelDriverPullRowsInvokeEventa = defineInvokeEventa<
  ModelDriverResult<ModelSummary[]>,
  { driverId: ModelDriverId }
>('eventa:invoke:model-drivers:rows:pull')

/** Answer one `modelDriverOpenEntryEventa` request. */
export const modelDriverEntryResultInvokeEventa = defineInvokeEventa<
  ModelDriverResult<void>,
  { requestId: string, error?: ModelDriverFailure }
>('eventa:invoke:model-drivers:entry:result')

/**
 * One driver-protocol message from the window half to its manager.
 *
 * The host transports `unknown` and never reads it: the message format belongs to the driver (§4.3, D3).
 */
export const modelDriverManagerMessageInvokeEventa = defineInvokeEventa<
  ModelDriverResult<void>,
  { driverId: ModelDriverId, message: unknown }
>('eventa:invoke:model-drivers:manager:message')

// -------------------------------------------------------------------------------------------------
// Main -> renderer
// -------------------------------------------------------------------------------------------------

/** The decided outcome of a transaction the receiving window submitted. */
export const modelDriverCueSettledEventa = defineEventa<{
  nonce: number
  result: ContractResult<CueAck>
}>('eventa:event:model-drivers:cue:settled')

/**
 * Run a driver's provider entry in this window.
 *
 * The manager named the specifier; the adapter imports it through its loader table and makes no decision of
 * its own (§4.7 step 3-4). `requestId` is the host's, so the answer cannot be confused with another window's.
 */
export const modelDriverOpenEntryEventa = defineEventa<{
  requestId: string
  driverId: ModelDriverId
  specifier: string
  surface?: RendererMountSurfaceKind
  purpose?: RendererMountPurpose
}>('eventa:event:model-drivers:entry:open')

/** One driver-protocol message from the manager to its window half. */
export const modelDriverManagerMessageEventa = defineEventa<{
  driverId: ModelDriverId
  message: unknown
}>('eventa:event:model-drivers:manager:message')

/**
 * The publication the host resolved after a user arbitration (§5.4, D26).
 *
 * The driver owns the prompt and its history, so the host hands the winner back instead of keeping the decision
 * to itself: the adapter delivers it to `HostPromptService.onResolution` for the driver named here. Addressed by
 * driver because only the window running that driver's entry has anything to deliver it to.
 */
export const modelDriverPromptResolutionEventa = defineEventa<{
  driverId: ModelDriverId
  publication: ModelPromptPublication
}>('eventa:event:model-drivers:prompt:resolution')
