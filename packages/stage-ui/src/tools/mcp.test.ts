import type { McpToolBridge } from '../stores/mcp-tool-bridge'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearMcpToolBridge, setMcpToolBridge } from '../stores/mcp-tool-bridge'
import { mcpTools } from './mcp'

const mockActiveCard = {
  extensions: {
    airi: {
      generation: {
        known: {
          allowedTools: [] as string[],
        },
      },
    },
  },
}

vi.mock('../stores/modules/airi-card', () => ({
  useAiriCardStore: () => ({
    activeCard: mockActiveCard,
  }),
}))

describe('mCP builtin tools', () => {
  beforeEach(() => {
    clearMcpToolBridge()
    mockActiveCard.extensions.airi.generation.known.allowedTools = []
  })

  afterEach(() => {
    clearMcpToolBridge()
    vi.restoreAllMocks()
  })

  it('returns terminal directive when no MCP tools are available (#2946)', async () => {
    const [listTools] = await mcpTools()
    const result = await listTools.execute({}, { messages: [], toolCallId: 'test-empty' })

    expect(result).toBe('No MCP tools are available. Do not retry discovery during this assistant turn.')
  })

  it('discovers allowed tools when allowedTools includes mcp', async () => {
    mockActiveCard.extensions.airi.generation.known.allowedTools = ['mcp']

    const mockBridge: McpToolBridge = {
      listTools: vi.fn().mockResolvedValue([
        {
          serverName: 'open-websearch',
          name: 'open-websearch::search',
          toolName: 'search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: {} },
        },
      ]),
      callTool: vi.fn(),
      getRuntimeStatus: vi.fn(),
    }
    setMcpToolBridge(mockBridge)

    const [listTools] = await mcpTools()
    const result = await listTools.execute({}, { messages: [], toolCallId: 'test-success' })

    expect(result).toEqual({
      tools: [
        {
          serverName: 'open-websearch',
          name: 'open-websearch::search',
          toolName: 'search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      names: ['open-websearch::search'],
      servers: ['open-websearch'],
    })
  })
})
