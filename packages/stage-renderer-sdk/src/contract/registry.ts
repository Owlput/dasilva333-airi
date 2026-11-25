/**
 * What the host registry gives a manager, and what the adapter is allowed to ask it for.
 *
 * Owner: AIRI implements this side; the driver's manager consumes `RegistryHandle` and a renderer's
 * adapter consumes `HostRegistryClient`.
 *
 * The two halves exist for the same reason: **a driver's manager runs where there is no DOM**, so
 * anything that needs a renderer — listing models, probing a package, publishing a prompt — has to
 * be asked for rather than done locally. A `RegistryHandle` is how a manager asks; it carries no
 * storage and no mount, because those live in a window the manager does not own.
 */
import type { CueWithdrawalReport, CueWithdrawalRequest } from './cues'
import type { HostLogger } from './host-services'
import type { DriverInfo } from './references'
import type {
  ContractResult,
  ModelDriverId,
  MountId,
  RendererMountPurpose,
  RendererMountSurfaceKind,
  Unsubscribe,
} from './shared'

/**
 * One opaque message between a manager and a window that is running its code.
 *
 * The host transports these and does **not** interpret them: the driver owns the message format, its
 * versioning and its failure reporting (RFC §4.2, D3). Two members, both required, because a channel
 * that can send but never receive is a broadcast, not a conversation.
 *
 * A channel is bound to the window that requested it and to the driver that requested it. The host
 * drops a message whose sender is not that window, which is the whole of the authentication story:
 * there is no handshake for the host to get wrong, because the channel exists only for the pair the
 * registry created.
 */
export interface ManagerChannel {
  send: (message: unknown) => void
  onMessage: (handler: (message: unknown) => void) => Unsubscribe
}

/**
 * Refusal reasons for `RegistryHandle.requestRenderer`.
 *
 * Host-owned, and exhaustive: each one is a different user-facing situation (no window, the entry
 * failed to start, the driver is off, the app is going down), so a driver never has to invent a
 * reason and the host never has to guess which one it meant.
 */
export enum RendererRequestRefusal {
  /** No renderer exists and the shared background window could not be started. */
  WINDOW_UNAVAILABLE = 'window-unavailable',
  /** A window was found but the driver's provider entry threw or resolved to nothing usable. */
  ENTRY_FAILED = 'entry-failed',
  /** The user turned this driver off. */
  DRIVER_DISABLED = 'driver-disabled',
  /** The app is shutting down; no new window will be created. */
  SHUTTING_DOWN = 'shutting-down',
}

export type RequestRendererResult
  = | { ok: true, channel: ManagerChannel }
    | { ok: false, reason: RendererRequestRefusal }

/** What a manager asks for when it needs a renderer able to run this driver's code. */
export interface RendererRequest {
  driverId: ModelDriverId
  /** Which surface the code should land on, when it has to be a particular one. */
  surface?: RendererMountSurfaceKind
  /** Which purpose that surface is serving, when it has to be a particular one. */
  purpose?: RendererMountPurpose
}

/**
 * The registry, as a driver's manager sees it.
 *
 * `requestRenderer` reuses a live renderer first — one serving the named surface, then any live
 * renderer — and starts the driver's provider entry there, or reuses the channel the manager already
 * has to it. With no live renderer able to serve it, the host starts the shared background window and
 * runs the entry there. A channel that closes later counts as a refusal on the next request and never
 * reaches into the row cache.
 *
 * There is deliberately **no `storage` here**: main has no IndexedDB (D1). A manager that needs
 * storage asks for a renderer and uses `HostStorageInterface` inside it.
 */
export interface RegistryHandle {
  log: HostLogger
  /** Ask the host for a renderer able to run this driver's code. Addressed like a cue. */
  requestRenderer: (request: RendererRequest) => Promise<RequestRendererResult>
  /** Ordinary registry operations; the manager may use them directly. */
  listDrivers: () => DriverInfo[]
  isEnabled: (driverId: ModelDriverId) => boolean
  onChange: (handler: () => void) => Unsubscribe
}

/**
 * Which of a driver's renderer modules is being asked for (C15).
 *
 * The set is fixed by the contract revision and mirrors the six subpaths a first-party driver ships:
 * an implementation is one module per kind, and a driver that does not ship one of the optional kinds
 * answers "no entry" rather than the host substituting a default.
 */
export enum ModelDriverEntryKind {
  /** The module exporting `activate`, whose result is the `ModelDriverRuntime`. */
  PROVIDER = 'provider',
  /** The module exporting the mount component. */
  MOUNT = 'mount',
  /** The module exporting `ModelDriverPanelDeclaration[]`. */
  PANELS = 'panels',
  /** The module exporting the model picker component. */
  PICKER = 'picker',
}

/**
 * What the adapter asks the manager, and what the registry forwards.
 *
 * Addressed like a cue — driver, surface, purpose — because the same driver may ship one mount for a
 * stage and a different one for a settings preview, and because "which entry" is a driver decision
 * that can depend on where it is going.
 */
export interface EntrypointRequest {
  driverId: ModelDriverId
  kind: ModelDriverEntryKind
  surface?: RendererMountSurfaceKind
  purpose?: RendererMountPurpose
}

/**
 * The manager's answer: a module specifier the adapter's own build-time loader table resolves.
 *
 * The manager chooses; the adapter imports what it named and makes no decision of its own. An unknown
 * specifier is `INVALID_ENTRYPOINT` with a readable reason, never a silent fallback to another entry.
 * `null` means the driver does not ship that kind at all (no picker, no panels), which is a value
 * rather than a failure: the host shows no UI there instead of inventing one.
 */
export type EntrypointResolution = { specifier: string } | null

/** What a mount registration asks the registry for. */
export interface MountRegistrationRequest {
  driverId: ModelDriverId
  surface: RendererMountSurfaceKind
  purpose: RendererMountPurpose
  /** The window registering it; the host overwrites it with the sender's own identity. */
  windowId: string
}

export enum MountRegistrationRefusal {
  /** The user turned this driver off; no mount of it may exist. */
  DRIVER_DISABLED = 'driver-disabled',
  /** The app is shutting down; the mount is never created. */
  SHUTTING_DOWN = 'shutting-down',
}

export type MountRegistrationResult
  = | { ok: true, mountId: MountId }
    | { ok: false, reason: MountRegistrationRefusal }

/**
 * The registry client a renderer's adapter holds.
 *
 * `registerMount` is the **only** way a mount identity comes into existence: the registry issues it,
 * so a renderer cannot construct one and a forged mount target has no value to forge. A mount is
 * unaddressable between being created and this response arriving, and readiness does not begin before
 * it.
 *
 * Unregistering is not here: a mount leaves when it unmounts or when its window goes away, and both
 * of those are host events the registry observes itself (`ModelDriverMountRegistry.unregister` is the
 * host-side call). A renderer that could unregister was a renderer that could also unregister
 * another window's mount.
 */
export interface HostRegistryClient {
  registerMount: (request: MountRegistrationRequest) => Promise<MountRegistrationResult>
  /**
   * Route a withdrawal request to the manager of one driver.
   *
   * A renderer-side panel or a diagnostics surface can withdraw work it did not start, so the client
   * exposes the request itself rather than a "cancel my transaction" convenience: the six values are
   * the same ones the manager answers.
   */
  withdraw: (request: CueWithdrawalRequest) => Promise<ContractResult<CueWithdrawalReport>>
}
