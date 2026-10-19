/**
 * Shared vocabulary for the model driver contract.
 *
 * Owner: both sides. Every other file in this SDK reuses these names, so they stay free of
 * renderer-specific concepts (no `format`, no `live2d`, no `vrm`).
 */

/** Stable identity of a model driver, e.g. `ai.moeru.airi.stage.live2d`. Provided by the driver. */
export type ModelDriverId = string

/** Cancels a subscription previously registered with the host. */
export type Unsubscribe = () => void

export type MaybePromise<T> = T | Promise<T>

/**
 * Monotonic counter incremented on every mount/load attempt.
 *
 * A renderer MUST reject an async completion whose nonce is stale.
 */
export type OperationNonce = number

/** Compatibility indicator. */
export interface ModelDriverContractVersion {
  major: number
  minor: number
}

/**
 * Version of the contract defined by this package.
 *
 * Exists so the compatibility check does not require AIRI to restate the number.
 */
export const MODEL_DRIVER_CONTRACT_VERSION: ModelDriverContractVersion = { major: 0, minor: 1 }

/**
 * Readiness of one renderer mount, reported through the mount's `state-change` emit.
 *
 * The values are strings on purpose. Readiness crosses `BroadcastChannel` and IPC and is
 * compared by the host, so the values are part of the contract: numeric ordinals would put
 * member order into it and would force a plugin the host never imports to know the
 * numbering. Written out, any renderer — in any language — can produce them.
 */
export enum RendererMountReadinessState {
  /** Nothing is mounted. */
  UNMOUNTED = 'unmounted',
  /** The renderer is being mounted (initializing). */
  MOUNTING = 'mounting',
  /** There is no model mounted and the mount is ready to load one. */
  READY_FOR_MODEL = 'ready-for-model',
  /** A model is being loaded. */
  LOADING_MODEL = 'loading-model',
  /** A model is loaded successfully. */
  MODEL_LOADED = 'model-loaded',
  /** A model cannot be loaded because of the model itself. */
  MODEL_ERROR = 'model-error',
  /** An error occurred because of the mount itself. */
  MOUNT_ERROR = 'mount-error',
}

export enum ContractFailureCode {
  /**
   * The renderer cannot read this input at all: it has no path for the payload (unreadable,
   * truncated, a container it cannot open).
   *
   * Declining unified import altogether is expressed by not implementing `probe`
   * (`ModelDriverCapabilities.probe`); declining a single input is a successful probe whose
   * `confidence` is low and whose `blockingFindings` say why.
   */
  UNSUPPORTED_INPUT = 'unsupported-input',
  /** The package is structurally invalid; `details` should carry the findings. */
  INVALID_PACKAGE = 'invalid-package',
  /** The referenced asset is gone from the renderer's own storage. */
  ASSET_MISSING = 'asset-missing',
  /** The asset exists but failed to load or parse (moc3, glTF, skel, pmx...). */
  ASSET_CORRUPT = 'asset-corrupt',
  /**
   * The model driver is disabled, uninstalled, or failed to activate.
   *
   * Reported by the host, which is the side that knows a driver is absent — an instance
   * cannot report its own absence.
   */
  RENDERER_UNAVAILABLE = 'renderer-unavailable',
  /** A host service the renderer requires was not provided at activation. */
  HOST_SERVICE_MISSING = 'host-service-missing',
  /**
   * The work was abandoned, and nothing took its place: the mount was disposed or the
   * renderer disabled while the operation was in flight, or the caller cancelled it.
   *
   * Deliberately not `CueRejection.SUPERSEDED`, which is the normal case — a newer
   * transaction for the same mount made this one moot, the send still succeeds, and only
   * that slot goes unapplied. A renderer MUST NOT report one as the other.
   */
  ABORTED = 'aborted',
  /** An unexpected failure inside the renderer, with nothing more specific to report. */
  INTERNAL = 'internal',
}

export interface ContractFailure {
  code: ContractFailureCode
  message: string
  /** Renderer-specific evidence (validator findings, parser output). Opaque to AIRI. */
  details?: unknown
  /** The error this failure came from, when there was one. Opaque to AIRI, carried for diagnostics. */
  cause?: unknown
  /**
   * A **hint, not a policy**: the renderer's guess at whether repeating the same operation
   * could succeed where this attempt did not.
   *
   * AIRI owns everything about retrying that a caller sees, so nothing may depend on this
   * value: a renderer MUST NOT withhold work it could do because it set `false`, and the host
   * MUST NOT turn `true` into an automatic loop. Absent means the renderer has no opinion,
   * never "do not retry".
   */
  retryable?: boolean
}

