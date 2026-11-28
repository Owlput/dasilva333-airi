/**
 * The live mount registry: who issues a mount id, what a descriptor may change, and how a window's mounts die
 * together (§4.1, D1, §4.4 step 8).
 *
 * This is the one place a mount identity comes into existence, so the tests are about authority rather than
 * bookkeeping: ids are issued here and never reused, `mountId` and `windowId` cannot be moved by a patch, and the
 * readiness machine decides what a descriptor is allowed to record. The strict/lenient split is pinned in both
 * directions, because the difference is the whole reason the option exists: a development host refuses an illegal
 * report, a production host drops it, and neither may record a state the machine cannot reach.
 */
import type { MountRegistrationInput } from './mounts'

import { describe, expect, it } from 'vitest'

import {
  RendererMountReadinessState as Readiness,
  RendererMountPurpose,
  RendererMountSurfaceKind,
} from '../../contract'
import { createMountRegistry, mountAcceptsCues } from './mounts'

const DRIVER = 'ai.moeru.airi.test.stub'

const BASE: MountRegistrationInput = {
  driverId: DRIVER,
  surface: RendererMountSurfaceKind.ACTING,
  purpose: RendererMountPurpose.ACTING,
  windowId: 'w1',
}

function createHarness() {
  let clock = 1_000
  const registry = createMountRegistry({ now: () => clock })
  return {
    registry,
    advance(by = 10) {
      clock += by
      return clock
    },
  }
}

describe('mount registry: identity', () => {
  it('issues ids monotonically and never reuses one', async () => {
    const { registry } = createHarness()

    const first = await registry.issue(BASE)
    const second = await registry.issue({ ...BASE, windowId: 'w2' })
    await registry.unregister(first.mountId)
    const third = await registry.issue(BASE)

    expect([first.mountId, second.mountId, third.mountId]).toEqual(['mount_1', 'mount_2', 'mount_3'])
  })

  it('records a descriptor that starts unmounted and carries the address it was registered with', async () => {
    const { registry } = createHarness()

    const descriptor = await registry.issue(BASE)

    expect(descriptor).toEqual({
      mountId: 'mount_1',
      modelDriverId: DRIVER,
      surface: RendererMountSurfaceKind.ACTING,
      purpose: RendererMountPurpose.ACTING,
      windowId: 'w1',
      readiness: Readiness.UNMOUNTED,
      updatedAt: 1_000,
    })
    // A mount is not born holding a model: the model arrives by `LoadCue`, after `ready-for-model`.
    expect('modelId' in descriptor).toBe(false)
    expect('profileId' in descriptor).toBe(false)
    expect('characterId' in descriptor).toBe(false)
  })

  it('cannot have its mount id or window moved by a patch', async () => {
    const { registry } = createHarness()
    const descriptor = await registry.issue(BASE)

    // The type already forbids these fields. The cast is the point: the guard is at runtime too, because the
    // descriptor is the identity the broker uses to reject a forged ack.
    const patched = await registry.update(descriptor.mountId, { mountId: 'mount_999', windowId: 'w9' } as never)

    expect(patched.ok).toBe(true)
    if (!patched.ok)
      return
    expect(patched.value.mountId).toBe('mount_1')
    expect(patched.value.windowId).toBe('w1')
  })

  it('treats removing an already-removed mount as a successful no-op', async () => {
    const { registry } = createHarness()
    const descriptor = await registry.issue(BASE)

    expect(await registry.unregister(descriptor.mountId)).toEqual({ ok: true, value: undefined })
    expect(await registry.unregister(descriptor.mountId)).toEqual({ ok: true, value: undefined })
    expect(await registry.list()).toEqual([])
  })
})

