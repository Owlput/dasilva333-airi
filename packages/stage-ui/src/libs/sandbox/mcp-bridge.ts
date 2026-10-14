import type { McpCallToolPayload, McpCallToolResult, McpToolDescriptor } from '../../stores/mcp-tool-bridge'

import { tryGetMcpToolBridge } from '../../stores/mcp-tool-bridge'
import { executeJevMcpTool, getJevMcpToolDescriptors, isJevMcpTool } from './jev'

/**
 * Universal MCP executor: routes native Jev tools first, then falls back to the MCP bridge.
 */
export async function executeUniversalMcpTool(payload: McpCallToolPayload): Promise<McpCallToolResult> {
  if (isJevMcpTool(payload.name)) {
    return await executeJevMcpTool(payload.name, payload.arguments)
  }

  const bridge = tryGetMcpToolBridge()
  if (!bridge) {
    return { isError: true, toolResult: 'MCP tool bridge not available' }
  }

  return await bridge.callTool(payload)
}

/**
 * Lists all available MCP tools, combining native Jev tools with bridge tools if available.
 */
export async function listUniversalMcpTools(): Promise<McpToolDescriptor[]> {
  const tools = [...getJevMcpToolDescriptors()]
  const bridge = tryGetMcpToolBridge()
  if (bridge?.listTools) {
    try {
      const bridgeTools = await bridge.listTools()
      tools.push(...bridgeTools)
    }
    catch (err) {
      console.warn('[universal-mcp] Failed to list tools from MCP bridge:', err)
    }
  }
  return tools
}

/**
 * Universal iframe message handler for 'mcp-call' events.
 * Returns true if the message was handled, false otherwise.
 */
export async function handleWidgetMcpMessage(e: MessageEvent): Promise<boolean> {
  if (e.data?.type !== 'mcp-call')
    return false

  const { id, name, args } = e.data
  const target = e.source as WindowProxy | null

  try {
    const res = await executeUniversalMcpTool({ name, arguments: args })
    if (res.isError) {
      target?.postMessage({
        type: 'mcp-call-result',
        id,
        error: String(res.toolResult || 'MCP tool execution failed'),
      }, '*')
    }
    else {
      target?.postMessage({
        type: 'mcp-call-result',
        id,
        result: res.structuredContent ?? res.toolResult ?? res.content,
      }, '*')
    }
  }
  catch (err: any) {
    target?.postMessage({
      type: 'mcp-call-result',
      id,
      error: err.message || 'MCP tool error',
    }, '*')
  }

  return true
}
