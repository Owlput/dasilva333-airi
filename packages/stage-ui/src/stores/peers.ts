import type { Peer, SameAccountDevice, VaultDeviceMap } from '@proj-airi/stage-shared'

import { mergeSameAccountDevices, toVaultDeviceMap } from '@proj-airi/stage-shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { peersRepo } from '../database/repos/peers.repo'

const PEERS_SYNC_CHANNEL = 'airi:peers-sync'
const MOCK_SEED_IDS = new Set(['peer-studio-mac', 'peer-macbook-air', 'ed25519-kirie-alex'])

export function getLocalMachineId(): string {
  if (typeof localStorage === 'undefined')
    return 'local-machine'
  const key = 'airi:peers:local-machine-id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = `machine-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(key, id)
  }
  return id
}

export function createLocalDevice(): SameAccountDevice {
  const machineId = getLocalMachineId()
  return {
    id: `peer-${machineId}`,
    alias: 'This device',
    characterName: 'AIRI',
    relationship: 'same-account',
    trustState: 'trusted',
    lastSeenTimestamp: Date.now(),
    endpoints: {},
    machineId,
    deviceType: 'desktop',
  }
}

export const usePeersStore = defineStore('peers', () => {
  const roster = ref<Peer[]>([])
  const isInitialized = ref(false)

  const friends = computed(() => roster.value.filter(p => p.relationship === 'external-friend'))
  const devices = computed(() => roster.value.filter(p => p.relationship === 'same-account'))

  const currentMachineId = computed(() => getLocalMachineId())

  async function init() {
    if (isInitialized.value)
      return
    try {
      const stored = await peersRepo.getRoster()
      // Filter out any legacy prototype mock seeds if they were previously persisted
      const cleaned = (stored || []).filter(p => !MOCK_SEED_IDS.has(p.id))

      // Ensure local machine device is registered in the roster
      const machineId = getLocalMachineId()
      const hasCurrent = cleaned.some(p => p.relationship === 'same-account' && (p as SameAccountDevice).machineId === machineId)
      if (!hasCurrent) {
        cleaned.unshift(createLocalDevice())
      }

      roster.value = cleaned
      await peersRepo.saveRoster(roster.value)
    }
    catch {
      roster.value = [createLocalDevice()]
    }
    finally {
      isInitialized.value = true
    }
  }

  async function persist() {
    await peersRepo.saveRoster(roster.value)
    try {
      new BroadcastChannel(PEERS_SYNC_CHANNEL).postMessage({ type: 'peers-updated', at: Date.now() })
    }
    catch {
      // NOTICE: BroadcastChannel unavailable in some test / SSR contexts.
    }
  }

  async function upsertPeer(peer: Peer) {
    if (!isInitialized.value)
      await init()
    const idx = roster.value.findIndex(p => p.id === peer.id)
    if (idx >= 0)
      roster.value[idx] = peer
    else roster.value.push(peer)
    await persist()
  }

  function toVaultDeviceMapForSync(): VaultDeviceMap {
    return toVaultDeviceMap(roster.value.filter(p => p.relationship === 'same-account') as SameAccountDevice[])
  }

  async function mergeVaultDevices(vaultDevices: VaultDeviceMap) {
    if (!isInitialized.value)
      await init()
    const localDevices = roster.value.filter(p => p.relationship === 'same-account') as SameAccountDevice[]
    const mergedDevices = mergeSameAccountDevices(localDevices, vaultDevices)
    const friends = roster.value.filter(p => p.relationship !== 'same-account')
    roster.value = [...mergedDevices, ...friends]
    await persist()
  }

  return {
    roster,
    friends,
    devices,
    isInitialized,
    currentMachineId,
    init,
    upsertPeer,
    toVaultDeviceMapForSync,
    mergeVaultDevices,
  }
})
