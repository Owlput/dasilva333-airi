/**
 * Shared vocabulary for the model driver contract.
 *
 * Owner: both sides.
 */
import type { CharacterId, ModelId, ModelProfileId } from './model'

/** Stable identity of a model driver, e.g. `ai.moeru.airi.stage.live2d`. Provided by the driver. */
export type ModelDriverId = string

/**
 * Identity of one live renderer mount.
 *
 * Issued by the **host registry** when the adapter registers the mount (`HostRegistryClient.registerMount`,
 * `registry.ts`) and never constructed by a renderer, a manager or a card. A renderer cannot mint one,
 * which is what makes a forged target inexpressible rather than merely forbidden.
 *
 * It names *this viewport* for the life of the app session: not the model on it, not the surface it
 * sits on, and not a state it might share. Nothing addresses a cue by it — a cue names a driver and a
 * surface/purpose, and the broker resolves that to the matching mounts.
 */
export type MountId = string

/** Cancels a subscription previously registered with the host. */
export type Unsubscribe = () => void

export type MaybePromise<T> = T | Promise<T>

/**
 * Monotonic counter minted by the host's cue broker.
 *
 * One counter covers the whole app, so a nonce is never reused across mounts. A renderer compares
 * nonces only against other transactions it received on the **same mount**: a completion whose
 * nonce is older than the newest one seen there is stale and must be discarded. A caller may pin a
 * value it already tracks, but it does not mint the sequence itself.
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
 * `0.1` is the first shipped contract shape (Phase 0 close, D12). Anything a driver declares below
 * `0.1` was written against a draft and is refused by `isContractCompatible`; any later breaking
 * shape is `0.2`. See `compatibility.ts` for the predicate.
 */
export const MODEL_DRIVER_CONTRACT_VERSION: ModelDriverContractVersion = { major: 0, minor: 1 }

/**
 * Readiness of one renderer mount, reported through the mount's `state-change` emit.
 *
 * The vocabulary distinguishes **causes** rather than collapsing them into "mounted": "this model
 * is broken" and "this renderer is broken" lead to different recoveries. Which transitions are legal
 * is `READINESS_TRANSITIONS` below, and a host decides what to do about an illegal one — never what
 * is legal.
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

/**
 * The declared readiness transitions, as the contract's own data rather than prose.
 *
 * Rules that produce this table:
 *
 *   - a mount starts `UNMOUNTED` and only ever enters the machine through `MOUNTING`;
 *   - `MODEL_LOADED` may be re-entered from `LOADING_MODEL`, because "the mount survives a model
 *     change" — a swap goes straight to `LOADING_MODEL` instead of dropping to `READY_FOR_MODEL`
 *     and flashing an empty stage;
 *   - every non-terminal state may reach `UNMOUNTED`, because disposal can happen at any time;
 *   - a recoverable cause is re-entered through `MOUNTING` (`mount-error`) or `LOADING_MODEL`
 *     (`model-error`), never by pretending the previous state never happened.
 *
 * A redundant report of the state a mount is already in is accepted as an idempotent re-emit: it
 * says nothing new and MUST NOT be treated as a transition.
 */
export const READINESS_TRANSITIONS: Readonly<
  Record<RendererMountReadinessState, readonly RendererMountReadinessState[]>
