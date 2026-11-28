<script setup lang="ts">
/**
 * The appearance panel: the profile body, edited the way the driver stores it (D-9).
 *
 * This is the driver's own settings UI for its own state, which is why it exists in the driver and not in the host:
 * `scale`, `anchorY`, `offsetX/Y`, `opacity` and the resting expression are Live2D's vocabulary, and AIRI must never
 * learn it. Every edit is a storage write on the profile key — a live mount follows that key, so the stage updates
 * without this panel knowing whether anything is mounted at all, and without sending a cue per slider pixel.
 */
import type { ModelDriverPanelProps } from '@proj-airi/stage-renderer-sdk'

import type { Live2DProfileBody } from '../profile'
import type { StoredLive2DModel } from '../storage'

import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { isProfileBodyEmpty } from '../profile'
import { loadPanelData, saveProfileBody } from './model-data'

const props = defineProps<ModelDriverPanelProps>()

const { t } = useI18n()

const record = shallowRef<StoredLive2DModel>()
const body = ref<Live2DProfileBody>({})
const error = ref<string>()
const saved = ref(false)

const expressions = computed(() => record.value?.expressions ?? [])
const canEdit = computed(() => !props.readOnly && props.profileId !== undefined)

async function load() {
  error.value = undefined
  saved.value = false
  try {
    const data = await loadPanelData(props.services, props.modelId, props.profileId)
    record.value = data.record
    body.value = data.body
    if (!data.record)
      error.value = t('model-drivers.live2d.error.model-missing', { modelId: props.modelId })
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function persist() {
  if (!canEdit.value || !props.profileId)
    return
  saved.value = false
  const written = await saveProfileBody({
    services: props.services,
    modelId: props.modelId,
    profileId: props.profileId,
    body: body.value,
  })
  saved.value = written
  if (!written)
    error.value = t('model-drivers.live2d.appearance.profile-gone', { profileId: props.profileId })
}

function set<K extends keyof Live2DProfileBody>(key: K, value: Live2DProfileBody[K]) {
  body.value = { ...body.value, [key]: value }
  void persist()
}

function reset() {
  body.value = {}
  void persist()
}

onMounted(() => {
  void load()
})

watch(() => [props.modelId, props.profileId], () => void load())
</script>

<template>
  <div class="flex flex-col gap-3 text-xs">
    <p v-if="error" class="rounded bg-red-500/10 p-2 text-red-300">
      {{ error }}
    </p>

    <p v-else-if="!props.profileId" class="rounded p-2 text-neutral-400">
      {{ t('model-drivers.live2d.appearance.no-profile') }}
    </p>

    <template v-else>
      <div class="flex items-center justify-between gap-2">
        <span class="text-neutral-400">
          {{ t('model-drivers.live2d.appearance.profile') }} <code>{{ props.profileId }}</code>
          <template v-if="isProfileBodyEmpty(body)">
            — {{ t('model-drivers.live2d.appearance.default') }}
          </template>
        </span>
        <span v-if="saved" class="text-emerald-400">{{ t('model-drivers.live2d.appearance.saved') }}</span>
      </div>

      <label class="grid gap-1">
        <span class="flex justify-between"><span>{{ t('model-drivers.live2d.appearance.scale') }}</span><code>{{ body.scale ?? 1 }}</code></span>
        <input
          type="range" min="0.1" max="3" step="0.05" :value="body.scale ?? 1" :disabled="!canEdit"
          class="w-full" @input="set('scale', Number(($event.target as HTMLInputElement).value))"
        >
      </label>

      <label class="grid gap-1">
        <span class="flex justify-between"><span>{{ t('model-drivers.live2d.appearance.anchor') }}</span><code>{{ body.anchorY ?? 0.5 }}</code></span>
        <input
          type="range" min="0" max="1" step="0.01" :value="body.anchorY ?? 0.5" :disabled="!canEdit"
          class="w-full" @input="set('anchorY', Number(($event.target as HTMLInputElement).value))"
        >
      </label>

      <label class="grid gap-1">
        <span class="flex justify-between"><span>{{ t('model-drivers.live2d.appearance.opacity') }}</span><code>{{ body.opacity ?? 1 }}</code></span>
        <input
          type="range" min="0" max="1" step="0.01" :value="body.opacity ?? 1" :disabled="!canEdit"
          class="w-full" @input="set('opacity', Number(($event.target as HTMLInputElement).value))"
        >
      </label>

      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1">
          <span>{{ t('model-drivers.live2d.appearance.offset-x') }}</span>
          <input
            type="number" step="1" :value="body.offsetX ?? 0" :disabled="!canEdit"
            class="rounded bg-neutral-800 px-2 py-1" @change="set('offsetX', Number(($event.target as HTMLInputElement).value))"
          >
        </label>
        <label class="grid gap-1">
          <span>{{ t('model-drivers.live2d.appearance.offset-y') }}</span>
          <input
            type="number" step="1" :value="body.offsetY ?? 0" :disabled="!canEdit"
            class="rounded bg-neutral-800 px-2 py-1" @change="set('offsetY', Number(($event.target as HTMLInputElement).value))"
          >
        </label>
      </div>

      <label class="grid gap-1">
        <span>{{ t('model-drivers.live2d.appearance.resting-expression') }}</span>
        <select
          class="rounded bg-neutral-800 px-2 py-1" :value="body.expression ?? ''" :disabled="!canEdit"
          @change="set('expression', ($event.target as HTMLSelectElement).value || undefined)"
        >
          <option value="">
            {{ t('model-drivers.live2d.appearance.keep-last-cue') }}
          </option>
          <option v-for="expression in expressions" :key="expression.key" :value="expression.key">
            {{ expression.label }}
          </option>
        </select>
      </label>

      <button type="button" class="self-start rounded bg-neutral-800 px-2 py-1" :disabled="!canEdit" @click="reset">
        {{ t('model-drivers.live2d.appearance.reset') }}
      </button>

      <p v-if="props.readOnly" class="text-neutral-500">
        {{ t('model-drivers.live2d.appearance.read-only') }}
      </p>
    </template>
  </div>
</template>
