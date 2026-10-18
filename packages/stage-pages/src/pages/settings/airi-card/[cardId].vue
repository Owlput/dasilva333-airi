<script setup lang="ts">
import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'

import { CharacterAvatar, MarkdownRenderer } from '@proj-airi/stage-ui/components'
import {
  DEFAULT_ACTING_MODEL_EXPRESSION_PROMPT,
  DEFAULT_POST_HISTORY_INSTRUCTIONS,
} from '@proj-airi/stage-ui/constants/prompts/character-defaults'
import {
  useArtistryStore,
  useConsciousnessStore,
  useDisplayModelsStore,
  useSpeechStore,
} from '@proj-airi/stage-ui/stores'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import CardExportDialog from './components/CardExportDialog.vue'
import DeleteCardDialog from './components/DeleteCardDialog.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const cardStore = useAiriCardStore()
const displayModelsStore = useDisplayModelsStore()
const consciousnessStore = useConsciousnessStore()
const speechStore = useSpeechStore()
const artistryStore = useArtistryStore()
const backgroundStore = useBackgroundStore()

const { activeCardId } = storeToRefs(cardStore)
const { activeProvider: consciousnessProvider, activeModel: defaultConsciousnessModel } = storeToRefs(consciousnessStore)
const { activeSpeechProvider: speechProvider, activeSpeechModel: defaultSpeechModel, activeSpeechVoiceId: defaultVoiceId } = storeToRefs(speechStore)
const { activeProvider: defaultArtistryProvider } = storeToRefs(artistryStore)

const cardId = computed(() => (route.params.cardId as string) || '')

const card = computed<AiriCard | undefined>(() => {
  if (!cardId.value)
    return undefined
  return cardStore.getCard(cardId.value)
})

const airiExt = computed(() => card.value?.extensions?.airi)
const displayModelId = computed(() => airiExt.value?.modules?.displayModelId)

const isActive = computed(() => cardId.value === activeCardId.value)
const isActivating = ref(false)

async function handleActivate() {
  if (!cardId.value || isActive.value)
    return
  isActivating.value = true
  try {
    await cardStore.activateCard(cardId.value)
    artistryStore.resetState()
    toast.success(`${card.value?.name || 'Character'} activated`)
  }
  catch (err) {
    console.error('[CardDetailRoute] Failed to activate card:', err)
    toast.error('Failed to activate character card')
  }
  finally {
    isActivating.value = false
  }
}

function handleEdit() {
  if (!cardId.value)
    return
  router.push({
    path: '/settings/airi-card/edit',
    query: { id: cardId.value },
  })
}

const isExportOpen = ref(false)
const isDeleteOpen = ref(false)

function handleBack() {
  if (window.history.length > 1) {
    router.back()
  }
  else {
    router.push('/settings/airi-card')
  }
}

function handleDeleteConfirm() {
  if (cardId.value) {
    cardStore.removeCard(cardId.value)
    toast.success('Character deleted')
    router.push('/settings/airi-card')
  }
  isDeleteOpen.value = false
}

// Module Settings Resolution
const moduleSettings = computed(() => {
  const modules = airiExt.value?.modules
  const modelId = modules?.displayModelId
  const matchedModel = modelId ? displayModelsStore.displayModels.find(m => m.id === modelId) : null

  return {
    consciousnessProvider: modules?.consciousness?.provider || consciousnessProvider.value || 'Inherit global settings',
    consciousnessModel: modules?.consciousness?.model || defaultConsciousnessModel.value || 'Inherit global settings',
    visionProvider: defaultArtistryProvider.value || 'Inherit global settings',
    visionModel: 'Inherit global settings',
    speechProvider: modules?.speech?.provider || speechProvider.value || 'Inherit global settings',
    speechModel: modules?.speech?.model || defaultSpeechModel.value || 'Inherit global settings',
    speechVoice: modules?.speech?.voice_id || defaultVoiceId.value || 'Inherit global settings',
    displayModelName: matchedModel?.name || modelId || 'None',
  }
})

// Gallery / Stage Background for this card
const activeBackgroundUrl = computed(() => {
  return backgroundStore.activeBackgroundUrl
})

// Collapsible prompt directives preview
const showDirectives = ref(false)

