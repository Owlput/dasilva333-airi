<script setup lang="ts">
/**
 * The host frame for a driver's model picker (§5.6).
 *
 * A picker is not a panel: it answers "which model — or which profile — should this character use", including the
 * models only the driver can see, and it owns the whole choice. The host mounts it and receives a `select`; it
 * never lists the driver's models itself.
 *
 * `select` carries an **imported** pair only. A builtin has no AIRI identity, so a picker that returned one would
 * return a reference the host could never resolve again. When the user wants something the driver can present but
 * AIRI does not hold yet, the picker calls the `requestImport` callback this frame gives it, and the frame opens
 * **AIRI's import panel** for the same driver — the same panel, input and probe/commit any other import uses. The
 * promise that call returns settles when the panel closes; what was imported is never handed back, because syncing
 * it from its own storage is the driver's business.
 *
 * The panel is opened inside this frame rather than by a service, because opening one means rendering a host
 * component. That is why the interface is a host-supplied callback rather than a method on `HostServices`
 * (P3-D12), and why it is a callback rather than a prop/emit pair: the picker contract must not depend on Vue.
 */
import type { ModelDriverAdapter, ModelDriverId, ModelImportCommitEntry, ModelImportRequest, ModelPickerComponent, ModelSelection } from '@proj-airi/stage-renderer-sdk'
import type { HostServices } from '@proj-airi/stage-renderer-sdk'
import type { ModelPickerProps } from '@proj-airi/stage-renderer-sdk'

import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ModelImportPanel from './ModelImportPanel.vue'

const props = defineProps<{
  adapter: ModelDriverAdapter
  driverId: ModelDriverId
  characterId?: string
  currentModelId?: string
  currentProfileId?: string
}>()

const emit = defineEmits<{
  (event: 'select', selection: ModelSelection): void
  /** What an import opened from the picker committed, for a caller that wants to refresh its own rows. */
  (event: 'imported', entries: ModelImportCommitEntry[]): void
  (event: 'cancel'): void
  /**
   * This driver contributed no usable picker (no `picker` entry, or the entry failed to load).
   *
   * The frame cannot substitute one — it is the driver's slot — but its caller can: `DriverModelDialog` falls back
   * to AIRI's own list, which binds from the rows the host holds. Without this signal the frame's error text would
   * be a dead end for a user who only asked to pick a model.
   */
  (event: 'no-picker'): void
}>()

const { t } = useI18n()

const picker = shallowRef<ModelPickerComponent>()
const error = ref<string>()
const loading = ref(true)
/** Host truth, computed here: whether there is an import surface to open for this driver. */
const canImport = ref(false)
const importOpen = ref(false)
/** The input the picker handed over with `requestImport`, so the panel skips its own chooser. */
const pendingFiles = ref<File[]>([])
/**
 * Settles the promise `requestImport` returned.
 *
 * Closing — by commit or by cancel — is the only thing the picker is told. The host relays nothing about what was
 * imported: the driver syncs its own storage, and this promise is just "the dialog is gone".
 */
let importClosed: (() => void) | undefined

function closeImport() {
  importOpen.value = false
  importClosed?.()
  importClosed = undefined
}

/**
 * The callback the picker calls to bring the import panel up. It resolves when the panel closes.
 *
 * Only offered when this host has an import surface for the driver, so the picker can treat "absent" as "do not
 * show an add-model affordance".
 */
function requestImport(request: ModelImportRequest): Promise<void> {
  pendingFiles.value = request.files
  importOpen.value = true
  return new Promise<void>((resolve) => {
    importClosed = resolve
  })
}

const services = ref<HostServices>()

const pickerProps = computed<ModelPickerProps | undefined>(() => services.value
  ? {
      ...(props.characterId ? { characterId: props.characterId } : {}),
      ...(props.currentModelId ? { currentModelId: props.currentModelId } : {}),
      ...(props.currentProfileId ? { currentProfileId: props.currentProfileId } : {}),
      ...(canImport.value ? { requestImport } : {}),
      services: services.value,
    }
  : undefined)

onMounted(async () => {
  loading.value = true
  // The picker may import a model, so this window has to be running the driver's code before it is shown.
  const entry = await props.adapter.ensureEntry(props.driverId)
  if (!entry.ok)
    error.value = entry.error.message
  // `servicesFor` answers from a plain map, so it is read *after* the entry started rather than in a computed: the
  // map is not reactive, and a computed that read it before would cache "no services" for the frame's whole life.
  services.value = props.adapter.servicesFor(props.driverId)

  // Only promise the picker an import button when this build can actually open the panel: a driver that ships no
  // `import` entry answers `null`, and a dead button is worse than none.
  const importSurface = await props.adapter.importEntry(props.driverId)
  canImport.value = importSurface.ok && importSurface.value !== null

  const component = await props.adapter.pickerComponent(props.driverId)
  if (!component.ok) {
    error.value = component.error.message
    emit('no-picker')
  }
  else if (!component.value) {
    error.value = t('settings.pages.models.model-drivers.driver-picker.no-picker', { driverId: props.driverId })
    emit('no-picker')
  }
  else {
    picker.value = component.value
  }
  loading.value = false
})

/**
 * The import committed, so finish the choice the picker started.
 *
 * The committed `selection` is the pair the driver wrote and AIRI now holds — exactly what `select` is allowed to
 * carry — so no row is inferred from a cache and no id is re-minted here.
 */
function onImported(entries: ModelImportCommitEntry[]) {
  // Closing is the only thing the driver is told. What was committed is already in its storage; syncing is its job.
  closeImport()
  emit('imported', entries)

  // A picker's job is to answer with a pair, so the first committed part becomes the choice — the committed
  // selection is exactly the pair AIRI now holds, so no row is inferred and no id is re-minted here.
  const committed = entries.find(entry => entry.result.ok)
  if (committed)
    emit('select', committed.selection)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="loading" class="p-3 text-xs text-neutral-400">
      {{ t('settings.pages.models.model-drivers.driver-picker.loading') }}
    </div>
    <div v-else-if="error" class="border border-amber-500/40 rounded p-2 text-xs text-amber-200">
      {{ error }}
    </div>
    <component
      :is="picker"
      v-else-if="picker && pickerProps"
      v-bind="pickerProps"
      @select="emit('select', $event)"
      @cancel="emit('cancel')"
    />

    <div
      v-if="importOpen"
      :class="['fixed inset-0 z-50', 'flex items-center justify-center', 'bg-black/60 p-4']"
    >
      <div
        :class="[
          'flex max-h-[80vh] w-full max-w-xl flex-col gap-2 overflow-y-auto',
          'border border-neutral-700 rounded bg-neutral-900 p-3',
        ]"
      >
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
            {{ t('settings.pages.models.model-drivers.driver-picker.import-title') }}
          </h3>
          <span class="text-[10px] text-neutral-500 font-mono">{{ driverId }}</span>
        </div>
        <ModelImportPanel
          :adapter="adapter"
          :driver-ids="[driverId]"
          :files="pendingFiles"
          @imported="onImported"
          @cancel="closeImport"
        />
      </div>
    </div>
  </div>
</template>
