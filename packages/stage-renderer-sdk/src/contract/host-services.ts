/**
 * Services the host injects into a model driver at activation.
 *
 * Owner: AIRI implements these; the driver consumes them and MUST NOT reach around them.
 *
 * This container is the **pull** side: a renderer reads what it needs when it needs it, and
 * everything here is either an app-global fact or a capability the renderer may decline.
 * The one push member is `prompt`, because the renderer is the only thing that knows what the model
 * currently has on — and it is also the one member the host hands something *back* through, once a
 * prompt conflict has been resolved (D26).
 */
import type { CueChannel } from './cues'
import type { ModelId, ModelProfileId } from './model'
import type {
  ContractResult,
  MaybePromise,
  ModelDriverContractVersion,
  ModelDriverId,
  RendererMountPoint,
  Unsubscribe,
} from './shared'

export interface HostLogger {
  debug: (scope: string, ...args: unknown[]) => void
  info: (scope: string, ...args: unknown[]) => void
  warn: (scope: string, ...args: unknown[]) => void
  error: (scope: string, ...args: unknown[]) => void
}

/**
 * Driver-scoped persistent storage primitives.
 *
 * **Isolation is per driver, and the host enforces it.** The driver passes a relative key; the host
 * adds the driver's prefix on the way in and strips it on the way out, and `keys()` returns only
 * keys of this driver. A driver therefore cannot name another driver's data even if it tries, and it
 * never learns where its own data physically lives.
 *
 * A handle is **per instance, not per driver**: every mount, panel, model picker and lightweight
 * provider instance is handed its own object, and all of them address the same namespace. How the
 * driver divides that namespace — one blob per model, one key per setting — is its own business;
 * AIRI never reads a key, never interprets a value, and never restores one.
 *
 * `watch` is what makes cross-window settings work: a panel in the settings window writes, and the
 * mount in the actor window is notified without either knowing about the other.
 */
export interface HostStorageInterface {
  get: <T>(key: string) => MaybePromise<T | undefined>
  set: <T>(key: string, value: T) => MaybePromise<void>
  remove: (key: string) => MaybePromise<void>
  keys: () => MaybePromise<string[]>
  /** Observe writes to one key in this driver's namespace. */
  watch: <T>(key: string, handler: (value: T | undefined) => void) => Unsubscribe
}

/** Which kind of pointer event this is. */
export enum RendererPointerPhase {
  ENTER = 'enter',
  MOVE = 'move',
  LEAVE = 'leave',
  DOWN = 'down',
  UP = 'up',
  CANCEL = 'cancel',
  WHEEL = 'wheel',
}

/** What produced a pointer event. */
export enum RendererPointerType {
  MOUSE = 'mouse',
  TOUCH = 'touch',
  PEN = 'pen',
  UNKNOWN = 'unknown',
}

/** How the deltas of a `RendererPointerPhase.WHEEL` event are measured. */
export enum RendererWheelMode {
  PIXEL = 'pixel',
  LINE = 'line',
  PAGE = 'page',
}

/**
 * One pointer event, inside the drawing box of the mount it is addressed to.
 *
 * An event rather than a value: a position alone cannot express a press, a release, a wheel or a
 * second finger, and *which* of those happened is what a renderer needs.
 *
 * `point` is in `RendererMountPoint` space — box-relative CSS pixels, converted host-side exactly
 * once — and the renderer maps it onward from there itself.
 */
