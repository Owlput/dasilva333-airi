import type { Peer } from '@proj-airi/stage-shared'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { peersRepo } from '../database/repos/peers.repo'

const PEERS_SYNC_CHANNEL = 'airi:peers-sync'

function seedRoster(): Peer[] {
  const now = Date.now()
  return [
    {
      id: 'peer-studio-mac',
      alias: 'Studio Mac',
      characterName: 'AIRI',
      relationship: 'same-account',
      trustState: 'trusted',
      lastSeenTimestamp: now,
      endpoints: {},
      machineId: 'studio-mac',
      deviceType: 'desktop',
    },
    {
      id: 'peer-macbook-air',
      alias: 'MacBook Air',
      characterName: 'AIRI',
      relationship: 'same-account',
      trustState: 'trusted',
      lastSeenTimestamp: now - 12 * 60 * 1000,
      endpoints: {},
      machineId: 'macbook-air',
      deviceType: 'laptop',
    },
    {
      id: 'ed25519-kirie-alex',
      alias: 'Alex',
      characterName: 'Kirie',
      relationship: 'external-friend',
      trustState: 'trusted',
      lastSeenTimestamp: now,
      endpoints: { cloudflareWorkerUrl: 'https://alex.workers.dev' },
      shareHandle: 'alex.workers.dev',
      allowedCapabilities: { canNapChat: true, canShareMemories: false, canStreamSensory: false },
      allowedCompanionIds: [],
    },
  ]
}

export const usePeersStore = defineStore('peers', () => {
  const roster = ref<Peer[]>([])
  const isInitialized = ref(false)

  const friends = computed(() => roster.value.filter(p => p.relationship === 'external-friend'))
  const devices = computed(() => roster.value.filter(p => p.relationship === 'same-account'))

  async function init() {
    if (isInitialized.value)
      return
    try {
      const stored = await peersRepo.getRoster()
      roster.value = stored.length > 0 ? stored : seedRoster()
      if (stored.length === 0)
        await peersRepo.saveRoster(roster.value)
    }
    catch {
      roster.value = seedRoster()
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

  return { roster, friends, devices, isInitialized, init, upsertPeer }
})
