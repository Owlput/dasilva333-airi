import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateLlmReply, generateSessionId, isOpenCodeGoHost } from './llm'

describe('edge inference llm adapter', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('isOpenCodeGoHost', () => {
    it('detects opencode.ai hosts', () => {
      expect(isOpenCodeGoHost('https://opencode.ai/zen/go/v1/chat/completions')).toBe(true)
      expect(isOpenCodeGoHost('https://api.opencode.ai/v1')).toBe(true)
      expect(isOpenCodeGoHost('https://opencode.ai/zen/go/v1')).toBe(true)
    })

    it('rejects non-opencode hosts', () => {
      expect(isOpenCodeGoHost('https://openrouter.ai/api/v1')).toBe(false)
      expect(isOpenCodeGoHost('https://api.openai.com/v1')).toBe(false)
      expect(isOpenCodeGoHost('https://notopencode.ai.example.com')).toBe(false)
    })
  })

  describe('generateSessionId', () => {
    it('generates a valid non-empty session ID string starting with airi-edge-', () => {
      const id = generateSessionId()
      expect(id).toMatch(/^airi-edge-.+/)
    })
  })

  describe('generateLlmReply', () => {
    it('automatically attaches x-opencode-session header for OpenCode Go requests', async () => {
      let capturedRequest: Request | null = null

      globalThis.fetch = vi.fn(async (input: any, init?: any) => {
        capturedRequest = new Request(input, init)
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Hello from OpenCode DeepSeek!' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })

      const reply = await generateLlmReply({
        prompt: 'Hi',
        apiKey: 'sk-test-opencode',
        baseUrl: 'https://opencode.ai/zen/go/v1/',
        model: 'deepseek-v4.1-flash',
      })

      expect(reply).toBe('Hello from OpenCode DeepSeek!')
      expect(capturedRequest).not.toBeNull()
      expect(capturedRequest!.headers.get('Authorization')).toBe('Bearer sk-test-opencode')
      expect(capturedRequest!.headers.get('x-opencode-session')).toMatch(/^airi-edge-.+/)
    })

    it('uses provided sessionId for OpenCode Go requests', async () => {
      let capturedRequest: Request | null = null

      globalThis.fetch = vi.fn(async (input: any, init?: any) => {
        capturedRequest = new Request(input, init)
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Turn reply' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })

      const reply = await generateLlmReply({
        prompt: 'Hi',
        apiKey: 'sk-test-opencode',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        model: 'deepseek-v4.1-flash',
        sessionId: 'discord-channel-987654321',
      })

      expect(reply).toBe('Turn reply')
      expect(capturedRequest!.headers.get('x-opencode-session')).toBe('discord-channel-987654321')
    })

    it('does not attach x-opencode-session header for non-OpenCode providers', async () => {
      let capturedRequest: Request | null = null

      globalThis.fetch = vi.fn(async (input: any, init?: any) => {
        capturedRequest = new Request(input, init)
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Standard reply' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })

      const reply = await generateLlmReply({
        prompt: 'Hi',
        apiKey: 'sk-standard',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      })

      expect(reply).toBe('Standard reply')
      expect(capturedRequest!.headers.has('x-opencode-session')).toBe(false)
    })

    it('throws with formatted error text when HTTP request fails', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'MissingSessionID',
              message: 'Request is missing x-opencode-session and cannot be routed efficiently.',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      })

      await expect(
        generateLlmReply({
          prompt: 'Hi',
          apiKey: 'sk-bad',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          model: 'deepseek-v4.1-flash',
        }),
      ).rejects.toThrow('LLM API call failed -> HTTP 400 | URL: https://opencode.ai/zen/go/v1/chat/completions')
    })
  })
})
