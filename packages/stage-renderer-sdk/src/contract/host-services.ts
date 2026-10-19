/**
 * Services the host injects into a model driver at activation.
 *
 * Owner: AIRI implements these; the driver consumes them and MUST NOT reach around them.
 *
 * This container is the **pull** side: a renderer reads what it needs when it needs it, and
 * everything here is either an app-global fact or a capability the renderer may decline. A **value**
 * the host samples every frame, and the live host decisions about one mount, are props on that mount
 * instead (`renderer-mount.ts`); a **stream of events** is a subscription here (`pointer`);
 * discrete intents travel as cues (`cues.ts`). The one push member is `prompt`, and it is push
 * because the renderer is the only thing that knows what the model currently has on.
 */
import type { CueChannel } from './cues'
import type { HostStateTransferPort } from './persistence'
import type {
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
 * Driver-scoped persistent storage, as primitives.
 *
 * The host owns the namespace and the medium, so a driver never writes ambient keys itself.
 *
 * It deliberately stops at primitives. Which keys exist, what shape their values have, which of them
 * are worth backing up and how an older value becomes a newer one are the driver's business, and AIRI
 * is never told any of it: `keys()` exists so the driver can enumerate its own namespace, not so the
 * host can. Backup and migration travel as one opaque bundle at driver scope
 * (`ModelDriverRuntime.export` / `import`).
 */
export interface HostStorageInterface {
  get: <T>(key: string) => MaybePromise<T | undefined>
  set: <T>(key: string, value: T) => MaybePromise<void>
  remove: (key: string) => MaybePromise<void>
  keys: () => MaybePromise<string[]>
}

/**
 * The host's audio graph, for a renderer that needs to listen to it.
 *
 * The host owns playback and the graph. A renderer only taps a node to analyse it: it MUST NOT
 * connect one to the destination, and MUST NOT start or stop anything through one, because another
 * mount or the host itself may be listening to the same node.
 *
 * **One stream, and it has its own method.** The only audio a renderer may tap is the speech the host
 * is playing, so this interface names it instead of taking a `kind` with a single legal value. Audio
 * captured from outside the app is deliberately absent: it is captured in its own window, and an
 * `AudioNode` cannot cross a realm, so a `CAPTURE` stream would have been a promise no host could
 * keep. Beats stay a host feature, not a contract member (`cues.ts` has no beat cue either).
 *
 * **Absence is not silence.** `undefined` (from `getSpeechStream`) and `null` (from
 * `onSpeechStreamChange`) mean there is no speech right now; a node currently producing zeros means
 * speech is running and the signal is quiet. A renderer that conflates the two either closes the
 * mouth through a pause mid-sentence or keeps a stale node alive past the utterance that owned it.
 */
export interface HostAudioInterface {
  /** The host's shared `AudioContext`, or `undefined` when audio is unavailable. */
  getContext: () => AudioContext | undefined
  /** Monotonic audio clock in seconds, for speech-aligned motion. */
  now: () => number
  /**
   * The node carrying the speech the host is playing, **one stream per utterance**, or `undefined`
   * when nothing is being said.
   *
   * Each utterance is its own node: it appears when speech starts and is followed by `null` on
   * `onSpeechStreamChange` when that utterance ends. A renderer attaches on every start rather than
   * caching a node, and closes its mouth on the `null` rather than holding the last shape — an
   * utterance that ended and an utterance that is quiet are different facts.
   *
   * The stream starting *is* the cue that speech began: a renderer derives lip movement from the
   * signal itself, which is why mouth openness is not a prop. The node lives in `getContext()`'s
   * graph, so a renderer attaches its own analyser to it and derives whatever it needs — envelope,
   * pitch, vowel — without the host sending a scalar.
   */
  getSpeechStream: () => AudioNode | undefined
  /**
   * Notified when speech begins (`node`) or stops (`null`).
   *
   * The end matters as much as the start. A renderer that mounts mid-utterance calls
   * `getSpeechStream` first and then subscribes.
   */
  onSpeechStreamChange: (handler: (node: AudioNode | null) => void) => Unsubscribe
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
 * This is the only pointer a renderer may read, and the only conversion of a DOM event into a
 * position: the host does it once, for one named mount, and a renderer MUST NOT attach a listener of
 * its own to obtain what it already receives here.
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
  ACTOR = 'actor',
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
 * Optional platform bridge (Electron IPC, webview messaging).
 *
 * Absent in plain web builds, so renderers MUST degrade instead of assuming it exists.
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
 * What one mounted model has active right now, said in the vocabulary AIRI already holds.
 *
 * **Push, not pull.** The renderer reports; AIRI decides what a prompt does with it. There is
 * deliberately no read path back into renderer state — `ModelScopedState.values` stays opaque — so
 * this publication is the only way a prompt can describe what the character currently looks like.
 *
 * **State, never prose.** `activeKeys` are `CapabilityVocabularyItem.key` values from this driver's
 * own vocabulary; the host renders them with the `label` it already stores, in wording it owns, in
 * the tail of the prompt. A driver that could submit text could also submit instructions, and a
 * contribution that changes every turn must not enter the cached prefix (`capabilities.ts` states
 * the same stability rule for `vocabulary`).
 */
export interface ModelDriverPromptState {
  /**
   * The state scope the publishing mount belongs to.
   *
   * The same key as the snapshot's, and the same rule: AIRI reads the **shared** scope's
   * publication — the live stage's first — so a preview's draft never becomes what a prompt
   * believes the model looks like. A scope that belongs to a single mount is not read at all.
   */
  stateScope: string
  /**
   * The capability keys active right now, as this driver's vocabulary lists them.
   *
   * A key the current vocabulary does not list is dropped by the host: the vocabulary is what a
   * prompt may name, so an unlisted key would be a name with no label behind it. An empty array is
   * how a renderer says that nothing is on.
   */
  activeKeys: string[]
}

/**
 * The host's prompt channel: what the model mounted in this process is doing right now.
 *
 * A service rather than a prop because the publication outlives any single cue, and because the
 * renderer is the only writer — AIRI never asks. It replaces the host reading renderer stores to
 * build a prompt, which could only ever describe whichever renderer happened to be mounted in the
 * same window.
 */
export interface HostPromptService {
  /**
   * Replace this scope's contribution, or clear it with an empty `activeKeys`.
   *
   * Only a **mounted** instance may publish, and only for its own `stateScope`; the host ignores a
   * publication naming a scope it did not mint for a live mount, and the last writer per scope wins.
   *
   * Publish what the model *is*, not what the user is still trying: an unconfirmed change travels on
   * a `persistent: false` cue and MUST NOT reach here, for the same reason it must not reach the
   * snapshot.
   */
  publish: (state: ModelDriverPromptState) => void
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
export interface ModelDriverHostServices {
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
   * The host's state channel: publish the snapshot your mounted instance produces, and read back the
   * scope it belongs to.
   *
   * It is a service rather than a member of the mount because a snapshot has to be readable while
   * nothing is mounted. Two rules hold: **only a mounted instance may call `writeSnapshot`**, and what
   * it publishes goes into its own `stateScope` (`persistence.ts`) — so a preview's state never
   * becomes the live stage's, and a panel edits the renderer's own store while the mount of its scope
   * publishes. What the user has not confirmed is not published at all: that is what `persistent:
   * false` on a cue expresses.
   */
  state: HostStateTransferPort
  /**
   * The prompt channel: publish what this model has active right now.
   *
   * It sits next to `state` because it shares that port's scope rules, and apart from it because
   * the snapshot is persist-shaped — revision-guarded, complete, and deliberately opaque in
   * `values` — while a prompt needs one volatile line that AIRI can word itself.
   */
  prompt: HostPromptService
  /** Cue bus shared by the host, all windows, and this renderer. */
  cues: CueChannel
  audio: HostAudioInterface
  /**
   * Pointer input, delivered per mount.
   *
   * The one place pointer events enter a renderer: it MUST NOT attach its own pointer, wheel or touch
   * listeners for input the host already routes here, because a second conversion of one event is a
   * second coordinate space that nothing can reconcile with the first.
   */
  pointer: RendererPointerService
  theme: HostThemeService
  ui: HostUiService
  i18n: HostI18nService
  runtime: HostRuntimeInfo
  bridge?: HostBridge
  diagnostics?: HostDiagnosticsSink
}
