/**
 * Runtime cues: everything AIRI asks the avatar to *do* while it is on stage.
 *
 * Owner: AIRI (and the character card, the ACT pipeline, or the user) sends cues; the renderer
 * implements a sink and reports whether it handled each one. The **manager** is what actually
 * delivers a transaction to the mounts that match its target, and what a withdrawal is addressed to.
 *
 * Three rules shape everything below:
 *   - an envelope is a **transaction**: its cues are applied together, ordered by the driver.
 *     The sender MUST NOT assume the ordering. But the reported per-slot outcomes MUST be aligned by index;
 *   - sender MUST NOT stream cues for prolonged continuous manipulation of the model. Use props
 *     or service instead.
 *   - an action AIRI cannot decompose into others (a profile whose composition only the renderer
 *     knows) is addressed by id instead.
 */
import type { ModelId, ModelProfileId } from './model'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverId,
  OperationNonce,
  RendererMountPoint,
  RendererMountPurpose,
  RendererMountSurfaceKind,
  Unsubscribe,
} from './shared'

/** The compile-time cue vocabulary. `ACT` carries a token whose vocabulary is known at runtime. */
export enum CueKind {
  /** Load a model by its ID. */
  LOAD = 'load',
  /** Perform the action identified by an ACT token. */
  ACT = 'act',
  /** Change expression. */
  EXPRESSION = 'expression',
  /** Play animation */
  MOTION = 'motion',
  /** Apply a visual effect. */
  EFFECT = 'effect',
  /** Apply a renderer-managed profile by its id. */
  PROFILE = 'profile',
  /** Temporarily override where the model is looking at. */
  GAZE = 'gaze',
  /** Move the camera to a specific POI. */
  VIEW = 'view',
  /** Render a caption. */
  CAPTION = 'caption',
  /** Reset to a default state. */
  RESET = 'reset',
  /** Capture the current frame on the canvas. */
  CAPTURE = 'capture',
}

/**
 * The cue kinds a driver may declare it accepts.
 *
 * `load` is deliberately not in this union: it is the one cue every mount must handle, because it is
 * the only way a mount is ever told which model to show. A declaration that could list `load` would
 * let a driver claim a viewport that can never load anything, so `ModelDriverCapabilities.cues` is
 * typed as this and a `load` in it does not typecheck.
 */
export type OptionalCueKind = Exclude<CueKind, CueKind.LOAD>

/** Where a cue came from. Renderers may treat agent and user cues differently. */
export enum CueSource {
  USER = 'user',
  AGENT = 'agent',
  CARD = 'card',
  RENDERER = 'renderer',
  HOST = 'host',
  EXTERNAL = 'external',
}

/**
 * Where a transaction applies: a driver, and where inside it.
 *
 * This is the whole of cue addressing (RFC §9.2). A surface is stable while mount identity is not,
 * and a window can be duplicated, so a target may match several mounts — the driver decides how to
 * answer a transaction whose cues produce several results, and a caller MUST NOT assume which
 * viewport answered.
 *
 * `modelDriverId` is required: a transaction is addressed to one driver. `surface` and `purpose` are
 * an AND filter, and an absent member means "any". Nothing may resolve a surface to "the" mount, and
 * no field here names a mount.
 */
export interface CueTarget {
  modelDriverId: ModelDriverId
  surface?: RendererMountSurfaceKind
  purpose?: RendererMountPurpose
}

/**
 * A semi-transaction envelope for cues. A single cue is the length-1 case.
 *
 * ### Atomicity
 * Members are applied together, and the cues MUST NOT be in half-applied state.
 *
 * ### Ordering
 * The sender MUST NOT assume the ordering. Ordered cues are not yet supported.
 *
 * Envelopes themselves are FIFO from source per addressed driver. Although not recommended,
 * the sink MAY implement a different ordering, and MAY process later envelopes while a
 * former envelope is still being processed.
 */
