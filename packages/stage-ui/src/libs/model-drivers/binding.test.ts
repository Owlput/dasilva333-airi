import { DriverStatus } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'

import {
  readCardBinding,
  resolveCardAvatarState,
  withCardBinding,
  withCardBindingCleared,
  withCardPromptSnapshot,
} from './binding'

const BINDING = { driverId: 'ai.moeru.airi.test.stub', modelId: 'model_a', profileId: 'profile_a' }

const SNAPSHOT = {
  modelId: 'model_a',
  profileId: 'profile_a',
  text: 'Be kind.',
  tokens: ['happy'],
  version: 4,
  publishedAt: 10,
}

describe('reading a card', () => {
  it('treats an absent avatar and {} as the same state', () => {
    expect(readCardBinding({}).binding).toBeUndefined()
    expect(readCardBinding({ extensions: { airi: { avatar: {} } } }).binding).toBeUndefined()
  })

  it('reports a legacy card by the absence of avatar.modelId, not by the absence of the object', () => {
    const legacy = readCardBinding({ extensions: { airi: { modules: { displayModelId: 'display-model-1' } } } })
    expect(legacy.legacy).toBe(true)
    expect(legacy.legacyDisplayModelId).toBe('display-model-1')

    const emptyAvatar = readCardBinding({ extensions: { airi: { avatar: {}, modules: { displayModelId: 'display-model-1' } } } })
    expect(emptyAvatar.legacy).toBe(true)
  })

  it('surfaces a partial binding as invalid rather than completing it', () => {
    const read = readCardBinding({ extensions: { airi: { avatar: { driverId: 'd' } } } })
    expect(read.binding).toBeUndefined()
    expect(read.invalid).toBeDefined()
  })
})

describe('writing a card', () => {
  it('writes the three ids plus a complete snapshot', () => {
    const card = withCardBinding({}, BINDING, SNAPSHOT)
    expect(card.extensions?.airi?.avatar).toEqual({ ...BINDING, prompt: SNAPSHOT })
  })

  it('keeps a snapshot when a rebind does not carry one', () => {
    const first = withCardBinding({}, BINDING, SNAPSHOT)
    const rebound = withCardBinding(first, { ...BINDING, modelId: 'model_b' })
    expect(rebound.extensions?.airi?.avatar).toMatchObject({ modelId: 'model_b', prompt: SNAPSHOT })
  })

  it('never writes the frozen legacy display model id', () => {
    const card = { extensions: { airi: { modules: { displayModelId: 'display-model-1' } } } }
    const next = withCardBinding(card, BINDING)
    expect(next.extensions?.airi?.modules?.displayModelId).toBe('display-model-1')

    const cleared = withCardBindingCleared(next)
    expect(cleared.extensions?.airi?.avatar).toEqual({})
    expect(cleared.extensions?.airi?.modules?.displayModelId).toBe('display-model-1')
  })

  it('leaves unrelated extension fields alone', () => {
    const card = { extensions: { airi: { acting: { modelExpressionPrompt: 'legacy' }, outfits: [] } } }
    const next = withCardBinding(card, BINDING)
    expect(next.extensions?.airi?.acting).toEqual({ modelExpressionPrompt: 'legacy' })
    expect(next.extensions?.airi?.outfits).toEqual([])
  })

  it('attaches a snapshot without moving the ids', () => {
    const card = withCardBinding({}, BINDING)
    const next = withCardPromptSnapshot(card, SNAPSHOT)
    expect(next.extensions?.airi?.avatar).toEqual({ ...BINDING, prompt: SNAPSHOT })
  })
})

describe('resolving a card', () => {
  it('classifies a complete binding with every referent', () => {
    const state = resolveCardAvatarState(
      { extensions: { airi: { avatar: BINDING } } },
      { legacyRendererAvailable: true, driver: DriverStatus.ENABLED, modelRecordPresent: true, profileRecordPresent: true },
    )
    expect(state.state).toBe('bound')
    expect(state.renders).toBe(true)
  })

  it('classifies an unbound card with a legacy id and no legacy renderer as unavailable, not as an error', () => {
    const state = resolveCardAvatarState(
      { extensions: { airi: { modules: { displayModelId: 'display-model-1' } } } },
      { legacyRendererAvailable: false, driver: DriverStatus.ENABLED, modelRecordPresent: false, profileRecordPresent: false },
    )
    expect(state.state).toBe('legacy-unavailable')
    expect(state.error).toBe(false)
    expect(state.action).toBe('migrate-now')
  })
})
