/**
 * `providerOnlyLoaderTable`: the table a host gets when the only renderer entry it has is a provider.
 *
 * This helper is exported from the package root, so it is public API — and until now nothing in the repository called
 * it, which made it an unexercised export rather than dead code (the in-process harness builds its own table). These
 * cases are its contract: the four entry kinds answer "this build ships none" as `undefined`, and a specifier the
 * build does not contain is the same `undefined` the adapter turns into `invalid-entrypoint`.
 */
import { describe, expect, it, vi } from 'vitest'

import { providerOnlyLoaderTable } from './loaders'

const PROVIDER = '@proj-airi/stage-renderer-sdk/host#someProvider'

describe('provider-only loader table', () => {
  it('resolves the providers it was given and nothing else', () => {
    const loader = vi.fn(async () => ({ startProviderEntry: () => ({ onMessage: () => {} }) }))
    const table = providerOnlyLoaderTable(specifier => (specifier === PROVIDER ? loader : undefined), [PROVIDER])

    expect(table.resolveProvider(PROVIDER)).toBe(loader)
    expect(table.resolveProvider('@proj-airi/stage-renderer-sdk/host#missing')).toBeUndefined()
    expect(table.providers()).toEqual([PROVIDER])
  })

  it('ships no mount, panels or picker entry at all', () => {
    const table = providerOnlyLoaderTable(() => undefined, [PROVIDER])

    for (const resolve of [table.resolveMount, table.resolvePanels, table.resolvePicker]) {
      expect(resolve(PROVIDER)).toBeUndefined()
      expect(resolve('anything')).toBeUndefined()
    }

    expect(table.mounts()).toEqual([])
    expect(table.panels()).toEqual([])
    expect(table.pickers()).toEqual([])
  })
})
