/**
 * Contract compatibility: the predicate the host applies to a declaration before any driver code runs (RFC §6.2,
 * C14).
 *
 * Two rules that look like one and are not: below 1.0 the minor must match exactly (a draft and a published shape
 * are not two revisions of one contract), and from 1.0 the major must match with a lower minor accepted (a driver
 * built against an older minor runs, offering what its revision defined). The crossing case gets its own refusal
 * because there is no honest rule for it. Each rejection is asserted on its code as well as its message: the code is
 * what a settings page branches on, the message is what the user reads.
 */
import type { ModelDriverContractVersion } from './contract/shared'

import { describe, expect, it } from 'vitest'

import { formatContractVersion, isContractCompatible } from './compatibility'
import { ContractFailureCode, MODEL_DRIVER_CONTRACT_VERSION } from './contract/shared'

const v = (major: number, minor: number): ModelDriverContractVersion => ({ major, minor })

describe('contract version formatting', () => {
  it('keeps the minor as written rather than truncating it', () => {
    expect(formatContractVersion(v(1, 0))).toBe('1.0')
    expect(formatContractVersion(v(2, 10))).toBe('2.10')
    expect(formatContractVersion(v(1, 2))).not.toBe('1.20')
  })
})

describe('contract compatibility: below 1.0', () => {
  it('accepts the same minor and returns the declaration it read', () => {
    const accepted = isContractCompatible(v(0, 1), v(0, 1))

    expect(accepted).toEqual({ ok: true, value: { major: 0, minor: 1 } })
  })

  it('refuses any other minor, in both directions', () => {
    for (const declared of [v(0, 0), v(0, 2), v(0, 11)]) {
      const refused = isContractCompatible(declared, v(0, 1))

      expect(refused.ok).toBe(false)
      if (refused.ok)
        continue
      expect(refused.error.code).toBe(ContractFailureCode.CONTRACT_VERSION_MISMATCH)
      expect(refused.error.message).toContain('below 1.0 the minor version must match exactly')
      // The message is presented to a user, so both revisions have to be legible in it.
      expect(refused.error.message).toContain(formatContractVersion(declared))
      expect(refused.error.message).toContain('0.1')
    }
  })

  it('compares against this build\'s own contract version when no host is given', () => {
    expect(isContractCompatible(MODEL_DRIVER_CONTRACT_VERSION).ok).toBe(true)
    expect(isContractCompatible(v(MODEL_DRIVER_CONTRACT_VERSION.major, MODEL_DRIVER_CONTRACT_VERSION.minor + 1)).ok).toBe(false)
  })
})

describe('contract compatibility: from 1.0', () => {
  it('accepts an older minor of the same major', () => {
    expect(isContractCompatible(v(2, 0), v(2, 3)).ok).toBe(true)
    expect(isContractCompatible(v(2, 3), v(2, 3)).ok).toBe(true)
  })

  it('refuses a newer minor of the same major', () => {
    const refused = isContractCompatible(v(2, 4), v(2, 3))

    expect(refused.ok).toBe(false)
    if (refused.ok)
      return
    expect(refused.error.code).toBe(ContractFailureCode.CONTRACT_VERSION_MISMATCH)
    expect(refused.error.message).toContain('newer than this build')
  })

  it('refuses a different major', () => {
    for (const declared of [v(1, 3), v(3, 0)]) {
      const refused = isContractCompatible(declared, v(2, 3))

      expect(refused.ok).toBe(false)
      if (refused.ok)
        continue
      expect(refused.error.message).toContain('the major version must match')
    }
  })
})

describe('contract compatibility: the pre-1.0 boundary', () => {
  it('refuses to pair a draft revision with a published one, whichever side is which', () => {
    for (const [declared, host] of [[v(1, 0), v(0, 9)], [v(0, 9), v(1, 0)]] as const) {
      const refused = isContractCompatible(declared, host)

      expect(refused.ok).toBe(false)
      if (refused.ok)
        continue
      expect(refused.error.code).toBe(ContractFailureCode.CONTRACT_VERSION_MISMATCH)
      expect(refused.error.message).toContain('cannot be paired with a 1.0-or-later one')
    }
  })
})
