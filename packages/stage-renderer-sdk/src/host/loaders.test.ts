/**
 * `providerOnlyLoaderTable`: the table a host gets when the only renderer entry it has is a provider.
 *
 * This helper is exported from the package root, so it is public API — and until now nothing in the repository called
 * it, which made it an unexercised export rather than dead code (the in-process harness builds its own table). These
 * cases are its contract: every other entry kind answers "this build ships none" as `undefined`, and a specifier the
 * build does not contain is the same `undefined` the adapter turns into `invalid-entrypoint`.
 */
import { describe, expect, it } from 'vitest'

import { ModelDriverEntryKind } from '../contract/registry'
import { providerOnlyLoaderTable } from './loaders'

const PROVIDER = '@proj-airi/stage-renderer-sdk/host#someProvider'

describe('provider-only loader table', () => {
  it('resolves the providers it was given and nothing else', () => {
    const loader = async () => ({ startProviderEntry: () => ({ onMessage: () => {} }) })
    const table = providerOnlyLoaderTable(specifier => (specifier === PROVIDER ? loader : undefined), [PROVIDER])

    expect(table.resolve(ModelDriverEntryKind.PROVIDER, PROVIDER)).toBe(loader)
    expect(table.resolve(ModelDriverEntryKind.PROVIDER, '@proj-airi/stage-renderer-sdk/host#missing')).toBeUndefined()
    expect(table.specifiers(ModelDriverEntryKind.PROVIDER)).toEqual([PROVIDER])
  })

  it('ships no mount, panels, picker or import entry at all', () => {
    const table = providerOnlyLoaderTable(() => undefined, [PROVIDER])

    for (const kind of [
      ModelDriverEntryKind.MOUNT,
      ModelDriverEntryKind.PANELS,
      ModelDriverEntryKind.PICKER,
      ModelDriverEntryKind.IMPORT,
    ]) {
      expect(table.resolve(kind, PROVIDER)).toBeUndefined()
      expect(table.resolve(kind, 'anything')).toBeUndefined()
      expect(table.specifiers(kind)).toEqual([])
    }
  })
})
