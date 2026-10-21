/**
 * Runtime cues: everything AIRI asks the avatar to *do* while it is on stage.
 *
 * Owner: AIRI (and the character card, the ACT pipeline, or the user) sends cues; the renderer
 * implements a sink and reports whether it handled each one.
 *
 * Which channel a host signal travels on is decided by its shape, never by convenience:
 *   - a **prop** (`renderer-mount.ts`) carries the live host decisions about one mount
 *     (`paused`, `visible`, `reducedMotion`, `qualityHint`) and what the host assigns to it;
 *   - a **service** (`host-services.ts`) carries what a renderer pulls when it wants it, plus
 *     the streams it subscribes to (`pointer`; speech analysis is plugin-level and deliberately
 *     outside this contract, so no audio node or mouth scalar is a service member);
 *   - a **cue** (this file) carries a discrete, ackable, rejectable intent.
 *
 * A per-frame stream MUST NOT become a cue: `send` answers with an ack whose `results` array is
 * sized to the transaction, so one frame per cue would allocate an ack per frame and ask a
 * question a stream cannot answer.
 *
 * Three rules shape everything below:
 *   - an envelope is a **transaction**: its cues are applied together, never in sequence, and
 *     the ack reports per-slot outcomes aligned by index;
 *   - the renderer owns its own state and its own settings UI, so a cue states an *intent*,
 *     never a mechanism;
 *   - a cue AIRI cannot decompose into others (a profile whose composition only the renderer
 *     knows) is addressed by id instead of being translated or forwarded;
 *   - **appearance is one of those.** Which parts are visible, which outfit composes them and
 *     how two outfits interact are the renderer's, so AIRI names a profile and never sets a part
 *     or a raw parameter. There is deliberately no cue for either.
 */
import type { ModelId, ModelProfileId } from './model'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverId,
  OperationNonce,
  RendererMountPoint,
  RendererMountSurfaceKind,
  Unsubscribe,
} from './shared'

/** The compile-time cue vocabulary. `ACT` carries a token whose vocabulary is known at runtime. */
export enum CueKind {
  LOAD = 'load',
  ACT = 'ACT',
  EXPRESSION = 'expression',
  MOTION = 'motion',
  VFX = 'vfx',
  /** Apply a renderer-managed profile, addressed by id. */
  PROFILE = 'profile',
  GAZE = 'gaze',
  VIEW = 'view',
  CAPTION = 'caption',
  RESET = 'reset',
  /** Encode the current frame and return it in the ack's `results`. */
  CAPTURE = 'capture',
}

/** Where a cue came from. Renderers may treat agent and user cues differently. */
export enum CueSource {
  USER = 'user',
  AGENT = 'agent',
  CARD = 'card',
  RENDERER = 'renderer',
  HOST = 'host',
  EXTERNAL = 'external',
}

