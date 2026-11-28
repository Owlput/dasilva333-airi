import { UnavailableModelReason } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'

import { unavailableReasonKey } from './reason'

describe('unavailable reason keys', () => {
  it('maps every reason the contract can produce, so none renders as a raw enum value', () => {
    const reasons = Object.values(UnavailableModelReason)
    const keys = reasons.map(unavailableReasonKey)

    expect(reasons.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(reasons.length)
    for (const key of keys)
      expect(key.startsWith('settings.pages.models.model-drivers.reason.')).toBe(true)
  })

  it('keeps the contract value in the last segment, so the key and the reason cannot drift apart', () => {
    expect(unavailableReasonKey(UnavailableModelReason.MODEL_MISSING))
      .toBe('settings.pages.models.model-drivers.reason.model-missing')
  })
})
