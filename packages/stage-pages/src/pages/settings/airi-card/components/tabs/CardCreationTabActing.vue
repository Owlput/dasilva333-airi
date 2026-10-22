<script setup lang="ts">
import type { SpeechCapabilitiesInfo } from '@proj-airi/stage-ui/stores/providers'
import type { CharacterCueAllowlist } from '@proj-airi/stage-ui/types/card.schema'
import type { ThinkingFillerPhrase } from '@proj-airi/stage-ui/types/pacing'

import { DEFAULT_PACING_FILLERS } from '@proj-airi/stage-ui/types/pacing'
import { computed, ref, watch } from 'vue'

import ActingSubTabCadence from './acting/ActingSubTabCadence.vue'
import ActingSubTabCues from './acting/ActingSubTabCues.vue'
import ActingSubTabIdling from './acting/ActingSubTabIdling.vue'
import ActingSubTabStickers from './acting/ActingSubTabStickers.vue'
import ActingSubTabThinking from './acting/ActingSubTabThinking.vue'
import ActingSubTabVoice from './acting/ActingSubTabVoice.vue'

import { useActingCapabilities } from '../../composables/useActingCapabilities'

interface Props {
  actingModelEmotionOptions?: string[]
  actingModelMotionOptions?: string[]
  actingGroupedExpressionTags?: { category: string, tags: { tag: string, description?: string }[] }[]
  actingMannerismOptions?: NonNullable<SpeechCapabilitiesInfo['mannerisms']>
  actingSpeechCapabilitiesLoading?: boolean
  selectedSpeechProviderLabel?: string
  isLive2d?: boolean
  insertModelEmotion?: (name: string) => void
  insertModelMotion?: (name: string) => void
  insertModelVfx?: (name: string) => void
  insertSpeechTag?: (tag: string, description?: string) => void
  insertSpeechMannerism?: (id: string) => void
  actingIdleAnimationOptions?: { label: string, value: string }[]
  selectedDisplayModelId?: string
  selectedSpeechProvider?: string
  selectedSpeechModel?: string
  selectedSpeechVoiceId?: string
  cardId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
}>()

const capabilities = useActingCapabilities({
  selectedDisplayModelId: () => props.selectedDisplayModelId,
  selectedSpeechProvider: () => props.selectedSpeechProvider,
})

const actingModelEmotionOptions = computed(() => props.actingModelEmotionOptions ?? capabilities.actingModelEmotionOptions.value)
const actingModelMotionOptions = computed(() => props.actingModelMotionOptions ?? capabilities.actingModelMotionOptions.value)
const actingIdleAnimationOptions = computed(() => props.actingIdleAnimationOptions ?? capabilities.actingIdleAnimationOptions.value)
const actingGroupedExpressionTags = computed(() => props.actingGroupedExpressionTags ?? capabilities.actingGroupedExpressionTags.value)
const actingMannerismOptions = computed(() => props.actingMannerismOptions ?? capabilities.actingMannerismOptions.value)
const actingSpeechCapabilitiesLoading = computed(() => props.actingSpeechCapabilitiesLoading ?? capabilities.actingSpeechCapabilitiesLoading.value)
const isLive2d = computed(() => props.isLive2d ?? capabilities.isLive2d.value)
const selectedSpeechProviderLabel = computed(() => props.selectedSpeechProviderLabel || props.selectedSpeechProvider || capabilities.defaultSpeechModel.value || 'none')

function insertModelEmotion(name: string) {
  if (props.insertModelEmotion) {
    props.insertModelEmotion(name)
  }
  else {
    capabilities.insertModelEmotion(selectedActingModelExpressionPrompt, name)
  }
}

function insertModelMotion(name: string) {
  if (props.insertModelMotion) {
    props.insertModelMotion(name)
  }
  else {
    capabilities.insertModelMotion(selectedActingModelExpressionPrompt, name)
  }
}

function insertSpeechTag(tag: string, description?: string) {
  if (props.insertSpeechTag) {
    props.insertSpeechTag(tag, description)
  }
  else {
    capabilities.insertSpeechTag(selectedActingSpeechExpressionPrompt, tag, description)
  }
}

function insertSpeechMannerism(id: string) {
  if (props.insertSpeechMannerism) {
    props.insertSpeechMannerism(id)
  }
  else {
    capabilities.insertSpeechMannerism(selectedActingSpeechMannerismPrompt, id)
  }
}

