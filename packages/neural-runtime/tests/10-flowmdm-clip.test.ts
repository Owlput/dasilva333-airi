import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

const MODEL_ID = 'Xenova/clip-vit-base-patch32'

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / ((Math.sqrt(normA) * Math.sqrt(normB)) || 1)
}

describe('model #5: FlowMDM CLIP Text Encoder on Transformers 4.3.1', () => {
  it('instantiates AutoTokenizer and CLIPTextModelWithProjection', async () => {
    const [tokenizer, textModel] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID),
    ])

    expect(tokenizer).toBeDefined()
    expect(textModel).toBeDefined()
    expect(textModel.constructor.name).toBe('CLIPTextModelWithProjection')
  }, 120000)

  it('encodes motion text prompts into 512-dim conditioning vectors with semantic similarity', async () => {
    const [tokenizer, textModel] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID),
    ])

    async function encodePrompt(prompt: string): Promise<Float32Array> {
      const inputs = await tokenizer(prompt)
      const { text_embeds } = await textModel(inputs)
      expect(text_embeds).toBeDefined()
      expect(text_embeds.dims).toEqual([1, 512])
      return text_embeds.data as Float32Array
    }

    const waveVec1 = await encodePrompt('a person waving both hands enthusiastically')
    const waveVec2 = await encodePrompt('someone waving hello to a friend')
    const runVec = await encodePrompt('sprinting quickly across a football field')

    expect(waveVec1.length).toBe(512)
    expect(waveVec2.length).toBe(512)
    expect(runVec.length).toBe(512)

    // Verify non-zero and valid numeric values
    let nonZeroCount = 0
    for (let i = 0; i < waveVec1.length; i++) {
      expect(Number.isNaN(waveVec1[i])).toBe(false)
      if (waveVec1[i] !== 0)
        nonZeroCount++
    }
    expect(nonZeroCount).toBeGreaterThan(500)

    // Semantic alignment: waving actions should have higher cosine similarity than running
    const waveSimilarity = cosineSimilarity(waveVec1, waveVec2)
    const runSimilarity = cosineSimilarity(waveVec1, runVec)

    expect(waveSimilarity).toBeGreaterThan(runSimilarity)
    expect(waveSimilarity).toBeGreaterThan(0.7)
  }, 120000)
})
