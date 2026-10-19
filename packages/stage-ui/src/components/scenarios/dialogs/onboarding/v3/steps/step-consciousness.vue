<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ConsciousnessWorkspace from '../../../../consciousness/ConsciousnessWorkspace.vue'
import AssistantBubble from '../components/assistant-bubble.vue'
import ProviderPickerGrid from '../components/provider-picker-grid.vue'

const props = defineProps<{
  onNext: () => void
  onPrevious: () => void
}>()

const emit = defineEmits<{
  (e: 'verified'): void
}>()

// Retain ProviderPickerGrid binding for compile script metadata inspection
void ProviderPickerGrid

const { t } = useI18n()

const workspaceRef = ref<InstanceType<typeof ConsciousnessWorkspace> | null>(null)
const showSkipWarning = ref(false)

const verified = computed(() => workspaceRef.value?.verified ?? false)

function handleNextClick() {
  if (verified.value) {
    props.onNext()
  }
}

function handleSkipClick() {
  if (verified.value) {
    props.onNext()
  }
  else {
    showSkipWarning.value = true
  }
}

function confirmSkipAnyway() {
  showSkipWarning.value = false
  props.onNext()
}
</script>

<template>
  <div :class="['w-full h-full flex flex-col justify-between select-none animate-fadeIn']">
    <!-- Scrollable Content Body -->
    <div :class="['flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-2 flex flex-col gap-4']">
      <!-- Shared centered header -->
      <div :class="['flex flex-col items-center text-center gap-3']">
        <div
          v-motion
          :initial="{ opacity: 0, y: -6 }"
          :enter="{ opacity: 1, y: 0 }"
          :duration="350"
          :class="['text-center']"
        >
          <h1 :class="['text-2xl font-bold tracking-tight text-neutral-900 dark:text-white']">
            {{ t('onboarding.steps.consciousness.title') }}
          </h1>
        </div>

        <AssistantBubble
          :message="t('onboarding.steps.consciousness.assistantMessage')"
          step-key="consciousness"
          sticker-id="airi-awkward"
          tone="primary"
        />
      </div>

      <!-- Decomposed Shared Workspace Component -->
      <ConsciousnessWorkspace
        ref="workspaceRef"
        mode="onboarding"
        @verified="emit('verified')"
      />
    </div>

    <!-- Shared footer -->
    <div
      :class="[
        'flex-shrink-0 pt-4 px-4 sm:px-6 flex items-center justify-between border-t border-neutral-200/80 dark:border-neutral-800/80 gap-2',
      ]"
    >
      <button
        type="button"
        :class="[
          'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer flex-shrink-0',
          'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white',
          'hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors',
        ]"
        @click="props.onPrevious"
      >
        <div :class="['i-solar:alt-arrow-left-line-duotone h-4 w-4']" />
        <span>{{ t('onboarding.shell.previous') }}</span>
      </button>

      <!-- Center Status Hint -->
      <div :class="['text-[11px] text-neutral-400 font-medium italic hidden sm:block text-center truncate max-w-sm min-w-0']">
        <span v-if="verified" class="text-emerald-500 font-semibold not-italic dark:text-emerald-400">
          {{ t('onboarding.steps.consciousness.brainConnectionVerifiedReadyToProceed') }}
        </span>
        <span v-else>
          {{ t('onboarding.steps.consciousness.chooseAndTest') }}
        </span>
      </div>

      <!-- Action Group: Skip Step + Next -->
      <div :class="['flex items-center gap-3 flex-shrink-0']">
        <button
          type="button"
          :class="[
            'px-3.5 py-2 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white',
            'hover:bg-neutral-100 dark:hover:bg-white/5 rounded-xl transition-colors cursor-pointer min-h-[44px]',
          ]"
          @click="handleSkipClick"
        >
          {{ t('onboarding.shell.skip') }}
        </button>

        <Button
          variant="primary"
          size="md"
          :disabled="!verified"
          :class="[
            'flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-500 px-5 py-2 min-h-[44px]',
            'text-xs font-semibold text-white shadow-md shadow-primary-600/25 transition-all active:scale-95 cursor-pointer',
            !verified ? 'opacity-40 cursor-not-allowed hover:bg-primary-600' : '',
          ]"
          @click="handleNextClick"
        >
          <span>{{ t('onboarding.shell.next') }}</span>
          <div :class="['i-solar:alt-arrow-right-line-duotone h-4 w-4']" />
        </Button>
      </div>
    </div>

    <!-- Skip Warning Guard Modal -->
    <div
      v-if="showSkipWarning"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div class="max-w-sm w-full border border-neutral-200 rounded-2xl bg-white p-5 shadow-2xl space-y-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-center gap-3 text-amber-500">
          <div class="i-solar:danger-triangle-bold-duotone text-2xl" />
          <h3 class="text-sm text-neutral-800 font-bold dark:text-neutral-100">
            {{ t('onboarding.steps.consciousness.proceedWithoutAnAiBrain') }}
          </h3>
        </div>
        <p class="text-xs text-neutral-600 leading-relaxed dark:text-neutral-300">
          {{ t('onboarding.steps.consciousness.withoutAnActiveAiModelYourCompanionWillNotBeAbleToTalkThinkOrRe') }}
        </p>
        <div class="flex flex-col gap-2 pt-2">
          <button
            type="button"
            class="min-h-[44px] w-full cursor-pointer rounded-xl bg-primary-500 py-2.5 text-xs text-white font-bold shadow-md transition hover:bg-primary-600"
            @click="showSkipWarning = false"
          >
            {{ t('onboarding.steps.consciousness.stayConfigureBrainRecommended') }}
          </button>
          <button
            type="button"
            class="min-h-[44px] w-full cursor-pointer border border-neutral-200 rounded-xl py-2 text-xs text-neutral-500 font-semibold transition dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            @click="confirmSkipAnyway"
          >
            {{ t('onboarding.steps.consciousness.skipAnywayConfigureLaterInSettings') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