export interface CueEnvelope<C extends Cue = Cue> {
  /**
   * Grouping matters because a multi-part change (a profile and an expression
   * together) must not be half-applied.
   */
  cues: C[]
  source: CueSource
  /**
   * Whether the cues in this envelope should override existing ones.
   */
  override: boolean
  /**
   * `false` = preview: apply transiently, never persist, never touch the renderer's saved state.
   * Default `true`.
   *
   * Meaningless for `load` / `reset` / `caption`, and a transaction that sets it to `false` while
   * carrying one of them is malformed (`INVALID_ENVELOPE`): a load and a reset have no transient
   * form, and a caption must never be saved as state at all.
   */
  persistent?: boolean
  nonce: OperationNonce
  /** Epoch milliseconds, so late deliveries can be discarded by age. */
  at: number
  /** Where this transaction applies. Required: a transaction with no target is unroutable. */
  target: CueTarget
}

/**
 * A transaction as a caller hands it to the channel: the delivered envelope minus the two
 * fields the bus owns.
 *
 * `at` is stamped by the bus, which is the side that knows when the transaction entered it.
 * `nonce` is optional here for the same reason — the bus mints the next one — and a caller
 * supplies it only to pin the transaction to a value it already tracks. Everything else is the
 * caller's: in particular `persistent`, which is what makes a preview expressible, and `target`,
 * which decides which mounts receive it.
 */
export type CueEnvelopeInput<C extends Cue = Cue>
  = Omit<CueEnvelope<C>, 'at' | 'nonce'> & { nonce?: OperationNonce }

/**
 * Why a cue was not handled.
 *
 * Every value here is a **refusal, not a failure**. The send still resolves `ok: true`, and an
 * error is reserved for an operation that was attempted and broke (`ContractFailureCode`).
 * "I may choose not to do it", "I do not have that key" and "someone newer replaced it" are
 * ordinary outcomes — which is why a refused cue, a dropped transaction
 * (`CueSendOptions.dropIfNotReady`) and a superseded one all look the same from the caller's
 * side: a successful send, `handled: false`, and a rejected outcome per slot.
 */
export enum CueRejection {
  UNSUPPORTED_CUE = 'unsupported-cue',
  /** The renderer has no such expression, motion, point of interest or profile. */
  UNKNOWN_KEY = 'unknown-key',
  /** Still loading. */
  RENDERER_NOT_READY = 'renderer-not-ready',
  /** No model is mounted. */
  NO_MODEL = 'no-model',
  /** Ignored by policy: paused, hidden, reduced motion, or a preview mode. */
  SUPPRESSED_BY_MODE = 'suppressed-by-mode',
  /**
   * A newer transaction for the same mount made this one moot.
   *
   * A **normal** outcome rather than a failure: the send still succeeds and only this slot is
   * reported as not applied. A renderer that applies a newer motion while an older one is still
   * being applied says so here instead of pretending it played.
   *
   * Deliberately not `ContractFailureCode.ABORTED`, which is the abnormal side of a
   * similar-looking event — the work was dropped because the mount went away or the caller
   * aborted it, with nothing newer replacing it. A renderer MUST NOT report one as the other.
   */
  SUPERSEDED = 'superseded',
  BUSY = 'busy',
  /**
   * Nothing matched the transaction's target.
   *
   * The broker's decision, not a renderer's: it fills every slot with this value, settles
   * `handled: false`, and delivers the settlement to the originating adapter. It is a settled,
   * successful transaction — "no mount on `stage`/`acting` right now" is an answer, not an error.
   */
  NO_TARGET = 'no-target',
}

/** The encoded canvas a `CaptureCue` resolves to. The renderer chooses the format. */
export interface CaptureResult {
  kind: CueKind.CAPTURE
  mime: string
  /**
   * Encoded bytes. `ArrayBuffer` rather than `Blob` because an ack crosses Electron IPC and
   * `ArrayBuffer` has the most predictable structured-clone behaviour there.
   */
  data: ArrayBuffer
  width: number
  height: number
}