watch(() => props.selectedSpeechProvider, (newProvider) => {
  if (newProvider) {
    void capabilities.loadActingSpeechCapabilities(newProvider)
  }
}, { immediate: true })

// Existing Acting Models
const selectedActingModelExpressionPrompt = defineModel<string>('selectedActingModelExpressionPrompt', { required: true })
const selectedActingSpeechExpressionPrompt = defineModel<string>('selectedActingSpeechExpressionPrompt', { required: true })
const selectedActingSpeechMannerismPrompt = defineModel<string>('selectedActingSpeechMannerismPrompt', { required: true })
const selectedActingIdleAnimations = defineModel<string[]>('selectedActingIdleAnimations', { required: true })

// Autonomous Cues (System-1 Interceptor) & Allowlist Models
const selectedActingCueAllowlist = defineModel<CharacterCueAllowlist | undefined>('selectedActingCueAllowlist')
const autoCuesEnabled = defineModel<boolean>('autoCuesEnabled', { default: false })
const autoCueExpressions = defineModel<boolean>('autoCueExpressions', { default: true })
const autoCueMotions = defineModel<boolean>('autoCueMotions', { default: false })

// Conversational Pacing Models
const pacingEnabled = defineModel<boolean>('pacingEnabled', { default: false })
const pacingArmMinMs = defineModel<number>('pacingArmMinMs', { default: 1200 })
const pacingArmMaxMs = defineModel<number>('pacingArmMaxMs', { default: 3500 })
const pacingMaxFillerDurationMs = defineModel<number>('pacingMaxFillerDurationMs', { default: 3000 })
const pacingCategoryThreshold = defineModel<number>('pacingCategoryThreshold', { default: 1 })
const pacingMaxFillersPerTurn = defineModel<number>('pacingMaxFillersPerTurn', { default: 3 })
const pacingIntervalMs = defineModel<number>('pacingIntervalMs', { default: 15000 })
const pacingFillers = defineModel<ThinkingFillerPhrase[]>('pacingFillers', {
  default: () => [...DEFAULT_PACING_FILLERS],
})

// Phase 6 Dynamic Pacing Models
const pacingDynamicAsidesEnabled = defineModel<boolean>('pacingDynamicAsidesEnabled', { default: false })
const pacingSemanticExtractorEnabled = defineModel<boolean>('pacingSemanticExtractorEnabled', { default: false })
const pacingDynamicAfterMs = defineModel<number>('pacingDynamicAfterMs', { default: 15000 })
const pacingCandidateTtlMs = defineModel<number>('pacingCandidateTtlMs', { default: 15000 })
const pacingMaxFillerSynthesisBudgetMs = defineModel<number>('pacingMaxFillerSynthesisBudgetMs', { default: 3200 })
const pacingMaxSynthesisBudgetMs = defineModel<number>('pacingMaxSynthesisBudgetMs', { default: 3200 })
const pacingProfile = defineModel<string>('pacingProfile', { default: 'balanced' })
const pacingExperimentalOrganicPivots = defineModel<boolean>('pacingExperimentalOrganicPivots', { default: false })

// Conversational Cadence (Multi-Bubble Burst) Models
const cadenceMultiBubbleEnabled = defineModel<boolean>('cadenceMultiBubbleEnabled', { default: false })
const cadenceSplitThreshold = defineModel<number>('cadenceSplitThreshold', { default: 0.45 })
const cadenceInterBubblePauseMs = defineModel<number>('cadenceInterBubblePauseMs', { default: 800 })
const cadenceTypingCadenceMsPerChar = defineModel<number>('cadenceTypingCadenceMsPerChar', { default: 45 })
const cadenceMaxBubblesPerTurn = defineModel<number>('cadenceMaxBubblesPerTurn', { default: 4 })
const cadenceDynamicPacingEnabled = defineModel<boolean>('cadenceDynamicPacingEnabled', { default: true })
const cadenceRapidBurstMs = defineModel<number>('cadenceRapidBurstMs', { default: 350 })
const cadenceConversationalBeatMs = defineModel<number>('cadenceConversationalBeatMs', { default: 900 })
const cadenceThoughtfulPauseMs = defineModel<number>('cadenceThoughtfulPauseMs', { default: 1800 })
const cadenceMaxDelayCeilingMs = defineModel<number>('cadenceMaxDelayCeilingMs', { default: 3500 })

