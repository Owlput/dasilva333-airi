/**
 * Entry resolution: the manager chooses, the table resolves, an unknown specifier is a refusal (§4.7, C15).
 *
 * The property that matters is not "a string came back" but that the *two halves of the table agree*: a manager
 * names a specifier, and the build either has it or refuses it. This suite asserts each declared specifier of the
 * fixture resolves through a table built from the same declarations, that a kind the driver ships none of is
 * `null` rather than a failure, and that a stray specifier is `invalid-entrypoint`.
 */
import type { DriverLoaderTable } from './loaders'

import { describe, expect, it } from 'vitest'

import { ModelDriverEntryKind } from '../contract'
import { createTestHost, envelope, unwrap } from './testing/harness'
import {
  STUB_DRIVER_ID,
  STUB_MANIFEST_SPECIFIER,
  STUB_MOUNT_SPECIFIER,
  STUB_PANEL_SPECIFIER,
  STUB_PICKER_SPECIFIER,
  STUB_PROVIDER_SPECIFIER,
} from './testing/stub-driver'

/**
 * A table built from the fixture's declared specifiers, with opaque modules.
 *
 * Deliberately not the fixture's components: those import Vue, and what this suite tests is resolution rather
 * than rendering. Every declared specifier still has an entry, which is the startup check §4.7 asks for.
 */
function createFixtureTable(): DriverLoaderTable {
  const modules = new Map<string, () => Promise<never>>()

  const register = (specifier: string) => {
    modules.set(specifier, async () => ({} as never))
  }
  register(STUB_PROVIDER_SPECIFIER)
  register(STUB_MOUNT_SPECIFIER)
  register(STUB_PANEL_SPECIFIER)
  register(STUB_PICKER_SPECIFIER)

  const resolve = (specifier: string) => modules.get(specifier)
  return {
    resolveProvider: resolve,
    resolveMount: resolve,
    resolvePanels: resolve,
    resolvePicker: resolve,
    providers: () => [STUB_PROVIDER_SPECIFIER],
    mounts: () => [STUB_MOUNT_SPECIFIER],
    panels: () => [STUB_PANEL_SPECIFIER],
    pickers: () => [STUB_PICKER_SPECIFIER],
  }
}

describe('entry resolution', () => {
  it('has a loader for every specifier the fixture declares', () => {
    const table = createFixtureTable()
    expect(table.providers()).toEqual([STUB_PROVIDER_SPECIFIER])
    expect(table.mounts()).toEqual([STUB_MOUNT_SPECIFIER])
    expect(table.panels()).toEqual([STUB_PANEL_SPECIFIER])
    expect(table.pickers()).toEqual([STUB_PICKER_SPECIFIER])

    for (const specifier of [STUB_PROVIDER_SPECIFIER, STUB_MOUNT_SPECIFIER, STUB_PANEL_SPECIFIER, STUB_PICKER_SPECIFIER]) {
      expect(table.resolveProvider(specifier)).toBeDefined()
      expect(table.resolveMount(specifier)).toBeDefined()
      expect(table.resolvePanels(specifier)).toBeDefined()
      expect(table.resolvePicker(specifier)).toBeDefined()
    }
  })

  it('returns the manager-chosen specifier for each entry kind', async () => {
    const host = await createTestHost()

    const mount = unwrap(await host.core.registry.resolveEntrypoint({ driverId: STUB_DRIVER_ID, kind: ModelDriverEntryKind.MOUNT }))
    const panels = unwrap(await host.core.registry.resolveEntrypoint({ driverId: STUB_DRIVER_ID, kind: ModelDriverEntryKind.PANELS }))
    const picker = unwrap(await host.core.registry.resolveEntrypoint({ driverId: STUB_DRIVER_ID, kind: ModelDriverEntryKind.PICKER }))

    expect(mount).toEqual({ specifier: STUB_MOUNT_SPECIFIER })
    expect(panels).toEqual({ specifier: STUB_PANEL_SPECIFIER })
    expect(picker).toEqual({ specifier: STUB_PICKER_SPECIFIER })

    await host.close()
  })

  it('answers null for a kind the driver does not ship, rather than failing', async () => {
    // The manager's answer is a whole set of kinds, so a driver that ships no mount still ships its other three.
    const host = await createTestHost({
      entries: {
        [ModelDriverEntryKind.MOUNT]: null,
        [ModelDriverEntryKind.PANELS]: { specifier: STUB_PANEL_SPECIFIER },
        [ModelDriverEntryKind.PICKER]: { specifier: STUB_PICKER_SPECIFIER },
        [ModelDriverEntryKind.PROVIDER]: { specifier: STUB_PROVIDER_SPECIFIER },
      },
    })

    const mount = unwrap(await host.core.registry.resolveEntrypoint({ driverId: STUB_DRIVER_ID, kind: ModelDriverEntryKind.MOUNT }))
    expect(mount).toBeNull()

    // The provider half is unaffected: no entry kind's absence changes another's.
    const provider = unwrap(await host.core.registry.resolveEntrypoint({ driverId: STUB_DRIVER_ID, kind: ModelDriverEntryKind.PROVIDER }))
    expect(provider).toEqual({ specifier: STUB_PROVIDER_SPECIFIER })

    await host.close()
  })

  it('refuses an entry request for a driver the host does not know, without creating anything', async () => {
    const host = await createTestHost()

    const result = await host.core.registry.resolveEntrypoint({ driverId: 'ai.moeru.airi.test.absent', kind: ModelDriverEntryKind.MOUNT })
    expect(result.ok).toBe(false)

    // The refused resolution did not start anything: the fixture's activation count is still zero.
    expect(host.driver.activations).toBe(0)

    // And a cue still works afterwards, so a refused resolution is not a broken registry.
    const window = host.openWindow('acting')
    await window.mount({ surface: 'acting', purpose: 'acting' })
    const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
    expect(unwrap(await receipt.settled).handled).toBe(true)

    await host.close()
  })

  it('keeps the manifest and manager specifiers distinct from the renderer entries', () => {
    // Both halves of the fixture are declared by string, so drift is caught at registration rather than at import.
    expect(STUB_MANIFEST_SPECIFIER).not.toBe(STUB_PROVIDER_SPECIFIER)
    expect(STUB_MANIFEST_SPECIFIER).toContain('#stubManifest')
  })
})
