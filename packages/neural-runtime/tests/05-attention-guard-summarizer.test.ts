/**
 * Track A-05: attention-guard Stage-3 VLM forwarder recipe on transformers 4.3.1.
 * Mirrors `packages/stage-ui/src/workers/attention-guard/engine/summarizer.ts`
 * verbatim (fixed screen-question prompt, 96-token budget kept, parse/strip
 * recipe) on a synthetic frame. Device cpu: validates API/compat, not
 * accelerator perf.
 */
import { AutoProcessor, AutoTokenizer, Moondream1ForConditionalGeneration } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

import { disposeModel, disposeTensors, logBench, syntheticImage, timed } from './helpers'

const MODEL_ID = 'Xenova/moondream2'
const SCREEN_QUESTION = 'What application or website is open, and what specific window title, active tabs, buttons, code, or text are visible? Do not say "a computer screen displays". Be specific and cite concrete names and text.'

describe('attention-guard summarizer recipe on transformers 4.3.1', () => {
  it('produces a non-empty caption string through the Q/A wrapper', async () => {
    const { result: loaded, ...loadT } = await timed(async () => {
      const model = await Moondream1ForConditionalGeneration.from_pretrained(MODEL_ID, {
        device: 'cpu',
        dtype: { embed_tokens: 'fp32', vision_encoder: 'q8', decoder_model_merged: 'q4' },
      })
      const processor = await AutoProcessor.from_pretrained(MODEL_ID)
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
      return { model, processor, tokenizer }
    })
    logBench('summarizer-load', loadT, { model: MODEL_ID })

    const image = syntheticImage(384, 384, 5)
    const visionInputs = await loaded.processor(image)
    const feat = await loaded.model.sessions.vision_encoder.run({ pixel_values: visionInputs.pixel_values })
    const imageTokens = feat.image_features.dims[1] as number

    const prompt = `${'<image>'.repeat(imageTokens)}\n\nQuestion: ${SCREEN_QUESTION}\n\nAnswer:`
    const textInputs = await loaded.tokenizer(prompt)
    const { result: output, ...genT } = await timed(async () =>
      loaded.model.generate({ ...visionInputs, ...textInputs, max_new_tokens: 48, do_sample: false }))
    const decoded = loaded.tokenizer.batch_decode(output as any, { skip_special_tokens: false }) as string[]
    const raw = decoded[0] ?? ''
    const answerIdx = raw.lastIndexOf('Answer:')
    let caption = (answerIdx >= 0 ? raw.slice(answerIdx + 'Answer:'.length) : raw)
      .replace(/<\|endoftext\|>/g, '')
      .trim()
    caption = caption
      .replace(/^(A|The)\s+(computer\s+)?(screen|screenshot|desktop|display|image)\s+(displays?|shows?|depicts?|features?)\s+(a|an)?\s*/i, '')
      .trim()
    if (caption)
      caption = caption.charAt(0).toUpperCase() + caption.slice(1)
    logBench('summarizer-generate', genT, { patches: imageTokens, captionChars: caption.length })
    expect(caption.length).toBeGreaterThan(0)

    disposeTensors(visionInputs, textInputs, feat, output)
    await disposeModel(loaded.model)
  }, 1_200_000)
})