/**
 * The payload of a cue that was applied.
 *
 * Every `CueKind` has a member, even when it carries no data: `{ kind }` is the whole value for
 * a cue that only needs to say "done". `CueResolved` below wraps it, so an ack never uses
 * `undefined` to mean success.
 */
export type CueResult = CaptureResult | {
  [K in Exclude<CueKind, CueKind.CAPTURE>]: { kind: K }
}[Exclude<CueKind, CueKind.CAPTURE>]

/**
 * A settled cue that was applied.
 *
 * Modelled on `PromiseFulfilledResult`: `status` is the discriminant and `value` carries the
 * payload. `resolved` is used where Promise says `fulfilled`; the two mean the same thing here.
 */
export interface CueResolved {
  status: 'resolved'
  value: CueResult
  /**
   * Debug text the driver attached. Never parsed, never shown as an error: the applied outcome is
   * already complete, and this exists so a driver can say *how* it applied something.
   */
  message?: string
}

/**
 * A settled cue that was not applied.
 *
 * Modelled on `PromiseRejectedResult`. **This is a refusal, not an exception**: `superseded` and
 * `busy` are normal outcomes, so callers MUST NOT throw or treat them as transport failures. The
 * failure branch of `ContractResult` remains the only place for "attempted and broke".
 */
export interface CueRejected {
  status: 'rejected'
  reason: CueRejection
  /** Debug text the driver attached, for a refusal the reason alone does not explain. */
  message?: string
}

export type CueOutcome = CueResolved | CueRejected

export interface CueAck {
  /** Echo of the envelope's `nonce`, so a caller with several transactions in flight can match an answer to its own. */
  nonce: OperationNonce
  /**
   * The driver that answered.
   *
   * Required, and the manager fills it from the driver it delivered for rather than from the
   * envelope it received: an ack that names a different driver is a forged or misrouted answer, and
   * the broker discards it rather than settling the caller's transaction with someone else's
   * outcome.
   */
  modelDriverId: ModelDriverId
  /**
   * The mount that answered.
   *
   * **Not an address.** The one surviving mount identity on the cue path: it exists so a broker that
   * crosses a process boundary can reject an ack attributed to a window that does not own the mount.
   * A direct in-process sink may leave it out. Nothing asserts which viewport a caller will hear
   * from, and a caller MUST NOT route anything by it.
   */
  mountId?: string
  /**
   * Index-aligned with `CueEnvelope.cues`: exactly one settled outcome per cue.
   *
   * There is deliberately no `undefined`: an applied cue always reports `CueResolved`, even when
   * it carries no data (`value: { kind }`), and one that was not applied reports `CueRejected`.
   * A wholesale refusal (not ready, no model, suppressed by mode) fills every slot with the same
   * reason. The host answers `no-target` by itself when nothing matches the target, so a
   * renderer is never asked about a model it is not rendering. A transport-level failure never
   * reaches here — it is the `ContractResult` error branch instead.
   */
  results: CueOutcome[]
  /**
   * Convenience: `results.every(result => result.status === 'resolved')`.
   *
   * `false` does **not** mean "nothing happened"; it means "not every slot was applied". A
   * partially applied transaction reports `false` and a mixed `results` array.
   */
  handled: boolean
  /**
   * Driver-level debug note about this transaction as a whole.
   *
   * The place for "delivered to three mounts, two applied it" without putting a wording on a slot
   * that already reports its own outcome. Never parsed, never an error.
   */
  message?: string
}

/**
 * A transaction that has been **accepted** but has not been settled.
 *
 * Acceptance and settlement are two different facts and arrive at different times (RFC §9.3): the
 * broker can say "I have this transaction, its correlation is 42" the moment it accepts one, while
 * the outcome is decided only when the work is done — a load settles at `model-loaded`, not at the
 * first frame. A caller that only wants fire-and-forget ignores `settled`; one that wants the
 * outcome awaits it.
 */
