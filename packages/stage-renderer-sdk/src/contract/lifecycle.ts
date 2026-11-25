import type {
  ModelDriverImportReport,
  ModelDriverTransferBundle,
} from './components'
/**
 * Model driver activation, the plugin runtime object, and the registries that hold them.
 *
 * Owner: the model driver implements `ModelDriverRuntime` and `ModelDriverManager`; the host
 * implements both registries and drives the lifecycle.
 *
 * **Two halves, in two processes.** A driver is not one object living in one place:
 *
 *   - its **manager** runs in the Electron main process, where there is no DOM, no WebGL and no
 *     `AudioContext`. It holds lifecycle, delivery, withdrawal and the model list — the facts AIRI
 *     needs while no window is showing anything;
 *   - its **runtime** runs in a renderer window, created by that window's Adapter, and is the only
 *     side that can parse a model, draw it, or answer what it can do.
 *
 * The two talk only through the `ManagerChannel` the registry hands over. Nothing here is a
 * main-process method that reaches into a renderer, and nothing in a renderer needs main to be
 * running.
 */
import type { CueAck, CueEnvelope, CueWithdrawalReport, CueWithdrawalRequest } from './cues'
import type { HostServices } from './host-services'
import type { ModelDriverCapabilities, ModelDriverManifest } from './manifest'
import type {
  LegacyRestorePayload,
  ModelDriverLegacyHandoverEntry,
  ModelDriverLegacyHandoverReport,
} from './migration'
import type { CharacterId, ModelId, ModelProfileId } from './model'
import type { SpeechAnalyzerRegistration } from './plugin-port'
import type { ModelProvider } from './provider'
import type { DriverInfo, ModelSummary } from './references'
import type { EntrypointRequest, EntrypointResolution, RegistryHandle } from './registry'
import type { RendererMountDisposeStrategy, RendererMountHitArea } from './renderer-mount'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverId,
  MountId,
  RendererMountPoint,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
  Unsubscribe,
} from './shared'

/** Which mounts a manager-level query or command selects. Every field is an AND filter. */
export interface MountSelection {
  /** Which host surface the viewport sits on. */
  surface?: RendererMountSurfaceKind
  /** What the mount is for. */
  purpose?: RendererMountPurpose
  /** Narrow to the mounts showing one model. */
  modelId?: ModelId
  /** Narrow to the mounts serving one character. */
  characterId?: CharacterId
}

/**
 * One question about a viewport that a window which did **not** create it may still ask (C10).
 *
 * The creating window calls the live instance's member directly. Anything else — a settings page
 * asking whether the stage is ready, the control strip asking whether a click would land on the
 * model — names a selection and lets the driver resolve it, because the caller holds no component
 * reference and must not be given one.
 */
export type MountQuery
  = | { kind: 'readiness' }
    | { kind: 'occupiesPoint', point: RendererMountPoint }
    | { kind: 'hitTest', point: RendererMountPoint }

/** One mount's answer. One entry per mount the selection matched. */
export type MountQueryAnswer
  = | { kind: 'readiness', mountId: MountId, readiness: RendererMountReadinessState }
    | { kind: 'occupiesPoint', mountId: MountId, occupies: boolean }
    | { kind: 'hitTest', mountId: MountId, area: RendererMountHitArea | null }

/** One command that tears something down or stops it, addressed the same way as a query. */
export type MountCommand
  = | { kind: 'stopAll' }
    | { kind: 'dispose', strategy: RendererMountDisposeStrategy }

/** Acknowledgement that a command reached one mount. */
export interface MountCommandAnswer {
  mountId: MountId
}

