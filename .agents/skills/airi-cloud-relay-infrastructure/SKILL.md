---
name: airi-cloud-relay-infrastructure
description: >-
  Develop/debug Cloudflare Workers character relays: Edge KV memory, Discord interaction webhooks, CloudflareStageDeployer, CORS reverse proxy. Local WebSocket pairing uses airi-gateway-websocket-protocol; release packaging uses airi-release-packaging-deploy.
---

# AIRI Cloud Relay & Edge Infrastructure

Governs **Cloud Relay** ("Vercel for Characters"). AIRI local desktop acts as the zero-custody control plane and authoring studio; serverless Cloudflare Workers handle 24/7 proactive character presence, Discord interaction webhooks, and Edge KV state while the local client is offline.

Philosophy: **Local-First, Zero-Custody, Edge-Native**. There are no proprietary AIRI backend servers; character instances run on user-owned Cloudflare accounts.

---

## 1. Verified Surface Map

### Worker source (`apps/stage-edge/`)
- `src/index.ts` — HTTP Interaction Worker entry (V8 isolate): OPTIONS preflight, `/health`, `/cors-proxy` + `/proxy` (Web CORS reverse-proxy), POST `/discord` (Ed25519-verified interaction webhook), re-exports `EmbassyDO` and `DiscordHostDO`.
- `src/discord/acl.ts` — `UserRole` enum `OWNER | DESIGNATED | VISITOR` + `isAllowedInteraction(userId, config)` (owner or designated only).
- `src/discord/client.ts` — Discord REST helpers: `fetchDiscordPublicKey(botToken)`, `registerSlashCommands`, `updateInteractionsEndpointUrl`.
- `src/crypto/ed25519.ts` — `verifyDiscordSignature` Ed25519 verification for EVERY incoming webhook (including Type 1 PING).
- `src/inference/llm.ts` — provider-agnostic OpenAI-compatible caller (`generateLlmReply`).
- `src/memory/kv.ts` — `KvMemoryStore`: transactional per-turn keys + `MemoryWindowConfig` (`fixed` default 10, `unlimited` full context).
- `src/templates/character.ts` — `buildSystemInstruction({ name, personality, systemPrompt })`.
- `src/deployer/index.ts` — `CloudflareStageDeployer` (client-side deployer, OAuth token or PKCE flow).
- `src/deployer/oauth.ts` — Cloudflare OAuth 2.0 PKCE flow (openauthorization popup used by onboarding).
- `src/deployer/packager.ts` — in-memory esbuild Worker bundling; on failure falls back to `../bundle-code` `BUNDLED_WORKER_SCRIPT`.
- `src/cli.ts`, `src/bundle-code.ts` — CLI helper + static fallback bundle.

### Standalone Gateway DO Host (`apps/stage-edge-discord-do/`)
- `src/index.ts` — Worker entry point, HTML status dashboard (`GET /`), `/status`, `/connect`, `/disconnect`, `/events`.
- `src/discord-host-do.ts` — `DiscordHostDO`: SQLite Durable Object establishing and maintaining persistent outbound WebSocket connection to `wss://gateway.discord.gg`, managing heartbeats, resume state, and message dispatch.
- `src/discord/protocol.ts` — Pure Discord Gateway protocol encoders: Op 10 `HELLO`, Op 1 `HEARTBEAT`, Op 2 `IDENTIFY`, Op 6 `RESUME`, Op 11 `HEARTBEAT_ACK`.
- `src/discord/rest.ts` — Direct REST channel messaging (`sendDiscordMessage`) and `@me` identity queries.
- `wrangler.json` — SQLite migration (`DiscordHostDO`) and binding definitions.

### Shared Gateway Protocol Library (`packages/gateway-discord/`)
- Target location for extracted protocol serialization, opcode enums, and intent calculations shared across edge and client surfaces.

### Desktop control plane (`packages/stage-ui/src/stores/modules/`)
- `cloudflare.ts` — OAuth session, `CloudflareStageDeployer` facade calls, `saveToEdgeVault`/`fetchFromEdgeVault` (Edge Vault CRUD, namespace titled `airi-edge-vault`).
- `discord.ts` — `deployCloudRelay` action + `cloudRelayInstances` persisted map (see §4), `fetchCloudRelayMemories(namespaceId, key)`.
- `modules/onboarding-v2` — Step 7 Cloud Infra: OAuth PKCE → deploy CORS proxy / Discord worker / R2 backup, restore from existing instances.