export interface CueTransactionReceipt {
  /** The correlation value the broker minted for this transaction. */
  nonce: OperationNonce
  /**
   * Resolves when the outcome is decided.
   *
   * Never left pending by a vanished receiver: the host settles it (`cancelled`, `aborted` or
   * `window-gone`) rather than leaving a caller waiting on a renderer that is gone.
   */
  settled: Promise<ContractResult<CueAck>>
}

export interface CueSendOptions {
  /**
   * Drop the whole transaction instead of delivering it when the addressed target is not ready.
   * Default `false`: the transaction waits for the target.
   *
   * Dropping is a **choice, not a failure**: a dropped transaction answers `ok: true`, with
   * `CueAck.results` filled with `{ status: 'rejected', reason: CueRejection.RENDERER_NOT_READY }`
   * in every slot and `handled: false`. The host answers it, because not delivering is the host's
   * decision — which also means the renderer is never consulted about a model it is not rendering.
   *
   * Independent of ordering *between* transactions, which the host guarantees as FIFO per addressed
   * driver (`CueEnvelope.cues`). One ack is returned per transaction, and a caller that
   * does not await one accepts that a newer transaction for the same driver may overtake it — in
   * which case the renderer reports `CueRejection.superseded` rather than dropping it silently.
   */
  dropIfNotReady?: boolean
  /**
   * How long the caller is willing to wait for the transaction to settle.
   *
   * Host-side. A timeout ends the send with `ContractFailureCode.TIMEOUT` instead of leaving it
   * pending forever; the renderer is not asked to cancel work it has already started. Capture is
   * the slow case and should pass a shorter deadline than an ordinary cue. The deadline is final
   * and stops nothing: a later ack is discarded rather than settling the transaction twice.
   */
  timeoutMs?: number
}

/**
 * The cue transport.
 *
 * Deliberately agnostic about how it crosses boundaries: in-process for the mounted stage,
 * `BroadcastChannel` between windows, IPC for remote actors.
 */
export interface CueChannel {
  /**
   * Send one transaction.
   *
   * Takes the envelope rather than a bare cue so everything describing the whole change travels
   * with it: `persistent` (a preview), `target` (which driver, surface and purpose), and `nonce`.
   * The bus stamps `at` and mints `nonce` when the caller leaves it out.
   *
   * Resolves with a **receipt**, not an ack: acceptance is immediate and settlement is
   * `receipt.settled` (RFC §9.3).
   */
  send: (envelope: CueEnvelopeInput, options?: CueSendOptions) => Promise<ContractResult<CueTransactionReceipt>>
  /**
   * Observe transactions crossing the bus.
   *
   * For observers only — a host overlay, diagnostics, a renderer's own bookkeeping in another
   * window. It is deliberately **not** how a mounted stage receives cues: one renderer can be
   * mounted several times at once, so the host delivers each transaction to the mounts its
   * `target` names, through each mount's own sink (`RendererMountExposed.cues`).
   */
  subscribe: (handler: CueSink) => Unsubscribe
}

/**
 * A sink that applies transactions.
 *
 * One per mount, plus whatever observers registered on the channel; a plugin-level sink does not
 * exist, because the plugin is not what is on stage.
 */
export interface CueSink {
  /**
   * Apply one transaction and report per-slot outcomes.
   *
   * The ack MUST echo `envelope.nonce` and fill every slot: `results[index].status === 'resolved'`
   * means the cue at that index was applied, and `'rejected'` means it was not, with `reason`
   * naming why.
   *
   * Returning a promise is how a slow operation is reported honestly rather than prematurely: a
   * `load` must not be answered until its outcome is decided (`LoadCue`).
   */
  handle: (envelope: CueEnvelope) => MaybePromise<ContractResult<CueAck>>
}

