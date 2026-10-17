import {
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
} from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

const MODEL_ID = 'Xenova/whisper-tiny'

describe('model #2: Whisper STT on Transformers 4.3.1', () => {
  it('instantiates AutoTokenizer, AutoProcessor, and WhisperForConditionalGeneration', async () => {
    const [tokenizer, processor, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoProcessor.from_pretrained(MODEL_ID),
      WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: {
          encoder_model: 'fp32',
          decoder_model_merged: 'q4',
        },
        device: 'cpu',
      }),
    ])

    expect(tokenizer).toBeDefined()
    expect(processor).toBeDefined()
    expect(model).toBeDefined()
    expect(model.constructor.name).toBe('WhisperForConditionalGeneration')
  }, 120000)

  it('transcribes synthetic 16kHz audio without throwing', async () => {
    const [tokenizer, processor, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoProcessor.from_pretrained(MODEL_ID),
      WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: {
          encoder_model: 'fp32',
          decoder_model_merged: 'q4',
        },
        device: 'cpu',
      }),
    ])

    // Generate 1 second of 16kHz sine wave audio
    const sampleRate = 16000
    const audioData = new Float32Array(sampleRate)
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.1
    }

    const { input_features } = await processor(audioData)
    expect(input_features).toBeDefined()

    // Test greedy generation
    const outputs = await model.generate({
      input_features,
      max_new_tokens: 10,
    })

    expect(outputs).toBeDefined()
    const decoded = tokenizer.batch_decode(outputs as any, { skip_special_tokens: true })
    expect(Array.isArray(decoded)).toBe(true)
  }, 120000)
})
