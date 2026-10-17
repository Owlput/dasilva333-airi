/**
 * Track A-03: Moondream2 direct-class instantiation on transformers 4.3.1.
 * Mirrors `packages/stage-ui/src/workers/moondream/worker.ts` exactly:
 * `Moondream1ForConditionalGeneration.from_pretrained` (bypasses the
 * AutoModelForVision2Seq auto-map gap), vision-encoder session probe for the
 * patch count, `<image>`-placeholder prompt, greedy generate. Shortened to 24
 * new tokens for test time (worker uses 128).
 */
import { AutoProcessor, AutoTokenizer, Moondream1ForConditionalGeneration } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

import { disposeModel, disposeTensors, logBench, syntheticImage, timed } from './helpers'

const MODEL_ID = 'Xenova/moondream2'

describe('moondream2 direct-class load + generate on transformers 4.3.1', () => {
  it('loads the worker dtype recipe, probes patches, answers, and disposes', async () => {
    const { result: loaded, ...loadT } = await timed(async () => {
      const model = await Moondream1ForConditionalGeneration.from_pretrained(MODEL_ID, {
        device: 'cpu',
        dtype: { embed_tokens: 'fp32', vision_encoder: 'q8', decoder_model_merged: 'q4' },
      })
      const processor = await AutoProcessor.from_pretrained(MODEL_ID)
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
      return { model, processor, tokenizer }
    })
    logBench('moondream-load', loadT, { model: MODEL_ID, ctor: loaded.model.constructor.name })
    expect(loaded.model.constructor.name).toContain('Moondream')

    const image = syntheticImage(384, 384)
    const visionInputs = await loaded.processor(image)
    const feat = await loaded.model.sessions.vision_encoder.run({ pixel_values: visionInputs.pixel_values })
    const imageTokens = feat.image_features.dims[1] as number
    expect(imageTokens).toBeGreaterThan(0)

    const prompt = `${'<image>'.repeat(imageTokens)}\n\nQuestion: Describe the shapes and colors visible.\n\nAnswer:`
    const textInputs = await loaded.tokenizer(prompt)
    const { result: output, ...genT } = await timed(async () =>
      loaded.model.generate({ ...visionInputs, ...textInputs, max_new_tokens: 24, do_sample: false }))
    const decoded = loaded.tokenizer.batch_decode(output as any, { skip_special_tokens: false }) as string[]
    const raw = decoded[0] ?? ''
    const answerIdx = raw.lastIndexOf('Answer:')
    const text = (answerIdx >= 0 ? raw.slice(answerIdx + 'Answer:'.length) : raw)
      .replace(/<\|endoftext\|>/g, '')
      .trim()
    logBench('moondream-generate', genT, { patches: imageTokens, answerChars: text.length })
    expect(text.length).toBeGreaterThan(0)

    disposeTensors(visionInputs, textInputs, feat, output)
    await disposeModel(loaded.model)
  }, 1_200_000)
})
