# Design Document: Cloud Relay — Always-On Character Presence

**Status:** Active Implementation Phase (`apps/stage-edge` & Unified Discord Control Plane)

**Related Docs:**
- [`design-discord-control-plane.md`](./design-discord-control-plane.md) — Unified 3-tab Discord Control Plane & `@proj-airi/stage-edge` package architecture.
- [`design-discord-context-routing.md`](./design-discord-context-routing.md) — Discord channel context routing (`channel-{id}`, `dm-{userId}`), DM privacy isolation, and Access Control List (ACL) permission matrix.
- [`project-byos-cloud-sync.md`](./project-byos-cloud-sync.md) — The existing BYOS sync engine whose Cloudflare R2 credential integration and `StorageClient` interface this feature builds on.
- [`proposal-proactivity-vision.md`](./proposal-proactivity-vision.md) — The broader proactivity roadmap; Cloud Relay is a natural deployment target for proactive behaviors.

---

## 1. Problem Statement

AIRI is a local-first desktop application. Its richest experience — Live2D/VRM rendering, local LLM inference, plugin ecosystem, memory system — requires the user's machine to be on and nearby. This creates a hard access gap:

- **Mobile / commute access:** Users who are away from their PC cannot reach their character at all.
- **Always-on presence:** Characters cannot initiate contact, send check-ins, or accumulate context while the user is away.
- **Hardware constraints:** Some users (documented in community feedback) cannot run local 3GB+ model files or have machine policies that mandate the PC be powered off when unattended.

The insight from community users (Göndul/格恩達爾, Ansem) is that a **lightweight cloud deployment** — a Cloudflare Worker backed by a cloud LLM API — already solves the access problem today. AIRI owns that deployment experience end-to-end through `apps/stage-edge` instead of leaving users to vibe-code it themselves.

---

## 2. Proposed Solution: Cloud Relay

**Cloud Relay** is a core AIRI subsystem that lets users design a character in AIRI and deploy a persistent, cloud-hosted instance of that character — reachable 24/7 from any device, even when the local machine is powered off.

AIRI's role shifts from **local runtime only** to **control plane + authoring studio**:

| Layer | What it does | Implementation |
|---|---|---|
| **AIRI (local)** | Author cards, configure relay, manage sync, review memories | User's machine (`stage-tamagotchi` / `stage-ui`) |
| **Cloud Relay Worker** | Serves the character: handles interactions, calls LLM, reads/writes KV memory | Cloudflare Edge (`@proj-airi/stage-edge`) |
| **Discord / Frontends** | User-facing chat surface; hits the Worker's callback URL | Discord infra / Webhooks |

The model is analogous to **Vercel for character instances**: author locally, deploy to the edge, manage from the dashboard, the cloud runs independently.

---

## 3. Architecture

### 3.1 The Cloudflare Worker as a Character Instance (`apps/stage-edge`)

Cloudflare Workers use the **HTTP Interactions model** rather than a long-running WebSocket. The flow is:

```
User sends message (Discord slash command, future web chat, etc.)
        ↓
Discord / frontend POSTs to the Worker's registered callback URL (/discord)
        ↓
Cloudflare Worker wakes (cold start < 5ms at edge)
        ↓
Worker verifies ed25519 signature (crypto/ed25519.ts)
Worker reads conversation context from KV store (memory/kv.ts)
Worker calls cloud LLM API (inference/gemini.ts or inference/openai.ts)
Worker writes updated context back to KV
        ↓
Worker returns structured response to Discord / caller
        ↓
User sees reply — Worker goes idle
```

This is entirely **serverless and stateless per-invocation**. The Worker holds no persistent process; the Cloudflare KV store is the persistent layer.

### 3.2 Memory Architecture: Configurable Window Modes

Since Workers are stateless, all character memory is externalized to **Cloudflare KV** (`memory/kv.ts`):

```
KV namespace: airi-kv-<characterName>
  ├── ping                   → Baseline diagnostic key ("pong")
  ├── context/rolling        → Recent N messages (sliding window or unlimited history)
  ├── context/summary        → Auto-summarized long-term context blob (compaction.ts)
  ├── memory/facts           → Persistent facts about user (name, preferences, etc.)
  └── meta/config            → Character config snapshot (persona, system prompt, tone)
```

