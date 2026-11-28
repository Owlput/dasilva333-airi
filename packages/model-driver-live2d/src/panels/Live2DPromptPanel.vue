<script setup lang="ts">
/**
 * The prompt panel: the driver's prompt authorship, which is the reason a prompt-capable driver ships a panel
 * (D-11: "own the format's settings UI, model list **and prompt authoring**").
 *
 * Two different things are on screen and they must not be confused:
 *
 *   - the **stored** prompt is this driver's own copy — it mints the version and keeps the history;
 *   - the **published** pair is what AIRI holds for prompt assembly and the card.
 *
 * "Regenerate" rebuilds the text from the catalogue (the model's expressions and motions are what changed, usually);
 * "Save & publish" records authored text as the next version. Both go through `prompt.ts`, which derives the token
 * list from the text and drops tokens this model cannot perform — publishing a token list that disagrees with the
 * model is the one failure that makes the model play what the prompt does not describe (D5).
 */
import type { ModelDriverPanelProps } from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DPrompt } from '../prompt'
import type { StoredLive2DModel } from '../storage'

import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { publishLive2DPrompt, readStoredPrompt, saveAuthoredPrompt } from '../prompt'
import { loadPanelData } from './model-data'

const props = defineProps<ModelDriverPanelProps>()

const { t } = useI18n()

const record = shallowRef<StoredLive2DModel>()
const stored = shallowRef<StoredLive2DPrompt>()
const draft = ref('')
const error = ref<string>()
const notice = ref<string>()
const busy = ref(false)

const canEdit = computed(() => !props.readOnly && props.profileId !== undefined)
const dirty = computed(() => stored.value !== undefined && draft.value !== stored.value.text)

async function load() {
  error.value = undefined
  notice.value = undefined
  try {
    const data = await loadPanelData(props.services, props.modelId, props.profileId)
    record.value = data.record
    if (!data.record) {
      error.value = t('model-drivers.live2d.error.model-missing', { modelId: props.modelId })
      return
    }
    if (!props.profileId) {
      error.value = t('model-drivers.live2d.prompt.no-profile')
      return
    }
    const current = await readStoredPrompt(props.services.storage, props.modelId, props.profileId)
    stored.value = current
    draft.value = current?.text ?? ''
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function save() {
  if (!canEdit.value || !props.profileId || !record.value || busy.value)
    return
  busy.value = true
  notice.value = undefined
  try {
    const prompt = await saveAuthoredPrompt({
      services: props.services,
      record: record.value,
      profileId: props.profileId,
      text: draft.value,
    })
    stored.value = prompt
    notice.value = t('model-drivers.live2d.prompt.published', { version: prompt.version, count: prompt.tokens.length })
  }
  catch (cause) {
    notice.value = t('model-drivers.live2d.prompt.publish-failed', { message: cause instanceof Error ? cause.message : String(cause) })
  }
  finally {
    busy.value = false
  }
}

async function regenerate() {
  if (!canEdit.value || !props.profileId || !record.value || busy.value)
    return
  busy.value = true
  notice.value = undefined
  try {
    const prompt = await publishLive2DPrompt({
      services: props.services,
      record: record.value,
      profileId: props.profileId,
      regenerate: true,
    })
    stored.value = prompt
    draft.value = prompt.text
    notice.value = t('model-drivers.live2d.prompt.regenerated', { version: prompt.version })
  }
  catch (cause) {
    notice.value = t('model-drivers.live2d.prompt.regenerate-failed', { message: cause instanceof Error ? cause.message : String(cause) })
  }
  finally {
    busy.value = false
  }
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

    <template v-else>
      <p class="text-neutral-400">
        <template v-if="stored">
          {{ t('model-drivers.live2d.prompt.stored', {
            version: stored.version,
            tokens: stored.tokens.length,
            date: new Date(stored.publishedAt).toLocaleString(),
          }) }}
        </template>
        <template v-else>
          {{ t('model-drivers.live2d.prompt.nothing') }}
        </template>
      </p>

      <textarea
        v-model="draft" rows="14" spellcheck="false" :disabled="!canEdit"
        class="w-full rounded bg-neutral-900 p-2 text-[11px] text-neutral-200 font-mono"
        :placeholder="t('model-drivers.live2d.prompt.placeholder')"
      />

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="rounded bg-neutral-800 px-2 py-1" :disabled="!canEdit || busy || !dirty" @click="save">
          {{ t('model-drivers.live2d.prompt.action-save') }}
        </button>
        <button type="button" class="rounded bg-neutral-800 px-2 py-1" :disabled="!canEdit || busy" @click="regenerate">
          {{ t('model-drivers.live2d.prompt.action-regenerate') }}
        </button>
        <span v-if="dirty" class="text-amber-300">{{ t('model-drivers.live2d.prompt.unsaved') }}</span>
        <span v-if="notice" class="text-neutral-300">{{ notice }}</span>
      </div>

      <section v-if="stored && stored.tokens.length > 0" class="flex flex-col gap-1">
        <h3 class="text-neutral-300 font-semibold">
          {{ t('model-drivers.live2d.prompt.tokens-heading') }}
        </h3>
        <ul class="flex flex-col gap-1 text-neutral-400 font-mono">
          <li v-for="token in stored.tokens" :key="token">
            {{ token }}
          </li>
        </ul>
      </section>

      <p class="text-neutral-500">
        {{ t('model-drivers.live2d.prompt.footnote') }}
      </p>
    </template>
  </div>
</template>
