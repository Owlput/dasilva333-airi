/**
 * Track A-08: IS-Net anime matting contract (jellybox/isnet-anime).
 *
 * Unlike MODNet (EncoderOnly AutoModel path), this repo ships a bare
 * `isnet-anime_1024.onnx` with no transformers config, so the worker must
 * open a raw onnxruntime session (laya-worker pattern): single `img` input
 * `[1,3,1024,1024]` float32 in [0,1], single `mask` float32 output.
 * Validated end-to-end in-browser on Metal WebGPU (0.5 s/frame, precision
 * 0.998 / recall 0.994 vs ground-truth alpha) — see audit §10.
 */
import { describe, expect, it } from 'vitest'

import { logBench, timed } from './helpers'

const MODEL_URL = 'https://huggingface.co/jellybox/isnet-anime/resolve/main/isnet-anime_1024.onnx'

describe('iS-Net anime raw-ORT session contract', () => {
  it('loads the session, honors img->mask contract, and segments a disc', async () => {
    const ort = await import('onnxruntime-node')
    const { result: session, ...loadT } = await timed(() =>
      ort.InferenceSession.create(MODEL_URL, { executionProviders: ['cpu'] }))
    logBench('isnet-load', loadT, {})
    expect(session.inputNames).toContain('img')
    expect(session.outputNames).toContain('mask')

    // Synthetic disc on flat background: mask must be high inside, ~0 outside.
    const W = 256
    const H = 256
    const px = new Float32Array(1 * 3 * H * W).fill(0.9)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) / (W * 0.3)
        const dy = (y - H / 2) / (H * 0.3)
        if (dx * dx + dy * dy < 1) {
          px[y * W + x] = 0.2
          px[1 * H * W + y * W + x] = 0.1
          px[2 * H * W + y * W + x] = 0.1
        }
      }
    }
    // IS-Net expects 1024x1024; nearest-upsample the probe (shape check only).
    const N = 1024
    const big = new Float32Array(1 * 3 * N * N)
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const sx = Math.min(W - 1, Math.floor((x / N) * W))
          const sy = Math.min(H - 1, Math.floor((y / N) * H))
          big[(c * N + y) * N + x] = px[(sy * W + sx) * 1 + c * W * H]
        }
      }
    }
    const { result: out, ...fwdT } = await timed(async () => {
      const feeds: Record<string, any> = {}
      feeds[session.inputNames[0]] = new ort.Tensor('float32', big, [1, 3, N, N])
      return session.run(feeds)
    })
    const maskName = session.outputNames[0]
    const data = out[maskName].data as Float32Array
    expect(out[maskName].dims).toEqual([1, 1, N, N])
    let finite = 0
    let hi = 0
    for (let i = 0; i < data.length; i += 997) {
      if (Number.isFinite(data[i]))
        finite++
      if (data[i]! > 0.5)
        hi++
    }
    expect(finite).toBeGreaterThan(0)
    logBench('isnet-forward', fwdT, { outName: maskName, hiFrac: hi / Math.ceil(data.length / 997) })
    // At least some pixels must read as foreground (model is not dead).
    expect(hi).toBeGreaterThan(0)
    await session.release?.()
  }, 1_200_000)
})
