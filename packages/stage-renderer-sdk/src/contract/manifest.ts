/**
 * What a renderer plugin declares about itself.
 *
 * Owner: the renderer plugin implements this; AIRI consumes it at registration
 * and activation.
 *
 * Purpose: replace AIRI's closed `DisplayModelFormat` enum and the per-format
 * branches built on it (package repair, preview generation, capability parsing,
 * asset storage naming, renderer selection) with an open declaration that AIRI
 * stores and routes but never interprets.
 */
import type { RendererCueKind } from './cues'
import type { AssetKind, RendererContractVersion, RendererId } from './shared'

export interface RendererManifest {
  /** Stable identity; also the key for enable/disable and cue routing. */
  id: RendererId
  /** Human-facing name for settings and pickers. */
  name: string
  version: string
  /** Contract revision this plugin was built against. */
  contract: RendererContractVersion
  /**
   * Opaque asset classes this renderer can host, e.g. `avatar.2d.live2d-zip`.
   * A renderer may declare more than one (Live2D accepts both a zip and a
   * directory today); a kind may also be declared by more than one renderer,
   * which is what makes renderer replacement possible.
   */
  kinds: AssetKind[]
  /** Which optional parts of this SDK the plugin implements. */
  features: RendererFeatures
  /** What must exist in the runtime before the plugin can activate. */
  requirements: RendererRequirements
  /** How the host reaches the plugin's code. */
  entry: RendererEntryPoints
}

export interface RendererFeatures {
  /**
   * Participates in unified import: the host asks every enabled renderer
   * whether it recognises a dropped file and arbitrates by confidence.
   *
   * Purpose: keeps "drop a package and AIRI figures out what it is" working once
   * per-format detection stops living in the host.
   */
  probe?: boolean
  /** Can (re)generate a thumbnail for one of its assets. */
  preview?: boolean
  /**
   * When capabilities can be enumerated.
   *
   * Purpose: this is a real difference between renderers, not a detail. Live2D
   * and Spine can be enumerated from the package bytes; VRM only knows its
   * expressions after the model is loaded and the expression manager exists.
   * The host must be able to tell the two cases apart when rendering settings.
   */
  capabilityDiscovery?: CapabilityDiscoveryMode
  /** Can export/import an asset as an opaque bundle for backup and restore. */
  assetTransfer?: boolean
  /** Cue families the renderer understands. */
  cues?: RendererCueKind[]
  /** Reports head pose for head-tethered overlays. */
  headPose?: boolean
  /** Can render into an offscreen target and read a region back (VRM hit-testing). */
  renderTargetReadback?: boolean
  /** Exposes an opaque native handle for renderer-specific overlays. */
  nativeHandle?: boolean
}

/**
 * `static`: enumerate from the package without loading it.
 * `runtime`: only after a model is mounted.
 * `none`: the renderer has no capability model at all.
 */
export type CapabilityDiscoveryMode = 'static' | 'runtime' | 'none'

export interface RendererRequirements {
  /** Needs a WebGL(2) context. */
  webgl?: 1 | 2 | false
  /** Needs a WebAssembly runtime. */
  wasm?: boolean
  /** Needs an origin-private file system. */
  opfs?: boolean
  /** Spawns workers. */
  worker?: boolean
  /** Needs a live `AudioContext` (lip sync, beat sync). */
  audioContext?: boolean
  /** Needs a DOM canvas of its own. */
  dom?: 'canvas' | 'none'
  /**
   * Globals the host must install before activation.
   *
   * Purpose: replaces "the app's index.html happens to include a script tag".
   * Live2D's Cubism Core is loaded that way today and the plugin cannot install
   * itself without it.
   */
  globalScripts?: string[]
  /** Third-party license the user must accept before the renderer is usable. */
  license?: 'spine-editor' | 'live2d-cubism' | 'none'
  /** Rough persistent-storage appetite, for the host's quota UI. */
  storageHintBytes?: number
}

export interface RendererEntryPoints {
  /**
   * Module specifier of the stage component the host mounts. Loaded lazily by
   * the host so an unused renderer is never bundled (today RendererStage.vue
   * statically imports all four scenes).
   */
  stageComponent?: string
  /** Module specifier of the runtime entry that exports `activate`. */
  runtime?: string
}
