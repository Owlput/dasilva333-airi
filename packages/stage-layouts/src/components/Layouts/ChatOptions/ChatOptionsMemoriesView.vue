<script setup lang="ts">
import { useShortTermMemoryStore } from '@proj-airi/stage-ui/stores/memory-short-term'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

const emit = defineEmits<{
  (e: 'viewContext'): void
  (e: 'manageSessions'): void
  (e: 'searchMemories'): void
  (e: 'openMemorySettings'): void
  (e: 'openCardSettings'): void
}>()

const shortTermMemory = useShortTermMemoryStore()
const airiCardStore = useAiriCardStore()
const { activeCardId, activeCard } = storeToRefs(airiCardStore)

const isRebuildingToday = ref(false)
const isRebuildingHistory = ref(false)

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
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Header Summary Banner -->
    <div class="flex items-center gap-3 px-1 py-1">
      <div class="size-10 flex shrink-0 items-center justify-center border border-indigo-500/20 rounded-xl bg-indigo-500/15 text-indigo-500 dark:bg-indigo-500/20">
        <div class="i-solar:history-bold-duotone size-6" />
      </div>
      <div class="flex flex-col">
        <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">Memories</span>
        <span class="text-[10px] text-neutral-400 dark:text-neutral-500">Sessions, daily summaries, search &amp; storage</span>
      </div>
    </div>

    <!-- Section 1: INSPECT -->
    <div class="flex flex-col gap-0.5 pt-0.5">
      <div class="px-1 pb-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
        Inspect
      </div>

      <!-- View system prompt -->
      <button
        type="button"
        :class="[
          'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
          'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
        ]"
        @click="emit('viewContext')"
      >
        <div class="flex items-center gap-3">
          <div class="i-solar:document-text-bold-duotone shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
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
        @click="emit('searchMemories')"
      >
        <div class="flex items-center gap-3">
          <div class="i-solar:magnifer-bold-duotone shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
          <div class="flex flex-col">
            <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Search memories</span>
            <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Find remembered context</span>
          </div>
        </div>
        <div class="i-solar:alt-arrow-right-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
      </button>
    </div>

    <!-- Section 2: RECENT MEMORY (Hidden if Short-Term Memory is disabled) -->
    <div v-if="isShortTermMemoryEnabled" class="flex flex-col gap-0.5 pt-0.5">
      <div class="flex flex-col px-1 pb-1">
        <span class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
          Recent Memory
        </span>
        <span class="text-[9px] text-neutral-400 dark:text-neutral-500">
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
          <div class="i-solar:calendar-bold-duotone shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
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
          <div class="i-solar:restart-bold-duotone shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
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
    <div class="flex flex-col gap-0.5 pt-0.5">
      <div class="px-1 pb-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
        Manage
      </div>

      <!-- Manage timelines -->
      <button
        type="button"
        :class="[
          'w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left transition cursor-pointer',
          'hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
        ]"
        @click="emit('manageSessions')"
      >
        <div class="flex items-center gap-3">
          <div class="i-solar:history-bold-duotone shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
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
        @click="emit('openMemorySettings')"
      >
        <div class="flex items-center gap-3">
          <div class="i-tabler:database-cog shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
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
        @click="emit('openCardSettings')"
      >
        <div class="flex items-center gap-3">
          <div class="i-solar:user-id-bold-duotone shrink-0 text-lg text-neutral-600 dark:text-neutral-300" />
          <div class="flex flex-col">
            <span class="text-xs text-neutral-800 font-semibold leading-snug dark:text-neutral-100">Card settings</span>
            <span class="text-[10px] text-neutral-400 leading-snug dark:text-neutral-500">Character configuration</span>
          </div>
        </div>
        <div class="i-solar:arrow-right-up-linear shrink-0 text-xs text-neutral-400 dark:text-neutral-500" />
      </button>
    </div>

    <!-- Divider & Note -->
    <div class="my-1 border-t border-neutral-200/40 dark:border-neutral-800/40" />
    <span class="px-1 text-[10px] text-neutral-400 dark:text-neutral-500">
      Manage persistent recall, session timelines &amp; summaries.
    </span>
  </div>
</template>
