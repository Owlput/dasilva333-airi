<script setup lang="ts">
import type { StageAtmosphere } from '@proj-airi/stage-ui/stores'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { SettingsThemeHeaderWidget } from '@proj-airi/stage-ui/components'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { ATMOSPHERE_OPTIONS } from '../../Backgrounds/patterns'

const emit = defineEmits<{
  (e: 'browseScenes'): void
}>()

const isElectron = isStageTamagotchi()

const backgroundStore = useBackgroundStore()
const {
  chatboxActiveAtmosphereId,
  chatboxActiveBackgroundId,
  activeAtmosphereId,
  activeBackgroundId,
  availableBackgrounds,
} = storeToRefs(backgroundStore)

const currentAtmosphereId = computed(() => {
  return isElectron ? chatboxActiveAtmosphereId.value : activeAtmosphereId.value
})

const currentBackgroundId = computed(() => {
  return isElectron ? chatboxActiveBackgroundId.value : activeBackgroundId.value
})

const visualAtmospheres = computed(() => {
  return ATMOSPHERE_OPTIONS.filter(opt => opt.id !== 'none').map(opt => ({
    ...opt,
    displayLabel: opt.id === 'petals' ? 'Sakura' : opt.id === 'notes' ? 'Melody' : opt.name,
  }))
})

const quickWallpapers = computed(() => {
  return (availableBackgrounds.value || []).slice(0, 6)
})

function handleSetAtmosphere(id: StageAtmosphere) {
  if (isElectron) {
    backgroundStore.setChatboxActiveAtmosphere(id)
  }
  else {
    backgroundStore.setActiveAtmosphere(id)
  }
}

function handleClearAtmosphere() {
  if (isElectron) {
    backgroundStore.setChatboxActiveAtmosphere('none')
  }
  else {
    backgroundStore.setActiveAtmosphere('none')
  }
}

function handleSetBackground(id: string) {
  if (isElectron) {
    backgroundStore.setChatboxActiveBackground(id)
  }
  else {
    backgroundStore.setActiveBackground(id)
  }
}