**Memory Window Modes**:
1. **Fixed Mode (`fixed`)**: Retains a rolling window of recent turns (e.g. 10–20 turns) for concise, cost-effective assistant behavior.
2. **Unlimited / Deep Coherence Mode (`unlimited`)**: Retains full, un-truncated conversation history with automatic background compaction (`compaction.ts`).

### 3.3 Proactive Messaging via Cron Triggers

The Worker's default behavior is **reactive** (only responds when triggered). To give the character a heartbeat:

- A **Cloudflare Cron Trigger** wakes the Worker on a schedule (e.g. hourly, or at a configurable interval).
- The Worker evaluates a proactivity condition (e.g. "has the user not initiated in > N hours?").
- If true, the Worker uses Discord's REST API to `POST /channels/{channelId}/messages` directly — no interaction required.

### 3.4 Connector Architecture

The Worker is designed to be **connector-agnostic**:

| Connector | Mechanism | Status |
|---|---|---|
| Discord | Slash commands + Interactions webhook | Live in `apps/stage-edge` |
| Web chat widget | Simple HTTP POST endpoint on the Worker | Near-term |
| Telegram | Bot webhook to Worker URL | Roadmap |
| SMS / WhatsApp | Twilio webhook forwarded to Worker | Roadmap |

### 3.5 Evolution Path: SQLite Durable Objects & WebSocket Hibernation (Free Tier Parity)

While the initial Phase 1 release of `stage-edge` utilizes stateless Workers + Cloudflare KV for Discord HTTP Interactions, the runtime roadmap establishes a first-class evolution path toward **Cloudflare Durable Objects** with **WebSocket Hibernation**.

#### A. Free Tier Availability & Quota Realities
Historically, Durable Objects required a paid Workers plan ($5/mo), forcing zero-cost community deployments to rely strictly on stateless V8 isolates and KV. Cloudflare has since made **SQLite-backed Durable Objects available on the Workers Free plan**, eliminating the subscription barrier for AIRI users:

| Metric | Workers Free Plan Daily Quota | Monthly Equivalent |
| :--- | :--- | :--- |
| **Requests** | 100,000 requests / day | ~3,000,000 requests / month |
| **Compute Duration** | 13,000 GB-seconds / day | ~390,000 GB-seconds / month |
| **Embedded Storage** | 5 GB included | 5 GB persistent SQLite |
| **Database Reads** | 50,000,000 row reads / day | ~1.5 billion row reads / month |
| **Database Writes** | 100,000 row writes / day | ~3,000,000 row writes / month |
| **WebSocket Hibernation** | ✅ Supported natively | Zero idle CPU billing while hibernated |

#### B. Architectural Comparison: Stateless Cron/KV vs. Stateful DO/WebSockets

The architectural advantages of migrating stateful relay sessions and peer embassies to Durable Objects include:

1. **Zero-Cost Idle via WebSocket Hibernation**:
   Standard long-running server processes (e.g. EC2, Fly.io, or persistent containers) consume continuous CPU billing simply keeping TCP sockets open. With the Cloudflare **WebSocket Hibernation API**, Cloudflare suspends the V8 isolate in memory when no frames are in transit. CPU compute time is billed strictly for the microsecond duration of active message handlers (`webSocketMessage`, `webSocketClose`), allowing companions to stay connected 24/7 within free-tier compute budgets.

2. **Instant Push vs. Cron & Polling Latency**:
   - *Cron Triggers*: Have a 1-minute minimum scheduling resolution (typically configured to 15–60 minutes to conserve invocations).
   - *Client Polling*: Desktop or mobile clients repeatedly hitting KV endpoints waste daily request quotas and introduce sync lag.
   - *Durable Objects*: Open a bidirectional channel that pushes incoming relay events, proactivity notifications, or friend messages downstream to active desktop/mobile apps with sub-millisecond latency.

3. **Deterministic Connection Presence vs. Flapping KV Heartbeats**:
   Attempting to track device or companion online/offline state via periodic 60-second KV writes suffers from KV's single-key write rate limit (1 write/sec) and global edge cache replication delays, causing false-offline state flapping. A Durable Object acts as a single-point-of-coordination actor: when a client's WebSocket drops or reconnects, the DO detects the lifecycle event immediately without synthetic timestamp polling.

4. **Strong Linear Consistency**:
   Cloudflare KV is eventually consistent across global points of presence (PoPs), occasionally serving stale context snapshots during rapid message exchanges. In contrast, a Durable Object guarantees single-threaded transactional execution backed by embedded, ACID-compliant SQLite.

