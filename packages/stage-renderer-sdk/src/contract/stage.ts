/**
 * The stage mounting surface: what the host passes in, what it listens to, and
 * what it may call on a mounted renderer.
 *
 * Owner: the renderer implements a stage component (Vue, or an adapter that
 * satisfies this shape); the host mounts it and owns the container.
 *
 * Purpose: `RendererStage.vue` today statically imports all four scene
 * components and passes a hand-maintained union of props, while each renderer
 * exposes a different subset of methods that the host calls through optional
 * chaining. This file fixes the required surface and makes the optional parts
 * discoverable through the manifest's feature flags instead of through
 * `?.()` guessing.
 *
 * Known divergences this contract has to absorb (all four renderers today):
 *   | aspect            | Live2D        | VRM           | Spine        | MMD            |
 *   | ----------------- | ------------- | ------------- | ------------ | -------------- |
 *   | mouth input       | 0..100 → 0..1 | 0..1 (×0.75)  | 0..1 (×15)   | 0..1 (×0.7)    |
 *   | audio source      | no            | yes (wlipsync)| no           | declared, unused |
 *   | focus/gaze        | focusAt       | vector target | no           | cursorPosition |
 *   | companion input   | none          | none          | none         | textureMap     |
 *   | head pose         | missing       | yes           | yes          | yes            |
 *   | capture           | yes           | yes           | yes          | yes            |
 *   | render-target read| no            | yes           | no           | no             |
 * Normalizing the mouth input to 0..1 and moving the magic multipliers into each
 * renderer is the first concrete win this file enables.
 *
 * `companion input` is listed as a divergence only in order to remove it: an MMD
 * texture set is required to use the model at all, so under this contract it is
 * part of the payload carried by the asset handle and the renderer resolves its
 * own relative texture paths. It must not become a prop.
 *
 * A preview is not a prop either: it is any cue sent with `persistent: false`,
 * which also gives it a target surface, so a preview cannot animate the live
 * stage.
 */
import type { StageAssetHandle } from './assets'
import type { RendererCapabilityDescriptor, RendererCapabilityKind } from './capabilities'
import type { CueRejection, RendererCueKind } from './cues'
import type { RendererHostServices } from './host-services'
import type {
  HeadPose,
  ModelReferenceId,
  RendererFailure,
  RendererId,
  StagePoint,
  StageReadinessState,
  StageSurfaceKind,
  StageViewport,
} from './shared'

/**
 * User interaction mode.
 *
 * Purpose: the host currently derives this from a VRM store field and reuses it
 * for MMD and Spine, which is a cross-renderer state leak this contract removes.
 */
export type StageInteractionMode = 'tactile' | 'orbit' | 'drag' | 'positioning' | 'none'

/**
 * Mouth/lip-sync input.
 *
 * `openness` is normalized 0..1 for every renderer. `audioSource` is optional
 * because only some renderers can analyse audio directly; the rest must be
 * driven by `openness` alone.
 */
export interface StageMouthInput {
  openness: number
  audioSource?: AudioBufferSourceNode
}

export interface StageHitAreaEvent {
  name: string
  x: number
  y: number
  hovered: boolean
}

/**
 * Props every stage renderer must accept.
 *
 * `settings` is an opaque per-renderer bag so the host can forward renderer-owned
 * settings (theme hue, shadow toggles, idle/blink flags, physics switches,
 * mix duration, render scale...) without growing a union of props for each
 * renderer, which is how `RendererStage.vue` works today.
 */
export interface StageRendererProps {
  /** The asset to mount. `undefined` means "nothing selected". */
  asset?: StageAssetHandle
  /** Host-issued reference; opaque to the renderer, stable per model. */
  modelReferenceId?: ModelReferenceId
  /** Which renderer owns this mount; useful for shared host overlays. */
  rendererId?: RendererId
  /** Host-decided pause. Renderers must honour it and never self-pause. */
  paused: boolean
  viewport?: StageViewport
  interactionMode?: StageInteractionMode
  draggable?: boolean
  /** Continuous lip-sync stream, written per frame — which is why it is a prop. */
  mouth?: StageMouthInput
  /** Continuous pointer/gaze stream, same reasoning as `mouth`. */
  focusAt?: StagePoint
  /** Opaque renderer-owned settings. */
  settings?: Record<string, unknown>
  /**
   * Where this mount lives. Always known, because the host cannot mount a stage
   * without deciding it — so a renderer may rely on it, e.g. to skip physics and
   * post-processing on a settings preview while keeping them on the live stage.
   */
  surface: StageSurfaceKind
}

export interface StageRendererEmits {
  /** Readiness transitions, including `error` (see `StageReadinessState`). */
  'update:state': (state: StageReadinessState) => void
  'error': (failure: RendererFailure) => void
  'scale-change': (scale: number) => void
  'offset-change': (offset: StagePoint) => void
  'hit-area-hover': (hit: StageHitAreaEvent | null) => void
  'animation-finished': () => void
  'play-status': (status: { duration: number, key: string }) => void
  /** A cue could not be handled; lets the host fall back or explain. */
  'cue-rejected': (payload: { index: number, kind: RendererCueKind, reason: CueRejection }) => void
}

