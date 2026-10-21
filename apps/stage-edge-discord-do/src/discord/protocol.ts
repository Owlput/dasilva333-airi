import type { GatewayPayload } from '../types'

import {
  GatewayIntent,
  GatewayOpcode,

} from '../types'

export const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

export function cleanBotToken(token: string): string {
  return token.replace(/^Bot\s+/i, '').trim()
}

export function computeGatewayIntents(additionalIntents = 0): number {
  return (
    GatewayIntent.GUILDS
    | GatewayIntent.GUILD_MESSAGES
    | GatewayIntent.DIRECT_MESSAGES
    | GatewayIntent.MESSAGE_CONTENT
    | additionalIntents
  )
}

export function createIdentifyPayload(token: string, intents?: number): GatewayPayload {
  const clean = cleanBotToken(token)
  return {
    op: GatewayOpcode.IDENTIFY,
    d: {
      token: clean,
      intents: intents ?? computeGatewayIntents(),
      properties: {
        os: 'cloudflare-workers',
        browser: 'airi-stage-edge-discord-do',
        device: 'airi-stage-edge-discord-do',
      },
    },
  }
}

export function createHeartbeatPayload(lastSeq: number | null): GatewayPayload {
  return {
    op: GatewayOpcode.HEARTBEAT,
    d: lastSeq,
  }
}

export function createResumePayload(token: string, sessionId: string, seq: number): GatewayPayload {
  const clean = cleanBotToken(token)
  return {
    op: GatewayOpcode.RESUME,
    d: {
      token: clean,
      session_id: sessionId,
      seq,
    },
  }
}

export function parseGatewayMessage(raw: unknown): GatewayPayload | null {
  try {
    if (typeof raw === 'string') {
      return JSON.parse(raw) as GatewayPayload
    }
    if (raw instanceof ArrayBuffer) {
      const text = new TextDecoder('utf-8').decode(raw)
      return JSON.parse(text) as GatewayPayload
    }
    return null
  }
  catch {
    return null
  }
}

export function isTestTrigger(content: string, botId?: string): boolean {
  const trimmed = content.trim().toLowerCase()
  if (trimmed === '/test' || trimmed === '!test' || trimmed.startsWith('!test ') || trimmed.startsWith('/test ')) {
    return true
  }
  if (botId && trimmed.includes(`<@${botId}>`)) {
    return true
  }
  return false
}

export function formatVerificationReply(options: {
  turnCount: number
  botUsername: string
  doId: string
  authorId: string
  seq: number | null
  sessionId?: string | null
}): string {
  const { turnCount, botUsername, doId, authorId, seq, sessionId } = options
  return [
    `✨ **Cloudflare Durable Object Live Verification** ✨`,
    `> Connection active via \`stage-edge-discord-do\`!`,
    ``,
    `- 🤖 **Bot User:** \`${botUsername}\``,
    `- 🟢 **Durable Object Actor:** \`${doId}\``,
    `- 🔄 **Gateway Session:** \`${sessionId ?? 'unknown'}\``,
    `- 🔢 **Last Sequence Number:** \`${seq ?? 0}\``,
    `- 🎯 **Total Turns Handled:** \`#${turnCount}\``,
    `- 👤 **Triggered By:** <@${authorId}>`,
    `- ⏱️ **Timestamp:** \`${new Date().toISOString()}\``,
  ].join('\n')
}