// Sticker Directives & Desktop Slappers Models
const selectedActingStickerDirectivesPrompt = defineModel<string>('selectedActingStickerDirectivesPrompt', { default: '' })
const selectedActingStickerWidgetsEnabled = defineModel<boolean>('selectedActingStickerWidgetsEnabled', { default: false })
const selectedActingActiveStickerIds = defineModel<string[]>('selectedActingActiveStickerIds', { default: () => [] })

// Sub-Tab Navigation (6 Hubs with Cadence replacing standalone Lab)
type ActingSubTabId = 'expressions' | 'idling' | 'speech' | 'pacing' | 'cadence' | 'stickers'
const activeSubTab = ref<ActingSubTabId>('expressions')

const subTabs = [
  { id: 'expressions' as const, label: 'Cues', icon: 'i-solar:smile-circle-bold-duotone', desc: 'Avatar gestures, ACT directives, autonomous cues' },
  { id: 'idling' as const, label: 'Idling', icon: 'i-solar:running-bold-duotone', desc: 'Continuous idle loops, cycle motions & avatar customizer' },
  { id: 'speech' as const, label: 'Voice', icon: 'i-solar:soundwave-bold-duotone', desc: 'Voice acting, audio tags, vocal mannerisms & caption FX' },
  { id: 'pacing' as const, label: 'Thinking', icon: 'i-solar:hourglass-bold-duotone', desc: 'Thinking fillers, live spoken asides & deliberation cadence' },
  { id: 'cadence' as const, label: 'Cadence', icon: 'i-solar:chat-round-line-bold-duotone', desc: 'Single-turn multi-bubble delivery & Jev System-1 cadence' },
  { id: 'stickers' as const, label: 'Stickers', icon: 'i-solar:sticker-smile-circle-bold-duotone', desc: 'Chibi reaction stickers & desktop stage slappers' },
]
</script>

