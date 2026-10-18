<script setup lang="ts">
import { useBackgroundStore } from '@proj-airi/stage-ui/stores'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

const props = withDefaults(defineProps<{
  cardId?: string
  gridMaxHeightClass?: string
  allowInherit?: boolean
  autoApply?: boolean
  title?: string
  subtitle?: string
}>(), {
  gridMaxHeightClass: 'max-h-[60vh]',
  allowInherit: false,
  autoApply: true,
  title: 'Scene gallery',
  subtitle: 'Choose the image shown when this character is active, or upload a scene.',
})

const emit = defineEmits<{
  (e: 'pick', id: string): void
  (e: 'update:modelValue', id: string): void
  (e: 'update:selectedId', id: string): void
}>()

const modelValue = defineModel<string>({ required: false })
const selectedIdModel = defineModel<string>('selectedId', { required: false })

const cardStore = useAiriCardStore()
const backgroundStore = useBackgroundStore()
const isRefreshingGallery = ref(false)
const localSelectedId = ref<string>()
const sortOrder = ref<'newest' | 'oldest' | 'name'>('newest')

// Get selected card data
const selectedCard = computed(() => {
  if (!props.cardId)
    return undefined
  return cardStore.getCard(props.cardId)
})

// All available backgrounds for this card (builtin + shared scenes + character journal images)
const allBackgrounds = computed(() => {
  if (props.cardId) {
    return backgroundStore.getCharacterBackgrounds(props.cardId)
  }
  return backgroundStore.availableBackgrounds || []
})

// Current background ID
const activeBackgroundId = computed<string>({
  get: () => {
    if (selectedIdModel.value !== undefined)
      return selectedIdModel.value
    if (modelValue.value !== undefined)
      return modelValue.value
    if (localSelectedId.value !== undefined)
      return localSelectedId.value
    return selectedCard.value?.extensions?.airi?.modules?.activeBackgroundId || 'none'
  },
  set: async (val: string) => {
    localSelectedId.value = val
    if (selectedIdModel.value !== undefined) {
      selectedIdModel.value = val
    }
    if (modelValue.value !== undefined) {
      modelValue.value = val
    }
    emit('pick', val)
    emit('update:modelValue', val)
    emit('update:selectedId', val)

    if (props.autoApply && props.cardId && selectedCard.value) {
      const extension = JSON.parse(JSON.stringify(selectedCard.value.extensions || {}))
      if (!extension.airi)
        extension.airi = {}
      if (!extension.airi.modules)
        extension.airi.modules = {}

      extension.airi.modules.activeBackgroundId = val

      await cardStore.updateCard(props.cardId, {
        ...selectedCard.value,
        extensions: extension,
      })
    }
  },
})

const activeEntry = computed(() => {
  return allBackgrounds.value.find(e => e.id === activeBackgroundId.value)
})

const sortedBackgrounds = computed(() => {
  const list = [...allBackgrounds.value]
  if (sortOrder.value === 'newest') {
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
  if (sortOrder.value === 'oldest') {
    return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  }
  return list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
})

function formatEntryDate(timestamp?: number): string {
  if (!timestamp)
    return ''
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (isToday)
    return `Today · ${timeStr}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${timeStr}`
}

function handleSetAsBackground(id: string) {
  activeBackgroundId.value = id
}

async function handleDeleteEntry(id: string) {
  if (confirm('Are you sure you want to delete this image?')) {
    await backgroundStore.removeBackground(id)
  }
}

async function handleRefreshGallery() {
  isRefreshingGallery.value = true
  try {
    await backgroundStore.initializeStore()
  }
  finally {
    isRefreshingGallery.value = false
  }
}

async function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return
  try {
    const newId = await backgroundStore.addBackground('scene', file, file.name.replace(/\.[^/.]+$/, ''), undefined, props.cardId || null)
    handleSetAsBackground(newId)
  }
  catch (err) {
    console.error('Failed to add background:', err)
  }
  finally {
    target.value = ''
  }
}

