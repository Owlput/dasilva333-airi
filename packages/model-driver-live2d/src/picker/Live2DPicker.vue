<script setup lang="ts">
/**
 * The Live2D model picker (RFC 0002 §11, D-11).
 *
 * A picker is not a panel: it answers "which model — or which profile of which model — should this character use",
 * over the models the driver already holds. It **only selects**, and asks the host when the user wants to add
 * something: every pair it emits is one AIRI already has a record for.
 *
 * The layout is a list and a detail pane, because picking is a decision, not a tap:
 *   - left: the models this driver holds, each with its preview tile and profile count;
 *   - right: the selected model's metadata and its profiles;
 *   - bottom right: **Confirm** (emits the pair) and, when the host supplied `requestImport`, **Import model…**
 *     (brings up AIRI's import panel, which returns through the same selection flow).
 *
 * A model is picked in two steps — model, then profile — and nothing is emitted until Confirm. Emitting on the
 * first click would make a browse feel like a commitment and would make the profile this panel offers pointless.
 *
 * That distinction is deliberate and was a correction. A picker that imported a file itself would mint `modelId`
 * and `profileId` in the driver's half — creating a model, a profile and their identities in the background,
 * without the prompt the host opens when a user imports a model. Identity is AIRI's (`Adapter.mintModelId`), the
 * import flow is AIRI's, and the driver's job is to supply the code that reads the format and writes the bytes.
 *
 * So when the picker has nothing imported to offer, it does not open a file dialog in AIRI's name: it takes the
 * files through its own input and passes them to the `requestImport` callback the host gave it, which opens AIRI's
 * import panel and resolves when that panel closes. The committed pair comes back to the picker's caller as a
 * `select`; the picker's own list is re-read by the picker, because syncing is the driver's job (P3-D12).
 *
 * A row shows the model's real thumbnail once a mount has rendered it (`record.preview`, written by
 * `Live2DMount`'s `ensurePreview`, D-8); before that it falls back to a deterministic tone and the model's initial,
 * which is deliberately not a fake image. Rows come from the driver's own storage, so the thumbnail travels with the
 * record rather than through a host cache.
 */
import type { ModelPickerProps, ModelSelection } from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DModel } from '../storage'

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { listModelRecords } from '../storage'

const props = defineProps<ModelPickerProps>()

const emit = defineEmits<{
  (event: 'select', selection: ModelSelection): void
  (event: 'cancel'): void
}>()

const { t } = useI18n()

const records = ref<StoredLive2DModel[]>([])
const selectedModelId = ref<string>()
const selectedProfileId = ref<string>()
const error = ref<string>()
const busy = ref(false)

const selectedModel = computed(() => records.value.find(record => record.modelId === selectedModelId.value))

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024)
    return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString()
}

/** A deterministic tone per model, so a placeholder is at least stable and distinguishable between rows. */
function hueOf(modelId: string): number {
  let hash = 0
  for (let index = 0; index < modelId.length; index++)
    hash = (hash * 31 + modelId.charCodeAt(index)) % 360
  return hash
}

function previewStyle(modelId: string) {
  const hue = hueOf(modelId)
  return {
    background: `linear-gradient(135deg, hsl(${hue} 40% 32%), hsl(${(hue + 40) % 360} 45% 16%))`,
  }
}

function isCurrent(modelId: string, profileId: string): boolean {
  return modelId === props.currentModelId && profileId === props.currentProfileId
}

function selectModel(record: StoredLive2DModel) {
  selectedModelId.value = record.modelId
  // Keep the current profile when this is the model the character already uses; otherwise start at its first.
  const current = record.profiles.find(profile => isCurrent(record.modelId, profile.profileId))
  selectedProfileId.value = current?.profileId ?? record.profiles[0]?.profileId
}

function confirm() {
  if (!selectedModel.value || !selectedProfileId.value)
    return
  emit('select', { modelId: selectedModel.value.modelId, profileId: selectedProfileId.value })
}

async function refresh() {
  error.value = undefined
  busy.value = true
  try {
    records.value = await listModelRecords(props.services.storage)

    // Selection survives a refresh where it still exists; otherwise fall back to the current model, then the list.
    if (selectedModelId.value && !records.value.some(record => record.modelId === selectedModelId.value)) {
      selectedModelId.value = undefined
      selectedProfileId.value = undefined
    }
    if (!selectedModelId.value) {
      const current = records.value.find(record => record.modelId === props.currentModelId)
      const fallback = current ?? records.value[0]
      if (fallback)
        selectModel(fallback)
    }
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void refresh()
})

/**
 * The picker's own input: AIRI's import panel is the place that names and confirms a model, but the files are the
 * driver's to obtain here and hand over, so the panel opens with the input already in hand.
 *
 * The host only promises that the panel closed. Syncing is ours: re-read the catalogue rather than trusting a
 * payload, so the driver's storage stays the single source (P1-D20).
 */
