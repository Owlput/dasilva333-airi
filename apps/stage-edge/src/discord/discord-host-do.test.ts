import type { Env } from '../index'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordHostDO } from './discord-host-do'
import { GatewayOpcode } from './types'

// Mock SQLite storage
function createMockSql() {
  const tableData = new Map<string, Array<Record<string, any>>>()
  tableData.set('gateway_state', [])
  tableData.set('message_log', [])

  return {
    exec: vi.fn((query: string, ...params: any[]) => {
      const q = query.trim().toUpperCase()
      if (q.startsWith('CREATE TABLE')) {
        return { toArray: () => [] }
      }
      if (q.startsWith('SELECT KEY, VALUE FROM GATEWAY_STATE')) {
        return {
          toArray: () => tableData.get('gateway_state') || [],
        }
      }
      if (q.startsWith('INSERT INTO GATEWAY_STATE')) {
        const [key, value] = params
        const existing = (tableData.get('gateway_state') || []).filter(r => r.key !== key)
        existing.push({ key, value, updated_at: Date.now() })
        tableData.set('gateway_state', existing)
        return { toArray: () => [] }
      }
      if (q.startsWith('INSERT INTO MESSAGE_LOG')) {
        const [id, channel_id, author_id, author_name, content, reply_sent] = params
        const logs = tableData.get('message_log') || []
        logs.push({ id, channel_id, author_id, author_name, content, reply_sent, created_at: Date.now() })
        tableData.set('message_log', logs)
        return { toArray: () => [] }
      }
      if (q.startsWith('SELECT ID, CHANNEL_ID')) {
        return {
          toArray: () => tableData.get('message_log') || [],
        }
      }
      return { toArray: () => [] }
    }),
  }
}

function createMockCtx() {
  const sql = createMockSql()
  let alarmTimestamp: number | null = null

  return {
    id: {
      toString: () => 'mock-do-id-1234567890abcdef',
    },
    storage: {
      sql,
      setAlarm: vi.fn(async (ts: number) => {
        alarmTimestamp = ts
      }),
      getAlarm: vi.fn(async () => alarmTimestamp),
      deleteAlarm: vi.fn(async () => {
        alarmTimestamp = null
      }),
    },
  } as unknown as DurableObjectState
}

vi.mock('../inference/llm', () => ({
  generateLlmReply: vi.fn(async ({ prompt }: { prompt: string }) => {
    return `Mock AI reply to: ${prompt}`
  }),
}))

vi.mock('./rest', () => ({
  sendDiscordMessage: vi.fn(async (_token: string, channelId: string, content: string) => {
    return { id: 'msg-reply-123', channel_id: channelId, content }
  }),
}))

