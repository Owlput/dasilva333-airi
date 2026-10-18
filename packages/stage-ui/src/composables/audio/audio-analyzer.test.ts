import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAudioAnalyzer } from './audio-analyzer'

describe('useAudioAnalyzer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates the level 20 times per second (at 20 Hz), not on each animation frame', () => {
    vi.useFakeTimers()
    const { startAnalyzer, stopAnalyzer, onAnalyzerUpdate, volumeLevel } = useAudioAnalyzer()
    const updates = vi.fn()
    onAnalyzerUpdate(updates)

    const fakeAnalyser = {
      fftSize: 256,
      smoothingTimeConstant: 0.3,
      frequencyBinCount: 128,
      getByteFrequencyData: vi.fn((array: Uint8Array) => {
        array.fill(128)
      }),
    }
    const fakeContext = {
      createAnalyser: vi.fn(() => fakeAnalyser),
    } as unknown as AudioContext

    startAnalyzer(fakeContext)

    // Initial immediate invocation on start
    expect(updates).toHaveBeenCalledTimes(1)
    expect(volumeLevel.value).toBeGreaterThan(0)

    // Advance by 1 second (1000ms): 20 ticks at 50ms interval + 1 initial = 21 calls
    vi.advanceTimersByTime(1000)
    expect(updates).toHaveBeenCalledTimes(21)

    // Stop analyzer halts the interval
    stopAnalyzer()
    vi.advanceTimersByTime(1000)
    expect(updates).toHaveBeenCalledTimes(21)
  })

  it('handles multiple start calls gracefully without leaking multiple interval loops', () => {
    vi.useFakeTimers()
    const { startAnalyzer, stopAnalyzer, onAnalyzerUpdate } = useAudioAnalyzer()
    const updates = vi.fn()
    onAnalyzerUpdate(updates)

    const fakeAnalyser = {
      fftSize: 256,
      smoothingTimeConstant: 0.3,
      frequencyBinCount: 128,
      getByteFrequencyData: vi.fn((array: Uint8Array) => {
        array.fill(64)
      }),
    }
    const fakeContext = {
      createAnalyser: vi.fn(() => fakeAnalyser),
    } as unknown as AudioContext

    startAnalyzer(fakeContext)
    startAnalyzer(fakeContext) // second call while running

    vi.advanceTimersByTime(1000)
    expect(updates).toHaveBeenCalledTimes(21)

    stopAnalyzer()
  })
})
