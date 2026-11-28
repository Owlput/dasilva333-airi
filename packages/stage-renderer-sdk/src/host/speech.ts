/**
 * Speech frames: the observation stream a driver subscribes to for lip sync (§5.5, §12, D3).
 *
 * Three rules, and this module is where they are enforced rather than documented:
 *
 *   1. **A frame is not a cue.** It is latest-wins, carries no ack and is never submitted to the broker: a
 *      per-frame transaction would allocate a settlement per frame and turn a 30 Hz stream into 30 ledger entries
 *      a second. The bus has no access to a `CueChannel` at all, which is what makes the rule structural — there
 *      is no member here that could send one.
 *   2. **Frames are observation traffic between adapters.** A window publishes into the broadcast port the
 *      embedder supplies (a `BroadcastChannel` in an app, a loopback in a test); other windows receive and fan out
 *      locally. There is no ack, no retention and no settlement, and nothing waits for a frame to be seen.
 *   3. **One documented main crossing.** The Stage-Mate Unity sidecar consumes the same frames over a bridge that
 *      lives in main, so the sidecar relay is the *only* port whose implementation may leave the process. It
 *      still carries no ack and no settlement — an ack that can be lost is not an ack (D3).
 *
 * The analyzer itself (an `AudioContext` tap) lives in the window that owns the audio graph, which is the
 * ControlStripHost window. It publishes here; nothing in this file touches audio, Web Audio or a device.
 */
import type { SpeechAnalysisFrame } from '../contract/plugin-port'
import type { Unsubscribe } from '../contract/shared'

import { ContractFailureCode } from '../contract/shared'

/** The transport a frame takes between windows. An app supplies a `BroadcastChannel`; a test a loopback. */
export interface SpeechFrameBroadcast {
  post: (frame: SpeechAnalysisFrame) => void
  onMessage: (handler: (frame: SpeechAnalysisFrame) => void) => Unsubscribe
}

/** What a producer may omit: the frame's clock is stamped here, once, so two windows cannot disagree about it. */
export type SpeechFrameInput = Omit<SpeechAnalysisFrame, 'at'> & { at?: number }

export interface SpeechFrameBusOptions {
  /** Inter-window observation transport. Absent means this window both produces and consumes only locally. */
  broadcast?: SpeechFrameBroadcast
  /**
   * The Stage-Mate sidecar relay — the single documented main-crossing hop (§5.5).
   *
   * Deliberately a port with its own name rather than a second broadcast: a reader of this file can see that
   * exactly one member reaches main, and a test can count what it received.
   */
  sidecarRelay?: (frame: SpeechAnalysisFrame) => void
  /** Host clock, so a test can make frames deterministic. */
  now?: () => number
}

export interface SpeechFrameBus {
  /**
   * Publish one frame from this window's analyzer.
   *
   * Latest-wins: nothing is queued, and a subscriber that is slow simply misses a frame — which is the correct
   * behaviour for a value the renderer interpolates toward in its own frame loop.
   */
  publish: (input: SpeechFrameInput) => SpeechAnalysisFrame
  /** Receive the frames this window produces *and* those another window broadcast. */
  subscribe: (handler: (frame: SpeechAnalysisFrame) => void) => Unsubscribe
  /** The last frame seen, for diagnostics only. Never replayed to a late subscriber. */
  latest: () => SpeechAnalysisFrame | undefined
  /** Frames handed to the sidecar relay since this bus was created. */
  relayedToSidecar: () => number
  dispose: () => void
}

/**
 * Whether a value is a speech frame.
 *
 * A frame that is not one must never be fanned out: a driver's lip sync would drive from a malformed value and
 * the failure would show up as a rendering artefact rather than as the transport bug it is.
 */
export function isSpeechAnalysisFrame(value: unknown): value is SpeechAnalysisFrame {
  if (typeof value !== 'object' || value === null)
    return false
  const frame = value as Record<string, unknown>
  if (typeof frame.at !== 'number' || !Number.isFinite(frame.at))
    return false
  if (typeof frame.rms !== 'number' || !Number.isFinite(frame.rms))
    return false
  if (frame.mouthOpen !== undefined && (typeof frame.mouthOpen !== 'number' || !Number.isFinite(frame.mouthOpen)))
    return false
  if (frame.viseme !== undefined && typeof frame.viseme !== 'string')
    return false
  return true
}

