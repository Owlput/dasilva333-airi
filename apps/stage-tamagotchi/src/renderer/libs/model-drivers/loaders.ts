/**
 * The renderer's loader table (§4.7 step 4).
 *
 * **This is the only place in the renderer that imports a driver package.** A driver's manager — in main — names
 * a specifier, and the adapter imports exactly that one from here. The indirection is the point: one table can be
 * audited, a `specifier → import` map cannot be forged by a manager, and an unknown specifier is a refusal with a
 * readable reason instead of a dynamic import of something unchecked.
 *
 * Phase 1 has one entry, the stub fixture, and only a development build has it at all (§4.8). A real driver adds
 * its six subpaths here when its package lands (Phase 3+); its `mount`/`panels`/`picker` components join the same
 * table in Phase 2 when the host has frames to put them in.
 *
 * The interface itself — `DriverLoaderTable` and the module shape it resolves — is the contract package's
 * (`@proj-airi/stage-renderer-sdk`, `host/loaders.ts`). What a build ships is app policy; what a table *is* is
 * not.
 */
import type { DriverLoaderTable, DriverProviderModule } from '@proj-airi/stage-renderer-sdk'

import { STUB_PROVIDER_SPECIFIER } from '../../../shared/model-driver-specifiers'

/**
 * The first-party loader table.
 *
 * `includeStub` is `import.meta.env.DEV` at the one call site: a production renderer bundle must not carry the
 * fixture, and a dynamic `import()` inside a guarded entry means the chunk is never fetched even when it exists.
 */
export function firstPartyDriverLoaders(options: { includeStub: boolean }): DriverLoaderTable {
  const providers = new Map<string, () => Promise<DriverProviderModule>>()

  if (options.includeStub)
    providers.set(STUB_PROVIDER_SPECIFIER, () => import('./stub-entry'))

  return {
    resolveProvider: specifier => providers.get(specifier),
    providers: () => [...providers.keys()],
  }
}

/** The table every window in a development build uses. */
// `?.` because `import.meta.env` only exists under Vite: a plain Node import of this module (a script, or a test
// runner that does not use Vite's define) must see "not a dev build" rather than throw.
export const driverLoaders: DriverLoaderTable = firstPartyDriverLoaders({ includeStub: import.meta.env?.DEV ?? false })
