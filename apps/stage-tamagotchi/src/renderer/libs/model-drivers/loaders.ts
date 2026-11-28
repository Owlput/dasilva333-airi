/**
 * The renderer's loader table (§4.7 step 4).
 *
 * **This is the only place in the renderer that loads a driver's code.** A driver's manager — in main — names a
 * specifier, and the adapter imports exactly that one from here. The indirection is the point: one table can be
 * audited, a `specifier → import` map cannot be forged by a manager, and an unknown specifier is a refusal with a
 * readable reason instead of a dynamic import of something unchecked.
 *
 * Two neighbours are deliberately not routing paths: `./locales.ts` imports a driver's **message records** (data,
 * merged into i18n at startup, P3-D23), and the dev route under `pages/devtools/` imports a driver's components
 * directly so they can be exercised. Neither can serve a `ModelDriverEntryKind`, which is what this table is for.
 *
 * The table is keyed by `ModelDriverEntryKind` and by nothing else: a driver ships one module per kind, and the
 * table does not care whether the module exports a component (mount, picker), declarations (panels), a provider
 * entry (provider) or `createImportEntry` (import). Adding a surface is one row.
 *
 * A real driver adds its subpaths here when its package lands; its specifiers join
 * `shared/model-driver-specifiers.ts` at the same time, which is what keeps main's static table and this one from
 * drifting.
 *
 * The interface itself — `DriverLoaderTable` and the module shapes it resolves — is the contract package's
 * (`@proj-airi/stage-renderer-sdk`, `host/loaders.ts`). What a build ships is app policy; what a table *is* is
 * not.
 */
import type { DriverEntryModuleLoader, DriverLoaderTable, ModelDriverEntryKind } from '@proj-airi/stage-renderer-sdk'

import { ModelDriverEntryKind as EntryKind } from '@proj-airi/stage-renderer-sdk'

import {
  LIVE2D_IMPORT_SPECIFIER,
  LIVE2D_MOUNT_SPECIFIER,
  LIVE2D_PANELS_SPECIFIER,
  LIVE2D_PICKER_SPECIFIER,
  LIVE2D_PROVIDER_SPECIFIER,
  STUB_MOUNT_SPECIFIER,
  STUB_PANEL_SPECIFIER,
  STUB_PICKER_SPECIFIER,
  STUB_PROVIDER_SPECIFIER,
} from '../../../shared/model-driver-specifiers'

/** The fixture's renderer components, loaded lazily so a production build never fetches them. */
function stubComponents() {
  return import('@proj-airi/stage-renderer-sdk/testing/components')
}

/**
 * The first-party loader table.
 *
 * The Live2D entries are unconditional: it is a real driver, not a fixture. They are still lazy, so a window that
 * never mounts Live2D never downloads Pixi or the Cubism-facing mount module, and a settings window that only shows
 * panels never pays for the mount's WebGL code. All five kinds are present because the driver ships all five.
 *
 * `includeStub` is `import.meta.env.DEV` at the one call site: a production renderer bundle must not carry the
 * fixture, and a dynamic `import()` inside a guarded entry means the chunk is never fetched even when it exists.
 */
export function firstPartyDriverLoaders(options: { includeStub: boolean }): DriverLoaderTable {
  const modules = new Map<ModelDriverEntryKind, Map<string, DriverEntryModuleLoader>>()

  const register = (kind: ModelDriverEntryKind, specifier: string, load: DriverEntryModuleLoader) => {
    const forKind = modules.get(kind) ?? new Map<string, DriverEntryModuleLoader>()
    forKind.set(specifier, load)
    modules.set(kind, forKind)
  }

  register(EntryKind.PROVIDER, LIVE2D_PROVIDER_SPECIFIER, () => import('@proj-airi/model-driver-live2d/provider'))
  register(EntryKind.MOUNT, LIVE2D_MOUNT_SPECIFIER, () => import('@proj-airi/model-driver-live2d/mount'))
  register(EntryKind.PANELS, LIVE2D_PANELS_SPECIFIER, () => import('@proj-airi/model-driver-live2d/panels'))
  register(EntryKind.PICKER, LIVE2D_PICKER_SPECIFIER, () => import('@proj-airi/model-driver-live2d/picker'))
  register(EntryKind.IMPORT, LIVE2D_IMPORT_SPECIFIER, () => import('@proj-airi/model-driver-live2d/import'))

  if (options.includeStub) {
    register(EntryKind.PROVIDER, STUB_PROVIDER_SPECIFIER, () => import('./stub-entry'))
    register(EntryKind.MOUNT, STUB_MOUNT_SPECIFIER, async () => (await stubComponents()).stubMountModule)
    register(EntryKind.PANELS, STUB_PANEL_SPECIFIER, async () => (await stubComponents()).stubPanelsModule)
    register(EntryKind.PICKER, STUB_PICKER_SPECIFIER, async () => (await stubComponents()).stubPickerModule)
  }

  return {
    resolve: (kind, specifier) => modules.get(kind)?.get(specifier),
    specifiers: kind => [...(modules.get(kind)?.keys() ?? [])],
  }
}

/** The table every window in a development build uses. */
// `?.` because `import.meta.env` only exists under Vite: a plain Node import of this module (a script, or a test
// runner that does not use Vite's define) must see "not a dev build" rather than throw.
export const driverLoaders: DriverLoaderTable = firstPartyDriverLoaders({ includeStub: import.meta.env?.DEV ?? false })