/**
 * Where a transaction is in its life (RFC §9.7).
 *
 * `COMPLETE`, `CANCELLED`, `ABORTED` and `ERROR` are terminal; everything else means work is still
 * outstanding and a withdrawal can still reach it. This is the vocabulary a withdrawal report names,
 * and it is why `cancelled` and `aborted` are distinct: the first never started, the second started
 * and was stopped.
 */
export enum CueTransactionState {
  /** The broker has accepted it and it has not reached the receiver. */
  SUBMITTED = 'submitted',
  /** The receiver holds it and has not started it. */
  QUEUED = 'queued',
  /** The receiver is performing it. */
  RUNNING = 'running',
  /** It finished and its acknowledgement is settled. */
  COMPLETE = 'complete',
  /** It was withdrawn before it started and will not be performed. */
  CANCELLED = 'cancelled',
  /** It started and was stopped before it finished. */
  ABORTED = 'aborted',
  /** It did not succeed: it broke, or its deadline passed. */
  ERROR = 'error',
}

/** Whether a state cannot change again. */
export function isTerminalTransactionState(state: CueTransactionState): boolean {
  return state === CueTransactionState.COMPLETE
    || state === CueTransactionState.CANCELLED
    || state === CueTransactionState.ABORTED
    || state === CueTransactionState.ERROR
}

/**
 * The six requests that withdraw work (RFC §9.7).
 *
 * They are one enum rather than six methods because they share a request shape, a report shape and
 * one set of bounds, and because a manager has to route all of them the same way — to the broker
 * first for what it still holds, then to its own queue.
 */
export enum CueWithdrawalKind {
  /** Withdraw transactions that have not started. Refused for one already running. */
  CANCEL = 'cancel',
  /** Withdraw any non-terminal transaction; the receiver decides on a running one. */
  ABORT = 'abort',
  /** Withdraw the receiver's newest transaction that has not started. */
  POP = 'pop',
  /** Withdraw every transaction of that receiver that has not started. */
  POP_ALL = 'pop-all',
  /** Withdraw the running transaction. */
  ABORT_CURRENT = 'abort-current',
  /** Withdraw every non-terminal transaction of that receiver. */
  DUMP = 'dump',
}

/** How one withdrawal target ended up (RFC §9.7's result table). */
export enum CueWithdrawalOutcome {
  /** It had not started and will not be performed. */
  CANCELLED = 'cancelled',
  /** A running transaction was asked to stop; it settles `aborted` or with its own outcome. */
  REQUESTED = 'requested',
  /** `cancel` was refused because the transaction had already started. It continues. */
  RUNNING = 'running',
  /** The transaction was already terminal; reported as it settled. */
  SETTLED = 'settled',
  /** No record of that correlation value. */
  UNKNOWN = 'unknown',
  /** A surface/purpose target matched nothing. */
  EMPTY = 'empty',
}

/** One target of a withdrawal request, and what happened to it. */
export interface CueWithdrawalTargetResult {
  /** The correlation value, when the request or the selection named one. */
  nonce?: OperationNonce
  outcome: CueWithdrawalOutcome
  /** The state observed when the request was applied, when the broker still knew it. */
  state?: CueTransactionState
}

/**
 * One withdrawal request.
 *
 * Names exactly one target family — correlation values, or a surface and purpose — and exactly one
 * driver: values belonging to two drivers are not named together, and a request that names no target
 * is malformed (RFC §9.7, `validateWithdrawalRequest`).
 */
export interface CueWithdrawalRequest {
  kind: CueWithdrawalKind
  /** The driver this request addresses. Required: the request is routed to one manager. */
  modelDriverId: ModelDriverId
  /** Correlations to withdraw. Mutually exclusive with `address`. */
  nonces?: OperationNonce[]
  /** A selection inside the driver. Mutually exclusive with `nonces`. */
  address?: {
    surface?: RendererMountSurfaceKind
    purpose?: RendererMountPurpose
  }
}