describe('discordHostDO in stage-edge', () => {
  let mockCtx: DurableObjectState
  let mockEnv: Env

  beforeEach(() => {
    vi.clearAllMocks()
    mockCtx = createMockCtx()
    mockEnv = {
      LLM_API_KEY: 'test-llm-key',
      DISCORD_PUBLIC_KEY: 'test-pub-key',
      DISCORD_BOT_TOKEN: 'test-bot-token-123',
      CHARACTER_NAME: 'AiriTest',
    }
  })

  it('initializes schema and loads empty baseline state', () => {
    const host = new DiscordHostDO(mockCtx, mockEnv)
    const status = host.getStatus()

    expect(status.status).toBe('disconnected')
    expect(status.turnCount).toBe(0)
    expect(status.botUser).toBeNull()
  })

  it('arms 15-minute inactivity alarm on connect', async () => {
    const host = new DiscordHostDO(mockCtx, mockEnv)
    await host.connect('channel-777')

    expect(mockCtx.storage.setAlarm).toHaveBeenCalled()
    const scheduledTime = (mockCtx.storage.setAlarm as any).mock.calls[0][0]
    const expectedApprox = Date.now() + 15 * 60 * 1000
    expect(Math.abs(scheduledTime - expectedApprox)).toBeLessThan(2000)

    const status = host.getStatus()
    expect(status.activeChannelId).toBe('channel-777')
  })

  it('alarm() triggers sleep notice and clean disconnect', async () => {
    const { sendDiscordMessage } = await import('./rest')
    const host = new DiscordHostDO(mockCtx, mockEnv)
    await host.connect('channel-888')

    // Simulate connected state
    ;(host as any).status = 'connected'

    await host.alarm()

    expect(sendDiscordMessage).toHaveBeenCalledWith(
      'test-bot-token-123',
      'channel-888',
      expect.stringContaining('Going to sleep now (15m inactivity timeout)'),
    )
    expect(host.getStatus().status).toBe('disconnected')
  })

  it('handles !test message create by sending verification reply and resetting 15m alarm', async () => {
    const { sendDiscordMessage } = await import('./rest')
    const host = new DiscordHostDO(mockCtx, mockEnv)
    await host.connect('channel-999')
    vi.clearAllMocks()

    const payload = {
      op: GatewayOpcode.DISPATCH,
      t: 'MESSAGE_CREATE',
      s: 1,
      d: {
        id: 'user-msg-1',
        channel_id: 'channel-999',
        author: {
          id: 'user-456',
          username: 'Tester',
          discriminator: '0',
          bot: false,
        },
        content: '!test',
        timestamp: new Date().toISOString(),
      },
    }

    await (host as any).handleGatewayPayload(payload, 'test-bot-token-123')

    expect(sendDiscordMessage).toHaveBeenCalledWith(
      'test-bot-token-123',
      'channel-999',
      expect.stringContaining('Cloudflare Durable Object Live Verification'),
    )
    expect(mockCtx.storage.setAlarm).toHaveBeenCalled()
    expect(host.getStatus().turnCount).toBe(1)
  })

  it('handles conversational banter in active channel by invoking LLM', async () => {
    const { sendDiscordMessage } = await import('./rest')
    const { generateLlmReply } = await import('../inference/llm')
    const host = new DiscordHostDO(mockCtx, mockEnv)
    await host.connect('channel-conv-1')
    vi.clearAllMocks()

    const payload = {
      op: GatewayOpcode.DISPATCH,
      t: 'MESSAGE_CREATE',
      s: 2,
      d: {
        id: 'user-msg-2',
        channel_id: 'channel-conv-1',
        author: {
          id: 'user-456',
          username: 'Alice',
          discriminator: '0',
          bot: false,
        },
        content: 'Good morning Airi!',
        timestamp: new Date().toISOString(),
      },
    }

    await (host as any).handleGatewayPayload(payload, 'test-bot-token-123')

    expect(generateLlmReply).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Good morning Airi!',
      }),
    )
    expect(sendDiscordMessage).toHaveBeenCalledWith(
      'test-bot-token-123',
      'channel-conv-1',
      'Mock AI reply to: Good morning Airi!',
    )
    expect(mockCtx.storage.setAlarm).toHaveBeenCalled()
    expect(host.getStatus().turnCount).toBe(1)
  })

  it('serves HTTP endpoints: /status, /connect, /disconnect', async () => {
    const host = new DiscordHostDO(mockCtx, mockEnv)

    const statusRes = await host.fetch(new Request('http://internal/status'))
    expect(statusRes.status).toBe(200)
    const statusJson = await statusRes.json() as any
    expect(statusJson.status).toBe('disconnected')

    const connectRes = await host.fetch(new Request('http://internal/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeChannelId: 'chan-101' }),
    }))
    expect(connectRes.status).toBe(200)
    expect(host.getStatus().activeChannelId).toBe('chan-101')

    const disconnectRes = await host.fetch(new Request('http://internal/disconnect', { method: 'POST' }))
    expect(disconnectRes.status).toBe(200)
    expect(host.getStatus().status).toBe('disconnected')
  })
})
