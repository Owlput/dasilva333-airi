/**
 * Model driver activation and the plugin runtime object.
 *
 * Owner: the model driver implements `ModelDriverRuntime`; the host implements the registry and
 * drives the lifecycle.
 */
import type { ModelDriverHostServices } from './host-services'
import type { ModelDriverCapabilities, ModelDriverManifest } from './manifest'
import type { ModelProvider } from './provider'
import type {
  ModelDriverImportReport,
  ModelDriverPanelDeclaration,
  ModelDriverTransferBundle,
} from './renderer'
import type { RendererMountComponentFactory } from './renderer-mount'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverId,
  Unsubscribe,
} from './shared'

/**
 * The object a model driver exposes to the host.
 *
 * The host obtains it from the plugin's runtime entry (`manifest.entry.runtime`) and never imports
 * driver internals directly.
 *
 * There is deliberately no cue sink here: a transaction is applied by the *mount*
 * (`RendererMountExposed.cues` in `renderer-mount.ts`), because one renderer can be mounted on a
 * live stage and in a settings preview at the same time and each mount must receive only what is
 * addressed to it.
 */
export interface ModelDriverRuntime {
  readonly manifest: ModelDriverManifest

  /**
   * The one provider instance for this driver, implemented and held by the plugin.
   *
   * This is what makes the non-mount half of the contract reachable: every catalogue operation
   * goes through it — `probe`, the enumeration AIRI's model list is built from, removal, previews,
   * capability discovery, profile rows and per-model transfer. It is deliberately a member of the
   * runtime rather than something the host injects as a service: "the models I hold" is the
   * renderer's own implementation, not a capability the host grants it.
   *
   * Required: `list` and `remove` are the two things the host must be able to do to any driver
   * that owns models, and a driver that owns none says so by enumerating nothing. Staying out of
   * unified import is `probe` being absent, not the provider being absent.
   *
   * The instance exists as soon as the runtime does, but its operations rely on the services
   * `activate` wires, so the host MUST NOT call it before activation has succeeded.
   */
  readonly provider: ModelProvider

  /**
   * Called once when the host enables this driver.
   *
   * MUST NOT mount anything on stage; activation only wires services, checks requirements
   * (globals, WASM, OPFS, license) and reports degradations.
   */
  activate: (services: ModelDriverHostServices) => Promise<ContractResult<ModelDriverActivationReport>>

  /** Called when disabled or unloaded; MUST release services and storage handles. */
  deactivate?: () => Promise<void>

  /**
   * What this renderer can actually do **under the resources available right now** — the
   * availability of every other member here and of the optional parts of `RendererMountExposed`.
   *
   * A call rather than a stored declaration, because that is the whole question: what a renderer
   * supports in principle and what it can do on this device are different. `ModelDriverManifest.capabilities`
   * makes the same claim statically and is explicitly only a hint; this answer supersedes it, and
   * the two are expected to disagree.
   *
   * Required, and required to be complete: this is the one place a caller looks instead of
   * inferring availability from which optional methods happen to exist.
   *
   * Callable once `activate` has succeeded, since probing needs the services activation wired —
   * before that, `ModelDriverManifest.capabilities` is all the host has. A failed call means
   * "could not determine", which is not the same as "nothing is available": the host keeps using
   * the hint rather than concluding that the renderer is useless.
   *
   * `ModelProvider.modelCapabilities(modelId)` is the same question at model scope.
   */
  rendererCapabilities: () => MaybePromise<ContractResult<ModelDriverCapabilities>>

  /** Resolve the mount component lazily, so declaring a driver unwanted also stops shipping its code. */
  resolveMountComponent: () => Promise<RendererMountComponentFactory>

  /**
   * Panels this renderer contributes, in the order the host should present them.
   *
   * Declared here as factories rather than as manifest entry strings, for the same reason
   * `resolveMountComponent` above is a function: nothing can interpret a raw `.vue` at runtime.
   * `manifest.entry.runtime` belongs to the plugin loader, which is deliberately out of scope here.
   */
  readonly panels?: ModelDriverPanelDeclaration[]

  /**
   * Package this driver's entire state into one opaque bundle.
   *
   * Advertise it as `ModelDriverCapabilities.driverTransfer`, so the host can tell the user before
   * a backup rather than after a restore.
   *
   * The counterpart at model scope is `ModelProvider.export`, which moves one model; this one moves
   * the driver, including its models. What goes in the payload is the renderer's decision — the host
   * never reads it.
   */
  export?: () => MaybePromise<ContractResult<ModelDriverTransferBundle>>

  /**
   * Apply one bundle produced by `export`.
   *
   * The input is the **complete** driver state, never a patch, a delta or a per-value negotiation:
   * every sync hands over everything, and the renderer decides what to patch, what to keep and how
   * to migrate what it does not recognise.
   *
   * The identities inside the bundle are AIRI's (`modelId`, `profileId`), so the records the host
   * already holds keep addressing the same models after an import. The host re-reads the catalogue
   * with `list()` when the import reports success.
   */
  import?: (bundle: ModelDriverTransferBundle) => MaybePromise<ContractResult<ModelDriverImportReport>>
}

/**
 * Result of activation.
 *
 * Lets a driver say what it could not set up — a global the manifest required is missing, a
 * requirement could not be satisfied — so the host can explain the situation instead of hitting it
 * at the first model load.
 *
 * What activation deliberately cannot report is a capability the renderer had to give up: that is
 * `ModelDriverRuntime.rendererCapabilities()`, asked once the renderer is up, and a second list
 * here would be two sources for one answer.
 */
export interface ModelDriverActivationReport {
  missingRequirements?: string[]
  warnings?: string[]
}

/**
 * What the host implements so drivers can be discovered and toggled.
 *
 * The workspace already has plugin infrastructure with enable/load/unload IPC; this is the
 * driver-shaped view of it, so the stage can ask "which drivers are enabled" without depending on
 * the plugin SDK itself (which a driver package must not import).
 *
 * This is also the *only* static fact AIRI has about whether a model reference can be served: that
 * its driver exists and is enabled. Anything past that — whether the driver still holds the asset,
 * whether it can still read or load it — is only knowable from a driver instance, so it is produced
 * at runtime (`ModelProvider.list`, a `ContractResult` failure, the mount's own `error` emit) and
 * there is no availability enum to keep in sync with those answers.
 */
export interface ModelDriverHostRegistry {
  list: () => ModelDriverId[]
  isEnabled: (modelDriverId: ModelDriverId) => boolean
  get: (modelDriverId: ModelDriverId) => ModelDriverRuntime | undefined
  /** Fired when a driver is enabled, disabled, installed or updated. */
  // TODO: pass in the change detail.
  onChange: (handler: () => void) => Unsubscribe
}