5. **Cross-Subsystem Synergy: The Friends & Peers Embassy**:
   This architecture directly powers the companion federation layer defined in [`phase-2b-mesh-and-nap-chat.md`](./phase-2b-mesh-and-nap-chat.md). Rather than relying on store-and-forward polling for inbound friend requests (`POST /api/friends/request`) and nap-chat turns, an edge-deployed Durable Object acts as a real-time embassy, pushing incoming interactions directly into the user's active desktop/mobile session when connected, or safely journaling them into the 5 GB SQLite database when offline.

---

## 4. AIRI as Control Plane: Unified 3-Tab Discord Control Plane UI

The Discord module UI (`packages/stage-pages/src/pages/settings/modules/messaging-discord.vue` and `packages/stage-ui/src/components/modules/MessagingDiscord.vue`) is structured into a unified **3-Tab Navigation Bar**:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 💬 Discord Integration & Cloud Control Plane                                    │
├───────────────────────────┬───────────────────────────┬─────────────────────────┤
│ 🔌 Bot Connection         │ 🌐 Cloud Relay Studio     │ 🔐 Access & Routing     │
│   (Local Runtime & Tokens)│   (Vercel for Characters) │   (Channel ACL Matrix)  │
└───────────────────────────┴───────────────────────────┴─────────────────────────┘
```

### 4.1 Tab Breakdown

1. **Tab 1: 🔌 Bot Connection (Local Desktop Service)**:
   - Manages the local Gateway WebSocket connection (`useDiscordStore`).
   - Token configuration, start/stop toggle, connectivity meters (ping, guilds list), vision/DM toggles, and expandable live developer log console.

2. **Tab 2: 🌐 Cloud Relay Studio (24/7 Edge Deployment)**:
   - **Authentication**: Supports 1-click **Cloudflare OAuth 2.0 PKCE Login** (`loginWithCloudflareOAuth` via local callback `http://localhost:8976/oauth/callback`) or manual Cloudflare API Token entry.
   - **Deployment Engine (`CloudflareStageDeployer`)**: Programmatically provisions KV namespaces, builds Worker script payloads, uploads ES modules, binds secrets (`GEMINI_API_KEY`, `SYSTEM_PROMPT`), enables `workers.dev` subdomains, and registers Discord Interactions URLs automatically.
   - **Instance Cards**: Displays active Cloud Relay status, public Worker URL, model binding, memory mode (`fixed` vs `unlimited`), and 1-click **[Sync Memories ↓]** and **[Teardown]** actions.

3. **Tab 3: 🔐 Access & Routing (Context & Permission Matrix)**:
   - **Channel Context Routing**: Maps Discord channels (`channel-{id}`), threads (`thread-{id}`), and DMs (`dm-{userId}`) to specific character cards and chat sessions (`design-discord-context-routing.md`).
   - **ACL Permission Matrix**: Defines command access levels (`Owner Only`, `Whitelisted Roles/Users`, `Everyone`, `Disabled`) with strict deny-first precedence rules.

### 4.2 Automated Client-Side 2-Step Deployment Sequence

Deployment sequence (triggered by **[🚀 Deploy Character to Cloudflare Edge]** button in Tab 2):

```
1. Step 1: Session Selector Modal → User selects target timeline session (Active GUI, existing timeline, or dedicated new relay session).
2. Step 2: "Review & Inspect Details" Modal:
   - Summary Banner: Displays character name, target session name, memory mode, and target Discord servers list.
   - Consciousness (LLM Provider & Model Picker): User selects edge inference engine via `BrainModelPicker` (OpenAI-compatible, OpenRouter, Gemini, Groq, DeepSeek). Credentials are auto-sourced from AIRI Provider settings (`useProviderStore`).
   - History Depth / Context Continuity Selector: User selects history seeding level (`System Prompt Only`, `Last 10 Messages`, `Last 50 Messages`, or `Full Session History`).
   - Assembled System Prompt Inspector: Collapsible live inspector rendering `buildSystemPrompt()` character persona + memory context.
3. User clicks [🚀 Launch Deployment to Cloudflare]:
   - OAuth PKCE exchange / token check → authenticates zero-custody with Cloudflare REST API.
   - AIRI creates KV namespace `airi-kv-<scriptName>`.
   - AIRI packages selected session message history (according to chosen History Depth) and writes it into KV key `context/rolling`.
   - AIRI packages ES module Worker bundle (`packager.ts`) with assembled system prompt & API secrets.
   - AIRI uploads ES module payload via PUT `https://api.cloudflare.com/client/v4/accounts/{accountId}/workers/scripts/{scriptName}`.
   - AIRI enables `workers.dev` subdomain & fetches live endpoint URL.
   - AIRI registers Discord Interactions Endpoint URL (`{workerUrl}/discord`) & global slash commands via Discord REST API.
   - Execution Switch: `executionMode` switches to `'remote'` and local gateway pauses (`stopService()`) so Cloudflare Edge takes over live interactions cleanly.
