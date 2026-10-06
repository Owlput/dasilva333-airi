/**
 * Runtime cues: everything AIRI asks the avatar to *do* while it is on stage.
 *
 * Owner: AIRI (and the character card / ACT tokens) send cues; the renderer
 * implements a sink and reports whether it handled each one.
 *
 * Purpose: today each renderer invented its own vocabulary, transport and
 * return shape for the same four intents:
 *   - VRM exposes `triggerEmotion` / `triggerMotion` / `triggerVfx` /
 *     `setMeshVisibility` and mirrors them over a `airi-stores-live2d` channel;
 *   - Live2D exposes `triggerEmotion` (returning a boolean) and `triggerMotion`
 *     plus reactive `currentMotion` / `activeExpressions` / `modelParameters`;
 *   - Spine uses `currentAnimation` / `playOneShotAnimation` /
 *     `selectVariantAndSkin` over `airi-stores-stage-ui-spine`;
 *   - MMD uses `previewExpression` / `currentMotion` / `playOneShotAction` over
 *     `airi-stores-stage-ui-mmd`.
 * One vocabulary plus one ack shape lets the host, the ACT pipeline and the
 * settings UI stop branching per renderer.
 *
 * Three rules shape everything below:
 *   - an envelope is a **transaction**: its cues are applied together, never in
 *     sequence, and the ack reports per-slot outcomes aligned by index;
 *   - the renderer owns its own state and its own settings UI, so a cue states
 *     an *intent*, never a mechanism;
 *   - a cue AIRI cannot decompose into others (an opaque outfit preset) is
 *     forwarded verbatim instead of being translated.
 */
import type { RendererCapabilityKind } from './capabilities'
import type {
  MaybePromise,
  ModelReferenceId,
  OperationNonce,
  RendererId,
  RendererResult,
  StagePoint,
  StageSurfaceKind,
  StageTransform,
  Unsubscribe,
} from './shared'

export type RendererCueKind
  = | 'emotion'
    | 'expression'
    | 'motion'
    | 'vfx'
    /** Raw mesh/material visibility, driven by the host's calibration UI. */
    | 'mesh'
    /** Raw numeric parameter (Live2D), driven by the host's calibration UI. */
    | 'parameter'
    /** Kind-agnostic state assignment, addressed by capability kind. */
    | 'selection'
    /** A renderer-managed preset AIRI only forwards. */
    | 'preset'
    | 'viseme'
    | 'gaze'
    | 'view'
    | 'reset'
    | 'reload'

/** Where a cue came from. Renderers may treat agent and user cues differently. */
export type CueSource = 'user' | 'agent' | 'card' | 'renderer' | 'host' | 'external'

export interface CueEnvelope<C extends RendererCue = RendererCue> {
  /**
   * One transaction; a single cue is the length-1 case.
   *
   * Members are applied together, never in sequence — sequencing is deliberately
   * not expressible. Grouping matters because a multi-part change (trying on an
   * outfit = meshes + expressions) must not be half-applied, and because
   * `nonce`, `persistent` and `dropIfNotReady` then describe the whole change
   * rather than three unrelated ones.
   */
  cues: C[]
  source: CueSource
  /**
   * `false` = preview: apply transiently, never persist, never touch the
   * renderer's saved state or its snapshot revision. Default `true`.
   *
   * Meaningless for `viseme` / `reset` / `reload`.
   */
  persistent?: boolean
  nonce: OperationNonce
  /** Epoch milliseconds, so late deliveries can be discarded by age. */
  at: number
  target?: {
    rendererId?: RendererId
    modelReferenceId?: ModelReferenceId
    /**
     * The host delivers only to the mount of this surface, so a preview never
     * animates the live stage. A cue without a surface is never delivered to a
     * `preview` mount.
     */
    surface?: StageSurfaceKind
  }
}

/**
 * Why a cue was not handled.
 *
 * Purpose: renderers currently answer with `void`, `boolean`, or nothing at all,
 * so the host cannot tell "played" from "I have no such motion" and ends up
 * duplicating fallback logic per renderer.
 */