/**
 * The object a model driver exposes **in one renderer window**.
 *
 * The Adapter obtains it by loading the module the manager named for `ModelDriverEntryKind.PROVIDER`
 * and calling its `activate`, and never imports driver internals directly. One runtime exists per
 * driver per window.
 *
 * The components the host mounts are **not** here: they are resolved through
 * `ModelDriverManager.resolveEntrypoint` like everything else the driver ships. Keeping them out of the
 * runtime is what lets the host show a driver's settings with no model mounted and no runtime
 * created yet, and it means a component has exactly one address instead of one address and one
 * factory.
 *
 * There is deliberately no cue sink here either: a transaction is applied by the *mount*
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
   * Called once when the host enables this driver in this window.
   *
   * MUST NOT mount anything on stage; activation only wires services, checks requirements
   * (globals, WASM, OPFS) and reports degradations.
   */
  activate: (services: HostServices) => Promise<ContractResult<ModelDriverActivationReport>>

  /** Called when disabled or unloaded; MUST release services and storage handles. */
  deactivate?: () => Promise<void>

  /**
   * What this renderer can actually do **under the resources available right now** — the
   * availability of every other member here and of the optional parts of `RendererMountExposed`.
   *
   * Required, and required to be complete: this is the one place a caller looks instead of
   * inferring availability from which optional methods happen to exist.
   *
   * The answer belongs to one live instance in one window; the Electron main process cannot answer
   * it because it has no renderer, no DOM/WebGL and no `AudioContext`. A main-side registry therefore
   * holds only the static manifest hint and the enabled flag, never this result.
   *
   * `ModelProvider.modelCapabilities(modelId)` is the same question at model scope.
   */
  rendererCapabilities: () => MaybePromise<ContractResult<ModelDriverCapabilities>>

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

  /**
   * Delete every byte this driver persisted.
   *
   * Called for "delete all data" and uninstall, after the host has decided the driver's records
   * go away. The host cannot enumerate a driver's storage itself (`HostStorageInterface.keys()`
   * is the driver's view), so this is the only complete deletion path. Advertise it as
   * `ModelDriverCapabilities.purge`; a driver that persists nothing answers `true` and does
   * nothing, so the host does not have to special-case it.
   *
   * Models, profiles, per-model state and the driver's own settings all go. The host clears its
   * catalogue records only after this succeeds, so a failure leaves both sides consistent.
   *
   * A **referenced** model or profile is refused before this is called: the host owns the character
   * records, so it answers `MODEL_REFERENCED` / `PROFILE_REFERENCED` with the evidence itself and a
   * driver that purges successfully never has to know a card existed (C11).
   */
  purge?: () => MaybePromise<ContractResult<void>>

  /**
   * Absorb one model's pre-contract entry, **retaining it in the driver's own storage**.
   *
   * One entry per call, because the offer is per model and lazily materialised: one model's bytes are
   * in memory at a time, never the whole library (D8, D17). The driver interprets the opaque members
   * (`values`, `outfits`, `files`, `assets`, `prompt`, `url`) and reports what it did not use.
   *
   * Two obligations that decide whether the run works:
   *
   *   - **retain.** `retained: true` means the payload is in the driver's own storage, which is what
   *     makes a later revert possible and what lets the host write the migration marker. A driver
   *     that drops the payload reports `false`, and the host keeps the model on the legacy path.
   *   - **move, never copy.** The import that follows must consume this payload by reference so the
   *     retained entry and the imported row are not two copies of the same bytes (D-16, D17).
   *
   * MUST be idempotent: the host may call it again with an identical entry after a crash between the
   * driver's write and the host's marker.
   *
   * Advertise it as `ModelDriverCapabilities.migration`. A driver that never existed outside this
   * contract has nothing to inherit and answers the capability `false`.
   */
  migrate?: (
    entry: ModelDriverLegacyHandoverEntry,
  ) => MaybePromise<ContractResult<ModelDriverLegacyHandoverReport>>

  /**
   * Hand back one model's retained legacy entry, so a character can go back to the legacy path.
   *
   * The reverse of `migrate` and the data path of a revert (D9, C23): the payload carries the
   * **legacy id** the host must recreate the record under, plus the settings, placement, outfit
   * payload, prompt, model bytes and assets needed for the legacy path to render it again.
   *
   * Refuses with a readable reason — never with an empty payload — when this model has no retained
   * origin: a model imported after cutover has no legacy identity to restore, and importing nothing
   * would be a half-revert. Driver data is kept either way, so "migrate again" stays available for
   * the same character.
   */
  restoreLegacy?: (
    modelId: ModelId,
  ) => MaybePromise<ContractResult<LegacyRestorePayload>>
}

/**
 * The driver's **main-process** half: what AIRI holds for a driver it cannot run.
 *
 * Owner: the driver implements it; the Registry keeps one per registered driver and holds no
 * runtime of its own. It exists so the main process can answer "which models does this driver have"
 * for a catalogue, a card import or a migration without waiting for a window to open — and so the
 * answer does not require DOM, WebGL or an `AudioContext`, none of which main has.
 *
 * What is deliberately absent:
 *
 *   - **no lifecycle verbs.** Enabling a driver is AIRI's decision, stored in the registry; the
 *     activation it triggers happens in a renderer through the Adapter channel, and a verb here
 *     would be a second call path to the same thing;
 *   - **no capabilities.** `ModelDriverRuntime.rendererCapabilities()` answers under real resource
 *     limits, in a specific window; main can only repeat the manifest hint;
 *   - **no mount, cue or prompt member.** Those name a viewport or a model's text, and neither is a
 *     main-process fact.
 */
