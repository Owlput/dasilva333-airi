import { describe, expect, it } from 'vitest'

import { extractHandleAlias, isCompanionAllowedForFriend } from './peers'

describe('extractHandleAlias', () => {
  it('extracts subdomain from 4-part workers.dev handles', () => {
    expect(extractHandleAlias('airi-stage-edge.richard-pinedo.workers.dev')).toBe('richard-pinedo')
    expect(extractHandleAlias('https://airi-stage-edge.r1ch4rd.workers.dev/ws')).toBe('r1ch4rd')
    expect(extractHandleAlias('airi-cors-proxy.my-user.workers.dev')).toBe('my-user')
  })

  it('handles airi- prefix domains', () => {
    expect(extractHandleAlias('airi-embassy.alice.io')).toBe('alice')
    expect(extractHandleAlias('stage-edge.bob.net')).toBe('bob')
  })

  it('falls back cleanly for custom domains or single handles', () => {
    expect(extractHandleAlias('richy.workers.dev')).toBe('richy')
    expect(extractHandleAlias('companion.local')).toBe('companion')
    expect(extractHandleAlias('')).toBe('')
    expect(extractHandleAlias(undefined)).toBe('')
  })
})

describe('isCompanionAllowedForFriend', () => {
  const baseFriend: any = {
    id: 'f1',
    relationship: 'external-friend',
    trustState: 'trusted',
    allowedCapabilities: { canNapChat: true },
    allowedCompanionIds: [],
  }

  it('allows all companions when allowedCompanionIds is empty', () => {
    expect(isCompanionAllowedForFriend(baseFriend, 'card-1')).toBe(true)
    expect(isCompanionAllowedForFriend(baseFriend, 'card-2')).toBe(true)
  })

  it('restricts to allowlisted companions when specified', () => {
    const restricted = { ...baseFriend, allowedCompanionIds: ['card-1', 'card-3'] }
    expect(isCompanionAllowedForFriend(restricted, 'card-1')).toBe(true)
    expect(isCompanionAllowedForFriend(restricted, 'card-2')).toBe(false)
    expect(isCompanionAllowedForFriend(restricted, 'card-3')).toBe(true)
  })
})