export interface RendererPointerEvent {
  phase: RendererPointerPhase
  /**
   * Pointer identity: stable for the whole down/move/up sequence of one pointer, and distinct per
   * touch point, so a renderer can tell two fingers apart instead of guessing.
   */
  pointerId: number
  /** What produced the event; `RendererPointerType.UNKNOWN` when the platform does not say. */
  pointerType: RendererPointerType
  /** Where, inside this mount's drawing box. */
  point: RendererMountPoint
  /**
   * Bitmask of the buttons held when the event happened, as `PointerEvent.buttons` reports it:
   * `0` for hover, wheel, and every touch.
   */
  buttons: number
  /**
   * Which button changed, for `'down'` and `'up'` only, and absent otherwise — `0` is the primary
   * button, so a `0` on an event that has no button would be a value with no meaning.
   */
  button?: number
  /** Wheel motion, for `phase: RendererPointerPhase.WHEEL` only. */
  wheel?: {
    deltaX: number
    deltaY: number
    deltaZ: number
    mode: RendererWheelMode
  }
  /**
   * Modifier state at the moment of the event.
   *
   * A trackpad pinch arrives as `wheel` with `ctrl`, which is the only way to tell it from a scroll on
   * those devices, so a renderer that wants pinch-to-zoom has to read it here.
   */
  modifiers: { alt: boolean, ctrl: boolean, meta: boolean, shift: boolean }
  /** Host clock, so a gesture can be timed without reaching for a clock of the renderer's own. */
  at: number
}

/**
 * Pointer input for the mounted renderers.
 *
 * This is the service through which pointer input reaches a renderer, and the only route when the
 * events happen **outside the renderer's own window** — a gesture captured while the pointer is over
 * another window, for instance. A runtime MAY attach listeners of its own inside its own window;
 * what it must not do is convert the same events a second time, because a second conversion is a
 * second coordinate space nothing can reconcile with the first.
 *
 * **Per mount, not per plugin.** A renderer instance can be mounted several times at once and each
 * mount has its own box, so a subscription names the mount it wants, using the `mountId` that mount
 * was handed as a prop. A subscription that were "global" would hand one box's coordinates to another
 * box's drawing.
 *
 * The stream is the input; the value a renderer interpolates toward is its own. A renderer keeps the
 * last `point` it received and moves toward it in its own frame loop, which is why this is an event
 * stream rather than a per-frame prop — the host has nothing to restate while the pointer is still.
 */
export interface RendererPointerService {
  /**
   * Receive this mount's pointer events.
   *
   * Only a mounted instance may subscribe, and the host quietly ignores a subscription naming an id it
   * did not mint for a live mount rather than delivering another mount's events or throwing. The
   * subscription ends when that mount unmounts; the returned `Unsubscribe` is how a renderer stops
   * listening earlier.
   *
   * Events keep arriving while a gesture is in progress even if the pointer leaves the box, so `point`
   * may be negative or beyond the box while `buttons` is non-zero.
   */
  subscribe: (mountId: string, handler: (event: RendererPointerEvent) => void) => Unsubscribe
}

export interface HostThemeService {
  /**
   * Accent hue in degrees.
   *
   * The host owns this value and a renderer only reads it — the one per-renderer-looking setting
   * where the split runs that way. Every other one (render scale, physics switches, blink/idle flags)
   * belongs to the renderer and lives in `services.storage`.
   */
  accentHue: number
  /** Same ownership as `accentHue`: the host's current light/dark choice. */
  isDark: boolean
  /** Notified when the user changes theme; renderers MUST re-tint. */
  onChange: (handler: () => void) => Unsubscribe
}

/** Severity of a transient message shown to the user. */
export enum HostToastLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

export interface HostUiService {
  /** Transient message for the user. */
  toast: (level: HostToastLevel, message: string) => void
  /**
   * Ask the user to confirm something destructive, or to answer a question only the driver can put
   * to them. The answer is the driver's to keep.
   */
  confirm?: (request: { title: string, body?: string, confirmLabel?: string }) => MaybePromise<boolean>
}

export interface HostI18nService {
  /** Resolve a key from the plugin's own bundle; `params` are interpolated. */
  t: (key: string, params?: Record<string, unknown>) => string
  locale: string
}

/** Which window or pane hosts this renderer instance. */
export enum HostWindowKind {
  MAIN = 'main',
  STAGE = 'stage',
  /** The standalone acting window (renamed from `ACTOR` at contract `0.1`). */
  ACTING = 'acting',
  SETTINGS = 'settings',
  PREVIEW = 'preview',
  UNKNOWN = 'unknown',
}

