/**
 * Prompt reconciliation and arbitration (§5.4) — the phase's exit criterion 5, asserted case by case.
 *
 * The interesting cases are the ones a naive implementation gets wrong:
 *
 *   - a **card-only** snapshot must seed the store with text *and* tokens and be handed back to the driver, so
 *     the driver's next publication is strictly newer rather than discarded as stale;
 *   - a **store-newer** card must be refreshed from the store, not the other way round;
 *   - a **card-newer pair** must raise a conflict, inject nothing, and — when arbitrated — write
 *     `max + 1` and hand *that* pair to the driver, which is where the losing copy's history lives (P1-D26);
 *   - assembly reads the store only, so a conflict suppresses injection without touching character data.
 */
import type { ModelPromptPublication } from '../../contract'
import type { PromptBinding } from './prompt-service'

import { describe, expect, it } from 'vitest'

import {
  createHostPromptService,
  PromptReconciliation,
} from './prompt-service'
import { createPromptStore } from './prompts'
import { createMemoryStoragePort } from './storage'

const BINDING: PromptBinding = {
  modelDriverId: 'ai.moeru.airi.test.stub',
  modelId: 'model_a',
  profileId: 'profile_a',
}

function publication(overrides: Partial<ModelPromptPublication> = {}): ModelPromptPublication {
  return {
    modelDriverId: BINDING.modelDriverId,
    modelId: BINDING.modelId,
    profileId: BINDING.profileId,
    text: 'Be kind.',
    tokens: ['happy'],
    version: 1,
    publishedAt: 10,
    ...overrides,
  }
}

function snapshot(overrides: Partial<Omit<ModelPromptPublication, 'modelDriverId'>> = {}) {
  const { modelDriverId: _ignored, ...rest } = publication(overrides)
  return rest
}

function setup() {
  const store = createPromptStore(createMemoryStoragePort())
  const delivered: ModelPromptPublication[] = []
  const service = createHostPromptService({
    store,
    resolution: { deliver: (_driverId, pair) => {
      delivered.push(pair)
    } },
  })
  return { store, service, delivered }
}

