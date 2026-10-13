<script setup lang="ts">
import type { StageAtmosphere } from '@proj-airi/stage-ui/stores'

import { SettingsThemeHeaderWidget, StageBackgroundDialogPicker } from '@proj-airi/stage-ui/components'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref, watch } from 'vue'

import { ATMOSPHERE_OPTIONS } from '../Backgrounds/patterns'

const props = withDefaults(defineProps<{
  triggerVariant?: 'dots' | 'circle'
  showChatLayout?: boolean
  onApplyChatPreset?: (preset: 'mini' | 'medium' | 'large' | 'full') => void
}>(), {
  triggerVariant: 'dots',
  showChatLayout: true,
})

const airiCardStore = useAiriCardStore()
const { activeCard, activeCardId } = storeToRefs(airiCardStore)

const isOpen = ref(false)
type ChatOptionsView = 'root' | 'capabilities' | 'tools' | 'injections' | 'appearance'
const currentView = ref<ChatOptionsView>('root')

watch(isOpen, (val) => {
  if (!val) {
    currentView.value = 'root'
  }
})

const viewTitle = computed(() => {
  switch (currentView.value) {
    case 'capabilities':
      return 'Core Capabilities'
    case 'tools':
      return 'Tools & Workstation'
    case 'injections':
      return 'Context Injections'
    case 'appearance':
      return 'Appearance'
    default:
      return 'Chat options'
  }
})

// --- Image Spawn Mode ---
const currentSpawnMode = computed(() => {
  return activeCard.value?.extensions?.airi?.artistry?.spawnMode ?? 'bg'
})

function handleSetSpawnMode(mode: 'bg' | 'widget' | 'inline') {
  if (!activeCardId.value || !activeCard.value)
    return
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        artistry: {
          ...activeCard.value.extensions?.airi?.artistry,
          spawnMode: mode,
        },
      },
    },
  } as any)
}

// --- Layout Preset Action ---
function handleApplyPreset(preset: 'mini' | 'medium' | 'large' | 'full') {
  props.onApplyChatPreset?.(preset)
  isOpen.value = false
}

// --- CORE CAPABILITIES ---
const isHeartbeatsEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.heartbeats?.enabled ?? false
})

function handleToggleHeartbeats() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isHeartbeatsEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        heartbeats: {
          ...activeCard.value.extensions?.airi?.heartbeats,
          enabled: !current,
        },
      },
    },
  } as any)
}

const isScreenWatchingEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.screenWatching?.enabled ?? false
})

function handleToggleScreenWatching() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isScreenWatchingEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        screenWatching: {
          ...activeCard.value.extensions?.airi?.screenWatching,
          enabled: !current,
        },
      },
    },
  } as any)
}

const isDreamStateEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.dreamState?.enabled ?? false
})

function handleToggleDreamState() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isDreamStateEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        dreamState: {
          ...activeCard.value.extensions?.airi?.dreamState,
          enabled: !current,
        },
      },
    },
  } as any)
}

const isAutonomousArtistryEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.artistry?.autonomousEnabled ?? false
})

function handleToggleVisualNovel() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isAutonomousArtistryEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        artistry: {
          ...activeCard.value.extensions?.airi?.artistry,
          autonomousEnabled: !current,
        },
      },
    },
  } as any)
}

const isStickersEnabled = computed(() => {
  return (activeCard.value?.extensions?.airi?.acting?.stickerWidgetsEnabled ?? false)
    || ((activeCard.value?.extensions?.airi?.acting?.activeStickerIds?.length ?? 0) > 0)
})

function handleToggleStickers() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isStickersEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        acting: {
          ...activeCard.value.extensions?.airi?.acting,
          stickerWidgetsEnabled: !current,
        },
      },
    },
  } as any)
}

const isAutoCuesEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.acting?.autoCuesEnabled ?? false
})

function handleToggleAutoCues() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isAutoCuesEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        acting: {
          ...activeCard.value.extensions?.airi?.acting,
          autoCuesEnabled: !current,
        },
      },
    },
  } as any)
}

const isCognitivePipelineEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.cognition?.enabled ?? false
})

function handleToggleCognitivePipeline() {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isCognitivePipelineEnabled.value
  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        cognition: {
          ...activeCard.value.extensions?.airi?.cognition,
          enabled: !current,
        },
      },
    },
  } as any)
}