export interface CueEnvelope<C extends Cue = Cue> {
  /**
   * One transaction; a single cue is the length-1 case.
   *
   * Members are applied together, never in sequence — sequencing is deliberately not
   * expressible. Grouping matters because a multi-part change (a profile and an expression
   * together) must not be half-applied, and because `nonce`, `persistent` and `target` then
   * describe the whole change rather than three unrelated ones.
   *
   * Ordering belongs to the renderer, and this contract asks for exactly one order — as a
   * recommendation, not a rule: **apply a `load` member before the others, and the rest
   * together once it has landed**, because every other kind presupposes a model already on this
   * mount. A renderer that takes the recommendation and then fails the load is expected to
   * leave the rest unapplied and to report that same reason in every remaining slot
   * (`no-model`, `renderer-not-ready`, `unknown-key`, `busy`, `superseded`), so `handled: false`
   * never means "half of the group landed".
   *
   * At most one `load` per envelope is recommended: if several arrive, applying the last and
   * reporting `superseded` for the others keeps an envelope the caller built wrong inside the
   * existing vocabulary.
   *
   * Across envelopes the host owes exactly one property: **FIFO per addressed mount**. It
   * delivers transactions to one mount in the order they were sent — no dependency analysis and
   * no priority, because an envelope carries no statement about the envelopes around it. FIFO is
   * a delivery order rather than a serialization: two envelopes for the same mount may be in
   * flight at once, which is why `superseded` stays a real outcome and why the ack echoes the
   * `nonce`. A renderer may rely on receiving transactions in send order, and MUST NOT rely on
   * one having finished before the next arrives.
   */
  cues: C[]
  source: CueSource
  /**
   * `false` = preview: apply transiently, never persist, never touch the renderer's saved state
   * or its snapshot revision. Default `true`.
   *
   * Meaningless for `load` / `reset` / `caption`: a load and a reset have no transient form, and
   * a caption must never be saved as state at all.
   */
  persistent?: boolean
  nonce: OperationNonce
  /** Epoch milliseconds, so late deliveries can be discarded by age. */
  at: number
  target?: {
    modelDriverId?: ModelDriverId
    modelId?: ModelId
    /**
     * One mount, when a surface holds more than one (`RendererMountProps.mountId`).
     *
     * The live stage plus a settings preview, or two previews, are two mounts on one surface, so
     * a surface alone cannot say which of them a transaction is for. This is the same identity a
     * per-mount service subscription names. The first broker requires it; there is no implicit
     * "the only mount" routing, because a silently chosen mount is exactly the ambiguity this
     * field exists to remove.
     */
    mountId?: string
    /**
     * All mounts sharing this state scope, when the transaction is about the shared surface
     * rather than one viewport.
     *
     * This is how the actor window and a chat-side stage would stay in lockstep: they mount with
     * one `stateScope`, and a transaction naming that scope would be applied by every one of them.
     * The control strip would use it so one cue changes both views instead of picking a "main"
     * stage.
     *
     * **Not implemented by the first broker.** It accepts only `mountId`, because a scope
     * transaction has several answerers and the aggregate ack rules are not settled yet. Until
     * then a `stateScope` target is rejected with `ContractFailureCode.INVALID_ENVELOPE`, and
     * callers that need both views must address each mount explicitly. Once fan-out lands, a slot
     * is `resolved` only when every target resolved it and `CueAck.mountId` is absent; `mountId`
     * takes precedence when both are present.
     */
    stateScope?: string
    /**
     * The host delivers only to the mount of this surface, so a preview never animates the live
     * stage. A cue without a surface is never delivered to a `preview` mount.
     */
    surface?: RendererMountSurfaceKind
  }
}

/**
 * A transaction as a caller hands it to the channel: the delivered envelope minus the two
 * fields the bus owns.
 *
 * `at` is stamped by the bus, which is the side that knows when the transaction entered it.
 * `nonce` is optional here for the same reason — the bus mints the next one — and a caller
 * supplies it only to pin the transaction to a value it already tracks. Everything else is the
 * caller's: in particular `persistent`, which is what makes a preview expressible, and
 * `target`, which decides which mount receives it.
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
   * cancelled it, with nothing newer replacing it. A renderer MUST NOT report one as the other.
   */
  SUPERSEDED = 'superseded',
  BUSY = 'busy',
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
}

export type CueOutcome = CueResolved | CueRejected

