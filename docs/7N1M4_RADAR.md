# AIRI 7n1m4 Fork Radar

> **Living Intelligence Ledger**: Tracks continuous delta, PR activity, roadmap issues, and commits from the 7n1m4 sister fork (`7n1m4/airi`) to inform high-velocity cherry-picking and synchronization into `dasilva333/airi`.
> Generated and maintained by Antigravity Scheduled Tasks via `scripts/upstream-tracker.mjs --7n1m4`.

> [!CAUTION]
> ### CHERRY-PICK POLICY: STRICT BAN ON BLIND "VIBE-CODE" ADOPTION
> **7n1m4 operates via high-velocity agentic "vibe-coding" en masse with little-to-no actual real-world end-to-end testing.**
> - **Zero Blind Cherry-Picks**: NEVER blindly merge, adopt, or hoist features, providers, or scripts from `7n1m4/airi` solely because code or static unit test mocks compile.
> - **Mandatory Real-World Empirical Verification**: Every candidate cherry-pick MUST be manually verified and live-tested against actual network endpoints, real browser/desktop sessions, and user workflows before adoption into `dasilva333/airi`.
> - **Empirical Provenance (Case Study)**:
>   - **LanLan Free (`lanlan-free`)**: Looked plausible on paper and passed static mock tests, but live inference failed instantly with `{"error": "Invalid request: you are not using Lanlan. STOP ABUSE THE API."}` because the author copy-pasted endpoints from an external repo without testing live chat completions.
>   - **MiMo Free (`mimo`)**: Routing model `mimo-auto` failed with HTTP 400 (`Unsupported model mimo-auto`) due to upstream API sunset.
>   - **Kilo (`kilo-auto/free`)**: Verified live with sub-1300ms TTFT and retained alongside Pollinations as our genuine zero-setup free cloud options.
> - **Quarantine Speculative Architecture**: P2P mesh networking, WebRTC sidecars, and untested scripts must remain quarantined in design documents (`docs/phase-2b-mesh-and-nap-chat.md`) until proven solid.

---

<!-- RADAR_ENTRIES -->

## [2026-10-20] 7n1m4 Fork Delta: `2988fb78..cf090ed5` (11 commits, 88 files, 1 update(s))

### 🎯 Executive Highlights
**Sister Fork Intelligence Briefing & Cherry-Pick Provenance**:

• **Adopted Cherry-Picks in dasilva333/airi**:
  - `9221056bf` ➔ `adc8b4555`: Fixed 77 stage-ui typecheck errors across test files and removed 37 brittle type casts.
  - `27e08e167` ➔ `fc05b0f48`: Added `closePacing()` in `turn-pacing-coordinator.ts` to clear stale `nextEligibleAtMs`, +729 lines of test coverage (66/66 passing), and fixed `layered-memory` mock in `memory-text-journal.test.ts` (18/18 passing).
  - `09ab62d1c` ➔ `574c2b7ab`: Added canonical Vue ambient shims (`env.d.ts`) across 13 workspaces and fixed tsconfig exclude inheritance for child packages (verified passing `vue-tsc --noEmit` with 0 errors).

• **Executive Highlights**:
  7n1m4 completed an 11-commit stabilization blitz across 88 files focusing on repo-wide typecheck resolution and test hardening. They resolved pacing timer leaks, prevented libp2p websockets teardown hangs on Bun via `webSocketsCloseSafe` (`8a8a3f796`), and retired the standalone cleanroom attention harness in favor of in-app Vision DevTools and `pixels.test.ts` (`cf090ed5b`).

• **Discussion Velocity**:
  Activity on master roadmap Issue #1 (`wayfinder: Cloudflare Purge → libp2p Local Mesh → Agentic OS`) with +1 new comment. @dasilva333 submitted an architectural proposal introducing a pluggable `TransportAdapter` interface to bridge 7n1m4's local libp2p mesh with upstream without forcing divergent silos.

• **Collision & Integration Warnings**:
  - `apps/stage-tamagotchi/src/main/services/airi/libp2p/`: Keep quarantined behind the pluggable `TransportAdapter` interface.
  - `scripts/tests/attention-ecology-harness/`: Standalone harness was deleted upstream; retained locally per user preference.

