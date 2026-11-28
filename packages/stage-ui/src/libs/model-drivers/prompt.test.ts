/**
 * The card's prompt seam: assembly reads the store, reconciliation writes the card on purpose, arbitration returns
 * the pair to persist (§5.4).
 *
 * The service here is a fake, deliberately: the rules are asserted against the real one in the SDK
 * (`prompt-service.test.ts`, `prompt-flow.test.ts`), and what this suite is about is *the card* — which object is
 * rewritten, when, and that a conflict rewrites nothing.
 */
import type { HostPromptService } from '@proj-airi/stage-renderer-sdk/host'
import type { PromptConflict } from '@proj-airi/stage-renderer-sdk/host'

import { PromptReconciliation as Outcome } from '@proj-airi/stage-renderer-sdk/host'
import { describe, expect, it } from 'vitest'

import { arbitrateModelPromptForCard, reconcileModelPromptForCard, resolveModelPromptForCard } from './prompt'

const BINDING = { driverId: 'ai.moeru.airi.test.stub', modelId: 'model_a', profileId: 'profile_a' }

const DEVICE = {
  modelDriverId: BINDING.driverId,
  modelId: BINDING.modelId,
  profileId: BINDING.profileId,
  text: 'From the driver.',
  tokens: ['happy'],
  version: 4,
  publishedAt: 20,
}

const CARD = {
  modelId: BINDING.modelId,
  profileId: BINDING.profileId,
  text: 'From the card.',
  tokens: ['wave'],
  version: 7,
  publishedAt: 30,
}

function card() {
  return { extensions: { airi: { avatar: { ...BINDING, prompt: CARD } } } }
}

function fakeService(overrides: Partial<HostPromptService> = {}): HostPromptService {
  const base = {
    publish: async () => ({ ok: true, value: 'published' }),
    reconcile: async () => ({ outcome: Outcome.STORE, publication: { ...DEVICE, ...BINDING, modelDriverId: BINDING.driverId } }),
    injectable: async () => DEVICE,
    arbitrate: async () => ({ ok: true, value: { publication: { ...DEVICE, version: 8 } } }),
    stateFor: async () => 'published',
  }
  return { ...base, ...overrides } as unknown as HostPromptService
}

describe('prompt assembly', () => {
  it('injects the store pair, never the card snapshot', async () => {
    const service = fakeService()
    const resolved = await resolveModelPromptForCard({ service, card: card() })
    expect(resolved?.text).toBe('From the driver.')
    expect(resolved?.tokens).toEqual(['happy'])
  })

  it('injects nothing for an unbound card', async () => {
    const resolved = await resolveModelPromptForCard({ service: fakeService(), card: {} })
    expect(resolved).toBeUndefined()
  })

  it('injects nothing while a conflict stands', async () => {
    const service = fakeService({ injectable: async () => undefined })
    expect(await resolveModelPromptForCard({ service, card: card() })).toBeUndefined()
  })
})

describe('reconciliation', () => {
  it('rewrites the card when the store supplied a newer pair', async () => {
    const result = await reconcileModelPromptForCard({ service: fakeService(), card: card() })
    expect(result.outcome).toBe('store')
    const avatar = result.card.extensions?.airi?.avatar as { prompt?: { text: string, version: number } }
    expect(avatar.prompt?.text).toBe('From the driver.')
    expect(avatar.prompt?.version).toBe(4)
  })

  it('leaves the card object alone when there is nothing to write', async () => {
    const input = card()
    const conflict: PromptConflict = { device: DEVICE, card: CARD }
    const service = fakeService({
      reconcile: async () => ({ outcome: Outcome.CONFLICT, conflict, raise: true }) as never,
    })

    const result = await reconcileModelPromptForCard({ service, card: input })
    expect(result.outcome).toBe('conflict')
    expect(result.raise).toBe(true)
    expect(result.card).toBe(input)
  })
})

describe('arbitration', () => {
  it('returns the card carrying the resolved pair and hands the winner to the service', async () => {
    let chosen: 'device' | 'card' | undefined
    const service = fakeService({
      arbitrate: async ({ winner }: { winner: 'device' | 'card' }) => {
        chosen = winner
        return { ok: true, value: { publication: { ...DEVICE, version: 8 } } }
      },
    })

    const result = await arbitrateModelPromptForCard({
      service,
      card: card(),
      winner: 'card',
      conflict: { device: DEVICE, card: CARD },
    })

    expect(result.ok).toBe(true)
    expect(chosen).toBe('card')
    if (result.ok) {
      const avatar = result.value.card.extensions?.airi?.avatar as { prompt?: { version: number } }
      expect(avatar.prompt?.version).toBe(8)
    }
  })

  it('refuses to arbitrate a card with no binding', async () => {
    const result = await arbitrateModelPromptForCard({
      service: fakeService(),
      card: {},
      winner: 'device',
      conflict: { device: DEVICE, card: CARD },
    })
    expect(result.ok).toBe(false)
  })
})
