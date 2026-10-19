import { describe, expect, it } from 'vitest'

import { DEFAULT_CORS_BYPASS_URLS, DEFAULT_SKIP_CORS_HOSTS, isCorsBypassTarget } from './cors'

describe('cors bypass target detection', () => {
  it('excludes dead free providers (LanLan, MiMo) from default bypass list', () => {
    expect(DEFAULT_CORS_BYPASS_URLS).not.toContain('https://www.lanlan.tech/*')
    expect(DEFAULT_CORS_BYPASS_URLS).not.toContain('https://api.xiaomimimo.com/*')
    expect(DEFAULT_SKIP_CORS_HOSTS).not.toContain('lanlan.tech')
    expect(DEFAULT_SKIP_CORS_HOSTS).not.toContain('api.xiaomimimo.com')
  })

  it('includes Kilo in default bypass list and skip hosts', () => {
    expect(DEFAULT_CORS_BYPASS_URLS).toContain('https://api.kilo.ai/*')
    expect(DEFAULT_SKIP_CORS_HOSTS).toContain('api.kilo.ai')

    expect(isCorsBypassTarget('https://api.kilo.ai/api/gateway/v1/chat/completions')).toBe(true)
    expect(isCorsBypassTarget('https://api.kilo.ai/api/gateway/models')).toBe(true)
  })
})
