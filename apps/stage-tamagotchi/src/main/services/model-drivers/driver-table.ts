/**
 * The static first-party driver table (§4.2 step 1).
 *
 * This table is the *only* place main is allowed to learn about a driver module, and it is deliberately a
 * literal rather than something discovered: main never dynamically imports an unchecked specifier, so a
 * package cannot become executable merely by existing on disk. The declarations are read (and validated)
 * before the managers are loaded, which is what makes "declare before you run" true rather than aspirational.
 *
 * **Phase 1 shipped the stub driver only. Phase 3 adds the first real driver, Live2D.** The remaining formats
 * arrive one per phase; adding one is the whole of the registration step.
 *
 * The stub is dev-only. It is a fixture — a complete fake of the other half of the contract, now part of the
 * SDK's `./testing` subpath (P1-D27) — and shipping it as a production driver would put a model list nobody
 * asked for in front of a user. A real driver is registered unconditionally.
 */
import type { DriverTableEntry } from '@proj-airi/stage-renderer-sdk/host'

import { ModelDriverEntryKind } from '@proj-airi/stage-renderer-sdk'

import {
  LIVE2D_DRIVER_ID,
  LIVE2D_MANAGER_SPECIFIER,
  LIVE2D_MANIFEST_SPECIFIER,
  STUB_DRIVER_ID,
  STUB_MANAGER_SPECIFIER,
  STUB_MANIFEST_SPECIFIER,
  STUB_MOUNT_SPECIFIER,
  STUB_PANEL_SPECIFIER,
  STUB_PICKER_SPECIFIER,
  STUB_PROVIDER_SPECIFIER,
} from '../../../shared/model-driver-specifiers'

export function firstPartyDriverTable(options: { includeStub: boolean }): DriverTableEntry[] {
  return [
    live2dDriverEntry(),
    ...(options.includeStub ? [stubDriverEntry()] : []),
  ]
}

/**
 * The real Live2D driver.
 *
 * Both loaders stay lazy: reading the declaration must not execute the manager module, and main never imports the
 * renderer half at all — the manager names the provider/mount specifiers and a renderer's loader table resolves
 * them (D2).
 */
function live2dDriverEntry(): DriverTableEntry {
  return {
    driverId: LIVE2D_DRIVER_ID,
    manifestSpecifier: LIVE2D_MANIFEST_SPECIFIER,
    managerSpecifier: LIVE2D_MANAGER_SPECIFIER,

    loadManifest: async () => (await import('@proj-airi/model-driver-live2d/manifest')).LIVE2D_MANIFEST,

    loadManager: async () => (await import('@proj-airi/model-driver-live2d/manager')).createManager,
  }
}

function stubDriverEntry(): DriverTableEntry {
  return {
    driverId: STUB_DRIVER_ID,
    manifestSpecifier: STUB_MANIFEST_SPECIFIER,
    managerSpecifier: STUB_MANAGER_SPECIFIER,

    // Both loaders are lazy on purpose: reading the declaration must not also execute the manager module, and
    // a build that never opens the stub route never loads either.
    loadManifest: async () => {
      const fixture = await import('@proj-airi/stage-renderer-sdk/testing')
      return fixture.STUB_MANIFEST
    },

    loadManager: async () => {
      const fixture = await import('@proj-airi/stage-renderer-sdk/testing')
      // Main keeps its own fixture state: the window half has a different one, and they talk only through the
      // manager channel, exactly as a real driver split across processes does.
      return fixture.createStubManagerFactory({
        state: fixture.createStubDriverState(),
        entries: {
          [ModelDriverEntryKind.PROVIDER]: { specifier: STUB_PROVIDER_SPECIFIER },
          [ModelDriverEntryKind.MOUNT]: { specifier: STUB_MOUNT_SPECIFIER },
          [ModelDriverEntryKind.PANELS]: { specifier: STUB_PANEL_SPECIFIER },
          [ModelDriverEntryKind.PICKER]: { specifier: STUB_PICKER_SPECIFIER },
        },
      })
    },
  }
}
