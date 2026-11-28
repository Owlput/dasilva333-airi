<script setup lang="ts">
/**
 * The host frame for a driver's own panels (§5.6, §11).
 *
 * The host supplies the chrome — title, tabs, scrolling, padding — and the driver supplies the body. The `services`
 * prop is the container this window activated the driver with, so a panel edits driver storage or sends cues and
 * never host state.
 *
 * Two cases are deliberate:
 *
 *   - **a driver with no running entry has no container**, so there is nothing to hand a panel. The host shows the
 *     fallback rather than mounting a component whose `services` prop would be a lie;
 *   - **a prompt fault is a state, not an error.** A prompt-capable driver that published nothing for this model
 *     shows that here, because this is the surface that can fix it (D5, D-17).
 */
import type {
  ModelDriverAdapter,
  ModelDriverId,
  ModelDriverPanelDeclaration,
  ModelDriverPanelHostSurface,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'
import type { HostServices, PromptPublicationState } from '@proj-airi/stage-renderer-sdk'
import type { ModelDriverPanelProps } from '@proj-airi/stage-renderer-sdk'

import { computed, onMounted, ref, shallowRef, watch } from 'vue'

const props = defineProps<{
  adapter: ModelDriverAdapter
  driverId: ModelDriverId
  modelId: string
  profileId?: string
  mountId?: string
  surface: RendererMountSurfaceKind
  hostSurface: ModelDriverPanelHostSurface
  readiness: RendererMountReadinessState
  readOnly?: boolean
  /**
   * The store's state for this `(model, profile)`, from `HostPromptService.stateFor`.
   *
   * The panel does not read the prompt store itself — that is host data, and a panel edits driver state — so the
   * surface that owns the store passes the answer in.
   */
  promptState?: PromptPublicationState
}>()

const declarations = ref<ModelDriverPanelDeclaration[]>([])
const activeId = ref<string>()
const body = shallowRef<unknown>()
const error = ref<string>()

const services = computed<HostServices | undefined>(() => props.adapter.servicesFor(props.driverId))

const active = computed(() => declarations.value.find(declaration => declaration.id === activeId.value))

const panelProps = computed<ModelDriverPanelProps | undefined>(() => {
  if (!services.value)
    return undefined
  return {
    modelId: props.modelId,
    ...(props.profileId ? { profileId: props.profileId } : {}),
    ...(props.mountId ? { mountId: props.mountId } : {}),
    surface: props.surface,
    hostSurface: props.hostSurface,
    readiness: props.readiness,
    ...(props.readOnly !== undefined ? { readOnly: props.readOnly } : {}),
    services: services.value,
  }
})

/**
 * A prompt-capable driver that published nothing is a **fault**, and it is visibly different from an empty
 * publication: `('', [])` is a stored value, `undefined` is nothing published at all.
 */
const promptFault = computed(() => props.promptState === 'missing')

async function loadPanel(id: string | undefined) {
  const declaration = declarations.value.find(candidate => candidate.id === id)
  if (!declaration) {
    body.value = undefined
    return
  }
  try {
    const module = await declaration.component()
    body.value = module.default
  }
  catch (cause) {
    error.value = `The panel \`${declaration.id}\` failed to load: ${cause instanceof Error ? cause.message : String(cause)}`
    body.value = undefined
  }
}

async function load() {
  // The entry runs in this window (the surface started it), so the container exists; asking for it first keeps a
  // panel from mounting against a `services` object that is not there yet.
  const entry = await props.adapter.ensureEntry(props.driverId)
  if (!entry.ok)
    error.value = entry.error.message

  const resolved = await props.adapter.panelDeclarations(props.driverId)
  if (!resolved.ok) {
    error.value = resolved.error.message
    return
  }

  declarations.value = resolved.value.filter(declaration =>
    !declaration.surfaces || declaration.surfaces.includes(props.surface))
  activeId.value = declarations.value[0]?.id
  await loadPanel(activeId.value)
}

watch(activeId, id => void loadPanel(id))
watch(() => props.modelId, () => void load())

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="error" class="rounded p-2 text-xs text-amber-300 font-mono">
      {{ error }}
    </div>

    <div v-if="declarations.length > 1" class="flex flex-wrap gap-1">
      <button
        v-for="declaration in declarations"
        :key="declaration.id"
        type="button"
        class="rounded px-2 py-1 text-xs"
        :class="declaration.id === activeId ? 'bg-neutral-700 text-white' : 'bg-neutral-800/60 text-neutral-300'"
        @click="activeId = declaration.id"
      >
        {{ declaration.label }}
      </button>
    </div>

    <div v-if="promptFault" class="border border-amber-500/40 rounded p-2 text-xs text-amber-200">
      This driver can publish a model prompt and has published none for this model and profile. That is a fault in
      the driver, not an empty prompt — an empty publication would be stored and shown as such.
    </div>

    <component :is="body" v-if="body && panelProps" v-bind="panelProps" />

    <div v-else-if="!error && !services" class="rounded p-3 text-xs text-neutral-400">
      No driver code is running in this window, so there is nothing to hand this panel. Open a stage first, or
      re-enable the driver in Settings → Data.
    </div>

    <div v-else-if="!error" class="rounded p-3 text-xs text-neutral-400">
      This driver contributes no panel for this surface.
    </div>
  </div>
</template>
