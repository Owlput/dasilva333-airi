<script setup lang="ts">
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const airiCardStore = useAiriCardStore()
const { activeCard, activeCardId } = storeToRefs(airiCardStore)

// --- CONTEXT INJECTIONS ---
const isGroundingEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.groundingEnabled ?? false
})

function handleToggleGrounding() {
  if (activeCardId.value) {
    airiCardStore.toggleGrounding(activeCardId.value)
  }
}

const isShortTermMemoryEnabled = computed(() => {
  if (!activeCard.value)
    return true
  return activeCard.value.extensions?.airi?.shortTermMemory?.enabled ?? true
})

function handleToggleShortTermMemory() {
  if (activeCardId.value)
    airiCardStore.toggleShortTermMemory(activeCardId.value)
}

const isGroundingMemoryEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.groundingMemoryEnabled ?? false
})

function handleToggleGroundingMemory() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isGroundingMemoryEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        groundingMemoryEnabled: !current,
      },
    },
  } as any)
}

const isGroundingDirectorScratchpadEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.groundingDirectorScratchpadEnabled ?? false
})

function handleToggleGroundingDirectorScratchpad() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isGroundingDirectorScratchpadEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        groundingDirectorScratchpadEnabled: !current,
      },
    },
  } as any)
}

const isDreamStateEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.dreamState?.enabled ?? false
})

const isDreamIntrusionEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.dreamState?.injectDreamContext ?? false
})

function handleToggleDreamIntrusion() {
  if (!activeCardId.value || !activeCard.value || !isDreamStateEnabled.value)
    return
  const current = isDreamIntrusionEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        dreamState: {
          ...activeCard.value.extensions?.airi?.dreamState,
          injectDreamContext: !current,
        },
      },
    },
  } as any)
}

const allowedTools = computed<string[]>(() => {
  return activeCard.value?.extensions?.airi?.generation?.known?.allowedTools ?? ['text_journal', 'image_journal']
})

function isToolActive(toolName: string): boolean {
  if (toolName === 'bash') {
    return allowedTools.value.includes('bash') || (activeCard.value?.extensions?.airi?.sandbox?.enabled ?? false)
  }
  return allowedTools.value.includes(toolName)
}

const hasTextJournal = computed(() => {
  return isToolActive('text_journal')
})

const isJournalIntrusionEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.textJournal?.injectJournalContext ?? false
})

function handleToggleJournalIntrusion() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isJournalIntrusionEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        textJournal: {
          ...activeCard.value.extensions?.airi?.textJournal,
          injectJournalContext: !current,
        },
      },
    },
  } as any)
}

const hasImageJournal = computed(() => {
  return isToolActive('image_journal')
})

const isArtistryIntrusionEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.artistry?.injectArtistryContext ?? false
})

