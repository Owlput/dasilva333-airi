import { KokoroTTS, TextSplitterStream } from 'kokoro-js'
import { describe, expect, it } from 'vitest'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

describe('model #4: Kokoro TTS on Transformers 4.3.1', () => {
  it('loads KokoroTTS with q8 quantization on CPU', async () => {
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'cpu',
    })

    expect(tts).toBeDefined()
    expect(tts.voices).toBeDefined()
    expect(tts.voices.af_heart).toBeDefined()
    expect(tts.voices.af_heart.name).toBe('Heart')
  }, 120000)

  it('generates 24kHz synthetic speech waveform', async () => {
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'cpu',
    })

    const audio = await tts.generate('Hello from AIRI.', { voice: 'af_heart' })

    expect(audio).toBeDefined()
    expect(audio.sampling_rate).toBe(24000)
    expect(audio.audio).toBeDefined()
    expect(audio.audio.length).toBeGreaterThan(0)

    // Verify float samples are bounded
    let maxAmp = 0
    for (let i = 0; i < audio.audio.length; i++) {
      const abs = Math.abs(audio.audio[i])
      if (abs > maxAmp)
        maxAmp = abs
    }
    expect(maxAmp).toBeGreaterThan(0.01) // Not silent
    expect(maxAmp).toBeLessThanOrEqual(1.5) // Valid amplitude range
  }, 120000)

  it('streams audio chunks via TextSplitterStream (matching worker contract)', async () => {
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'cpu',
    })

    const splitter = new TextSplitterStream()
    const stream = tts.stream(splitter, { voice: 'af_heart' })
    splitter.push('Testing neural stream.')
    splitter.close()

    const chunks: any[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].audio).toBeDefined()
    expect(chunks[0].audio.sampling_rate).toBe(24000)
    expect(chunks[0].audio.audio.length).toBeGreaterThan(0)
  }, 120000)
})