<template>
  <div class="tab-content ml-auto mr-auto w-full">
    <!-- Header Summary -->
    <div class="mb-4">
      <h3 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
        Acting & Behavioral Performance
      </h3>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        Configure avatar cues, idle motions, voice mannerisms, thinking pauses, and interactive performance simulation.
      </p>
    </div>

    <!-- Sub-Navigation Segmented Pill Bar -->
    <div class="mb-5 flex flex-wrap items-center gap-1 border border-neutral-200 rounded-xl bg-neutral-100/70 p-1 dark:border-neutral-800 dark:bg-neutral-900/60">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        type="button"
        :class="[
          'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-150',
          activeSubTab === tab.id
            ? 'bg-white dark:bg-neutral-800 text-primary-600 dark:text-primary-400 shadow-sm border border-neutral-200/80 dark:border-neutral-700'
            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50',
        ]"
        @click="activeSubTab = tab.id"
      >
        <span :class="[tab.icon, 'text-sm shrink-0']" />
        <span class="font-medium">{{ tab.label }}</span>
      </button>
    </div>

    <!-- Sub-Tab Panels Container -->
    <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <!-- 0. CUES SUB-TAB -->
      <ActingSubTabCues
        v-if="activeSubTab === 'expressions'"
        v-model:selected-acting-model-expression-prompt="selectedActingModelExpressionPrompt"
        v-model:selected-acting-cue-allowlist="selectedActingCueAllowlist"
        v-model:auto-cues-enabled="autoCuesEnabled"
        v-model:auto-cue-expressions="autoCueExpressions"
        v-model:auto-cue-motions="autoCueMotions"
        :acting-model-emotion-options="actingModelEmotionOptions"
        :acting-model-motion-options="actingModelMotionOptions"
        :selected-display-model-id="props.selectedDisplayModelId || capabilities.activeModelId.value"
        :is-live2d="isLive2d"
        :insert-model-emotion="insertModelEmotion"
        :insert-model-motion="insertModelMotion"
        :insert-model-vfx="props.insertModelVfx"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />

      <!-- 1. IDLING SUB-TAB -->
      <ActingSubTabIdling
        v-else-if="activeSubTab === 'idling'"
        v-model:selected-acting-idle-animations="selectedActingIdleAnimations"
        :acting-idle-animation-options="actingIdleAnimationOptions"
        :selected-display-model-id="props.selectedDisplayModelId || capabilities.activeModelId.value"
      />

      <!-- 2. VOICE SUB-TAB -->
      <ActingSubTabVoice
        v-else-if="activeSubTab === 'speech'"
        v-model:selected-acting-speech-expression-prompt="selectedActingSpeechExpressionPrompt"
        :selected-speech-provider-label="selectedSpeechProviderLabel"
        :acting-speech-capabilities-loading="actingSpeechCapabilitiesLoading"
        :acting-grouped-expression-tags="actingGroupedExpressionTags"
        :acting-mannerism-options="actingMannerismOptions"
        :insert-speech-tag="insertSpeechTag"
        :insert-speech-mannerism="insertSpeechMannerism"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />

      <!-- 3. THINKING SUB-TAB -->
      <ActingSubTabThinking
        v-else-if="activeSubTab === 'pacing'"
        v-model:selected-acting-speech-mannerism-prompt="selectedActingSpeechMannerismPrompt"
        v-model:pacing-enabled="pacingEnabled"
        v-model:pacing-arm-min-ms="pacingArmMinMs"
        v-model:pacing-arm-max-ms="pacingArmMaxMs"
        v-model:pacing-max-filler-duration-ms="pacingMaxFillerDurationMs"
        v-model:pacing-category-threshold="pacingCategoryThreshold"
        v-model:pacing-max-fillers-per-turn="pacingMaxFillersPerTurn"
        v-model:pacing-interval-ms="pacingIntervalMs"
        v-model:pacing-fillers="pacingFillers"
        v-model:pacing-dynamic-asides-enabled="pacingDynamicAsidesEnabled"
        v-model:pacing-semantic-extractor-enabled="pacingSemanticExtractorEnabled"
        v-model:pacing-dynamic-after-ms="pacingDynamicAfterMs"
        v-model:pacing-candidate-ttl-ms="pacingCandidateTtlMs"
        v-model:pacing-max-filler-synthesis-budget-ms="pacingMaxFillerSynthesisBudgetMs"
        v-model:pacing-max-synthesis-budget-ms="pacingMaxSynthesisBudgetMs"
        v-model:pacing-profile="pacingProfile"
        v-model:pacing-experimental-organic-pivots="pacingExperimentalOrganicPivots"
        :selected-speech-provider="props.selectedSpeechProvider"
        :selected-speech-model="props.selectedSpeechModel"
        :selected-speech-voice-id="props.selectedSpeechVoiceId"
        :selected-speech-provider-label="selectedSpeechProviderLabel"
        :acting-mannerism-options="actingMannerismOptions"
        :insert-speech-mannerism="insertSpeechMannerism"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />

      <!-- 4. CADENCE SUB-TAB -->
      <ActingSubTabCadence
        v-else-if="activeSubTab === 'cadence'"
        v-model:multi-bubble-enabled="cadenceMultiBubbleEnabled"
        v-model:split-threshold="cadenceSplitThreshold"
        v-model:inter-bubble-pause-ms="cadenceInterBubblePauseMs"
        v-model:typing-cadence-ms-per-char="cadenceTypingCadenceMsPerChar"
        v-model:max-bubbles-per-turn="cadenceMaxBubblesPerTurn"
        v-model:dynamic-pacing-enabled="cadenceDynamicPacingEnabled"
        v-model:rapid-burst-ms="cadenceRapidBurstMs"
        v-model:conversational-beat-ms="cadenceConversationalBeatMs"
        v-model:thoughtful-pause-ms="cadenceThoughtfulPauseMs"
        v-model:max-delay-ceiling-ms="cadenceMaxDelayCeilingMs"
      />

      <!-- 5. STICKERS SUB-TAB -->
      <ActingSubTabStickers
        v-else-if="activeSubTab === 'stickers'"
        v-model:sticker-directives-prompt="selectedActingStickerDirectivesPrompt"
        v-model:sticker-widgets-enabled="selectedActingStickerWidgetsEnabled"
        v-model:active-sticker-ids="selectedActingActiveStickerIds"
        :card-id="props.cardId"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />
    </div>
  </div>
</template>
