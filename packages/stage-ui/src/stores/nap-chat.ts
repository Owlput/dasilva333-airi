import type { Peer } from '@proj-airi/stage-shared'

import { isCompanionAllowedForFriend, isNapChatEligible } from '@proj-airi/stage-shared'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { isUserAway } from './proactivity-telemetry'

export const NAP_CHAT_DEFAULT_THRESHOLD_MIN = 15

export const useNapChatStore = defineStore('nap-chat', () => {
  const napEnabled = ref(true)
  const afkThresholdMinutes = ref(NAP_CHAT_DEFAULT_THRESHOLD_MIN)
  const welcomeBackRecapEnabled = ref(true)
  const firedForIdleSession = ref(false)

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

  return { napEnabled, afkThresholdMinutes, welcomeBackRecapEnabled, firedForIdleSession, selectCandidates, markIdleSessionStarted, shouldDeliverRecap }
})