/** What a withdrawal request did. */
export interface CueWithdrawalReport {
  kind: CueWithdrawalKind
  /** One entry per target the request named or selected. */
  results: CueWithdrawalTargetResult[]
  /** How many targets were affected, even when `results` was capped. */
  count: number
  /** `results` was capped by `CUE_WITHDRAWAL_LIMITS.maxReportEntries`. */
  truncated?: boolean
}

/**
 * The host's bounds on a withdrawal request.
 *
 * Both exist so a single request cannot be turned into unbounded work in the main process: a caller
 * names at most `maxNoncesPerRequest` correlations, and a report carries at most
 * `maxReportEntries` results however many were affected (`count` stays exact). A request outside
 * these bounds is malformed and fails.
 */
export const CUE_WITHDRAWAL_LIMITS = {
  maxNoncesPerRequest: 64,
  maxReportEntries: 256,
} as const

/**
 * Put one model on this mount: the whole of AIRI's knowledge about *what* to load.
 *
 * This is the only way a mount is ever told which model to show. The model is named here, not
 * only in `target`: a cue has to be self-contained, because `target` decides routing and is
 * optional, while a load without a model is not expressible. When both are present they agree.
 *
 * `profileId` is a parameter of the load, not a second operation: "load model X showing profile
 * Y" is one intention, and keeping it here reports a bad profile against the load's own slot
 * instead of as a follow-up write the caller has to correlate. A sibling `ProfileCue` is
 * expressible too; what separates them is that this one is part of *what to load*, while a
 * sibling is a change made once the model is already there — and a sibling can be transient,
 * where this cannot.
 *
 * Ack timing: answered when the load's outcome is decided, not when the renderer accepts it. A
 * successful slot counts as applied once the mount reaches
 * `RendererMountReadinessState.MODEL_LOADED` — not at `first-frame`, which keeps its own meaning
 * as "the loading UI can go away".
 *
 * Settlement: the renderer MUST always settle. Disposal, disabling, or a superseding transaction
 * resolves a pending ack — `aborted`, or `superseded` when something newer took over. If the
 * renderer cannot settle at all, the **host** settles the caller's promise with `aborted`: a
 * caller must never be left waiting on a renderer that is gone.
 *
 * Reporting a failure: the error branch of the send carries what went wrong to the caller
 * (`asset-missing`, `asset-corrupt`, `aborted`, `driver-unavailable`, `internal`), while
 * `state-change` to `MODEL_ERROR` and the mount's `'error'` emit carry the same failure to
 * everyone else — both derived from that one outcome.
 *
 * Eligibility is not failure: a reference this renderer does not hold is a rejected outcome
 * (`unknown-key`, or `renderer-not-ready` while the mount is still coming up), so the send
 * succeeds with `handled: false` instead of failing.
 *
 * A renderer that needs the host to re-resolve and re-mount its current model sends this cue
 * addressed at its own `modelId`.
 */
export interface LoadCue {
  kind: CueKind.LOAD
  /** The model to show: AIRI's own id, the only handle either side uses (`model.ts`). */
  modelId: ModelId
  /** The profile to show it in if any. */
  profileId?: ModelProfileId
}

/**
 * Run one ACT token.
 *
 * The token string travels verbatim and the renderer projects it: the vocabulary behind it is
 * the renderer's and is known only at runtime (`CapabilityVocabulary`). AIRI never
 * learns what a token played; a caller that wants one specific unit uses `ExpressionCue`.
 */
export interface ActCue {
  kind: CueKind.ACT
  actToken: string
  meta?: Record<string, unknown>
}

/**
 * Direct addressing of one expression unit, by the id the renderer listed as
 * `ModelCapabilityKind.EXPRESSION`.
 *
 * `key` is that one id, whatever addressing the format uses underneath: the cue never names a
 * blend shape, a vertex morph or a parameter, so a format that stores an expression as several
 * of those still offers exactly one id per expression.
 */
