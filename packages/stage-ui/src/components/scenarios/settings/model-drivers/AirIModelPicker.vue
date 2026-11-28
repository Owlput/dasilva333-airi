<script setup lang="ts">
/**
 * AIRI's own picker: the list of models the host already holds a record for (§5.6).
 *
 * Deliberately dumber than a driver picker and deliberately not a replacement for one: it lists **persisted rows**,
 * warns when a row cannot load, and binds it anyway. "Bind a model this device cannot currently load" is a
 * supported action — the card is a reference, and a missing referent is not an error (D4) — because refusing would
 * make an imported library unusable while one driver is disabled.
 *
 * The reasons it may warn with are `UnavailableModelReason`, one vocabulary shared with the stage and the card
 * editor so three views cannot disagree about why nothing renders.
 */
import type { ModelDriverAdapter, ModelDriverId, ModelSummary, UnavailableModelReason } from '@proj-airi/stage-renderer-sdk'
import type { ModelSelection } from '@proj-airi/stage-renderer-sdk'

import { Button } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{
  adapter: ModelDriverAdapter
  driverId: ModelDriverId
  currentModelId?: string
  currentProfileId?: string
  /** Why the current binding cannot render, when the caller already knows; shown above the list. */
  currentReason?: UnavailableModelReason
}>()

const emit = defineEmits<{
  (event: 'select', selection: ModelSelection): void
  (event: 'cancel'): void
}>()

const rows = ref<ModelSummary[]>([])
const loading = ref(true)
const error = ref<string>()
const filter = ref('')

const visible = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  const list = needle
    ? rows.value.filter(row => `${row.name} ${row.profileName ?? ''}`.toLowerCase().includes(needle))
    : rows.value
  return list
})

async function load() {
  loading.value = true
  error.value = undefined
  // A pull asks the manager, which asks a renderer: the cache is a display fallback, never the source of truth
  // (P1-D20), so this refreshes it rather than reading `hostState().rows` alone.
  const pulled = await props.adapter.pullRows(props.driverId)
  if (pulled.ok)
    rows.value = pulled.value
  else
    error.value = pulled.error.message
  loading.value = false
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="currentReason" class="border border-amber-500/40 rounded p-2 text-xs text-amber-200">
      The character's current model is unavailable ({{ currentReason }}). You can bind another model now; the
      binding is a reference, and replacing it costs nothing the character cannot re-bind.
    </p>
    <p class="text-xs text-neutral-400">
      These are the models AIRI holds a record for. Binding one does not import it, and a model this device cannot
      load is still listed — choosing it would only make the character unavailable until a driver can serve it.
    </p>

    <input
      v-model="filter"
      type="search"
      placeholder="Filter models…"
      class="w-full rounded bg-neutral-900/70 px-2 py-1 text-xs text-neutral-200 outline-none"
    >

    <div v-if="loading" class="p-2 text-xs text-neutral-400">
      Reading the driver's model list…
    </div>
    <div v-else-if="error" class="border border-red-500/40 rounded p-2 text-xs text-red-300">
      {{ error }}
    </div>
    <div v-else-if="visible.length === 0" class="p-2 text-xs text-neutral-400">
      This driver reports no imported models.
    </div>

    <ul v-else class="max-h-80 flex flex-col gap-1 overflow-y-auto">
      <li v-for="row in visible" :key="`${row.modelId}/${row.profileId}`">
        <button
          type="button"
          class="w-full flex items-center justify-between rounded px-2 py-1 text-left text-xs"
          :class="row.modelId === currentModelId && row.profileId === currentProfileId
            ? 'bg-neutral-700 text-white'
            : 'bg-neutral-800/60 text-neutral-200'"
          @click="emit('select', { modelId: row.modelId, profileId: row.profileId })"
        >
          <span>
            {{ row.name }}
            <span v-if="row.profileName" class="text-neutral-400">· {{ row.profileName }}</span>
          </span>
          <span v-if="row.modelId === currentModelId && row.profileId === currentProfileId" class="text-[10px] text-neutral-300">current</span>
        </button>
      </li>
    </ul>

    <div class="flex justify-between gap-2">
      <Button variant="ghost" size="sm" label="Refresh" :loading="loading" @click="load" />
      <Button variant="secondary" size="sm" label="Cancel" @click="emit('cancel')" />
    </div>
  </div>
</template>