describe('prompt reconciliation', () => {
  it('reports nothing when neither side holds a copy', async () => {
    const { service, delivered } = setup()
    const result = await service.reconcile({ binding: BINDING })
    expect(result.outcome).toBe(PromptReconciliation.NONE)
    expect(result.publication).toBeUndefined()
    expect(delivered).toHaveLength(0)
  })

  it('injects the store copy when the card carries none', async () => {
    const { service } = setup()
    const stored = publication({ text: 'From the driver.', tokens: ['wave'], version: 4 })
    await service.publish(stored)

    const result = await service.reconcile({ binding: BINDING })
    expect(result.outcome).toBe(PromptReconciliation.STORE)
    expect(result.publication?.text).toBe('From the driver.')
  })

  it('seeds a card-only snapshot into the store, text and tokens together, and hands it back to the driver', async () => {
    const { service, store, delivered } = setup()
    const card = snapshot({ text: 'Authored on the card.', tokens: ['happy', 'wave'], version: 7 })

    const result = await service.reconcile({ binding: BINDING, snapshot: card })
    expect(result.outcome).toBe(PromptReconciliation.SEEDED)

    const stored = await store.get(BINDING.modelDriverId, BINDING.modelId, BINDING.profileId)
    expect(stored?.text).toBe('Authored on the card.')
    expect(stored?.tokens).toEqual(['happy', 'wave'])
    expect(stored?.version).toBe(7)

    // The driver is told what AIRI now holds, so its next publication continues from version 7 instead of being
    // discarded as stale.
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.version).toBe(7)
  })

  it('keeps an empty card publication as a value rather than reading it as absent', async () => {
    const { service, store } = setup()
    const empty = snapshot({ text: '', tokens: [], version: 1 })

    const result = await service.reconcile({ binding: BINDING, snapshot: empty })
    expect(result.outcome).toBe(PromptReconciliation.SEEDED)
    const stored = await store.get(BINDING.modelDriverId, BINDING.modelId, BINDING.profileId)
    expect(stored?.text).toBe('')
    expect(stored?.tokens).toEqual([])
  })

  it('refreshes a store-newer card from the store', async () => {
    const { service } = setup()
    await service.publish(publication({ text: 'Newer on device.', tokens: ['wave'], version: 9 }))

    const result = await service.reconcile({
      binding: BINDING,
      snapshot: snapshot({ text: 'Older on card.', tokens: ['happy'], version: 3 }),
    })
    expect(result.outcome).toBe(PromptReconciliation.STORE)
    expect(result.publication?.text).toBe('Newer on device.')
  })

  it('treats an identical pair at the same version as agreement', async () => {
    const { service } = setup()
    await service.publish(publication({ version: 2 }))

    const result = await service.reconcile({ binding: BINDING, snapshot: snapshot({ version: 2 }) })
    expect(result.outcome).toBe(PromptReconciliation.STORE)
    expect(result.raise).toBeUndefined()
  })

  it('raises a conflict for a card-newer pair, injects nothing, and raises it only once', async () => {
    const { service } = setup()
    await service.publish(publication({ text: 'Device copy.', tokens: ['happy'], version: 2 }))

    const card = snapshot({ text: 'Card copy.', tokens: ['wave'], version: 5 })
    const first = await service.reconcile({ binding: BINDING, snapshot: card })
    expect(first.outcome).toBe(PromptReconciliation.CONFLICT)
    expect(first.publication).toBeUndefined()
    expect(first.raise).toBe(true)
    expect(first.conflict?.device?.text).toBe('Device copy.')
    expect(first.conflict?.card.text).toBe('Card copy.')

    // Nothing is injected while the disagreement stands.
    expect(await service.injectable({ binding: BINDING, snapshot: card })).toBeUndefined()

    const second = await service.reconcile({ binding: BINDING, snapshot: card })
    expect(second.outcome).toBe(PromptReconciliation.CONFLICT)
    expect(second.raise).toBe(false)
  })

  it('raises a conflict for equal versions with different text', async () => {
    const { service } = setup()
    await service.publish(publication({ text: 'Device copy.', version: 2 }))

    const result = await service.reconcile({
      binding: BINDING,
      snapshot: snapshot({ text: 'Card copy.', version: 2 }),
    })
    expect(result.outcome).toBe(PromptReconciliation.CONFLICT)
    expect(result.raise).toBe(true)
  })

  it('never injects a snapshot that belongs to another binding', async () => {
    const { service, delivered } = setup()
    const result = await service.reconcile({
      binding: BINDING,
      snapshot: snapshot({ modelId: 'model_b', profileId: 'profile_b' }),
    })
    expect(result.outcome).toBe(PromptReconciliation.FOREIGN)
    expect(result.publication).toBeUndefined()
    expect(delivered).toHaveLength(0)
  })
})

describe('prompt arbitration', () => {
  it('writes the device winner with max + 1 and hands it back to the driver', async () => {
    const { service, store, delivered } = setup()
    await service.publish(publication({ text: 'Device copy.', tokens: ['happy'], version: 4 }))

    const result = await service.arbitrate({
      binding: BINDING,
      winner: 'device',
      card: snapshot({ text: 'Card copy.', tokens: ['wave'], version: 6 }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok)
      return

    expect(result.value.publication.text).toBe('Device copy.')
    expect(result.value.publication.version).toBe(7)
    expect(result.value.loser?.source).toBe('card')

    const stored = await store.get(BINDING.modelDriverId, BINDING.modelId, BINDING.profileId)
    expect(stored?.version).toBe(7)
    // The resolved pair reaches the driver, which is where a losing publication's history lives.
    expect(delivered.at(-1)?.version).toBe(7)
  })

  it('writes the card winner with max + 1, including when the store held nothing', async () => {
    const { service, store } = setup()
    const result = await service.arbitrate({
      binding: BINDING,
      winner: 'card',
      card: snapshot({ text: 'Card copy.', tokens: ['wave'], version: 3 }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok)
      return

    expect(result.value.publication.text).toBe('Card copy.')
    expect(result.value.publication.version).toBe(4)
    const stored = await store.get(BINDING.modelDriverId, BINDING.modelId, BINDING.profileId)
    expect(stored?.tokens).toEqual(['wave'])
  })
})

describe('prompt state for the driver panel', () => {
  it('distinguishes "published nothing" from "published empty"', async () => {
    const { service } = setup()
    const capable = { ...BINDING, promptCapable: true }

    expect(await service.stateFor(capable)).toBe('missing')
    await service.publish(publication({ text: '', tokens: [] }))
    expect(await service.stateFor(capable)).toBe('published')
    expect(await service.stateFor({ ...BINDING, promptCapable: false })).toBe('published')
  })
})
