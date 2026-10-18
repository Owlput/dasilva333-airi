# Design: Background Removal on IS-Net Anime (MODNet Removal)

> **Status:** Implemented 2026-10-17. Single-model policy: IS-Net anime only.
> Related skill: `airi-background-removal`. Validation artifacts:
> `tmp/embedder-poc/showdown/`, `packages/neural-runtime/tests/08-isnet-anime.test.ts`.

## 1. Why We Swapped

MODNet (portrait-trained) fails on anime sticker art in two measured ways
(real failing image `personal_airi/madoka/character-so-happy-1792009831164.png`,
Metal WebGPU, shipped compositing curve @65%):

| Model | Bg corners kept | Character center kept |
|---|---|---|
| MODNet (`Xenova/modnet`) | 23.9% (the reported top-right block) | 89.2% (erodes interior highlights) |
| IS-Net anime (`jellybox/isnet-anime`) | 16.4% (faint watermark text only) | 100% |

On ground-truth alpha art: IS-Net precision 0.998 / recall 0.994 vs MODNet
0.937 / 0.94, at the same ~0.5 s/frame. Alternatives eliminated with evidence:
BiRefNet-ONNX dies in Dawn shader compile (fp32 and fp16, no q4 export upstream);
`briaai/RMBG-2.0` is HTTP 401 (gated). No multi-model selector: nothing else
earned a slot.

## 2. Architecture

Single engine, three layers. The Eventa contract is engine-agnostic, so the
adapter and all UI flows survived the swap untouched.

- **Worker** (`packages/stage-ui/src/workers/background-removal/worker.ts`):
  raw `onnxruntime-web` session (laya-worker pattern — the repo ships a bare
  `isnet-anime_1024.onnx` with no transformers config, so AutoModel cannot load
  it). Input `img` float32 `[1,3,1024,1024]`, plain RGB in [0,1] (no mean/std,
  no BGR swap — this exact preprocessing validated at 0.998/0.994; changing it
  invalidates every number in §1). Output `mask` float32 already in [0,1]
  (no sigmoid). Weights: fetch-once (176 MB) into Cache Storage
  `bg-removal-cache` with a 50 MB truncation guard (evict + retry). Mask tail
  unchanged: scale to uint8 → `fromTensor` → resize to source size →
  single-channel `maskData` transferred zero-copy.
- **Adapter** (`libs/inference/adapters/background-removal.ts`): unchanged
  contract (`load({device})`, `process({imageData,w,h})` → alpha-applied
  `ImageData`). Lazily created, GPU-slot scheduled, device-loss resilient via
  `createGpuWorkerHost`.
- **Compositing** (`libs/stickers/image-convert.ts` `applyAlphaMask`): anchored
  normalization (p1/p99 histogram, floor 0.08 / ceiling 0.85 — spreads
  compressed masks without promoting uniformly weak ones), cutoff
  `(1-s)*0.45`, gamma `2^((1-2s)*1.8)` for anti-aliased edges. Slider semantics
  are UI-stable across engine swaps: Clean 0% / Default 65% / Preserve 100%.

## 3. Configuration & Registry

- `MODEL_IDS.BG_REMOVAL = 'jellybox/isnet-anime'`,
  `MODEL_NAMES.BG_REMOVAL = 'isnet-anime'`.
- `MODEL_VRAM_ESTIMATES`: 600 MB peak (176 MB weights + 1024px fp32
  activations) — re-measure in-app if eviction behavior looks wrong.
- Timeouts: load 300 s (176 MB on slow links), process 180 s (1024px WASM
  fallback on old hardware).
- `ModelCacheManager.vue` `knownModels`: single `jellybox/isnet-anime` entry
  (Cached/Not Cached + eviction via the `bg-removal-cache` scope). The legacy
  `Xenova/modnet` transformers-cache matcher was kept deliberately so users
  can still see and evict orphaned MODNet weights.

## 4. Consumers (No Changes Required)

- `sticker-upload-dialog.vue` (upload flow: Make Transparent / Revert).
- `CardStickerAddModal.vue` (card editor artwork flow + Edge Sensitivity slider).
- `useStickersStore.removeImageBackground/makeTransparent/revertTransparency`
  (pre-cutout backup stays session-memory-only, never persisted).

## 5. Validation

- `packages/neural-runtime/tests/08-isnet-anime.test.ts`: session opens,
  `img`→`mask` names, `[1,1,1024,1024]` dims, finite outputs, foreground
  response on a synthetic disc. (Uses fetch-then-buffer: onnxruntime-node
  cannot resolve remote URLs.)
- `src/libs/inference/adapters/background-removal.test.ts` (mocked worker),
  `src/libs/stickers/`, `src/stores/stickers.test.ts`: unaffected, still green.
- Visual: `tmp/embedder-poc/showdown/cutout-{isnet-madoka,modnet}.png` plus the
  7-file madoka sweep procedure in `packages/neural-runtime/scripts/`.

## 6. Hard Constraint: `onnxruntime-web/webgpu` Subpath & WebGPU Required

IS-Net's graph contains a ceil-mode MaxPool. In `onnxruntime-web@1.24.2`, the
default `.` package entry (`import * as ort from 'onnxruntime-web'`) resolves
to `ort.bundle.min.mjs`, which uses `ort-wasm-simd-threaded.jsep.wasm` — the
legacy JSEP WebGPU runtime whose shape inference throws
`using ceil() in shape computation is not yet supported for MaxPool` even when
`executionProviders: ['webgpu']` is specified.

By contrast, the `./webgpu` subpath (`import * as ort from 'onnxruntime-web/webgpu'`)
resolves to `ort.webgpu.bundle.min.mjs` (`ort-wasm-simd-threaded.asyncify.wasm`,
native C++ Dawn WebGPU EP), which executes IS-Net's ceil-mode MaxPool cleanly:

```
default (ort.bundle.min.mjs -> jsep):            {"ok":false,"error":"using ceil() in shape computation is not yet supported for MaxPool"}
webgpu subpath (ort.webgpu.bundle.min.mjs -> asyncify): {"ok":true,"dims":[1,1,1024,1024]}
```

Consequences, all deliberate:
- The worker MUST import `onnxruntime-web/webgpu` (never bare `onnxruntime-web`).
- The worker rejects non-WebGPU contexts at load time with a plain-language
  error naming the requirement — no download, no cryptic ORT text.
- Session creation requests `['webgpu']` only.
- Store singleton reloads dead adapters: because the host restarts workers
  *without* their model, `ensureBgAdapter` terminates any non-ready adapter
  and reloads on the next call — a retry after any failure recovers on its
  own instead of sticking at "Model not loaded" until app restart.

## 7. When to Revisit

- A gated model (e.g. RMBG-2.0 q4) becomes pullable AND beats IS-Net on the
  madoka set with the same curve — until then, no selector.
- If a future engine needs different preprocessing, its numbers must be
  re-measured per §1; never assume the curve transfers.