/**
 * Ambient facts about where the renderer is running.
 *
 * Only facts that cannot change while an instance is alive belong here. The host owns pausing (window
 * lifecycle, power throttling, a settings preview) and a renderer MUST never self-pause, but *which
 * mount* is paused is a decision about that mount, so pause, visibility, reduced motion and quality
 * are props on it (`RendererMountProps`) rather than ambient state.
 */
export interface HostRuntimeInfo {
  /**
   * Which container this renderer instance runs in. Deliberately wider than
   * `RendererMountSurfaceKind`: that one describes the surface being rendered, this one the window or
   * pane hosting it.
   */
  windowKind: HostWindowKind
  /** Debug switches surfaced by the host (e.g. caption tracing). */
  debug: Record<string, boolean>
}

/**
 * Platform bridge (Electron IPC, webview messaging).
 *
 * The host determines what underlying channel is used, and SHOULD provide best-effort delivery.
 *
 * It is an **allowlist, not a raw pipe**: the host grants this driver the channels it declared, and
 * a channel outside that set fails rather than reaching the app's IPC surface. A driver is not
 * trusted to name arbitrary channels — the same reason its storage is namespaced.
 */
export interface HostBridge {
  send: (channel: string, payload?: unknown) => void
  invoke: <T>(channel: string, payload?: unknown) => Promise<T>
}

/** Diagnostics sink for a renderer's own trace events. */
export interface HostDiagnosticsSink {
  trace: (label: string, payload: Record<string, unknown>) => void
  enabled: boolean
}

/**
 * The prompt of one model **in one profile**, with the ACT token list that belongs to it.
 *
 * Text and tokens are one atomic pair with one `version`, because they are produced together and
 * because a list that disagrees with its text is worse than no list at all: AIRI extracts cues with
 * the tokens, so a stale pair makes the card play things the prompt no longer describes. There is
 * nowhere in the system where a text exists without its token list (D5).
 *
 * An empty publication — `text: ''`, `tokens: []` — is a **valid** value, stored as-is. It is how a
 * prompt-capable driver says "this model/profile has no guidance", and it is distinct from never
 * having published at all, which is a fault in a prompt-capable driver (`ModelDriverCapabilities.prompt`).
 */
export interface ModelPromptPublication {
  modelDriverId: ModelDriverId
  /** Which model this describes. */
  modelId: ModelId
  /** Which profile this describes: a prompt is per model **and** profile, never per model alone. */
  profileId: ModelProfileId
  /** The prompt text. AIRI neither parses it nor composes anything into it. */
  text: string
  /**
   * The ACT token list the text was written against.
   *
   * Plain strings, in the form the tokens appear in model output, because AIRI's marker parser
   * resolves them verbatim. Its shape is the driver's; AIRI only stores, injects and compares.
   */
  tokens: string[]
  /**
   * Monotonic per `(driver, model, profile)`, minted by the driver.
   *
   * The driver owns the monotonicity: AIRI compares versions and discards an older publication, and it
   * does not invent a version of its own — the one exception is a prompt the user arbitrated, where the
   * host writes `max(all versions seen) + 1` so the chosen copy is newer than both and the driver's next
   * publication continues from it (D26). The driver also **stores the prompt and tracks its
   * modifications** (its version history is the driver's record, not AIRI's); what AIRI holds is the
   * current copy it was given.
   */
  version: number
  /** Driver clock, milliseconds, when this was produced. */
  publishedAt: number
}

/**
 * The same pair as it lives on a character card.
 *
 * A **complete portable snapshot**, not a reference: it is what makes an authored prompt survive a
 * card export, a restore on another device and a driver reinstall, where neither the driver's own
 * storage nor AIRI's store is present. `modelId` and `profileId` are carried because a card can be
 * imported against a different binding and the pair must be recognized as belonging to another one
 * (`modelId`/`profileId` mismatch) rather than seeded over it.
 */
export type ModelPromptSnapshot = Pick<
  ModelPromptPublication,
  'modelId' | 'profileId' | 'text' | 'tokens' | 'version' | 'publishedAt'
>

