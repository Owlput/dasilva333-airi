/**
 * Track A-06: SmilingWolf WDv1.4 tagger on transformers 4.3.1.
 *
 * SUNSET NOTE: `Xenova/blip-*` repos return HTTP 401 (gated/removed upstream),
 * and production auto-tagging uses the Danbooru WD tagger family. This test
 * replaces `06-blip-captioning.test.ts` and mirrors the tagger branch of
 * `packages/stage-ui/src/workers/blip/worker.ts` exactly:
 * `AutoModel.from_pretrained(id, { device, model_file_name: '../model' })`,
 * manual alpha-composite -> pad-square -> 448 BGR tensor, `{ input }` forward,
 * `output.logits` thresholded against `selected_tags.csv`
 * (general 0.20 / character 0.85, top-25 general).
 */
import { AutoModel, RawImage, Tensor } from '@huggingface/transformers'
import { describe, expect, it } from 'vitest'

import { disposeModel, disposeTensors, logBench, syntheticImage, timed } from './helpers'

const MODEL_ID = 'SmilingWolf/wd-v1-4-swinv2-tagger-v2'
const TAGS_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/selected_tags.csv`

interface TaggerTag {
  name: string
  category: number
}

function parseTaggerCsv(csvText: string): TaggerTag[] {
  // Mirrors parseTaggerTags() in blip/worker.ts (skips header + trailing line).
  const lines = csvText.split('\n')
  const tags: TaggerTag[] = []
  for (let i = 1; i < lines.length - 1; i++) {
    const cells = lines[i]!.split(',')
    const name = cells[1] ?? ''
    const category = Number(cells[2] ?? -1)
    if (name)
      tags.push({ name: name.replaceAll('_', ' '), category })
  }
  return tags
}

async function buildTaggerInput(img: RawImage): Promise<Tensor> {
  // Worker-identical preprocessing: composite alpha on white, pad to square,
  // resize to 448, repack RGBA -> BGR float32 [1, 448, 448, 3].
  const canvas = new RawImage(new Uint8ClampedArray(img.width * img.height * 4), img.width, img.height, 4)
  const canvasData = canvas.data
  const imgData = img.data
  for (let i = 0; i < img.width * img.height; i++) {
    const alpha = imgData[4 * i + 3] / 255
    canvasData[4 * i] = Math.round(imgData[4 * i] * alpha + 255 * (1 - alpha))
    canvasData[4 * i + 1] = Math.round(imgData[4 * i + 1] * alpha + 255 * (1 - alpha))
    canvasData[4 * i + 2] = Math.round(imgData[4 * i + 2] * alpha + 255 * (1 - alpha))
    canvasData[4 * i + 3] = 255
  }
  const maxDim = Math.max(canvas.width, canvas.height)
  const padLeft = Math.floor((maxDim - canvas.width) / 2)
  const padTop = Math.floor((maxDim - canvas.height) / 2)
  const padded = new Uint8ClampedArray(maxDim * maxDim * 4).fill(255)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const s = (y * canvas.width + x) * 4
      const d = ((y + padTop) * maxDim + (x + padLeft)) * 4
      padded[d] = canvasData[s]!
      padded[d + 1] = canvasData[s + 1]!
      padded[d + 2] = canvasData[s + 2]!
      padded[d + 3] = 255
    }
  }
  const resized = await new RawImage(padded, maxDim, maxDim, 4).resize(448, 448)
  const rd = resized.data
  const data = new Float32Array(448 * 448 * 3)
  for (let i = 0; i < 448 * 448; i++) {
    data[3 * i] = rd[4 * i + 2]!
    data[3 * i + 1] = rd[4 * i + 1]!
    data[3 * i + 2] = rd[4 * i]!
  }
  return new Tensor('float32', data, [1, 448, 448, 3])
}

describe('wDv1.4 tagger on transformers 4.3.1', () => {
  it('loads the tagger, maps logits through selected_tags.csv, and disposes', async () => {
    const tagsRes = await fetch(TAGS_URL)
    expect(tagsRes.ok).toBe(true)
    const tags = parseTaggerCsv(await tagsRes.text())
    expect(tags.length).toBeGreaterThan(9000)
    // Spot-check well-known Danbooru tags survive the parse.
    expect(tags.some(t => t.name === '1girl')).toBe(true)

    const { result: model, ...loadT } = await timed(() =>
      AutoModel.from_pretrained(MODEL_ID, { device: 'cpu', model_file_name: '../model' }))
    logBench('wd-load', loadT, { model: MODEL_ID })

    const img = syntheticImage(224, 224, 3)
    const inputs = await buildTaggerInput(img)
    const { result: outputRaw, ...fwdT } = await timed(() => model({ input: inputs }))
    const output = outputRaw as Record<string, any>
    const logits = output.logits || Object.values(output)[0]
    expect(logits?.data).toBeDefined()
    const probs = Array.from(logits.data as Float32Array)
    expect(probs.length).toBe(tags.length)
    expect(probs.every(Number.isFinite)).toBe(true)

    const general: Array<{ tag: string, prob: number }> = []
    const character: Array<{ tag: string, prob: number }> = []
    for (let i = 0; i < probs.length; i++) {
      const meta = tags[i]
      if (!meta)
        continue
      if (meta.category === 0 && probs[i]! > 0.20)
        general.push({ tag: meta.name, prob: probs[i]! })
      else if (meta.category === 4 && probs[i]! > 0.85)
        character.push({ tag: meta.name, prob: probs[i]! })
    }
    general.sort((a, b) => b.prob - a.prob)
    const text = [...character.map(c => c.tag), ...general.slice(0, 25).map(g => g.tag)].join(', ')
    logBench('wd-forward', fwdT, { tags: tags.length, generalHits: general.length, textLen: text.length })
    expect(typeof text).toBe('string')

    disposeTensors(inputs, output)
    await disposeModel(model)
  }, 1_200_000)
})
