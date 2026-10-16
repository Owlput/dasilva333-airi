<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { ChatHistory, ChatSessionModal, ChatWorkspaceTerminalPanel, ChatWorkspaceWidgetsPanel } from '@proj-airi/stage-ui/components'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useDeferredMount } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import ChatArea from '../Widgets/ChatArea.vue'
import ChatContainer from '../Widgets/ChatContainer.vue'

export type InteractiveSurfaceTab = 'chat' | 'terminal' | 'widgets'

const props = defineProps<{
  tools?: any[]
}>()

const activeTab = ref<InteractiveSurfaceTab>('chat')
const { isReady } = useDeferredMount()
const { sending } = storeToRefs(useChatOrchestratorStore())
const chatSessionStore = useChatSessionStore()
const { messages, activeSessionId, sessionMetas } = storeToRefs(chatSessionStore)
const { streamingMessage } = storeToRefs(useChatStreamStore())

// --- Timeline picker (moved inside chat header, single home) ---
const isSessionPopoverOpen = ref(false)
const showManageModal = ref(false)

const activeSessionMeta = computed(() => {
  if (!activeSessionId.value)
    return undefined
  return sessionMetas.value[activeSessionId.value]
})

const activeTimelineLabel = computed(() => {
  const meta = activeSessionMeta.value
  if (meta?.title && meta.title !== 'Untitled Timeline')
    return meta.title
  if (activeSessionId.value)
    return chatSessionStore.getSessionDisplayTitle(activeSessionId.value, activeCardId.value)
  return 'Timeline 1'
})

const characterSessions = computed(() => {
  const cardId = activeCardId.value
  const characterIndex = cardId ? chatSessionStore.getCharacterIndex(cardId) : null
  const indexedList = characterIndex
    ? Object.values(characterIndex.sessions).map(s => ({
        ...s,
        messageCount: s.sessionId === activeSessionId.value ? Math.max(s.messageCount || 0, messages.value.length) : (s.messageCount || 0),
      }))
    : []

  const currentId = activeSessionId.value
  if (currentId && !indexedList.some(s => s.sessionId === currentId)) {
    const meta = sessionMetas.value[currentId]
    indexedList.unshift({
      sessionId: currentId,
      userId: 'local',
      characterId: cardId || 'default',
      title: meta?.title,
      messageCount: messages.value.length || 0,
      createdAt: meta?.createdAt || Date.now(),
      updatedAt: meta?.updatedAt || Date.now(),
      universeId: meta?.universeId,
    })
  }

  return indexedList.sort((a, b) => b.updatedAt - a.updatedAt)
})

function formatTimelineTitle(session: { sessionId: string, title?: string }) {
  if (session.title && session.title !== 'Untitled Timeline')
    return session.title
  return chatSessionStore.getSessionDisplayTitle(session.sessionId, activeCardId.value)
}

function handleSelectSession(sessionId: string) {
  chatSessionStore.setActiveSession(sessionId)
  isSessionPopoverOpen.value = false
}

async function handleCreateSession() {
  if (!activeCardId.value)
    return
  const newSessionId = await chatSessionStore.createSession(activeCardId.value)
  chatSessionStore.setActiveSession(newSessionId)
  isSessionPopoverOpen.value = false
}

function handleOpenManage() {
  isSessionPopoverOpen.value = false
  showManageModal.value = true
}

const cardStore = useAiriCardStore()
const { activeCard, activeCardId } = storeToRefs(cardStore)

const hasVirtualTerminal = computed(() => {
  const allowed = activeCard.value?.extensions?.airi?.generation?.known?.allowedTools
  if (allowed && (allowed.includes('bash') || allowed.includes('mcp_bash')))
    return true
  return activeCard.value?.extensions?.airi?.sandbox?.enabled ?? false
})

watch(hasVirtualTerminal, (enabled) => {
  if (!enabled && activeTab.value !== 'chat') {
    activeTab.value = 'chat'
  }
})

const isLoading = ref(true)
const historyMessages = computed(() => messages.value as unknown as ChatHistoryItem[])
</script>

