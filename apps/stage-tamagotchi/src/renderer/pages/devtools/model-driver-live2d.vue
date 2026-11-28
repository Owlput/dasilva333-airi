<script setup lang="ts">
/**
 * Dev-only route: `/devtools/model-driver-live2d`.
 *
 * The dev surface for the first **real** driver (Phase 3, Live2D first). It is a route because it needs Pixi, a
 * WebGL context and the Cubism core — none of which a Node suite has — and because the thing it proves is the
 * end-to-end path a stage will take: import bytes into driver storage, pull rows through the manager, let the
 * **driver's own picker** choose a model, edit it in the **driver's own panels**, and let `MountHost` register,
 * activate and load it.
 *
 * Every driver surface here is mounted through the host frame (`DriverPickerHost`, `DriverPanelHost`, `MountHost`),
 * and the driver itself is imported **only through the loader table** (§4.7).
 *
 * **Import is the host's** — the `ModelImportPanel` below takes the file, asks every driver that can read it, and
 * commits under ids it mints itself. The driver's half is the `IMPORT` entry the panel loads through the loader
 * table, exactly like a panel or a mount; the driver's picker only selects models the driver already holds
 * (P3-D12). This route mounts the panel because no settings page hosts it yet (P2-D18).
 */
import type {
  ContractFailure,
  ModelDriverAdapter,
  ModelImportCommitEntry,
  ModelSummary,
} from '@proj-airi/stage-renderer-sdk'

import DriverPanelHost from '@proj-airi/stage-ui/components/scenarios/settings/model-drivers/DriverPanelHost.vue'
import DriverPickerHost from '@proj-airi/stage-ui/components/scenarios/settings/model-drivers/DriverPickerHost.vue'
import ModelImportPanel from '@proj-airi/stage-ui/components/scenarios/settings/model-drivers/ModelImportPanel.vue'
import MountHost from '@proj-airi/stage-ui/components/scenes/MountHost.vue'

import { HostWindowKind, ModelDriverPanelHostSurface, RendererMountPurpose, RendererMountReadinessState, RendererMountSurfaceKind } from '@proj-airi/stage-renderer-sdk'
import { computed, onUnmounted, ref, shallowRef } from 'vue'

import { LIVE2D_DRIVER_ID } from '../../../shared/model-driver-specifiers'
import { bootstrapModelDriverAdapter } from '../../libs/model-drivers'

const isDev = import.meta.env.DEV

const adapter = shallowRef<ModelDriverAdapter>()
const adapterError = ref<string>()
const ready = ref(false)
const rows = ref<ModelSummary[]>([])
const selected = ref<ModelSummary>()
const readiness = ref<RendererMountReadinessState>()
const log = ref<string[]>([])
const mountHost = ref<{ mountId?: string }>()

const mountModel = computed(() => selected.value
  ? { modelId: selected.value.modelId, profileId: selected.value.profileId }
  : null)

function say(line: string) {
  log.value = [`${new Date().toLocaleTimeString()}  ${line}`, ...log.value].slice(0, 80)
}

async function start() {
  adapterError.value = undefined
  const started = await bootstrapModelDriverAdapter({ windowKind: HostWindowKind.SETTINGS })
  if (!started) {
    adapterError.value = 'No adapter in this window: this build cannot host driver code.'
    return
  }
  adapter.value = started

  const entry = await started.ensureEntry(LIVE2D_DRIVER_ID)
  if (!entry.ok) {
    adapterError.value = entry.error.message
    say(`ensureEntry failed: ${entry.error.message}`)
    return
  }

  say('Adapter started and the Live2D provider entry is running in this window.')
  await refresh()
}

async function refresh() {
  const current = adapter.value
  if (!current)
    return
  const pulled = await current.pullRows(LIVE2D_DRIVER_ID)
  if (!pulled.ok) {
    say(`pullRows failed: ${pulled.error.message}`)
    return
  }
  rows.value = pulled.value
  if (!selected.value && pulled.value.length > 0)
    selected.value = pulled.value[0]
  say(`Manager pull: ${pulled.value.length} row(s)${pulled.value.length ? ` — ${pulled.value.map(row => row.name).join(', ')}` : ''}.`)
}

function onSelect(selection: { modelId: string, profileId: string }) {
  const row = rows.value.find(candidate =>
    candidate.modelId === selection.modelId && candidate.profileId === selection.profileId)
  selected.value = row ?? (rows.value.find(candidate => candidate.modelId === selection.modelId))
  say(`Picker selected ${selection.modelId} / ${selection.profileId}.`)
  void refresh()
}

/**
 * What the host does with a commit: refresh the rows every driver's catalogue is cached from, and select the first
 * model that landed. The panel already wrote nothing host-side — rows are pulled, never pushed (§4.3).
 */