```

All operations run client-side in a zero-custody architecture — no intermediary AIRI server touched.

This means AIRI remains the **source of truth for character configuration** — the cloud instance is always a projection of what AIRI holds locally.

---

## 5. Memory Sync: Local ↔ Cloud Relay

This is the most strategically valuable piece of the feature. It closes the loop between the always-on cloud experience and the rich local AIRI experience.

### 5.1 Sync Directionality

**v1 — Pull-only (remote → local):**
The simplest and safest model. The user hits **[Sync Memories ↓]** in the dashboard and AIRI fetches the relay KV contents, deserializes them, and imports them into the local memory system. No conflict resolution needed because the flow is one-directional.

**v2 — Bidirectional:**
The local memory system can push updates back up to the relay KV, so that conversations had locally in AIRI are also visible to the cloud character. This requires the conflict resolution logic already designed in BYOS (LWW per-item merges on `short-term-memory`, `text-journal`, etc.).

### 5.2 Key Mapping & Deterministic Namespace ID Resolution

| Relay KV Key | AIRI Local Storage Key | Merge Strategy |
|---|---|---|
| `context/rolling` | `local:memory/short-term/local` | Right-to-Left Sequence Alignment & Deduplication |
| `context/summary` | `local:memory/text-journal/local` | Append-merge by entry ID |
| `memory/facts` | `local:memory/echo-chips/local` | Merge by fact key, LWW |
| `memory/events` | `local:memory/echo-chips/local` (event type) | Merge by event ID |

**Deterministic Namespace ID Matching**:
Each deployed character card tracks its bound `namespaceId` (e.g. `1320f74b4b75494587099717b4c37071`) and `scriptName` (e.g. `airi-moriv`) explicitly in `cloudRelayInstances` store state. When clicking **[Sync Memories ↓]**, AIRI queries the exact `namespaceId` bound to that character card, preventing cross-talk or accidental synchronization with other deployed instances (e.g., `airi-baseline-test`).

### 5.3 Sequence Alignment & Deduplication Algorithm

When merging remote KV dialogue history (`context/rolling`) into a local session:

1. **Display Content Normalization**:
   - Compares normalized `content` (clean display text), ignoring `rawContent` / internal `<|ACT:...|>` orchestration tokens.
2. **Right-to-Left Sequence Alignment**:
   - Walks local history backwards from newest to oldest to locate the anchor overlap point.
   - Verifies a multi-turn fingerprint sequence (e.g., 2–3 consecutive turns) rather than a single short string like `"hi"` or `"okay"`, eliminating false-positive matches on common phrases.
3. **Safe Slice & User Review**:
   - Extracts new remote items starting immediately after the matched anchor turn (`remoteItems.slice(anchorIndex + 1)`).
   - Presents candidate items in the **Visual Review & Reconciliation Modal** before mutating local session state.

### 5.4 Automatic Sync Option

An optional **background auto-sync** mode polls the relay KV on a configurable interval (e.g. every 15 minutes when AIRI is open) and quietly imports new relay memories. A notification badge on the character card in AIRI signals new relay memories available.

### 5.5 The Safety Heuristic

The BYOS contraction-check heuristic (blocking sync if a large dataset would be replaced by a much smaller one) applies equally to relay imports. A relay memory wipe (e.g. from a Worker redeploy) should never silently overwrite a healthy local memory store.

---

## 6. Why This Preserves AIRI's Value

A concern this feature must address: "if a user just needs a cloud bot, why do they need AIRI at all?"

The answer is that AIRI is the **only place where the full experience is authored and managed**:

| Capability | AIRI Local | Cloud Relay alone |
|---|---|---|
| Rich card creation & editing | ✅ | ❌ |
| Live2D / VRM / Spine rendering | ✅ | ❌ |
| Local LLM inference (offline) | ✅ | ❌ |
| Plugin ecosystem | ✅ | ❌ |
| Full memory RAG system | ✅ | Partial (rolling window only) |
| Always-on / mobile access | ❌ | ✅ |
| Works with PC off | ❌ | ✅ |
| 24/7 uptime | ❌ | ✅ |

Cloud Relay is **not a replacement** — it is an extension. AIRI is the studio; the relay is the broadcast layer. Users who only want a cloud bot get a dead-simple deployment path. Users who want the full experience get seamless continuity between local and cloud.

---

## 7. Positioning

**AIRI = Vercel for character instances.**

You author your character locally with all of AIRI's tooling. You click Deploy. The character goes live on the edge — accessible from Discord on your phone, from a browser, from a friend's device. You manage, configure, and reconfigure from AIRI. When you get home, you sync memories down and pick up the conversation locally with full context.

**Suggested feature name:** **Presence** or **Cloud Relay**
- *Presence* — user-facing; emphasizes the character is always out there
- *Cloud Relay* — technical; emphasizes the architecture (local ↔ cloud relay)

Recommendation: surface as **"Always-On Presence"** in UI copy, use **"Cloud Relay"** in internal docs and code identifiers.

---

## 7.5 Stateful Channel Presence: Organic Wake-on-First-Turn & 15-Minute Idle Sleep Architecture

Earlier drafts assumed Cloudflare was strictly limited to stateless HTTP webhooks, requiring external Docker container hosts (like Fly.io or Railway) to connect to Discord's Gateway WebSocket (`wss://gateway.discord.gg`) for raw chat message listening (`MESSAGE_CREATE`).

