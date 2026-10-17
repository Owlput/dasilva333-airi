import { AutoConfig, AutoModel, AutoTokenizer } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

const MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX'
const EMBEDDING_DIM = 256

function l2Normalize(vec: number[]): number[] {
  const norm = Math.hypot(...vec) || 1
  return vec.map(v => v / norm)
}

function cosineSimilarity(a: number[], b: number[]): number {
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

describe('model #1: EmbeddingGemma-2 on Transformers 4.3.1', () => {
  it('loads natively as EmbeddingGemma2Model without operator crash', async () => {
    const config = await AutoConfig.from_pretrained(MODEL_ID)
    ;(config as any).vision_config = null
    ;(config as any).audio_config = null

    const model = await AutoModel.from_pretrained(MODEL_ID, {
      config,
      device: 'cpu',
      dtype: 'fp32',
      model_file_name: 'model',
    })

    expect(model).toBeDefined()
    expect(model.constructor.name).toBe('EmbeddingGemma2Model')
  }, 120000)

  it('outputs native sentence_embedding and achieves target semantic spread', async () => {
    const config = await AutoConfig.from_pretrained(MODEL_ID)
    ;(config as any).vision_config = null
    ;(config as any).audio_config = null

    const [model, tokenizer] = await Promise.all([
      AutoModel.from_pretrained(MODEL_ID, {
        config,
        device: 'cpu',
        dtype: 'fp32',
        model_file_name: 'model',
      }),
      AutoTokenizer.from_pretrained(MODEL_ID),
    ])

    async function embed(text: string): Promise<number[]> {
      const inputs = await tokenizer(text, { padding: true, truncation: true })
      const out = await model(inputs)

      // Use native sentence_embedding output (Transformers 4.x feature)
      expect(out.sentence_embedding).toBeDefined()
      const raw = Array.from(out.sentence_embedding.data as ArrayLike<number>)
      // MRL slice to 256 dimensions
      const truncated = raw.slice(0, EMBEDDING_DIM)
      return l2Normalize(truncated)
    }

    const queryVec = await embed('task: search result | query: Theodore')
    const hitVec = await embed('title: Chat assistant turn | text: Theodore, a small mouse assistant, clutches a ledger nearby.')
    const missVec = await embed('title: Chat assistant turn | text: The blacksmith hammered red-hot iron on the heavy anvil.')

    const hitScore = cosineSimilarity(queryVec, hitVec)
    const missScore = cosineSimilarity(queryVec, missVec)
    const separation = hitScore - missScore

    expect(hitScore).toBeGreaterThan(0.75)
    expect(missScore).toBeLessThan(0.70)
    expect(separation).toBeGreaterThan(0.12)
  }, 120000)
})