export interface ModelDriverManager {
  /** The driver this manager serves. */
  readonly modelDriverId: ModelDriverId

  /**
   * The driver's model list, as AIRI may enumerate it.
   *
   * **Only `imported` models.** A `builtin` model is the driver's, not AIRI's: it has no
   * `modelId` AIRI minted, so listing it here would hand AIRI a row it can neither reference nor
   * resolve. The driver's own picker lists builtin models and imports one on demand; the imported
   * result then appears here.
   *
   * One row per model **profile**, so a picker can offer "model X in outfit B" from the same list
   * the catalogue uses. The rows are lightweight on purpose (`ModelSummary`): a preview is a small
   * encoded image or none, never a blob, because this list crosses process boundaries.
   *
   * `ok: false` means the driver could not answer — a disabled driver, a storage failure — and MUST
   * NOT be read as "this driver has no models".
   */
  listModels: () => Promise<ContractResult<ModelSummary[]>>

  /**
   * Tell the manager which module implements one entry kind (C15).
   *
   * The manager is the only declared entry point (RFC §6.1), so it is the only thing that knows where
   * the rest of the driver's code lives. It chooses; the adapter imports what it named.
   *
   * `null` means the driver ships no such kind, which is a value rather than a failure.
   */
  resolveEntrypoint: (request: EntrypointRequest) => Promise<ContractResult<EntrypointResolution>>

  /**
   * Deliver one transaction to the mounts that match its target (C3).
   *
   * The **manager** decides which mounts receive it and how their outcomes combine — the host only
   * provides a pipe to each mount's window. Delivery is ordered per driver and does not wait for
   * completion: two envelopes may be in flight together, and the manager chooses how to handle them.
   *
   * The answer is one combined ack: one outcome per cue, `handled` derived from them, and the
   * `modelDriverId` of the driver that answered. A transaction whose selection matched no mount is
   * the broker's `NO_TARGET`, decided before this is ever called.
   */
  deliver: (envelope: CueEnvelope) => MaybePromise<ContractResult<CueAck>>

  /**
   * Withdraw work, within this driver (C3, C4).
   *
   * The broker applies the request to what it still holds first, then forwards it here for what it
   * has already delivered. One result per target the request named or selected (`count` stays exact
   * when the report is capped).
   */
  withdraw: (request: CueWithdrawalRequest) => MaybePromise<ContractResult<CueWithdrawalReport>>

  /**
   * The driver's model list changed: an import, a removal, a profile write.
   *
   * The host's row cache is written from a successful pull only, so this is a nudge to pull again —
   * not a payload, and not a place to send rows. A manager that pushes rows here would be a second
   * source for the catalogue.
   */
  onModelsChanged: (handler: () => void) => Unsubscribe

  /**
   * The speech analyzer this driver provides, when it measures lip sync differently (RFC §12).
   *
   * `null` means "use the host's default analyzer". The declaration does not name it — the manager
   * answers the request and knows where it is — so a driver can keep its analyzer beside the rest of
   * its renderer code without adding a sixth manifest entry.
   */
  resolveSpeechAnalyzer?: () => MaybePromise<ContractResult<SpeechAnalyzerRegistration | null>>

  /**
   * Answer one question about the mounts a selection matches (C10).
   *
   * For callers that do not hold the component reference. An empty answer is a success — "nothing
   * matches that selection" is an answer, not a failure — so the caller reads the array rather than an
   * error code.
   */
  queryMount: (selection: MountSelection, query: MountQuery) => Promise<ContractResult<MountQueryAnswer[]>>

