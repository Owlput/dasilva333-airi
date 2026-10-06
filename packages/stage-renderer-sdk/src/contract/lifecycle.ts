/**
 * Renderer activation and stage lifecycle.
 *
 * Owner: the renderer plugin implements `RendererPluginRuntime`; the host
 * implements the registry and drives the lifecycle.
 *
 * Purpose: today a renderer is "whatever the host statically imported". There is
 * no activation step, no way to be disabled, no place to report "I am running
 * degraded", and no agreed teardown semantics:
 *   - no renderer in this workspace handles `webglcontextlost`, so context loss
 *     can only be recovered by remounting the whole component;
 *   - Live2D and Spine force `window.location.reload()` on HMR dispose;
 *   - VRM needs a deep/shallow dispose distinction (keeping the parsed VRM alive
 *     across re-renders while releasing the WebGL resources) that the host
 *     currently cannot express;
 *   - pause and visibility are host decisions, but each renderer reads them
 *     differently (a prop for some, nothing for others).
 * Activating explicitly, reporting readiness and declaring a dispose strategy
 * turns all of that into contract instead of folklore.
 */
import type { RendererAssetProvider } from './assets'
import type { RendererCueSink } from './cues'
import type { RendererHostServices } from './host-services'
import type { RendererManifest } from './manifest'
import type {
  AssetKind,
  RendererFailure,
  RendererId,
  RendererResult,
  StageReadinessState,
  Unsubscribe,
} from './shared'
import type { RendererPanelDeclaration } from './stage'

/**
 * The object a renderer plugin exposes to the host.
 *
 * The host obtains it from the plugin's runtime entry (`manifest.entry.runtime`)
 * and never imports renderer internals directly.
 */
export interface RendererPluginRuntime {
  readonly manifest: RendererManifest

  /**
   * Called once when the host enables this renderer.
   *
   * Must not mount anything on stage; activation only wires services, checks
   * requirements (globals, WASM, OPFS, license) and reports degradations.
   */
  activate: (services: RendererHostServices) => Promise<RendererResult<RendererActivationReport>>

  /** Called when disabled or unloaded; must release services and storage handles. */
  deactivate?: () => Promise<void>

  /** Asset ownership. Required for every renderer that hosts models. */
  readonly assets: RendererAssetProvider

  /** Cue handling for a mounted stage. */
  readonly cues: RendererCueSink

  /**
   * Resolve the stage component lazily.
   *
   * Purpose: this is what makes opt-out real. Today `RendererStage.vue` imports
   * all four scenes statically, so declaring a renderer unwanted still ships its
   * code.
   */
  resolveStageComponent: () => Promise<StageRendererComponentFactory>

  /**
   * Panels this renderer contributes, in the order the host should present them.
   *
   * Declared here rather than as manifest entry strings for the same reason the
   * stage component is: nothing can interpret a raw `.vue` at runtime, so a string
   * path would only work for an already-built renderer. `manifest.entry.*` strings
   * belong to the plugin loader, which is deliberately out of scope here.
   */
  readonly panels?: RendererPanelDeclaration[]

  /** Cheap, synchronous answer used before asking the provider anything. */
  canHost: (kind: AssetKind) => boolean
}

/**
 * Framework-agnostic component factory.
 *
 * Typed as `unknown` on purpose: this package describes the contract, not Vue.
 * The host adapts whatever the renderer returns to its own rendering layer.
 */
export type StageRendererComponentFactory = () => unknown

/**
 * Result of activation.
 *
 * Purpose: lets a renderer say "I work, but without OPFS caching" or "I am
 * missing the Cubism Core global", so the host can hide the affected UI instead
 * of failing at the first model load.
 */
export interface RendererActivationReport {
  missingRequirements?: string[]
  /** Features the renderer had to disable; keys must exist in `manifest.features`. */
  degradedFeatures?: string[]
  warnings?: string[]
}

/**
 * How thoroughly a renderer must be torn down when the mounted model changes.
 *
 * `shallow` keeps parsed/GPU resources alive for a fast re-mount (VRM relies on
 * this to avoid re-downloading and re-parsing on every Vue re-render),
 * `deep` releases everything.
 */
export type StageDisposeStrategy = 'shallow' | 'deep'

export interface StageLifecycleEvents {
  onReadiness: (state: StageReadinessState, failure?: RendererFailure) => void
  /** First real frame presented; the host uses it to hide loading UI. */
  onFirstFrame?: () => void
  /** The renderer lost its GPU context and needs a remount. */
  onContextLost?: () => void
  onContextRestored?: () => void
  onDisposed?: () => void
}

/**
 * What the host must implement so renderers can be discovered and toggled.
 *
 * Purpose: the workspace already has plugin infrastructure with
 * enable/load/unload IPC; this is the renderer-shaped view of it, so the stage
 * can ask "which renderers are enabled" without depending on the plugin SDK
 * itself (which the renderer package must not import).
 */
export interface RendererHostRegistry {
  list: () => RendererId[]
  isEnabled: (rendererId: RendererId) => boolean
  get: (rendererId: RendererId) => RendererPluginRuntime | undefined
  /** Fired when a renderer is enabled, disabled, installed or updated. */
  onChange: (handler: () => void) => Unsubscribe
}