/**
 * The failure a producer gets for a malformed frame.
 *
 * Returning a code rather than throwing keeps the producer's audio callback honest: an analyzer that produces a
 * `NaN` rms should drop one frame, not crash the window that is also drawing the stage.
 */
export function validateSpeechFrame(value: unknown): { ok: true, value: SpeechAnalysisFrame } | { ok: false, code: ContractFailureCode, message: string } {
  if (!isSpeechAnalysisFrame(value))
    return { ok: false, code: ContractFailureCode.INVALID_ENVELOPE, message: 'A speech frame needs a finite `at` and `rms`; `mouthOpen` and `viseme` are optional' }
  if (value.mouthOpen !== undefined && (value.mouthOpen < 0 || value.mouthOpen > 1))
    return { ok: false, code: ContractFailureCode.INVALID_ENVELOPE, message: '`mouthOpen` is 0..1; omit it when the analyzer has no mouth concept rather than sending a sentinel' }
  return { ok: true, value }
}

export function createSpeechFrameBus(options: SpeechFrameBusOptions = {}): SpeechFrameBus {
  const { broadcast, sidecarRelay } = options
  const now = options.now ?? (() => Date.now())

  const handlers = new Set<(frame: SpeechAnalysisFrame) => void>()
  let latest: SpeechAnalysisFrame | undefined
  let relayed = 0

  const fanOut = (frame: SpeechAnalysisFrame) => {
    latest = frame
    for (const handler of [...handlers]) {
      try {
        handler(frame)
      }
      catch {
        // A subscriber that throws must not stop the other subscribers or the analyzer that produced the frame.
      }
    }
  }

  const unsubscribeBroadcast = broadcast?.onMessage((frame) => {
    // A frame another window produced reaches this window's subscribers, and is not re-broadcast: a loop would
    // multiply frames by the number of windows.
    if (isSpeechAnalysisFrame(frame))
      fanOut(frame)
  })

  return {
    publish(input) {
      const frame: SpeechAnalysisFrame = { ...input, at: input.at ?? now() }
      const validated = validateSpeechFrame(frame)
      if (!validated.ok) {
        // A malformed frame is dropped rather than fanned out; the producer owns its analyzer's arithmetic.
        return frame
      }

      const value = validated.value
      fanOut(value)
      broadcast?.post(value)

      // The sidecar relay is the one hop that reaches main. It carries the same frame, with no ack: the sidecar
      // missing a frame is a dropped frame, not a failed transaction.
      if (sidecarRelay) {
        try {
          sidecarRelay(value)
          relayed += 1
        }
        catch {
          // The sidecar being gone must not silence the stage's own lip sync.
        }
      }

      return value
    },

    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },

    latest: () => latest,
    relayedToSidecar: () => relayed,

    dispose() {
      handlers.clear()
      unsubscribeBroadcast?.()
    },
  }
}

/**
 * Reject a cue that claims to carry a speech frame.
 *
 * The invariant §8.5 guard 10 protects is "no speech frame ever travels as a cue". The bus cannot send one; this
 * function is the other half — a cue envelope whose kind is a speech frame, or whose payload carries the frame's
 * fields, is refused with a readable reason instead of being delivered to a mount.
 */
export function assertNotSpeechCue(payload: unknown): { ok: true } | { ok: false, code: ContractFailureCode, message: string } {
  if (typeof payload !== 'object' || payload === null)
    return { ok: true }

  const record = payload as Record<string, unknown>
  if (record.kind === 'speech-frame' || record.kind === 'speech') {
    return {
      ok: false,
      code: ContractFailureCode.INVALID_ENVELOPE,
      message: 'A speech frame is observation traffic, not a cue: subscribe to the frame bus instead',
    }
  }

  if (record.rms !== undefined || record.mouthOpen !== undefined) {
    return {
      ok: false,
      code: ContractFailureCode.INVALID_ENVELOPE,
      message: 'A cue payload carries no `rms`/`mouthOpen`: speech frames never travel as cues',
    }
  }

  return { ok: true }
}