/**
 * The host's prompt channel: the current model's prompt, as its driver wrote it.
 *
 * A service rather than a mount member, because the prompt outlives every mount: it has to be
 * publishable before the first mount of a model, and readable while nothing is mounted at all. It
 * replaces the host reading renderer stores to build a prompt, which could only ever describe
 * whichever renderer happened to be mounted in the same window.
 *
 * **The driver owns the prompt.** It mints the version, stores the pair and tracks its modifications —
 * the version history is the driver's record. AIRI keeps the current publication (so prompt assembly
 * never waits for a window), keeps the card's portable snapshot, and detects a disagreement between
 * those two; the bookkeeping of what a prompt used to be stays with the driver, which is why the
 * channel runs both ways: the host hands a resolved publication back through `onResolution`.
 *
 * **A prompt-capable driver MUST publish at least once per model and profile once it is activated**
 * (D5, D-17). Publishing is not gated on a mount and unmounting retracts nothing.
 */
export interface HostPromptService {
  /**
   * Publish the prompt and token list of one model in one profile.
   *
   * The host keeps the last publication per `(modelDriverId, modelId, profileId)`, discards one that
   * is not strictly newer, and writes it into a character card only while that model and profile are
   * the ones the character uses — so a driver that republishes a cached pair for a model the user
   * switched away from changes nothing visible, and switching back re-reads it.
   *
   * A character card with no model, or a model whose driver has published nothing, has no prompt.
   * That is a state, not an error: nothing falls back to another model's text.
   */
  publish: (publication: ModelPromptPublication) => void
  /**
   * Receive the publication the host resolved, after a user arbitration (§5.4).
   *
   * The host writes the winner with a version strictly newer than every copy it saw, then hands that
   * pair back here, so the driver's own history records what AIRI now holds and the driver's next
   * publication continues from that version rather than being discarded as stale.
   *
   * Register once, after activation. Returning `ok: false` says the driver could not record it — a
   * storage failure of its own — and is logged, never retried: the host has already committed the
   * resolution to the store and the card. A host with no arbitration surface (no such surface exists
   * yet) registers nothing and calls nothing; that is a missing capability, not an error.
   */
  onResolution: (handler: (publication: ModelPromptPublication) => MaybePromise<ContractResult<void>>) => Unsubscribe
}

/**
 * The complete service container handed to a model driver at activation.
 *
 * A renderer MUST treat a missing optional service as a reduction in capabilities, not as a crash:
 * what it cannot do under the resources actually in effect is answered by
 * `ModelDriverRuntime.rendererCapabilities()`, which the host reads before it offers the corresponding
 * UI.
 *
 * The contract revision is settled before this container exists: the host checks
 * `ModelDriverManifest.contractVersion` when it reads the manifest and refuses a plugin it cannot
 * speak to. AIRI MUST therefore never provide a container whose `contract` differs from the revision
 * it validated that manifest against — there is no downgrade path and no negotiated subset of this
 * interface.
 */
export interface HostServices {
  modelDriverId: ModelDriverId
  /**
   * The revision this plugin's manifest was validated against.
   *
   * Equal to `ModelDriverManifest.contractVersion` by construction. It is repeated here so a renderer
   * can branch on it without reaching for its own manifest, never so the two values can disagree.
   */
  contract: ModelDriverContractVersion
  log: HostLogger
  storage: HostStorageInterface
  /**
   * The prompt channel: publish the prompt of the model and profile you serve.
   *
   * There is deliberately no state channel next to it. AIRI keeps no per-model snapshot, reads no
   * renderer store and restores nothing: a driver's state is its own storage
   * (`HostStorageInterface`), and the only thing AIRI holds across a mount is the current model's
   * and profile's prompt, in the character card.
   */
  prompt: HostPromptService
  /** Cue bus shared by the host, all windows, and this renderer. */
  cues: CueChannel
  /**
   * Pointer input, delivered per mount.
   *
   * The one service route for pointer input (see `RendererPointerService` for the window-boundary
   * rule): a second conversion of one event is a second coordinate space that nothing can reconcile
   * with the first.
   */
  pointer: RendererPointerService
  theme: HostThemeService
  ui: HostUiService
  i18n: HostI18nService
  runtime: HostRuntimeInfo
  bridge?: HostBridge
  diagnostics?: HostDiagnosticsSink
}