<template>
  <div flex="col" items-center pt-4>
    <div h-full max-h="[85vh]" w-full py="4">
      <ChatContainer>
        <div
          v-if="isLoading"
          absolute left-0 top-0 h-1 w-full overflow-hidden rounded-t-xl
          class="bg-primary-500/20"
        >
          <div h-full w="1/3" origin-left bg-primary-500 class="animate-scan" />
        </div>

        <!-- Top header: timeline picker + surface switcher -->
        <div
          :class="[
            'relative z-10 flex shrink-0 items-center justify-between gap-2',
            'border-b border-primary-500/10 dark:border-white/5',
            'px-3 py-2',
          ]"
        >
          <PopoverRoot v-model:open="isSessionPopoverOpen">
            <PopoverTrigger as-child>
              <button
                type="button"
                :class="[
                  'flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-xl border px-3 py-1 text-xs font-bold transition-all duration-200 ease-in-out',
                  'border-neutral-200/50 bg-neutral-100/30 dark:border-neutral-800 dark:bg-neutral-900/40',
                  'hover:bg-neutral-200/50 hover:dark:bg-neutral-800/40',
                ]"
              >
                <div class="i-solar:notebook-bookmark-bold-duotone size-3.5 shrink-0 text-primary-500" />
                <span class="max-w-36 truncate text-neutral-700 dark:text-neutral-300">{{ activeTimelineLabel }}</span>
                <div class="i-solar:alt-arrow-down-bold shrink-0 text-[10px] text-neutral-400 opacity-60 dark:text-neutral-500" />
              </button>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                side="bottom"
                :side-offset="6"
                align="start"
                :class="[
                  'z-100 w-72 flex flex-col rounded-2xl border p-2.5 shadow-2xl backdrop-blur-xl duration-150',
                  'border-neutral-200/60 bg-white/95 dark:border-neutral-800 dark:bg-neutral-950/95',
                ]"
              >
                <div class="mb-2 flex items-center justify-between border-b border-neutral-200/40 px-1 pb-2 dark:border-neutral-800/40">
                  <div class="flex items-center gap-1.5 text-[10px] text-neutral-500 font-bold tracking-wider uppercase dark:text-neutral-400">
                    <div class="i-solar:history-bold-duotone text-primary-500" />
                    <span>Story Timelines</span>
                  </div>
                  <button
                    type="button"
                    class="flex cursor-pointer items-center gap-1 rounded-lg bg-primary-500/10 px-2 py-0.5 text-[10px] text-primary-600 font-bold transition active:scale-95 hover:bg-primary-500/20 dark:text-primary-400"
                    @click="handleCreateSession"
                  >
                    <div class="i-solar:add-circle-bold size-3" />
                    <span>New Timeline</span>
                  </button>
                </div>

                <div class="max-h-60 overflow-y-auto pr-1 scrollbar-thin space-y-1">
                  <div
                    v-for="session in characterSessions"
                    :key="session.sessionId"
                    class="flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-xs font-medium transition-all duration-150"
                    :class="activeSessionId === session.sessionId
                      ? 'bg-primary-500/10 text-primary-700 font-bold dark:bg-primary-950/50 dark:text-primary-300'
                      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900'"
                    @click="handleSelectSession(session.sessionId)"
                  >
                    <span class="min-w-0 truncate pr-2">{{ formatTimelineTitle(session) }}</span>
                    <span class="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500 font-mono dark:bg-neutral-800 dark:text-neutral-400">
                      {{ session.messageCount || 0 }} msgs
                    </span>
                  </div>
                </div>

                <div class="mt-2 border-t border-neutral-200/40 pt-2 dark:border-neutral-800/40">
                  <button
                    type="button"
                    class="w-full flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-neutral-100/70 py-1.5 text-[10px] text-neutral-600 font-semibold transition active:scale-95 dark:bg-neutral-800/60 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                    @click="handleOpenManage"
                  >
                    <div class="i-solar:settings-bold-duotone size-3.5 text-neutral-400" />
                    <span>Manage All Timelines</span>
                  </button>
                </div>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>

          <div
            v-if="hasVirtualTerminal"
            :class="[
              'flex items-center gap-1 p-0.5 rounded-xl',
              'bg-black/5 dark:bg-white/5 backdrop-blur-md',
            ]"
          >
            <button
              type="button"
              :class="[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all select-none',
                activeTab === 'chat'
                  ? 'bg-white/90 dark:bg-neutral-800/90 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeTab = 'chat'"
            >
              <div class="i-solar:chat-round-dots-bold-duotone size-3.5" />
              <span>Chat</span>
            </button>
            <button
              type="button"
              :class="[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all select-none',
                activeTab === 'terminal'
                  ? 'bg-white/90 dark:bg-neutral-800/90 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeTab = 'terminal'"
            >
              <div class="i-solar:code-square-bold-duotone size-3.5" />
              <span>Terminal</span>
            </button>
            <button
              type="button"
              :class="[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all select-none',
                activeTab === 'widgets'
                  ? 'bg-white/90 dark:bg-neutral-800/90 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeTab = 'widgets'"
            >
              <div class="i-solar:widget-2-bold-duotone size-3.5" />
              <span>Widgets</span>
            </button>
          </div>
        </div>

        <!-- Surface 1: Chat Transcript & Composer -->
        <template v-if="activeTab === 'chat' || !hasVirtualTerminal">
          <div w="full" max-h="<md:[60%]" py="<sm:2" flex="~ col" rounded="lg" px="2 <md:0" relative h-full min-h-0 flex-1 overflow-hidden py-4>
            <ChatHistory
              v-if="isReady"
              :messages="historyMessages"
              :sending="sending"
              :streaming-message="streamingMessage"
              h-full
              variant="desktop"
              @vue:mounted="isLoading = false"
            />
          </div>
          <ChatArea :tools="props.tools" />
        </template>

        <!-- Surface 2: Terminal View -->
        <div
          v-else-if="activeTab === 'terminal'"
          :class="[
            'min-h-0 flex-1 flex flex-col overflow-hidden',
            'w-full h-full',
          ]"
        >
          <ChatWorkspaceTerminalPanel fill-container class="h-full w-full" />
        </div>

        <!-- Surface 3: Widgets View -->
        <div
          v-else-if="activeTab === 'widgets'"
          :class="[
            'min-h-0 flex-1 flex flex-col overflow-hidden',
            'w-full h-full',
          ]"
        >
          <ChatWorkspaceWidgetsPanel fill-container class="h-full w-full" />
        </div>

        <ChatSessionModal v-model="showManageModal" />
      </ChatContainer>
    </div>
  </div>
</template>

<style scoped>
@keyframes scan {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}

.animate-scan {
  animation: scan 2s infinite linear;
}
</style>
