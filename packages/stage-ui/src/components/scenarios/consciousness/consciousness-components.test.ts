import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsciousnessConfig } from './useConsciousnessConfig'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../../../libs/native-ai', () => ({
  NativeAI: {
    isNative: vi.fn(() => false),
    isModelCached: vi.fn(async () => true),
    downloadModel: vi.fn(async () => undefined),
  },
}))

describe('useConsciousnessConfig', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes in settings mode with defaults', () => {
    const config = useConsciousnessConfig({ mode: 'settings' })
    expect(config.mode).toBe('settings')
    expect(config.activeTab.value).toBe('free')
    expect(config.cloudflarePresets.length).toBeGreaterThan(0)
    expect(config.lanlanFreePresets.length).toBeGreaterThan(0)
    expect(config.kiloPresets.length).toBeGreaterThan(0)
    expect(config.pollinationsPresets.length).toBeGreaterThan(0)
  })

  it('selects free preset models correctly', () => {
    const config = useConsciousnessConfig({ mode: 'settings' })

    config.selectLanlanFreeModel('free-model')
    expect(config.selectedProviderId.value).toBe('lanlan-free')
    expect(config.selectedModelId.value).toBe('free-model')

    config.selectKiloModel('kilo-auto/free')
    expect(config.selectedProviderId.value).toBe('kilo')
    expect(config.selectedModelId.value).toBe('kilo-auto/free')

    config.selectPollinationsModel('openai')
    expect(config.selectedProviderId.value).toBe('pollinations')
    expect(config.selectedModelId.value).toBe('openai')
  })

  it('selects local Core AI and WebLLM models', () => {
    const config = useConsciousnessConfig({ mode: 'settings' })

    config.selectCoreAiModel()
    expect(config.selectedProviderId.value).toBe('apple-core-ai')

    config.selectWebLlmModel('Qwen3.5-0.8B-q4f16_1-MLC')
    expect(config.selectedProviderId.value).toBe('web-llm')
    expect(config.selectedModelId.value).toBe('Qwen3.5-0.8B-q4f16_1-MLC')
  })
})
