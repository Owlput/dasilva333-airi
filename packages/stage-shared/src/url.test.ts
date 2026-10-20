import { describe, expect, it } from 'vitest'

import { isUrl, isWebUrl } from './url'

describe('isWebUrl', () => {
  it.each([
    'https://example.com/report',
    'http://localhost:5173/',
    'HTTPS://EXAMPLE.COM',
    'https://example.com:8080/path?query=1#hash',
  ])('accepts the web URL %s', (url) => {
    expect(isWebUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    // Prefix check without host must be rejected
    'http://',
    'https://',
    'not a url',
    '',
    'blob:https://example.com',
  ])('rejects %s', (url) => {
    expect(isWebUrl(url)).toBe(false)
  })
})

describe('isUrl', () => {
  it('accepts valid URLs', () => {
    expect(isUrl('https://example.com')).toBe(true)
    expect(isUrl('file:///path/to/file')).toBe(true)
  })

  it('rejects invalid URLs', () => {
    expect(isUrl('not-a-url')).toBe(false)
    expect(isUrl('')).toBe(false)
  })
})
