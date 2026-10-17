import fs from 'node:fs'

// MODNet vs RMBG-2.0 q4 on the real failing anime sticker (white bg, 1280px).
// Metrics: mask decisiveness, corner-bg leakage, kept fraction under the
// shipped compositing curve. Saves cutout previews for human inspection.
// Run from packages/neural-runtime: node scripts/madoka-showdown.mjs
import sharp from 'sharp'

import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers'

const FILE = '/Users/richardpinedo/Projects.nosync/airi/personal_airi/madoka/character-so-happy-1792009831164.png'
const OUT = new URL('../showdown/', import.meta.url).pathname

function newCurve(maskData, s) {
  const hist = new Uint32Array(256)
  for (const m of maskData) hist[m]++
  let acc = 0; let lo = 0
  for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc / maskData.length > 0.01) { lo = b; break } }
  acc = 0; let hi = 255
  for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc / maskData.length > 0.01) { hi = b; break } }
  const loN = Math.min(lo / 255, 0.08)
  const hiN = Math.max(hi / 255, 0.85)
  const span = Math.max(hiN - loN, 1e-6)
  const cutoff = (1 - s) * 0.45
  const gamma = 2 ** ((1 - 2 * s) * 1.8)
  return maskData.map((m) => {
    const n = Math.min(1, Math.max(0, (m / 255 - loN) / span))
    if (n <= cutoff)
      return 0
    return Math.round(((n - cutoff) / (1 - cutoff)) ** gamma * 255)
  })
}

const { data, info } = await sharp(FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width
const H = info.height
const img = new RawImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), W, H, 4)

async function runMask(modelId, opts) {
  const t0 = Date.now()
  const model = await AutoModel.from_pretrained(modelId, { device: 'cpu', ...opts })
  const processor = await AutoProcessor.from_pretrained(modelId)
  const loadMs = Date.now() - t0
  const { pixel_values } = await processor(img)
  const t1 = Date.now()
  const inputs = { input: pixel_values, input_image: pixel_values }
  const { output } = await model(inputs)
  const fwdMs = Date.now() - t1
  const first = output.logits ?? output[0]
  let mn = Infinity; let mx = -Infinity
  for (let i = 0; i < first.data.length; i += 997) {
    const v = first.data[i]; if (v < mn)
      mn = v; if (v > mx)
      mx = v
  }
  const needSigmoid = mn < -0.01 || mx > 1.01
  const raw = needSigmoid ? first.sigmoid().data : first.data
  console.log(`  (logits->${needSigmoid ? 'sigmoid' : 'direct'} range [${mn.toFixed(2)},${mx.toFixed(2)}])`)
  const dims = first.dims
  console.log(`${modelId}: load=${(loadMs / 1000).toFixed(0)}s fwd=${(fwdMs / 1000).toFixed(1)}s outDims=[${dims}]`)
  const [,, mh, mw] = dims.length === 4 ? dims : [0, 0, Math.sqrt(raw.length), Math.sqrt(raw.length)]
  const m = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(mw - 1, Math.floor((x / W) * mw))
      const sy = Math.min(mh - 1, Math.floor((y / H) * mh))
      m[y * W + x] = Math.round(raw[sy * mw + sx] * 255)
    }
  }
  await model.dispose?.()
  return m
}

const modnet = await runMask('Xenova/modnet', {})
const rmbg = await runMask('onnx-community/BiRefNet-ONNX', { subfolder: 'onnx' })

function stats(name, m) {
  let mid = 0; let corner = 0; let cornerN = 0
  const B = 200
  for (let i = 0; i < m.length; i++) {
    const v = m[i] / 255
    if (v >= 0.05 && v < 0.5)
      mid++
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((x < B || x >= W - B) && (y < B || y >= H - B)) {
        cornerN++
        corner += m[y * W + x] / 255
      }
    }
  }
  console.log(`${name}: midrange-frac=${(100 * mid / m.length).toFixed(2)}% corner-mean=${(corner / cornerN).toFixed(3)}`)
}
stats('modnet-raw ', modnet)
stats('rmbg-q4-raw', rmbg)
fs.mkdirSync(OUT, { recursive: true })
for (const [mname, m] of [['modnet', modnet], ['rmbg', rmbg]]) {
  for (const s of [0.65, 0.03]) {
    const a = newCurve(m, s)
    let kept = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] > 127)
        kept++
    }
    console.log(`${mname} s=${s}: kept=${(100 * kept / a.length).toFixed(1)}%`)
    const out = Buffer.from(data)
    for (let i = 0; i < a.length; i++) out[i * 4 + 3] = a[i]
    await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${OUT}cutout-${mname}-s${Math.round(s * 100)}.png`)
  }
}
await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${OUT}original.png`)
console.log('previews in', OUT)
process.exit(0)
