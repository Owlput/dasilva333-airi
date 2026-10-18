<script setup lang="ts">
import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'

import { CharacterAvatar, MarkdownRenderer } from '@proj-airi/stage-ui/components'
import { formatActorName } from '@proj-airi/stage-ui/components/markdown/actor-colors'
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
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
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
const { activeSpeechProvider: speechProvider, activeSpeechVoiceId: defaultVoiceId } = storeToRefs(speechStore)
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

// 1. Character Identity vs Identifier Slug
const characterDisplayName = computed(() => {
  return card.value?.nickname?.trim() || card.value?.name || 'Character'
})

const hasDistinctIdentifier = computed(() => {
  const nick = card.value?.nickname?.trim()
  return Boolean(nick && card.value?.name && nick !== card.value.name)
})

async function handleCopyIdentifier() {
  if (!card.value?.name)
    return
  try {
    await navigator.clipboard.writeText(card.value.name)
    toast.success('Copied character identifier')
  }
  catch {
    toast.error('Failed to copy identifier')
  }
}

async function handleActivate() {
  if (!cardId.value || isActive.value)
    return
  isActivating.value = true
  try {
    await cardStore.activateCard(cardId.value)
    artistryStore.resetState()
    toast.success(`${characterDisplayName.value} activated`)
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

// 2. Hero Introduction / Tagline
const heroIntroduction = computed(() => {
  if (card.value?.notes?.trim())
    return card.value.notes.trim()
  if (!card.value?.description)
    return 'An experimental virtual AI companion.'

  const cleaned = card.value.description
    .replace(/^#{1,6}\s+(?:<\|ACTOR:[^>]*\|>\s*)?(?:Appearance\s*)?/gm, '')
    .replace(/<\|ACTOR:[^>]*\|>\s*/g, '')
    .trim()

  return cleaned || card.value.description
})

// 3. View Mode Markdown Actor Marker Transformation
function renderViewMarkdown(raw?: string): string {
  if (!raw)
    return ''
  return raw.replace(/<\|ACTOR:\s*([^|>]+)\s*\|?>/gi, (_match, actorId) => {
    const cleanActor = actorId.trim()
    const formatted = formatActorName(cleanActor)
    return ` <span class="actor-chip border border-teal-500/30 bg-teal-500/10 text-teal-600 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-300 font-sans text-xs px-2 py-0.5 rounded-full inline-flex items-center font-semibold">${formatted}</span> `
  })
}

const formattedDescription = computed(() => renderViewMarkdown(card.value?.description))
const formattedPersonality = computed(() => renderViewMarkdown(card.value?.personality))
const formattedScenario = computed(() => renderViewMarkdown(card.value?.scenario))

// 4. Module Settings Grouped by Purpose
const moduleGroups = computed(() => {
  const modules = airiExt.value?.modules
  const modelId = modules?.displayModelId
  const matchedModel = modelId ? displayModelsStore.displayModels.find(m => m.id === modelId) : null

  return [
    {
      title: 'Conversation',
      icon: 'i-solar:chat-round-dots-bold-duotone',
      isCustom: Boolean(modules?.consciousness?.provider || modules?.consciousness?.model),
      items: [
        { label: 'Provider', value: modules?.consciousness?.provider || consciousnessProvider.value || 'Default' },
        { label: 'Model', value: modules?.consciousness?.model || defaultConsciousnessModel.value || 'Default' },
      ],
    },
    {
      title: 'Vision',
      icon: 'i-solar:eye-bold-duotone',
      isCustom: false,
      items: [
        { label: 'Provider', value: defaultArtistryProvider.value || 'Default' },
        { label: 'Model', value: 'Default' },
      ],
    },
    {
      title: 'Voice',
      icon: 'i-solar:microphone-3-bold-duotone',
      isCustom: Boolean(modules?.speech?.voice_id || modules?.speech?.provider),
      items: [
        { label: 'Voice', value: modules?.speech?.voice_id || defaultVoiceId.value || 'Default Voice' },
        { label: 'Engine', value: modules?.speech?.provider || speechProvider.value || 'Default Engine' },
      ],
    },
    {
      title: 'Avatar',
      icon: 'i-solar:user-bold-duotone',
      isCustom: Boolean(modelId),
      items: [
        { label: 'Model', value: matchedModel?.name || modelId || 'None' },
        { label: 'Format', value: matchedModel?.format ? matchedModel.format.toUpperCase() : (modelId ? 'Live2D / VRM' : 'None') },
      ],
    },
  ]
})

// Gallery / Stage Background for this card
const activeBackgroundUrl = computed(() => {
  return backgroundStore.activeBackgroundUrl
})

// Collapsible prompt directives preview
const showDirectives = ref(false)
</script>

<template>
  <div class="mx-auto max-w-6xl w-full px-4 pb-20 pt-2 sm:px-6">
    <!-- Breadcrumb navigation -->
    <div class="mb-4 flex items-center justify-between">
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
        <span class="truncate text-neutral-900 font-medium dark:text-neutral-100">{{ characterDisplayName }}</span>
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
    <div v-else class="space-y-6">
      <!-- HERO BANNER -->
      <div
        class="relative min-h-[170px] w-full flex flex-col justify-between overflow-hidden border border-teal-800/40 rounded-2xl from-teal-950 via-teal-900 to-cyan-950 bg-gradient-to-r p-5 shadow-teal-950/20 shadow-xl md:min-h-[210px] sm:min-h-[190px] md:rounded-3xl md:p-8 sm:p-6"
      >
        <!-- Background subtle glow -->
        <div class="pointer-events-none absolute h-72 w-72 rounded-full bg-teal-500/10 blur-3xl -left-20 -top-20" />
        <div class="pointer-events-none absolute right-10 top-0 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

        <!-- Top Content (Display Name, Identifier Slug, Badges, Tagline) -->
        <div class="z-10 max-w-xl">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-2xl text-white font-bold tracking-tight drop-shadow-sm md:text-4xl sm:text-3xl">
              {{ characterDisplayName }}
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

          <!-- Muted Identifier Slug below title when nickname is displayed -->
          <div v-if="hasDistinctIdentifier" class="mt-1 flex items-center gap-1.5 text-xs text-teal-200/70 font-mono">
            <span>{{ card.name }}</span>
            <button
              type="button"
              title="Copy identifier"
              class="inline-flex items-center rounded p-0.5 transition-colors hover:bg-white/10 hover:text-white"
              @click="handleCopyIdentifier"
            >
              <div class="i-solar:copy-linear text-xs" />
            </button>
          </div>

          <!-- Description / Tagline in Banner -->
          <p class="line-clamp-2 mt-2 max-w-lg text-xs text-teal-100/80 font-normal leading-relaxed sm:text-sm">
            {{ heroIntroduction }}
          </p>
        </div>

        <!-- Action Buttons (Bottom Left) -->
        <div class="z-10 mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            :disabled="isActive || isActivating"
            class="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium shadow-md transition-all sm:px-5 sm:py-2.5 sm:text-sm"
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
            class="flex cursor-pointer items-center gap-2 border border-white/15 rounded-xl bg-white/10 px-3.5 py-2 text-xs text-white font-medium backdrop-blur-sm transition-all hover:bg-white/20 sm:px-4 sm:py-2.5 sm:text-sm"
            @click="handleEdit"
          >
            <div class="i-solar:pen-bold-duotone text-base" />
            <span>Edit Card</span>
          </button>

          <button
            type="button"
            class="flex cursor-pointer items-center gap-2 border border-white/15 rounded-xl bg-white/10 px-3.5 py-2 text-xs text-white font-medium backdrop-blur-sm transition-all hover:bg-white/20 sm:px-4 sm:py-2.5 sm:text-sm"
            @click="isExportOpen = true"
          >
            <div class="i-solar:export-bold-duotone text-base" />
            <span>Export</span>
          </button>

          <!-- Overflow Options Menu -->
          <DropdownMenuRoot>
            <DropdownMenuTrigger as-child aria-label="More options">
              <button
                type="button"
                class="flex cursor-pointer items-center justify-center border border-white/15 rounded-xl bg-white/10 p-2 text-white backdrop-blur-sm transition-all hover:bg-white/20 sm:p-2.5"
              >
                <div class="i-solar:menu-dots-bold text-base" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                :class="[
                  'z-50 min-w-44 rounded-xl p-1 outline-none',
                  'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800',
                  'shadow-xl backdrop-blur-md',
                  'will-change-[opacity,transform]',
                  'data-[side=bottom]:animate-slideUpAndFade data-[side=top]:animate-slideDownAndFade',
                ]"
                :side-offset="8"
                align="end"
              >
                <DropdownMenuItem
                  v-if="card?.name"
                  :class="[
                    'relative flex cursor-pointer select-none items-center gap-2',
                    'rounded-lg px-3 py-2 text-xs leading-none outline-none',
                    'text-neutral-700 dark:text-neutral-200',
                    'data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800',
                    'transition-colors duration-150',
                  ]"
                  @click="handleCopyIdentifier"
                >
                  <div class="i-solar:copy-linear text-sm" />
                  <span>Copy Identifier</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  :class="[
                    'relative flex cursor-pointer select-none items-center gap-2',
                    'rounded-lg px-3 py-2 text-xs leading-none outline-none',
                    'text-red-600 dark:text-red-400',
                    'data-[highlighted]:bg-red-500/10 dark:data-[highlighted]:bg-red-500/20',
                    'transition-colors duration-150',
                  ]"
                  @click="isDeleteOpen = true"
                >
                  <div class="i-solar:trash-bin-trash-bold-duotone text-sm" />
                  <span>Delete Character</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>

        <!-- Character Artwork Bust (Bottom Right Hero Placement) -->
        <div class="pointer-events-none absolute right-4 z-1 h-44 w-44 flex select-none items-end justify-center -bottom-2 md:right-8 sm:right-6 md:h-60 md:w-60 sm:h-52 sm:w-52">
          <CharacterAvatar
            :card-id="cardId"
            :name="characterDisplayName"
            :display-model-id="displayModelId"
            shape="square"
            size-class="h-full w-full"
            avatar-class="h-full w-full object-contain object-bottom drop-shadow-[0_15px_30px_rgba(0,0,0,0.6)]"
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
              <MarkdownRenderer :content="formattedDescription" />
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
                <MarkdownRenderer v-if="card.personality" :content="formattedPersonality" />
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
                <MarkdownRenderer v-if="card.scenario" :content="formattedScenario" />
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

        <!-- RIGHT 1 COLUMN: Modules Section Grouped by Purpose -->
        <div class="lg:col-span-1 space-y-3">
          <h2 class="text-base text-neutral-900 font-bold dark:text-white">
            Modules
          </h2>

          <div
            v-for="group in moduleGroups"
            :key="group.title"
            class="border border-neutral-200/80 rounded-xl bg-neutral-50/60 p-3.5 space-y-2 dark:border-neutral-800/80 dark:bg-neutral-900/40"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div :class="group.icon" class="text-sm text-primary-500" />
                <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">{{ group.title }}</span>
              </div>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-medium"
                :class="group.isCustom
                  ? 'border border-primary-500/30 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                  : 'border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400'"
              >
                {{ group.isCustom ? 'Card' : 'Global' }}
              </span>
            </div>

            <div class="pt-1 space-y-1.5">
              <div
                v-for="item in group.items"
                :key="item.label"
                class="flex items-center justify-between text-xs"
              >
                <span class="text-neutral-400 dark:text-neutral-500">{{ item.label }}</span>
                <span class="max-w-[150px] truncate text-right text-neutral-700 font-medium dark:text-neutral-300">{{ item.value }}</span>
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
  subtitleKey: settings.title
  descriptionKey: settings.pages.card.description
  icon: i-solar:user-bold-duotone
  settingsEntry: false
  order: 2
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
