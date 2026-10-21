import type { Env } from '../index'
import type {
  GatewayPayload,
  GatewayStatus,
  HelloData,
  LoggedMessage,
  MessageCreateData,
  ReadyData,
} from './types'

import { generateLlmReply } from '../inference/llm'
import { buildSystemInstruction } from '../templates/character'
import {
  computeGatewayIntents,
  createHeartbeatPayload,
  createIdentifyPayload,
  createResumePayload,
  DISCORD_GATEWAY_URL,
  formatVerificationReply,
  isTestTrigger,
  parseGatewayMessage,
} from './protocol'
import { sendDiscordMessage } from './rest'
import { GatewayOpcode } from './types'

// Hardcoded 15-minute inactivity timeout (free-tier GB-s protection)
const IDLE_TIMEOUT_MS = 15 * 60 * 1000

export class DiscordHostDO {
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private initialHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  private status: GatewayStatus['status'] = 'disconnected'
  private botUser: GatewayStatus['botUser'] = null
  private sessionId: string | null = null
  private resumeGatewayUrl: string | null = null
  private lastSeq: number | null = null
  private turnCount = 0
  private connectedAt: number | null = null
  private lastHeartbeatSentAt: number | null = null
  private lastHeartbeatAckAt: number | null = null
  private lastErrorMessage: string | null = null
  private activeChannelId: string | null = null
  private shouldReconnect = true

  constructor(
    public readonly ctx: DurableObjectState,
    public readonly env: Env,
  ) {
    this.ensureSchema()
    this.loadState()
  }

  private ensureSchema(): void {
    const sql = this.ctx.storage.sql
    sql.exec(`
      CREATE TABLE IF NOT EXISTS gateway_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS message_log (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        reply_sent TEXT,
        created_at INTEGER NOT NULL
      );
    `)
  }

  private loadState(): void {
    const sql = this.ctx.storage.sql
    const rows = sql.exec<{ key: string, value: string }>(
      `SELECT key, value FROM gateway_state`,
    ).toArray()

    const stateMap = new Map<string, string>()
    for (const row of rows) {
      stateMap.set(row.key, row.value)
    }

    if (stateMap.has('session_id'))
      this.sessionId = stateMap.get('session_id')!
    if (stateMap.has('resume_gateway_url'))
      this.resumeGatewayUrl = stateMap.get('resume_gateway_url')!
    if (stateMap.has('active_channel_id'))
      this.activeChannelId = stateMap.get('active_channel_id')!
    if (stateMap.has('last_seq')) {
      const parsed = Number.parseInt(stateMap.get('last_seq')!, 10)
      if (!Number.isNaN(parsed))
        this.lastSeq = parsed
    }
    if (stateMap.has('turn_count')) {
      const parsed = Number.parseInt(stateMap.get('turn_count')!, 10)
      if (!Number.isNaN(parsed))
        this.turnCount = parsed
    }
    if (stateMap.has('bot_user')) {
      try {
        this.botUser = JSON.parse(stateMap.get('bot_user')!)
      }
      catch {
        // ignored
      }
    }
  }

