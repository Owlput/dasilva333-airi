<script setup lang="ts">
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  cardId: string
  initialModelId?: string
}>()

const emit = defineEmits<{
  (e: 'applied', modelId: string): void
  (e: 'manageAvatars'): void
}>()

const airiCardStore = useAiriCardStore()
const settingsStore = useSettings()
const displayModelsStore = useDisplayModelsStore()
const { displayModels } = storeToRefs(displayModelsStore)

const committedModelId = ref<string>(
  props.initialModelId
  || airiCardStore.getCardDisplayModelId(props.cardId)
  || settingsStore.stageModelSelected
  || '',
)

const selectedModelId = ref<string>(committedModelId.value)
const searchQuery = ref('')
const selectedFormat = ref<'all' | 'live2d' | 'vrm' | 'spine'>('all')

// Fetch display models from the display-models store
const availableModels = computed(() => {
  return displayModels.value || []
})

const filteredModels = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return availableModels.value.filter((model) => {
    // 1. Search text filter
    if (query) {
      const name = (model.name || '').toLowerCase()
      if (!name.includes(query)) {
        return false
      }
    }

    // 2. Format filter
    if (selectedFormat.value !== 'all') {
      const fmt = (model.format || '').toLowerCase()
      if (!fmt.includes(selectedFormat.value)) {
        return false
      }
    }

    return true
  })
})

const selectedModel = computed(() => {
  return availableModels.value.find(m => m.id === selectedModelId.value)
})

const isCommitted = computed(() => {
  return selectedModelId.value === committedModelId.value
})

function formatModelType(format?: string): string {
  if (!format) {
    return 'Avatar'
  }
  const f = format.toLowerCase()
  if (f.includes('live2d')) {
    return 'Live2D'
  }
  if (f.includes('vrm')) {
    return 'VRM'
  }
  if (f.includes('spine')) {
    return 'Spine'
  }
  return format.toUpperCase()
}

// Preview model on stage immediately when selected
function handleSelectModel(modelId: string) {
  selectedModelId.value = modelId
  settingsStore.stageModelSelected = modelId
}

// Apply and commit changes to the active character card
function handleApplyToCard() {
  if (!selectedModelId.value) {
    return
  }

  const card = airiCardStore.getCard(props.cardId)
  if (card) {
    airiCardStore.updateCard(props.cardId, {
      extensions: {
        ...card.extensions,
        airi: {
          ...card.extensions?.airi,
          modules: {
            ...card.extensions?.airi?.modules,
            displayModelId: selectedModelId.value,
          },
        },
      },
    } as any)
  }

  committedModelId.value = selectedModelId.value
  emit('applied', selectedModelId.value)
}