// Clean banner tagline: strips leading markdown headers (#, ##, ###) and actor cue tags for an uncluttered hero teaser
const bannerTagline = computed(() => {
  if (!card.value?.description)
    return 'An experimental virtual AI companion.'

  const cleaned = card.value.description
    .replace(/^#{1,6}\s+(?:<\|ACTOR:[^>]*\|>\s*)?(?:Appearance\s*)?/gm, '')
    .replace(/<\|ACTOR:[^>]*\|>\s*/g, '')
    .trim()

  return cleaned || card.value.description
})
</script>

<template>
  <div class="mx-auto max-w-6xl w-full px-4 pb-20 pt-2 sm:px-6">
    <!-- Breadcrumb navigation -->
    <div class="mb-5 flex items-center justify-between">
      <div class="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <button
          type="button"
          class="flex items-center gap-1.5 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          @click="handleBack"
        >
          <div class="i-solar:arrow-left-linear text-base" />
          <span>{{ t('settings.pages.card.title', 'AIRI Card') }}</span>
        </button>
        <span>/</span>
        <span class="truncate text-neutral-900 font-medium dark:text-neutral-100">{{ card?.name || cardId }}</span>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          icon="i-solar:trash-bin-trash-bold-duotone"
          class="text-red-500 hover:bg-red-500/10 hover:text-red-600"
          @click="isDeleteOpen = true"
        />
      </div>
    </div>

    <!-- Empty State if card not found -->
    <div v-if="!card" class="border border-neutral-200 rounded-2xl bg-neutral-50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/50">
      <div class="i-solar:ghost-bold-duotone mx-auto mb-3 text-5xl text-neutral-400" />
      <h3 class="text-lg text-neutral-900 font-semibold dark:text-neutral-100">
        Character Not Found
      </h3>
      <p class="mb-6 mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        The card you are looking for does not exist or was removed.
      </p>
      <Button variant="secondary" label="Back to Gallery" @click="handleBack" />
    </div>

    <!-- Main Content -->
    <div v-else class="space-y-8">
      <!-- HERO BANNER -->
      <div
        class="relative min-h-[220px] w-full flex flex-col justify-between overflow-hidden border border-teal-800/40 rounded-2xl from-teal-950 via-teal-900 to-cyan-950 bg-gradient-to-r p-6 shadow-teal-950/20 shadow-xl md:min-h-[280px] sm:min-h-[260px] md:rounded-3xl md:p-10 sm:p-8"
      >
        <!-- Background subtle glow -->
        <div class="pointer-events-none absolute h-72 w-72 rounded-full bg-teal-500/10 blur-3xl -left-20 -top-20" />
        <div class="pointer-events-none absolute right-10 top-0 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

        <!-- Top Content (Name, Badges, Tagline) -->
        <div class="z-10 max-w-xl">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-3xl text-white font-bold tracking-tight drop-shadow-sm md:text-5xl sm:text-4xl">
              {{ card.name }}
            </h1>
            <!-- Status badges -->
            <div class="flex items-center gap-2">
              <span
                v-if="isActive"
                class="inline-flex items-center gap-1.5 border border-teal-400/30 rounded-full bg-teal-500/20 px-3 py-0.5 text-xs text-teal-200 font-medium backdrop-blur-sm"
              >
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" />
                Currently Active
              </span>
              <span
                v-else
                class="inline-flex items-center border border-white/10 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/70 font-medium backdrop-blur-sm"
              >
                Inactive
              </span>
              <span class="inline-flex items-center border border-white/10 rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-white/60 font-medium backdrop-blur-sm">
                v{{ card.version || '1.0.0' }}
              </span>
            </div>
          </div>

          <!-- Description / Tagline in Banner -->
          <p class="line-clamp-3 mt-3 text-sm text-teal-100/80 font-normal leading-relaxed sm:text-base">
            {{ bannerTagline }}
          </p>
        </div>

        <!-- Action Buttons (Bottom Left) -->
        <div class="z-10 mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            :disabled="isActive || isActivating"
            class="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium shadow-md transition-all"
            :class="[
              isActive
                ? 'bg-teal-600 text-white cursor-default shadow-teal-900/30'
                : 'bg-teal-700/80 hover:bg-teal-600 text-white cursor-pointer hover:shadow-teal-900/40',
              { 'animate-pulse': isActivating },
            ]"
            @click="handleActivate"
          >
            <div :class="isActive ? 'i-solar:check-circle-bold-duotone' : 'i-solar:play-circle-broken'" class="text-base" />
            <span>{{ isActive ? 'Active' : 'Activate' }}</span>
          </button>

          <button
            type="button"
            class="flex cursor-pointer items-center gap-2 border border-white/15 rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white font-medium backdrop-blur-sm transition-all hover:bg-white/20"
            @click="handleEdit"
          >
            <div class="i-solar:pen-bold-duotone text-base" />
            <span>Edit Card</span>
          </button>

          <button
            type="button"
            class="flex cursor-pointer items-center gap-2 border border-white/15 rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white font-medium backdrop-blur-sm transition-all hover:bg-white/20"
            @click="isExportOpen = true"
          >
            <div class="i-solar:export-bold-duotone text-base" />
            <span>Export</span>
          </button>
        </div>

        <!-- Character Artwork Bust (Bottom Right Hero Placement) -->
        <div class="pointer-events-none absolute right-2 z-1 h-52 w-52 flex select-none items-end justify-center -bottom-4 md:right-12 sm:right-6 md:h-72 md:w-72 sm:h-64 sm:w-64">
          <CharacterAvatar
            :card-id="cardId"
            :name="card.name"
            :display-model-id="displayModelId"
            shape="square"
            size-class="h-full w-full"
            avatar-class="h-full w-full object-contain object-bottom drop-shadow-[0_20px_35px_rgba(0,0,0,0.7)]"
            :use-dynamic-background="false"
            transparent
          />
        </div>
      </div>

      <!-- DETAILS GRID -->
      <div class="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <!-- LEFT 2 COLUMNS: Description, Character Lore, Gallery -->
        <div class="lg:col-span-2 space-y-8">
          <!-- Description Section -->
          <div>
            <h2 class="mb-2 text-base text-neutral-900 font-bold dark:text-white">
              Description
            </h2>
            <div v-if="card.description" class="text-sm text-neutral-600 leading-relaxed dark:text-neutral-300">
              <MarkdownRenderer :content="card.description" />
            </div>
            <div v-else class="text-sm text-neutral-400 italic">
              No description provided.
            </div>
          </div>

          <!-- Character Lore Section -->
          <div class="space-y-4">
            <h2 class="text-base text-neutral-900 font-bold dark:text-white">
              Character
            </h2>

            <!-- Personality -->
            <div>
              <div class="mb-1 text-xs text-neutral-400 font-semibold tracking-wider uppercase dark:text-neutral-500">
                Personality
              </div>
              <div class="text-sm text-neutral-700 dark:text-neutral-200">
                <MarkdownRenderer v-if="card.personality" :content="card.personality" />
                <span v-else>Curious, direct, and patient.</span>
              </div>
            </div>

            <div class="border-t border-neutral-200 dark:border-neutral-800" />

            <!-- Scenario -->
            <div>
              <div class="mb-1 text-xs text-neutral-400 font-semibold tracking-wider uppercase dark:text-neutral-500">
                Scenario
              </div>
              <div class="text-sm text-neutral-700 dark:text-neutral-200">
                <MarkdownRenderer v-if="card.scenario" :content="card.scenario" />
                <span v-else>A quiet evening in the computer lab.</span>
              </div>
            </div>
          </div>

          <!-- Gallery / Scenery Section -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-base text-neutral-900 font-bold dark:text-white">
                  Gallery
                </h2>
                <p class="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                  Select the image to show when this character is active.
                </p>
              </div>
              <span class="border border-neutral-200 rounded-lg bg-neutral-100 px-3 py-1 text-xs text-neutral-600 font-medium dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-300">
                {{ activeBackgroundUrl ? 'Active' : 'Default' }}
              </span>
            </div>

            <!-- Mini Gallery Preview Slot -->
            <div class="border border-neutral-200 rounded-2xl bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
              <div class="flex items-center gap-3">
                <div class="h-20 w-32 flex items-center justify-center overflow-hidden border border-neutral-300/40 rounded-xl bg-neutral-200 dark:border-neutral-700/40 dark:bg-neutral-800">
                  <img
                    v-if="activeBackgroundUrl"
                    :src="activeBackgroundUrl"
                    alt="Active Stage Background"
                    class="h-full w-full object-cover"
                  >
                  <div v-else class="i-solar:gallery-wide-bold-duotone text-2xl text-neutral-400" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm text-neutral-800 font-medium dark:text-neutral-200">
                    Stage Scenery
                  </div>
                  <div class="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                    Stage background is synchronized across desktop and mobile companion windows.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Directives & Prompts Section (Collapsible) -->
          <div class="border border-neutral-200 rounded-2xl bg-neutral-50/50 p-5 space-y-4 dark:border-neutral-800 dark:bg-neutral-900/30">
            <div class="flex cursor-pointer items-center justify-between" @click="showDirectives = !showDirectives">
              <div class="flex items-center gap-2">
                <div class="i-solar:code-file-bold-duotone text-lg text-primary-500" />
                <h3 class="text-sm text-neutral-900 font-semibold dark:text-white">
                  System Prompts & Generation Directives
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                :icon="showDirectives ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear'"
              />
            </div>

            <div v-if="showDirectives" class="border-t border-neutral-200 pt-2 space-y-4 dark:border-neutral-800">
              <!-- System Prompt -->
              <div>
                <div class="mb-1 text-xs text-neutral-500 font-semibold dark:text-neutral-400">
                  Core System Prompt
                </div>
                <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-neutral-100 p-3 text-xs text-neutral-700 font-mono dark:bg-neutral-950 dark:text-neutral-300">{{ card.systemPrompt || 'None specified' }}</pre>
              </div>

              <!-- Post History -->
              <div>
                <div class="mb-1 text-xs text-neutral-500 font-semibold dark:text-neutral-400">
                  Post-History Directive
                </div>
                <pre class="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-neutral-100 p-3 text-xs text-neutral-700 font-mono dark:bg-neutral-950 dark:text-neutral-300">{{ card.postHistoryInstructions || DEFAULT_POST_HISTORY_INSTRUCTIONS }}</pre>
              </div>

              <!-- Acting Expressions -->
              <div>
                <div class="mb-1 text-xs text-neutral-500 font-semibold dark:text-neutral-400">
                  Model Expression & Motion Cues
                </div>
                <pre class="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-neutral-100 p-3 text-xs text-neutral-700 font-mono dark:bg-neutral-950 dark:text-neutral-300">{{ airiExt?.acting?.modelExpressionPrompt || DEFAULT_ACTING_MODEL_EXPRESSION_PROMPT }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT 1 COLUMN: Modules Section -->
        <div class="lg:col-span-1 space-y-4">
          <div class="border border-neutral-200 rounded-2xl bg-neutral-50/50 p-6 space-y-4 dark:border-neutral-800 dark:bg-neutral-900/40">
            <h2 class="mb-2 text-base text-neutral-900 font-bold dark:text-white">
              Modules
            </h2>

            <div class="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Chat / Provider</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.consciousnessProvider }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Consciousness / Model</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.consciousnessModel }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Vision / Provider</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.visionProvider }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Vision / Model</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.visionModel }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Speech / Provider</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.speechProvider }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Speech / Model</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.speechModel }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Speech / Voice</span>
                <span class="max-w-[170px] truncate text-right text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ moduleSettings.speechVoice }}</span>
              </div>

              <div class="flex items-center justify-between py-2.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400">Body / Display Model</span>
                <span class="max-w-[170px] truncate text-right text-xs text-primary-600 font-medium font-semibold dark:text-primary-400">{{ moduleSettings.displayModelName }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Export Modal -->
    <CardExportDialog
      v-if="card"
      v-model="isExportOpen"
      :card-id="cardId"
      :card="card"
    />

    <!-- Delete Confirmation Modal -->
    <DeleteCardDialog
      v-if="card"
      v-model="isDeleteOpen"
      :card-name="card?.name"
      @confirm="handleDeleteConfirm"
      @cancel="isDeleteOpen = false"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.card.title
  subtitleKey: settings.pages.card.title
  descriptionKey: settings.pages.card.description
  icon: i-solar:user-bold-duotone
  settingsEntry: false
  order: 2
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
