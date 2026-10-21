/**
 * One mounted model viewport: what the host passes in, what it listens to, and what it may call on
 * the mounted renderer.
 *
 * Owner: the renderer implements a mount component (Vue, or an adapter that satisfies this shape);
 * the host mounts it and owns the container.
 *
 * Scope: this is the *model renderer's* viewport, not the stage the user sees. The stage is composed
 * by AIRI and the renderer together — a Live2D model carries no background at all, and the host
 * draws the background, its own overlays/layers and the control strip around the canvas this file
 * describes, while the renderer draws captions inside it. "Stage" therefore survives in this package
 * only where it names that host-side surface
 * (`RendererMountSurfaceKind`), and the package's own name reads the same way: a *stage renderer* is
 * one that renders for the stage, not the stage itself.
 */
import type { Component } from 'vue'

import type { CueKind, CueRejection, CueSink } from './cues'
import type {
  ContractFailure,
  ModelDriverId,
  OperationNonce,
  RendererMountPoint,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
  RendererMountViewport,
} from './shared'

/**
 * User interaction mode.
 *
 * A policy the host declares for this mount; it does not carry cross-renderer state of its own.
 */
export enum RendererMountInteractionMode {
  TACTILE = 'tactile',
  ORBIT = 'orbit',
  DRAG = 'drag',
  POSITIONING = 'positioning',
  NONE = 'none',
}

/**
 * A renderer-native interaction region changing under the pointer, pushed to the host.
 *
 * **Edge-triggered, not a stream**: one message per change — entering a region, or leaving one — so
 * moving inside the same region says nothing. The renderer MUST NOT re-emit per pointer move,
 * because the host subscribes to the pointer itself (`RendererPointerService`) and can move its own
 * overlay from those events. What only the renderer can notice is a change *it* caused: the model
 * turned, and the region under a still pointer is no longer the same one.
 *
 * `areaId` names the region as the renderer knows it, matching `RendererMountHitArea.areaId` from a
 * `hitTest` query. There is deliberately no point in the payload — the host has the pointer, and a
 * coordinate here could only ever disagree with it.
 */
export interface RendererMountHitAreaChange {
  areaId: string
  /** `true` = the pointer entered this region; `false` = it left it. */
  entered: boolean
}

/** The host's read on whether the current render load is sustainable. */
export enum RendererQualityHint {
  FULL = 'full',
  REDUCED = 'reduced',
}

/**
 * Props every model renderer mount must accept.
 *
 * Two families belong on a prop rather than in a service or a cue: the live host decisions about this
 * mount (`paused`, `visible`, `reducedMotion`, `qualityHint`, `interactionMode`, `viewport`), and what
 * the host assigns to the mount itself (`modelDriverId`, `mountId`, `stateScope`, `surface`).
 * Everything else a renderer pulls out of `ModelDriverHostServices`; discrete intents arrive as cues.
 *
 * There is deliberately no per-frame value here. Mouth openness used to be the exception; it is
 * now a **plugin-level** concern (`HostSpeechAnalyzerService`), outside this contract. A renderer
 * no longer receives an `AudioNode` (it cannot cross a realm) and the mount contract carries no
 * mouth scalar: the plugin subscribes to the analyzer's frame stream itself and drives its own
 * model.
 *
 * A prop carries a **value** the host can restate on every render; a stream of **events** is a
 * service a renderer subscribes to. That is why the pointer is not here: pointer input lives in
 * `RendererPointerService`.
 *
 * **The host never touches a renderer's viewport.** It does not read or write the renderer's drawing
 * surface, its graphics context, its camera or its scene graph, and it holds no handle to any of
 * them. It mounts a component, unmounts it, asks the questions `RendererMountExposed` declares, and
 * sends cues. Everything visible — the model, the effects, and any text or caption the renderer
 * shows — is drawn by the renderer inside the box the host gave it. A renderer MUST NOT bind its own
 * pointer listeners to obtain input the host already routes to it.
 *
 * Which model to show is deliberately not here either: it arrives as a `LoadCue` through this mount's
 * own sink, because choosing a model is a discrete, refusable transaction with a `nonce` — not a
 * value the host restates while mounting.
 *
 * The camera is the most visible case of the settings rule below. A renderer that declares `'view'`
 * owns its camera, and its values live in its own storage like any other renderer-owned setting — the
 * host asks through the cue instead of restating them on every mount.
 *
 * Theme hue is the deliberate exception, and the only setting where the split runs the other way:
 * the *host* owns it and a renderer only reads it (`ModelDriverHostServices.theme`, re-tinting on
 * its `onChange`).
 */