/**
 * Methods the host may call on a mounted renderer.
 *
 * `canvasElement` and `captureFrame` are required because the selfie/capture
 * pipeline and stage screenshots depend on them for every renderer. Everything
 * else is optional and must be advertised in the manifest's feature flags.
 */
export interface StageRendererExposed {
  canvasElement: () => HTMLCanvasElement | undefined
  captureFrame: () => Promise<Blob | null>
  /** Requires `features.headPose`; used to tether captions and the radial menu. */
  getHeadPose?: () => HeadPose | null
  /** Requires `features.renderTargetReadback`; used for alpha hit-testing. */
  readRenderTargetRegionAtClientPoint?: (clientX: number, clientY: number, radius: number) => unknown
  /**
   * Requires `features.nativeHandle`: an opaque escape hatch for
   * renderer-specific host overlays (Live2D's in-canvas speech bubble needs the
   * Pixi application).
   */
  nativeHandle?: () => unknown
  /** Stop everything that is playing; used on pause and teardown. */
  stopAll?: () => void
  /** Runtime truth for capabilities that could not be declared statically. */
  listCapabilities?: (kind?: RendererCapabilityKind) => RendererCapabilityDescriptor[]
}

/**
 * The complete component contract a renderer publishes.
 *
 * Purpose: lets the host mount a renderer it has never imported, and lets a
 * third-party renderer be validated against the same description the first-party
 * ones follow.
 */
export interface StageRendererComponentContract {
  props: StageRendererProps
  emits: StageRendererEmits
  exposed: StageRendererExposed
}

/**
 * A panel the renderer contributes to the host's settings surfaces.
 *
 * An array entry on the runtime object, with no `kind`: the renderer decides how
 * many panels it has and what they are called, and the host only lists them.
 */
export interface RendererPanelDeclaration {
  /** Stable within the renderer; the host uses it to remember the active tab. */
  id: string
  /** Tab title; translate it through `services.i18n`. */
  label: string
  /**
   * Surfaces this panel is worth mounting in; absent means all of them.
   *
   * Purpose: some panels only make sense somewhere — a physics-tuning panel has
   * nothing to do in the rehearsal room — and this saves the host from rendering a
   * tab that would be empty.
   */
  surfaces?: StageSurfaceKind[]
  /**
   * Lazy component factory.
   *
   * A factory rather than a module specifier on purpose: a string path would
   * require the renderer to already be built, because nothing can interpret a raw
   * `.vue` file at runtime.
   */
  component: () => Promise<{ default: unknown }>
}

/**
 * The panel contract: the renderer-provided UI for its own capabilities and
 * settings.
 *
 * Purpose: the renderer owns its capability record *and* the UI for it (labels,
 * usable/favourite toggles, idle selection, ACT mappings, outfit presets), so the
 * host mounts the renderer's own component instead of keeping per-format editors
 * in host code — `ModelCustomizer.vue` today is one host component with
 * per-renderer branches, a hardcoded 8-outfit cap and renderer-specific
 * side-effects.
 *
 * The same component is reused across surfaces and adapts from the `surface`
 * prop. Host obligations toward a panel:
 *   - **The host provides the frame** (title, tabs, scrolling, padding); the panel
 *     only fills the body.
 *   - **When the renderer is unavailable, the panel is not mounted at all.** The
 *     host shows that first and, when a snapshot exists, appends a read-only list
 *     built from its `vocabulary`. `readOnly` below covers the other case: the
 *     renderer *is* available but this mount must not edit.
 *   - **`@proj-airi/ui` is available** (as a peer, sharing the host's Vue
 *     instance and theme through `services.theme`), but a panel must not rely on
 *     the host's UnoCSS scan: built standalone, it needs its own styling.
 */
export interface RendererPanelProps {
  /**
   * The model this panel edits.
   *
   * A panel never writes the snapshot itself: only the mounted instance does
   * (`RendererStateTransferPort.writeSnapshot`), so two windows cannot race on
   * `revision`.
   */
  modelReferenceId: ModelReferenceId
  /** Which surface the panel is rendered in, so it can adapt its own layout. */
  surface: StageSurfaceKind
  /**
   * Readiness of the mount this panel is attached to.
   *
   * The panel renders its own loading state from this, because capabilities can
   * be undiscoverable until the model has loaded (VRM only reads its expression
   * manager afterwards) and only the panel knows what it is able to show while
   * it waits.
   */
  readiness: StageReadinessState
  /**
   * Mounted for viewing only.
   *
   * The panel must not change the renderer's stored state for the model, so
   * nothing it does can reach the snapshot. Transient previews are still allowed:
   * those are cues sent with `persistent: false`, which by definition do not
   * persist.
   */
  readOnly?: boolean
  /** The same service container the renderer receives at activation. */
  services: RendererHostServices
}

export interface StageMountRequest {
  surface: StageSurfaceKind
  rendererId: RendererId
  asset: StageAssetHandle
  modelReferenceId?: ModelReferenceId
  viewport: StageViewport
  interactionMode?: StageInteractionMode
}

export interface StageMountResult {
  /** Present when mounting failed; the host keeps the previous mount alive. */
  failure?: RendererFailure
  exposed?: StageRendererExposed
}
