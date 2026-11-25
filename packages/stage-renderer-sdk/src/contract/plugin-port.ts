/**
 * The plugin-level speech analyzer.
 *
 * Deliberately in this package but **not part of the driver contract**: lip sync used to be a
 * driver concern (`HostAudioInterface`, an `AudioNode` on the mount), which cannot work once the
 * audio graph and the renderer live in different windows. What replaces it is a stream the host
 * broadcasts and any renderer may subscribe to, so a renderer still gets lip sync without ever
 * holding an audio node.
 *
 * Owner: AIRI implements the registry and the tap. A model driver consumes frames through its
 * plugin, not through `HostServices`.
 */
import type { ContractResult, Unsubscribe } from './shared'

/**
 * One low-rate speech analysis result.
 *
 * This is a **stream sample, not a cue**: it is latest-wins, carries no ack, and MUST NOT be sent
 * through `CueChannel` (a per-frame cue would allocate an ack per frame).
 */
export interface SpeechAnalysisFrame {
  /** Host clock, milliseconds. */
  at: number
  /** Root-mean-square amplitude of the analysed window, 0..1. */
  rms: number
  /**
   * Mouth openness, 0..1, when the analyzer can produce one.
   *
   * Absent means "this analyzer has no mouth concept", which is different from `0` ("mouth
   * closed"). A renderer MUST distinguish the two.
   */
  mouthOpen?: number
  /** Optional viseme id from the analyzer's own vocabulary. */
  viseme?: string
}

/** What a plugin hands the host to register an analyzer. */
export interface SpeechAnalyzerRegistration {
  /** The plugin that owns the analyzer, for diagnostics and unregister-on-disable. */
  pluginId: string
  /**
   * Module specifier resolved by the host's renderer-side loader.
   *
   * The module must export a factory the host calls with the host's audio graph; it is loaded in
   * the window that owns that graph, never in the Electron main process.
   */
  entry: string
  /** Analyzer-specific options, opaque to the host. */
  options?: Record<string, unknown>
}

/**
 * The host's analyzer registry and result stream.
 *
 * A plugin registers one analyzer per audio source; the host owns the graph, the tap and the
 * broadcast. The service is **plugin-level, not part of `HostServices`**: the model
 * renderer contract no longer knows about audio or speech at all.
 */
export interface HostSpeechAnalyzerService {
  register: (input: SpeechAnalyzerRegistration) => Promise<ContractResult<{ analyzerId: string }>>
  /** Stop analysing and release the tap. Idempotent: an unknown id is a successful no-op. */
  unregister: (analyzerId: string) => Promise<void>
  /** Subscribe to the frames produced by the active analyzer. */
  subscribe: (handler: (frame: SpeechAnalysisFrame) => void) => Unsubscribe
}