// Clean up: If user exits without applying, revert the stage model preview
onBeforeUnmount(() => {
  if (selectedModelId.value !== committedModelId.value && committedModelId.value) {
    settingsStore.stageModelSelected = committedModelId.value
  }
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Search Bar Row -->
    <div class="relative w-full">
      <div class="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-neutral-400">
        <div class="i-solar:magnifer-linear size-3.5" />
      </div>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search avatars..."
        class="w-full border border-neutral-200/60 rounded-xl bg-neutral-100/60 py-1.5 pl-8 pr-3 text-xs text-neutral-800 outline-none transition dark:border-neutral-800/80 focus:border-primary-400 dark:bg-neutral-900/60 dark:text-neutral-100 placeholder-neutral-400"
      >
    </div>

    <!-- Filter Format Dropdown Row -->
    <div class="flex items-center justify-between px-0.5">
      <div class="relative flex items-center">
        <select
          v-model="selectedFormat"
          class="cursor-pointer appearance-none border border-neutral-200/60 rounded-lg bg-neutral-100/80 py-1 pl-2.5 pr-6 text-xs text-neutral-700 font-semibold outline-none transition dark:border-neutral-800/80 dark:bg-neutral-900/90 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <option value="all">
            All formats
          </option>
          <option value="live2d">
            Live2D
          </option>
          <option value="vrm">
            VRM
          </option>
          <option value="spine">
            Spine
          </option>
        </select>
        <div class="pointer-events-none absolute right-2 text-neutral-400">
          <div class="i-solar:alt-arrow-down-linear size-3" />
        </div>
      </div>

      <span class="text-xs text-neutral-400 font-medium">
        {{ filteredModels.length }} models
      </span>
    </div>

    <!-- 3-Column Avatar Grid -->
    <div class="grid grid-cols-3 max-h-56 gap-2 overflow-y-auto pr-0.5 scrollbar-thin">
      <button
        v-for="model in filteredModels"
        :key="model.id"
        type="button"
        :class="[
          'group relative aspect-[3/4] rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer flex flex-col items-center justify-end p-1.5 hover:scale-[1.02] active:scale-[0.98]',
          selectedModelId === model.id
            ? 'border-primary-400 ring-2 ring-primary-400/50 shadow-md bg-neutral-900'
            : 'border-neutral-200/60 dark:border-neutral-800/80 bg-neutral-100/70 dark:bg-neutral-900/80 hover:border-neutral-300 dark:hover:border-neutral-700',
        ]"
        @click="handleSelectModel(model.id)"
      >
        <!-- Thumbnail Image or Fallback Avatar Icon -->
        <img
          v-if="model.previewImage || (model as any).previewUrl || (model as any).thumbnailUrl || model.authorIcon"
          :src="model.previewImage || (model as any).previewUrl || (model as any).thumbnailUrl || model.authorIcon"
          :alt="model.name"
          class="size-full object-cover transition group-hover:scale-105"
          loading="lazy"
        >
        <div
          v-else
          class="size-full flex flex-col items-center justify-center text-neutral-400"
        >
          <div class="i-solar:user-bold size-8 opacity-40" />
        </div>

        <!-- Active Checkmark Badge -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="opacity-0 scale-50"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-50"
        >
          <div
            v-if="selectedModelId === model.id"
            class="absolute right-1.5 top-1.5 z-10 size-4.5 flex items-center justify-center rounded-full bg-primary-500 text-white shadow-md"
          >
            <div class="i-solar:check-read-bold size-3" />
          </div>
        </Transition>

        <!-- Overlay Label -->
        <div class="absolute inset-x-0 bottom-0 from-black/80 via-black/40 to-transparent bg-gradient-to-t p-1 pt-3 text-center">
          <span class="block truncate text-[10px] text-white font-semibold drop-shadow-sm">
            {{ model.name }}
          </span>
        </div>
      </button>

      <!-- Empty State -->
      <div v-if="filteredModels.length === 0" class="col-span-3 py-6 text-center text-xs text-neutral-400">
        No models found.
      </div>
    </div>

    <!-- Preview Status Bar Card -->
    <div
      v-if="selectedModel"
      class="flex items-center gap-2.5 border border-neutral-200/60 rounded-xl bg-neutral-100/60 p-2 dark:border-neutral-800/80 dark:bg-neutral-900/60"
    >
      <div class="size-8 shrink-0 overflow-hidden rounded-lg bg-neutral-200/60 dark:bg-neutral-800">
        <img
          v-if="selectedModel.previewImage || (selectedModel as any).previewUrl || (selectedModel as any).thumbnailUrl || selectedModel.authorIcon"
          :src="selectedModel.previewImage || (selectedModel as any).previewUrl || (selectedModel as any).thumbnailUrl || selectedModel.authorIcon"
          class="size-full object-cover"
        >
        <div v-else class="size-full flex items-center justify-center text-neutral-400">
          <div class="i-solar:user-bold size-4" />
        </div>
      </div>

      <div class="min-w-0 flex flex-1 flex-col">
        <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-100">
          {{ selectedModel.name }} · {{ formatModelType(selectedModel.format) }}
        </span>
        <span
          class="truncate text-[10px] font-medium"
          :class="isCommitted ? 'text-neutral-400 dark:text-neutral-500' : 'text-primary-500 dark:text-primary-400'"
        >
          {{ isCommitted ? 'Current card model' : 'Preview only · Card unchanged' }}
        </span>
      </div>
    </div>

    <!-- Footer: Manage Avatars & Apply Button -->
    <div class="grid grid-cols-2 gap-2 pt-1">
      <button
        type="button"
        class="flex cursor-pointer items-center justify-center gap-1.5 border border-neutral-200/60 rounded-xl bg-neutral-100/70 py-2 text-xs text-neutral-700 font-semibold transition active:scale-98 dark:border-neutral-800/80 dark:bg-neutral-900/60 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
        @click="emit('manageAvatars')"
      >
        <div class="i-solar:settings-linear size-3.5" />
        <span>Manage avatars</span>
      </button>

      <button
        type="button"
        :disabled="isCommitted"
        :class="[
          'flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition active:scale-98 shadow-sm',
          isCommitted
            ? 'bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600 cursor-not-allowed'
            : 'bg-primary-500 hover:bg-primary-600 text-white cursor-pointer',
        ]"
        @click="handleApplyToCard"
      >
        <div class="i-solar:check-read-bold size-3.5" />
        <span>Apply to card</span>
      </button>
    </div>
  </div>
</template>