export interface ExpressionCue {
  kind: CueKind.EXPRESSION
  key: string
  /** Normalized 0..1; the renderer maps to its own weight range. */
  value?: number
  /**
   * How long to hold it before handing the expression back to the renderer's saved state.
   *
   * Expressions and poses have no timeline, so a transient (`persistent: false`) one needs this;
   * the renderer may apply a default when it is absent.
   */
  resetAfterMs?: number
}

/**
 * Play a motion/animation.
 *
 * `key` is required, and it is the renderer-native id the renderer itself produced in a
 * `ModelCapabilityDescriptor` (`capabilities.ts`) — one id, whatever addressing the format uses
 * underneath. A motion the renderer cannot name by one id is therefore a motion it does not
 * offer, and the rejected reason for naming one it never listed is `unknown-key`.
 */
export interface MotionCue {
  kind: CueKind.MOTION
  key: string
  /**
   * `-1` = forever, `1` = once, `n` = n times.
   * `undefined` = honour the asset's own declaration (VRMA `loop`, a Live2D motion's `Loop`),
   * because the loop intent is authored in the asset.
   */
  repeat?: number
  crossfadeMs?: number
}

/**
 * Trigger one visual effect family for an optional duration.
 *
 * `effect` names a `ModelCapabilityKind.EFFECT` descriptor the renderer listed, exactly as `key`
 * names an expression or a motion. There is no host-side effect vocabulary: "VRM auras today" is
 * where the first family came from, not something the contract knows.
 */
export interface EffectCue {
  kind: CueKind.EFFECT
  effect: string
  durationMs?: number
}

/**
 * Switch to, or try on, a renderer-managed model profile.
 *
 * A profile is a named configuration the renderer stores and knows how to compose — an outfit,
 * an alt model, a set of mesh and expression weights. AIRI only names the result and MUST NOT decompose it.
 *
 * `persistent: false` on the envelope is what a try-on is: applied transiently, never saved, and
 * never becoming the renderer's state. `ResetCue` with `scope: ResetScope.PROFILE` takes it
 * back off again.
 */
export interface ProfileCue {
  kind: CueKind.PROFILE
  profileId: ModelProfileId
}

/**
 * Which target replaces the live pointer.
 *
 * All five answer the same question, with `POINTER` being the answer that ends the override — so
 * this stays one override rather than a gaze configuration.
 */
export enum GazeMode {
  NONE = 'none',
  POINTER = 'pointer',
  CAMERA = 'camera',
  TARGET = 'target',
  /** Look at a place in the model the renderer named (`ModelCapabilityKind.POINT_OF_INTEREST`). */
  POINT_OF_INTEREST = 'pointOfInterest',
}

/**
 * Temporarily override the live pointer the renderer follows by default.
 *
 * Suitable for a scripted look-at, a one-off glance at a UI element, or looking at the viewer.
 * The override holds until a `GazeCue` with `mode: GazeMode.POINTER` or `GazeMode.NONE`, or a
 * `ResetCue` with `scope: ResetScope.GAZE`.
 *
 * Difference from `ViewCue`: `GazeCue` moves the model's eyes, `ViewCue` moves the camera.
 */
export interface GazeCue {
  kind: CueKind.GAZE
  /**
   * `POINTER` = follow the live pointer again (the default), `TARGET` = use `point`,
   * `POINT_OF_INTEREST` = use `pointOfInterestId`, `CAMERA` = look at the viewer, `NONE` = rest.
   */
  mode: GazeMode
  /** Required when `mode` is `TARGET`; refused as `unknown-key` for a place the renderer never listed. */
  point?: RendererMountPoint
  /** Required when `mode` is `POINT_OF_INTEREST`. */
  pointOfInterestId?: string
}