// --- TOOLS & WORKSTATION ---
const allowedTools = computed<string[]>(() => {
  return activeCard.value?.extensions?.airi?.generation?.known?.allowedTools ?? ['text_journal', 'image_journal']
})

function isToolActive(toolName: string): boolean {
  if (toolName === 'bash') {
    return allowedTools.value.includes('bash') || (activeCard.value?.extensions?.airi?.sandbox?.enabled ?? false)
  }
  return allowedTools.value.includes(toolName)
}

function handleToggleTool(toolName: string) {
  if (!activeCardId.value || !activeCard.value)
    return
  const current = isToolActive(toolName)
  const next = !current
  let nextTools: string[]

  if (next) {
    nextTools = allowedTools.value.includes(toolName) ? allowedTools.value : [...allowedTools.value, toolName]
  }
  else {
    nextTools = allowedTools.value.filter(t => t !== toolName && t !== `mcp_${toolName}`)
  }

  const patch: any = {
    generation: {
      ...activeCard.value.extensions?.airi?.generation,
      known: {
        ...activeCard.value.extensions?.airi?.generation?.known,
        allowedTools: nextTools,
      },
    },
  }

  if (toolName === 'bash') {
    patch.sandbox = {
      ...activeCard.value.extensions?.airi?.sandbox,
      enabled: next,
    }
  }

  airiCardStore.updateCard(activeCardId.value, {
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions?.airi,
        ...patch,
      },
    },
  } as any)
}

// --- CONTEXT INJECTIONS ---
const isGroundingEnabled = computed(() => {
  return activeCard.value?.extensions?.airi?.groundingEnabled ?? false
})