export interface RendererMountProps {
  /** Which driver owns this mount; useful for shared host overlays. */
  modelDriverId?: ModelDriverId
  /**
   * This mount's own identity, minted and owned by the host.
   *
   * Opaque, unique within a session, and never reused: it names *this viewport*, not the model on
   * it, not the surface it sits on and not the state it shares. Several mounts can share one
   * `stateScope`, and several scopes can live on one `surface`, so neither of those can stand in for
   * it — which is why a per-mount service is keyed by this value
   * (`RendererPointerService.subscribe(mountId, …)`).
   *
   * A cue may name it too (`CueEnvelope.target.mountId`), so a caller can address one mount when a
   * surface holds more than one.
   */
  mountId: string
  /**
   * The state scope this mount belongs to (`persistence.ts`).
   *
   * Opaque, minted and owned by the host: mounts in one scope share one state, and a mount never
   * chooses or invents a scope. Every non-preview mount (actor, chat, rehearsal, main stage) is
   * handed the same shared scope; only a preview mount gets its own. This is deliberately the whole
   * of what a mount is told about sharing — the policy stays on the host's side. The name is never
   * interpreted, and never equals a `RendererMountSurfaceKind` value.
   */
  stateScope: string
  /** Host-decided pause. Renderers MUST honour it and never self-pause. */
  paused: boolean
  /**
   * Host-decided visibility of this mount; skip work while false.
   *
   * Required for the same reason as `paused`: the host cannot mount a viewport without having
   * decided whether it is shown, so a renderer may rely on it.
   */
  visible: boolean
  /** Accessibility preference rather than a transient load decision. Absent = `false`. */
  reducedMotion?: boolean
  /**
   * Signals whether the host is struggling to keep up with the rendering.
   * Upon receiving `RendererQualityHint.REDUCED`, the renderer SHOULD lower
   * the render quality automatically, unless the user explicitly disabled that.
   */
  qualityHint?: RendererQualityHint
  viewport?: RendererMountViewport
  /**
   * Which pointer interaction this mount accepts, when the host offers one.
   *
   * The single channel for it: `'drag'` and `'positioning'` already say the user may move the model,
   * so there is deliberately no separate `draggable` flag for a second value to disagree with.
   *
   * A **policy the renderer applies** to the pointer events it receives, rather than a filter the
   * host applies for it: the host delivers every event for this mount and a renderer that is not in
   * a moving mode sees them and ignores them.
   */
  interactionMode?: RendererMountInteractionMode
  /**
   * Where this mount lives — used for cue routing, panel placement and host overlays.
   *
   * Deliberately not the identity of this mount's state: that is `stateScope`, and several mounts of
   * one surface can hold different scopes.
   */
  surface: RendererMountSurfaceKind
}

/**
 * Lifecycle emits every mount reports, whatever it renders.
 *
 * A *mount* concept: the host listens on the mount it created, and the plugin lifecycle emits none of
 * these itself.
 */
export interface RendererMountLifecycleEmits {
  /** Readiness state transitions, does not hold real values. */
  'state-change': (state: RendererMountReadinessState) => void
  /** First real frame presented; the host uses it to hide loading UI. */
  'first-frame': () => void
  'context-change': (isContextValid: boolean) => void
  'disposed': () => void
  'error': (failure: ContractFailure) => void
}

export interface RendererMountEmits extends RendererMountLifecycleEmits {
  /**
   * A renderer-native interaction region changed under the pointer.
   *
   * Deliberately not named "hover": this fires on the edges only
   * (`RendererMountHitAreaChange`). For the region under a point right now, ask — `hitTest`.
   */
  'hit-area-change': (change: RendererMountHitAreaChange) => void
  /**
   * A motion this host asked for has finished playing.
   *
   * Echoes the `nonce` of the transaction that started it — the same value `CueAck` and
   * `cue-rejected` carry — so a caller with several motions in flight can tell which one ended. It
   * is an `OperationNonce` rather than a motion key because what finished is a transaction, and a key
   * would collide across two mounts playing the same motion.
   *
   * There is deliberately no start/status counterpart: what a status consumer did with it — wait out
   * a motion before starting the next idle cycle — is animation scheduling, which belongs to the
   * renderer that owns the mixer.
   */
  'animation-finished': (nonce: OperationNonce) => void
  /**
   * A cue could not be handled; lets the host fall back or explain.
   *
   * Carries the transaction `nonce`, because an emit can arrive after the `send` call that produced
   * it has already resolved or been abandoned.
   */
  'cue-rejected': (payload: { nonce: OperationNonce, index: number, kind: CueKind, reason: CueRejection }) => void
}

/**
 * One interaction region of a mounted model, as the renderer names it.
 *
 * An `id` to match a region across calls, and a `name` to show the user.
 */
export interface RendererMountHitArea {
  /**
   * The renderer's own identifier for this region; stable across calls.
   *
   * Spelled `areaId` rather than `id` so that it matches the `areaId` the renderer pushes in
   * `RendererMountHitAreaChange`: one concept, one spelling, in both directions.
   */
  areaId: string
  /** The region's name as the model's own data declares it (`Head`, `Body`, …). */
  name: string
}

/**
 * How thoroughly a mount is torn down, when the host asks for it.
 *
 * The choice is the host's, not the renderer's: only the caller knows whether it is about to
 * re-mount the same model or is done with it, which is also why it is a parameter of
 * `RendererMountExposed.dispose` rather than renderer-side state.
 */