describe('mount registry: readiness', () => {
  it('accepts a declared transition and restamps the descriptor with the host clock', async () => {
    const { registry, advance } = createHarness()
    const descriptor = await registry.issue(BASE)
    const stampedAt = advance(25)

    const reported = await registry.update(descriptor.mountId, { readiness: Readiness.MOUNTING })

    expect(reported.ok).toBe(true)
    if (!reported.ok)
      return
    expect(reported.value.readiness).toBe(Readiness.MOUNTING)
    expect(reported.value.updatedAt).toBe(stampedAt)
  })

  it('accepts a redundant report of the state the mount is already in', async () => {
    const { registry } = createHarness()
    const descriptor = await registry.issue(BASE)
    await registry.update(descriptor.mountId, { readiness: Readiness.MOUNTING })

    const again = await registry.update(descriptor.mountId, { readiness: Readiness.MOUNTING })

    expect(again.ok).toBe(true)
    if (!again.ok)
      return
    expect(again.value.readiness).toBe(Readiness.MOUNTING)
  })

  it('refuses an undeclared transition and leaves the descriptor alone', async () => {
    const { registry } = createHarness()
    const descriptor = await registry.issue(BASE)

    const refused = await registry.update(descriptor.mountId, { readiness: Readiness.MODEL_LOADED })

    expect(refused.ok).toBe(false)
    if (refused.ok)
      return
    expect(refused.error.message).toContain('Readiness cannot go from')
    expect((await registry.list())[0]?.readiness).toBe(Readiness.UNMOUNTED)
  })

  it('drops the whole patch — not only the readiness — when a host is not strict', async () => {
    const strict = createMountRegistry({ now: () => 1_000 })
    const lenient = createMountRegistry({ now: () => 1_000, strictReadinessTransitions: false })
    const strictDescriptor = await strict.issue(BASE)
    const lenientDescriptor = await lenient.issue(BASE)

    const dropped = await lenient.update(lenientDescriptor.mountId, {
      readiness: Readiness.MODEL_LOADED,
      modelId: 'model_1',
    })

    expect(dropped.ok).toBe(true)
    if (!dropped.ok)
      return
    // A patch is one write. Applying the model while discarding the state that makes it true would leave the
    // descriptor describing a mount that cannot exist.
    expect(dropped.value.readiness).toBe(Readiness.UNMOUNTED)
    expect('modelId' in dropped.value).toBe(false)

    // And the strict registry refuses the same class of report outright, rather than dropping it quietly.
    const refused = await strict.update(strictDescriptor.mountId, { readiness: Readiness.MODEL_LOADED })
    expect(refused.ok).toBe(false)
    expect((await strict.list())[0]?.readiness).toBe(Readiness.UNMOUNTED)
  })

  it('answers which mounts can take a cue right now', () => {
    const descriptor = (readiness: Readiness) => ({
      mountId: 'mount_1' as const,
      modelDriverId: DRIVER,
      surface: RendererMountSurfaceKind.ACTING,
      purpose: RendererMountPurpose.ACTING,
      windowId: 'w1',
      readiness,
      updatedAt: 0,
    })

    expect(mountAcceptsCues(descriptor(Readiness.READY_FOR_MODEL))).toBe(true)
    expect(mountAcceptsCues(descriptor(Readiness.MODEL_LOADED))).toBe(true)
    expect(mountAcceptsCues(descriptor(Readiness.UNMOUNTED))).toBe(false)
    expect(mountAcceptsCues(descriptor(Readiness.MOUNTING))).toBe(false)
    expect(mountAcceptsCues(descriptor(Readiness.LOADING_MODEL))).toBe(false)
    expect(mountAcceptsCues(descriptor(Readiness.MODEL_ERROR))).toBe(false)
    expect(mountAcceptsCues(descriptor(Readiness.MOUNT_ERROR))).toBe(false)
  })
})

describe('mount registry: queries and lifetime', () => {
  it('finds mounts by every query field, and combines them as an AND filter', async () => {
    const { registry } = createHarness()
    const acting = await registry.issue({ ...BASE, modelId: 'model_1', characterId: 'char_1' })
    const stage = await registry.issue({
      ...BASE,
      surface: RendererMountSurfaceKind.STAGE,
      purpose: RendererMountPurpose.CHAT,
      windowId: 'w2',
      modelId: 'model_2',
    })

    const ids = async (query: Parameters<typeof registry.findBy>[0]) =>
      (await registry.findBy(query)).map(mount => mount.mountId).sort()

    expect(await ids({ surface: RendererMountSurfaceKind.ACTING })).toEqual([acting.mountId])
    expect(await ids({ surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.CHAT })).toEqual([stage.mountId])
    expect(await ids({ windowId: 'w1' })).toEqual([acting.mountId])
    expect(await ids({ modelId: 'model_2' })).toEqual([stage.mountId])
    expect(await ids({ modelDriverId: DRIVER })).toEqual([acting.mountId, stage.mountId].sort())
    expect(await ids({ characterId: 'char_1' })).toEqual([acting.mountId])
    // No match rather than everything: an absent field means "any", a mismatched one means "none".
    expect(await ids({ surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.ACTING })).toEqual([])
    expect(await ids({})).toEqual([acting.mountId, stage.mountId].sort())
  })

  it('drops one window\'s mounts together and reports which windows still hold any', async () => {
    const { registry } = createHarness()
    const one = await registry.issue(BASE)
    const two = await registry.issue({ ...BASE, surface: RendererMountSurfaceKind.STAGE })
    const other = await registry.issue({ ...BASE, windowId: 'w2' })

    expect(registry.listWindows().sort()).toEqual(['w1', 'w2'])

    const removed = await registry.unregisterWindow('w1')

    expect(removed.sort()).toEqual([one.mountId, two.mountId].sort())
    expect((await registry.list()).map(mount => mount.mountId)).toEqual([other.mountId])
    expect(registry.listWindows()).toEqual(['w2'])
    expect(await registry.unregisterWindow('w1')).toEqual([])
  })

  it('notifies observers with the complete live list and survives one that throws', async () => {
    const { registry } = createHarness()
    const seen: number[] = []

    registry.onChanged(() => {
      throw new Error('an observer exploded')
    })
    const stop = registry.onChanged(mounts => seen.push(mounts.length))

    await registry.issue(BASE)
    await registry.issue({ ...BASE, surface: RendererMountSurfaceKind.STAGE })

    expect(seen).toEqual([1, 2])
    // The list is a snapshot sorted by mount id, not the internal map's insertion order.
    expect(registry.snapshot().map(mount => mount.mountId)).toEqual(['mount_1', 'mount_2'])

    stop()
    await registry.issue({ ...BASE, purpose: RendererMountPurpose.PREVIEW })
    expect(seen).toEqual([1, 2])
  })
})
