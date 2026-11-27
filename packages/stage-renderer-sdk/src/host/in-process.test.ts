/**
 * The chain the dev route demonstrates by hand, asserted end to end with no Electron.
 *
 * The route at `/devtools/model-driver-stub` was the only place the *whole* Phase 1 path ran: row pull →
 * manager → `requestRenderer` → a window's provider entry → a registry-issued mount id → the readiness walk →
 * a cue → its settlement → capture. Every piece had a unit suite, but nothing composed the real service with the
 * real adapter, so the composition itself was checked by a human pressing buttons (§4.9 criterion 2).
 *
 * This suite is that composition: `createInProcessHost` runs the real `ModelDriverHostService` and one real
 * `ModelDriverAdapter` per window, joined by a transport that hands a push to the adapter that pretended to
 * receive it. The assertions are written against what the route displayed, so a regression shows up here rather
 * than in a screenshot.
 *
 * What is still manual, and why: the Electron `webContents` identity, the eventa hop, `state.json` on disk, the
 * `BrowserWindow` itself, and the shared background window. Those are embedder resources; a headless suite would
 * have to fake the thing it is meant to prove.
 */
import type { ContractResult } from '../contract'
import type { InProcessWindow } from './testing'

import { describe, expect, it } from 'vitest'

import {
  ContractFailureCode,
  CueKind,
  CueRejection,
  CueSource,
  CueWithdrawalKind,
  CueWithdrawalOutcome,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../contract'
import { createInProcessHost, STUB_DEMO_MODEL, STUB_DRIVER_ID } from './testing'

const SURFACE = RendererMountSurfaceKind.ACTING
const PURPOSE = RendererMountPurpose.ACTING

function unwrap<T>(result: ContractResult<T>): T {
  if (!result.ok)
    throw new Error(`Expected success, got ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Poll a predicate that a background promise settles, rather than asserting on a fixed tick count. */
async function waitFor(condition: () => boolean, label: string, attempts = 100): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (condition())
      return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

/**
 * A window with an `acting` mount that is ready — the state every button on the dev route needs first.
 *
 * The order is the route's, and each step is load-bearing: the registry issues the id, `mounting` is the only
 * legal way out of `unmounted`, the entry must run *in this window* before the mount can receive, and only then
 * may the mount become ready.
 */
async function mountActing(window: InProcessWindow) {
  const registered = await window.adapter.registerMount({ driverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
  if (!registered.ok)
    throw new Error(`The host refused the mount: ${registered.reason}`)

  unwrap(await window.adapter.setReadiness(registered.mountId, RendererMountReadinessState.MOUNTING))
  unwrap(await window.adapter.ensureEntry(STUB_DRIVER_ID))

  const session = window.session()
  if (!session)
    throw new Error('The provider entry did not create a session in this window')

  const mount = session.openMount({ surface: SURFACE, purpose: PURPOSE })
  mount.attach(registered.mountId)
  unwrap(await window.adapter.setReadiness(registered.mountId, RendererMountReadinessState.READY_FOR_MODEL))

  return { mountId: registered.mountId, mount, session }
}

describe('in-process host', () => {
  it('pulls rows by relaying an entry request to a live window', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')

    // Unaddressed on purpose: a pull may be served by any window that can run the driver, and the answer is what
    // the registry caches — not a push (§4.3).
    const rows = unwrap(await window.adapter.pullRows(STUB_DRIVER_ID))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ modelId: STUB_DEMO_MODEL.modelId, profileId: STUB_DEMO_MODEL.profileId })
    // The pull is what made the host ask this window for the driver's code, so the entry runs here now.
    expect(window.adapter.entries().has(STUB_DRIVER_ID)).toBe(true)
    expect(host.cachedRows()).toHaveLength(1)

    await host.close()
  })

  it('issues the mount id, refuses a skipped readiness step, and walks the declared one', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')

    const registered = await window.adapter.registerMount({ driverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    if (!registered.ok)
      throw new Error(`The host refused the mount: ${registered.reason}`)
    // A registry-issued id, never one the renderer constructed.
    expect(registered.mountId).toMatch(/^mount_/)

    // `unmounted` → `ready-for-model` is not a declared transition, so the host refuses it; the mount stays put.
    const skipped = await window.adapter.setReadiness(registered.mountId, RendererMountReadinessState.READY_FOR_MODEL)
    expect(skipped.ok).toBe(false)

    expect((await window.adapter.setReadiness(registered.mountId, RendererMountReadinessState.MOUNTING)).ok).toBe(true)
    expect((await window.adapter.setReadiness(registered.mountId, RendererMountReadinessState.READY_FOR_MODEL)).ok).toBe(true)

    await host.close()
  })

  it('loads a model through a cue and settles it with the mount answering', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')
    const { mountId } = await mountActing(window)
    expect(mountId).toBeDefined()

    const receipt = unwrap(await window.adapter.cues.send({
      cues: [{ kind: CueKind.LOAD, modelId: STUB_DEMO_MODEL.modelId, profileId: STUB_DEMO_MODEL.profileId }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    }))

    const ack = unwrap(await receipt.settled)
    expect(ack.handled).toBe(true)
    expect(ack.nonce).toBe(receipt.nonce)
    expect(ack.results[0]).toMatchObject({ status: 'resolved', value: { kind: CueKind.LOAD } })

    // The mount is the thing that answered: it recorded the envelope and applied the model.
    expect(window.session()?.mounts[0]?.received).toHaveLength(1)
    expect(window.session()?.mounts[0]?.modelIds).toEqual([STUB_DEMO_MODEL.modelId])

    await host.close()
  })

  it('returns capture bytes in the settlement', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')
    await mountActing(window)

    const receipt = unwrap(await window.adapter.cues.send({
      cues: [{ kind: CueKind.CAPTURE }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    }))

    const ack = unwrap(await receipt.settled)
    const slot = ack.results[0]
    if (slot.status !== 'resolved' || slot.value.kind !== CueKind.CAPTURE)
      throw new Error('Expected the stub to resolve a capture')

    expect(slot.value.mime).toBe('image/png')
    expect(slot.value.data.byteLength).toBeGreaterThan(0)

    await host.close()
  })

  it('settles a cue addressed at an empty surface as NO_TARGET, and delivers nothing', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')
    const { mount } = await mountActing(window)

    const receipt = unwrap(await window.adapter.cues.send({
      cues: [{ kind: CueKind.CAPTURE }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.STAGE },
    }))

    // A settled answer, not an error: nothing was mounted at that address (§9.1).
    const ack = unwrap(await receipt.settled)
    expect(ack.handled).toBe(false)
    expect(ack.results.every(slot => slot.status === 'rejected' && slot.reason === CueRejection.NO_TARGET)).toBe(true)
    expect(mount.received).toHaveLength(0)

    await host.close()
  })

  it('gives two windows their own mount while they share one host and one storage origin', async () => {
    const host = await createInProcessHost()
    const first = await host.openWindow('w1')
    const second = await host.openWindow('w2')

    const one = await mountActing(first)
    const two = await mountActing(second)
    expect(one.mountId).not.toBe(two.mountId)

    // One origin: a driver's namespace is per driver, not per window, so a write in one window is visible in
    // the other through the same primitives (P1-D25).
    await first.adapter.storageFor(STUB_DRIVER_ID).set('settings/scale', 2)
    expect(await second.adapter.storageFor(STUB_DRIVER_ID).get('settings/scale')).toBe(2)

    // Both windows hold a matching mount, and the host delivers the transaction to exactly one of them.
    const receipt = unwrap(await first.adapter.cues.send({
      cues: [{ kind: CueKind.ACT, actToken: 'happy' }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    }))
    expect(unwrap(await receipt.settled).handled).toBe(true)

    const received = one.mount.received.length + two.mount.received.length
    expect(received).toBe(1)

    // Each window reads the same host cache: rows are the host's projection, not a window's own list.
    expect(unwrap(await first.adapter.pullRows(STUB_DRIVER_ID))).toHaveLength(1)
    expect(unwrap(await second.adapter.pullRows(STUB_DRIVER_ID))).toHaveLength(1)

    await host.close()
  })

  it('withdraws queued work through the adapter, and refuses a request that names no target', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')

    const registered = await window.adapter.registerMount({ driverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    if (!registered.ok)
      throw new Error(`The host refused the mount: ${registered.reason}`)
    unwrap(await window.adapter.setReadiness(registered.mountId, RendererMountReadinessState.MOUNTING))

    // Not ready, so this queues in the broker rather than reaching a mount.
    const receipt = unwrap(await window.adapter.cues.send({
      cues: [{ kind: CueKind.LOAD, modelId: STUB_DEMO_MODEL.modelId, profileId: STUB_DEMO_MODEL.profileId }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    }))

    const report = unwrap(await window.adapter.withdraw({
      kind: CueWithdrawalKind.POP_ALL,
      modelDriverId: STUB_DRIVER_ID,
      address: { purpose: PURPOSE },
    }))
    expect(report.count).toBe(1)
    expect(report.results[0]).toMatchObject({ nonce: receipt.nonce, outcome: CueWithdrawalOutcome.CANCELLED })

    const settled = await receipt.settled
    expect(settled.ok).toBe(false)
    if (!settled.ok)
      expect(settled.error.code).toBe(ContractFailureCode.CANCELLED)

    // The dev route's "Abort current" button used to send exactly this, with no target — which §9.7 says is
    // malformed. Asserting the refusal is what keeps the route's remaining call honest.
    const malformed = await window.adapter.withdraw({ kind: CueWithdrawalKind.ABORT_CURRENT, modelDriverId: STUB_DRIVER_ID })
    expect(malformed.ok).toBe(false)
    if (!malformed.ok)
      expect(malformed.error.code).toBe(ContractFailureCode.INVALID_ENVELOPE)

    await host.close()
  })

  it('publishes a prompt into the window store when the entry activates', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')

    unwrap(await window.adapter.ensureEntry(STUB_DRIVER_ID))
    await waitFor(() => window.activated(), 'the stub runtime to activate')

    const stored = await window.prompts.get(STUB_DRIVER_ID, STUB_DEMO_MODEL.modelId, STUB_DEMO_MODEL.profileId)
    expect(stored).toBeDefined()
    expect(stored?.tokens).toHaveLength(1)
    expect(stored?.version).toBeGreaterThanOrEqual(1)

    await host.close()
  })

  it('reports the host state a renderer reads, and unregisters a mount on request', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')
    const { mountId } = await mountActing(window)

    const state = await window.adapter.hostState()
    expect(state.drivers).toHaveLength(1)
    expect(state.backgroundWindowStarted).toBe(false)

    await window.adapter.unregisterMount(mountId)
    expect(await host.service.mounts.list()).toHaveLength(0)

    await host.close()
  })

  it('drops a window\'s mounts and settles what it left pending when the window closes', async () => {
    const host = await createInProcessHost()
    const window = await host.openWindow('w1')
    const { session } = await mountActing(window)

    // A cue the mount will hold: the driver is gated before it answers, so the transaction is running when the
    // window goes away.
    let open: () => void = () => {}
    session.state.deliverGate = new Promise<void>((resolve) => {
      open = resolve
    })

    const receipt = unwrap(await window.adapter.cues.send({
      cues: [{ kind: CueKind.ACT, actToken: 'happy' }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    }))

    await window.close()

    // The host settles the transaction it delivered — but the window it belonged to is gone, so the settlement
    // is addressed at nobody. That is the same shape the app has: `emitToWindow` returns `false` for a destroyed
    // window, which is why the *receiving* side is what has to notice, not the sender.
    expect(host.service.broker.pendingCount()).toBe(0)
    expect(host.pushes()).toContainEqual(
      expect.objectContaining({ windowId: 'w1', kind: 'cue-settled', nonce: receipt.nonce, delivered: false }),
    )
    expect(await host.service.mounts.list()).toHaveLength(0)

    // Releasing the gate afterwards must not resurrect the transaction.
    open()
    await Promise.resolve()
    expect(host.service.broker.pendingCount()).toBe(0)

    await host.close()
  })
})
