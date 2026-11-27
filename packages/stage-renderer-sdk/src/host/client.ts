/**
 * The renderer adapter's client interface to the host's services.
 *
 * **Not a driver boundary.** Both ends are the same party: the adapter is host code that lives in a window, and
 * the registry, broker and mount table it reaches are host code that lives in main. This interface is the seam
 * between those two halves of one party, not the line a driver sits on — a driver's renderer half meets
 * `HostServices` at activation and its own manager-channel protocol, and never sees a member of this type.
 *
 * **Ownership is not location.** The contract marks the adapter "Owner: AIRI", which says who may supply the
 * code — first-party, shipped with the host distribution — not which package or process it runs in. The SDK is
 * first-party too, so this interface sits here beside the adapter that consumes it, while its implementation
 * belongs to the application (`@proj-airi/stage-tamagotchi` satisfies it over eventa) because that is where the
 * IPC binding lives.
 *
 * **No transport.** The adapter imports no eventa, no Electron and no IPC; an implementation of this interface is
 * handed to it. That is what lets the same adapter run against the app's typed IPC, against plain functions in a
 * test, and against the in-process host a Web or Pocket build will provide.
 *
 * The name pairs with the contract's `HostRegistryClient`: both are client objects a window holds, and the
 * direction is in the name. This one is not the registry client — it is the whole host surface the adapter needs,
 * the registry client included.
 *
 * The value shapes below are deliberately transport-shaped: no `cause`, no class instance, no function. A
 * failure that crosses a process boundary is rebuilt from its code and message (P1-D10), so the interface says so
 * once here instead of each transport inventing its own narrowing. A transport that can carry more than that
 * still may; nothing in the adapter reads it.
 */
import type { CueAck, CueEnvelopeInput, CueSendOptions, CueWithdrawalReport, CueWithdrawalRequest } from '../contract/cues'
import type { ModelPromptPublication } from '../contract/host-services'
import type { DriverInfo, ModelSummary } from '../contract/references'
import type { EntrypointRequest, EntrypointResolution, MountRegistrationResult } from '../contract/registry'
import type {
  ContractFailureCode,
  ContractResult,
  ModelDriverId,
  MountId,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../contract/shared'

/** A contract failure with the parts that survive structured cloning. */
export interface ModelDriverFailure {
  code: ContractFailureCode
  message: string
}

/** A renderer's own identity. The host assigns it from the sender, so it cannot be forged. */
export interface ModelDriverWindowIdentity {
  windowId: string
}

/** The accepted half of a transaction, as far as the originating renderer is concerned. */
export interface ModelDriverSubmitAck {
  nonce: number
  /**
   * The settlement, when the broker decided it before returning.
   *
   * `NO_TARGET` and a not-ready target with `dropIfNotReady` are settled exactly like that; carrying the answer
   * here saves the renderer a round trip it would otherwise wait for without knowing it is coming.
   */
  settledImmediately?: ContractResult<CueAck>
}

/** What a renderer can read about the host. Pulled, never pushed: rows are a cache, not a subscription. */
export interface ModelDriverHostState {
  drivers: DriverInfo[]
  rows: Record<ModelDriverId, ModelSummary[]>
  rowsUpdatedAt: Record<ModelDriverId, number>
  /** Declarations the host refused, with the readable reason a driver page shows. */
  rejections: Array<{ driverId: ModelDriverId, message: string }>
  legacyRetention: Record<ModelDriverId, boolean>
  /** Whether the shared background window has been started. Diagnostics only. */
  backgroundWindowStarted: boolean
}

/** One entry request from the host, in the shape this interface carries it. */
export interface ModelDriverEntryRequest {
  requestId: string
  driverId: ModelDriverId
  specifier: string
  surface?: RendererMountSurfaceKind
  purpose?: RendererMountPurpose
}

/**
 * The host's services, as the adapter's client sees them.
 *
 * Sixteen members in four groups: the ten invokes a renderer may ask for, the two that carry a message out (to the
 * manager channel, and the answer to a host entry request), the three pushes the host may send it, and the one
 * addressed delivery the host makes after a prompt arbitration. A member returns a `ContractResult` rather than
 * throwing, because every one of these calls crosses a boundary that can fail independently of the driver.
 */
export interface HostClient {
  identify: () => Promise<ModelDriverWindowIdentity>
  registerMount: (request: { driverId: ModelDriverId, surface: RendererMountSurfaceKind, purpose: RendererMountPurpose }) => Promise<MountRegistrationResult>
  unregisterMount: (request: { mountId: MountId }) => Promise<ContractResult<void>>
  reportReadiness: (request: { mountId: MountId, readiness: RendererMountReadinessState }) => Promise<ContractResult<void>>
  withdrawCues: (request: CueWithdrawalRequest) => Promise<ContractResult<CueWithdrawalReport>>
  resolveEntrypoint: (request: EntrypointRequest) => Promise<ContractResult<EntrypointResolution>>
  hostState: () => Promise<ModelDriverHostState>
  pullRows: (request: { driverId: ModelDriverId }) => Promise<ContractResult<ModelSummary[]>>
  setEnabled: (request: { driverId: ModelDriverId, enabled: boolean }) => Promise<ContractResult<void>>
  submitCue: (request: { envelope: CueEnvelopeInput, options?: CueSendOptions }) => Promise<ContractResult<ModelDriverSubmitAck>>
  /** One driver-protocol message to the manager. Opaque to the host. */
  sendManagerMessage: (payload: { driverId: ModelDriverId, message: unknown }) => Promise<ContractResult<void>>
  /** Answer the entry request the host pushed. */
  sendEntryResult: (payload: { requestId: string, error?: ModelDriverFailure }) => Promise<ContractResult<void>>
  onCueSettled: (handler: (settlement: { nonce: number, result: ContractResult<CueAck> }) => void) => () => void
  onOpenEntry: (handler: (request: ModelDriverEntryRequest) => void) => () => void
  onManagerMessage: (handler: (payload: { driverId: ModelDriverId, message: unknown }) => void) => () => void
  /**
   * The publication the host resolved after a user arbitration, for the driver that owns it.
   *
   * The adapter hands it to that driver's `HostPromptService.onResolution`; a window that does not run the
   * driver's entry has nothing to deliver it to, which is why this is addressed by driver and not broadcast as
   * a fact about the host.
   */
  onPromptResolution: (handler: (payload: { driverId: ModelDriverId, publication: ModelPromptPublication }) => void) => () => void
}