> = {
  [RendererMountReadinessState.UNMOUNTED]: [
    RendererMountReadinessState.MOUNTING,
  ],
  [RendererMountReadinessState.MOUNTING]: [
    RendererMountReadinessState.READY_FOR_MODEL,
    RendererMountReadinessState.MOUNT_ERROR,
    RendererMountReadinessState.UNMOUNTED,
  ],
  [RendererMountReadinessState.READY_FOR_MODEL]: [
    RendererMountReadinessState.LOADING_MODEL,
    RendererMountReadinessState.MOUNT_ERROR,
    RendererMountReadinessState.UNMOUNTED,
  ],
  [RendererMountReadinessState.LOADING_MODEL]: [
    RendererMountReadinessState.MODEL_LOADED,
    RendererMountReadinessState.MODEL_ERROR,
    RendererMountReadinessState.READY_FOR_MODEL,
    RendererMountReadinessState.MOUNT_ERROR,
    RendererMountReadinessState.UNMOUNTED,
  ],
  [RendererMountReadinessState.MODEL_LOADED]: [
    RendererMountReadinessState.LOADING_MODEL,
    RendererMountReadinessState.READY_FOR_MODEL,
    RendererMountReadinessState.MODEL_ERROR,
    RendererMountReadinessState.MOUNT_ERROR,
    RendererMountReadinessState.UNMOUNTED,
  ],
  [RendererMountReadinessState.MODEL_ERROR]: [
    RendererMountReadinessState.LOADING_MODEL,
    RendererMountReadinessState.READY_FOR_MODEL,
    RendererMountReadinessState.UNMOUNTED,
  ],
  [RendererMountReadinessState.MOUNT_ERROR]: [
    RendererMountReadinessState.MOUNTING,
    RendererMountReadinessState.UNMOUNTED,
  ],
}

/**
 * Whether a mount in this state can accept a cue right now.
 *
 * Only two states are ready: `READY_FOR_MODEL` (a stage that can take a load) and `MODEL_LOADED`.
 * Everything else is transitional or failed, and a cue that arrives then is refused
 * (`CueRejection.RENDERER_NOT_READY`) or, with `dropIfNotReady`, settled by the host without being
 * delivered.
 */
export function isReady(state: RendererMountReadinessState): boolean {
  return state === RendererMountReadinessState.READY_FOR_MODEL
    || state === RendererMountReadinessState.MODEL_LOADED
}

/**
 * Whether a mount may report `to` while it is in `from`.
 *
 * Returns `true` for a redundant report of the same state (an idempotent re-emit) and for any
 * declared edge in `READINESS_TRANSITIONS`. Everything else is an illegal transition, which a host
 * decides what to do about — in development it is worth surfacing, in production the report is
 * dropped rather than trusted.
 */
export function isReadinessTransitionAllowed(
  from: RendererMountReadinessState,
  to: RendererMountReadinessState,
): boolean {
  return from === to || READINESS_TRANSITIONS[from].includes(to)
}

