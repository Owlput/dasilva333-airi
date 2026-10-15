import type { ProvisioningSession } from './provisioning-session.repo'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { provisioningSessionRepo } from './provisioning-session.repo'

// ROOT CAUSE (Follow-up 2):
// Provisioning checkpoints were keyed per-character (bare `{characterId}`),
// so concurrent provisions across universes of one character collided and a
// background incremental could read a sibling universe's checkpoint. Keys are
// now `{characterId}:{universeId}` with one-way migration from the bare key.
const store = vi.hoisted(() => {
  const map = new Map<string, any>()
  return {
    map,
    getItemRaw: vi.fn(async (key: string) => map.get(key) ?? null),
    setItemRaw: vi.fn(async (key: string, value: any) => {
      map.set(key, JSON.parse(JSON.stringify(value)))
    }),
    removeItem: vi.fn(async (key: string) => {
      map.delete(key)
    }),
  }
})

vi.mock('../storage', () => ({
  storage: {
    getItemRaw: store.getItemRaw,
    setItemRaw: store.setItemRaw,
    removeItem: store.removeItem,
  },
}))

function session(overrides: Partial<ProvisioningSession> = {}): ProvisioningSession {
  return {
    characterId: 'char-1',
    phase: 'chunking',
    chunkSummaries: [],
    sourceDocCount: 0,
    totalChunks: 1,
    completedChunks: 0,
    updatedAt: 1,
    ...overrides,
  }
}

describe('provisioning-session.repo universe scoping', () => {
  beforeEach(() => {
    store.map.clear()
    vi.clearAllMocks()
  })

  it('saves namespaced by universe and stamps universeId', async () => {
    await provisioningSessionRepo.save(session({ universeId: 'cyberpunk-au' }))
    expect(store.map.has('local:memory/provisioning-session/char-1:cyberpunk-au')).toBe(true)
    expect(store.map.get('local:memory/provisioning-session/char-1:cyberpunk-au').universeId).toBe('cyberpunk-au')
  })

  it('defaults missing universeId to global', async () => {
    await provisioningSessionRepo.save(session())
    expect(store.map.has('local:memory/provisioning-session/char-1:global')).toBe(true)
  })

  it('migrates a legacy bare key to :global and deletes the bare key', async () => {
    store.map.set('local:memory/provisioning-session/char-1', session({ universeId: undefined }))
    const item = await provisioningSessionRepo.get('char-1', 'global')
    expect(item?.universeId).toBe('global')
    expect(store.map.has('local:memory/provisioning-session/char-1:global')).toBe(true)
    expect(store.map.has('local:memory/provisioning-session/char-1')).toBe(false)
  })

  it('keeps universes isolated', async () => {
    await provisioningSessionRepo.save(session({ universeId: 'global', completedChunks: 1 }))
    await provisioningSessionRepo.save(session({ universeId: 'cyberpunk-au', completedChunks: 2 }))
    expect((await provisioningSessionRepo.get('char-1', 'global'))?.completedChunks).toBe(1)
    expect((await provisioningSessionRepo.get('char-1', 'cyberpunk-au'))?.completedChunks).toBe(2)
  })

  it('deletes only the namespaced key for non-global universes', async () => {
    await provisioningSessionRepo.save(session({ universeId: 'global' }))
    await provisioningSessionRepo.save(session({ universeId: 'cyberpunk-au' }))
    await provisioningSessionRepo.delete('char-1', 'cyberpunk-au')
    expect(store.map.has('local:memory/provisioning-session/char-1:global')).toBe(true)
    expect(store.map.has('local:memory/provisioning-session/char-1:cyberpunk-au')).toBe(false)
  })
})
