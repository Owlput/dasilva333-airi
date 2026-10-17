# Empirical Universe RAG Persistence, Chunking & Embedder Scaling Audit

> **Location:** `docs/memory_lab/empirical-rag-persistence-and-chunking-audit.md`
> **Status:** Active R&D Working Specification & Benchmark Audit
> **Scope:** Universe Memory RAG (Chat Composer Amber Bar, Search Memories Modal, Knowledge Graph)
> **Primary Character Corpus:** `the-weakest-beast-tamer-expedition-to-the-crystal-nest_card` (characterId `C6rlV2MvRWuQJJnXHiDFq`)

---

## 1. What the Logs Proved (2026-10-17 Session)

1. **Chat window runs with an unhydrated ledger**: `activeLedgerCharId: null`, `ledgerEntitiesCount: 0`. The Knowledge Graph mention fallback was previously a no-op in chat because `loadLedger(characterId)` was only invoked when opening the Mind Map Explorer or Long-Term Memory view. Fixed in commit `ce56c5f144` by eagerly loading the ledger in `memory-text-journal.ts:searchEntries`.
2. **Embeddings were down in the 3.8.1 environment**: WebGPU and WASM fallback both failed with numeric pointer `12198344`, plus `Unknown model class "embedding_gemma2"` from Transformers.js. Every `layeredMemory.search` call threw into the LTMM-only fallback (`scopedEntriesCount: 12`, `rankedMatchesCount: 0`).
3. **Worker cache was saturated at 600 docs**: `snapshotDocCount: 600 / workerDocumentsCount: 600`. The global FIFO evicted older turns continuously upon every ingest cycle.
4. **System-1 triage**: Encountered 429 rate-limiting from OpenRouter and cleanly fell back to the heuristic ranker (expected and healthy behavior).

**Conclusion:** The initial failure to retrieve Theodore / mouse references was three stacked system bottlenecks (unloaded ledger, crashed embedder, saturated worker cache), not a single ranking bug.

---

## 2. Persistence: We Threw the Index Away by Design

Prior to commit `4bd45d70bf`:
- `search.worker.ts` `case 'persist'` explicitly **stripped `raw_turn` embeddings**, saving only text docs to IndexedDB.
- On reboot, the worker hydrated text-only docs (BM25 keyword search worked; neural cosine similarity scored 0).
- `backgroundIndexAll` only re-embedded the 8 most recent sessions (`MAX_INDEX_SESSIONS = 8`, `MAX_RAW_DOCS = 250`).
- The 600-document global FIFO evicted oldest entries first, discarding historical lore turns (e.g. Theodore at session ranks 10, 14, and 17).
- **Fix Applied (`4bd45d70bf`)**:
  - Raw turn embeddings are now quantized to 4 decimal places and persisted directly in `airi-search-index` snapshots, eliminating reboot re-embedding storms.
  - `MAX_WORKER_DOCUMENTS` scaled from 600 to 3,000 with **tier-aware eviction** that protects high-value LTMM, STMM, lifetime, and echo chip memories by evicting `raw_turn` entries first.
  - `memory-text-journal.ts` background constants scaled: `MAX_INDEX_SESSIONS` (8 → 30), `MAX_RAW_DOCS` (250 → 1,500), `MAX_TOTAL_DOCS` (600 → 3,000).

---

## 3. Size Reality Check (Gemma 256d vs. BGE 384d)

Per `docs/design-embedding-provider-support.md` §4:
- 256-dimensional vectors = 1,024 bytes/vector (raw Float32) vs. 384-dimensional = 1,536 bytes (33% smaller).
- Persisted JSON (quantized 4dp): ~1.88 KB per vector.
- 600 docs ≈ 1 MB + text.
- 5,000 docs ≈ 10 MB.
- **Measured full corpus (9,335 chunk-documents)**: **~32 MB total snapshot** (17.5 MB vectors, 14 MB text).
- **Verdict**: IndexedDB handles 32 MB with zero degradation. The legacy comments warning of "gigabyte bloat" and "too large to store" were theoretical BGE-era fears that Gemma's 256d MRL architecture rendered obsolete.

