<script setup lang="ts">
/**
 * What a character shows when its model cannot render — the §5.6 table, rendered (§5.6 rows 1–8).
 *
 * The one rule this view exists to keep: **a missing model is not an error, a missing profile is.** Rows 1, 2, 3, 5
 * and 6 are states with an action; rows 7 and 8 are the two the user has to resolve, and only row 7 is one the
 * driver itself reports. Nothing here invents a reason: the caller passes the state the table produced.
 */
import type { AvatarStateResult } from '@proj-airi/stage-renderer-sdk/host'

import { Button } from '@proj-airi/ui'
import { computed } from 'vue'

const props = defineProps<{
  state: AvatarStateResult
  characterName?: string
  /** Whether the legacy renderer for this format is still in the build, for row 2 vs row 3's copy. */
  legacyRendererAvailable?: boolean
}>()

const emit = defineEmits<{
  (event: 'action'): void
}>()

const copy = computed(() => {
  switch (props.state.state) {
    case 'unbound':
      return { title: 'No model yet', body: 'This character has not been given a model. Choose one to give it a body.', action: 'Choose a model' }
    case 'legacy':
      return { title: 'Using the legacy model', body: 'This character still renders through the old renderer. It works; migrating moves it to the driver and keeps it working.', action: 'Migrate' }
    case 'legacy-unavailable':
      return { title: 'Model unavailable', body: 'The renderer that served this model has been removed. The character itself is fine — migrate it now to give it a body again.', action: 'Migrate now' }
    case 'model-missing':
      return { title: 'Model unavailable', body: 'The driver no longer holds this model. The character is fine; import the model or choose another.', action: 'Import or choose a model' }
    case 'driver-missing':
      return { title: 'Driver unavailable', body: 'The driver that renders this model is disabled or not installed. Enable it to show the model again.', action: 'Enable driver' }
    case 'profile-missing':
      return { title: 'Profile missing', body: 'This binding names a profile the driver does not have, so the character cannot be rendered as configured. Choose a profile.', action: 'Choose a profile' }
    case 'invalid':
      return { title: 'Binding is inconsistent', body: 'The card names some, but not all, of the ids a model binding needs. Re-bind the character to a model.', action: 'Re-bind' }
    case 'bound':
    default:
      return { title: 'Model unavailable', body: 'The model could not be rendered right now. The binding is intact; try again, or open the model controls.', action: 'Model controls' }
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