/**
 * Result envelope for every contract call that can fail.
 *
 * The error branch means **attempted and failed** — never "refused", never "nothing to do".
 * "There is nothing to remove", "I do not recognise this input" and "I may choose not to
 * answer" are successes whose value says so, the same rule `CueRejection` follows.
 */
export type ContractResult<T>
  = | { ok: true, value: T }
    | { ok: false, error: ContractFailure }

/**
 * Which host surface a mount lives on.
 *
 * Cues target a surface too: the host routes a cue only to the matching mount, so a settings
 * preview never animates the live stage.
 */
export enum RendererMountSurfaceKind {
  STAGE = 'stage',
  PREVIEW = 'preview',
  ACTOR = 'actor',
  REHEARSAL = 'rehearsal',
}

/**
 * A point inside a mount's **drawing box**, in CSS pixels measured from that box's top-left
 * corner: exactly `clientX - box.getBoundingClientRect().left`.
 *
 * The box is the element the host mounted the renderer into, the same box
 * `RendererMountProps.viewport` describes.
 *
 * AIRI converts the raw DOM event exactly **once**, by subtracting the box rectangle, and
 * applies no other mapping: no `devicePixelRatio` multiplication, no normalization into the
 * box's width and height, no translation into the model's own space. Each of those depends on
 * how the renderer drew, so the renderer does them. A value here may fall outside the box: a
 * captured gesture keeps reporting after the pointer leaves, so negative and over-range
 * coordinates are legitimate.
 *
 * Nothing in the contract is measured against the window, the page, or a canvas backing
 * store. This one space covers `RendererPointerEvent.point`,
 * `RendererMountExposed.occupiesPoint`, `RendererMountExposed.hitTest`, `GazeCue.point` and
 * `HeadPose.position`.
 */
export interface RendererMountPoint {
  x: number
  y: number
}

/**
 * The rectangle the host gives the renderer to draw into, in CSS pixels.
 *
 * This is the mount's **drawing box**: the renderer's own drawing surface fills it, and it is
 * the box every `RendererMountPoint` is measured against. Everything inside it — how the model
 * is fitted, at what resolution it renders, where text goes — is the renderer's.
 */
export interface RendererMountViewport {
  width: number
  height: number
  /**
   * Host pixel-density hint (today: `window.devicePixelRatio`), so a renderer can size its own
   * backing store before it has measured anything. A hint, never a factor already applied to
   * a `RendererMountPoint`.
   */
  devicePixelRatio?: number
}

/**
 * Head pose reported by a renderer so the host can tether overlays (captions, radial menu) to
 * the avatar's head.
 *
 * An optional capability, never an assumed one: `ModelDriverCapabilities.headPose`.
 */
export interface HeadPose {
  /**
   * Where the crown of the head is, in `RendererMountPoint` space.
   *
   * Produced by the renderer, the only side that knows how it drew: it converts out of its own
   * model space itself, and the host adds the canvas rectangle when it wants page coordinates.
   */
  position: RendererMountPoint
  /**
   * Head rotation in radians, as this renderer reads its own head bone.
   *
   * An axis this rig cannot express is `null`, never `0`: zero is a real rotation reading, so a
   * renderer MUST NOT use it to mean "unknown". A renderer with no head bone at all answers
   * `null` from `getHeadPose` instead of three null axes.
   */
  yaw: number | null
  pitch: number | null
  roll: number | null
  /**
   * Approximate visible model height in CSS pixels, in the same space as `position`, or `null`
   * when this renderer cannot estimate it.
   *
   * Advisory: the host scales head-tethered overlays with it and has its own fallback for a
   * missing or unreasonable value, so a renderer that cannot measure the model MUST say so
   * rather than invent a fraction of the viewport.
   */
  modelHeightPx: number | null
}

/**
 * A model's stored thumbnail.
 *
 * **Both sides** handle this shape: a renderer *produces* one (`ModelProvider.preview`, or
 * `ModelDescriptor.preview` when it already has it) and keeps none, while the catalog has to
 * render with nothing mounted and with the owning driver unavailable or uninstalled — so AIRI
 * stores its own copy.
 *
 * It lives here rather than among AIRI's own records (`references.ts`) for exactly that reason:
 * a renderer has to construct one, so it is a value both sides share.
 *
 * Stored as a data URL rather than a `Blob`, because this value is persisted inside a reactive
 * record.
 */
export interface ModelPreview {
  /** The encoded image. Required: a preview AIRI holds is an image. */
  dataUrl: string
  /** Intrinsic pixel size, so a catalog can lay a row out before the image decodes. */
  width?: number
  height?: number
}
