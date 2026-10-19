import type { Peer } from '@proj-airi/stage-shared'

import { isCompanionAllowedForFriend, isNapChatEligible } from '@proj-airi/stage-shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { isUserAway } from './proactivity-telemetry'

export const NAP_CHAT_DEFAULT_THRESHOLD_MIN = 15

export interface NapTurn {
  speaker: string
  text: string
  time: string
}

export interface NapEpisode {
  sessionId: string
  with: {
    characterName: string
    alias: string
    avatarUrl?: string
  }
  turnCount: number
  summary: string
  timestamp: number
  journalEntryId: string
  turns: NapTurn[]
}

export const useNapChatStore = defineStore('nap-chat', () => {
  const napEnabled = ref(true)
  const afkThresholdMinutes = ref(NAP_CHAT_DEFAULT_THRESHOLD_MIN)
  const welcomeBackRecapEnabled = ref(true)
  const firedForIdleSession = ref(false)

  const latestEpisode = ref<NapEpisode | null>({
    sessionId: 'nap-sess-7b2a',
    with: {
      characterName: 'Kirie',
      alias: 'Alex',
    },
    turnCount: 4,
    summary: 'Compared notes on a rainy afternoon and traded ideas for the café.',
    timestamp: Date.now() - 42 * 60 * 1000,
    journalEntryId: 'ltmm-entry-10492',
    turns: [
      {
        speaker: 'AIRI',
        text: 'Hey Kirie! Richard just stepped away from his desk. Are you guys still compiling the shaders?',
        time: '14:20',
      },
      {
        speaker: 'Kirie',
        text: 'Hi AIRI! Yeah, Alex is experimenting with IS-Net background removal right now. The pipeline latency dropped by 40%.',
        time: '14:21',
      },
      {
        speaker: 'AIRI',
        text: 'That’s awesome! I’ll make sure to note that down for Richard when he gets back.',
        time: '14:21',
      },
      {
        speaker: 'Kirie',
        text: 'Great! Also tell him we loved the rainy day café scene he configured.',
        time: '14:22',
      },
    ],
  })

  function selectCandidates(roster: Peer[], companionId: string, currentIdleSec?: number): Peer[] {
    if (!napEnabled.value)
      return []
    if (!isUserAway(currentIdleSec, afkThresholdMinutes.value))
      return []
    return roster.filter(peer => isNapChatEligible(peer) && isCompanionAllowedForFriend(peer, companionId))
  }

  function markIdleSessionStarted() {
    firedForIdleSession.value = false
  }

  function shouldDeliverRecap(): boolean {
    if (!welcomeBackRecapEnabled.value || firedForIdleSession.value)
      return false
    firedForIdleSession.value = true
    return true
  }

  function recordEpisode(episode: NapEpisode) {
    latestEpisode.value = episode
  }

  function formatWelcomeBackRecap(episode?: NapEpisode | null): string {
    const ep = episode !== undefined ? episode : latestEpisode.value
    if (!ep || !ep.with?.characterName)
      return 'NO_REPLY'
    return `While you were away, I had a brief chat with ${ep.with.characterName} about our project notes!`
  }

  return {
    napEnabled,
    afkThresholdMinutes,
    welcomeBackRecapEnabled,
    firedForIdleSession,
    latestEpisode,
    selectCandidates,
    markIdleSessionStarted,
    shouldDeliverRecap,
    recordEpisode,
    formatWelcomeBackRecap,
  }
})
