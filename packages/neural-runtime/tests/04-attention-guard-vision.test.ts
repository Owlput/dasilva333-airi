/**
 * Track A-04: attention-guard CLIP towers on transformers 4.3.1.
 * Mirrors `packages/stage-ui/src/workers/attention-guard/engine/vision.ts`:
 * `CLIPVisionModelWithProjection` + `CLIPTextModelWithProjection` on
 * `Xenova/clip-vit-base-patch32`, 512d shared space, device cpu (Node has no
 * WebGPU; validates API/compat, not accelerator perf).
 */
import { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

import { disposeModel, disposeTensors, logBench, syntheticImage, timed } from './helpers'

const MODEL_ID = 'Xenova/clip-vit-base-patch32'

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0; let ma = 0; let mb = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i]
    ma += a[i] * a[i]
    mb += b[i] * b[i]
  }
  return d / (Math.sqrt(ma) * Math.sqrt(mb))
}

describe('cLIP vision+text towers on transformers 4.3.1', () => {
  it('embeds two frames to 512d with sane self/cross similarity and disposes', async () => {
    const { result: loaded, ...loadT } = await timed(async () => {
      const [processor, tokenizer, vision, text] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID),
        AutoTokenizer.from_pretrained(MODEL_ID),
        CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { device: 'cpu' }),
        CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { device: 'cpu' }),
      ])
      return { processor, tokenizer, vision, text }
    })
    logBench('clip-load', loadT, { model: MODEL_ID })

    const frameA = syntheticImage(224, 224, 0)
    const frameB = syntheticImage(224, 224, 77)
    const { pixel_values: pvA } = await loaded.processor(frameA)
    const { pixel_values: pvB } = await loaded.processor(frameB)

    const outA = await loaded.vision({ pixel_values: pvA })
    const outB = await loaded.vision({ pixel_values: pvB })
    const embA = Array.from(outA.image_embeds.data as Float32Array)
    const embB = Array.from(outB.image_embeds.data as Float32Array)
    expect(outA.image_embeds.dims).toEqual([1, 512])
    expect(outB.image_embeds.dims).toEqual([1, 512])
    expect(embA.every(Number.isFinite)).toBe(true)

    const textInputs = await loaded.tokenizer('a screenshot of a terminal window', { padding: true, truncation: true })
    const outT = await loaded.text(textInputs)
    expect(outT.text_embeds.dims).toEqual([1, 512])

    // Self-similarity ~1, distinct frames separate.
    expect(cosine(embA, embA)).toBeCloseTo(1, 5)
    expect(cosine(embA, embB)).toBeLessThan(0.999)

    disposeTensors(pvA, pvB, outA, outB, textInputs, outT)
    await disposeModel(loaded.vision)
    await disposeModel(loaded.text)
  }, 1_200_000)
})
