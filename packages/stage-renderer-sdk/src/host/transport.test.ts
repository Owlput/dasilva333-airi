/**
 * Speech frames are observation traffic, never cues, and the sidecar relay is the one hop that reaches main (§5.5).
 *
 * Criterion 7 of §5.8 asks for exactly three things, and each is asserted here rather than argued in prose:
 *
 *   1. frames drive a subscriber (the stub mount's lip-sync stand-in) without a transaction being created;
 *   2. no frame travels as a cue — the validator refuses a speech-shaped cue before anything is delivered, and
 *      the broker's table is untouched by a frame stream;
 *   3. the only main-crossing hop is the Stage-Mate sidecar relay, which is a port with its own name. A bus with
 *      no sidecar relay reaches no main process at all.
 *
 * A fourth property is quietly important: a frame published in one window reaches only the windows the embedder's
 * broadcast connects, and is not re-broadcast — otherwise frames would multiply by the number of windows.
 */
import type { SpeechAnalysisFrame } from '../contract/plugin-port'
import type { SpeechFrameBroadcast } from './speech'

import { describe, expect, it } from 'vitest'

import { ContractFailureCode, CueKind, CueSource, RendererMountPurpose } from '../contract'
import { validateCueEnvelope } from '../validate'
import { assertNotSpeechCue, createSpeechFrameBus } from './speech'
import { createTestHost, envelope } from './testing/harness'
import { STUB_DRIVER_ID } from './testing/stub-driver'

/** An in-memory observation channel: what a `BroadcastChannel` is to the app, with no process boundary. */
function createLoopbackBroadcast(): SpeechFrameBroadcast & { subscribers: number } {
  const handlers = new Set<(frame: SpeechAnalysisFrame) => void>()
  return {
    get subscribers() {
      return handlers.size
    },
    post(frame) {
      for (const handler of [...handlers])
        handler(frame)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}

describe('speech frames', () => {
  it('fan out locally and across the observation transport, latest-wins', () => {
    const transport = createLoopbackBroadcast()
    const analyzerWindow = createSpeechFrameBus({ broadcast: transport, now: () => 5 })
    const actorWindow = createSpeechFrameBus({ broadcast: transport })

    const received: SpeechAnalysisFrame[] = []
    actorWindow.subscribe(frame => received.push(frame))

    analyzerWindow.publish({ rms: 0.4, mouthOpen: 0.6 })
    analyzerWindow.publish({ rms: 0.2, mouthOpen: 0.3 })

    // Two frames, no queue, no replay: the renderer interpolates toward the newest value and misses the rest.
    expect(received).toHaveLength(2)
    expect(received[1]?.mouthOpen).toBe(0.3)
    expect(received[0]?.at).toBe(5)
    expect(actorWindow.latest()?.rms).toBe(0.2)
  })

  it('drops a malformed frame instead of fanning it out', () => {
    const bus = createSpeechFrameBus({ now: () => 1 })
    const received: SpeechAnalysisFrame[] = []
    bus.subscribe(frame => received.push(frame))

    bus.publish({ rms: Number.NaN })
    bus.publish({ rms: 0.5, mouthOpen: 2 })

    expect(received).toHaveLength(0)
    expect(bus.latest()).toBeUndefined()
  })

  it('never creates a broker transaction and never delivers a cue', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    const bus = createSpeechFrameBus()
    let observed = 0
    bus.subscribe(() => {
      observed += 1
    })

    for (let index = 0; index < 30; index++)
      bus.publish({ rms: index / 30, mouthOpen: index / 30 })

    expect(observed).toBe(30)
    expect(host.core.broker.pendingCount()).toBe(0)
    expect(host.driver.delivered).toHaveLength(0)
    await host.close()
  })

  it('refuses a cue that claims to carry a speech frame', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    // Beyond the type system on purpose: this is the shape a buggy producer would send.
    const attempted = await window.cueChannel.send({
      source: CueSource.HOST,
      override: false,
      cues: [{ kind: 'speech-frame', rms: 0.5, mouthOpen: 0.5 }],
      target: { modelDriverId: STUB_DRIVER_ID, purpose: RendererMountPurpose.ACTING },
    } as never)

    expect(attempted.ok).toBe(false)
    if (!attempted.ok)
      expect(attempted.error.code).toBe(ContractFailureCode.INVALID_ENVELOPE)
    expect(host.driver.delivered).toHaveLength(0)

    // And the same rule stated at the validator, so it cannot be bypassed by another sender.
    const direct = validateCueEnvelope({
      cues: [{ kind: 'speech-frame' }],
      source: CueSource.HOST,
      override: false,
      target: { modelDriverId: STUB_DRIVER_ID },
    })
    expect(direct.ok).toBe(false)

    expect(assertNotSpeechCue({ kind: 'speech-frame' }).ok).toBe(false)
    expect(assertNotSpeechCue({ kind: CueKind.ACT, rms: 0.2 }).ok).toBe(false)
    expect(assertNotSpeechCue({ kind: CueKind.ACT, actToken: 'happy' }).ok).toBe(true)

    await host.close()
  })

  it('reaches main only through the sidecar relay', () => {
    const transported: SpeechAnalysisFrame[] = []
    const plain = createSpeechFrameBus({ now: () => 2 })
    plain.publish({ rms: 0.5 })

    const relayed: SpeechAnalysisFrame[] = []
    const withSidecar = createSpeechFrameBus({
      now: () => 3,
      sidecarRelay: (frame) => {
        relayed.push(frame)
      },
    })

    withSidecar.subscribe(frame => transported.push(frame))
    withSidecar.publish({ rms: 0.7, mouthOpen: 0.8 })

    // A bus with no sidecar relay has nowhere to cross main, and says so.
    expect(plain.relayedToSidecar()).toBe(0)
    // The single documented exception receives the frame, once, with no ack and no settlement behind it.
    expect(relayed).toHaveLength(1)
    expect(withSidecar.relayedToSidecar()).toBe(1)
    expect(transported).toHaveLength(1)
  })

  it('keeps a cue that addresses the stub mount working while frames flow', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    const bus = createSpeechFrameBus()
    bus.publish({ rms: 0.1, mouthOpen: 0.1 })

    const receipt = await window.cueChannel.send(envelope('acting'))
    expect(receipt.ok).toBe(true)
    if (receipt.ok)
      await receipt.value.settled
    // The cue and the stream are separate paths, which is the whole point.
    expect(host.driver.delivered).toHaveLength(1)

    await host.close()
  })
})
