/**
 * Services the host injects into a renderer plugin at activation.
 *
 * Owner: AIRI implements these; the renderer consumes them and must not reach
 * around them.
 *
 * Purpose: every renderer in this workspace currently reaches for ambient host
 * state instead:
 *   - `stage-ui-three` and `stage-ui-mmd` deep-import `useAudioContext` from
 *     `stage-ui/src/stores/audio.ts` through an undeclared relative path;
 *   - `stage-ui-live2d` and `stage-ui-spine` sniff `window.location.hash` to
 *     decide whether audio may play, and Live2D builds its projection colour by
 *     reading a hidden DOM element's computed style;
 *   - Live2D calls `window.electron.ipcRenderer` directly for OS notifications;
 *   - Live2D requires the `Live2DCubismCore` global injected by each app's
 *     `index.html`; MMD attaches Ammo to `globalThis`.
 * None of that is available to a renderer installed from outside this monorepo,
 * so it becomes an injected service.
 */
import type { RendererCueChannel } from './cues'
import type {
  MaybePromise,
  RendererContractVersion,
  RendererId,
  Unsubscribe,
} from './shared'

export interface RendererLogger {
  debug: (scope: string, ...args: unknown[]) => void
  info: (scope: string, ...args: unknown[]) => void
  warn: (scope: string, ...args: unknown[]) => void
  error: (scope: string, ...args: unknown[]) => void
}

/**
 * Renderer-scoped persistent settings.
 *
 * Purpose: the host owns the namespace and the medium, so a renderer never
 * writes ambient keys itself. Today the four renderers own 60+ raw localStorage
 * keys (`settings/stage-ui-three/*`, `settings/live2d/*`, `settings/mmd/*`,
 * `settings/spine/*`) with two writers colliding on `settings/mmd/scale`, and
 * the host cannot enumerate them for backup. Declaring the values (see
 * `persistence.ts`) lets AIRI back them up as opaque payloads.
 */
export interface RendererSettingsStorage {
  get: <T>(key: string) => MaybePromise<T | undefined>
  set: <T>(key: string, value: T) => MaybePromise<void>
  remove: (key: string) => MaybePromise<void>
  keys: () => MaybePromise<string[]>
}

export interface RendererAudioService {
  /** The host's shared `AudioContext`, or `undefined` when audio is unavailable. */
  getContext: () => AudioContext | undefined
  /** Decoded voice source currently being spoken, when the host has one. */
  currentSource?: () => AudioBufferSourceNode | undefined
  /** Monotonic audio clock in seconds, for beat-aligned motion. */
  now: () => number
}

export interface RendererThemeService {
  /** Accent hue in degrees (Live2D tints drawables from it today). */
  accentHue: number
  isDark: boolean
  /** Notified when the user changes theme; renderers must re-tint. */
  onChange: (handler: () => void) => Unsubscribe
}

export interface RendererUiService {
  /** Transient message for the user. */
  toast: (level: 'info' | 'success' | 'warning' | 'error', message: string) => void
  /** OS-level notification, when the platform supports it. */
  notify?: (title: string, body?: string) => MaybePromise<void>
  /** Ask the user to confirm a destructive or licensed action. */
  confirm?: (request: { title: string, body?: string, confirmLabel?: string }) => MaybePromise<boolean>
  /**
   * Ask the user to pick one of several options.
   *
   * Purpose: the renderer has to present decisions AIRI cannot make for it — a
   * sync conflict (`resolveConflict` in `persistence.ts`) is the first case, and
   * the renderer must not build its own modal. Returns `undefined` when the user
   * dismisses the dialog without choosing.
   */
  choose?: <T>(request: RendererChoiceRequest<T>) => MaybePromise<T | undefined>
}

export interface RendererChoiceRequest<T> {
  title: string
  body?: string
  options: Array<{ value: T, label: string, description?: string }>
  /** Label for dismissing without choosing; the call then resolves `undefined`. */
  dismissLabel?: string
}

export interface RendererI18nService {
  /** Resolve a key from the plugin's own bundle; `params` are interpolated. */
  t: (key: string, params?: Record<string, unknown>) => string
  locale: string
}

/**
 * Ambient facts about where the renderer is running.
 *
 * Purpose: replaces `window.location.hash` sniffing and the ad-hoc "am I the
 * stage or the settings page" checks. Also carries the host's pause/visibility
 * decision: per this contract the host owns pausing (window lifecycle, power
 * throttling, settings preview), and a renderer must never self-pause.
 */
export interface RendererRuntimeInfo {
  /**
   * Which container this renderer instance runs in. Deliberately wider than
   * `StageSurfaceKind` (`stage.ts`): that one describes the surface being
   * rendered, this one the window or pane hosting it.
   */
  windowKind: 'main' | 'stage' | 'actor' | 'settings' | 'preview' | 'unknown'
  /** Host-decided visibility; a renderer should skip work when false. */
  visible: boolean
  /** Host-decided pause; renderers must honour it but not decide it. */
  paused: boolean
  reducedMotion?: boolean
  /** Debug switches surfaced by the host (e.g. caption tracing). */
  debug: Record<string, boolean>
}

/**
 * Optional platform bridge (Electron IPC, webview messaging).
 *
 * Purpose: replaces direct `window.electron.ipcRenderer` usage. Absent in plain
 * web builds, so renderers must degrade instead of assuming it exists.
 */
export interface RendererHostBridge {
  send: (channel: string, payload?: unknown) => void
  invoke: <T>(channel: string, payload?: unknown) => Promise<T>
}

/** Diagnostics sink for a renderer's own trace events. */
export interface RendererDiagnosticsSink {
  trace: (label: string, payload: Record<string, unknown>) => void
  enabled: boolean
}

/**
 * The complete service container handed to a renderer at activation.
 *
 * A renderer must treat a missing optional service as a reduction in features,
 * not as a crash: report it through the capability/feature flags it declared in
 * its manifest so the host can hide the corresponding UI.
 */
export interface RendererHostServices {
  rendererId: RendererId
  contract: RendererContractVersion
  log: RendererLogger
  storage: RendererSettingsStorage
  /** Cue bus shared by the host, all windows, and this renderer. */
  cues: RendererCueChannel
  audio: RendererAudioService
  theme: RendererThemeService
  ui: RendererUiService
  i18n: RendererI18nService
  runtime: RendererRuntimeInfo
  bridge?: RendererHostBridge
  diagnostics?: RendererDiagnosticsSink
}
