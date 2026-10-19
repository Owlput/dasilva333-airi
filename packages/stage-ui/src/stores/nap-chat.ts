import type { Peer } from '@proj-airi/stage-shared'

import { isCompanionAllowedForFriend, isNapChatEligible } from '@proj-airi/stage-shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { isUserAway } from './proactivity-telemetry'

export const NAP_CHAT_DEFAULT_THRESHOLD_MIN = 15

export const DEFAULT_SOCIAL_PROMPT_GUIDANCE
  = 'Be casual, friendly, and enthusiastic. Discuss our shared creative and coding projects while keeping private user personal details confidential.'

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
  const socialPromptGuidance = ref(DEFAULT_SOCIAL_PROMPT_GUIDANCE)

  // NOTICE: No prototype seed. Episodes are recorded by the nap-chat coordinator
  // after a real autonomous session; the UI renders its empty state until then.
  const latestEpisode = ref<NapEpisode | null>(null)

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
    socialPromptGuidance,
    latestEpisode,
    selectCandidates,
    markIdleSessionStarted,
    shouldDeliverRecap,
    recordEpisode,
    formatWelcomeBackRecap,
  }
})
