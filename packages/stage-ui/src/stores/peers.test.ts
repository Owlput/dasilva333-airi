import type { SameAccountDevice } from '@proj-airi/stage-shared'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getLocalMachineId, usePeersStore } from './peers'

vi.mock('../database/repos/peers.repo', () => ({
  peersRepo: {
    loadRoster: vi.fn().mockResolvedValue([]),
    saveRoster: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('peers store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('initializes local device and allows renaming it', async () => {
    const store = usePeersStore()
    await store.init()

    const machineId = getLocalMachineId()
    const local = store.roster.find(p => p.relationship === 'same-account' && (p as SameAccountDevice).machineId === machineId) as SameAccountDevice
    expect(local).toBeDefined()
    const initialAlias = local.alias

    await store.renameLocalDevice('Studio Mac Studio')
    expect(local.alias).toBe('Studio Mac Studio')

    // Trims whitespace
    await store.renameLocalDevice('   Workstation   ')
    expect(local.alias).toBe('Workstation')

    // Ignores empty string
    await store.renameLocalDevice('   ')
    expect(local.alias).toBe('Workstation')
  })
})
