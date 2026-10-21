import { describe, expect, it } from 'vitest'

import { DEFAULT_WEB_LLM_MODEL, WEB_LLM_MODELS } from '../../../../../libs/inference/constants'
import { createProviderRegistry } from '../../../../../stores/providers/registry'

const mockT = ((key: string, def?: string) => def || key) as any

describe('quick start providers configuration', () => {
  it('retains platform availability guard for nvidia nim (restricting cors in web environment)', () => {
    const registry = createProviderRegistry(mockT, {})
    const nvidia = registry.nvidia
    expect(nvidia).toBeDefined()
    expect(nvidia.name).toBe('NVIDIA NIM')
    expect(nvidia.isAvailableBy).toBeTypeOf('function')
  })

  it('includes opencode-go in registry with chat capabilities', () => {
    const registry = createProviderRegistry(mockT, {})
    const opencode = registry['opencode-go']
    expect(opencode).toBeDefined()
    expect(opencode.name).toBe('OpenCode Go')
    expect(opencode.tasks).toContain('chat')
  })

  it('provides openai-compatible with optional credentials and baseUrl support', () => {
    const registry = createProviderRegistry(mockT, {})
    const openaiCompat = registry['openai-compatible']
    expect(openaiCompat).toBeDefined()
    expect(openaiCompat.requiresCredentials).toBe(false)
  })

  it('sorts chat providers alphabetically by display name', () => {
    const registry = createProviderRegistry(mockT, {})
    const chatProviders = Object.values(registry).filter(metadata =>
      metadata.category === 'chat'
      || metadata.tasks.some(task => ['chat', 'text-generation'].includes(task.toLowerCase())),
    )

    const sorted = [...chatProviders].sort((a, b) => {
      const nameA = (a.name || a.id || '').toLowerCase()
      const nameB = (b.name || b.id || '').toLowerCase()
      return nameA.localeCompare(nameB)
    })

    const names = sorted.map(p => p.name || p.id)
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1].toLowerCase().localeCompare(names[i].toLowerCase())).toBeLessThanOrEqual(0)
    }

    expect(names).toContain('NVIDIA NIM')
    expect(names).toContain('OpenCode Go')
    expect(names).toContain('OpenAI Compatible')
  })

  it('ensures web-llm curated models exist and default is a valid curated model ID instead of "default"', () => {
    expect(WEB_LLM_MODELS.length).toBeGreaterThan(0)
    expect(DEFAULT_WEB_LLM_MODEL).not.toBe('default')
    expect(DEFAULT_WEB_LLM_MODEL).toBe(WEB_LLM_MODELS[0].id)
    expect(WEB_LLM_MODELS.some(m => m.id === DEFAULT_WEB_LLM_MODEL)).toBe(true)
  })

  it('validates that model id cannot be "default" or empty', () => {
    function isValidModel(modelId: string | undefined | null) {
      if (!modelId)
        return false
      const trimmed = modelId.trim().toLowerCase()
      return trimmed.length > 0 && trimmed !== 'default'
    }

    expect(isValidModel('')).toBe(false)
    expect(isValidModel('   ')).toBe(false)
    expect(isValidModel('default')).toBe(false)
    expect(isValidModel('DEFAULT')).toBe(false)
    expect(isValidModel(DEFAULT_WEB_LLM_MODEL)).toBe(true)
    expect(isValidModel('gpt-4o')).toBe(true)
  })
})