function handleToggleGrounding() {
  if (activeCardId.value) {
    airiCardStore.toggleGrounding(activeCardId.value)
  }
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

// --- APPEARANCE (ATMOSPHERE & WALLPAPER) ---
const backgroundStore = useBackgroundStore()
const {
  chatboxActiveAtmosphereId,
  chatboxActiveBackgroundId,
  availableBackgrounds,
} = storeToRefs(backgroundStore)

const stageBackgroundDialogOpen = ref(false)

const visualAtmospheres = computed(() => {
  return ATMOSPHERE_OPTIONS.filter(opt => opt.id !== 'none').map(opt => ({
    ...opt,
    displayLabel: opt.id === 'petals' ? 'Sakura' : opt.id === 'notes' ? 'Melody' : opt.name,
  }))
})

const quickWallpapers = computed(() => {
  return (availableBackgrounds.value || []).slice(0, 6)
})

function handleSetChatboxAtmosphere(id: StageAtmosphere) {
  backgroundStore.setChatboxActiveAtmosphere(id)
}

function handleClearChatboxAtmosphere() {
  backgroundStore.setChatboxActiveAtmosphere('none')
}

function handleSetChatboxBackground(id: string) {
  backgroundStore.setChatboxActiveBackground(id)
}

function handleClearChatboxBackground() {
  backgroundStore.setChatboxActiveBackground('none')
}

function handleOpenBrowseScenes() {
  isOpen.value = false
  stageBackgroundDialogOpen.value = true
}
</script>

<template>
  <PopoverRoot v-model:open="isOpen">
    <!-- Trigger Button -->
    <PopoverTrigger as-child>
      <slot name="trigger">
        <!-- Default: Dots Variant for Desktop Chat -->
        <button
          v-if="triggerVariant === 'dots'"
          type="button"
          :class="[
            'flex cursor-pointer items-center justify-center rounded-xl p-1.5 transition-all duration-200 ease-in-out',
            'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200',
            'dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-800',
            isOpen ? 'text-primary-500 dark:text-primary-400 bg-neutral-200/60 dark:bg-neutral-800/60' : '',
          ]"
          title="Chat Options"
        >
          <div class="i-solar:menu-dots-bold text-base" />
        </button>

        <!-- Circle Variant for Mobile / Web Stage Header -->
        <button
          v-else
          type="button"
          :class="[
            'size-8.5 flex items-center justify-center border rounded-full text-neutral-700 shadow-sm backdrop-blur-md transition-all active:scale-95 cursor-pointer',
            'border-neutral-200/30 bg-white/10 dark:border-neutral-700/40 dark:bg-neutral-800/60 dark:text-neutral-200',
            isOpen ? 'ring-2 ring-primary-500/30' : '',
          ]"
          title="Chat Options"
        >
          <div class="i-solar:bolt-bold-duotone size-4.5 text-amber-500/90 dark:text-amber-400" />
        </button>
      </slot>
    </PopoverTrigger>

    <!-- Popover Portal Panel -->
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        :side-offset="8"
        align="end"
        :collision-padding="12"
        :class="[
          'z-[10000] max-h-[min(540px,85dvh)] w-80 max-w-[calc(100vw-24px)]',
          'flex flex-col overflow-hidden',
          'border border-neutral-200/60 dark:border-neutral-800/80 rounded-2xl',
          'bg-white/95 dark:bg-neutral-950/95 shadow-2xl backdrop-blur-2xl duration-200',
        ]"
      >
        <!-- Header Bar -->
        <div
          v-if="currentView === 'root'"
          class="flex items-center justify-between border-b border-neutral-200/40 px-3.5 py-2.5 dark:border-neutral-800/40"
        >
          <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">Chat options</span>
          <button
            type="button"
            class="flex cursor-pointer items-center justify-center rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            @click="isOpen = false"
          >
            <div class="i-solar:close-circle-linear size-4" />
          </button>
        </div>

        <div
          v-else
          class="flex items-center justify-between border-b border-neutral-200/40 px-2.5 py-2.5 dark:border-neutral-800/40"
        >
          <button
            type="button"
            class="flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] text-neutral-500 font-semibold transition hover:bg-neutral-100 dark:text-neutral-400 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            @click="currentView = 'root'"
          >
            <div class="i-solar:alt-arrow-left-linear size-3.5" />
            <span>Chat options</span>
          </button>
          <span
            v-if="currentView !== 'appearance'"
            class="text-xs text-neutral-800 font-bold dark:text-neutral-100"
          >
            {{ viewTitle }}
          </span>
          <button
            type="button"
            class="flex cursor-pointer items-center justify-center rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            @click="isOpen = false"
          >
            <div class="i-solar:close-circle-linear size-4" />
          </button>
        </div>

        <!-- Scrollable Body Content -->
        <div class="flex-1 overflow-y-auto p-2 scrollbar-none">
          <Transition
            enter-active-class="transition-all duration-200 ease-out"
            enter-from-class="opacity-0 translate-x-2"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition-all duration-150 ease-in"
            leave-from-class="opacity-100 translate-x-0"
            leave-to-class="opacity-0 -translate-x-2"
            mode="out-in"
          >
            <!-- ================= ROOT VIEW ================= -->
            <div v-if="currentView === 'root'" key="root" class="flex flex-col gap-1.5">
              <!-- Section: Image Spawn Mode -->
              <div class="select-none px-2 pt-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
                Image Spawn Mode
              </div>
              <div class="mx-1 mb-1 flex gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-900">
                <button
                  v-for="mode in (['bg', 'widget', 'inline'] as const)"
                  :key="mode"
                  :class="[
                    'flex-1 py-1 text-[10px] font-bold rounded-md transition-all text-center whitespace-nowrap cursor-pointer',
                    currentSpawnMode === mode
                      ? 'bg-white dark:bg-neutral-800 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
                  ]"
                  @click="handleSetSpawnMode(mode)"
                >
                  {{ mode === 'bg' ? 'Background' : mode === 'widget' ? 'Widget' : 'Inline' }}
                </button>
              </div>

              <!-- Section: Chat Layout (Shown if enabled) -->
              <template v-if="showChatLayout && onApplyChatPreset">
                <div class="select-none px-2 pt-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
                  Chat Layout
                </div>
                <div class="mx-1 mb-1.5 flex border border-neutral-200/20 rounded-lg bg-neutral-100 p-0.5 divide-x divide-neutral-200/50 dark:border-neutral-800/30 dark:bg-neutral-900 dark:divide-neutral-800/80">
                  <button
                    v-for="preset in (['mini', 'medium', 'large', 'full'] as const)"
                    :key="preset"
                    class="flex-1 cursor-pointer rounded-md py-1 text-center text-[10px] text-neutral-600 font-bold transition-all active:scale-95 hover:bg-white/45 dark:text-neutral-400 hover:text-primary-500 dark:hover:bg-neutral-800/40 dark:hover:text-primary-400"
                    @click="handleApplyPreset(preset)"
                  >
                    {{ preset === 'medium' ? 'Med.' : preset.charAt(0).toUpperCase() + preset.slice(1) }}
                  </button>
                </div>
              </template>

              <!-- Divider -->
              <div class="mx-1 my-1 border-t border-neutral-200/30 dark:border-neutral-800/40" />

              <!-- Category Navigation Links -->
              <!-- 1. Core Capabilities -->
              <button
                type="button"
                class="w-full flex cursor-pointer items-center justify-between rounded-xl p-2.5 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="currentView = 'capabilities'"
              >
                <div class="flex items-center gap-2.5">
                  <div class="i-solar:heart-pulse-bold-duotone size-5 text-primary-500" />
                  <div class="flex flex-col text-left">
                    <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-100">Core Capabilities</span>
                    <span class="text-[9px] text-neutral-400">Heartbeats, watching, cues, stickers</span>
                  </div>
                </div>
                <div class="i-solar:alt-arrow-right-linear size-4 text-neutral-400" />
              </button>

              <!-- 2. Tools & Workstation -->
              <button
                type="button"
                class="w-full flex cursor-pointer items-center justify-between rounded-xl p-2.5 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="currentView = 'tools'"
              >
                <div class="flex items-center gap-2.5">
                  <div class="i-solar:laptop-minimalistic-bold-duotone size-5 text-sky-500" />
                  <div class="flex flex-col text-left">
                    <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-100">Tools & Workstation</span>
                    <span class="text-[9px] text-neutral-400">Terminal, files, web, screenshots</span>
                  </div>
                </div>
                <div class="i-solar:alt-arrow-right-linear size-4 text-neutral-400" />
              </button>

              <!-- 3. Context Injections -->
              <button
                type="button"
                class="w-full flex cursor-pointer items-center justify-between rounded-xl p-2.5 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="currentView = 'injections'"
              >
                <div class="flex items-center gap-2.5">
                  <div class="i-solar:database-bold-duotone size-5 text-amber-500" />
                  <div class="flex flex-col text-left">
                    <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-100">Context Injections</span>
                    <span class="text-[9px] text-neutral-400">Sensors, memory and intrusions</span>
                  </div>
                </div>
                <div class="i-solar:alt-arrow-right-linear size-4 text-neutral-400" />
              </button>

              <!-- 4. Appearance -->
              <button
                type="button"
                class="w-full flex cursor-pointer items-center justify-between rounded-xl p-2.5 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="currentView = 'appearance'"
              >
                <div class="flex items-center gap-2.5">
                  <div class="i-solar:magic-stick-3-bold-duotone size-5 text-amber-500" />
                  <div class="flex flex-col text-left">
                    <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-100">Appearance</span>
                    <span class="text-[9px] text-neutral-400">Atmosphere and wallpaper</span>
                  </div>
                </div>
                <div class="i-solar:alt-arrow-right-linear size-4 text-neutral-400" />
              </button>
            </div>

            <!-- ================= CORE CAPABILITIES VIEW ================= -->
            <div v-else-if="currentView === 'capabilities'" key="capabilities" class="flex flex-col gap-1">
              <!-- Toggle: Heartbeats -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleHeartbeats"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isHeartbeatsEnabled
                      ? 'text-primary-500 i-solar:heart-pulse-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:heart-pulse-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Heartbeats</span>
                    <span class="text-[9px] text-neutral-400">Activates character periodically</span>
                  </div>
                </div>
                <div
                  :class="isHeartbeatsEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isHeartbeatsEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- Toggle: Screen Watching -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleScreenWatching"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isScreenWatchingEnabled
                      ? 'text-primary-500 i-solar:eye-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:eye-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Screen Watching</span>
                    <span class="text-[9px] text-neutral-400">Visual event-driven commentary</span>
                  </div>
                </div>
                <div
                  :class="isScreenWatchingEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isScreenWatchingEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- Toggle: Dreams -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleDreamState"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isDreamStateEnabled
                      ? 'text-indigo-500 i-solar:sleeping-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:sleeping-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Dreams</span>
                    <span class="text-[9px] text-neutral-400">Offline memory consolidation</span>
                  </div>
                </div>
                <div
                  :class="isDreamStateEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isDreamStateEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- Toggle: Visual Novel -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleVisualNovel"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isAutonomousArtistryEnabled
                      ? 'text-primary-500 i-solar:gallery-wide-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:gallery-wide-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Visual Novel</span>
                    <span class="text-[9px] text-neutral-400">Generates a new image for every turn</span>
                  </div>
                </div>
                <div
                  :class="isAutonomousArtistryEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isAutonomousArtistryEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- Toggle: Reaction Stickers -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleStickers"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isStickersEnabled
                      ? 'text-pink-500 i-solar:sticker-smile-square-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:sticker-smile-square-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Reaction Stickers</span>
                    <span class="text-[9px] text-neutral-400">Emit inline chibi reaction stickers</span>
                  </div>
                </div>
                <div
                  :class="isStickersEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isStickersEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- Toggle: Autonomous Cues (System-1 Interceptor) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleAutoCues"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isAutoCuesEnabled
                      ? 'text-sky-500 i-solar:bolt-circle-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:bolt-circle-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Autonomous Cues</span>
                    <span class="text-[9px] text-neutral-400">System-1 dialogue emotion & gestures</span>
                  </div>
                </div>
                <div
                  :class="isAutoCuesEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isAutoCuesEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- Toggle: Cognitive Pipeline (Two-Hop Routing) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleCognitivePipeline"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isCognitivePipelineEnabled
                      ? 'text-violet-500 i-solar:compass-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:compass-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Cognitive Pipeline</span>
                    <span class="text-[9px] text-neutral-400">Two-hop inner monologue routing</span>
                  </div>
                </div>
                <div
                  :class="isCognitivePipelineEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isCognitivePipelineEnabled ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>
            </div>

            <!-- ================= TOOLS & WORKSTATION VIEW ================= -->
            <div v-else-if="currentView === 'tools'" key="tools" class="flex flex-col gap-1">
              <!-- 1. Virtual Terminal (bash) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('bash')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('bash')
                      ? 'text-violet-500 i-solar:code-square-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:code-square-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Virtual Terminal</span>
                    <span class="text-[9px] text-neutral-400">RAM disk & compiler workstation</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('bash') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('bash') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 2. Computer Files (filesystem) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('filesystem')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('filesystem')
                      ? 'text-amber-500 i-solar:folder-with-files-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:folder-with-files-linear'"
                  />
                  <div class="flex flex-col">
                    <div class="flex items-center gap-1.5">
                      <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Computer Files</span>
                      <span class="rounded bg-amber-500/10 px-1 py-0.2 text-[8px] text-amber-600 font-semibold uppercase dark:text-amber-400">Desktop</span>
                    </div>
                    <span class="text-[9px] text-neutral-400">Browse and search local folders</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('filesystem') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('filesystem') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 3. Web & Research (web_search) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('web_search')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('web_search')
                      ? 'text-cyan-500 i-solar:global-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:global-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Web & Research</span>
                    <span class="text-[9px] text-neutral-400">Real-time web search & page markdown</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('web_search') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('web_search') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 4. Screen Snapshots (take_screenshot) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('take_screenshot')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('take_screenshot')
                      ? 'text-teal-500 i-solar:camera-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:camera-linear'"
                  />
                  <div class="flex flex-col">
                    <div class="flex items-center gap-1.5">
                      <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Screen Snapshots</span>
                      <span class="rounded bg-teal-500/10 px-1 py-0.2 text-[8px] text-teal-600 font-semibold uppercase dark:text-teal-400">Desktop</span>
                    </div>
                    <span class="text-[9px] text-neutral-400">Inspect desktop screen on request</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('take_screenshot') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('take_screenshot') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 5. Connected Plugins (mcp) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('mcp')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('mcp')
                      ? 'text-indigo-500 i-solar:tuning-square-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:tuning-square-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Connected Plugins</span>
                    <span class="text-[9px] text-neutral-400">External MCP tools & connected services</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('mcp') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('mcp') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 6. Motion Generator (generate_motion) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('generate_motion')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('generate_motion')
                      ? 'text-orange-500 i-solar:running-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:running-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Motion Generator</span>
                    <span class="text-[9px] text-neutral-400">Procedural 3D animation synthesis</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('generate_motion') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('generate_motion') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 7. Image Journal (image_journal) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('image_journal')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('image_journal')
                      ? 'text-pink-500 i-solar:gallery-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:gallery-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Image Journal</span>
                    <span class="text-[9px] text-neutral-400">Autonomous image generation & backdrops</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('image_journal') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('image_journal') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>

              <!-- 8. Memory & Journal (text_journal) -->
              <div
                class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                @click="handleToggleTool('text_journal')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-4.5"
                    :class="isToolActive('text_journal')
                      ? 'text-emerald-500 i-solar:notebook-bold-duotone'
                      : 'text-neutral-400 dark:text-neutral-500 i-solar:notebook-linear'"
                  />
                  <div class="flex flex-col">
                    <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">Memory & Journal</span>
                    <span class="text-[9px] text-neutral-400">Append-only journal & STMM blocks</span>
                  </div>
                </div>
                <div
                  :class="isToolActive('text_journal') ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
                >
                  <span
                    :class="isToolActive('text_journal') ? 'translate-x-3.5' : 'translate-x-0.5'"
                    class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  />
                </div>
              </div>
            </div>

            <!-- ================= CONTEXT INJECTIONS VIEW ================= -->
            <div v-else-if="currentView === 'injections'" key="injections" class="flex flex-col gap-1">
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

              <!-- 2. Universe Memory (RAG) -->
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

            <!-- ================= APPEARANCE VIEW ================= -->
            <div v-else-if="currentView === 'appearance'" key="appearance" class="flex flex-col gap-2">
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
                    chatboxActiveAtmosphereId === 'none'
                      ? 'text-primary-500 dark:text-primary-400 font-semibold'
                      : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
                  ]"
                  @click="handleClearChatboxAtmosphere"
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
                    chatboxActiveAtmosphereId === opt.id
                      ? 'border-primary-400 bg-neutral-900 shadow-[0_0_12px_rgba(56,189,248,0.25)] ring-1 ring-primary-400/50'
                      : 'border-neutral-200/50 dark:border-neutral-800/80 bg-neutral-100/80 dark:bg-neutral-900/90 hover:border-neutral-300 dark:hover:border-neutral-700',
                  ]"
                  @click="handleSetChatboxAtmosphere(opt.id)"
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
                      v-if="chatboxActiveAtmosphereId === opt.id"
                      class="absolute right-1.5 top-1.5 z-10 size-4 flex items-center justify-center rounded-full bg-primary-500 text-white shadow-md"
                    >
                      <div class="i-solar:check-read-bold size-2.5" />
                    </div>
                  </Transition>

                  <!-- Card Label -->
                  <span
                    :class="[
                      'z-10 text-[11px] tracking-wide select-none drop-shadow-sm transition font-medium',
                      chatboxActiveAtmosphereId === opt.id
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
                    chatboxActiveBackgroundId === 'none'
                      ? 'text-primary-500 dark:text-primary-400 font-semibold'
                      : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
                  ]"
                  @click="handleClearChatboxBackground"
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
                    chatboxActiveBackgroundId === bg.id
                      ? 'border-primary-400 shadow-[0_0_12px_rgba(56,189,248,0.25)] ring-1 ring-primary-400/50'
                      : 'border-neutral-200/50 dark:border-neutral-800/80 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-100 dark:bg-neutral-900',
                  ]"
                  @click="handleSetChatboxBackground(bg.id)"
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
                      v-if="chatboxActiveBackgroundId === bg.id"
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
                  @click="handleOpenBrowseScenes"
                >
                  <span>Browse all scenes</span>
                  <div class="i-solar:arrow-right-linear size-3.5" />
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <StageBackgroundDialogPicker
    v-model="stageBackgroundDialogOpen"
    :card-id="activeCardId"
    :auto-apply="false"
    :close-on-pick="true"
    :selected-id="chatboxActiveBackgroundId"
    @pick="(id: string) => handleSetChatboxBackground(id)"
  />
</template>
