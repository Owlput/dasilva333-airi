/**
 * Shared vocabulary for the stage renderer contract.
 *
 * Owner: both sides. Every other file in this SDK reuses these names, so they
 * stay free of renderer-specific concepts (no `format`, no `live2d`, no `vrm`).
 *
 * Purpose: give the host and an externally installed renderer plugin one
 * language for identity, failure, readiness and geometry, so neither side has to
 * import the other's implementation in order to talk.
 */

/**
 * Stable identity of a renderer plugin, e.g. `ai.moeru.airi.stage.live2d`.
 *
 * Purpose: the only handle AIRI keeps for a renderer. Discovery, enable/disable,
 * asset routing and cue routing are all keyed by it.
 */
export type RendererId = string

/**
 * Identity of one asset *inside* one renderer plugin.
 *
 * Purpose: lets a renderer name its own assets however it likes (UUID, zip path,
 * OPFS directory, remote URL) without AIRI interpreting the value. Only the
 * owning renderer may resolve it.
 */
export type RendererAssetId = string

/**
 * Identity AIRI mints for a model reference (today the card's `displayModelId`,
 * e.g. `display-model-<nanoid>`).
 *
 * Purpose: cards, cloud backups and cross-window state reference *this*, never a
 * renderer asset id — so reinstalling, replacing or disabling a renderer cannot
 * silently repoint a card at a different asset.
 */
export type ModelReferenceId = string

/**
 * Opaque asset class declared by a renderer, e.g. `avatar.2d.live2d-zip`.
 *
 * Purpose: replaces AIRI's closed `DisplayModelFormat` enum. AIRI may display,
 * store and route these strings but must never switch on them; only the renderer
 * that declared a kind may interpret it.
 */
export type AssetKind = string

/** Cancels a subscription previously registered with the host. */
export type Unsubscribe = () => void

export type MaybePromise<T> = T | Promise<T>

export interface Disposable {
  dispose: Unsubscribe
}

/**
 * Monotonic counter incremented on every mount/load attempt.
 *
 * Purpose: renderers must reject async completions whose nonce is stale. Today
 * each component invents its own guard (a `currentLoadId` counter in
 * `stage-ui-three/.../VRMModel.vue`, `isUnmounted` flags elsewhere), and a stale
 * completion is a common source of double-mounted scenes.
 */
export type OperationNonce = number

export interface RendererContractVersion {
  major: number
  minor: number
}

/**
 * Version of the contract defined by this package.
 *
 * Purpose: a renderer plugin and AIRI negotiate compatibility through the plugin
 * host before activation, instead of discovering breakage at the first cue.
 */
export const RENDERER_CONTRACT_VERSION: RendererContractVersion = { major: 0, minor: 1 }

/**
 * Readiness of a stage renderer, reported today through the stage component's
 * `v-model:state`.
 *
 * Purpose: all four surfaces declare `'pending' | 'loading' | 'mounted'`, but
 * `loading` is never actually assigned, only VRM and MMD emit an `error` (Live2D
 * and Spine report nothing at all), and MMD also resets the surface to
 * `'pending'` in the same catch — so the host cannot distinguish "still loading"
 * from "gave up". `idle` and `error` are added by this contract to make that
 * distinction expressible.
 */
export type StageReadinessState = 'idle' | 'pending' | 'loading' | 'mounted' | 'error'

export type RendererFailureCode
  /** The renderer cannot host this input at all (wrong kind, unreadable input). */
  = | 'unsupported-input'
    /** The package is structurally invalid; `details` should carry the findings. */
    | 'invalid-package'
    /** The referenced asset is gone from the renderer's own storage. */
    | 'asset-missing'
    /** The asset exists but failed to load or parse (moc3, glTF, skel, pmx...). */
    | 'asset-corrupt'
    /** The renderer plugin is disabled, uninstalled, or failed to activate. */
    | 'renderer-unavailable'
    /** A host service the renderer requires was not provided at activation. */
    | 'host-service-missing'
    /** Superseded by a newer nonce, or explicitly cancelled. */
    | 'aborted'
    | 'internal'

export interface RendererFailure {
  code: RendererFailureCode
  message: string
  /** Renderer-specific evidence (validator findings, parser output). Opaque to AIRI. */
  details?: unknown
  cause?: unknown
  retryable?: boolean
}

/**
 * Result envelope for every contract call that can fail.
 *
 * Purpose: renderers currently signal failure by throwing, by returning `null`,
 * or by logging and continuing — the host's built-in model installer, for
 * example, stores whatever a failed `fetch` returned because it never checks
 * `response.ok`. One envelope makes success and failure equally explicit at the
 * boundary.
 */
export type RendererResult<T>
  = | { ok: true, value: T }
    | { ok: false, error: RendererFailure }

/**
 * Where the stage is being rendered, which changes host expectations.
 *
 * Lives here rather than in `stage.ts` because cues target a surface too: the
 * host routes a cue only to the matching mount, so a settings preview never
 * animates the live stage.
 */
export type StageSurfaceKind = 'stage' | 'preview' | 'actor' | 'rehearsal'

/** Screen-space point in CSS pixels. */
export interface StagePoint {
  x: number
  y: number
}

/** Viewport the host gives the renderer to draw into. */
export interface StageViewport {
  width: number
  height: number
  /** Host pixel-density hint (today: `window.devicePixelRatio`). */
  devicePixelRatio?: number
}

/**
 * User-adjustable stage transform.
 *
 * Purpose: unify the four renderers' overlapping inputs. Today all four take
 * `scale`/`xOffset`/`yOffset`, but rotation is only readable from a renderer's
 * own store (MMD), and per-model transforms are kept by the host in a separate
 * positioning store, so ownership is ambiguous.
 */
export interface StageTransform {
  scale?: number
  xOffset?: number | string
  yOffset?: number | string
  rotationY?: number
}

/**
 * Head pose reported by a renderer so the host can tether overlays (captions,
 * radial menu) to the avatar's head.
 *
 * Purpose: this shape is copy-pasted in three renderers today and missing in the
 * fourth (Live2D), so the radial menu silently degrades there. Here it is an
 * explicitly optional capability instead of an assumed one.
 */
export interface HeadPose {
  screenX: number
  screenY: number
  yaw: number
  pitch: number
  roll: number
  modelHeightPx: number
}
