/**
 * The renderer's loader table (§4.7 step 4).
 *
 * **This is the only place in the renderer that imports a driver package.** A driver's manager — in main — names
 * a specifier, and the adapter imports exactly that one from here. The indirection is the point: one table can be
 * audited, a `specifier → import` map cannot be forged by a manager, and an unknown specifier is a refusal with a
 * readable reason instead of a dynamic import of something unchecked.
 *
 * Phase 1 had one entry — the stub provider — because the only renderer entry a window ever hosted was the
 * provider half. Phase 2 adds the three surfaces it mounts: the **mount** component, the **panels** declarations
 * and the **picker** component. They come from the fixture's `./testing/components` subpath rather than
 * `./testing` because they import Vue, and the SDK's Node suites import `./testing`.
 *
 * A real driver adds its six subpaths here when its package lands (Phase 3+); its specifiers join
 * `shared/model-driver-specifiers.ts` at the same time, which is what keeps main's static table and this one from
 * drifting.
 *
 * The interface itself — `DriverLoaderTable` and the module shapes it resolves — is the contract package's
 * (`@proj-airi/stage-renderer-sdk`, `host/loaders.ts`). What a build ships is app policy; what a table *is* is
 * not.
 */
import type { DriverLoaderTable, DriverProviderModule } from '@proj-airi/stage-renderer-sdk'

import {
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
 * `includeStub` is `import.meta.env.DEV` at the one call site: a production renderer bundle must not carry the
 * fixture, and a dynamic `import()` inside a guarded entry means the chunk is never fetched even when it exists.
 */
export function firstPartyDriverLoaders(options: { includeStub: boolean }): DriverLoaderTable {
  const providers = new Map<string, () => Promise<DriverProviderModule>>()
  const mounts = new Map<string, () => Promise<import('@proj-airi/stage-renderer-sdk').RendererMountComponentModule>>()
  const panels = new Map<string, () => Promise<import('@proj-airi/stage-renderer-sdk').DriverPanelsModule>>()
  const pickers = new Map<string, () => Promise<import('@proj-airi/stage-renderer-sdk').ModelPickerComponentModule>>()

  if (options.includeStub) {
    providers.set(STUB_PROVIDER_SPECIFIER, () => import('./stub-entry'))
    mounts.set(STUB_MOUNT_SPECIFIER, async () => (await stubComponents()).stubMountModule)
    panels.set(STUB_PANEL_SPECIFIER, async () => (await stubComponents()).stubPanelsModule)
    pickers.set(STUB_PICKER_SPECIFIER, async () => (await stubComponents()).stubPickerModule)
  }

  return {
    resolveProvider: specifier => providers.get(specifier),
    resolveMount: specifier => mounts.get(specifier),
    resolvePanels: specifier => panels.get(specifier),
    resolvePicker: specifier => pickers.get(specifier),
    providers: () => [...providers.keys()],
    mounts: () => [...mounts.keys()],
    panels: () => [...panels.keys()],
    pickers: () => [...pickers.keys()],
  }
}

/** The table every window in a development build uses. */
// `?.` because `import.meta.env` only exists under Vite: a plain Node import of this module (a script, or a test
// runner that does not use Vite's define) must see "not a dev build" rather than throw.
export const driverLoaders: DriverLoaderTable = firstPartyDriverLoaders({ includeStub: import.meta.env?.DEV ?? false })