  private saveStateKey(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO gateway_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      Date.now(),
    )
  }

  private async armInactivityAlarm(): Promise<void> {
    try {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS)
    }
    catch (err) {
      console.warn('[DiscordHostDO] Failed to set inactivity alarm:', err)
    }
  }

  /**
   * Deterministic 15-Minute Teardown Alarm
   * Triggered by Cloudflare when no new turns or events occur for 15 minutes.
   */
  public async alarm(): Promise<void> {
    console.info('[DiscordHostDO] Inactivity alarm fired (15 minutes). Tearing down compute.')

    const token = this.env.DISCORD_BOT_TOKEN
    if (token && this.activeChannelId && this.status === 'connected') {
      try {
        await sendDiscordMessage(
          token,
          this.activeChannelId,
          '🌛 Going to sleep now (15m inactivity timeout). Use `/chat` anytime to wake me up!',
        )
      }
      catch (err) {
        console.warn('[DiscordHostDO] Failed to send sleep message:', err)
      }
    }

    this.disconnect()
  }

  public async connect(activeChannelId?: string): Promise<GatewayStatus> {
    if (activeChannelId) {
      this.activeChannelId = activeChannelId
      this.saveStateKey('active_channel_id', activeChannelId)
    }

    // Arm 15-minute inactivity alarm immediately upon connect
    await this.armInactivityAlarm()

    if (this.ws && (this.status === 'connected' || this.status === 'connecting')) {
      return this.getStatus()
    }

    const token = this.env.DISCORD_BOT_TOKEN
    if (!token) {
      this.status = 'error'
      this.lastErrorMessage = 'DISCORD_BOT_TOKEN environment variable is missing.'
      return this.getStatus()
    }

    this.shouldReconnect = true
    this.status = 'connecting'
    this.lastErrorMessage = null

    // Determine target URL: resume if possible, else default gateway
    const targetUrl = (this.sessionId && this.resumeGatewayUrl)
      ? `${this.resumeGatewayUrl}/?v=10&encoding=json`
      : DISCORD_GATEWAY_URL

    try {
      this.ws = new WebSocket(targetUrl)
      this.setupSocketHandlers(this.ws, token)
    }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.status = 'error'
      this.lastErrorMessage = `Failed to create WebSocket: ${msg}`
      this.scheduleReconnect()
    }

    return this.getStatus()
  }

  private setupSocketHandlers(ws: WebSocket, token: string): void {
    ws.addEventListener('open', () => {
      // Waiting for Op 10 HELLO from Discord Gateway
    })

    ws.addEventListener('message', async (event: MessageEvent) => {
      const payload = parseGatewayMessage(event.data)
      if (!payload)
        return

      await this.handleGatewayPayload(payload, token)
    })

    ws.addEventListener('close', (event: CloseEvent) => {
      this.cleanupHeartbeats()
      this.ws = null

      const fatalCodes = [4004, 4010, 4011, 4013, 4014]
      if (fatalCodes.includes(event.code)) {
        this.status = 'error'
        this.shouldReconnect = false
        this.lastErrorMessage = `Fatal Discord close code ${event.code} (${event.reason || 'check bot token / intents in Developer Portal'}).`
        return
      }

      if (this.status !== 'error') {
        this.status = 'disconnected'
      }

      if (this.shouldReconnect) {
        this.status = 'reconnecting'
        this.scheduleReconnect()
      }
    })

    ws.addEventListener('error', (event: Event) => {
      this.lastErrorMessage = `WebSocket error: ${event.type}`
    })
  }

  private async handleGatewayPayload(payload: GatewayPayload, token: string): Promise<void> {
    switch (payload.op) {
      case GatewayOpcode.HELLO: {
        const data = payload.d as HelloData
        this.startHeartbeats(data.heartbeat_interval)

        if (this.sessionId && this.lastSeq !== null) {
          const resume = createResumePayload(token, this.sessionId, this.lastSeq)
          this.sendPayload(resume)
        }
        else {
          const identify = createIdentifyPayload(token, computeGatewayIntents())
          this.sendPayload(identify)
        }
        break
      }

      case GatewayOpcode.HEARTBEAT_ACK: {
        this.lastHeartbeatAckAt = Date.now()
        break
      }

      case GatewayOpcode.HEARTBEAT: {
        this.sendPayload(createHeartbeatPayload(this.lastSeq))
        this.lastHeartbeatSentAt = Date.now()
        break
      }

      case GatewayOpcode.RECONNECT: {
        if (this.ws) {
          this.ws.close(4000, 'Reconnecting per Discord request')
        }
        break
      }

      case GatewayOpcode.INVALID_SESSION: {
        const canResume = Boolean(payload.d)
        if (!canResume) {
          this.sessionId = null
          this.resumeGatewayUrl = null
          this.lastSeq = null
          this.saveStateKey('session_id', '')
          this.saveStateKey('resume_gateway_url', '')
          this.saveStateKey('last_seq', '0')
        }

        setTimeout(() => {
          if (canResume && this.sessionId && this.lastSeq !== null) {
            this.sendPayload(createResumePayload(token, this.sessionId, this.lastSeq))
          }
          else {
            this.sendPayload(createIdentifyPayload(token, computeGatewayIntents()))
          }
        }, 2500)
        break
      }

      case GatewayOpcode.DISPATCH: {
        if (typeof payload.s === 'number') {
          this.lastSeq = payload.s
          this.saveStateKey('last_seq', String(this.lastSeq))
        }

        await this.handleDispatchEvent(payload.t, payload.d, token)
        break
      }
    }
  }

  private async handleDispatchEvent(eventType: string | null | undefined, data: unknown, token: string): Promise<void> {
    if (eventType === 'READY') {
      const ready = data as ReadyData
      this.status = 'connected'
      this.sessionId = ready.session_id
      this.resumeGatewayUrl = ready.resume_gateway_url
      this.connectedAt = Date.now()
      this.botUser = {
        id: ready.user.id,
        username: ready.user.username,
        tag: ready.user.discriminator === '0' ? ready.user.username : `${ready.user.username}#${ready.user.discriminator}`,
      }

      this.saveStateKey('session_id', this.sessionId)
      this.saveStateKey('resume_gateway_url', this.resumeGatewayUrl)
      this.saveStateKey('bot_user', JSON.stringify(this.botUser))
      return
    }

    if (eventType === 'RESUMED') {
      this.status = 'connected'
      this.connectedAt = Date.now()
      return
    }

    if (eventType === 'MESSAGE_CREATE') {
      const msg = data as MessageCreateData
      if (!msg || !msg.author || msg.author.bot || msg.author.id === this.botUser?.id) {
        return
      }

      // If an allowed channel is configured, ignore other channels
      if (this.env.ALLOWED_CHANNEL_ID && msg.channel_id !== this.env.ALLOWED_CHANNEL_ID) {
        return
      }

      const content = msg.content || ''
      const isTest = isTestTrigger(content, this.botUser?.id)
      const botMention = this.botUser?.id ? `<@${this.botUser.id}>` : null
      const isMentioned = Boolean(botMention && content.includes(botMention))
      const isDirectMessage = !msg.guild_id
      const isInActiveChannel = Boolean(this.activeChannelId && msg.channel_id === this.activeChannelId)

      // Only respond if in active channel, mentioned, DM, or test trigger
      if (!isTest && !isInActiveChannel && !isMentioned && !isDirectMessage) {
        return
      }

      // Reset 15-minute inactivity alarm on active turn
      await this.armInactivityAlarm()

      // Track active channel
      this.activeChannelId = msg.channel_id
      this.saveStateKey('active_channel_id', msg.channel_id)

      let replyContent: string | null = null

      if (isTest) {
        this.turnCount += 1
        this.saveStateKey('turn_count', String(this.turnCount))

        replyContent = formatVerificationReply({
          turnCount: this.turnCount,
          botUsername: this.botUser?.tag || 'AiriBot',
          doId: this.ctx.id.toString(),
          authorId: msg.author.id,
          seq: this.lastSeq,
          sessionId: this.sessionId,
        })

        try {
          await sendDiscordMessage(token, msg.channel_id, replyContent)
        }
        catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          this.lastErrorMessage = `Failed to send test reply to #${msg.channel_id}: ${errMsg}`
        }
      }
      else {
        // Natural LLM inference turn
        this.turnCount += 1
        this.saveStateKey('turn_count', String(this.turnCount))

        // Strip bot mention tag if present
        let cleanPrompt = content
        if (botMention) {
          cleanPrompt = cleanPrompt.replaceAll(botMention, '').trim()
        }
        if (!cleanPrompt) {
          cleanPrompt = 'Hello!'
        }

        // Gather persona & system prompt
        let systemPrompt = this.env.SYSTEM_PROMPT
        if (this.env.MEMORY) {
          try {
            const kvPrompt = await this.env.MEMORY.get('system/prompt')
            if (kvPrompt) {
              systemPrompt = kvPrompt
            }
          }
          catch {}
        }

        const systemInstruction = buildSystemInstruction({
          name: this.env.CHARACTER_NAME || 'AIRI',
          personality: 'Kind, supportive, witty AI companion.',
          systemPrompt,
        })

        // Gather rolling dialogue history
        let history: Array<{ role: string, content: string }> = []
        if (this.env.MEMORY) {
          try {
            const rawHistory = await this.env.MEMORY.get('context/rolling')
            if (rawHistory) {
              const parsed = JSON.parse(rawHistory)
              if (Array.isArray(parsed)) {
                history = parsed
              }
            }
          }
          catch {}
        }

        try {
          const llmReply = await generateLlmReply({
            prompt: cleanPrompt,
            systemInstruction,
            history,
            model: this.env.LLM_MODEL,
            apiKey: this.env.LLM_API_KEY,
            baseUrl: this.env.LLM_BASE_URL,
          })

          replyContent = llmReply
          if (replyContent.length > 2000) {
            replyContent = `${replyContent.slice(0, 1930)}\n\n*(Truncated to fit Discord 2000-character limit)*`
          }

          // Send reply to Discord channel
          await sendDiscordMessage(token, msg.channel_id, replyContent)

          // Update rolling memory in KV
          if (this.env.MEMORY) {
            try {
              history.push({ role: 'user', content: cleanPrompt })
              history.push({ role: 'assistant', content: replyContent })
              if (history.length > 50) {
                history = history.slice(-50)
              }
              await this.env.MEMORY.put('context/rolling', JSON.stringify(history))
            }
            catch {}
          }
        }
        catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          this.lastErrorMessage = `Inference failed: ${errMsg}`
          replyContent = `⚠️ Edge Inference Error: ${errMsg}`
          try {
            await sendDiscordMessage(token, msg.channel_id, replyContent)
          }
          catch {}
        }
      }

      // Log event in SQLite
      this.ctx.storage.sql.exec(
        `INSERT INTO message_log (id, channel_id, author_id, author_name, content, reply_sent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        msg.id,
        msg.channel_id,
        msg.author.id,
        msg.author.global_name || msg.author.username,
        content,
        replyContent,
        Date.now(),
      )
    }
  }

  private startHeartbeats(intervalMs: number): void {
    this.cleanupHeartbeats()

    const initialJitter = Math.floor(intervalMs * Math.random())
    this.initialHeartbeatTimeout = setTimeout(() => {
      this.sendPayload(createHeartbeatPayload(this.lastSeq))
      this.lastHeartbeatSentAt = Date.now()

      this.heartbeatTimer = setInterval(() => {
        if (
          this.lastHeartbeatSentAt
          && this.lastHeartbeatAckAt
          && this.lastHeartbeatSentAt - this.lastHeartbeatAckAt > intervalMs * 2
        ) {
          if (this.ws) {
            this.ws.close(4000, 'Heartbeat ACK timeout (zombied connection)')
          }
          return
        }

        this.sendPayload(createHeartbeatPayload(this.lastSeq))
        this.lastHeartbeatSentAt = Date.now()
      }, intervalMs)
    }, initialJitter)
  }

  private cleanupHeartbeats(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.initialHeartbeatTimeout) {
      clearTimeout(this.initialHeartbeatTimeout)
      this.initialHeartbeatTimeout = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout)
      return
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      if (this.shouldReconnect) {
        this.connect().catch((err) => {
          this.lastErrorMessage = `Reconnect failure: ${err}`
        })
      }
    }, 5000)
  }

  private sendPayload(payload: GatewayPayload): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    try {
      this.ws.send(JSON.stringify(payload))
      return true
    }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.lastErrorMessage = `Send error: ${msg}`
      return false
    }
  }

  public disconnect(): GatewayStatus {
    this.shouldReconnect = false
    this.cleanupHeartbeats()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      this.ws.close(1000, 'User initiated disconnect or idle sleep')
      this.ws = null
    }
    this.status = 'disconnected'
    return this.getStatus()
  }

  public getStatus(): GatewayStatus {
    const uptimeMs = (this.connectedAt && this.status === 'connected')
      ? Date.now() - this.connectedAt
      : 0

    return {
      status: this.status,
      botUser: this.botUser,
      sessionId: this.sessionId,
      resumeGatewayUrl: this.resumeGatewayUrl,
      lastSeq: this.lastSeq,
      turnCount: this.turnCount,
      uptimeMs,
      connectedAt: this.connectedAt,
      lastHeartbeatSentAt: this.lastHeartbeatSentAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt,
      lastErrorMessage: this.lastErrorMessage,
      activeChannelId: this.activeChannelId,
    }
  }

  public getRecentMessages(limit = 25): LoggedMessage[] {
    const rows = this.ctx.storage.sql.exec<{
      id: string
      channel_id: string
      author_id: string
      author_name: string
      content: string
      reply_sent: string | null
      created_at: number
    }>(
      `SELECT id, channel_id, author_id, author_name, content, reply_sent, created_at
       FROM message_log ORDER BY created_at DESC LIMIT ?`,
      limit,
    ).toArray()

    return rows.map(r => ({
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      authorName: r.author_name,
      content: r.content,
      replySent: r.reply_sent,
      createdAt: r.created_at,
    }))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/status') {
      return Response.json(this.getStatus())
    }

    if (url.pathname === '/connect' && request.method === 'POST') {
      let activeChannelId: string | undefined
      try {
        const body: any = await request.json()
        if (body?.activeChannelId) {
          activeChannelId = body.activeChannelId
        }
      }
      catch {}

      const status = await this.connect(activeChannelId)
      return Response.json(status)
    }

    if (url.pathname === '/disconnect' && request.method === 'POST') {
      try {
        await this.ctx.storage.deleteAlarm()
      }
      catch {}
      const status = this.disconnect()
      return Response.json(status)
    }

    if (url.pathname === '/messages') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '25', 10)
      const messages = this.getRecentMessages(limit)
      return Response.json(messages)
    }

    return new Response('Not Found in DiscordHostDO', { status: 404 })
  }
}