With **SQLite-backed Durable Objects on the Free tier**, Cloudflare natively supports outbound WebSockets via `fetch(gatewayUrl, { headers: { Upgrade: 'websocket' } })`. An open outbound WebSocket keeps the Durable Object alive, and native **Durable Object Alarms (`ctx.storage.setAlarm`)** provide zero-overhead scheduled wakeups.

Therefore, **Cloudflare Durable Objects is the preferred canonical architecture** for natural channel dialogue. External container platforms remain only as an optional footnote.

### A. Preferred Canonical Architecture: Cloudflare Durable Object Gateway

Rather than forcing users to type `/chat` before every single turn or maintaining an expensive 24/7 server, the system uses **Organic Wake-on-First-Turn**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│       Preferred Architecture: Cloudflare Durable Object Gateway             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Free Edge Baseline (Cloudflare Workers):                                 │
│    • Bot handles all global /slash commands (/status, /imagine, /character) │
│      via zero-cost HTTP Interaction Webhooks.                               │
│    • Durable Object Gateway remains DORMANT (0 CPU, 0 memory billed).       │
│                                                                             │
│ 2. Organic Wake-on-First-Turn (/chat):                                      │
│    • User sends `/chat <message>` in a Discord text channel.                │
│    • Cloudflare Worker processes the first turn reply and triggers the      │
│      channel's Durable Object actor.                                        │
│                                                                             │
│ 3. Outbound WebSocket Connection & Channel Participation:                   │
│    • DO establishes outbound WebSocket to `wss://gateway.discord.gg`.      │
│    • DO identifies with MESSAGE_CONTENT intents for that active channel.    │
│    • Sets inactivity alarm: `ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000)`.
│    • Active WebSocket connection prevents Cloudflare from evicting the DO.  │
│                                                                             │
│ 4. Seamless Natural Dialogue (Zero Command Prefixes):                       │
│    • Users in the channel chat freely without typing /slash commands.       │
│    • DO listens to `MESSAGE_CREATE`, invokes edge LLM, and replies.         │
│    • Every new conversation turn resets the 15-minute alarm forward.        │
│                                                                             │
│ 5. Native Inactivity Alarm & Sleep Notification:                            │
│    • If no messages occur for 15 minutes, Cloudflare fires the alarm:       │
│      "🌛 Going to sleep now zzz... wake me up when anyone needs me!          │
│       Just use /chat <message> to get me going again."                      │
│    • DO cleanly closes the WebSocket (`ws.close(1000)`).                   │
│    • DO shuts down. Total compute stops, remaining 100% inside free tier!   │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Protocol & Ergonomic Details:
- **Zero Command Overhead**: Eliminates the awkward robot feel of typing `/slash` commands for every sentence. The character hangs out like a real participant in the channel during active banter.
- **Single-Vendor Setup**: Deploys 1-click under the user's existing Cloudflare account via `CloudflareStageDeployer`. Zero secondary signups, zero credit cards, zero Dockerfiles.
- **Deterministic Inactivity Teardown**: Powered by native Durable Object Alarms (`ctx.storage.setAlarm`), guaranteeing that the connection shuts down cleanly after 15 minutes of quiet time without external cron pinging.
- **Budget Compliance**: Stays well within the 13,000 GB-seconds/day free compute quota of SQLite Durable Objects.

