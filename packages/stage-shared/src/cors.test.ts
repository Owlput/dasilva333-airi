import { describe, expect, it } from 'vitest'

import { DEFAULT_CORS_BYPASS_URLS, DEFAULT_SKIP_CORS_HOSTS, isCorsBypassTarget } from './cors'

describe('cors bypass target detection', () => {
  it('includes LanLan Free in default bypass list and skip hosts', () => {
    expect(DEFAULT_CORS_BYPASS_URLS).toContain('https://www.lanlan.tech/*')
    expect(DEFAULT_CORS_BYPASS_URLS).toContain('https://lanlan.tech/*')
    expect(DEFAULT_SKIP_CORS_HOSTS).toContain('www.lanlan.tech')
    expect(DEFAULT_SKIP_CORS_HOSTS).toContain('lanlan.tech')

    expect(isCorsBypassTarget('https://www.lanlan.tech/text/v1/chat/completions')).toBe(true)
    expect(isCorsBypassTarget('https://lanlan.tech/api/v1')).toBe(true)
  })

  it('includes Kilo in default bypass list and skip hosts', () => {
    expect(DEFAULT_CORS_BYPASS_URLS).toContain('https://api.kilo.ai/*')
    expect(DEFAULT_SKIP_CORS_HOSTS).toContain('api.kilo.ai')

    expect(isCorsBypassTarget('https://api.kilo.ai/api/gateway/v1/chat/completions')).toBe(true)
    expect(isCorsBypassTarget('https://api.kilo.ai/api/gateway/models')).toBe(true)
  })
})