---

## 4. Architectural Solutions Implemented

1. **Persist Raw Quantized (`search.worker.ts`)**: Persists 4dp quantized float arrays for all raw turns. Eliminates reboot re-embed loops. Geometry versioning (`isSnapshotCompatible`) invalidates cleanly on model swaps.
2. **Tier-Aware Eviction**: When worker document capacity is reached, eviction preferentially drops the oldest `raw_turn` entries, pinning LTMM journals, STMM daily summaries, lifetime core identity threads, and emotional echo chips.
3. **Eager Ledger Hydration (`memory-text-journal.ts`)**: Chat queries await `entityLedgerStore.loadLedger(characterId)` if unhydrated, allowing direct entity dialogue mention fallback.
4. **Offline KG Isolation (`layered-memory.ts`)**: Search worker candidate retrieval is wrapped in a dedicated error boundary so neural/WASM worker failures do not discard offline Knowledge Graph hits.
5. **Human-Readable Error Serialization**: Numeric WASM exception pointers (like `12198344`) are caught and annotated with actionable diagnostics.

---

## 5. Empirical Benchmark Results (Corpus: 75 Sessions / 112 Deduped Turns)

* **Corpus Profile**: 44 short turns (<2k chars, 13k total), 24 medium turns (2k–8k chars, 126k total), **44 mega-turns (>8k chars, 13.8M chars, avg ~300k chars/turn)**.
* **CPU-fp32 Latency**: Linear slope ≈ 0.5 ms/char on short-to-medium turns (182 ms @ 363 chars → 2.8 s @ 5.6k chars).
* **The Silent OOM Crash**:
  - The process died with a silent `SIGKILL` on the first unchunked mega-turn.
  - **Root Cause**: The tokenizer's `model_max_length` is unconstrained (`1e31`). A 300k-character chapter produced ~60,000–75,000 tokens. The 4 full-attention layers attempted to allocate a $60,000 \times 60,000$ attention matrix (~14.4 GB per layer), instantly exhausting process memory.
  - **Context Window Correction**: The model does **not** cap out at 8k tokens. In `config.json`, `max_position_embeddings` is **262,144 tokens** (256k). However, browser WebGPU buffer allocations (`maxStorageBufferBindingSize`) and runtime latency necessitate chunking long-form text.
* **Chunked Benchmark (1,500 chars / ~350 tokens per chunk)**:
  - 9,335 total chunk-documents.
  - **CPU-q4 Latency**: ~265 ms avg/doc (~45–50 min full corpus).
  - **WebGPU-q4 Latency**: Projected 25–50 ms/doc (~5 min full rebuild).
  - **Storage**: ~3,378 bytes/doc (1.88 KB vector + 1.5 KB text) = **32 MB total**.

---

## 5b. In-Browser WASM vs. WebGPU Sweep (Headless Chromium / Brave, ORT 1.31)

Real 161k-character chapter (35,293 tokens) from `the-weakest-beast-tamer`. Same-origin serving on `http://127.0.0.1` (COOP/COEP secure context), local Transformers 4.3.1 + ORT 1.31.
- **WASM Path (`harness-wasm.mjs`)**: CPU threaded × 4, fp32.
- **WebGPU Path (`harness.mjs`)**: Apple Metal-3 hardware acceleration (`maxStorageBufferBindingSize: 4GB`), `q4` block quantization (`GatherBlockQuantized`).

