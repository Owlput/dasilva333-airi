import type { Ref } from 'vue'

import type { GroundingMessage } from '../stores/chat/grounding-assembler'

import { watchDebounced } from '@vueuse/core'
import { computed, ref, unref, watch } from 'vue'

import { formatSemanticMemoriesBlock } from '../stores/chat/grounding-assembler'
import { useChatSessionStore } from '../stores/chat/session-store'
import { useTextJournalStore } from '../stores/memory-text-journal'
import { useAiriCardStore } from '../stores/modules/airi-card'

export interface PreFlightMemoryItem {
  id: string
  title: string
  kind: string
  content: string
  timestamp?: string
  score?: number
  subGoal?: string
}

export interface PreFlightKgFact {
  id: string
  subject: string
  predicate: string
  object: string
  dateLabel?: string
  content?: string
  score?: number
}

export interface UsePreFlightGroundingOptions {
  messageInput: Ref<string>
  activeCardId?: Ref<string | undefined>
  debounceMs?: number
  evidenceLimit?: number
}

export function usePreFlightGrounding(options: UsePreFlightGroundingOptions) {
  const {
    messageInput,
    activeCardId,
    debounceMs = 2000,
    evidenceLimit = 6,
  } = options

  const airiCardStore = useAiriCardStore()
  const textJournalStore = useTextJournalStore()
  const chatSessionStore = useChatSessionStore()

  const memories = ref<PreFlightMemoryItem[]>([])
  const kgFacts = ref<PreFlightKgFact[]>([])
  const rawResults = ref<any[]>([])
  const isSearching = ref(false)
  let activeAbortController: AbortController | null = null

  const isMemoryEnabled = computed(() => {
    const card = unref(airiCardStore.activeCard)
    return Boolean(
      card?.extensions?.airi?.groundingMemoryEnabled
      || card?.extensions?.airi?.universeRag?.enabled
      || card?.extensions?.airi?.firstHopProcessor === 'universe_rag'
      || card?.extensions?.airi?.cognition?.searchEngine?.universeRagEnabled,
    )
  })

  async function executeSearch(query: string) {
    const trimmed = query.trim()
    activeAbortController?.abort()
    activeAbortController = null

    if (!isMemoryEnabled.value || trimmed.length <= 3) {
      memories.value = []
      kgFacts.value = []
      rawResults.value = []
      return
    }

    const controller = new AbortController()
    activeAbortController = controller

    const charId = unref(activeCardId) ?? unref(airiCardStore.activeCardId)
    isSearching.value = true
    try {
      const lastGrounded = chatSessionStore.getLastGroundedTurn()
      const sessionMessages = chatSessionStore.sessionMessages[chatSessionStore.activeSessionId] || []
      const lastMsg = sessionMessages.length > 0 ? sessionMessages[sessionMessages.length - 1] : undefined
      const previousTurnText = typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : Array.isArray(lastMsg?.content)
          ? (lastMsg.content as any[]).map(p => p?.text || '').join(' ')
          : undefined

      const results = await textJournalStore.searchEntries({
        query: trimmed,
        limit: Math.max(12, evidenceLimit * 2),
        characterId: charId,
        previousTurn: previousTurnText,
        previousGrounding: lastGrounded?.grounding,
        signal: controller.signal,
      })

      if (controller.signal.aborted)
        return

      const nextMemories: PreFlightMemoryItem[] = []
      const nextKgFacts: PreFlightKgFact[] = []
      const stagedItems: any[] = []

      // Balanced quota allocation: separate quotas for S-P-O claims vs dialogue scene mentions
      // so verified facts and grounded dialogue scenes never starve each other.
      const maxClaims = Math.max(3, Math.floor(evidenceLimit / 2))
      const maxMentions = Math.max(5, evidenceLimit)
      let claimCount = 0
      let mentionCount = 0

      for (const rawItem of results) {
        const item = rawItem as any
        const isMention = item.id?.startsWith('kg-mention:')
        const isClaim = (item.isKgClaim || item.kind === 'kg_claim' || item.id?.startsWith('claim:')) && !isMention
        const isKg = isClaim || isMention || item.id?.startsWith('kg-')

        if (isKg && item.subject) {
          const canAdd = isClaim ? (claimCount < maxClaims) : (mentionCount < maxMentions)
          if (canAdd) {
            if (isClaim)
              claimCount++
            else
              mentionCount++

            nextKgFacts.push({
              id: item.id,
              subject: item.subject,
              predicate: item.predicate || 'associated with',
              object: item.object || 'dialogue',
              dateLabel: item.dateInfo?.formatted_label || (item.timestamp ? String(item.timestamp).split('T')[0] : undefined),
              content: item.content,
              score: item.score,
            })
            stagedItems.push(rawItem)
          }
        }
        else {
          if (nextMemories.length < evidenceLimit) {
            nextMemories.push({
              id: item.id,
              title: item.title || 'Memory',
              kind: item.kind || 'Journal',
              content: item.content,
              timestamp: item.timestamp ? String(item.timestamp) : undefined,
              score: item.score,
              subGoal: item.subGoal,
            })
            stagedItems.push(rawItem)
          }
        }
      }

      rawResults.value = stagedItems
      memories.value = nextMemories
      kgFacts.value = nextKgFacts
    }
    catch (err) {
      if ((err as Error)?.name === 'AbortError')
        return
      console.error('[usePreFlightGrounding] Search failed:', err)
      memories.value = []
      kgFacts.value = []
      rawResults.value = []
    }
    finally {
      if (activeAbortController === controller) {
        isSearching.value = false
      }
    }
  }

  watchDebounced(
    messageInput,
    (val) => {
      void executeSearch(val)
    },
    { debounce: debounceMs },
  )

  watch(
    () => isMemoryEnabled.value,
    (enabled) => {
      if (!enabled) {
        clear()
      }
      else if (messageInput.value.trim().length > 3) {
        void executeSearch(messageInput.value)
      }
    },
  )

  function clear() {
    activeAbortController?.abort()
    activeAbortController = null
    memories.value = []
    kgFacts.value = []
    rawResults.value = []
  }

  // Pre-compiled system message payload guaranteeing 1:1 WYSIWYG parity with the preview
  const stagedGroundingPayload = computed<GroundingMessage | null>(() => {
    if (rawResults.value.length === 0)
      return null
    return formatSemanticMemoriesBlock(rawResults.value)
  })

  const hasGroundingHits = computed(() => memories.value.length > 0 || kgFacts.value.length > 0)

  return {
    memories,
    kgFacts,
    rawResults,
    isSearching,
    isMemoryEnabled,
    stagedGroundingPayload,
    hasGroundingHits,
    search: executeSearch,
    clear,
  }
}