### Design docs
- `docs/design-cloud-relay.md` — master Cloud Relay architecture doc.
- `docs/project-generic-cloudflare-framework-plan.md` — generic Cloudflare framework plan.
- `docs/design-discord-control-plane.md`, `docs/design-discord-context-routing.md` — control-plane + context-routing lineage. (There is NO `docs/design-discord-cloud-relay.md`.)

---

## 2. Env Contract & Worker Runtime

```ts
export interface Env {
  LLM_API_KEY: string // secret_text binding
  LLM_MODEL?: string // plain_text (e.g. 'gemini-3.5-flash-lite')
  LLM_BASE_URL?: string // plain_text, provider-agnostic
  DISCORD_PUBLIC_KEY: string // secret_text
  DISCORD_BOT_TOKEN?: string // secret_text (required for Gateway WebSocket & REST channel posting)
  SYSTEM_PROMPT?: string // optional; overridable from KV 'system/prompt'
  CHARACTER_NAME?: string // plain_text
  MEMORY?: KVNamespace // kv_namespace binding
  DISCORD_HOST?: DurableObjectNamespace // DO namespace binding for DiscordHostDO
  EMBASSY?: DurableObjectNamespace // DO namespace binding for EmbassyDO
}
```

Worker behavior (`src/index.ts`):
- **OPTIONS**: CORS preflight, `Access-Control-Allow-Origin: *`.
- **`/health`**: `{ status: 'ok', worker: '@proj-airi/stage-edge' }`.
- **`/cors-proxy` / `/proxy`**: `?url=` or `x-target-url` header; strips `host`/`referer`/`origin`; `x-target-authorization` remaps to `Authorization`. Used for provider APIs on the Edge without leaking keys to the client.
- **`/discord`**: verify Ed25519 (401 on failure). Type 1 → `{type:1}` PONG. Type 2 → load `system/prompt` from KV if present (overrides `SYSTEM_PROMPT`), read `context/rolling`, run `generateLlmReply`, then **defer** with `ctx.waitUntil` + reply `{type:5}` (Discord DEFERRED). The deferred job:
  - pushes user+assistant turns into `context/rolling` (capped at 50), PATCHes `messages/@original` at `https://discord.com/api/v10/webhooks/{appId}/{token}/messages/@original`;
  - **2000-char trim** — `safeContent.slice(0, 1930) + "\n\n*(Truncated to fit Discord 2000-character limit)*"`;
  - on error PATCHes an inline error message (`Edge Inference Error: ... | baseUrl= | model=`).

> [!NOTE]
> **KV layout (verified against source)**: the worker uses `system/prompt` (bypasses 5.1KB binding-size caps), `context/rolling` (JSON array of `{role,content}` history), and `ping → pong` seed. `KvMemoryStore` additionally writes per-turn keys `history_{userId}_turn_{timestamp}_{turnId}` for fixed/unlimited windows. Older skill/docs drafts naming `context/summary`, `memory/facts`, `meta/config` do **not** exist in source — do not reintroduce them.

---

## 3. Stateful Channel Presence: Discord Gateway via SQLite Durable Objects

While stateless HTTP interactions handle slash commands (`/status`, `/imagine`), natural conversation banter in Discord channels requires **persistent presence without command prefixes**.

### A. Inbound vs Outbound WebSockets on Cloudflare
- **Inbound WebSocket Hibernation (`ctx.acceptWebSocket`)**: Used by `EmbassyDO` for client devices connecting *to* Cloudflare. The V8 isolate sleeps at 0 CPU while Cloudflare holds the TCP socket open.
- **Outbound WebSocket Client (`new WebSocket(url)`)**: Used by `DiscordHostDO` connecting *outbound* to `wss://gateway.discord.gg/?v=10&encoding=json`. Outbound sockets do **not** use server-side hibernation; Cloudflare keeps the Durable Object alive in memory as an active I/O session as long as the TCP connection and heartbeats are active.

### B. Organic Wake & 15-Minute Hardcoded Idle Sleep Lifecycle
To prevent burning continuous GB-second billing when a channel is idle, the architecture uses a hardcoded 15-minute idle sleep lifecycle:
1. **Dormant Baseline:** `DiscordHostDO` compute is shut down (0 memory, 0 CPU).
2. **Organic Wake-on-First-Turn:** A user types `/chat <msg>` (or an interaction hits `POST /discord`). The HTTP isolate handles turn 1 and triggers `env.DISCORD_HOST.get(channelId).fetch('/connect')`.
3. **Active Channel Banter:** The DO connects outbound to Discord Gateway, listens to `MESSAGE_CREATE` events in that channel, invokes `generateLlmReply()`, and replies directly via REST.
4. **Deterministic Teardown (15-Minute Alarm):**
   - On every message, the DO sets/resets an inactivity alarm: `ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000)`.
   - When no messages occur for 15 minutes, Cloudflare invokes `alarm()`.
   - The DO sends a sleep notification ("🌛 Going to sleep now..."), cleanly closes the socket (`ws.close(1000)`), and shuts down. Compute drops back to 0.

