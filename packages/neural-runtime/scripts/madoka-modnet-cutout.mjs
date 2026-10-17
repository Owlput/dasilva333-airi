// MODNet cutout of the failing sticker (CPU, cached model) for side-by-side
// inspection against cutout-isnet.png. Run: node scripts/madoka-modnet-cutout.mjs
import sharp from 'sharp'

import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers'

const SRC = '/Users/richardpinedo/Projects.nosync/airi/personal_airi/madoka/character-so-happy-1792009831164.png'
const OUT = '/Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/tmp/embedder-poc/showdown/cutout-modnet.png'

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width
const H = info.height
const img = new RawImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), W, H, 4)

const model = await AutoModel.from_pretrained('Xenova/modnet', { device: 'cpu' })
const processor = await AutoProcessor.from_pretrained('Xenova/modnet')
const { pixel_values } = await processor(img)
const { output } = await model({ input: pixel_values })
const raw = Array.from(output[0].data)
const mw = output[0].dims[2]
const mh = output[0].dims[1]

// upsample mask to image size (nearest, matches shipped compositing path)
const m = new Float32Array(W * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    m[y * W + x] = raw[Math.min(mh - 1, Math.floor((y / H) * mh)) * mw + Math.min(mw - 1, Math.floor((x / W) * mw))]
  }
}

// shipped curve @65%: anchored normalize + cutoff 0.1575 + gamma
const hist = new Uint32Array(256)
for (let i = 0; i < m.length; i++) hist[Math.max(0, Math.min(255, Math.round(m[i] * 255)))]++
let acc = 0; let lo = 0
for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc / m.length > 0.01) { lo = b; break } }
acc = 0; let hi = 255
for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc / m.length > 0.01) { hi = b; break } }
const loN = Math.min(lo / 255, 0.08)
const hiN = Math.max(hi / 255, 0.85)
const span = Math.max(hiN - loN, 1e-6)
const s = 0.65
const cutoff = (1 - s) * 0.45
const gamma = 2 ** ((1 - 2 * s) * 1.8)
const out = Buffer.from(data)
let kept = 0
for (let i = 0; i < m.length; i++) {
  const n = Math.min(1, Math.max(0, (m[i] - loN) / span))
  const a = n <= cutoff ? 0 : Math.round(((n - cutoff) / (1 - cutoff)) ** gamma * 255)
  out[i * 4 + 3] = a
  if (a > 127)
    kept++
}
await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(OUT)
console.log(`wrote ${OUT} kept=${(100 * kept / m.length).toFixed(1)}% of pixels`)
process.exit(0)
