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
 */
import type { ModelPromptPublication, ModelPromptSnapshot } from '@proj-airi/stage-renderer-sdk'
import type { PromptConflict } from '@proj-airi/stage-renderer-sdk/host'

import { Button } from '@proj-airi/ui'
import { computed } from 'vue'

const props = defineProps<{
  characterName?: string
  conflict: PromptConflict
}>()

const emit = defineEmits<{
  (event: 'resolve', winner: 'device' | 'card'): void
}>()

const device = computed<ModelPromptPublication | undefined>(() => props.conflict.device)
const card = computed<ModelPromptSnapshot>(() => props.conflict.card)

const deviceTokens = computed(() => device.value?.tokens ?? [])
const cardTokens = computed(() => card.value.tokens)
</script>

<template>
  <div class="max-w-2xl flex flex-col gap-3 p-1 text-sm">
    <header>
      <h2 class="text-base text-neutral-100 font-semibold">
        Two different model prompts
      </h2>
      <p class="text-xs text-neutral-400">
        <template v-if="characterName">
          {{ characterName }}'s
        </template><template v-else>
          This character's
        </template>
        card and this device disagree about the model prompt. Neither is newer in a way this app can trust, so it
        is asking you. Until you choose, no model prompt is used for this character.
      </p>
    </header>

    <div class="grid gap-2 sm:grid-cols-2">
      <article class="flex flex-col gap-1 border border-neutral-700/60 rounded p-2">
        <h3 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          On this device
        </h3>
        <p class="text-[11px] text-neutral-500">
          version {{ device?.version ?? '(none)' }} · published {{ device ? new Date(device.publishedAt).toLocaleString() : '—' }}
        </p>
        <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs text-neutral-200">{{ device?.text ?? '(nothing published on this device)' }}</pre>
        <p class="text-[11px] text-neutral-500">
          Tokens: {{ deviceTokens.length > 0 ? deviceTokens.join(', ') : '(none)' }}
        </p>
        <Button variant="secondary" size="sm" label="Use this device's copy" @click="emit('resolve', 'device')" />
      </article>

      <article class="flex flex-col gap-1 border border-neutral-700/60 rounded p-2">
        <h3 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          From the card
        </h3>
        <p class="text-[11px] text-neutral-500">
          version {{ card.version }} · published {{ new Date(card.publishedAt).toLocaleString() }}
        </p>
        <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs text-neutral-200">{{ card.text }}</pre>
        <p class="text-[11px] text-neutral-500">
          Tokens: {{ cardTokens.length > 0 ? cardTokens.join(', ') : '(none)' }}
        </p>
        <Button variant="secondary" size="sm" label="Use the card's copy" @click="emit('resolve', 'card')" />
      </article>
    </div>

    <p class="text-[11px] text-neutral-500">
      Your choice is written as a new version — one above both — and handed back to the driver so its own record of
      the prompt agrees. The copy you did not choose stays in the driver's history, not here.
    </p>
  </div>
</template>