function handleToggleArtistryIntrusion() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isArtistryIntrusionEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        artistry: {
          ...activeCard.value.extensions?.airi?.artistry,
          injectArtistryContext: !current,
        },
      },
    },
  } as any)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <!-- 1. System Sensors -->
    <div
      class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
      @click="handleToggleGrounding"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isGroundingEnabled
            ? 'text-amber-500 i-solar:cpu-bolt-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:cpu-bolt-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">System Sensors</span>
          <span class="text-[9px] text-neutral-400">Inject real-time OS telemetry</span>
        </div>
      </div>
      <div
        :class="isGroundingEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isGroundingEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>

    <!-- 2. Recent Memory -->
    <div
      class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
      @click="handleToggleShortTermMemory"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isShortTermMemoryEnabled
            ? 'text-amber-500 i-solar:calendar-date-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:calendar-date-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Recent Memory</span>
          <span class="text-[9px] text-neutral-400">Include daily summaries from the rolling 3-day window</span>
        </div>
      </div>
      <div
        :class="isShortTermMemoryEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isShortTermMemoryEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>

    <!-- 3. Universe Memory (RAG) -->
    <div
      class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
      @click="handleToggleGroundingMemory"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isGroundingMemoryEnabled
            ? 'text-amber-500 i-solar:database-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:database-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Universe Memory (RAG)</span>
          <span class="text-[9px] text-neutral-400">Semantic long-term memory lookup</span>
        </div>
      </div>
      <div
        :class="isGroundingMemoryEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isGroundingMemoryEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>

    <!-- 3. Visual Scene State -->
    <div
      class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
      @click="handleToggleGroundingDirectorScratchpad"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isGroundingDirectorScratchpadEnabled
            ? 'text-amber-500 i-solar:gallery-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:gallery-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Visual Scene State</span>
          <span class="text-[9px] text-neutral-400">Attach Director's latest scratchpad</span>
        </div>
      </div>
      <div
        :class="isGroundingDirectorScratchpadEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isGroundingDirectorScratchpadEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>

    <!-- Divider -->
    <div class="mx-1 my-1 border-t border-neutral-200/30 dark:border-neutral-800/40" />

    <!-- 4. Dream Intrusion -->
    <div
      class="w-full flex items-center justify-between rounded-xl px-2.5 py-2 transition"
      :class="[
        !isDreamStateEnabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
      ]"
      @click="handleToggleDreamIntrusion"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isDreamIntrusionEnabled && isDreamStateEnabled
            ? 'text-indigo-500 i-solar:sleeping-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:sleeping-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Dream Intrusion</span>
          <span class="text-[9px] text-neutral-400">
            Inject offline consolidated dreams
            <span v-if="!isDreamStateEnabled" class="text-amber-500 font-semibold dark:text-amber-400"> (Requires Dreams)</span>
          </span>
        </div>
      </div>
      <div
        :class="isDreamIntrusionEnabled && isDreamStateEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isDreamIntrusionEnabled && isDreamStateEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>

    <!-- 5. Journal Intrusion -->
    <div
      class="w-full flex items-center justify-between rounded-xl px-2.5 py-2 transition"
      :class="[
        !hasTextJournal
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
      ]"
      @click="hasTextJournal && handleToggleJournalIntrusion()"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isJournalIntrusionEnabled && hasTextJournal
            ? 'text-cyan-500 i-solar:notebook-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:notebook-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Journal Intrusion</span>
          <span class="text-[9px] text-neutral-400">
            Reference latest journal entry
            <span v-if="!hasTextJournal" class="text-amber-500 font-semibold dark:text-amber-400"> (Requires Memory Tool)</span>
          </span>
        </div>
      </div>
      <div
        :class="isJournalIntrusionEnabled && hasTextJournal ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isJournalIntrusionEnabled && hasTextJournal ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>

    <!-- 6. Artistry Intrusion -->
    <div
      class="w-full flex items-center justify-between rounded-xl px-2.5 py-2 transition"
      :class="[
        !hasImageJournal
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/60',
      ]"
      @click="hasImageJournal && handleToggleArtistryIntrusion()"
    >
      <div class="flex items-center gap-2.5">
        <div
          class="size-4.5"
          :class="isArtistryIntrusionEnabled && hasImageJournal
            ? 'text-pink-500 i-solar:gallery-bold-duotone'
            : 'text-neutral-400 dark:text-neutral-500 i-solar:gallery-linear'"
        />
        <div class="flex flex-col">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Artistry Intrusion</span>
          <span class="text-[9px] text-neutral-400">
            Reference latest image creations
            <span v-if="!hasImageJournal" class="text-amber-500 font-semibold dark:text-amber-400"> (Requires Image Journal)</span>
          </span>
        </div>
      </div>
      <div
        :class="isArtistryIntrusionEnabled && hasImageJournal ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
        class="relative h-4 w-7 inline-flex shrink-0 items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
      >
        <span
          :class="isArtistryIntrusionEnabled && hasImageJournal ? 'translate-x-3.5' : 'translate-x-0.5'"
          class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
        />
      </div>
    </div>
  </div>
</template>