  /** Send one command to the mounts a selection matches (C10). Empty when nothing matched. */
  commandMount: (selection: MountSelection, command: MountCommand) => Promise<ContractResult<MountCommandAnswer[]>>
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
 * What the host implements **in a renderer window**, so a driver can be discovered and toggled.
 *
 * This is the Adapter's view: `get()` returns a live `ModelDriverRuntime`, which only exists in the
 * window that activated it. The main-process registry is a different thing — driver manifests, their
 * `ModelDriverManager`s and their enabled flag — and deliberately holds no runtime and no probed
 * capabilities.
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

/** One live renderer mount. */
export interface RendererMountDescriptor {
  /**
   * Globally unique for the app session, **issued by the registry** on registration and never
   * reused.
   *
   * The registry rejects a duplicate; it does not accept a renderer-supplied value, so the id in the
   * mount's props and the id in the registry are the same value by construction (D1).
   */
  mountId: MountId
  modelDriverId: ModelDriverId
  /** The model currently on this mount, when one is loaded. */
  modelId?: ModelId
  /** The character this mount serves, when it serves one. */
  characterId?: CharacterId
  /** The profile the mount currently shows, when one is loaded. */
  profileId?: ModelProfileId
  /** Which host surface the viewport sits on. A label, not a routing key. */
  surface: RendererMountSurfaceKind
  /**
   * What this mount is for.
   *
   * The value the interface creating the mount already had. Two live mounts share one `surface`
   * (the acting window and the chat-side stage are both `stage`) and differ here, so this is the only
   * way to tell them apart — and nobody may guess from creation order.
   */
  purpose: RendererMountPurpose
  /** The host window that owns the mount, so the broker can reject a forged ack. */
  windowId: string
  readiness: RendererMountReadinessState
  /** Host clock, milliseconds; updated on every descriptor change. */
  updatedAt: number
}

/** Query for `findBy`; every field is an AND filter. */
export interface RendererMountQuery {
  surface?: RendererMountSurfaceKind
  purpose?: RendererMountPurpose
  windowId?: string
  modelId?: ModelId
  modelDriverId?: ModelDriverId
  characterId?: CharacterId
}

/**
 * The host's mount registry.
 *
 * This is the centre a multi-window host was missing: a cue, a capture request or a panel all need to
 * find "the mount on the acting window" without holding that window's component reference. AIRI
 * implements it in the Electron main process; a single-window host may implement it in memory with
 * the same semantics.
 *
 * **Creation is not here.** A mount comes into existence through
 * `HostRegistryClient.registerMount`, which is what assigns its `mountId`; this interface then tracks
 * the live descriptor. There is no `register` that accepts a renderer-chosen id, because a renderer
 * cannot mint one.
 *
 * `unregister` is called on unmount and on window destruction. `onChanged` is an observer feed: it is
 * not how cues are delivered, because a cue names a driver plus a surface/purpose and is delivered
 * through the manager.
 *
 * **There is no state scope.** Every mount is independent: two mounts of one model do not share a
 * snapshot, a revision or a prompt, because none of those exist. What they can share is the model
 * binding AIRI stores, and a prompt is per model and profile, not per mount.
 */
export interface ModelDriverMountRegistry {
  /** Patch readiness/model/profile/character. `mountId` and `windowId` are immutable. */
  update: (
    mountId: MountId,
    patch: Partial<Omit<RendererMountDescriptor, 'mountId' | 'windowId' | 'updatedAt'>>,
  ) => Promise<ContractResult<RendererMountDescriptor>>
  /** Idempotent: removing an already-removed mount is a successful no-op. */
  unregister: (mountId: MountId) => Promise<ContractResult<void>>
  list: () => Promise<RendererMountDescriptor[]>
  findBy: (query: RendererMountQuery) => Promise<RendererMountDescriptor[]>
  /** Fires with the complete new list whenever a descriptor is added, changed or removed. */
  onChanged: (handler: (mounts: RendererMountDescriptor[]) => void) => Unsubscribe
}

/** The registry's per-driver entry: the static declaration plus AIRI's own enabled flag. */
export interface ModelDriverRegistration {
  manifest: ModelDriverManifest
  manager: ModelDriverManager
  info: DriverInfo
}

/**
 * The shape a driver's `entry.manager` module exports.
 *
 * The host loads that module, calls `createManager(handle)` **once** per registered driver, and owns
 * the result for the app's lifetime (D1). The handle is the only thing main gives it — no storage
 * (main has no IndexedDB), no window, no DOM — which is why a manager that needs any of those asks
 * `handle.requestRenderer` and works in a renderer instead.
 *
 * `MaybePromise` because a manager may need to read its own declaration before it can answer; the
 * registry awaits it before any other call reaches the manager.
 *
 * The same module also exports `resolveEntrypoint` (`ModelDriverManager.resolveEntrypoint`), so the
 * host never has to know a second specifier to reach the rest of the driver's code.
 */
export type ModelDriverManagerFactory = (handle: RegistryHandle) => MaybePromise<ModelDriverManager>
