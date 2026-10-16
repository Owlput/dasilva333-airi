import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStickersStore } from './stickers'

vi.mock('./modules/airi-card', () => ({
  useAiriCardStore: () => ({
    activeCardId: 'default',
    activeCard: {
      extensions: {
        airi: {
          stickers: {},
        },
      },
    },
  }),
}))

describe('useStickersStore - resolveStickerId', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('resolves exact match', () => {
    const store = useStickersStore()
    expect(store.resolveStickerId('airi-happy')).toBe('airi-happy')
    expect(store.resolveStickerId('lupin-warm-smile')).toBe('lupin-warm-smile')
  })

  it('resolves case and underscore/hyphen/space normalization', () => {
    const store = useStickersStore()
    expect(store.resolveStickerId('airi_happy')).toBe('airi-happy')
    expect(store.resolveStickerId('Airi Happy')).toBe('airi-happy')
    expect(store.resolveStickerId('LUPIN_WARM_SMILE')).toBe('lupin-warm-smile')
    expect(store.resolveStickerId('lupin cheer')).toBe('lupin-cheer')
  })

  it('resolves custom stickers with space-delimited names and character prefix', () => {
    const store = useStickersStore()
    store.libraryMetadata.push({
      id: 'character-smug',
      label: 'Character smug',
      addedAt: Date.now(),
      originalName: 'character-smug.png',
      mimeType: 'image/png',
    })
    store.libraryMetadata.push({
      id: 'character-neko',
      label: 'neko',
      addedAt: Date.now(),
      originalName: 'character-neko.png',
      mimeType: 'image/png',
    })

    // Exact space-separated display name
    expect(store.resolveStickerId('Character smug')).toBe('character-smug')
    expect(store.resolveStickerId('Character neko')).toBe('character-neko')

    // Single-word shorthand with 'character' prefix stripped
    expect(store.resolveStickerId('smug')).toBe('character-smug')
    expect(store.resolveStickerId('neko')).toBe('character-neko')
  })

  it('resolves builtin sticker descriptions', () => {
    const store = useStickersStore()
    expect(store.resolveStickerId('Celebration')).toBe('airi-celebrate')
    expect(store.resolveStickerId('Warm Smile')).toBe('lupin-warm-smile')
  })

  it('resolves token-overlap fuzzy matches with character prefix', () => {
    const store = useStickersStore()
    // arona_warm_smile -> [arona, warm, smile] -> strips known prefixes (none for arona) -> [arona, warm, smile]
    // candidates include lupin-warm-smile ([warm, smile] after stripping 'lupin') -> 2 shared tokens -> matches!
    expect(store.resolveStickerId('arona_warm_smile')).toBe('lupin-warm-smile')
    expect(store.resolveStickerId('arona_cheer')).toBe('lupin-cheer')
    expect(store.resolveStickerId('arona_tired')).toBe('airi-tired')
    expect(store.resolveStickerId('arona-thanks')).toBe('airi-thanks')
  })

  it('returns undefined for empty or non-matching inputs with no overlap', () => {
    const store = useStickersStore()
    expect(store.resolveStickerId('')).toBeUndefined()
    expect(store.resolveStickerId('completely_unrelated_xyz_123')).toBeUndefined()
  })
})