async function onImported(entries: ModelImportCommitEntry[]) {
  const imported = entries.flatMap(entry => (entry.result.ok ? [entry.result.value] : []))
  say(`Imported ${imported.length} model(s)${imported.length ? `: ${imported.map(model => model.name).join(', ')}` : '.'}`)
  await refresh()
  const first = imported[0]
  if (first) {
    const row = rows.value.find(candidate => candidate.modelId === first.modelId)
    if (row)
      selected.value = row
  }
}

function onStateChange(state: RendererMountReadinessState) {
  readiness.value = state
  say(`Mount readiness: ${state}`)
  ready.value = state === 'ready-for-model' || state === 'model-loaded'
}

function onLoadFailed(message: string) {
  say(`Load failed: ${message}`)
}

function onMountError(failure: ContractFailure) {
  say(`Mount error: ${failure.code} — ${failure.message}`)
}

onUnmounted(() => {
  adapter.value?.dispose()
})
</script>

<template>
  <div class="h-full w-full overflow-y-auto bg-neutral-950 p-4 text-neutral-200">
    <template v-if="!isDev">
      <p class="text-sm font-mono">
        The Live2D driver route is a development tool.
      </p>
    </template>

    <template v-else>
      <header class="mb-3 flex flex-wrap items-center gap-2">
        <div class="flex-1">
          <h1 class="text-lg font-semibold">
            Model driver — Live2D
          </h1>
          <p class="text-xs text-neutral-400">
            The host's import panel imports through the driver's <code>import</code> entry; the driver's own picker
            chooses; its own panels edit the appearance and the prompt; <code>MountHost</code> registers and loads
            it. Rows: {{ rows.length }} · mount: {{ ready ? 'ready' : 'waiting' }}
          </p>
        </div>
        <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-xs" @click="start">
          Start adapter
        </button>
        <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-xs" @click="refresh">
          Pull rows
        </button>
      </header>

      <p v-if="adapterError" class="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-300">
        {{ adapterError }}
      </p>

      <div class="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <section class="min-h-80 flex flex-col gap-2 border border-neutral-700/60 rounded p-2">
          <h2 class="text-xs text-neutral-400 font-mono">
            preview / preview
          </h2>
          <div class="h-96">
            <MountHost
              v-if="adapter && mountModel"
              ref="mountHost"
              :adapter="adapter"
              :driver-id="LIVE2D_DRIVER_ID"
              :surface="RendererMountSurfaceKind.PREVIEW"
              :purpose="RendererMountPurpose.PREVIEW"
              :model="mountModel"
              :visible="true"
              :paused="false"
              @state-change="onStateChange"
              @load-failed="onLoadFailed"
              @error="onMountError"
            />
            <p v-else class="p-2 text-xs text-neutral-500 font-mono">
              Start the adapter and pick a model to mount it.
            </p>
          </div>
        </section>

        <section class="flex flex-col gap-2 border border-neutral-700/60 rounded p-2">
          <h2 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
            Driver picker
          </h2>
          <DriverPickerHost
            v-if="adapter"
            :adapter="adapter"
            :driver-id="LIVE2D_DRIVER_ID"
            :current-model-id="selected?.modelId"
            :current-profile-id="selected?.profileId"
            @select="onSelect"
            @cancel="say('Picker cancelled.')"
          />
          <p v-else class="text-xs text-neutral-500 font-mono">
            Start the adapter first.
          </p>
        </section>
      </div>

      <section
        v-if="adapter"
        class="mt-3 flex flex-col gap-2 border border-neutral-700/60 rounded p-2"
      >
        <h2 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          Import model (host panel)
        </h2>
        <ModelImportPanel
          :adapter="adapter"
          :driver-ids="[LIVE2D_DRIVER_ID]"
          @imported="onImported"
        />
      </section>

      <section
        v-if="adapter && selected"
        class="mt-3 flex flex-col gap-2 border border-neutral-700/60 rounded p-2"
      >
        <h2 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          Driver panels
        </h2>
        <DriverPanelHost
          :adapter="adapter"
          :driver-id="LIVE2D_DRIVER_ID"
          :model-id="selected.modelId"
          :profile-id="selected.profileId"
          :mount-id="mountHost?.mountId"
          :surface="RendererMountSurfaceKind.PREVIEW"
          :host-surface="ModelDriverPanelHostSurface.SETTINGS"
          :readiness="readiness ?? RendererMountReadinessState.UNMOUNTED"
        />
      </section>

      <section class="mt-3">
        <h2 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          Log
        </h2>
        <pre class="mt-1 max-h-48 overflow-y-auto rounded bg-neutral-900/70 p-2 text-[11px] text-neutral-400 font-mono">{{ log.join('\n') }}</pre>
      </section>
    </template>
  </div>
</template>