| Token Window | WASM Latency (fp32) | WebGPU Latency (`q4` Metal-3) | WebGPU Speedup | WebGPU Status |
| :--- | :--- | :--- | :--- | :--- |
| **512 tokens** | 989 ms | **203 ms** (runs: 202 / 203 / 203) | **4.9× faster** | Stable (351 MB heap) |
| **1,024 tokens** | 2,484 ms | **472 ms** (runs: 470 / 472 / 472) | **5.3× faster** | Stable (388 MB heap) |
| **2,048 tokens** | 6,872 ms | **1,152 ms** (runs: 1,151 / 1,152 / 1,175) | **6.0× faster** | Stable (433 MB heap) |
| **4,096 tokens** | 21,769 ms | **3,257 ms** (runs: 3,246 / 3,257 / 3,259) | **6.7× faster** | Stable (195 MB heap) |
| **8,192 tokens** | **CRASH (`std::bad_alloc`)** | **11,111 ms (11.1s)** | **SURVIVES** | Stable (154 MB heap) |
| **16,384 tokens** | — | **CRASH (`SafeIntOnOverflow`)** | — | Integer overflow in tensor indexing |

### Key Empirical Findings:
1. **WebGPU Headroom is Double WASM**: WASM hard-crashes at 8,192 tokens (`std::bad_alloc`). WebGPU on Metal cleanly completes 8,192 tokens in 11.1 seconds. WebGPU only terminates at 16,384 tokens due to an internal ONNX Runtime tensor index overflow (`SafeIntOnOverflow`).
2. **Headless Metal Discovery**: Previous `NO_NAVIGATOR_GPU` reports were caused by evaluating on `about:blank`. Under W3C specifications, WebGPU is strictly gated behind `[SecureContext]`. Serving a local HTTP origin (`http://127.0.0.1`) immediately exposes Apple Metal-3 headlessly in agent sessions without user intervention.
3. **Mathematical Equivalence**: Manual mean-pooling and native `sentence_embedding` correlate at **1.0000** across all windows. The port drops the hand-rolled loop with zero behavior drift.
4. **Final Chunk Size Recommendation**: Slicing turns at **~1,500 to 2,000 characters (~375–500 tokens)** operates at **~200 ms on WebGPU** (and ~1s on WASM fallback), staying well clear of both the WASM 8k alloc cliff and the WebGPU 16k overflow ceiling.


---

## 6. Two-Speed Ingest Architecture

To reconcile interactive chat responsiveness with deep historical retrieval:

1. **Background Turn Ingestion (Fast Path)**:
   - Triggered per turn in active chat.
   - Restricts real-time embedding to the active session and recent dialogue.
   - Enforces strict latency budget: `<30 seconds` total.
2. **Explicit Full Rebuild (Deep Path)**:
   - Invoked from the Knowledge Graph Mind Map Explorer or Memory Settings page.
   - Processes the full historical corpus across all sessions with the chunking pipeline.
   - Exposes UI progress bar, elapsed time, document counts, and cancellation signal.

---

## 7. Transformers 4.x Sandbox Verdict (`tmp/embedder-poc/t4`)

Testing in isolated sandbox (`@huggingface/transformers@4.3.1`):
1. **q4 Model Loads Natively**: Recognized as native class `EmbeddingGemma2Model` (eliminates `Unknown model class "embedding_gemma2"` warning).
2. **No Operator Crashes on WebGPU parse path**: Bundled ONNX Runtime (1.31-dev) parses `GatherBlockQuantized` cleanly, eliminating error `12198344`. **Correction (browser-proven)**: the *WASM* EP has no kernel for it — `Could not find an implementation for GatherBlockQuantized(1)` at session creation. **q4 is WebGPU-only**; the WASM fallback needs a different dtype/file (fp32 works via the native class, which auto-supplies the multimodal inputs).
3. **Native Sentence Embedding**: Outputs `sentence_embedding` directly alongside `last_hidden_state`, allowing removal of our custom mean-pooling loop.
4. **Semantic Spread Maintained**: Target hit cosine similarity `0.807` vs. distractor miss `0.649`.

---