---

### B. Alternative Architecture Footnote: External Container Daemons (Fly.io / Railway)

*Note: Retained as an architectural reference and fallback path for environments with non-V8 requirements.*

| Platform | Architecture Type | Gateway WebSocket Support | Cost Model | Status & Assessment |
| :--- | :--- | :---: | :--- | :--- |
| **Fly.io** | Firecracker Micro-VMs (Docker) | ✅ Native background VM | $5 credit / trial (~$1.94–$3.19/mo) | ⚠️ **Fallback Only** (Requires Docker setup & external API key) |
| **Railway.app** | Container Micro-VMs | ✅ Native | Usage-based | ⚠️ **Fallback Only** (Secondary cloud provider complexity) |
| **Render.com** | Container Web Services | ⚠️ Limited (sleeps after 15m) | 750 free hours/mo | ⚠️ **Not Recommended** (Cold-start latency issues) |

While container micro-VMs on Fly.io or Railway can run full Node.js daemons, they introduce significant friction: requiring secondary user accounts, credit card verifications, Docker image deployments, and secret synchronizations. They are reserved strictly for future edge cases where non-V8 native binaries or specialized Python sidecars might be required. For all standard AIRI presence deployments, **Cloudflare Durable Objects is the primary and recommended standard**.

---

## 8. Open Questions

1. **Worker template ownership:** The Cloudflare Worker script template needs to be maintained in the AIRI repository. Where does it live — `integrations/cloud-relay/`? What is the release/update strategy when the template changes?

2. **Credential security for LLM API keys:** The LLM API key stored as a Worker secret is under the user's Cloudflare account, not AIRI's custody. But AIRI needs to know it at deploy time to upload it. Should AIRI store it locally in the OS keychain post-deploy, or prompt on every redeploy?

3. **Multi-character support:** Should a single Cloudflare account support multiple simultaneous relay deployments (one Worker per character), or is there a single Worker that routes by character ID?

4. **Discord bot token ownership:** The user needs a Discord bot application and token. Should AIRI provide a guided bot-creation walkthrough (linking to Discord Developer Portal), or is there a hosted relay bot option where multiple users share an AIRI-operated Discord app?

5. **Relay → local push (v2):** When the user chats locally in AIRI, should those messages be pushed up to the relay KV so the cloud character maintains continuity? This would make the relay the universal memory store, but it adds write-on-every-message overhead.

6. **Free tier limits:** Cloudflare Workers free tier allows 100k requests/day and KV reads/writes within limits. For casual personal use this is ample, but heavy users may hit it. Should the dashboard expose usage metrics and warn proactively?

---

## 9. Verification Plan

### Pre-Implementation (Design Phase)
- [ ] Prototype Cloudflare Worker template that accepts a POST, reads KV context, calls a LLM API, and returns a response — verifies the core loop works end-to-end without AIRI.
- [ ] Verify Cloudflare REST API supports programmatic Worker upload and KV namespace creation (confirm against `api.cloudflare.com/client/v4/accounts/{accountId}/workers/scripts`).

### Implementation
- [ ] Unit test the KV ↔ AIRI memory key mapping and merge logic using the existing `StorageClient` test harness.
- [ ] Integration test: deploy a Worker from AIRI dashboard, send a test message via the Worker URL directly, verify KV state, trigger sync, verify local memory updated.
- [ ] Manual: Discord end-to-end — deploy relay, add bot to a test server, send a slash command, verify reply, sync memories, verify memory appears in AIRI.

### Manual Verification (User-Facing)
- Deploy button creates a working, publicly reachable Worker.
- Relay KV memories appear in AIRI local memory after Sync ↓.
- Teardown fully removes Worker and KV namespace from Cloudflare account.

## Relevant Skills

- [[airi-cloud-relay-infrastructure]]
- [[airi-discord-integration]]