export type CueRejection
  = | 'unsupported-cue'
    /** The renderer has no such expression, motion, mesh, parameter or preset. */
    | 'unknown-key'
    /** Still loading, or no model is mounted. */
    | 'renderer-not-ready'
    | 'no-model'
    /** Ignored by policy: paused, hidden, reduced motion, or a preview mode. */
    | 'suppressed-by-mode'
    | 'busy'

export interface CueAck {
  /**
   * Index-aligned with `CueEnvelope.cues`: exactly one slot per cue.
   * `undefined` = that slot was applied, otherwise it was not applied and the
   * reason says why.
   *
   * A wholesale rejection (not ready, no model, suppressed by mode) fills every
   * slot with the same reason. A transport-level failure never reaches here — it
   * is the `RendererResult` error branch instead.
   */
  reason: (CueRejection | undefined)[]
  /**
   * Convenience: `reason.every(r => r === undefined)`.
   *
   * NOTICE: `false` does **not** mean "nothing happened"; it means "not every
   * slot was applied". A partially applied transaction reports `false` and a
   * mixed `reason` array.
   */
  handled: boolean
}

export interface CueSendOptions {
  source?: CueSource
  target?: CueEnvelope['target']
  /** Drop the whole transaction instead of queueing it when the renderer is not ready. */
  dropIfNotReady?: boolean
}

/**
 * The cue transport.
 *
 * Deliberately agnostic about how it crosses boundaries: in-process for the
 * mounted stage, `BroadcastChannel` between windows, IPC for remote actors.
 * Today those are three separate per-renderer implementations with different
 * channel names, and a window that forgets to instantiate the matching store
 * silently drops every cue.
 */
export interface RendererCueChannel {
  send: (cues: RendererCue | RendererCue[], options?: CueSendOptions) => Promise<RendererResult<CueAck>>
  /** Register a sink. A renderer registers one; the host may register several. */
  subscribe: (handler: RendererCueSink) => Unsubscribe
}

export interface RendererCueSink {
  handle: (envelope: CueEnvelope) => MaybePromise<RendererResult<CueAck>>
}

/**
 * ACT-level emotion. AIRI owns the emotion vocabulary and the per-model mapping
 * (today `DisplayModel.emotionMappings`, projected into each renderer's store by
 * card sync); the renderer only resolves the name to its own key.
 */
export interface EmotionCue {
  kind: 'emotion'
  emotion: string
  intensity?: number
  /** `0` means "reset to neutral immediately" (Live2D relies on this today). */
  durationMs?: number
}

/** Direct addressing of one renderer-native expression/morph. */
export interface ExpressionCue {
  kind: 'expression'
  key: string
  /** Normalized 0..1; the renderer maps to its own weight range. */
  value?: number
  /**
   * How long to hold it before handing the expression back to the renderer's
   * saved state. Expressions and poses have no timeline, so a transient
   * (`persistent: false`) one needs this; the renderer may apply a default when
   * it is absent.
   */
  resetAfterMs?: number
}

/**
 * Play a motion/animation.
 *
 * `key` is the renderer-native key from a capability descriptor; `group`/`index`
 * exist because Live2D addresses motions that way while VRM/MMD/Spine use names.
 *
 * Repetition is one number rather than a `loop` boolean plus a separate
 * `oneShot` flag: the old pair contradicted itself (Spine accepts
 * `oneShot: true, loop: true`, i.e. "interject and keep looping") and "play
 * once" is simply `repeat: 1`. Whether a transient playback replaces the saved
 * motion is the envelope's `persistent`, not a motion-level flag.
 */
export interface MotionCue {
  kind: 'motion'
  key?: string
  group?: string
  index?: number
  /**
   * `-1` = forever, `1` = once, `n` = n times.
   * `undefined` = honour the asset's own declaration (VRMA `loop`, a Live2D
   * motion's `Loop`), because the loop intent is authored in the asset.
   */
  repeat?: number
  crossfadeMs?: number
}

/** Visual effect trigger (VRM auras today). */
export interface VfxCue {
  kind: 'vfx'
  effect: string
  durationMs?: number
}