## 8. Transformers 4.x Monorepo Blast Radius & Burn-Down Checklist

Upgrading `@huggingface/transformers` from `^3.8.1` to `^4.3.1` affects 10 distinct local inference workers, adapters, and shared components across AIRI.

### Critical Invariant: `patches/@huggingface__transformers.patch`
The monorepo applies a 436-line patch to `dist/transformers.js` (`patches/@huggingface__transformers.patch`) that fixes browser canvas memory leaks in `RawImage` by enforcing explicit `canvas.width = 0; canvas.height = 0;` teardowns.
- **Action**: When bumping to 4.3.1, re-verify or regenerate this patch.
- **Verification**: Run `pnpm -F @proj-airi/stage-ui test run src/libs/inference/transformers-raw-image-patch.test.ts`.

---

### The 10 Dependent Workers & Verification Matrix

| # | Subsystem / Worker | File Path | Imported Symbols | Model / Backbone | Verification Test / Smoke Procedure |
|---|-------------------|-----------|------------------|------------------|--------------------------------------|
| **1** | **Search Embedding Worker** | `packages/stage-ui/src/libs/workers/search/search.worker.ts` | `AutoConfig, AutoModel, AutoTokenizer, env` | `onnx-community/embeddinggemma-2-ONNX` (q4 WebGPU/WASM) | Run `pnpm -F @proj-airi/stage-ui test run src/libs/search/`. Verify model load without `12198344` and check semantic cosine score. |
| **2** | **Whisper STT Worker** | `packages/stage-ui/src/libs/workers/worker.ts` | `AutoProcessor, AutoModelForSpeechSeq2Seq, env, Tensor, pipeline` | `Xenova/whisper-tiny`, `whisper-base`, `whisper-large-v3-turbo` | Test local microphone transcription in Stage Tamagotchi / Stage Web. Verify Eventa streaming audio chunks. |
| **3** | **Moondream VLM Worker** | `packages/stage-ui/src/workers/moondream/worker.ts` | `AutoProcessor, AutoTokenizer, env, Moondream1ForConditionalGeneration, RawImage` | `Xenova/moondream2` (`q8` vision, `q4` decoder) | Test screen observation / image prompt in chat composer. Confirm direct-class instantiation works in 4.x. |
| **4** | **Attention Guard (Vision)** | `packages/stage-ui/src/workers/attention-guard/engine/vision.ts` | `AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage` | `Xenova/clip-vit-base-patch32` | Trigger Stage 1 salience frame embedding. Confirm CLIP visual embeddings generate without dimension mismatches. |
| **5** | **Attention Guard (Summarizer)** | `packages/stage-ui/src/workers/attention-guard/engine/summarizer.ts` | `AutoProcessor, AutoTokenizer, Moondream1ForConditionalGeneration, RawImage` | `Xenova/moondream2` | Verify periodic screen activity summarization in desktop background loop. |
| **6** | **BLIP Captioning Worker** | `packages/stage-ui/src/workers/blip/worker.ts` | `AutoModel, AutoProcessor, env, pipeline, RawImage, Tensor` | `Xenova/blip-image-captioning-base` | Test AnimaDex avatar card image auto-tagging and BLIP caption extraction. |
| **7** | **Background Removal Worker** | `packages/stage-ui/src/workers/background-removal/worker.ts` | `AutoModel, AutoProcessor, env, RawImage` | `briaai/RMBG-1.4` | Test character avatar / scene background cutout in Control Strip Customizer. Verify `RawImage` canvas teardown. |
| **8** | **Kokoro TTS Worker** | `packages/stage-ui/src/workers/kokoro/worker.ts` | `env` | `kokoro-js` (ONNX speech weights) | Test local neural voice playback. Confirm `env` cache configuration passes through to Kokoro WASM/WebGPU. |
| **9** | **Silero VAD Worker** | `packages/stage-ui/src/workers/vad/vad.worker.ts` | `AutoModel, env, Tensor` | `onnx-community/silero-vad` | Test voice activity detection gating on microphone stream. Confirm speech probability scores (0.0–1.0). |
| **10** | **FlowMDM CLIP Encoder** | `packages/stage-ui/src/utils/flowmdm/clipEncoder.ts` | `AutoTokenizer, CLIPTextModelWithProjection` | `Xenova/clip-vit-base-patch32` | Test Text-to-VRMA motion generation (`generate_motion`). Verify 512d motion conditioning vector. |

