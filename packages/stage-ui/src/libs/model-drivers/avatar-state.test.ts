import type { ModelDriverAdapter } from '@proj-airi/stage-renderer-sdk'

import type { CardAvatarCarrier } from './binding'

import { DriverStatus, UnavailableModelReason } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useCardAvatarState } from './avatar-state'

const DRIVER = 'ai.moeru.airi.test.stub'

/** A window's adapter, answering only the two questions the classification asks. */
function fakeAdapter(options: {
  status?: DriverStatus
  rows?: Array<{ modelId: string, profileId: string }>
  pullFails?: boolean
}): ModelDriverAdapter {
  return {
    hostState: async () => ({
      drivers: [{ driverId: DRIVER, name: 'Stub', status: options.status ?? DriverStatus.ENABLED, hasManager: true }],
      rows: {},
      rowsUpdatedAt: {},
      rejections: [],
      legacyRetention: {},
      backgroundWindowStarted: false,
    }),
    pullRows: async () => options.pullFails
      ? { ok: false, error: { code: 'DRIVER_UNAVAILABLE', message: 'no answer' } }
      : { ok: true, value: (options.rows ?? []).map(row => ({ modelDriverId: DRIVER, ...row, name: row.modelId })) },
  } as unknown as ModelDriverAdapter
}

function boundCard(modelId = 'model_a', profileId = 'profile_a'): CardAvatarCarrier {
  return { extensions: { airi: { avatar: { driverId: DRIVER, modelId, profileId } } } }
}

/** One macrotask, which is enough for the composable's two awaits to settle. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('the state a stage should render', () => {
  it('renders a bound card when the driver answers for that model and profile', async () => {
    const card = ref<CardAvatarCarrier>(boundCard())
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => fakeAdapter({ rows: [{ modelId: 'model_a', profileId: 'profile_a' }] }),
      legacyRendererAvailable: () => true,
    })

    await settle()
    expect(state.state.value?.state).toBe('bound')
    expect(state.state.value?.renders).toBe(true)
    expect(state.state.value?.binding?.modelId).toBe('model_a')
  })

  it('treats a model the driver no longer holds as missing, not as an error', async () => {
    const card = ref<CardAvatarCarrier>(boundCard())
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => fakeAdapter({ rows: [] }),
      legacyRendererAvailable: () => true,
    })

    await settle()
    expect(state.state.value?.state).toBe('model-missing')
    expect(state.state.value?.renders).toBe(false)
    expect(state.state.value?.error).toBe(false)
  })

  it('treats a profile the model does not have as the inconsistent binding it is', async () => {
    const card = ref<CardAvatarCarrier>(boundCard('model_a', 'profile_missing'))
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => fakeAdapter({ rows: [{ modelId: 'model_a', profileId: 'profile_a' }] }),
      legacyRendererAvailable: () => true,
    })

    await settle()
    expect(state.state.value?.state).toBe('profile-missing')
    expect(state.state.value?.error).toBe(true)
  })

  it('answers driver-missing in a window with no adapter, rather than mounting nothing', async () => {
    const card = ref<CardAvatarCarrier>(boundCard())
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => undefined,
      legacyRendererAvailable: () => true,
    })

    await settle()
    expect(state.state.value?.state).toBe('driver-missing')
    expect(state.state.value?.renders).toBe(false)
  })

  it('does not pull rows for a disabled driver', async () => {
    let pulled = 0
    const adapter = {
      hostState: async () => ({
        drivers: [{ driverId: DRIVER, name: 'Stub', status: DriverStatus.DISABLED, hasManager: true }],
        rows: {},
        rowsUpdatedAt: {},
        rejections: [],
        legacyRetention: {},
        backgroundWindowStarted: false,
      }),
      pullRows: async () => {
        pulled++
        return { ok: true, value: [] }
      },
    } as unknown as ModelDriverAdapter

    const card = ref<CardAvatarCarrier>(boundCard())
    const state = useCardAvatarState({ card: () => card.value, adapter: () => adapter, legacyRendererAvailable: () => true })

    await settle()
    expect(state.state.value?.state).toBe('driver-missing')
    expect(pulled).toBe(0)
  })

  it('reports a partial avatar as invalid before consulting any record', async () => {
    const card = ref<CardAvatarCarrier>({ extensions: { airi: { avatar: { driverId: DRIVER } } } })
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => fakeAdapter({ rows: [{ modelId: 'model_a', profileId: 'profile_a' }] }),
      legacyRendererAvailable: () => true,
    })

    await settle()
    expect(state.state.value?.state).toBe('invalid')
    expect(state.state.value?.error).toBe(true)
    expect(state.state.value?.renders).toBe(false)
  })

  it('reports a failed row pull as a runtime failure, not as a missing model', async () => {
    const card = ref<CardAvatarCarrier>(boundCard())
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => fakeAdapter({ rows: [{ modelId: 'model_a', profileId: 'profile_a' }], pullFails: true }),
      legacyRendererAvailable: () => true,
    })

    await settle()
    // The binding is intact and the driver is enabled; the window just could not get an answer. Saying "model
    // missing" here would send the user to import a model that may still be there.
    expect(state.state.value?.state).toBe('bound')
    expect(state.state.value?.renders).toBe(false)
    expect(state.state.value?.reason).toBe(UnavailableModelReason.RUNTIME_ERROR)
  })

  it('answers driver-missing when the host itself cannot be asked', async () => {
    const card = ref<CardAvatarCarrier>(boundCard())
    const adapter = {
      hostState: async () => {
        throw new Error('the IPC hop never answered')
      },
      pullRows: async () => ({ ok: true, value: [] }),
    } as unknown as ModelDriverAdapter

    const state = useCardAvatarState({ card: () => card.value, adapter: () => adapter, legacyRendererAvailable: () => true })

    await settle()
    expect(state.state.value?.state).toBe('driver-missing')
    expect(state.state.value?.renders).toBe(false)
  })

  it('never renders the previous binding\'s verdict while the new one is being resolved', async () => {
    const card = ref<CardAvatarCarrier>(boundCard())
    const state = useCardAvatarState({
      card: () => card.value,
      adapter: () => fakeAdapter({ rows: [{ modelId: 'model_a', profileId: 'profile_a' }] }),
      legacyRendererAvailable: () => true,
    })

    await settle()
    expect(state.state.value?.state).toBe('bound')

    // The card now names another model. Until its facts arrive, the state must be withheld rather than repeat "bound".
    card.value = boundCard('model_b', 'profile_b')
    expect(state.state.value).toBeUndefined()

    await settle()
    expect(state.state.value?.state).toBe('model-missing')
  })
})