function handleClearBackground() {
  if (isElectron) {
    backgroundStore.setChatboxActiveBackground('none')
  }
  else {
    backgroundStore.setActiveBackground('none')
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Appearance Header Banner -->
    <div class="flex items-center justify-between px-1 py-1">
      <div class="flex items-center gap-2.5">
        <div class="size-9 flex shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 dark:bg-amber-400/15 dark:text-amber-400">
          <div class="i-solar:magic-stick-3-bold-duotone size-5" />
        </div>
        <div class="flex flex-col text-left">
          <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">Appearance</span>
          <span class="text-[10px] text-neutral-400">Atmosphere and wallpaper</span>
        </div>
      </div>

      <!-- Color Palette & Theme Mode Header Widget -->
      <SettingsThemeHeaderWidget shrink-0 />
    </div>

    <!-- ATMOSPHERE SECTION -->
    <div class="flex items-center justify-between px-1 pt-1">
      <span class="select-none text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Atmosphere</span>
      <button
        type="button"
        :class="[
          'flex items-center gap-1 text-[11px] font-medium transition cursor-pointer',
          currentAtmosphereId === 'none'
            ? 'text-primary-500 dark:text-primary-400 font-semibold'
            : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
        ]"
        @click="handleClearAtmosphere"
      >
        <div class="i-solar:forbidden-circle-linear size-3.5" />
        <span>Clear effect</span>
      </button>
    </div>

    <!-- Atmosphere 3-column Visual Cards -->
    <div class="grid grid-cols-3 gap-2 px-1">
      <button
        v-for="opt in visualAtmospheres"
        :key="opt.id"
        type="button"
        :class="[
          'relative aspect-[4/3] rounded-xl overflow-hidden border transition-all duration-200 ease-out cursor-pointer flex flex-col items-center justify-end pb-1.5 hover:scale-[1.02] active:scale-[0.98]',
          currentAtmosphereId === opt.id
            ? 'border-primary-400 bg-neutral-900 shadow-[0_0_12px_rgba(56,189,248,0.25)] ring-1 ring-primary-400/50'
            : 'border-neutral-200/50 dark:border-neutral-800/80 bg-neutral-100/80 dark:bg-neutral-900/90 hover:border-neutral-300 dark:hover:border-neutral-700',
        ]"
        @click="handleSetAtmosphere(opt.id)"
      >
        <!-- Live Mini Particle Canvas -->
        <component
          :is="opt.component"
          v-if="opt.component"
          transparent-bg
          preview
          class="pointer-events-none absolute inset-0"
        />

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
            v-if="currentAtmosphereId === opt.id"
            class="absolute right-1.5 top-1.5 z-10 size-4 flex items-center justify-center rounded-full bg-primary-500 text-white shadow-md"
          >
            <div class="i-solar:check-read-bold size-2.5" />
          </div>
        </Transition>

        <!-- Card Label -->
        <span
          :class="[
            'z-10 text-[11px] tracking-wide select-none drop-shadow-sm transition font-medium',
            currentAtmosphereId === opt.id
              ? 'text-primary-400 font-bold'
              : 'text-neutral-700 dark:text-neutral-200',
          ]"
        >
          {{ opt.displayLabel }}
        </span>
      </button>
    </div>

    <!-- WALLPAPER SECTION -->
    <div class="flex items-center justify-between px-1 pt-2">
      <span class="select-none text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Wallpaper</span>
      <button
        type="button"
        :class="[
          'flex items-center gap-1 text-[11px] font-medium transition cursor-pointer',
          currentBackgroundId === 'none'
            ? 'text-primary-500 dark:text-primary-400 font-semibold'
            : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
        ]"
        @click="handleClearBackground"
      >
        <div class="i-solar:forbidden-circle-linear size-3.5" />
        <span>None</span>
      </button>
    </div>

    <!-- Wallpaper 3-column Grid -->
    <div class="grid grid-cols-3 gap-2 px-1">
      <button
        v-for="bg in quickWallpapers"
        :key="bg.id"
        type="button"
        :class="[
          'group relative aspect-[4/3] rounded-xl overflow-hidden border transition-all duration-200 ease-out cursor-pointer hover:scale-[1.02] active:scale-[0.98]',
          currentBackgroundId === bg.id
            ? 'border-primary-400 shadow-[0_0_12px_rgba(56,189,248,0.25)] ring-1 ring-primary-400/50'
            : 'border-neutral-200/50 dark:border-neutral-800/80 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-100 dark:bg-neutral-900',
        ]"
        @click="handleSetBackground(bg.id)"
      >
        <img
          v-if="bg.url || backgroundStore.getBackgroundUrl(bg.id)"
          :src="bg.url || backgroundStore.getBackgroundUrl(bg.id)!"
          :alt="bg.title || 'Wallpaper'"
          class="size-full object-cover transition duration-200 group-hover:scale-105"
          loading="lazy"
        >
        <div
          v-else
          class="size-full flex items-center justify-center bg-neutral-100 text-neutral-400 dark:bg-neutral-900"
        >
          <div class="i-solar:gallery-wide-bold-duotone size-5" />
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
            v-if="currentBackgroundId === bg.id"
            class="absolute right-1.5 top-1.5 z-10 size-4 flex items-center justify-center rounded-full bg-primary-500 text-white shadow-md"
          >
            <div class="i-solar:check-read-bold size-2.5" />
          </div>
        </Transition>
      </button>
    </div>

    <!-- Browse all scenes button -->
    <div class="px-1 pb-1 pt-1">
      <button
        type="button"
        :class="[
          'w-full py-2 px-3 rounded-xl text-xs font-semibold',
          'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/60',
          'dark:bg-neutral-900/90 dark:hover:bg-neutral-800 dark:text-primary-400 dark:border-neutral-800/80',
          'flex items-center justify-center gap-1.5 transition active:scale-98 cursor-pointer',
        ]"
        @click="emit('browseScenes')"
      >
        <span>Browse all scenes</span>
        <div class="i-solar:arrow-right-linear size-3.5" />
      </button>
    </div>
  </div>
</template>
