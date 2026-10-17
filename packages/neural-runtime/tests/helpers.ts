/**
 * Shared fixtures for Track A (vision) migration tests on
 * `@huggingface/transformers@4.3.1`. All images are synthetic gradients —
 * deterministic, no network, no canvas dependency.
 */
import { RawImage } from '@huggingface/transformers'

export function syntheticImage(width = 384, height = 384, seed = 0): RawImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (x * 255 / width + seed) % 256
      data[i + 1] = (y * 255 / height + seed * 2) % 256
      data[i + 2] = ((x + y) * 255 / (width + height) + seed * 3) % 256
      data[i + 3] = 255
    }
  }
  return new RawImage(data, width, height, 4)
}

export interface Timed<T> {
  result: T
  ms: number
  deltaMemMB: number
}

export async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const mem0 = process.memoryUsage().rss
  const t0 = performance.now()
  const result = await fn()
  return { result, ms: performance.now() - t0, deltaMemMB: (process.memoryUsage().rss - mem0) / 1048576 }
}

export function logBench(name: string, t: { ms: number, deltaMemMB: number }, extra: Record<string, unknown> = {}): void {
  console.log(`[bench:${name}] ${JSON.stringify({ ms: Math.round(t.ms), deltaMemMB: Math.round(t.deltaMemMB), ...extra })}`)
}

export async function disposeModel(model: any): Promise<void> {
  if (model && typeof model.dispose === 'function')
    await model.dispose()
}

export function disposeTensors(...objs: any[]): void {
  for (const obj of objs) {
    if (!obj)
      continue
    if (typeof obj.dispose === 'function') {
      try {
        obj.dispose()
      }
      catch {}
    }
    else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (obj[key] && typeof obj[key].dispose === 'function') {
          try {
            obj[key].dispose()
          }
          catch {}
        }
      }
    }
  }
}