### 📋 7n1m4 Fork Commits
- `cf090ed5b` test: retire the attention-ecology cleanroom harness  _(vi, 2026-10-20)_
- `ac7c91725` style: drop stray blank lines in stage-pocket tsconfig  _(vi, 2026-10-20)_
- `de5b8bfa4` chore: stop tracking tsbuildinfo build artifact  _(vi, 2026-10-20)_
- `f26052953` test: tolerate cross-engine float drift; scope browser test and audit parsing  _(vi, 2026-10-20)_
- `09ab62d1c` fix: green repo typecheck — vue ambient shims and tsconfig input resolution  _(vi, 2026-10-20)_
- `8a8a3f796` fix: stop libp2p websockets teardown from hanging on Bun  _(vi, 2026-10-20)_
- `27e08e167` fix: clear stale nextEligibleAtMs on pacing close, and fix 5 pre-existing test failures  _(vi, 2026-10-20)_
- `9221056bf` fix: resolve 77 stage-ui typecheck errors without casts  _(vi, 2026-10-20)_
- `c4f4c4488` fix: remove duplicated test block in agentic-intentions.test.ts (syntax error)  _(vi, 2026-10-20)_
- `94e15a6e7` chore: improve coverage batch 9 (audio, consciousness, presence, airi-card, modules/index, providers/helpers, use-model-preload)  _(vi, 2026-10-20)_
- `ba1c5d4fb` chore: improve coverage batch 8 (turn-pacing-coordinator, audio, consciousness, settings-catalog, memory-sentinel, color-from-element, entity-ledger, faculty-defaults, presence)  _(vi, 2026-10-20)_

### 🔬 Subsystem Breakdown
#### Documentation & Scaffolding (`⚪ ignore`) — 5 file(s) (+42/-47)
- `.agents/skills/airi-attention-ecology-vision/SKILL.md` *(+4/-7)*
- `docs/design-attention-ecology-screen-watching.md` *(+26/-38)*
- `docs/env.d.ts` *(+10/-0)*
- `docs/project-testing-parity.md` *(+1/-2)*
- `docs/tsconfig.json` *(+1/-0)*

#### Other / Uncategorized (`🔍 inspect`) — 33 file(s) (+2338/-179)
- `apps/component-calling/src/env.d.ts` *(+10/-0)*
- `packages/motion-driver-magic/src/var-ar-hmm.test.ts` *(+36/-8)*
- `packages/stage-ui-mmd/src/env.d.ts` *(+10/-0)*
- `packages/stage-ui-spine/src/env.d.ts` *(+10/-0)*
- `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm-fps.browser.test.ts` *(+6/-0)*
- `packages/stage-ui/src/composables/api.test.ts` *(+2/-9)*
- `packages/stage-ui/src/composables/use-inference-status.test.ts` *(+1/-1)*
- `packages/stage-ui/src/composables/use-model-preload.test.ts` *(+405/-0)*
- `packages/stage-ui/src/constants/settings-catalog.test.ts` *(+9/-5)*
- `packages/stage-ui/src/constants/settings-search-index.test.ts` *(+5/-0)*
- `packages/stage-ui/src/libs/auth.test.ts` *(+1/-1)*
- `packages/stage-ui/src/libs/color-from-element.test.ts` *(+29/-22)*
- `packages/stage-ui/src/libs/pacing/turn-pacing-coordinator.test.ts` *(+817/-4)*
- `packages/stage-ui/src/libs/pacing/turn-pacing-coordinator.ts` *(+24/-24)*
- `packages/stage-ui/src/libs/providers/tool-schema.test.ts` *(+52/-28)*
- `packages/stage-ui/src/libs/providers/types.test.ts` *(+9/-3)*
- `packages/stage-ui/src/libs/search/entity-ledger.test.ts` *(+4/-4)*
- `packages/stage-ui/src/stores/agentic-guard.test.ts` *(+11/-2)*
- `packages/stage-ui/src/stores/agentic-intentions.test.ts` *(+0/-13)*
- `packages/stage-ui/src/stores/auth.test.ts` *(+1/-1)*
- `packages/stage-ui/src/stores/backup.test.ts` *(+43/-16)*
- `packages/stage-ui/src/stores/character/orchestrator/agents/event-handler-spark-notify/index.test.ts` *(+16/-16)*
- `packages/stage-ui/src/stores/modules/airi-card.test.ts` *(+252/-2)*
- `packages/stage-ui/src/stores/modules/artistry-autonomous.test.ts` *(+4/-0)*
- `packages/stage-ui/src/stores/modules/consciousness.test.ts` *(+31/-2)*
- `packages/stage-ui/src/stores/modules/index.test.ts` *(+62/-0)*
- `packages/stage-ui/src/stores/modules/tools/text-journal.test.ts` *(+3/-3)*
- `packages/stage-ui/src/stores/modules/vision/orchestrator.test.ts` *(+41/-7)*
- `packages/stage-ui/src/stores/nap-chat-surface.test.ts` *(+11/-2)*
- `packages/stage-ui/src/stores/presence-electron.test.ts` *(+67/-1)*
- `packages/stage-ui/src/utils/memory-sentinel.test.ts` *(+8/-0)*
- `packages/stage-ui/src/workers/attention-guard/engine/pixels.test.ts` *(+347/-0)*
- `packages/stage-ui/src/workers/attention-guard/engine/pixels.ts` *(+11/-5)*

