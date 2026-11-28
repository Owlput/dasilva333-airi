/**
 * The avatar table of §5.6, one assertion per row.
 *
 * The table is normative (D4), so it is tested as a table: eight rows, and the five rules that follow from it.
 * The ones that are easy to break silently are rule 1 (`{}` ≡ absent), rule 2 (legacy detection keys on
 * `avatar.modelId`, not on the object) and rule 4 (a missing model is not an error, a missing profile is).
 */
import { describe, expect, it } from 'vitest'

import { DriverStatus, UnavailableModelReason } from '../../contract'
import {
  AvatarAction,
  AvatarState,
  clearAvatarBinding,
  driverStatusOf,
  hasNewPathBinding,
  parseAvatar,
  resolveAvatarState,
  toCharacterModelBinding,
  writeAvatarBinding,
} from './binding'

const binding = { driverId: 'ai.moeru.airi.test.stub', modelId: 'model_a', profileId: 'profile_a' }

function resolve(overrides: Partial<Parameters<typeof resolveAvatarState>[0]> = {}) {
  return resolveAvatarState({
    avatar: binding,
    legacyRendererAvailable: true,
    driver: DriverStatus.ENABLED,
    modelRecordPresent: true,
    profileRecordPresent: true,
    ...overrides,
  })
}

describe('avatar parsing', () => {
  it('treats undefined, null and {} as the same absent state', () => {
    expect(parseAvatar(undefined).kind).toBe('absent')
    expect(parseAvatar(null).kind).toBe('absent')
    expect(parseAvatar({}).kind).toBe('absent')
  })

  it('rejects a partial binding rather than completing it from the frozen legacy id', () => {
    const parsed = parseAvatar({ driverId: 'd', modelId: 'm' })
    expect(parsed.kind).toBe('invalid')
  })

  it('keys legacy detection on the absence of avatar.modelId, never on the object', () => {
    expect(hasNewPathBinding({})).toBe(false)
    expect(hasNewPathBinding(undefined)).toBe(false)
    expect(hasNewPathBinding(binding)).toBe(true)
  })

  it('round-trips a binding and clears it with an empty object', () => {
    expect(writeAvatarBinding(binding)).toEqual(binding)
    expect(writeAvatarBinding({ ...binding, prompt: { modelId: 'm', profileId: 'p', text: '', tokens: [], version: 1, publishedAt: 1 } }).prompt).toBeDefined()
    expect(clearAvatarBinding()).toEqual({})
  })

  it('projects a binding into the record AIRI stores, stamping the clock', () => {
    expect(toCharacterModelBinding(binding, 42)).toEqual({
      modelDriverId: binding.driverId,
      modelId: binding.modelId,
      profileId: binding.profileId,
      boundAt: 42,
    })
  })
})

describe('avatar states', () => {
  it('row 1: no binding and no legacy model is unbound, not an error', () => {
    const result = resolve({ avatar: undefined })
    expect(result.state).toBe(AvatarState.UNBOUND)
    expect(result.renders).toBe(false)
    expect(result.error).toBe(false)
    expect(result.action).toBe(AvatarAction.CHOOSE_MODEL)
  })

  it('row 2: a legacy model with the legacy renderer present still renders', () => {
    const result = resolve({ avatar: undefined, legacyDisplayModelId: 'display-model-old' })
    expect(result.state).toBe(AvatarState.LEGACY)
    expect(result.renders).toBe(true)
    expect(result.action).toBe(AvatarAction.MIGRATE)
  })

  it('row 3: a legacy model after the cutoff renders nothing and offers migrate now', () => {
    const result = resolve({ avatar: undefined, legacyDisplayModelId: 'display-model-old', legacyRendererAvailable: false })
    expect(result.state).toBe(AvatarState.LEGACY_UNAVAILABLE)
    expect(result.renders).toBe(false)
    expect(result.error).toBe(false)
    expect(result.action).toBe(AvatarAction.MIGRATE_NOW)
  })

  it('row 4: a complete binding with every referent resolves normally', () => {
    const result = resolve()
    expect(result.state).toBe(AvatarState.BOUND)
    expect(result.renders).toBe(true)
    expect(result.binding?.modelId).toBe('model_a')
  })

  it('row 5: a missing model record is unavailable, not an error', () => {
    const result = resolve({ modelRecordPresent: false })
    expect(result.state).toBe(AvatarState.MODEL_MISSING)
    expect(result.error).toBe(false)
    expect(result.reason).toBe(UnavailableModelReason.MODEL_MISSING)
    expect(result.action).toBe(AvatarAction.IMPORT_MODEL)
  })

  it('row 6: a disabled or absent driver offers enabling it', () => {
    const disabled = resolve({ driver: DriverStatus.DISABLED })
    expect(disabled.state).toBe(AvatarState.DRIVER_MISSING)
    expect(disabled.error).toBe(false)
    expect(disabled.action).toBe(AvatarAction.ENABLE_DRIVER)

    const absent = resolve({ driver: 'absent' })
    expect(absent.state).toBe(AvatarState.DRIVER_MISSING)
    expect(absent.reason).toBe(UnavailableModelReason.DRIVER_UNKNOWN)
  })

  it('row 7: a missing profile is the one error, and asks the user to choose a profile', () => {
    const result = resolve({ profileRecordPresent: false })
    expect(result.state).toBe(AvatarState.PROFILE_MISSING)
    expect(result.error).toBe(true)
    expect(result.reason).toBe(UnavailableModelReason.PROFILE_MISSING)
    expect(result.action).toBe(AvatarAction.CHOOSE_PROFILE)
  })

  it('row 8: an invalid binding renders nothing and is rejected before any record is consulted', () => {
    const result = resolve({ avatar: { driverId: 'd' }, modelRecordPresent: false })
    expect(result.state).toBe(AvatarState.INVALID)
    expect(result.error).toBe(true)
    expect(result.renders).toBe(false)
    expect(result.action).toBe(AvatarAction.REBIND)
  })

  it('reports a runtime failure without turning the binding into an invalid one', () => {
    const result = resolve({ runtimeFailed: true })
    expect(result.state).toBe(AvatarState.BOUND)
    expect(result.renders).toBe(false)
    expect(result.reason).toBe(UnavailableModelReason.RUNTIME_ERROR)
  })

  it('reads a driver status from the host list, mapping not-installed to absent', () => {
    expect(driverStatusOf([{ driverId: 'd', status: DriverStatus.ENABLED }], 'd')).toBe(DriverStatus.ENABLED)
    expect(driverStatusOf([{ driverId: 'd', status: DriverStatus.NOT_INSTALLED }], 'd')).toBe('absent')
    expect(driverStatusOf([], 'd')).toBe('absent')
  })
})
