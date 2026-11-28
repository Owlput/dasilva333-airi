<script setup lang="ts">
/**
 * The host frame for a driver's model picker (§5.6).
 *
 * A picker is not a panel: it answers "which model — or which profile — should this character use", including the
 * models only the driver can see, and it owns the whole choice (listing, importing a builtin, profile variants).
 * The host mounts it and receives a `select`; it never lists the driver's models itself.
 *
 * `select` carries an **imported** pair only. A builtin has no AIRI identity, so a picker that returns one would
 * return a reference the host could never resolve again — which is why the contract types `ModelSelection` as two
 * minted ids and the picker imports before it emits.
 */
import type { ModelDriverAdapter, ModelDriverId, ModelPickerComponent, ModelSelection } from '@proj-airi/stage-renderer-sdk'
import type { HostServices } from '@proj-airi/stage-renderer-sdk'
import type { ModelPickerProps } from '@proj-airi/stage-renderer-sdk'

import { computed, onMounted, ref, shallowRef } from 'vue'

const props = defineProps<{
  adapter: ModelDriverAdapter
  driverId: ModelDriverId
  characterId?: string
  currentModelId?: string
  currentProfileId?: string
}>()

const emit = defineEmits<{
  (event: 'select', selection: ModelSelection): void
  (event: 'cancel'): void
}>()

const picker = shallowRef<ModelPickerComponent>()
const error = ref<string>()
const loading = ref(true)

const services = computed<HostServices | undefined>(() => props.adapter.servicesFor(props.driverId))

const pickerProps = computed<ModelPickerProps | undefined>(() => services.value
  ? {
      ...(props.characterId ? { characterId: props.characterId } : {}),
      ...(props.currentModelId ? { currentModelId: props.currentModelId } : {}),
      ...(props.currentProfileId ? { currentProfileId: props.currentProfileId } : {}),
      services: services.value,
    }
  : undefined)

onMounted(async () => {
  loading.value = true
  // The picker may import a model, so this window has to be running the driver's code before it is shown.
  const entry = await props.adapter.ensureEntry(props.driverId)
  if (!entry.ok)
    error.value = entry.error.message

  const component = await props.adapter.pickerComponent(props.driverId)
  if (!component.ok)
    error.value = component.error.message
  else if (!component.value)
    error.value = `Driver \`${props.driverId}\` ships no model picker. Importing a model needs a picker from the driver that can read it.`
  else
    picker.value = component.value
  loading.value = false
})

function onSelect(selection: ModelSelection) {
  emit('select', selection)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="loading" class="p-3 text-xs text-neutral-400">
      Starting the driver's picker…
    </div>
    <div v-else-if="error" class="border border-amber-500/40 rounded p-2 text-xs text-amber-200">
      {{ error }}
    </div>
    <component
      :is="picker"
      v-else-if="picker && pickerProps"
      v-bind="pickerProps"
      @select="onSelect"
      @cancel="emit('cancel')"
    />
  </div>
</template>