export interface CueAck {
  /** Echo of the envelope's `nonce`, so a caller with several transactions in flight can match an answer to its own. */
  nonce: OperationNonce
  /**
   * The mount that answered.
   *
   * Required whenever the ack crosses a process boundary: the broker uses it to reject an ack
   * from a window that does not own the mount. A direct in-process sink may leave it out. A
   * future scope-fan-out aggregate has several answerers and would leave it empty; that
   * aggregation is not part of the first broker.
   */
  mountId?: string
  /**
   * Host-minted correlation id.
   *
   * Required on the broker path: one mount can have several transactions in flight, and the
   * ack is routed by `(requestId, mountId)`. Only an in-process direct sink may omit it.
   */
  requestId?: string
  /**
   * Index-aligned with `CueEnvelope.cues`: exactly one settled outcome per cue.
   *
   * There is deliberately no `undefined`: an applied cue always reports `CueResolved`, even when
   * it carries no data (`value: { kind }`), and one that was not applied reports `CueRejected`.
   * A wholesale refusal (not ready, no model, suppressed by mode) fills every slot with the same
   * reason. The host answers `no-model` by itself when the addressed surface has no mount, so a
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
}

export interface CueSendOptions {
  /**
   * Drop the whole transaction instead of delivering it when the addressed mount is not ready.
   * Default `false`: the transaction waits for the mount.
   *
   * Dropping is a **choice, not a failure**: a dropped transaction answers `ok: true`, with
   * `CueAck.results` filled with `{ status: 'rejected', reason: CueRejection.RENDERER_NOT_READY }`
   * in every slot and `handled: false`. The host answers it, because not delivering is the host's
   * decision — which also means the renderer is never consulted about a model it is not rendering.
   *
   * Independent of ordering *between* transactions, which the host guarantees as FIFO per
   * addressed mount (`CueEnvelope.cues`). One ack is returned per transaction, and a caller that
   * does not await one accepts that a newer transaction for the same mount may overtake it — in
   * which case the renderer reports `CueRejection.superseded` rather than dropping it silently.
   */
  dropIfNotReady?: boolean
  /**
   * How long the caller is willing to wait for the transaction to settle.
   *
   * Host-side. A timeout ends the send with `ContractFailureCode.TIMEOUT` instead of leaving it
   * pending forever; the renderer is not asked to cancel work it has already started. Capture is
   * the slow case and should pass a shorter deadline than an ordinary cue.
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
   * with it: `persistent` (a preview), `target` (which mount), and `nonce`. The bus stamps `at`
   * and mints `nonce` when the caller leaves it out.
   */
  send: (envelope: CueEnvelopeInput, options?: CueSendOptions) => Promise<ContractResult<CueAck>>
  /**
   * Observe transactions crossing the bus.
   *
   * For observers only — a host overlay, diagnostics, a renderer's own bookkeeping in another
   * window. It is deliberately **not** how a mounted stage receives cues: one renderer can be
   * mounted on several surfaces at once, so the host delivers each transaction to the mount its
   * `target.mountId` names — or, once fan-out lands, to every mount in a `stateScope` — through
   * each mount's own sink (`RendererMountExposed.cues`). The first broker accepts only `mountId`.
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
 * Put one model on this mount: the whole of AIRI's knowledge about *what* to load.
 *
 * This is the only way a mount is ever told which model to show. The model is named here, not
 * only in `target.modelId`: a cue has to be self-contained, because `target` decides routing and
 * is optional, while a load without a model is not expressible. When both are present they agree.
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
 * (`asset-missing`, `asset-corrupt`, `aborted`, `renderer-unavailable`, `internal`), while
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
  /** The profile to show it in, when the caller has one in mind. AIRI mints it too. */
  profileId?: ModelProfileId
}

/**
 * Run one ACT token.
 *
 * The token string travels verbatim and the renderer projects it: the vocabulary behind it is
 * the renderer's and is known only at runtime (`CapabilityVocabularySnapshot`). AIRI never
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

/** Visual effect trigger (VRM auras today). */
export interface VfxCue {
  kind: CueKind.VFX
  effect: string
  durationMs?: number
}

/**
 * Switch to, or try on, a renderer-managed model profile.
 *
 * A profile is a named configuration the renderer stores and knows how to compose — an outfit,
 * an alt model, a set of mesh and expression weights — together with the rules that make the
 * parts interact. AIRI only names the result and MUST NOT decompose it.
 *
 * `persistent: false` on the envelope is what a try-on is: applied transiently, never saved,
 * never bumping the renderer's snapshot. `ResetCue` with `scope: ResetScope.PROFILE` takes it
 * back off again.
 */
export interface ProfileCue {
  kind: CueKind.PROFILE
  profileId: ModelProfileId
}

/**
 * Which target replaces the live pointer.
 *
 * All four answer the same question, with `POINTER` being the answer that ends the override — so
 * this stays one override rather than a gaze configuration.
 */
export enum GazeMode {
  NONE = 'none',
  POINTER = 'pointer',
  CAMERA = 'camera',
  TARGET = 'target',
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
   * `CAMERA` = look at the viewer, `NONE` = rest.
   */
  mode: GazeMode
  point?: RendererMountPoint
}