/**
 * Raw mesh/material visibility.
 *
 * Purpose: the host's own editing surfaces drive the model directly while a
 * mapping is being authored — `EmotionCalibrationStudio.vue` today reaches into
 * four renderer stores through hardcoded branches. These are the cues that UI
 * sends once those branches are gone.
 */
export interface MeshCue {
  kind: 'mesh'
  key: string
  value: boolean
}

/** Raw numeric parameter (Live2D `ParamAngleX` and friends), same calibration path. */
export interface ParameterCue {
  kind: 'parameter'
  key: string
  value: number
  resetAfterMs?: number
}

/**
 * Kind-agnostic state assignment.
 *
 * Purpose: several mechanisms hide behind one user intent — Live2D `change_cos`
 * (whose DSL port is currently a silent no-op), VRM `setMeshVisibility`, Spine
 * `selectVariantAndSkin`, MMD morph swaps, and the card-level outfit system.
 * Addressing capability keys by kind keeps the renderer's own vocabulary
 * (`altModel` / `outfitGroup` / `outfitStyle` / `mesh`) in one place instead of
 * hardcoding one renderer's mechanism.
 *
 * `value` is what makes a *set* expressible, including its "off" side: Spine's
 * per-model `activeAnimations` is a `Record<name, boolean>` and VRM's mesh
 * visibility is an explicit boolean, neither of which an additive list can
 * express.
 */
export interface SelectionCue {
  kind: 'selection'
  select: Array<{ capabilityKind: RendererCapabilityKind, key: string, value?: number | boolean }>
}

/**
 * Apply a renderer-managed preset.
 *
 * Purpose: an outfit stored on a character card is a preset only the renderer
 * understands, so AIRI cannot translate it into other cues. It forwards
 * `payload` verbatim (the same opaque value it persisted) and the renderer
 * decides what it means. Without this, the Control Strip's quick outfit switch
 * would have to know a renderer's private vocabulary.
 */
export interface PresetCue {
  kind: 'preset'
  presetId: string
  /** The renderer's own preset body, exactly as AIRI stored it. */
  payload?: unknown
}

/**
 * Lip-sync openness.
 *
 * `openness` is normalized 0..1 on purpose. Today the host sends a 0..100 value
 * that Live2D clamps to 0..1 internally while VRM multiplies by 0.75 and MMD by
 * 0.7 — three magic scales for one signal.
 */
export interface VisemeCue {
  kind: 'viseme'
  openness: number
  source?: 'audio' | 'text' | 'manual'
}

/** Where the avatar looks. */
export interface GazeCue {
  kind: 'gaze'
  mode: 'none' | 'pointer' | 'camera' | 'target'
  point?: StagePoint
  followSpeed?: number
}

/**
 * Stage transform, normally driven by the user dragging/zooming.
 *
 * The value itself is renderer-owned per-model state; the host only reports the
 * user's intent (and reads the renderer's `scale-change` / `offset-change`
 * emits back), which is why there is no `transform` prop any more.
 */
export interface ViewCue extends StageTransform {
  kind: 'view'
}

/**
 * Hand an expression/pose back to the renderer's saved state.
 *
 * `selection` is what a previewed outfit or alt model reverts through, since a
 * transient (`persistent: false`) selection has no duration of its own.
 */
export interface ResetCue {
  kind: 'reset'
  scope: 'expression' | 'motion' | 'pose' | 'selection' | 'all'
}

/**
 * The renderer asks the host to re-resolve and re-mount the current model.
 *
 * Purpose: replaces the renderer→host side channel where a renderer store calls
 * `shouldUpdateView()` and the host responds by re-running `updateStageModel()`.
 */
export interface ReloadCue {
  kind: 'reload'
  reason?: string
}

export type RendererCue
  = | EmotionCue
    | ExpressionCue
    | MotionCue
    | VfxCue
    | MeshCue
    | ParameterCue
    | SelectionCue
    | PresetCue
    | VisemeCue
    | GazeCue
    | ViewCue
    | ResetCue
    | ReloadCue
