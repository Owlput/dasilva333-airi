/**
 * Services the host injects into a model driver at activation.
 *
 * Owner: AIRI implements these; the driver consumes them and MUST NOT reach around them.
 *
 * This container is the **pull** channel: a renderer reads what it needs when it needs it, and
 * everything here is either an app-global fact or a capability the renderer may decline. A **value**
 * the host samples every frame, and the live host decisions about one mount, are props on that mount
 * instead (`renderer-mount.ts`); a **stream of events** is a subscription here (`pointer`);
 * discrete intents travel as cues (`cues.ts`).
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

export interface HostAudioInterface {
  /** The host's shared `AudioContext`, or `undefined` when audio is unavailable. */
  getContext: () => AudioContext | undefined
  /** Monotonic audio clock in seconds, for beat-aligned motion. */
  now: () => number
}

/** Which kind of pointer event this is. */
export type RendererPointerPhase = 'enter' | 'move' | 'leave' | 'down' | 'up' | 'cancel' | 'wheel'

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
  /** What produced the event; `'unknown'` when the platform does not say. */
  pointerType: 'mouse' | 'touch' | 'pen' | 'unknown'
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
  /** Wheel motion, for `phase: 'wheel'` only. */
  wheel?: {
    deltaX: number
    deltaY: number
    deltaZ: number
    mode: 'pixel' | 'line' | 'page'
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

export interface HostUiService {
  /** Transient message for the user. */
  toast: (level: 'info' | 'success' | 'warning' | 'error', message: string) => void
  /** Ask the user to confirm a destructive or licensed action. */
  confirm?: (request: { title: string, body?: string, confirmLabel?: string }) => MaybePromise<boolean>
}

export interface HostI18nService {
  /** Resolve a key from the plugin's own bundle; `params` are interpolated. */
  t: (key: string, params?: Record<string, unknown>) => string
  locale: string
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
  windowKind: 'main' | 'stage' | 'actor' | 'settings' | 'preview' | 'unknown'
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
