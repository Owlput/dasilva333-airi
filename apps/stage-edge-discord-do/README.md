# @proj-airi/stage-edge-discord-do

Standalone Cloudflare Worker + SQLite **Durable Object** hosting an active outbound WebSocket connection to the Discord Gateway (`wss://gateway.discord.gg`).

---

## 🎯 Purpose

Proves and implements stateful Discord Gateway hosting on Cloudflare's edge using SQLite-backed Durable Objects:
- **Active Outbound WebSocket:** Maintains a persistent WebSocket client connection directly to `wss://gateway.discord.gg`.
- **Automatic Heartbeating & Resuming:** Manages Discord Gateway Opcode 10 `HELLO`, Opcode 1 `HEARTBEAT`, and Opcode 6 `RESUME` with session state persisted in embedded SQLite.
- **Real-Time Verification:** When a user types `/test` or `!test` in a Discord channel, the DO receives the `MESSAGE_CREATE` event over the Gateway WebSocket, increments durable turn counters in SQLite, and sends a live verification reply into the channel.
- **Embedded Web Dashboard:** Provides an interactive HTTP dashboard (`GET /`) showing connection status, bot identity, sequence numbers, and recent messages recorded by the DO.

---

## 🚀 Quick Start

### 1. Configure Discord Developer Portal
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and select/create your Application.
2. In the **Bot** tab:
   - Ensure **Message Content Intent** is **ENABLED** under *Privileged Gateway Intents*.
   - Copy your **Bot Token**.
3. In the **OAuth2 -> URL Generator** tab:
   - Select scopes: `bot`
   - Select bot permissions: `Send Messages`, `Read Messages/View Channels`, `Read Message History`
   - Use the generated URL to invite the bot to your Discord server.

### 2. Configure Environment (`.env`)
Create an uncommitted `.env` file in this directory:

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_BOT_TOKEN="your_discord_bot_token_here"
AUTO_CONNECT="true"
```

### 3. Run Locally with Wrangler
```bash
pnpm --filter @proj-airi/stage-edge-discord-do dev
```
Open [http://localhost:8787](http://localhost:8787) to view the live dashboard and trigger connection.

### 4. Deploy to Cloudflare
Deploy the ad-hoc worker directly to your Cloudflare account:

```bash
# Upload secrets to Cloudflare Worker
pnpm --filter @proj-airi/stage-edge-discord-do exec wrangler secret put DISCORD_BOT_TOKEN

# Deploy
pnpm --filter @proj-airi/stage-edge-discord-do deploy
```

---

## 🧪 Testing in Discord

Once the Worker is running / deployed:
1. Open any text channel in your Discord server where the bot has read/write permissions.
2. Send:
   ```text
   /test
   ```
   *(or `!test`, or `@YourBot ping`)*
3. The Durable Object will receive the raw gateway payload and respond directly in channel:
   ```markdown
   ✨ **Cloudflare Durable Object Live Verification** ✨
   > Connection active via `stage-edge-discord-do`!

   - 🤖 **Bot User:** `YourBot#0000`
   - 🟢 **Durable Object Actor:** `1234abcd5678efgh`
   - 🔄 **Gateway Session:** `87948f948f94...`
   - 🔢 **Last Sequence Number:** `4`
   - 🎯 **Total Turns Handled:** `#1`
   - 👤 **Triggered By:** @yourname
   - ⏱️ **Timestamp:** `2026-10-21T17:55:00.000Z`
   ```

---

## 📡 HTTP Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Interactive HTML dashboard with connection controls and event tables |
| `/status` | `GET` | Returns JSON status from the Durable Object |
| `/connect` | `POST` | Forces DO to connect to Discord Gateway |
| `/disconnect` | `POST` | Gracefully closes the Gateway connection |
| `/events` | `GET` | Returns recent messages observed by DO (`?limit=25`) |
