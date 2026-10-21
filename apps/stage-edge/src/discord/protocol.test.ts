import { describe, expect, it } from 'vitest'

import {
  cleanBotToken,
  computeGatewayIntents,
  createHeartbeatPayload,
  createIdentifyPayload,
  createResumePayload,
  formatVerificationReply,
  isTestTrigger,
  parseGatewayMessage,
} from './protocol'
import { GatewayIntent, GatewayOpcode } from './types'

describe('discord gateway protocol for stage-edge', () => {
  it('cleanBotToken removes Bot prefix and extra whitespace', () => {
    expect(cleanBotToken('Bot  my-secret-token ')).toBe('my-secret-token')
    expect(cleanBotToken('bot my-token')).toBe('my-token')
    expect(cleanBotToken('raw-token')).toBe('raw-token')
  })

  it('computeGatewayIntents includes GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT', () => {
    const intents = computeGatewayIntents()
    expect(intents & GatewayIntent.GUILDS).toBeTruthy()
    expect(intents & GatewayIntent.GUILD_MESSAGES).toBeTruthy()
    expect(intents & GatewayIntent.DIRECT_MESSAGES).toBeTruthy()
    expect(intents & GatewayIntent.MESSAGE_CONTENT).toBeTruthy()
  })

  it('createIdentifyPayload structures valid Opcode 2 payload', () => {
    const payload = createIdentifyPayload('Bot test-token', 12345)
    expect(payload.op).toBe(GatewayOpcode.IDENTIFY)
    expect((payload.d as any).token).toBe('test-token')
    expect((payload.d as any).intents).toBe(12345)
    expect((payload.d as any).properties.os).toBe('cloudflare-workers')
  })

  it('createHeartbeatPayload structures valid Opcode 1 payload', () => {
    const payload = createHeartbeatPayload(42)
    expect(payload.op).toBe(GatewayOpcode.HEARTBEAT)
    expect(payload.d).toBe(42)
  })

  it('createResumePayload structures valid Opcode 6 payload', () => {
    const payload = createResumePayload('Bot token', 'session-xyz', 105)
    expect(payload.op).toBe(GatewayOpcode.RESUME)
    expect((payload.d as any).token).toBe('token')
    expect((payload.d as any).session_id).toBe('session-xyz')
    expect((payload.d as any).seq).toBe(105)
  })

  it('parseGatewayMessage handles valid JSON string and ArrayBuffer', () => {
    const parsedStr = parseGatewayMessage('{"op":10,"d":{"heartbeat_interval":41250}}')
    expect(parsedStr?.op).toBe(10)
    expect((parsedStr?.d as any).heartbeat_interval).toBe(41250)

    const buf = new TextEncoder().encode('{"op":11}')
    const parsedBuf = parseGatewayMessage(buf.buffer)
    expect(parsedBuf?.op).toBe(11)

    expect(parseGatewayMessage('invalid-json')).toBeNull()
    expect(parseGatewayMessage(123)).toBeNull()
  })

  it('isTestTrigger detects /test and !test', () => {
    expect(isTestTrigger('!test')).toBe(true)
    expect(isTestTrigger('/test')).toBe(true)
    expect(isTestTrigger('!test hello')).toBe(true)
    expect(isTestTrigger('hello world')).toBe(false)
    expect(isTestTrigger('<@12345> test', '12345')).toBe(true)
  })

  it('formatVerificationReply formats markdown with turn count and DO id', () => {
    const reply = formatVerificationReply({
      turnCount: 3,
      botUsername: 'AiriBot#0001',
      doId: '0123456789abcdef0123456789abcdef',
      authorId: '987654321',
      seq: 42,
      sessionId: 'sess_abcdef123',
    })

    expect(reply).toContain('AiriBot#0001')
    expect(reply).toContain('#3')
    expect(reply).toContain('0123456789abcdef')
    expect(reply).toContain('<@987654321>')
    expect(reply).toContain('sess_abc')
    expect(reply).toContain('15m inactivity sleep timer')
  })
})
