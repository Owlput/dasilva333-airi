import { describe, expect, it } from 'vitest'

import { GatewayIntent, GatewayOpcode } from '../types'
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

describe('discord gateway protocol', () => {
  it('cleanBotToken removes Bot prefix and extra whitespace', () => {
    expect(cleanBotToken('Bot  my_secret_token  ')).toBe('my_secret_token')
    expect(cleanBotToken('my_clean_token')).toBe('my_clean_token')
    expect(cleanBotToken('bot secret_xyz')).toBe('secret_xyz')
  })

  it('computeGatewayIntents includes GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT', () => {
    const intents = computeGatewayIntents()
    expect(intents & GatewayIntent.GUILDS).toBeTruthy()
    expect(intents & GatewayIntent.GUILD_MESSAGES).toBeTruthy()
    expect(intents & GatewayIntent.DIRECT_MESSAGES).toBeTruthy()
    expect(intents & GatewayIntent.MESSAGE_CONTENT).toBeTruthy()
  })

  it('createIdentifyPayload structures valid Opcode 2 payload', () => {
    const payload = createIdentifyPayload('Bot test_token', 33281)
    expect(payload.op).toBe(GatewayOpcode.IDENTIFY)
    expect((payload.d as any).token).toBe('test_token')
    expect((payload.d as any).intents).toBe(33281)
    expect((payload.d as any).properties.os).toBe('cloudflare-workers')
  })

  it('createHeartbeatPayload structures valid Opcode 1 payload', () => {
    const p1 = createHeartbeatPayload(42)
    expect(p1.op).toBe(GatewayOpcode.HEARTBEAT)
    expect(p1.d).toBe(42)

    const p2 = createHeartbeatPayload(null)
    expect(p2.op).toBe(GatewayOpcode.HEARTBEAT)
    expect(p2.d).toBeNull()
  })

  it('createResumePayload structures valid Opcode 6 payload', () => {
    const p = createResumePayload('token_abc', 'session_123', 99)
    expect(p.op).toBe(GatewayOpcode.RESUME)
    expect((p.d as any).token).toBe('token_abc')
    expect((p.d as any).session_id).toBe('session_123')
    expect((p.d as any).seq).toBe(99)
  })

  it('parseGatewayMessage handles valid JSON string and ArrayBuffer', () => {
    const obj = { op: 0, s: 1, t: 'READY', d: { v: 10 } }
    const parsedStr = parseGatewayMessage(JSON.stringify(obj))
    expect(parsedStr).toEqual(obj)

    const buf = new TextEncoder().encode(JSON.stringify(obj)).buffer
    const parsedBuf = parseGatewayMessage(buf)
    expect(parsedBuf).toEqual(obj)

    expect(parseGatewayMessage('invalid-json')).toBeNull()
  })

  it('isTestTrigger detects /test, !test and bot mentions', () => {
    expect(isTestTrigger('/test')).toBe(true)
    expect(isTestTrigger('!test')).toBe(true)
    expect(isTestTrigger('/test hello world')).toBe(true)
    expect(isTestTrigger('!test ping')).toBe(true)
    expect(isTestTrigger('hello <@123456789> are you alive?', '123456789')).toBe(true)
    expect(isTestTrigger('random conversation')).toBe(false)
  })

  it('formatVerificationReply formats markdown with turn count and DO id', () => {
    const reply = formatVerificationReply({
      turnCount: 5,
      botUsername: 'Airi#0001',
      doId: 'test-do-id-1234',
      authorId: 'user-777',
      seq: 42,
      sessionId: 'sess-abc',
    })

    expect(reply).toContain('Cloudflare Durable Object Live Verification')
    expect(reply).toContain('`test-do-id-1234`')
    expect(reply).toContain('#5')
    expect(reply).toContain('<@user-777>')
    expect(reply).toContain('`42`')
  })
})