### C. Gateway Protocol Specifications & Privileged Intents
- **URL**: `wss://gateway.discord.gg/?v=10&encoding=json`
- **Privileged Gateway Intents**: Discord requires `MESSAGE_CONTENT` (`1 << 15`) to read message bodies. In Developer Portal -> Bot -> Privileged Gateway Intents, **Message Content Intent** MUST be enabled. Default intent mask: `GUILDS (1) | GUILD_MESSAGES (512) | DIRECT_MESSAGES (4096) | MESSAGE_CONTENT (32768) = 37377`.
- **Token Formatting Invariant**:
  - In Gateway Op 2 `IDENTIFY`: pass the raw token string (`token`) **without** any `"Bot "` prefix.
  - In REST API calls (`https://discord.com/api/v10/...`): the header **must** be `Authorization: Bot ${token}`.
- **Heartbeat & ACK Monitoring**:
  - Op 10 `HELLO` provides `heartbeat_interval` (~41.25s).
  - First heartbeat fires after jitter: `Math.floor(interval * Math.random())`. Subsequent heartbeats fire every `interval` with Op 1 and `lastSeq`.
  - Op 11 `HEARTBEAT_ACK` updates ack timestamp. If `now - lastAck > interval * 2`, the socket is zombied and must reconnect.
- **Resuming via SQLite Persistence**:
  - DO stores `session_id`, `resume_gateway_url`, `last_seq`, and `turn_count` in embedded SQLite (`gateway_state`).
  - On unexpected disconnects or isolate recycling, DO reconnects to `resume_gateway_url` using Op 6 `RESUME` (`{ token, session_id, seq }`) without dropping state or missing replay events.

---

## 4. CloudflareStageDeployer (Deployment)

`CloudflareStageDeployer` (ApiToken or OAuth-derived token) drives everything from the client:

- `getAccounts()` / `ensureAccountId()` — account resolution.
- `getSubdomain()` / `setSubdomain()` — workers.dev subdomain probe/claim (`PUT /accounts/{id}/workers/subdomain`).
- `ensureKvNamespace(title)` — dedupe by title else create; returns namespace ID. On deploy the worker creates **`airi-kv-{scriptName}`**.
- `setKvValue` / `getKvValue` — direct KV writes/reads.
- `deployWorker(options)`:
  1. Auto-resolve Discord Public Key from bot token (`fetchDiscordPublicKey`); fallback `demo_public_key_fallback`.
  2. `ensureKvNamespace('airi-kv-{scriptName}')`; seed `ping→pong`, optional `system/prompt`, optional `context/rolling`.
  3. Bundle via `packageWorkerScript()` (esbuild in-memory) with `BUNDLED_WORKER_SCRIPT` fallback.
  4. PUT script: `main_module: 'index.mjs'`, `compatibility_date: '2025-02-04'`, `compatibility_flags: ['nodejs_compat']`, bindings — `MEMORY` (kv_namespace), `CHARACTER_NAME`, `LLM_BASE_URL`, `LLM_MODEL` (plain_text), `LLM_API_KEY`, `DISCORD_PUBLIC_KEY` (secret_text).
  5. Register/enable workers.dev subdomain, derive `https://{scriptName}.{subdomain}.workers.dev`.
  6. Register the interactions endpoint (`{workerUrl}/discord`) + global slash commands via bot token.
  - Returns `{ workerUrl, namespaceId, publicKey }`.
- `deployCorsProxy()` — deploys the standalone CORS reverse-proxy worker (`airi-cors-proxy` by default), same subdomain flow.
- `deleteWorker(scriptName)` — tears down a deployed Worker.

---

## 4. CloudflareStageDeployer (Deployment)

`CloudflareStageDeployer` (ApiToken or OAuth-derived token) drives everything from the client:

