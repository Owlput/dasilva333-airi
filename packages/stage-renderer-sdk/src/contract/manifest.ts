/**
 * What a model driver declares about itself.
 *
 * Owner: the model driver implements this; AIRI consumes it at registration and activation.
 */
import type { CueKind } from './cues'
import type { ModelDriverContractVersion, ModelDriverId } from './shared'

/** What a model driver presents to the host to announce its presence. */
export interface ModelDriverManifest {
  id: ModelDriverId
  /** Human-facing name for settings and pickers. */
  name: string
  driverVersion: string
  /**
   * Contract revision this plugin was built against.
   *
   * Checked when the host **reads this manifest**, before activation: a plugin declaring a
   * revision the host cannot speak is refused there, so no service container is ever built for
   * it and `ModelDriverHostServices.contract` can only ever repeat this value.
   */
  contractVersion: ModelDriverContractVersion
  /**
   * What this driver claims it can do — a **static hint**, never the truth.
   *
   * Required so a loader, a picker or a settings page can reason about a driver without
   * executing its code, and so the host has something to go on before activation.
   *
   * A probe that fails does not displace it: an error from `ModelDriverRuntime.rendererCapabilities()`
   * means "could not determine", so the host keeps reading this hint rather than treating the
   * driver as incapable.
   */
  capabilities: ModelDriverCapabilities
  /** What must exist in the runtime before the plugin can activate. */
  requirements: ModelDriverRequirements
  /** How the host reaches the plugin's code. */
  entry: ModelDriverEntryPoints
}

/**
 * The availability of every other member of the contract, in one required-and-complete shape,
 * asked twice and answered with different authority.
 *
 * It is the shape of two things, and the difference between them is the point:
 *   - `ModelDriverManifest.capabilities` — a **static claim**. Available without running the
 *     driver, so a loader or a picker can use it, and so the host has something before
 *     activation.
 *   - `ModelDriverRuntime.rendererCapabilities()` — the **truth**, probed under the resource
 *     limits actually in effect. A missing OPFS grant, a GPU that cannot hold the model or memory
 *     pressure can each take a surface away, so the claim is only a hint and the probe is what a
 *     running host acts on.
 *
 * Required and complete rather than `Partial`, deliberately: a missing field would have to be
 * read as `false` at every use site, which turns "I did not say" into a silent denial. A
 * renderer that cannot do something says `false`; one that forgot to say is a plugin the
 * loader can reject, not a renderer with holes.
 *
 * Whoever holds the probe uses the probe: a surface it reports as available exists on the
 * object that carries it, and one it reports as unavailable is not called. (The `?` on those
 * members stays, because TypeScript cannot narrow one field from another.)
 */