export enum ContractFailureCode {
  /**
   * The renderer cannot read this input at all: it has no path for the payload (unreadable,
   * truncated, a container it cannot open).
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
   * cannot report its own absence. Renamed from `renderer-unavailable` at contract `0.1`, because
   * the missing thing is the driver, not one of its mounts.
   */
  DRIVER_UNAVAILABLE = 'driver-unavailable',
  /** A host service the renderer requires was not provided at activation. */
  HOST_SERVICE_MISSING = 'host-service-missing',
  /**
   * The import would replace a model that already exists under the same id.
   *
   * Only an explicit `overwrite` (a user "replace" action) may bypass this; a normal import must
   * surface the conflict instead of minting a silent duplicate. The migration path never sets it —
   * migration's import *is* the create (D8), so there is nothing to overwrite.
   */
  MODEL_ID_CONFLICT = 'model-id-conflict',
  /**
   * The host refuses to remove a model a character still binds.
   *
   * The host, not the driver, is the side that knows what a card references, so it answers first and
   * carries the evidence in `ContractFailure.references`.
   */
  MODEL_REFERENCED = 'model-referenced',
  /** The host refuses to remove a profile a character still binds. Evidence in `references`. */
  PROFILE_REFERENCED = 'profile-referenced',
  /**
   * The binding is internally incomplete: it names a model that resolves and a profile that does
   * not. Unlike a missing model this *is* an error, because the character holds a self-inconsistent
   * reference rather than losing one (`UnavailableModelReason.PROFILE_MISSING`).
   */
  PROFILE_MISSING = 'profile-missing',
  /** The renderer could not encode its canvas for a `CaptureCue`. */
  CAPTURE_FAILED = 'capture-failed',
  /** The operation did not settle before the broker's deadline. */
  TIMEOUT = 'timeout',
  /**
   * The envelope is not one the broker can route.
   *
   * Used when the transaction is malformed as a transaction rather than as a cue: a `capture`
   * sharing its envelope with other cues (capture must be alone, because its failure is a
   * whole-send error), a non-persistent `load`/`reset`/`caption`, or no routable target at all.
   * Nothing is delivered, so no renderer sees a half-valid transaction.
   */
  INVALID_ENVELOPE = 'invalid-envelope',
  /**
   * The manager named an entry the adapter cannot import, or named none at all.
   *
   * The adapter imports what the manager named and makes no entry decision of its own; an unknown
   * specifier is this failure with a readable reason, never a silent fallback.
   */
  INVALID_ENTRYPOINT = 'invalid-entrypoint',
  /**
   * The work was abandoned, and nothing took its place: the mount was disposed or the
   * renderer disabled while the operation was in flight, or the caller aborted it.
   *
   * Deliberately not `CueRejection.SUPERSEDED`, which is the normal case — a newer
   * transaction for the same mount made this one moot, the send still succeeds, and only
   * that slot goes unapplied. A renderer MUST NOT report one as the other.
   */
  ABORTED = 'aborted',
  /**
   * The work was withdrawn **before it started**, so it will not be performed at all.
   *
   * The distinction from `aborted` is the one RFC §9.4 and §9.7 draw: `cancelled` never ran,
   * `aborted` ran and was stopped. A renderer MUST NOT report one as the other, and a broker
   * settling an undelivered transaction settles this one.
   */
  CANCELLED = 'cancelled',
  /**
   * The window that received the transaction went away.
   *
   * Distinct from `aborted` because nothing inside the window decided it: the host unregistered the
   * mount and settles what it still holds — `cancelled` if it was never delivered, `window-gone` if
   * it was. A caller can then tell "the app closed a viewport" from "the driver refused to stop".
   */
  WINDOW_GONE = 'window-gone',
  /**
   * The driver was built against a contract revision this host cannot speak.
   *
   * Raised when the host reads the declaration, before any driver code runs, so no service container
   * is ever built for it.
   */
  CONTRACT_VERSION_MISMATCH = 'contract-version-mismatch',
  /** An unexpected failure inside the renderer, with nothing more specific to report. */
  INTERNAL = 'internal',
}

/**
 * Evidence that something still references the record a removal was asked to delete.
 *
 * Carried on `ContractFailure.references` beside `MODEL_REFERENCED` / `PROFILE_REFERENCED` so the
 * refusal can *name* the character instead of saying "in use" — the user's next action is to change
 * that character, and the evidence is what lets the UI offer it.
 */
export interface HostReferenceEvidence {
  characterId: CharacterId
  characterName?: string
  modelId?: ModelId
  profileId?: ModelProfileId
}