- `getAccounts()` / `ensureAccountId()` — account resolution.
- `getSubdomain()` / `setSubdomain()` — workers.dev subdomain probe/claim (`PUT /accounts/{id}/workers/subdomain`).
- `ensureKvNamespace(title)` — dedupe by title else create; returns namespace ID. On deploy the worker creates **`airi-kv-{scriptName}`**.
- `setKvValue` / `getKvValue` — direct KV writes/reads.
- `deployWorker(options)`:
  1. Auto-resolve Discord Public Key from bot token (`fetchDiscordPublicKey`); fallback `demo_public_key_fallback`.
  2. `ensureKvNamespace('airi-kv-{scriptName}')`; seed `ping→pong`, optional `system/prompt`, optional `context/rolling`.
  3. Bundle via `packageWorkerScript()` (esbuild in-memory) with `BUNDLED_WORKER_SCRIPT` fallback.
  4. PUT script: `main_module: 'index.mjs'`, `compatibility_date: '2025-02-04'`, `compatibility_flags: ['nodejs_compat']`.
     - Standard bindings: `MEMORY` (kv_namespace), `CHARACTER_NAME`, `LLM_BASE_URL`, `LLM_MODEL` (plain_text), `LLM_API_KEY`, `DISCORD_PUBLIC_KEY` (secret_text).
     - Stateful Gateway DO bindings (when enabled):
       - `DISCORD_HOST`: `{ type: 'durable_object_namespace', name: 'DISCORD_HOST', class_name: 'DiscordHostDO' }`
       - `DISCORD_BOT_TOKEN`: `{ type: 'secret_text', name: 'DISCORD_BOT_TOKEN', text: options.discordBotToken }`
       - Migrations payload: `metadata.migrations = { new_tag: 'v2', steps: [{ new_sqlite_classes: ['EmbassyDO', 'DiscordHostDO'] }] }`
  5. Register/enable workers.dev subdomain, derive `https://{scriptName}.{subdomain}.workers.dev`.
  6. Register the interactions endpoint (`{workerUrl}/discord`) + global slash commands via bot token.
  - Returns `{ workerUrl, namespaceId, publicKey }`.
- `deployCorsProxy()` — deploys the standalone CORS reverse-proxy worker (`airi-cors-proxy` by default), same subdomain flow.
- `deleteWorker(scriptName)` — tears down a deployed Worker.

### Unified Worker vs Multi-Worker Policy
Always prefer **One Unified Worker** (`apps/stage-edge`) exporting both stateless HTTP handlers and stateful Durable Object classes (`EmbassyDO`, `DiscordHostDO`). Multi-worker deployments (separate HTTP webhook worker and separate DO worker) add cross-worker authentication overhead, extra subdomain slots, and unnecessary failure boundaries.

---

## 5. Control Plane State & Persistence

`deployCloudRelay` (discord.ts) persists each instance into `cloudRelayInstances` — a `useLocalStorageManualReset` map keyed by `scriptName`:

```ts
interface CloudRelayInstance {
  scriptName: string
  workerUrl: string
  namespaceId: string
  memoryMode: 'fixed' | 'unlimited' // 'unlimited' when unset
  deployedAt: number
  cardId: string
  sessionId: string
}
```

- `fetchCloudRelayMemories(namespaceId, key = 'context/rolling')` pulls rolling history back into the local client.
- **Execution handover**: when a relay instance is deployed with `executionMode: 'remote'`, the local gateway pauses its own Discord turn loop; a memory-review modal offers restoring/merging remote context back once responses arrive. Keep this handover aware in any pipeline change (proactivity/chat flows must NOT double-answer).

---

## 6. Core SOPs

1. **Worker execution limits**: `stage-edge` runs in a V8 isolate — no Node built-ins beyond `nodejs_compat`; keep hot paths light (no heavy synchronous loops).
2. **Deterministic instance mapping**: always reconcile `namespaceId` ↔ `cloudRelayInstances` when syncing relay memories back to the local desktop; rely on the store map, never guess names.
3. **Secrets stay server-side**: `LLM_API_KEY`/`DISCORD_PUBLIC_KEY`/`DISCORD_BOT_TOKEN` are `secret_text` bindings; the client never reads them back. CORS purposes are handled by `/cors-proxy` so provider keys are not exposed to the renderer.
4. **Ed25519 first**: every Discord interaction — including Type 1 — must pass `verifyDiscordSignature`. Never accept Type 1/2 requests without verification.
5. **Gateway Message Content Intent**: Before running or deploying `DiscordHostDO`, ensure the target Discord Bot Application has "Message Content Intent" turned ON under Privileged Gateway Intents in the Discord Developer Portal; otherwise the Gateway immediately terminates with fatal error 4014.
6. **Hardcoded 15-Minute Inactivity Alarm**: Keep the DO inactivity sleep teardown strictly hardcoded to 15 minutes (`ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000)`). Do not expose complex user-configurable timeouts to avoid edge runtime drift.