export interface ModelDriverCapabilities {
  /** Participates in unified import (`ModelProvider.probe`). */
  probe: boolean
  /** Can (re)generate a thumbnail for its models (`ModelProvider.preview`). */
  previewModel: boolean
  /** When capabilities can be enumerated (`ModelProvider.modelCapabilities`). */
  capabilityDiscovery: CapabilityDiscoveryMode
  /**
   * Holds named profiles for its models.
   *
   * One field for all three members (`listProfiles`, `saveProfile`, `removeProfile`) because
   * they are one ability: a renderer that can list a profile can store it. AIRI needs the
   * answer to know whether its own profile records can have bodies behind them at all.
   */
  profiles: boolean
  /** Can export/import **one model** as an opaque bundle (`ModelProvider.export` / `import`). */
  modelTransfer: boolean
  /** Can export/import the **whole driver** as one opaque bundle (`ModelDriverRuntime.export` / `import`). */
  driverTransfer: boolean
  /** Contributes settings panels (`ModelDriverRuntime.panels`). */
  panels: boolean
  /** Has something to release when the host disables it (`ModelDriverRuntime.deactivate`). */
  deactivate: boolean
  /**
   * Can delete every byte it persisted (`ModelDriverRuntime.purge`).
   *
   * The host cannot enumerate a driver's storage itself, so "delete all data" and uninstall
   * depend on this member. A driver that persists nothing answers `true`.
   */
  purge: boolean
  /**
   * Can inherit the settings AIRI kept for it before this contract existed
   * (`ModelDriverRuntime.migrate`).
   *
   * `false` means pre-contract settings have nowhere to go: the host may say so once and then drop
   * them. `true` means the host hands over its legacy bag on the first activation and deletes the
   * entries the driver reports as used.
   */
  migration: boolean
  /**
   * The optional cue kinds the renderer understands.
   *
   * `'load'` is deliberately not part of the answer: it is how a mount is told which model to
   * show, so every renderer accepts it. What is declared here is the rest, which a renderer is
   * allowed to refuse as `unsupported-cue`.
   *
   * One value settles ownership rather than only capability: declaring `'view'` means this
   * renderer owns its own camera (`ViewCue`), so the host does not write camera props for it.
   *
   * `'caption'` is **optional**: a driver that can show text, including head-tethered presentation,
   * declares it and owns that rendering; one that cannot leaves it out and the host simply does not
   * send that cue. Omitting it is a supported answer rather than a degraded one. Whether AIRI shows
   * its own host overlay fallback is host policy, outside this contract; such a fallback cannot use
   * a driver `HeadPose`. Sending a caption to a driver that did not declare it is
   * `unsupported-cue`.
   */
  cues: Exclude<CueKind, CueKind.LOAD>[]
  /**
   * Can answer whether its own viewport has anything drawn at a point
   * (`RendererMountExposed.occupiesPoint`).
   *
   * How the answer is produced — pixel alpha, geometry, or a policy of the renderer's own — is
   * deliberately not declared here, and neither is the renderer's sensitivity.
   */
  occupiesPoint: boolean
  /**
   * Can name the interaction region under a point (`RendererMountExposed.hitTest`).
   *
   * Declared separately from `occupiesPoint` because "is anything drawn here" is a question
   * about the viewport, while "which region of the model is here" is a question about the
   * model, and a renderer can answer either without the other.
   */
  hitTest: boolean
  /** Can stop everything it is playing (`RendererMountExposed.stopAll`). */
  stopAll: boolean
  /**
   * Can release a mount's resources on request (`RendererMountExposed.dispose`).
   *
   * The host unmounts the component either way; this says whether the renderer has more to do
   * than that, such as keeping parsed resources alive for a
   * `RendererMountDisposeStrategy.SHALLOW` re-mount.
   */
  dispose: boolean
}

/**
 * When a model's capabilities can be enumerated.
 *
 * `NONE` and declaring the `'view'` cue contradict each other: points of interest exist only as
 * capability descriptors, so a renderer with no capability model has no camera target to name.
 */
export enum CapabilityDiscoveryMode {
  /** Enumerate from the package without loading it. */
  STATIC = 'static',
  /** Only after a model is mounted. */
  RUNTIME = 'runtime',
  /** The renderer has no capability model at all. */
  NONE = 'none',
}

/** Whether the renderer needs a DOM canvas of its own. */
export enum ModelDriverDomRequirement {
  CANVAS = 'canvas',
  NONE = 'none',
}

/**
 * What must exist in the runtime before the plugin can activate.
 */
export interface ModelDriverRequirements {
  /** Needs a WebGL(2) context. */
  webgl?: 1 | 2 | false
  /** Needs a WebAssembly runtime. */
  wasm?: boolean
  /** Needs an origin-private file system. */
  opfs?: boolean
  /** Spawns workers. */
  worker?: boolean
  /** Needs a live `AudioContext` (lip sync). */
  audioContext?: boolean
  /**
   * Needs a DOM canvas of its own.
   *
   * That canvas belongs to the renderer and sits inside the box the host mounts it into
   * (`RendererMountViewport`): the host never sizes it, draws into it, or holds a handle to it.
   */
  dom?: ModelDriverDomRequirement
  /** Globals the host must install before activation, instead of "the app's index.html happens to include a script tag". */
  globalScripts?: string[]
  /** Rough persistent-storage appetite, for the host's quota UI. */
  storageHintBytes?: number
}

/**
 * Where the plugin loader finds the plugin's code.
 *
 * Loader-owned: this string is resolved by the plugin loader, not by the stage. There is
 * deliberately no `stageComponent` specifier here: nothing interprets a raw `.vue` at runtime,
 * so the host gets the component from `ModelDriverRuntime.resolveMountComponent()` instead.
 */
export interface ModelDriverEntryPoints {
  /**
   * Module specifier of the runtime entry that exports `activate` and hands back the
   * `ModelDriverRuntime`.
   *
   * Required, and the only entry point there is: without it, `ModelDriverCapabilities.panels`,
   * `deactivate`, `purge` and `driverTransfer` would name members of an object nothing can obtain.
   */
  runtime: string
}
