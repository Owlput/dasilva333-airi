---
name: airi-background-removal
description: >-
  Implement/debug anime background removal (IS-Net): raw-ORT session worker,
  mask compositing with sensitivity curve, sticker/card cutout flows, model
  cache entries. MODNet history uses airi-local-inference-engines; sticker UI
  uses airi-model-customizer.
---

# Background Removal (IS-Net Anime)

The single-model background-removal pipeline behind sticker uploads and card artwork cutouts. Engine: `jellybox/isnet-anime` (`isnet-anime_1024.onnx`, 176 MB) executed as a raw `onnxruntime-web` session — the repo ships no transformers config, so AutoModel cannot load it.

## Source Map

| Layer | Path |
| :--- | :--- |
| Worker | `packages/stage-ui/src/workers/background-removal/worker.ts` |
| Adapter | `packages/stage-ui/src/libs/inference/adapters/background-removal.ts` (+ `.test.ts`) |
| Contract | `backgroundRemoval{Load,Process,Unload}Event` in `packages/stage-ui/src/libs/inference/contract.ts` |
| Constants | `MODEL_IDS.BG_REMOVAL`, `MODEL_NAMES.BG_REMOVAL`, `TIMEOUTS.BG_REMOVAL_*` in `packages/stage-ui/src/libs/inference/constants.ts`, `MODEL_VRAM_ESTIMATES` in `coordinator.ts` |
| Weights cache | `BG_REMOVAL_CACHE_NAME` (`bg-removal-cache`) + `is/get/clearBgRemovalCache` in `packages/stage-ui/src/libs/inference/cache-utils.ts` |
| Registry entry | `jellybox/isnet-anime` in `ModelCacheManager.vue` `knownModels` |
| Compositing | `applyAlphaMask` in `packages/stage-ui/src/libs/stickers/image-convert.ts` (+ tests) |
| Consumers | `sticker-upload-dialog.vue`, `CardStickerAddModal.vue`, `useStickersStore.removeImageBackground/makeTransparent/revertTransparency` |
| Validation | `packages/neural-runtime/tests/08-isnet-anime.test.ts`, `tmp/embedder-poc/showdown/` cutouts, `docs/design-background-removal-isnet.md` |

## Load-Bearing Invariants

- **Raw session, fixed IO names**: input `img` float32 `[1,3,1024,1024]`, plain RGB in [0,1] — no mean/std, no BGR swap. Output `mask` float32 already in [0,1] (no sigmoid). Read names from `session.inputNames/outputNames` with `img`/`mask` fallback. Squeeze leading batch singletons (`[1,1,H,W]` → `[1,H,W]`) before constructing the transformers `Tensor`, which requires exactly 3 dims.
- **Preprocessing must match validation exactly**: RawImage resize to 1024 → CHW float32 ÷ 255. Any normalization change invalidates the 0.998/0.994 ground-truth numbers in the design doc — re-run the madoka cutout check first.
- **Weights via Cache Storage** (`bg-removal-cache`), laya-worker pattern: fetch-once with progress emissions, 50 MB truncation guard with evict-and-retry. Never bundle the 176 MB weights.
- **Mask tail is model-agnostic**: `mul(255)` → `fromTensor` → `resize(w,h)` → single-channel `maskData` transfer. The adapter composites; it never sees model internals.
- **Sensitivity curve lives in `applyAlphaMask`, not the worker**: anchored normalization (p1/p99, floor 0.08 / ceiling 0.85), cutoff `(1-s)*0.45`, gamma `2^((1-2s)*1.8)`. Slider semantics (Clean 0% / Default 65% / Preserve 100%) are UI-stable across engine swaps.
- **Single-model policy** (Oct 2026): MODNet was removed after measuring 11% character erosion vs IS-Net's 0%. Do not reintroduce a selector without a candidate that beats IS-Net on anime ground truth first.
- **Must import `onnxruntime-web/webgpu` (NOT bare `onnxruntime-web`)**: in `onnxruntime-web@1.24.2`, the default `.` export resolves to `ort.bundle.min.mjs`, which pairs WebGPU with `ort-wasm-simd-threaded.jsep.wasm` (the legacy JS-hosted JSEP runtime whose shape inference throws `using ceil() in shape computation is not yet supported for MaxPool` on IS-Net's pooling layers). The `./webgpu` subpath resolves to `ort.webgpu.bundle.min.mjs` (`ort-wasm-simd-threaded.asyncify.wasm`, native Dawn WebGPU EP), which executes IS-Net's ceil-mode MaxPool cleanly on Metal/WebGPU.
- **WebGPU-only, fail fast**: IS-Net's graph contains a ceil-mode MaxPool whose shape inference the WASM EP does not implement — any non-WebGPU execution fails deterministically on first forward *after* a 176 MB download. The worker therefore rejects non-WebGPU contexts at load time with a plain-language error and requests `['webgpu']` exclusively.
- **Reload-on-dead singleton**: the host restarts a dead worker *without* its model (`phase` back to `idle`). `ensureBgAdapter` treats any non-ready/non-busy adapter as dead — terminates it and reloads — so retrying after a failure just works instead of bricking with "Model not loaded" until app restart.

## Pitfalls

- onnxruntime-node cannot resolve remote URLs — tests must fetch-then-buffer (see 08). Browser workers resolve via Cache Storage instead.
- `ort.env.wasm.wasmPaths` is pinned to the jsdelivr 1.24.2 dist in-repo; the session contract is EP-agnostic (`['webgpu','wasm']` vs `['wasm']`), but changing the pin requires re-running the 08 suite.
- MODNet-era code assumed `model({ input })` + `output[0]`; IS-Net needs `{ img }` → `mask`. Any future engine swap must re-verify IO names (08 test pins them).
- Legacy `Xenova/modnet` weights may linger in user `transformers-cache`; the old cache-matcher entry was kept deliberately so users can still see and evict them.

## Verification

`pnpm -F @proj-airi/neural-runtime test -- tests/08-isnet-anime.test.ts`; `pnpm -F @proj-airi/stage-ui test:run src/libs/inference/adapters/background-removal.test.ts src/libs/stickers/ src/stores/stickers.test.ts`; `pnpm -F @proj-airi/stage-ui typecheck`. Visual: re-render the madoka cutouts and compare against `tmp/embedder-poc/showdown/cutout-isnet-madoka.png`.