async function onPick(event: Event) {
  const element = event.target as HTMLInputElement
  const picked = Array.from(element.files ?? [])
  element.value = ''
  if (picked.length === 0 || !props.requestImport)
    return
  await props.requestImport({ files: picked })
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-3 text-xs">
    <header class="flex flex-wrap items-center gap-2">
      <h2 class="flex-1 font-semibold">
        {{ t('model-drivers.live2d.picker.title') }}
      </h2>
      <button type="button" class="rounded bg-neutral-800 px-2 py-1" @click="emit('cancel')">
        {{ t('model-drivers.live2d.picker.cancel') }}
      </button>
    </header>

    <p v-if="error" class="rounded bg-red-500/10 p-2 text-red-300">
      {{ error }}
    </p>

    <p v-if="busy && records.length === 0" class="rounded p-2 text-neutral-400">
      {{ t('model-drivers.live2d.picker.loading') }}
    </p>

    <p v-else-if="records.length === 0" class="rounded p-2 text-neutral-400">
      {{ t('model-drivers.live2d.picker.empty') }}
      <template v-if="props.requestImport">
        {{ t('model-drivers.live2d.picker.empty-import') }}
      </template>
      <template v-else>
        {{ t('model-drivers.live2d.picker.empty-no-import') }}
      </template>
    </p>

    <div v-else class="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
      <!-- Left: models. A row is a selection, never a commitment. -->
      <ul class="max-h-80 flex flex-col gap-1 overflow-y-auto p-0">
        <li v-for="record in records" :key="record.modelId">
          <button
            type="button"
            class="w-full flex items-center gap-2 rounded p-1 text-left"
            :class="record.modelId === selectedModelId
              ? 'bg-neutral-700/70 ring-1 ring-neutral-500'
              : 'hover:bg-neutral-800'"
            @click="selectModel(record)"
          >
            <img
              v-if="record.preview"
              :src="record.preview"
              class="h-10 w-10 flex-none rounded bg-neutral-900/60 object-contain"
              alt=""
            >
            <span
              v-else
              class="h-10 w-10 flex flex-none items-center justify-center rounded text-sm text-white/85"
              :style="previewStyle(record.modelId)"
            >
              {{ record.name.slice(0, 1).toUpperCase() }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ record.name }}</span>
              <span class="block truncate text-neutral-500">
                {{ record.profiles.length === 1
                  ? t('model-drivers.live2d.picker.profile-count-one')
                  : t('model-drivers.live2d.picker.profile-count', { count: record.profiles.length }) }}
                <template v-if="record.authorName"> · {{ record.authorName }}</template>
              </span>
            </span>
            <span
              v-if="record.modelId === props.currentModelId"
              class="flex-none rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-200"
            >
              {{ t('model-drivers.live2d.picker.current') }}
            </span>
          </button>
        </li>
      </ul>

      <!-- Right: the selected model's metadata and profiles. -->
      <section v-if="selectedModel" class="flex flex-col gap-2 border border-neutral-700/60 rounded p-2">
        <img
          v-if="selectedModel.preview"
          :src="selectedModel.preview"
          class="h-28 w-full rounded bg-neutral-900/60 object-contain"
          alt=""
        >
        <div
          v-else
          class="h-28 flex items-center justify-center rounded text-2xl text-white/85"
          :style="previewStyle(selectedModel.modelId)"
        >
          {{ selectedModel.name.slice(0, 1).toUpperCase() }}
        </div>

        <div>
          <strong class="block text-sm">{{ selectedModel.name }}</strong>
          <span v-if="selectedModel.authorName" class="block text-neutral-400">
            {{ t('model-drivers.live2d.picker.by-author', { author: selectedModel.authorName }) }}
          </span>
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-neutral-400">
          <dt>{{ t('model-drivers.live2d.picker.meta-model') }}</dt>
          <dd class="truncate text-[10px] text-neutral-500 font-mono">
            {{ selectedModel.modelId }}
          </dd>
          <dt>{{ t('model-drivers.live2d.picker.meta-size') }}</dt>
          <dd>{{ formatBytes(selectedModel.byteSize) }}</dd>
          <dt>{{ t('model-drivers.live2d.picker.meta-imported') }}</dt>
          <dd>{{ formatDate(selectedModel.importedAt) }}</dd>
          <dt>{{ t('model-drivers.live2d.picker.meta-catalogue') }}</dt>
          <dd>
            {{ t('model-drivers.live2d.picker.meta-catalogue-value', {
              expressions: selectedModel.expressions.length,
              motions: selectedModel.motions.length,
              hitAreas: selectedModel.hitAreas.length,
            }) }}
          </dd>
        </dl>

        <div class="flex flex-col gap-1">
          <span class="text-neutral-400">{{ t('model-drivers.live2d.picker.profile-label') }}</span>
          <button
            v-for="profile in selectedModel.profiles"
            :key="profile.profileId"
            type="button"
            class="rounded px-2 py-1 text-left"
            :class="profile.profileId === selectedProfileId
              ? 'bg-emerald-500/20 text-emerald-200'
              : 'bg-neutral-800 hover:bg-neutral-700'"
            @click="selectedProfileId = profile.profileId"
          >
            {{ profile.name }}
            <span v-if="isCurrent(selectedModel.modelId, profile.profileId)" class="text-[10px] text-emerald-300">
              {{ t('model-drivers.live2d.picker.profile-in-use') }}
            </span>
          </button>
        </div>
      </section>
    </div>

    <!-- The footer is the picker's whole action surface: import to add, confirm to choose. -->
    <div class="flex items-center justify-end gap-2">
      <label
        v-if="props.requestImport"
        class="cursor-pointer rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
      >
        {{ t('model-drivers.live2d.picker.action-import') }}
        <input
          type="file"
          accept=".zip,application/zip"
          class="hidden"
          @change="onPick"
        >
      </label>
      <button
        type="button"
        class="rounded bg-emerald-500/20 px-2 py-1 text-emerald-200 disabled:opacity-40"
        :disabled="!selectedProfileId"
        @click="confirm"
      >
        {{ t('model-drivers.live2d.picker.action-confirm') }}
      </button>
    </div>

    <p class="text-neutral-500">
      {{ t('model-drivers.live2d.picker.footnote') }}
    </p>
  </div>
</template>
