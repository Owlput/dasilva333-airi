import { AutoModel, Tensor } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

const MODEL_ID = 'onnx-community/silero-vad'
const SAMPLE_RATE = 16000
const CHUNK_SIZE = 512 // Silero VAD requires 512 samples for 16kHz

describe('model #3: Silero VAD on Transformers 4.3.1', () => {
  it('loads AutoModel for custom silero-vad architecture', async () => {
    const model = await AutoModel.from_pretrained(MODEL_ID, {
      device: 'cpu',
      config: { model_type: 'custom' } as any,
      dtype: 'fp32',
    })

    expect(model).toBeDefined()
  }, 120000)

  it('runs 16kHz inference and maintains recurrent state continuity', async () => {
    const model = await AutoModel.from_pretrained(MODEL_ID, {
      device: 'cpu',
      config: { model_type: 'custom' } as any,
      dtype: 'fp32',
    })

    let state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
    const srTensor = new Tensor('int64', [SAMPLE_RATE], [])

    // 1. Silence chunk (all zeros)
    const silenceBuffer = new Float32Array(CHUNK_SIZE)
    const silenceInput = new Tensor('float32', silenceBuffer, [1, CHUNK_SIZE])

    const out1 = await model({
      input: silenceInput,
      sr: srTensor,
      state,
    })

    expect(out1.output).toBeDefined()
    expect(out1.stateN).toBeDefined()

    const silenceProb = (out1.output.data as Float32Array)[0]
    expect(silenceProb).toBeGreaterThanOrEqual(0)
    expect(silenceProb).toBeLessThan(0.15) // Silence should have very low speech probability

    // Update state to stateN
    state = out1.stateN

    // 2. Synthesize a speech-like harmonic signal (vocal tone ~220Hz + harmonics)
    const voiceBuffer = new Float32Array(CHUNK_SIZE)
    for (let i = 0; i < CHUNK_SIZE; i++) {
      const t = i / SAMPLE_RATE
      voiceBuffer[i] = 0.5 * Math.sin(2 * Math.PI * 220 * t)
        + 0.3 * Math.sin(2 * Math.PI * 440 * t)
        + 0.2 * Math.sin(2 * Math.PI * 880 * t)
    }
    const voiceInput = new Tensor('float32', voiceBuffer, [1, CHUNK_SIZE])

    const out2 = await model({
      input: voiceInput,
      sr: srTensor,
      state,
    })

    expect(out2.output).toBeDefined()
    expect(out2.stateN).toBeDefined()
    expect(out2.stateN.dims).toEqual([2, 1, 128])

    const voiceProb = (out2.output.data as Float32Array)[0]
    expect(voiceProb).toBeGreaterThanOrEqual(0)
    expect(voiceProb).toBeLessThanOrEqual(1.0)
  }, 120000)
})
