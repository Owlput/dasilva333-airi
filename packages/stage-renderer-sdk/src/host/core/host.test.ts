/**
 * The host as a whole: two windows, one bus, registry-issued identities.
 *
 * The broker suite covers the transaction table; this one covers the *host* decisions around it — that a
 * mount's window comes from the sender and not from the request, that two windows are really two
 * participants in one bus, and that a cue addressed to `acting` reaches the acting window and nothing else.
 */
import type { CueEnvelope } from '../../contract'

import { describe, expect, it } from 'vitest'

import { ContractFailureCode, MountRegistrationRefusal, RendererMountPurpose, RendererMountSurfaceKind } from '../../contract'
import { createTestHost, envelope, unwrap } from '../testing/harness'
import { STUB_DRIVER_ID } from '../testing/stub-driver'

describe('host core', () => {
  it('registers mounts in two windows and delivers an acting cue only to the acting one', async () => {
    const host = await createTestHost()
    const stageWindow = host.openWindow('section-stage')
    const actingWindow = host.openWindow('actor-window')

    const stage = await stageWindow.mount({ surface: 'stage', purpose: 'stage' })
    const acting = await actingWindow.mount({ surface: 'acting', purpose: 'acting' })

    expect(stage.mountId).not.toBe(acting.mountId)

    unwrap(await unwrap(await stageWindow.cueChannel.send(envelope('acting'))).settled)

    expect(acting.mount.received).toHaveLength(1)
    expect(stage.mount.received).toHaveLength(0)
  })

  it('issues the mount id and takes the window from the sender, not the request', async () => {
    const host = await createTestHost()
    const window = host.openWindow('real-window')

    const registered = await window.registryClient.registerMount({
      driverId: STUB_DRIVER_ID,
      surface: RendererMountSurfaceKind.STAGE,
      purpose: RendererMountPurpose.CHAT,
      // A renderer that names another window must not be able to register a mount there.
      windowId: 'someone-elses-window',
    })
    expect(registered.ok).toBe(true)

    const [descriptor] = await host.core.mounts.list()
    expect(descriptor.windowId).toBe('real-window')
    expect(descriptor.surface).toBe(RendererMountSurfaceKind.STAGE)
    expect(descriptor.purpose).toBe(RendererMountPurpose.CHAT)
  })

  it('refuses a mount for a driver it does not know', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    const refused = await window.registryClient.registerMount({
      driverId: 'ai.moeru.airi.absent',
      surface: RendererMountSurfaceKind.STAGE,
      purpose: RendererMountPurpose.STAGE,
      windowId: 'control-strip',
    })
    expect(refused).toEqual({ ok: false, reason: MountRegistrationRefusal.DRIVER_DISABLED })
  })

  it('answers shutting-down rather than creating a mount during shutdown', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await host.core.shutdown()

    const refused = await window.registryClient.registerMount({
      driverId: STUB_DRIVER_ID,
      surface: RendererMountSurfaceKind.STAGE,
      purpose: RendererMountPurpose.STAGE,
      windowId: 'control-strip',
    })
    expect(refused).toEqual({ ok: false, reason: MountRegistrationRefusal.SHUTTING_DOWN })
  })

  it('notifies observers without letting one of them break the send', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    const seen: CueEnvelope[] = []
    window.cueChannel.subscribe({
      handle: (value) => {
        seen.push(value)
        throw new Error('an observer is not allowed to break a send')
      },
    })

    const ack = unwrap(await unwrap(await window.cueChannel.send(envelope('acting'))).settled)
    expect(ack.handled).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0].target.purpose).toBe(RendererMountPurpose.ACTING)
  })

  it('gives every mount in every window the same driver storage namespace', async () => {
    const host = await createTestHost()
    const first = host.openWindow('one')
    const second = host.openWindow('two')

    await first.mount({ surface: 'acting', purpose: 'acting' })
    await second.mount({ surface: 'stage', purpose: 'stage' })

    // `HostServices` exists only once a window has run the driver's provider entry: it is the entry that
    // receives them. Two windows hosting the same driver therefore get two services objects over one
    // namespace — which is the property under test.
    await first.openEntry({ driverId: STUB_DRIVER_ID })
    await second.openEntry({ driverId: STUB_DRIVER_ID })

    const servicesA = first.services()
    const servicesB = second.services()
    expect(servicesA).toBeDefined()
    expect(servicesB).toBeDefined()

    await servicesA!.storage.set('settings/scale', 2)
    // One namespace per driver, not per mount: a panel in one window writes and a mount in another reads.
    expect(await servicesB!.storage.get('settings/scale')).toBe(2)
    expect(servicesA!.contract).toEqual(servicesB!.contract)
  })

  it('settles a transaction whose driver refuses the delivery', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    host.driver.failures.deliver = { code: ContractFailureCode.INTERNAL, message: 'refused' }
    // The stub refuses in `deliver` before reaching a mount.
    const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
    const settled = await receipt.settled
    expect(settled.ok).toBe(false)
  })

  it('tells a manager its channel died, so the next pull asks for a renderer again', async () => {
    const host = await createTestHost()
    const first = host.openWindow('one')
    await first.mount({ surface: 'acting', purpose: 'acting' })

    // The manager opens its channel to the only window able to serve it.
    unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))
    expect(first.requests).toHaveLength(1)

    // A window that exists before the close, so the next request has somewhere to go.
    const second = host.openWindow('two')
    await second.mount({ surface: 'stage', purpose: 'stage' })

    await first.close()

    // The channel died with its window, so this resolves only because the manager was told, dropped its copy
    // and asked again — the recovery `requestRenderer` describes (P1-D23).
    unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))
    expect(second.requests).toHaveLength(1)
    expect(first.requests).toHaveLength(1)
  })
})