---

## 7. Known Pitfalls & Failure Modes

- **Outbound vs Inbound Hibernation**: Do NOT attempt to pass outbound client WebSockets (`new WebSocket('wss://gateway.discord.gg')`) to `ctx.acceptWebSocket()`. That API is strictly for inbound server-side WebSockets. Outbound sockets stay alive via active I/O and heartbeats.
- **Token Prefix Mismatch**:
  - Discord Gateway Op 2 `IDENTIFY` expects raw token string (`token`) with NO prefix.
  - Discord REST API calls (`/channels/{id}/messages`) expect `Authorization: Bot ${token}`. Sending `"Bot <token>"` in Gateway IDENTIFY causes opcode rejection.
- **Defers must PATCH**: Type 5 (deferred) requires the later PATCH to `messages/@original`; forgetting the waitUntil PATCH leaves the slash command "thinking" forever.
- **2000-char cap**: untrimmed replies over 2000 chars are rejected by Discord with an HTTP 400 PATCH error.
- **KV binding size**: large system prompts exceed the 5.1KB binding cap — read them from the `system/prompt` KV key instead (verified pattern in `src/index.ts`).
- **Eventual consistency**: Cloudflare KV propagation lag can momentarily desync edge reads; the per-turn key adapter (`history_*`) keeps windows coherent on writes-afforded reads.
- **No `docs/design-discord-cloud-relay.md`**: link the two real lineage docs (`design-discord-control-plane.md`, `design-discord-context-routing.md`), never a nonexistent path.

## Related Skills & References

- **Key Documents**: [[design-cloud-relay]], [[project-generic-cloudflare-framework-plan]], [[design-discord-control-plane]], [[design-discord-context-routing]], [[design-discord-cloud-relay]]

### Authoritative Design & Architecture Documents

- [docs/design-cloud-relay.md](docs/design-cloud-relay.md) — Master document for Cloud Relay Architecture.
- [docs/project-byos-cloud-sync.md](docs/project-byos-cloud-sync.md) — BYOS cloud sync logic and S3/R2 reconciliations.
- [docs/project-audit-cloudsync.md](docs/project-audit-cloudsync.md) — Cloud sync audit.
- [docs/project-generic-cloudflare-framework-plan.md](docs/project-generic-cloudflare-framework-plan.md) — Generic Cloudflare framework plan.
- [docs/brainstorms/2026-07-04-commercial-backend-subscription-requirements.md](docs/brainstorms/2026-07-04-commercial-backend-subscription-requirements.md) — Commercial backend subscription requirements brainstorm.
- [docs/brainstorms/2026-07-06-commercial-backend-customer-acceptance-checklist.md](docs/brainstorms/2026-07-06-commercial-backend-customer-acceptance-checklist.md) — Commercial backend customer acceptance checklist.
- [docs/superpowers/specs/2026-07-04-commercial-backend-phase-0-design.md](docs/superpowers/specs/2026-07-04-commercial-backend-phase-0-design.md) — Commercial backend phase 0 design.
- [docs/superpowers/specs/2026-07-04-commercial-backend-phase-1-provider-data-boundary-design.md](docs/superpowers/specs/2026-07-04-commercial-backend-phase-1-provider-data-boundary-design.md) — Provider data boundary design.
- [docs/superpowers/specs/2026-07-04-phase-1-hard-block-design.md](docs/superpowers/specs/2026-07-04-phase-1-hard-block-design.md) — Phase 1 hard block design.
- [docs/superpowers/plans/2026-07-04-commercial-backend-phase-0-closure.md](docs/superpowers/plans/2026-07-04-commercial-backend-phase-0-closure.md) — Commercial backend phase 0 closure plan.
- [docs/superpowers/plans/2026-07-04-commercial-backend-phase-1-provider-data-boundary.md](docs/superpowers/plans/2026-07-04-commercial-backend-phase-1-provider-data-boundary.md) — Provider data boundary plan.
- [docs/arch-gateway-security-hardening.md](docs/arch-gateway-security-hardening.md) — Gateway security hardening architecture.
- [docs/delivery/AIRI-customer-deployment-guide.zh-CN.md](docs/delivery/AIRI-customer-deployment-guide.zh-CN.md) — AIRI customer deployment guide.
