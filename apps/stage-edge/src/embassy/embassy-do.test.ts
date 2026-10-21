import { describe, expect, it } from 'vitest'

import {
  buildPushEvent,
  EMBASSY_DO_CLASS_NAME,
  EMBASSY_DO_ID_NAME,
  EMBASSY_SCHEMA_DDL,
  isValidFriendRequestRecord,
  sanitizeMachineTag,
} from './embassy-do'

describe('embassy DO helpers', () => {
  it('exposes stable identity constants', () => {
    expect(EMBASSY_DO_ID_NAME).toBe('embassy')
    expect(EMBASSY_DO_CLASS_NAME).toBe('EmbassyDO')
  })

  it('defines the three federation tables', () => {
    const joined = EMBASSY_SCHEMA_DDL.join('\n')
    expect(joined).toContain('friend_requests')
    expect(joined).toContain('trusted_peers')
    expect(joined).toContain('nap_turns')
    expect(joined).toContain('nonce')
    expect(joined).toContain('from_tagline')
  })

  it('validates inbound friend request records', () => {
    expect(isValidFriendRequestRecord(null)).toBe(false)
    expect(isValidFriendRequestRecord({})).toBe(false)
    expect(isValidFriendRequestRecord({
      id: 'r1',
      fromHandle: 'alex.workers.dev',
      fromPubkey: 'ab'.repeat(32),
      fromCharacterName: 'Kirie',
      nonce: 'n1',
    })).toBe(true)
  })

  it('accepts records with or without an opted-in tagline', () => {
    const base = {
      id: 'r1',
      fromHandle: 'alex.workers.dev',
      fromPubkey: 'ab'.repeat(32),
      fromCharacterName: 'Kirie',
      nonce: 'n1',
    }
    expect(isValidFriendRequestRecord({ ...base, fromTagline: 'Quiet conversations' })).toBe(true)
    expect(isValidFriendRequestRecord({ ...base, fromTagline: 42 })).toBe(false)
  })

  it('serializes push events for hibernated sockets', () => {
    const text = buildPushEvent({
      type: 'inbound_request',
      request: {
        id: 'r1',
        fromHandle: 'alex.workers.dev',
        fromPubkey: 'ab'.repeat(32),
        fromCharacterName: 'Kirie',
        introMessage: 'hi',
        timestamp: 1,
        nonce: 'n1',
      },
    })
    expect(JSON.parse(text).type).toBe('inbound_request')
  })

  it('sanitizes machine tags for socket attachments', () => {
    expect(sanitizeMachineTag(undefined)).toEqual(['unknown-device'])
    expect(sanitizeMachineTag('  ')).toEqual(['unknown-device'])
    expect(sanitizeMachineTag('studio-mac')).toEqual(['studio-mac'])
  })
})
