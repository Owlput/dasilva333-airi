<script setup lang="ts">
/**
 * The capability panel: what this model can do, read from the driver's own catalogue, with a one-click preview.
 *
 * A preview is a **transient** cue (`persistent: false`): the contract is explicit that a panel must not change the
 * renderer's saved state, and a preview that persisted would silently rewrite the user's appearance. The cue goes
 * out on the shared channel addressed to this driver, so it reaches whichever mount is showing the model — the panel
 * never addresses a mount, because mount identity is not part of a cue target (§9.2).
 */
import type { Cue, ModelDriverPanelProps } from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DModel } from '../storage'

import { CueKind, CueSource } from '@proj-airi/stage-renderer-sdk'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { loadPanelData } from './model-data'

const props = defineProps<ModelDriverPanelProps>()

const { t } = useI18n()

const record = shallowRef<StoredLive2DModel>()
const error = ref<string>()
const outcome = ref<string>()

const expressions = computed(() => record.value?.expressions ?? [])
const motions = computed(() => record.value?.motions ?? [])
const hitAreas = computed(() => record.value?.hitAreas ?? [])

async function load() {
  error.value = undefined
  try {
    const data = await loadPanelData(props.services, props.modelId, props.profileId)
    record.value = data.record
    if (!data.record)
      error.value = t('model-drivers.live2d.error.model-missing', { modelId: props.modelId })
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function preview(cue: Cue) {
  outcome.value = t('model-drivers.live2d.capabilities.sending')
  const sent = await props.services.cues.send({
    cues: [cue],
    source: CueSource.USER,
    override: true,
    // Transient by contract: a panel never writes the renderer's saved state (RFC 0002 section 11).
    persistent: false,
    target: { modelDriverId: props.services.modelDriverId },
  })

  if (!sent.ok) {
    outcome.value = t('model-drivers.live2d.capabilities.send-failed', { message: sent.error.message })
    return
  }

  const settled = await sent.value.settled
  if (!settled.ok) {
    outcome.value = t('model-drivers.live2d.capabilities.settlement-failed', { message: settled.error.message })
    return
  }

  const refused = settled.value.results.find(result => result.status === 'rejected')
  outcome.value = refused && refused.status === 'rejected'
    ? t('model-drivers.live2d.capabilities.refused', { reason: refused.reason })
    : t('model-drivers.live2d.capabilities.applied')
}

function cueExpression(key: string) {
  void preview({ kind: CueKind.EXPRESSION, key })
}

function cueMotion(key: string) {
  void preview({ kind: CueKind.MOTION, key })
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
        {{ t('model-drivers.live2d.capabilities.readiness') }} <code>{{ props.readiness }}</code>
        <span v-if="outcome" class="ml-2 text-neutral-300">· {{ outcome }}</span>
      </p>

      <section class="flex flex-col gap-1">
        <h3 class="text-neutral-300 font-semibold">
          {{ t('model-drivers.live2d.capabilities.expressions', { count: expressions.length }) }}
        </h3>
        <p v-if="expressions.length === 0" class="text-neutral-500">
          {{ t('model-drivers.live2d.capabilities.no-expressions') }}
        </p>
        <div v-else class="flex flex-wrap gap-1">
          <button
            v-for="expression in expressions" :key="expression.key" type="button"
            class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
            @click="cueExpression(expression.key)"
          >
            {{ expression.label }}
          </button>
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <h3 class="text-neutral-300 font-semibold">
          {{ t('model-drivers.live2d.capabilities.motions', { count: motions.length }) }}
        </h3>
        <p v-if="motions.length === 0" class="text-neutral-500">
          {{ t('model-drivers.live2d.capabilities.no-motions') }}
        </p>
        <div v-else class="flex flex-wrap gap-1">
          <button
            v-for="motion in motions" :key="motion.key" type="button"
            class="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
            @click="cueMotion(motion.key)"
          >
            {{ motion.group }} #{{ motion.index }}
          </button>
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <h3 class="text-neutral-300 font-semibold">
          {{ t('model-drivers.live2d.capabilities.hit-areas', { count: hitAreas.length }) }}
        </h3>
        <p v-if="hitAreas.length === 0" class="text-neutral-500">
          {{ t('model-drivers.live2d.capabilities.no-hit-areas') }}
        </p>
        <ul v-else class="list-disc list-inside text-neutral-400">
          <li v-for="area in hitAreas" :key="area">
            {{ area }}
          </li>
        </ul>
      </section>

      <p class="text-neutral-500">
        {{ t('model-drivers.live2d.capabilities.footnote') }}
      </p>
    </template>
  </div>
</template>