#### Root Build & Tooling (`🔍 inspect`) — 25 file(s) (+55/-3358)
- `apps/stage-mate/tsconfig.json` *(+9/-0)*
- `package.json` *(+0/-4)*
- `packages/cap-vite/tsconfig.json` *(+9/-0)*
- `packages/stream-kit/tsconfig.json` *(+9/-0)*
- `scripts/audit-test-catalog.mjs` *(+28/-3)*
- `scripts/tests/attention-ecology-harness/.gitignore` *(+0/-5)*
- `scripts/tests/attention-ecology-harness/engine/screen-capture.ts` *(+0/-150)*
- `scripts/tests/attention-ecology-harness/engine/stage0-phash.ts` *(+0/-110)*
- `scripts/tests/attention-ecology-harness/engine/stage1-vision-embed.ts` *(+0/-152)*
- `scripts/tests/attention-ecology-harness/engine/stage2-ocr.ts` *(+0/-255)*
- `scripts/tests/attention-ecology-harness/engine/stage2-salience-eval.ts` *(+0/-216)*
- `scripts/tests/attention-ecology-harness/engine/stage3-vlm-forwarder.ts` *(+0/-251)*
- `scripts/tests/attention-ecology-harness/eval-attention-ecology.ts` *(+0/-339)*
- `scripts/tests/attention-ecology-harness/live-desktop-dashboard.ts` *(+0/-417)*
- `scripts/tests/attention-ecology-harness/live-desktop-observer.ts` *(+0/-171)*
- `scripts/tests/attention-ecology-harness/live-ticker-observer.ts` *(+0/-138)*
- `scripts/tests/attention-ecology-harness/package.json` *(+0/-18)*
- `scripts/tests/attention-ecology-harness/pnpm-lock.yaml` *(+0/-1116)*
- `scripts/tests/attention-ecology-harness/test-screenshots/01-static-editor.png` *(+0/-0)*
- `scripts/tests/attention-ecology-harness/test-screenshots/02-static-editor-cursor.png` *(+0/-0)*
- `scripts/tests/attention-ecology-harness/test-screenshots/03-window-switch-term.png` *(+0/-0)*
- `scripts/tests/attention-ecology-harness/test-screenshots/04-term-error-stack.png` *(+0/-0)*
- `scripts/tests/attention-ecology-harness/test-screenshots/05a-browser-video-frame1.png` *(+0/-0)*
- `scripts/tests/attention-ecology-harness/test-screenshots/05b-browser-video-frame2.png` *(+0/-0)*
- `scripts/tests/attention-ecology-harness/tsconfig.json` *(+0/-13)*

#### Mobile & Web Platforms (`⚪ ignore / low-priority`) — 4 file(s) (+60/-4)
- `apps/stage-pocket/src/env.d.ts` *(+10/-0)*
- `apps/stage-pocket/tsconfig.json` *(+21/-3)*
- `apps/stage-web/src/env.d.ts` *(+10/-0)*
- `apps/stage-web/tsconfig.json` *(+19/-1)*

