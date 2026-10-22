<script setup lang="ts">
import { CharacterAvatar } from '@proj-airi/stage-ui/components'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { computed, ref } from 'vue'

const props = defineProps<{
  activeCardId: string
}>()

const emit = defineEmits<{
  (e: 'selectCard', cardId: string): void
  (e: 'editCard', cardId: string): void
  (e: 'browseCards'): void
  (e: 'createCard'): void
}>()

const airiCardStore = useAiriCardStore()
const chatSessionStore = useChatSessionStore()

const searchQuery = ref('')
const activeFilter = ref<'all' | 'favorites'>('all')

const allCards = computed(() => {
  return Array.from(airiCardStore.cards.entries()).map(([id, card]) => ({
    ...card,
    id,
  }))
})

const totalCardCount = computed(() => {
  return allCards.value.length
})

const filteredCards = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return allCards.value.filter((card) => {
    // 1. Text filter
    if (query) {
      const name = (card.name || '').toLowerCase()
      if (!name.includes(query)) {
        return false
      }
    }

    // 2. Favorites filter
    if (activeFilter.value === 'favorites') {
      const isFav = Boolean((card as any).favorite || (card as any).extensions?.airi?.favorite)
      if (!isFav) {
        return false
      }
    }

    return true
  })
})

function getTimelineCount(cardId: string): number {
  const charIndex = chatSessionStore.getCharacterIndex(cardId)
  return charIndex ? Object.keys(charIndex.sessions).length : 1
}

function handleSelectCard(cardId: string) {
  airiCardStore.activeCardId = cardId
  // Restore last active session for this character if available
  const charIndex = chatSessionStore.getCharacterIndex(cardId)
  if (charIndex?.activeSessionId) {
    chatSessionStore.setActiveSession(charIndex.activeSessionId)
  }
  emit('selectCard', cardId)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Search Bar & Add Button Row -->
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <div class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-neutral-400">
          <div class="i-solar:magnifer-linear size-3.5" />
        </div>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search cards..."
          class="w-full border border-neutral-200/60 rounded-xl bg-neutral-100/60 py-1.5 pl-8 pr-3 text-xs text-neutral-800 outline-none transition dark:border-neutral-800/80 focus:border-primary-400 dark:bg-neutral-900/60 dark:text-neutral-100 placeholder-neutral-400"
        >
      </div>

      <!-- Add Card Button -->
      <button
        type="button"
        class="size-8.5 flex shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary-500 text-white shadow-sm transition active:scale-95 hover:bg-primary-600"
        title="Create or import card"
        @click="emit('createCard')"
      >
        <div class="i-solar:add-circle-bold size-4" />
      </button>
    </div>

    <!-- Filter Pills Row -->
    <div class="flex items-center justify-between px-0.5">
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          :class="[
            'px-2.5 py-0.5 rounded-lg text-xs font-semibold transition cursor-pointer',
            activeFilter === 'all'
              ? 'bg-primary-500 text-white shadow-sm'
              : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800',
          ]"
          @click="activeFilter = 'all'"
        >
          All
        </button>

        <button
          type="button"
          :class="[
            'flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold transition cursor-pointer',
            activeFilter === 'favorites'
              ? 'bg-primary-500 text-white shadow-sm'
              : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800',
          ]"
          @click="activeFilter = 'favorites'"
        >
          <div class="i-solar:star-bold size-3" />
          <span>Favorites</span>
        </button>
      </div>

      <span class="text-xs text-neutral-400 font-medium">
        {{ totalCardCount }} cards
      </span>
    </div>

    <!-- Scrollable Cards List -->
    <div class="max-h-60 flex flex-col gap-1 overflow-y-auto pr-0.5 scrollbar-thin">
      <div
        v-for="card in filteredCards"
        :key="card.id"
        :class="[
          'group relative flex items-center justify-between rounded-xl p-2 transition-all duration-150 cursor-pointer border',
          activeCardId === card.id
            ? 'border-primary-400/80 bg-primary-500/10 text-primary-900 dark:text-primary-100 shadow-sm'
            : 'border-transparent hover:bg-neutral-100/80 dark:hover:bg-neutral-900/80 text-neutral-700 dark:text-neutral-200',
        ]"
        @click="handleSelectCard(card.id)"
      >
        <!-- Card Left: Avatar & Name/Meta -->
        <div class="min-w-0 flex flex-1 items-center gap-2.5 pr-2">
          <CharacterAvatar
            :card-id="card.id"
            :name="card.name"
            :display-model-id="airiCardStore.getCardDisplayModelId(card.id)"
            size-class="size-8.5"
            shape="rounded"
          />

          <div class="min-w-0 flex flex-1 flex-col">
            <span
              :class="[
                'truncate text-xs',
                activeCardId === card.id ? 'font-bold' : 'font-medium',
              ]"
            >
              {{ card.name }}
            </span>
            <span class="truncate text-[10px] text-neutral-400 dark:text-neutral-500">
              {{ activeCardId === card.id ? 'Current card · ' : '' }}{{ getTimelineCount(card.id) }} {{ getTimelineCount(card.id) === 1 ? 'timeline' : 'timelines' }}
            </span>
          </div>
        </div>

        <!-- Right: Active Checkmark Badge -->
        <div
          v-if="activeCardId === card.id"
          class="size-5 flex shrink-0 items-center justify-center rounded-full bg-primary-500 text-white shadow-sm"
        >
          <div class="i-solar:check-read-bold size-3" />
        </div>
      </div>

      <!-- Empty Filter State -->
      <div v-if="filteredCards.length === 0" class="py-6 text-center text-xs text-neutral-400">
        No character cards found.
      </div>
    </div>

    <!-- Helper Text -->
    <div class="flex items-center gap-1.5 px-1 text-[10px] text-neutral-400 dark:text-neutral-500">
      <div class="i-solar:info-circle-linear size-3 shrink-0" />
      <span>Switching cards restores its last timeline.</span>
    </div>

    <!-- Footer Action Buttons: Edit card & Browse cards -->
    <div class="grid grid-cols-2 gap-2 pt-1">
      <button
        type="button"
        class="flex cursor-pointer items-center justify-center gap-1.5 border border-neutral-200/60 rounded-xl bg-neutral-100/70 py-2 text-xs text-neutral-700 font-semibold transition active:scale-98 dark:border-neutral-800/80 dark:bg-neutral-900/60 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
        @click="emit('editCard', activeCardId)"
      >
        <div class="i-solar:pen-linear size-3.5" />
        <span>Edit card</span>
      </button>

      <button
        type="button"
        class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary-500 py-2 text-xs text-white font-semibold shadow-sm transition active:scale-98 hover:bg-primary-600"
        @click="emit('browseCards')"
      >
        <div class="i-solar:widget-2-linear size-3.5" />
        <span>Browse cards</span>
        <div class="i-solar:arrow-right-linear size-3" />
      </button>
    </div>
  </div>
</template>
