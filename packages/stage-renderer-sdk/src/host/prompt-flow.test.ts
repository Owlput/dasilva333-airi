/**
 * The prompt's whole round trip, through the real host, the real adapter and the stub driver's two halves.
 *
 * `prompt-service.test.ts` asserts the rules against a store; this suite asserts that the rules *reach the
 * driver* 鈥?which is the half Phase 1 could not prove because no producer existed for `onResolution`. The chain
 * is: a card snapshot is newer than the store 鈫?a conflict 鈫?the user arbitrates 鈫?the host writes `max + 1`,
 * stores it, and delivers it over IPC-shaped transport to the window running the driver 鈫?the driver records it
 * and the next publication continues from that version.
 *
 * A second chain is the seed: a card-only snapshot reaches the store and the driver in one activation step.
 */
import type { ModelPromptPublication } from '../contract'

import { describe, expect, it } from 'vitest'

import { RendererMountPurpose, RendererMountSurfaceKind } from '../contract'
import { createHostPromptService, PromptReconciliation } from './core/prompt-service'
import { createInProcessHost, STUB_DEMO_MODEL } from './testing/in-process'
import { STUB_DRIVER_ID } from './testing/stub-driver'

const BINDING = {
  modelDriverId: STUB_DRIVER_ID,
  modelId: STUB_DEMO_MODEL.modelId,
  profileId: STUB_DEMO_MODEL.profileId,
}

function snapshot(overrides: Partial<Omit<ModelPromptPublication, 'modelDriverId'>> = {}) {
  return {
    modelId: BINDING.modelId,
    profileId: BINDING.profileId,
    text: 'Card-authored guidance.',
    tokens: ['happy', 'wave'],
    version: 12,
    publishedAt: 99,
    ...overrides,
  }
}

/** Open a window, activate the driver in it, and return the host half a surface would actually use. */
async function setup() {
  const host = await createInProcessHost()
  const window = await host.openWindow('acting')

  // A mount is what makes this window the address a cue is steered to, and it is also how the host knows a window
  // is running this driver's code: a surface starts its own entry with `ensureEntry`, so no manager channel need
  // exist for it (P1-D19).
  const registered = await window.adapter.registerMount({
    driverId: STUB_DRIVER_ID,
    surface: RendererMountSurfaceKind.ACTING,
    purpose: RendererMountPurpose.ACTING,
  })
  expect(registered.ok).toBe(true)

  await window.adapter.ensureEntry(STUB_DRIVER_ID)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(window.activated()).toBe(true)

  const prompts = createHostPromptService({
    store: window.prompts,
    resolution: {
      deliver: (driverId, publication) => {
        void window.adapter.deliverPromptResolution(driverId, publication)
      },
    },
  })

  return { host, window, prompts }
}

/** A binding the stub never published for on activation, so the store starts empty for it. */
const UNPUBLISHED = { ...BINDING, profileId: 'profile_seeded' }

describe('prompt round trip through the host', () => {
  it('seeds a card-only snapshot into the store and tells the driver about it', async () => {
    const { host, window, prompts } = await setup()

    const result = await prompts.reconcile({
      binding: UNPUBLISHED,
      snapshot: snapshot({ profileId: UNPUBLISHED.profileId }),
    })
    expect(result.outcome).toBe(PromptReconciliation.SEEDED)

    // The store, in this window, holds the pair.
    const stored = await window.prompts.get(UNPUBLISHED.modelDriverId, UNPUBLISHED.modelId, UNPUBLISHED.profileId)
    expect(stored?.version).toBe(12)
    expect(stored?.tokens).toEqual(['happy', 'wave'])

    // And the driver recorded it, so its next publication continues from version 12.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(window.session()!.state.resolutions.at(-1)?.version).toBe(12)

    await host.close()
  })

  it('arbitrates a conflict, writes max + 1, and hands the resolved pair to the driver', async () => {
    const { host, window, prompts } = await setup()

    // The driver published version 1 for the demo model on activation. A card at version 5 with different text is
    // therefore a conflict: it is above the store and disagrees with it.
    const published = await window.prompts.get(BINDING.modelDriverId, BINDING.modelId, BINDING.profileId)
    expect(published?.version).toBe(1)

    const card = snapshot({ version: 5, text: 'Card wins.', tokens: ['wave'] })
    const reconciled = await prompts.reconcile({ binding: BINDING, snapshot: card })
    expect(reconciled.outcome).toBe(PromptReconciliation.CONFLICT)
    expect(reconciled.raise).toBe(true)
    // Nothing is injected while the disagreement stands.
    expect(await prompts.injectable({ binding: BINDING, snapshot: card })).toBeUndefined()

    const arbitrated = await prompts.arbitrate({ binding: BINDING, winner: 'card', card })
    expect(arbitrated.ok).toBe(true)
    if (!arbitrated.ok)
      return

    expect(arbitrated.value.publication.version).toBe(6)

    await new Promise(resolve => setTimeout(resolve, 0))

    // The driver's history now records the decision, which is where a losing publication lives (P1-D26).
    const recorded = window.session()!.state.resolutions.at(-1)
    expect(recorded?.version).toBe(6)
    expect(recorded?.text).toBe('Card wins.')

    // After the arbitration, assembly injects the resolved pair and no conflict is raised again for it.
    const injected = await prompts.injectable({ binding: BINDING, snapshot: card })
    expect(injected?.text).toBe('Card wins.')

    const after = await prompts.reconcile({ binding: BINDING, snapshot: arbitrated.value.publication })
    expect(after.outcome).toBe(PromptReconciliation.STORE)

    await host.close()
  })

  it('reports that a resolved prompt reached no window when the driver runs nowhere', async () => {
    const host = await createInProcessHost()
    const opened = await host.openWindow('idle')
    // No entry: this window never asked to run the driver, so no channel exists to address a delivery to.
    const result = await opened.adapter.deliverPromptResolution(STUB_DRIVER_ID, {
      modelDriverId: STUB_DRIVER_ID,
      ...snapshot(),
    })

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.code).toBe('driver-unavailable')

    await host.close()
  })
})
