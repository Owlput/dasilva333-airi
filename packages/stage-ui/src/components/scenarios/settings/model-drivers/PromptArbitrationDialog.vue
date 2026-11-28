<script setup lang="ts">
/**
 * The prompt arbitration surface (§5.4, D5).
 *
 * A disagreement between the current publication (this device) and the card's snapshot is **detected by AIRI and
 * arbitrated by the user**. While it stands, no model prompt is injected for that binding — the character renders
 * with less, which is a normal state, not an error — and the losing copy is not AIRI's to keep: after the choice,
 * the host hands the resolved pair back to the driver, where the history lives (P1-D26).
 *
 * So this dialog shows exactly the two copies AIRI actually holds, with the version and provenance of each, and
 * offers two buttons. It cannot show earlier versions, because AIRI never kept them.
 *
 * It owns its overlay because the surface that raises it is the stage: activation is where the disagreement is
 * found, and the stage must not have to know what a modal looks like. There is deliberately no dismiss action —
 * while a conflict stands nothing is injected, and nothing else in the app can resolve it, so a "close" button would
 * only strand the character in the no-prompt state it is already in.
 */
import type { ModelPromptPublication, ModelPromptSnapshot } from '@proj-airi/stage-renderer-sdk'
import type { PromptConflict } from '@proj-airi/stage-renderer-sdk/host'

import { Button } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  characterName?: string
  conflict: PromptConflict
}>()

const emit = defineEmits<{
  (event: 'resolve', winner: 'device' | 'card'): void
}>()

const { t } = useI18n()

const device = computed<ModelPromptPublication | undefined>(() => props.conflict.device)
const card = computed<ModelPromptSnapshot>(() => props.conflict.card)

const deviceTokens = computed(() => device.value?.tokens ?? [])
const cardTokens = computed(() => card.value.tokens)

/** The possessive the description opens with: the character's name when the caller knows it. */
const character = computed(() => props.characterName ? `${props.characterName}'s` : t('stage.model-drivers.prompt-arbitration.character-generic'))

function publishedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}
</script>

<template>
  <div
    :class="[
      'fixed inset-0 z-[60]',
      'flex items-center justify-center',
      'bg-black/60 p-4',
    ]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="prompt-arbitration-title"
  >
    <div
      :class="[
        'max-h-[85vh] w-full max-w-2xl flex flex-col gap-3 overflow-y-auto',
        'border border-neutral-200 rounded-2xl bg-white p-4 shadow-xl',
        'dark:border-neutral-800 dark:bg-neutral-900',
      ]"
    >
      <header class="flex flex-col gap-1">
        <h2 id="prompt-arbitration-title" class="text-base text-neutral-900 font-semibold dark:text-neutral-100">
          {{ t('stage.model-drivers.prompt-arbitration.title') }}
        </h2>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('stage.model-drivers.prompt-arbitration.description', { character }) }}
        </p>
      </header>

      <div class="grid gap-2 sm:grid-cols-2">
        <article
          :class="[
            'flex flex-col gap-1',
            'border border-neutral-200 rounded-lg p-2',
            'dark:border-neutral-700/60',
          ]"
        >
          <h3 class="text-xs text-neutral-600 font-semibold tracking-wide uppercase dark:text-neutral-300">
            {{ t('stage.model-drivers.prompt-arbitration.device-heading') }}
          </h3>
          <p class="text-[11px] text-neutral-500">
            <template v-if="device">
              {{ t('stage.model-drivers.prompt-arbitration.version', { version: device.version, date: publishedAt(device.publishedAt) }) }}
            </template>
            <template v-else>
              {{ t('stage.model-drivers.prompt-arbitration.nothing-published') }}
            </template>
          </p>
          <pre
            :class="[
              'max-h-48 overflow-y-auto',
              'whitespace-pre-wrap break-words',
              'text-xs text-neutral-700 dark:text-neutral-200',
            ]"
          >{{ device?.text ?? t('stage.model-drivers.prompt-arbitration.nothing-published-body') }}</pre>
          <p class="text-[11px] text-neutral-500">
            {{ t('stage.model-drivers.prompt-arbitration.tokens', { tokens: deviceTokens.length > 0 ? deviceTokens.join(', ') : t('stage.model-drivers.prompt-arbitration.tokens-none') }) }}
          </p>
          <Button
            variant="secondary"
            size="sm"
            :label="t('stage.model-drivers.prompt-arbitration.use-device')"
            @click="emit('resolve', 'device')"
          />
        </article>

        <article
          :class="[
            'flex flex-col gap-1',
            'border border-neutral-200 rounded-lg p-2',
            'dark:border-neutral-700/60',
          ]"
        >
          <h3 class="text-xs text-neutral-600 font-semibold tracking-wide uppercase dark:text-neutral-300">
            {{ t('stage.model-drivers.prompt-arbitration.card-heading') }}
          </h3>
          <p class="text-[11px] text-neutral-500">
            {{ t('stage.model-drivers.prompt-arbitration.version', { version: card.version, date: publishedAt(card.publishedAt) }) }}
          </p>
          <pre
            :class="[
              'max-h-48 overflow-y-auto',
              'whitespace-pre-wrap break-words',
              'text-xs text-neutral-700 dark:text-neutral-200',
            ]"
          >{{ card.text }}</pre>
          <p class="text-[11px] text-neutral-500">
            {{ t('stage.model-drivers.prompt-arbitration.tokens', { tokens: cardTokens.length > 0 ? cardTokens.join(', ') : t('stage.model-drivers.prompt-arbitration.tokens-none') }) }}
          </p>
          <Button
            variant="secondary"
            size="sm"
            :label="t('stage.model-drivers.prompt-arbitration.use-card')"
            @click="emit('resolve', 'card')"
          />
        </article>
      </div>

      <p class="text-[11px] text-neutral-500">
        {{ t('stage.model-drivers.prompt-arbitration.footnote') }}
      </p>
    </div>
  </div>
</template>