---

### Track A validation results (2026-10-17, `packages/neural-runtime`, CPU EP)

All five vision tests green on `@huggingface/transformers@4.3.1` (full suite:
10 files / 20 tests pass, incl. Track B's 01/02/09/10). Device `cpu` throughout —
Node has no WebGPU, so this validates API/compat (load recipes, processor
contracts, output geometry, disposal), not accelerator perf. Sequential
`maxWorkers: 1`; RSS deltas are per-test process deltas.

| Test | Recipe (worker-mirrored) | Load | Infer | Result |
| --- | --- | --- | --- | --- |
| `03-moondream-vlm` | Direct-class + q8 vision / q4 decoder, patch probe (729), greedy 24 tok | 1.7 s (+1.8 GB) | 9.4 s, 127-char answer | PASS |
| `04-attention-guard-vision` | CLIP vision+text towers, 2 synthetic frames | 0.7 s (+0.9 GB) | 512d, self-cos ≈ 1, frames separate | PASS |
| `05-attention-guard-summarizer` | Summarizer Q/A wrapper verbatim, 48 tok | 3.1 s (+1.1 GB) | 7.0 s, non-empty caption | PASS |
| `06-blip-captioning` | `pipeline('image-to-text')`, 16 tok | 1.3 s (+1.8 GB) | 0.2 s, 41-char caption | PASS* |
| `07-background-removal` | `processor` → `model({input})` → mask → resize | 0.1 s (+66 MB) | mask [1,512,512] → 128² 1-ch | PASS |

Discrepancies found (action for leads):
- **BLIP repo (*):** `Xenova/blip-image-captioning-base` (and every `Xenova/blip-*`)
  returns **HTTP 401** — gated/removed upstream. Test validates the identical
  pipeline call shape on pullable `Xenova/vit-gpt2-image-captioning`; re-point
  once access is restored.
- **RMBG vs MODNet:** the worker ships `MODEL_IDS.BG_REMOVAL =
  'Xenova/modnet'`, not the brief's `briaai/RMBG-1.4`. Test 07 covers the
  shipped model; brief needs the update.
- **RawImage patch:** 4.3.1 tree contains **zero** `canvas.width = 0` lines —
  the workspace patch (now scoped to 3.8.1) does not apply. Test 07 pins this
  with three `it.fails` parity markers (src + both dist bundles) carrying the
  exact hunk map, so the suite stays green while the adaptation is pending.
  Functional `fromBlob → resize(378,378)` passes via sharp in Node.

### Track B validation results (2026-10-17, `packages/neural-runtime`, CPU EP)

All five audio and text models green on `@huggingface/transformers@4.3.1`. Combined with Track A, the entire 10-model testbed passes 100% green (10 test files / 20 tests pass in 38.7 s).

| Test | Recipe (worker-mirrored) | Load | Infer | Result |
| --- | --- | --- | --- | --- |
| `01-embeddinggemma` | Native `EmbeddingGemma2Model` + native `sentence_embedding` (MRL 256d) | 2.2 s (+142 MB) | 1.1 s, hit 0.807 vs miss 0.649 (sep > 0.15) | PASS |
| `02-whisper` | `WhisperForConditionalGeneration` (fp32 enc / q4 dec) + `AutoProcessor` (16kHz audio) | 0.5 s (+185 MB) | 0.5 s, streaming token generation | PASS |
| `08-kokoro` | `KokoroTTS` (q8 ONNX) + 24kHz waveform + `TextSplitterStream` streaming | 0.6 s (+165 MB) | 1.3 s, 24kHz PCM chunks, maxAmp > 0.01 | PASS |
| `09-silero-vad` | Custom architecture + `sr: 16kHz` + recurrent state `[2, 1, 128]` continuity | 0.05 s (+42 MB) | 0.03 s, speech prob (silence < 0.15, voiced tone computed) | PASS |
| `10-flowmdm-clip` | `CLIPTextModelWithProjection` + `AutoTokenizer` (512d motion vector) | 0.5 s (+350 MB) | 0.3 s, 512d unit vector, semantic separation > 0.7 | PASS |

---

### Phase 1 results (2026-10-17, Track A lane)

- **Patch ported**: `patches/@huggingface__transformers@4.3.1.patch` (same 6
  hunks × `src/utils/image.js` + `dist/transformers.js` +
  `dist/transformers.web.js`, adapted to 4.3.1's `apis.IS_WEB_ENV`/double-quote
  style), pinned in `pnpm-workspace.yaml`, verified live in the installed tree
  (`canvas.width = 0` ×6 per file). Test 07's 3 `it.fails` parity markers are
  now plain `it` and pass.
- **BLIP sunset**: `06-blip-captioning.test.ts` deleted (`Xenova/blip-*` 401s);
  `06-wd-tagger.test.ts` covers the shipped WDv1.4 path
  (`AutoModel` + `model_file_name: '../model'`, manual BGR prep, csv
  thresholds): 9,083 tags, forward 0.2 s.
- **Full gate**: `pnpm -F @proj-airi/neural-runtime test` → **10 files /
  20 tests green**; `typecheck` clean.
- **Notes**: (a) lead's 01 needs a warm HF cache — its 120 s budget can't
  cold-download 1 GB fp32 (prefetched once, now 0.9 s); recommend q4 + longer
  timeout upstream. (b) `pnpm patch-commit` normalized `pnpm-workspace.yaml`
  key order — semantic no-op. (c) Track A ran `device: 'cpu'` (no WebGPU in
  this sandbox); accelerator behavior stays with the Metal sweep (§5b).
  (d) Test files 01/02/08/09/10 are the architecture lead's concurrent Track B
  work in the same `tests/` dir — no conflicts observed.

### Non-Worker Consumers to Audit
- **ModernBERT Tokenizer in Laya Worker**: `packages/stage-ui/src/workers/laya/worker.ts` imports `AutoTokenizer` from `@huggingface/transformers` to tokenize inputs for `tozp/laya-onnx` (while running execution via direct `onnxruntime-web`).
- **Memory Lab Harness Scripts**: `scripts/tests/attention-ecology-harness/`, `scripts/tests/locomo-benchmark/precompute-embeddings.mjs`.

---

## 9. Next Steps

1. [x] Eagerly load character entity ledger in chat window (`ce56c5f144`).
2. [x] Persist quantized raw turn embeddings in IndexedDB snapshots (`4bd45d70bf`).
3. [x] Scale worker cache to 3,000 docs with tier-aware eviction (`4bd45d70bf`).
4. [x] WASM sweep completed (§5b: 8k OOM ceiling). [x] WebGPU Metal-3 sweep completed headlessly (§5b: 16k overflow ceiling, 203ms @ 512, 472ms @ 1k, 1152ms @ 2k).
5. [x] Implement turn chunking pipeline for raw turns exceeding threshold (`turn-chunker.ts`, committed `2797eb37a2`).
6. [x] Stand up unified `packages/neural-runtime` on `@huggingface/transformers@4.3.1` with isolated workspace patching (`pnpm-workspace.yaml`).
7. [x] Validate all 10 monorepo neural models (Track A Vision: 5/5 green; Track B Audio & Text: 5/5 green; full suite: 10 files / 20 tests pass in 38.7 s).
8. [ ] Port `RawImage` canvas memory-leak patch to `@huggingface/transformers@4.3.1` (adaptation hunks mapped in `07-background-removal-rmbg.test.ts`) and merge the migration into `stage-ui`.

## 10. WD Tagger WebGPU Outage — Root Cause & Anime Matting Upgrade Path (2026-10-17)

**Root cause (proven A/B in headed Brave, Metal-3, all else identical):**
`pnpm-workspace.yaml` globally pins `onnxruntime-web: npm:onnxruntime-web@^1.24.2`,
but stage-ui now runs `@huggingface/transformers@4.3.1`, which was built against
ORT 1.31. Under the pinned 1.24.2, WebGPU session creation throws
`TypeError: Failed to construct 'URL': Invalid URL` (its wasm-path bootstrap
assumes a resolvable script base that the Vite-bundled worker context does not
provide);
under the native 1.31 the identical `AutoModel.from_pretrained` call loads cleanly
in 13 s. The `Unknown model class "null"` warning is benign (EncoderOnly fallback
works). Fix: scope the override to the legacy tree
(`'@huggingface/transformers@3.8.1>onnxruntime-web': 'npm:onnxruntime-web@1.24.2'`)
and let 4.3.1 resolve its native ORT. Direct `onnxruntime-web` dependents
(`stage-ui`, `stage-pocket`, `stage-tamagotchi`, `stage-web` all pin `^1.24.2`)
are unaffected.

**Anime matting shootout (real failing sticker, Metal WebGPU, new compositing curve):**

| Model | Fwd | Corner-bg mean | Mid-range frac | Precision / Recall vs ground-truth alpha |
|---|---|---|---|---|
| MODNet (current) | 0.5 s | 0.188 | 7.3% | 0.937 / 0.94 |
| IS-Net anime | 0.5 s | 0.081 | 1.2% | **0.998 / 0.994** |
| BiRefNet full | — | — | — | BLOCKED: fp32/fp16 both die in ORT WebGPU shader compile (`ShaderHelper::AddVariableImpl`); no q4 export exists upstream |

BiRefNet-ONNX (`onnx-community/BiRefNet-ONNX`) is unloadable on our WebGPU path
despite a native 4.3.1 model class — too big/complex a graph for Dawn.
`briaai/RMBG-2.0` is HTTP 401 (gated) and therefore not shippable as-is.
**Recommendation: IS-Net anime as the sticker/card cutter** (176 MB, anime-native,
6× more decisive masks, same 0.5 s). It has no transformers config, so the bg
worker needs a raw-ORT session branch (laya-worker pattern): input `img`,
output `mask`. Keep MODNet as the photorealistic fallback behind the same
model-selector plumbing.

**Compositing fix shipped** (`applyAlphaMask`): anchored normalization
(p1/p99, floor 0.08 / ceiling 0.85) spreads compressed masks, cutoff range
widened 0.25 → 0.45, gamma smoothing kept for anti-aliased edges. Measured on
ground-truth anime art: −1 to −2.6% kept-background at equal-or-better recall.
Connected-component cleanup was evaluated and rejected: kept regions form one
blob (decor hearts are legit separate components — removal would eat them).

**Failing-image verdict (2026-10-17, `personal_airi/madoka/character-so-happy-1792009831164.png`, 1280px, Metal WebGPU, new curve @65%):**
cutouts: `tmp/embedder-poc/showdown/cutout-isnet-madoka.png` vs `cutout-modnet.png`.
IS-Net: corners kept 16.4%, character center 100% intact — clean cutout, edges tight.
MODNet: corners kept 23.9% (the exact top-right block from the bug report), character center eroded to 89.2% (eats interior highlights).
Verdict: IS-Net is the fix for anime stickers. Remaining 16% corner residue on IS-Net is the faint "KusArt" watermark text, not background wash — correct behavior.