async function handleDownloadEntry(id: string, title: string) {
  const url = backgroundStore.getBackgroundUrl(id)
  if (!url)
    return

  const link = document.createElement('a')
  link.href = url
  link.download = `${title || 'image'}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const previewImageUrl = ref<string | null>(null)
const previewImageTitle = ref<string | null>(null)

function handlePreviewEntry(id: string, title: string) {
  const url = backgroundStore.getBackgroundUrl(id)
  if (url) {
    previewImageUrl.value = url
    previewImageTitle.value = title
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="flex flex-col gap-4 pb-2 md:flex-row md:items-start md:justify-between">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2.5">
          <h3 class="text-lg text-neutral-900 font-bold md:text-xl dark:text-neutral-100">
            {{ title }}
          </h3>
          <span class="border border-neutral-200 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 font-medium dark:border-neutral-700/60 dark:bg-neutral-800 dark:text-neutral-300">
            {{ allBackgrounds.length }} images
          </span>
        </div>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ subtitle }}
        </p>

        <!-- Current Active Scene Indicator -->
        <div class="mt-1 flex items-center gap-2 text-xs font-medium">
          <span
            class="h-2 w-2 rounded-full"
            :class="activeBackgroundId !== 'none' ? 'bg-cyan-500 dark:bg-cyan-400 animate-pulse' : 'bg-neutral-400'"
          />
          <span class="text-neutral-700 dark:text-neutral-300">
            Current image:
            <span class="text-cyan-600 font-semibold dark:text-cyan-400">
              {{ activeEntry?.title || (activeBackgroundId === 'none' ? 'None' : 'Inherited Default') }}
            </span>
          </span>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col items-start gap-2 md:items-end">
        <!-- Row 1: Inherit / None Actions -->
        <div class="flex flex-wrap items-center gap-2">
          <!-- Inherit / No Override Button -->
          <button
            v-if="allowInherit"
            type="button"
            class="h-8 flex cursor-pointer items-center gap-1.5 border rounded-lg px-3 text-xs font-semibold transition-all active:scale-95"
            :class="[
              activeBackgroundId === 'inherit'
                ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                : 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 hover:border-primary-300 hover:text-primary-500',
            ]"
            @click="handleSetAsBackground('inherit')"
          >
            <div
              class="text-sm"
              :class="activeBackgroundId === 'inherit' ? 'i-solar:restart-bold' : 'i-solar:restart-linear'"
            />
            <span>Inherit Default</span>
          </button>

          <!-- Clear / None Background Button -->
          <button
            type="button"
            class="h-8 flex cursor-pointer items-center gap-1.5 border rounded-lg px-3 text-xs font-semibold transition-all active:scale-95"
            :class="[
              activeBackgroundId === 'none'
                ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-950/40 dark:text-cyan-300'
                : 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 hover:border-cyan-400 hover:text-cyan-600',
            ]"
            @click="handleSetAsBackground('none')"
          >
            <div
              class="text-sm"
              :class="activeBackgroundId === 'none' ? 'i-solar:gallery-remove-bold' : 'i-solar:gallery-remove-linear'"
            />
            <span>None</span>
          </button>
        </div>

        <!-- Row 2: Upload, Refresh, Sort, View All -->
        <div class="flex flex-wrap items-center gap-2">
          <!-- Upload Button -->
          <label
            class="h-8 flex cursor-pointer items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-3 text-xs text-neutral-600 font-semibold transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
            title="Upload new background"
          >
            <input
              type="file"
              accept="image/*"
              class="hidden"
              @change="handleFileUpload"
            >
            <div class="i-solar:upload-linear text-xs" />
            <span>Upload</span>
          </label>

          <!-- Refresh Button -->
          <button
            type="button"
            class="h-8 flex cursor-pointer items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-3 text-xs text-neutral-600 font-semibold transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-100 dark:text-neutral-300 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
            :disabled="isRefreshingGallery"
            @click="handleRefreshGallery"
          >
            <div
              class="i-lucide:refresh-cw text-xs"
              :class="{ 'animate-spin': isRefreshingGallery }"
            />
            <span>Refresh</span>
          </button>

          <!-- Sort Order Selector -->
          <select
            v-model="sortOrder"
            class="h-8 border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 text-xs text-neutral-600 font-medium outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
          >
            <option value="newest">
              Newest first
            </option>
            <option value="oldest">
              Oldest first
            </option>
            <option value="name">
              Alphabetical
            </option>
          </select>

          <!-- View all link -->
          <RouterLink
            to="/settings/scene"
            class="ml-1 flex items-center gap-1 text-xs text-cyan-600 font-medium transition-colors dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
          >
            <span>View all</span>
            <div class="i-solar:arrow-right-linear text-xs" />
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- Grid -->
    <div :class="['grid grid-cols-1 gap-4 overflow-y-auto pr-1 scrollbar-none sm:grid-cols-2 lg:grid-cols-3', gridMaxHeightClass]">
      <!-- Empty state -->
      <div v-if="sortedBackgrounds.length === 0" class="col-span-full flex flex-col items-center justify-center py-12 text-center text-neutral-400">
        <div class="i-solar:gallery-broken mb-2 text-4xl" />
        <p class="text-xs">
          No background images found in gallery.
        </p>
        <p class="mt-1 text-[10px] text-neutral-500">
          Upload a background image or generate one via Artistry to populate your gallery.
        </p>
      </div>

      <!-- Background Items (Widescreen Cards with Hover Actions & Subtitle) -->
      <div
        v-for="entry in sortedBackgrounds"
        :key="entry.id"
        class="group flex flex-col cursor-pointer gap-2"
        @click="handleSetAsBackground(entry.id)"
      >
        <!-- Thumbnail Container -->
        <div
          class="relative aspect-video w-full overflow-hidden border-2 rounded-xl bg-neutral-100 transition-all duration-200 active:scale-98 dark:bg-neutral-900"
          :class="[
            activeBackgroundId === entry.id
              ? 'border-cyan-500 dark:border-cyan-400 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-950/20'
              : 'border-neutral-200 dark:border-neutral-800/80 hover:border-cyan-400/50',
          ]"
        >
          <img
            :src="backgroundStore.getBackgroundUrl(entry.id) ?? undefined"
            class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          >

          <!-- Top-Left Magnifier Inspect Button -->
          <button
            type="button"
            class="absolute left-2.5 top-2.5 z-10 h-7 w-7 flex items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-md transition-opacity duration-200 hover:bg-black/80"
            title="Inspect fullscreen"
            @click.stop="handlePreviewEntry(entry.id, entry.title)"
          >
            <div class="i-solar:magnifier-linear text-xs" />
          </button>

          <!-- Top-Right Active Check Badge -->
          <div
            v-if="activeBackgroundId === entry.id"
            class="absolute right-2.5 top-2.5 z-10 h-6 w-6 flex items-center justify-center rounded-full bg-cyan-500 text-white shadow-md dark:bg-cyan-400 dark:text-neutral-950"
          >
            <div class="i-solar:check-circle-bold text-sm" />
          </div>

          <!-- Hover Action Overlay -->
          <div class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/55 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
            <button
              type="button"
              class="flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs text-white font-bold backdrop-blur-md transition-all active:scale-95"
              :class="activeBackgroundId === entry.id ? 'bg-cyan-600 dark:bg-cyan-500' : 'bg-white/20 hover:bg-white/30'"
              @click.stop="handleSetAsBackground(entry.id)"
            >
              <div :class="activeBackgroundId === entry.id ? 'i-solar:pin-bold' : 'i-solar:pin-linear'" class="text-xs" />
              <span>{{ activeBackgroundId === entry.id ? 'ACTIVE' : 'SELECT' }}</span>
            </button>

            <div class="flex gap-2" @click.stop>
              <button
                type="button"
                class="h-7 w-7 flex cursor-pointer items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-all active:scale-95 hover:bg-white/30"
                title="Download"
                @click.stop="handleDownloadEntry(entry.id, entry.title)"
              >
                <div class="i-solar:download-square-linear text-xs" />
              </button>
              <button
                v-if="entry.type !== 'builtin'"
                type="button"
                class="h-7 w-7 flex cursor-pointer items-center justify-center rounded-full bg-red-500/80 text-white backdrop-blur-md transition-all active:scale-95 hover:bg-red-500"
                title="Delete"
                @click.stop="handleDeleteEntry(entry.id)"
              >
                <div class="i-solar:trash-bin-trash-linear text-xs" />
              </button>
            </div>
          </div>
        </div>

        <!-- Metadata underneath card -->
        <div class="flex items-center justify-between px-0.5">
          <span class="truncate text-xs text-neutral-800 font-semibold dark:text-neutral-200">
            {{ entry.title }}
          </span>
          <span v-if="entry.createdAt" class="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
            {{ formatEntryDate(entry.createdAt) }}
          </span>
        </div>
      </div>

      <!-- Image Preview Overlay -->
      <div
        v-if="previewImageUrl"
        class="fixed inset-0 z-[10020] flex flex-col items-center justify-center bg-black/95 p-4 transition-all duration-300"
        @click="previewImageUrl = null"
      >
        <!-- Close Button -->
        <button
          type="button"
          class="absolute right-6 top-6 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 text-white transition-all active:scale-95 hover:bg-white/20"
          @click="previewImageUrl = null"
        >
          <div class="i-solar:close-circle-bold text-2xl" />
        </button>

        <!-- Fullscreen Image -->
        <div class="animate-in zoom-in-95 relative max-h-[80vh] max-w-[90vw] flex flex-col items-center gap-4 duration-200" @click.stop>
          <img
            :src="previewImageUrl"
            class="max-h-[75vh] max-w-full rounded-2xl object-contain shadow-2xl"
          >
          <div class="text-center">
            <h4 class="text-sm text-white/90 font-semibold">
              {{ previewImageTitle }}
            </h4>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
