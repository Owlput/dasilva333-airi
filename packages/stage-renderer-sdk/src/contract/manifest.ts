/**
 * What a model driver declares about itself.
 *
 * Owner: the model driver implements this; AIRI consumes it at registration and activation.
 *
 * **This is the static first phase, and it is read before any driver code runs.** The Electron main
 * process reads it to register the driver and build its manager; a renderer's Adapter reads the same
 * declaration to know which driver is available to it. Nothing here may need the driver to be evaluated
 * first — that is what makes "the manifest exists even when the driver cannot run" true, which the
 * fallback view depends on.
 */
import type { OptionalCueKind } from './cues'
import type { RendererMountInteractionMode } from './renderer-mount'
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
   * revision the host cannot speak is refused there (`isContractCompatible`), so no service
   * container is ever built for it and `HostServices.contract` can only ever repeat this value.
   */
  contractVersion: ModelDriverContractVersion
  /**
   * What this driver claims it can do as a static hint.
   *
   * Required so a loader, a picker or a settings page can reason about a driver without
   * executing its code.
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
 * The availability of every other member of the capability contract.
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
 * Required and complete rather than `Partial`: the key set is fixed by the contract revision, and a
 * probe MUST report every key of the revision it was built against (RFC §6.4).
 * The host MAY still provide corresponding services and signals, even if false is declared.
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
   * Can hold named profiles for its models.
   */
  profiles: boolean
  /**
   * Publishes a prompt per model and profile (`HostPromptService.publish`, D5).
   *
   * `true` obliges the driver to publish **at least once per model and profile** once activated, even
   * when the publication is empty (`text: ''`, `tokens: []`). A prompt-capable driver that finishes
   * activation without a publication for a model it serves is a **fault** — surfaced as a runtime
   * state in its panel — and never a reason to block a migration: the model migrates and the fault
   * stays visible until the driver publishes (D5, D8, D-17).
   *
   * `false` means "this driver has no prompt to give"; the host then never expects one and never
   * reports a missing one.
   */
  prompt: boolean
  /** Can export/import **one model** as an opaque bundle (`ModelProvider.export` / `import`). */
  modelTransfer: boolean
  /** Can export/import the **whole driver** as one opaque bundle (`ModelDriverRuntime.export` / `import`). */
  driverTransfer: boolean
  /** Contributes settings panels (resolved through `ModelDriverManager.resolveEntrypoint`). */
  panels: boolean
  /** Has something to release when the host disables it (`ModelDriverRuntime.deactivate`). */
  deactivate: boolean
  /**
   * Can safely delete every byte it persisted (`ModelDriverRuntime.purge`).
   * The host may purge its storage altogether in a "unsafe" way even if this is set to false.
   */
  purge: boolean
  /**
   * Can inherit the settings and model bytes AIRI kept for it before this contract existed, and can
   * hand a retained model back for a revert.
   *
   * Covers both directions of the legacy bridge: `ModelDriverRuntime.migrate` (per-model handover in)
   * and `ModelDriverRuntime.restoreLegacy` (retained entry out). `false` means pre-contract data has
   * nowhere to go: the host may say so once and then drop it.
   */
  migration: boolean
  /**
   * The **optional** cue kinds the renderer understands, beyond `load`.
   *
   * Beyond `load` because every mount must handle a load: it is the only way a mount is ever told
   * which model to show. A driver may refuse any kind it did not declare.
   */
  cues: OptionalCueKind[]
  /**
   * The pointer interaction modes this model supports, as a subset of
   * `RendererMountInteractionMode`.
   *
   * The host offers only these: a `ViewCue`-style policy change to a mode the driver did not declare
   * is a host bug, not a refused cue. An absent or empty list means "no interaction mode", which is
   * the same thing as `none`.
   */
  interactionModes: RendererMountInteractionMode[]
  /**
   * Can answer whether its own viewport has anything drawn at a point
   * (`RendererMountExposed.occupiesPoint`).
   */
  occupiesPoint: boolean
  /**
   * Can name the interaction region under a point (`RendererMountExposed.hitTest`).
   */
  hitTest: boolean
  /** Can stop everything it is playing (`RendererMountExposed.stopAll`). */
  stopAll: boolean
  /**
   * Require a dispose to release its resources when unmounted (`RendererMountExposed.dispose`).
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
 *
 * Deliberately silent about audio: a driver is no longer handed an `AudioContext` or an `AudioNode`
 * (neither can cross a realm), and lip sync is a plugin-level analyzer outside this contract. A
 * driver that needs audio input gets it as frames, not as a graph.
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
  /**
   * Needs a DOM canvas of its own.
   *
   * That canvas belongs to the renderer and sits inside the box the host mounts it into: the host
   * never sizes it, draws into it, or holds a handle to it. The box's size is the viewport, and the
   * mount measures it (`RendererMountProps` carries no size).
   */
  dom?: ModelDriverDomRequirement
  /** Globals the host must install before activation, instead of "the app's index.html happens to include a script tag". */
  globalScripts?: string[]
  /** Rough persistent-storage appetite, for the host's quota UI. */
  storageHintBytes?: number
}

/**
 * Where the driver's manager lives.
 *
 * **The manager is the only entry point the declaration names** (RFC §6.1, §6.5). Everything else —
 * the provider, the mount component, the panels, the picker — is asked for at the moment a window
 * needs it, through `ModelDriverManager.resolveEntrypoint`, which answers with a module specifier the
 * adapter's own build-time loader table resolves.
 *
 * Two consequences, and both are why it is a single entry:
 *
 *   - main imports only the manifest at startup and only this module beyond it, so the declaration can
 *     never drag renderer UI into a DOM-free process;
 *   - a driver that ships no picker or no panels simply answers that with "no entry" for that kind —
 *     there is no absent optional specifier here that the host would have to interpret.
 *
 * The value is a **module specifier resolved by the loader that reads this manifest**, after the
 * manifest itself has been read. Nothing interprets a raw `.vue` at runtime — the loader resolves a
 * specifier to a module, and the module exports a component, which is why this is a path rather than a
 * component reference.
 */
export interface ModelDriverEntryPoints {
  /**
   * Main-process half: the driver's module exporting `createManager(handle)` and
   * `resolveEntrypoint(request)`.
   *
   * Required, because it is what main has instead of a runtime: lifecycle, the model list, delivery
   * and withdrawal, and the one place that knows where the driver's renderer code lives.
   */
  manager: string
}
