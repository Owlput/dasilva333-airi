<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'

import { useShortTermMemoryStore } from '../../../stores/memory-short-term'
import { useAiriCardStore } from '../../../stores/modules/airi-card'

const props = withDefaults(defineProps<{
  /** Whether to show the cache status section (rebuild buttons, etc) */
  showCacheStatus?: boolean
  /** Tooltip for the main button */
  title?: string
  /** Variant of the trigger button */
  variant?: 'default' | 'mobile'
}>(), {
  showCacheStatus: true,
  title: 'Memory & context',
  variant: 'default',
})

const emit = defineEmits<{
  (e: 'view-context'): void
  (e: 'manage-sessions'): void
  (e: 'search-memories'): void
  (e: 'clear-messages'): void
  (e: 'open-studio'): void
  (e: 'open-memory-settings'): void
  (e: 'open-card-settings'): void
}>()

const shortTermMemory = useShortTermMemoryStore()
const airiCardStore = useAiriCardStore()
const { activeCardId } = storeToRefs(airiCardStore)

const isOpen = ref(false)
const isRebuildingToday = ref(false)
const isRebuildingHistory = ref(false)

const activeCard = computed(() => {
  if (!activeCardId.value)
    return undefined
  return airiCardStore.getCard(activeCardId.value)
})

const isShortTermMemoryEnabled = computed(() => {
  if (!activeCard.value)
    return true
  return activeCard.value.extensions?.airi?.shortTermMemory?.enabled ?? true
})

async function handleCacheToday() {
  if (!activeCardId.value || isRebuildingToday.value)
    return
  isRebuildingToday.value = true
  try {
    await shortTermMemory.rebuildToday(activeCardId.value)
  }
  finally {
    isRebuildingToday.value = false
  }
}

async function handleRebuildFromHistory() {
  if (!activeCardId.value || isRebuildingHistory.value)
    return
  isRebuildingHistory.value = true
  try {
    await shortTermMemory.rebuildFromHistory(activeCardId.value)
  }
  finally {
    isRebuildingHistory.value = false
  }
}

function navigateToMemory() {
  emit('open-memory-settings')
}

function navigateToCardSettings() {
  emit('open-card-settings')
}
</script>