/**
 * Put the renderer's own camera on a place the renderer has named.
 *
 * Which part of a model is worth looking at is a fact about the rig, so it belongs to whoever
 * resolved the rig. A caller addresses a target by the `key` of a `ModelCapabilityDescriptor` of
 * kind `'pointOfInterest'` (`capabilities.ts`), enumerated for this model at runtime. How to move
 * the camera is up to the model driver.
 *
 * `ResetCue` with `scope: 'view'` hands the framing back to the renderer's own default.
 */
export interface ViewCue {
  kind: CueKind.VIEW
  /**
   * What to frame: the `key` of one `'pointOfInterest'` descriptor this renderer produced for
   * this model. A key it never listed is refused as `unknown-key`, like any other address.
   */
  pointOfInterestId: string
  /**
   * How tight, relative to the renderer's own framing of that target: `1` is that framing,
   * smaller moves closer, larger pulls back. Absent = `1`.
   */
  distance?: number
}

/**
 * Text the renderer shows.
 *
 * The cue carries the utterance and, when the host knows it, the sentence split with each
 * sentence's timing — which is what sentence-sync highlighting needs. Formatting or styling
 * is unsupported by design.
 */
export interface CaptionCue {
  kind: CueKind.CAPTION
  /** The whole utterance, as one string. */
  text: string
  /**
   * Which utterance this belongs to, minted by the caller: several cues may carry the same
   * utterance ID for incremental updates.
   */
  utteranceId: string
  /** The sentence split, in order, for sentence-sync highlighting. */
  segments?: CaptionSegment[]
  /** BCP-47 tag when the host knows it, so a renderer can pick its own line-breaking policy. */
  language?: string
  /**
   * How far into this utterance playback already is, when this cue was sent.
   *
   * A relative offset rather than a clock reading, so no clock has to be shared: a renderer that
   * receives the first cue mid-sentence starts its highlight here instead of at zero, and one
   * that receives it as playback begins leaves it out (absent = nothing has played yet).
   */
  elapsedMs?: number
}

/** One sentence of a caption, so a renderer can highlight what is being spoken. */
export interface CaptionSegment {
  /** The words themselves. */
  text: string
  /** Start offset from the utterance's beginning, in milliseconds; absent = follows the previous. */
  atMs?: number
  /** How long this sentence is spoken for, when the host knows. */
  durationMs?: number
}

/** What a `ResetCue` hands back to the renderer's saved state. */
export enum ResetScope {
  EXPRESSION = 'expression',
  MOTION = 'motion',
  /** Take down an `EffectCue` family's effect. */
  EFFECT = 'effect',
  PROFILE = 'profile',
  /** Releases a `GazeCue` override back to the live pointer */
  GAZE = 'gaze',
  /** Gives the camera back to the renderer's own default framing */
  VIEW = 'view',
  /** Put the model back where the renderer keeps it: position, scale and rotation. */
  TRANSFORM = 'transform',
  /** Takes down text that a `CaptionCue` put up */
  CAPTION = 'caption',
  ALL = 'all',
}

export interface ResetCue {
  kind: CueKind.RESET
  scope: ResetScope
}

/**
 * Encode this mount's current canvas.
 *
 * Capture is slow and its failure is reported through the `ContractResult` error branch, so it
 * MUST be the only cue in its envelope. The broker rejects a mixed envelope with
 * `ContractFailureCode.INVALID_ENVELOPE`; a caller that wants to combine a capture with another
 * intent sends two transactions and correlates them by `nonce`.
 *
 * Capture also follows the addressing rule rather than the query rule (RFC §8.6): from outside the
 * creating window it names a surface and a purpose, and the driver decides which mount answers.
 */
export interface CaptureCue {
  kind: CueKind.CAPTURE
}

export type Cue
  = | LoadCue
    | ActCue
    | ExpressionCue
    | MotionCue
    | EffectCue
    | ProfileCue
    | GazeCue
    | ViewCue
    | CaptionCue
    | ResetCue
    | CaptureCue
