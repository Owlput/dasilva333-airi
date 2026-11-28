<script setup lang="ts">
/**
 * What a character shows when its model cannot render — the §5.6 table, rendered (§5.6 rows 1–8).
 *
 * The one rule this view exists to keep: **a missing model is not an error, a missing profile is.** Rows 1, 2, 3, 5
 * and 6 are states with an action; rows 7 and 8 are the two the user has to resolve, and only row 7 is one the
 * driver itself reports. Nothing here invents a reason: the caller passes the state the table produced.
 *
 * The copy is one key per column per state (`{state}.title`, `.body`, `.action`) rather than a sentence chosen in
 * code, because these strings are the vocabulary three surfaces share — the stage, the character settings page and
 * the card editor — and a state added to the table without copy is exactly the drift the shared keys prevent.
 */
import type { AvatarStateResult } from '@proj-airi/stage-renderer-sdk/host'

import { AvatarState } from '@proj-airi/stage-renderer-sdk/host'
import { Button } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  state: AvatarStateResult
  characterName?: string
}>()

const emit = defineEmits<{
  (event: 'action'): void
}>()

const { t } = useI18n()

/** The states with their own copy; `bound` covers a render that failed for a reason of its own. */
const copyStates = [
  AvatarState.UNBOUND,
  AvatarState.LEGACY,
  AvatarState.LEGACY_UNAVAILABLE,
  AvatarState.MODEL_MISSING,
  AvatarState.DRIVER_MISSING,
  AvatarState.PROFILE_MISSING,
  AvatarState.INVALID,
  AvatarState.BOUND,
] as const

const copy = computed(() => {
  const known = (copyStates as readonly string[]).includes(props.state.state)
    ? props.state.state
    : AvatarState.BOUND
  const base = `settings.pages.models.model-drivers.unavailable.${known}`
  return {
    title: t(`${base}.title`),
    body: t(`${base}.body`),
    action: t(`${base}.action`),
  }
})
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 p-4 text-center">
    <h3 class="text-sm font-semibold" :class="state.error ? 'text-red-300' : 'text-neutral-200'">
      {{ copy.title }}
    </h3>
    <p class="max-w-md text-xs text-neutral-400">
      {{ copy.body }}
    </p>
    <p v-if="characterName" class="text-[11px] text-neutral-500">
      {{ characterName }}
    </p>
    <Button variant="secondary" size="sm" :label="copy.action" @click="emit('action')" />
  </div>
</template>