export enum RendererMountDisposeStrategy {
  /** Keeps parsed/GPU resources alive for a fast re-mount of the same model. */
  SHALLOW = 'shallow',
  /** Releases everything. */
  DEEP = 'deep',
}

/**
 * Methods the host may call on a mounted renderer.
 *
 * Everything here is optional, and whether it is there is reported in
 * `ModelDriverCapabilities` — the renderer's own probed answer
 * (`ModelDriverRuntime.rendererCapabilities()`), with `ModelDriverManifest.capabilities` only a
 * static hint — rather than inferred from whether the member happens to exist.
 *
 * What belongs here is settled by one rule: **a member either returns data or tears the mount down.**
 * Nothing that needs a target, an ack, a preview, or delivery to a mount the caller does not hold a
 * reference to belongs here — that is a cue. Capture is the clearest case: it is a discrete,
 * refusable transaction addressed to one mount, so it travels as `CaptureCue` and returns its bytes
 * in the ack, rather than as a method only the window holding the component reference could call.
 * Nothing that hands the caller the renderer's viewport belongs here either: text and captions
 * travel as cues (`CaptionCue`) and the renderer draws them itself.
 */
export interface RendererMountExposed {
  /**
   * Requires `ModelDriverCapabilities.occupiesPoint`.
   *
   * Does this mount have anything drawn at `point`?
   *
   * The host uses the answer for two window-level decisions it cannot make alone: whether a click
   * should reach the app behind the window, and whether the actor should fade so it stops blocking
   * what is behind it.
   *
   * This is a question about the *viewport*, not about the model. A background the host composites
   * outside this canvas is not the renderer's answer to give; anything the renderer itself draws —
   * model, effects, a region it declares interactive — is.
   *
   * Sensitivity is the renderer's own policy: how much alpha counts, or whether pixels are consulted
   * at all. It is therefore neither a parameter here nor a host setting.
   *
   * Synchronous by design: the host samples it as the pointer moves, so a renderer that needs a
   * frame to answer should cache rather than make the host await.
   */
  occupiesPoint?: (point: RendererMountPoint) => boolean
  /**
   * Requires `ModelDriverCapabilities.hitTest`.
   *
   * Which of this mount's interaction regions covers `point`, or `null` when none does.
   *
   * The renderer owns interaction with its own model: it already resolves its native hit regions,
   * acts on them, and pushes what it notices through `hit-area-change`. This member exists for the
   * other direction — the interaction items *AIRI* adds, which the model does not define, so AIRI has
   * to be able to ask where its own items land. It is the pull half of that pair: the push can only
   * report regions the renderer already knows about, while this answers for any point AIRI picks.
   *
   * `point` is in the same mount-local space as `occupiesPoint`.
   */
  hitTest?: (point: RendererMountPoint) => RendererMountHitArea | null
  /** Requires `ModelDriverCapabilities.stopAll`; used on pause and teardown. */
  stopAll?: () => void
  /**
   * Release this mount's resources, as thoroughly as the host asks.
   *
   * The strategy is the host's call, never the renderer's. Requires `ModelDriverCapabilities.dispose`:
   * without it the host simply unmounts the component.
   */
  dispose?: (strategy: RendererMountDisposeStrategy) => void
  /**
   * Apply the transactions addressed to this mount.
   *
   * Required, not optional: this is the only way a mount is ever told which model to show
   * (`LoadCue`), so a renderer without a sink is a viewport that can never load anything.
   * `ModelDriverCapabilities.cues` declares the kinds *beyond* that one — the ones a renderer may
   * refuse as `unsupported-cue`.
   */
  cues: CueSink
}

/**
 * The complete component contract a renderer publishes.
 *
 * Lets the host mount a renderer it has never imported, and lets a third-party renderer be validated
 * against the same description the first-party ones follow.
 */
export interface RendererMountComponentContract {
  props: RendererMountProps
  emits: RendererMountEmits
  exposed: RendererMountExposed
}

/**
 * The component a renderer hands over for this mount.
 *
 * Derived from the contract above rather than restating it, so the three halves have one source: Vue
 * checks the props it receives and the members its instance carries (`Component<props, exposed>`),
 * while `emits` — which Vue only observes at runtime, through the component's own `defineEmits` —
 * stays named in the contract.
 */
export type RendererMountComponent = Component<
  RendererMountComponentContract['props'],
  RendererMountComponentContract['exposed']
>

/** What a lazy `resolveMountComponent()` resolves to; `default` is what the host mounts. */
export interface RendererMountComponentModule {
  default: RendererMountComponent
}

/**
 * The lazy factory a `ModelDriverRuntime` exposes.
 *
 * A factory rather than a module path: nothing interprets a raw `.vue` at runtime, so the renderer
 * decides its own code-splitting and the host never resolves a specifier itself (`lifecycle.ts`).
 */
export type RendererMountComponentFactory = () => Promise<RendererMountComponentModule>