<template>
  <PopoverRoot v-model:open="isOpen">
    <PopoverTrigger as-child>
      <button
        v-if="variant === 'mobile'"
        class="w-fit flex items-center justify-center border-2 border-neutral-100/60 rounded-xl border-solid bg-neutral-50/70 p-2 backdrop-blur-md transition-all active:scale-95 dark:border-neutral-800/30 dark:bg-neutral-800/70"
        :title="title"
      >
        <div class="i-solar:history-bold-duotone size-5 text-neutral-500 dark:text-neutral-400" />
      </button>
      <button
        v-else
        class="flex cursor-pointer items-center justify-center rounded-xl p-1.5 text-neutral-500 transition-colors duration-200 ease-in-out hover:bg-neutral-200 dark:text-neutral-400 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        :title="title"
      >
        <div class="i-solar:history-bold-duotone text-base" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="bottom"
        :side-offset="8"
        align="end"
        :class="[
          'animate-in fade-in zoom-in-95 z-100 duration-150',
          'w-80 border border-neutral-200/80 rounded-2xl bg-white/95 p-3.5 shadow-2xl backdrop-blur-xl',
          'dark:border-neutral-800 dark:bg-neutral-900/95',
          'flex flex-col gap-3',
        ]"
      >
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-neutral-100 pb-1 dark:border-neutral-800/80">
          <div class="flex items-center gap-2">
            <div class="i-solar:database-bold-duotone text-lg text-neutral-800 dark:text-neutral-100" />
            <span class="text-sm text-neutral-900 font-bold font-sans-rounded dark:text-neutral-100">Memory &amp; context</span>
          </div>
          <button
            type="button"
            class="flex cursor-pointer items-center justify-center rounded-full p-0.5 text-neutral-400 transition-colors dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
            aria-label="Close"
            @click="isOpen = false"
          >
            <div class="i-solar:close-circle-linear text-lg" />
          </button>
        </div>

        <!-- Section 1: INSPECT -->
        <div class="flex flex-col gap-0.5">
          <div class="px-1 pb-1 text-[10px] text-neutral-400 font-semibold tracking-wider uppercase dark:text-neutral-500">
            INSPECT
          </div>

          <!-- View system prompt -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
            ]"
            @click="emit('view-context'); isOpen = false"
          >
            <div class="flex items-center gap-3">
              <div class="i-solar:document-text-linear shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">View system prompt</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Read-only prompt viewer</span>
              </div>
            </div>
            <div class="i-solar:alt-arrow-right-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
          </button>

          <!-- Search memories -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
            ]"
            @click="emit('search-memories'); isOpen = false"
          >
            <div class="flex items-center gap-3">
              <div class="i-solar:magnifer-linear shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Search memories</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Find remembered context</span>
              </div>
            </div>
            <div class="i-solar:alt-arrow-right-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
          </button>
        </div>

        <!-- Section 2: RECENT MEMORY (Hidden if Short-Term Memory is disabled) -->
        <div v-if="isShortTermMemoryEnabled" class="flex flex-col gap-0.5">
          <div class="flex flex-col px-1 pb-1">
            <span class="text-[10px] text-neutral-400 font-semibold tracking-wider uppercase dark:text-neutral-500">
              RECENT MEMORY
            </span>
            <span class="text-[10px] text-neutral-400 dark:text-neutral-500">
              Daily summaries · rolling 3-day window
            </span>
          </div>

          <!-- Summarize today -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
              (isRebuildingToday || shortTermMemory.rebuilding) ? 'opacity-70' : '',
            ]"
            :disabled="isRebuildingToday || shortTermMemory.rebuilding"
            @click="handleCacheToday"
          >
            <div class="flex items-center gap-3">
              <div class="i-solar:calendar-linear shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Summarize today</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Update today's cached summary</span>
              </div>
            </div>
            <div
              v-if="isRebuildingToday"
              class="i-svg-spinners:pulse-ring shrink-0 text-sm text-primary-500"
            />
          </button>

          <!-- Rebuild last 3 days -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
              (isRebuildingHistory || shortTermMemory.rebuilding) ? 'opacity-70' : '',
            ]"
            :disabled="isRebuildingHistory || shortTermMemory.rebuilding"
            @click="handleRebuildFromHistory"
          >
            <div class="flex items-center gap-3">
              <div class="i-solar:restart-linear shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Rebuild last 3 days</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Regenerate all three daily summaries</span>
              </div>
            </div>
            <div
              v-if="isRebuildingHistory"
              class="i-svg-spinners:pulse-ring shrink-0 text-sm text-primary-500"
            />
          </button>
        </div>

        <!-- Section 3: MANAGE -->
        <div class="flex flex-col gap-0.5">
          <div class="px-1 pb-1 text-[10px] text-neutral-400 font-semibold tracking-wider uppercase dark:text-neutral-500">
            MANAGE
          </div>

          <!-- Manage timelines -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
            ]"
            @click="emit('manage-sessions'); isOpen = false"
          >
            <div class="flex items-center gap-3">
              <div class="i-solar:history-linear shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Manage timelines</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Sessions and timeline tools</span>
              </div>
            </div>
            <div class="i-solar:alt-arrow-right-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
          </button>

          <!-- Memory Dashboard -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
            ]"
            @click="navigateToMemory(); isOpen = false"
          >
            <div class="flex items-center gap-3">
              <div class="i-tabler:database-cog shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Memory Dashboard</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Storage and memory configuration</span>
              </div>
            </div>
            <div class="i-solar:arrow-right-up-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
          </button>

          <!-- Card settings -->
          <button
            type="button"
            :class="[
              'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
            ]"
            @click="navigateToCardSettings(); isOpen = false"
          >
            <div class="flex items-center gap-3">
              <div class="i-solar:user-id-linear shrink-0 text-lg text-neutral-700 dark:text-neutral-300" />
              <div class="flex flex-col">
                <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Card settings</span>
                <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Character configuration</span>
              </div>
            </div>
            <div class="i-solar:arrow-right-up-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
          </button>
        </div>

        <!-- Footer -->
        <div class="px-1 text-[10px] text-neutral-400 dark:text-neutral-500">
          Settings open in a new window.
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
