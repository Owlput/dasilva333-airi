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
 *
 * Rows come from a manager pull, not from `hostState().rows`, for the same reason the stage resolves a binding with
 * a pull (P1-D20): the cache is a display fallback and a row served from it may describe a model that is gone. The
 * thumbnail a row carries is the driver's own product (P3-D21) and is shown when present; a row nobody has rendered
 * yet shows a deterministic tone and the model's initial, which is deliberately not a fake image.
 */
import type { ModelDriverAdapter, ModelDriverId, ModelSummary, UnavailableModelReason } from '@proj-airi/stage-renderer-sdk'
import type { ModelSelection } from '@proj-airi/stage-renderer-sdk'

import { Button, Input } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { unavailableReasonKey } from '../../../../libs/model-drivers/reason'

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

const { t } = useI18n()

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

/** A deterministic tone per model, so a row without a thumbnail is still stable and distinguishable. */
function hueOf(modelId: string): number {
  let hash = 0
  for (let index = 0; index < modelId.length; index++)
    hash = (hash * 31 + modelId.charCodeAt(index)) % 360
  return hash
}

function toneStyle(modelId: string) {
  const hue = hueOf(modelId)
  return {
    background: `linear-gradient(135deg, hsl(${hue} 40% 32%), hsl(${(hue + 40) % 360} 45% 16%))`,
  }
}

function isCurrent(row: ModelSummary): boolean {
  return row.modelId === props.currentModelId && row.profileId === props.currentProfileId
}

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
    <p
      v-if="currentReason"
      :class="[
        'border border-amber-500/40 rounded-lg p-2',
        'bg-amber-500/5',
        'text-xs text-amber-700 dark:text-amber-300',
      ]"
    >
      {{ t('settings.pages.models.model-drivers.airi-picker.unavailable', { reason: t(unavailableReasonKey(currentReason)) }) }}
    </p>

    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('settings.pages.models.model-drivers.airi-picker.intro') }}
    </p>

    <Input
      v-model="filter"
      type="search"
      size="sm"
      :placeholder="t('settings.pages.models.model-drivers.airi-picker.filter-placeholder')"
    />

    <p v-if="loading" class="p-2 text-xs text-neutral-500">
      {{ t('settings.pages.models.model-drivers.airi-picker.loading') }}
    </p>
    <p
      v-else-if="error"
      :class="[
        'border border-red-500/40 rounded-lg p-2',
        'bg-red-500/5',
        'text-xs text-red-600 dark:text-red-300',
      ]"
    >
      {{ error }}
    </p>
    <p v-else-if="visible.length === 0" class="p-2 text-xs text-neutral-500">
      {{ t('settings.pages.models.model-drivers.airi-picker.empty') }}
    </p>

    <ul v-else class="max-h-80 flex flex-col gap-1 overflow-y-auto p-0">
      <li v-for="row in visible" :key="`${row.modelId}/${row.profileId}`">
        <button
          type="button"
          :class="[
            'w-full flex items-center gap-2 rounded-lg p-1 text-left',
            'transition-colors duration-200 ease-in-out',
            isCurrent(row)
              ? 'bg-primary-500/10 ring-1 ring-primary-400/40'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/70',
          ]"
          @click="emit('select', { modelId: row.modelId, profileId: row.profileId })"
        >
          <img
            v-if="row.preview"
            :src="row.preview"
            alt=""
            class="h-10 w-10 flex-none rounded bg-neutral-100 object-contain dark:bg-neutral-900/60"
          >
          <span
            v-else
            :class="['h-10 w-10 flex flex-none items-center justify-center', 'rounded text-sm text-white/85']"
            :style="toneStyle(row.modelId)"
          >
            {{ row.name.slice(0, 1).toUpperCase() }}
          </span>
          <span class="min-w-0 flex flex-1 flex-col">
            <span class="truncate text-sm text-neutral-800 font-medium dark:text-neutral-100">{{ row.name }}</span>
            <span v-if="row.profileName" class="truncate text-[11px] text-neutral-500">
              {{ row.profileName }}
            </span>
          </span>
          <span
            v-if="isCurrent(row)"
            class="flex-none rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] text-primary-600 dark:text-primary-300"
          >
            {{ t('settings.pages.models.model-drivers.airi-picker.current') }}
          </span>
        </button>
      </li>
    </ul>

    <div class="flex items-center justify-between gap-2">
      <Button variant="ghost" size="sm" :label="t('settings.pages.models.model-drivers.airi-picker.refresh')" :loading="loading" @click="load" />
      <Button variant="secondary" size="sm" :label="t('settings.pages.models.model-drivers.airi-picker.cancel')" @click="emit('cancel')" />
    </div>
  </div>
</template>