#### Electron Desktop Shell (`⚠️ hand-merge`) — 7 file(s) (+251/-5)
- `apps/stage-tamagotchi/src/env.d.ts` *(+10/-0)*
- `apps/stage-tamagotchi/src/main/services/airi/libp2p/index.ts` *(+2/-2)*
- `apps/stage-tamagotchi/src/main/services/airi/libp2p/transports.test.ts` *(+11/-1)*
- `apps/stage-tamagotchi/src/main/services/airi/libp2p/websockets-bun-close.ts` *(+211/-0)*
- `apps/stage-tamagotchi/tsconfig.node.json` *(+12/-1)*
- `apps/stage-tamagotchi/tsconfig.node.tsbuildinfo` *(+0/-1)*
- `apps/stage-tamagotchi/tsconfig.web.json` *(+5/-0)*

#### Stage Layouts & Shells (`🔍 inspect`) — 1 file(s) (+10/-0)
- `packages/stage-layouts/src/env.d.ts` *(+10/-0)*

#### UI Primitives & Pages (`📦 import / inspect`) — 4 file(s) (+41/-0)
- `packages/stage-pages/src/env.d.ts` *(+10/-0)*
- `packages/ui-loading-screens/src/env.d.ts` *(+11/-0)*
- `packages/ui-transitions/src/env.d.ts` *(+10/-0)*
- `packages/ui/src/env.d.ts` *(+10/-0)*

#### 3D, Live2D & Motion (`🔍 inspect`) — 2 file(s) (+20/-0)
- `packages/stage-ui-live2d/src/env.d.ts` *(+10/-0)*
- `packages/stage-ui-three/src/env.d.ts` *(+10/-0)*

#### Audio & Speech Pipeline (`🔍 inspect`) — 1 file(s) (+63/-25)
- `packages/stage-ui/src/stores/audio.test.ts` *(+63/-25)*

#### Cognitive & Consciousness (`⚠️ hand-merge`) — 2 file(s) (+15/-3)
- `packages/stage-ui/src/stores/chat/text-journal-tool.test.ts` *(+3/-3)*
- `packages/stage-ui/src/stores/memory-text-journal.test.ts` *(+12/-0)*

#### Provider & Model Integrations (`📦 import / inspect`) — 4 file(s) (+358/-18)
- `packages/stage-ui/src/stores/providers/helpers.test.ts` *(+302/-0)*
- `packages/stage-ui/src/stores/providers/registry/chat-local.test.ts` *(+2/-2)*
- `packages/stage-ui/src/stores/providers/registry/local-engines.test.ts` *(+50/-12)*
- `packages/stage-ui/src/stores/providers/registry/speech.test.ts` *(+4/-4)*

### 📬 7n1m4 Fork Activity Radar
#### 💬 Discussion Activity (1)
- [Issue] [#1](https://github.com/7n1m4/airi/issues/1) `wayfinder: Cloudflare Purge → libp2p Local Mesh → Agentic OS` — *+1 comments (1 ➔ 2 total)*

### 👁️ Watched 7n1m4 Fork Monitor
- [PR] [#7](https://github.com/7n1m4/airi/pull/7) `feat(agentic): presence single source + nap & companion nap-chat` [MERGED] — *(1 comments)*
  - *Focus*: Presence-derived idle state triggering autonomous peer-to-peer companion nap-chat over libp2p with memory write-back & recap
- [PR] [#6](https://github.com/7n1m4/airi/pull/6) `feat(libp2p): complete pairing over the wire and paired-device management` [MERGED] — *(0 comments)*
  - *Focus*: Wire pairing negotiation, multiaddr identity storage, and eventa message transport
- [PR] [#8](https://github.com/7n1m4/airi/pull/8) `fix: migrate zod imports to default for Node 26 Vite SSR interop` [MERGED] — *(0 comments)*
  - *Focus*: Vite SSR interop for Node 26 runtime
- [Issue] [#1](https://github.com/7n1m4/airi/issues/1) `wayfinder: Cloudflare Purge → libp2p Local Mesh → Agentic OS` [OPEN] — 🚨 **+1 comments** (2 total)
  - *Focus*: Violet's master roadmap and architectural milestone tracker
- [Issue] [#4](https://github.com/7n1m4/airi/issues/4) `Phase 3: Agentic OS Integration` [OPEN] — *(0 comments)*
  - *Focus*: Autonomous mode toggle, memory-driven proactive intentions, Jev decision loop

---