/**
 * Put the renderer's own camera on a place the renderer has named.
 *
 * Which part of a model is worth looking at is a fact about the rig, so it belongs to whoever
 * resolved the rig. A caller addresses a target by the `key` of a `ModelCapabilityDescriptor` of
 * kind `'pointOfInterest'` (`capabilities.ts`), enumerated for this model at runtime, and the
 * mapping from that id to a bone, a hit area or a framed bounding box stays behind the renderer.
 *
 * Deliberately no absolute camera values, and no way to grow them: position, distance, field of
 * view and the look-at target are the renderer's own state. A caller says *where* and *how
 * tight*; everything else is the renderer's.
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
   * greater moves closer, smaller pulls back. Absent = `1`.
   *
   * Relative on purpose: an absolute distance is a rig fact in units AIRI cannot know, and the
   * renderers whose "camera" is a 2D transform have no distance at all.
   */
  zoom?: number
}

/**
 * Text the renderer shows.
 *
 * The cue carries the utterance and, when the host knows it, the sentence split with each
 * sentence's timing — which is what sentence-sync highlighting needs. It carries content only:
 * never position, font or colour.
 *
 * This is an **optional capability**: a driver that can show text, including head-tethered
 * presentation, declares `'caption'` and owns that rendering. One that cannot leaves it out of
 * `ModelDriverCapabilities.cues`; the host then does not send it. AIRI may choose to show its own
 * host overlay fallback, which is host policy and outside this contract, but that fallback cannot
 * use a driver `HeadPose`. Sending the cue anyway is `unsupported-cue`. `ResetCue` with
 * `scope: 'caption'` takes it down again.
 */
export interface CaptionCue {
  kind: CueKind.CAPTION
  /**
   * The whole utterance, as one string.
   *
   * Replacement, not append: a later cue with the same `utteranceId` supersedes the earlier text,
   * so a host that synthesizes a sentence at a time re-sends the growing utterance instead of
   * sending fragments for the renderer to concatenate.
   */
  text: string
  /**
   * Which utterance this belongs to, minted by the caller: several cues may carry the same
   * utterance — the first, then updates incrementally — and the renderer uses it to keep its own
   * progress instead of restarting the highlight on every update.
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
  PROFILE = 'profile',
  GAZE = 'gaze',
  VIEW = 'view',
  /**
   * Put the model back where the renderer keeps it: position, scale and rotation.
   *
   * The renderer owns its transform, so the host cannot reset it by writing a value back; this is
   * how "reset this model's placement" stays a host action without a second copy of the numbers.
   */
  TRANSFORM = 'transform',
  CAPTION = 'caption',
  ALL = 'all',
}

/**
 * Hand an expression/pose back to the renderer's saved state.
 *
 * `PROFILE` is what a previewed outfit or alt model reverts through, since a transient
 * (`persistent: false`) `ProfileCue` has no duration of its own; `GAZE` releases a `GazeCue`
 * override back to the live pointer; `VIEW` gives the camera back to the renderer's own default
 * framing; `TRANSFORM` does the same for the model's placement, which the renderer also owns;
 * `CAPTION` takes down text a `CaptionCue` put up, because an utterance has no duration of its own
 * either.
 */
export interface ResetCue {
  kind: CueKind.RESET
  scope: ResetScope
}

/**
 * Encode this mount's current canvas.
 *
 * A cue rather than an exposed method because capture is a discrete, refusable transaction
 * addressed to one mount: the caller that wants a selfie may be in another window and does not
 * hold the component reference. The encoded bytes come back in `CueAck.results`.
 *
 * **The payload is empty on purpose.** The renderer captures everything its own canvas holds,
 * chooses the encoding and returns the actual `CaptureResult` (format and pixel size included).
 * The caller does not specify a background, a format, a quality or a target width: it does not
 * know what the canvas contains, and a capture that only returns part of the canvas would be a
 * different, much less predictable operation.
 *
 * Capture is slow and its failure is reported through the `ContractResult` error branch, so it
 * MUST be the only cue in its envelope. The broker rejects a mixed envelope with
 * `ContractFailureCode.INVALID_ENVELOPE`; a caller that wants to combine a capture with another
 * intent sends two transactions and correlates them by `requestId`.
 */
export interface CaptureCue {
  kind: CueKind.CAPTURE
}

export type Cue
  = | LoadCue
    | ActCue
    | ExpressionCue
    | MotionCue
    | VfxCue
    | ProfileCue
    | GazeCue
    | ViewCue
    | CaptionCue
    | ResetCue
    | CaptureCue