export interface ContractFailure {
  code: ContractFailureCode
  message: string
  /** Renderer-specific evidence (validator findings, parser output). Opaque to AIRI. */
  details?: unknown
  /** The error this failure came from, when there was one. Opaque to AIRI, carried for diagnostics. */
  cause?: unknown
  /**
   * Who still references the record a removal was asked to delete.
   *
   * Present only on `MODEL_REFERENCED` / `PROFILE_REFERENCED`, and only because the host — the side
   * that owns character records — can answer it. A driver never produces it.
   */
  references?: HostReferenceEvidence[]
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
 * The error branch means **attempted and cannot fulfill the request**.
 * "There is nothing to remove" and "I may choose not to answer"
 * are successes whose value says so, the same rule `CueRejection` follows.
 */
export type ContractResult<T>
  = | { ok: true, value: T }
    | { ok: false, error: ContractFailure }

/**
 * Which host surface a mount lives on.
 *
 * A **label on the descriptor, not a routing key**: several mounts can share one surface (the actor
 * window and a chat-side stage are both `stage`), so the host never resolves a surface to "the"
 * mount. A cue names a driver plus this label (and optionally a purpose), and the broker delivers to
 * every mount that matches.
 *
 * `ACTING` is the standalone acting window; the value reads `'acting'`, matching the purpose of the
 * same name (renamed from `ACTOR` at contract `0.1`, D-review rename in RFC §8.2).
 */
export enum RendererMountSurfaceKind {
  STAGE = 'stage',
  PREVIEW = 'preview',
  ACTING = 'acting',
  REHEARSAL = 'rehearsal',
}

/**
 * Why a mount exists, as the interface that created it already knows.
 *
 * Separate from `RendererMountSurfaceKind` because the two answer different questions and cannot
 * stand in for each other: a surface says which host surface the viewport sits on, while this says
 * what the mount is *for*. Two live mounts share one surface (`acting` and `chat` are both the live
 * stage) and differ here, which is exactly the ambiguity this value removes — "which of the two
 * stages is the live one" has no answer, and nothing may try to infer it from ordering.
 */
export enum RendererMountPurpose {
  /** The live stage the user sees; several may exist at once. */
  STAGE = 'stage',
  /** The standalone acting window. Renamed from `ACTOR` at contract `0.1`. */
  ACTING = 'acting',
  /** The stage embedded in the chat workspace. */
  CHAT = 'chat',
  /** The rehearsal room's sandbox. */
  REHEARSAL = 'rehearsal',
  /** A settings/card-editor preview: never the live stage, never persisted. */
  PREVIEW = 'preview',
}

/**
 * A point inside a mount's **drawing box**, in CSS pixels measured from that box's top-left
 * corner: exactly `clientX - box.getBoundingClientRect().left`.
 *
 * The box is the element the host mounted the renderer into. That element's size **is** the
 * viewport: it is the only size the contract has, the host passes none, and a mount measures its own
 * container (`RendererMountProps` carries no `viewport` member).
 *
 * AIRI converts the raw DOM event exactly **once**, no `devicePixelRatio` multiplication,
 * no normalization into the box's width and height, no translation into the model's own space.
 * Each of those depends on how the renderer drew, so the renderer does them.
 * A value here may fall outside the box: a captured gesture keeps reporting
 * after the pointer leaves, so negative and over-range coordinates are legitimate.
 *
 * Nothing in the contract is measured against the window, the page, or a canvas backing
 * store.
 */
export interface RendererMountPoint {
  x: number
  y: number
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
 */
export interface ModelPreview {
  blob: Blob
  /** Intrinsic pixel size, so a catalog can lay a row out before the image decodes. */
  width?: number
  height?: number
}

/**
 * Who made a model, stored with the model.
 *
 * A driver almost always knows this and AIRI almost never can guess it, so it travels with the model
 * (`ModelDescriptor.author`) and AIRI keeps a copy on its own record. One structure rather than a
 * lone `authorIcon` field, because a thumbnail with no name behind it cannot be attributed once the
 * driver that produced it is gone — and that is exactly when a catalog still has to draw the
 * row.
 *
 * Same reasoning as `ModelPreview`: a renderer constructs one, so it is a shape both sides share.
 */
export interface ModelAuthor {
  /** Display name, as the author or the model's source presents it. */
  name: string
  /**
   * Avatar shown next to the name.
   *
   * Same shape as a model thumbnail so both can be cached, stored and drawn the same way.
   * Optional: a name without an avatar is attribution; an avatar without a name is not.
   */
  icon?: ModelPreview
  /** Author or source page. A link AIRI may offer, never something it fetches. */
  url?: string
}
