<script setup lang="ts">
/**
 * The host dialog that binds a character to a driver model pair (§5.6, §6.5 step 7).
 *
 * Binding is a **host write**, not a driver one: a picker proposes a pair, this dialog writes it onto the card and
 * nothing else — `extensions.airi.avatar`, through `withCardBinding`, which also leaves the frozen
 * `modules.displayModelId` alone (D10). The prompt snapshot is not written here for the same reason it is not
 * invented anywhere: it is a copy of the driver's publication, and the activation reconciliation of §5.4 is what
 * puts it on the card.
 *
 * It exists so both a settings page and the stage's unavailable-model view can offer the same choice without either
 * owning the picker contract: it discovers the enabled drivers from the host, mounts the chosen one's picker frame,
 * and closes on the first selection.
 *
 * **Two pickers, one meaning.** A driver that ships a picker gets the richer surface (previews, profiles, the import
 * fork). AIRI's own list lists the rows the host already holds — deliberately dumber, and the only surface that
 * still works when the driver ships no picker at all, which is the normal state for a driver whose UI has not
 * landed. Both answer with the same `{ modelId, profileId }`, so binding cannot tell which one proposed it.
 */
import type { ModelDriverAdapter, ModelDriverId, ModelSelection, UnavailableModelReason } from '@proj-airi/stage-renderer-sdk'

import { DriverStatus } from '@proj-airi/stage-renderer-sdk'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AiriModelPicker from './AiriModelPicker.vue'
import DriverPickerHost from './DriverPickerHost.vue'

import { readCardBinding } from '../../../../libs/model-drivers/binding'
import { useModelDriverHost } from '../../../../libs/model-drivers/host'
import { bindCardModel } from '../../../../libs/model-drivers/prompt'
import { useAiriCardStore } from '../../../../stores/modules'

type PickerSource = 'driver' | 'airi'

const props = defineProps<{
  adapter: ModelDriverAdapter
  /** The character to bind. Defaults to the active one. */
  characterId?: string
  currentModelId?: string
  currentProfileId?: string
  /** Restrict the choice to these drivers; by default every enabled driver is offered. */
  driverIds?: ModelDriverId[]
  /** Why the current binding cannot render, when the caller knows; AIRI's list shows it above its rows. */
  unavailableReason?: UnavailableModelReason
}>()

const emit = defineEmits<{
  (event: 'bound', value: ModelSelection & { driverId: ModelDriverId }): void
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const cardStore = useAiriCardStore()
const { activeCardId } = storeToRefs(cardStore)
const { updateCard } = cardStore

/** The window's prompt service, when this window runs driver code: binding reconciles the card's snapshot through it. */
const driverHost = useModelDriverHost()
const promptService = computed(() => driverHost?.prompts.value)

/** The enabled drivers whose picker this dialog may mount. */
const drivers = ref<Array<{ driverId: ModelDriverId, name: string }>>([])
const driverId = ref<ModelDriverId>()
const loading = ref(false)
const error = ref<string>()
/** Which of the two pickers is showing; the driver's own unless it ships none (see `onNoPicker`). */
const source = ref<PickerSource>('driver')

const characterId = computed(() => props.characterId ?? activeCardId.value)

/**
 * What the dialog offers when it opens.
 *
 * The list is the **host's** driver table, filtered to what this build may run; the dialog never asks a card which
 * driver it wants, because the card's answer may be a driver that is disabled or gone (that is what the unavailable
 * view just told the user). The current binding's driver is preferred, so re-opening the dialog starts where the
 * character is rather than at the top of the list.
 */
watch(open, async (isOpen) => {
  if (!isOpen)
    return

  loading.value = true
  error.value = undefined
  drivers.value = []
  // The driver's picker is where a returning user expects to be; a driver that cannot provide one switches this.
  source.value = 'driver'

  try {
    const state = await props.adapter.hostState()
    const allowed = props.driverIds ? new Set<string>(props.driverIds) : undefined
    drivers.value = state.drivers
      .filter(driver => driver.status === DriverStatus.ENABLED && (!allowed || allowed.has(driver.driverId)))
      .map(driver => ({ driverId: driver.driverId, name: driver.name }))

    const target = characterId.value
    const bound = target ? readCardBinding(cardStore.getCard(target) ?? {}).binding?.driverId : undefined
    driverId.value = drivers.value.find(driver => driver.driverId === bound)?.driverId ?? drivers.value[0]?.driverId
    if (!driverId.value)
      error.value = t('settings.pages.models.model-drivers.dialog.error.no-drivers')
  }
  finally {
    loading.value = false
  }
})

/**
 * The driver ships no picker (or its picker entry failed to load).
 *
 * Falling back to AIRI's list rather than leaving the frame's error text as the only content: the user asked to
 * bind a model, and the host can answer that from the rows it holds without the driver's UI.
 */
function onNoPicker() {
  source.value = 'airi'
}

async function onSelect(selection: ModelSelection) {
  const target = characterId.value
  const card = target ? cardStore.getCard(target) : undefined
  if (!target || !card || !driverId.value) {
    error.value = t('settings.pages.models.model-drivers.dialog.error.no-character')
    return
  }

  // Bind and reconcile in one card write: a rebind to another model drops the previous snapshot, a same-pair rebind
  // keeps it, and the store fills it in when it has a newer publication (§5.4).
  const next = await bindCardModel({
    card,
    binding: {
      driverId: driverId.value,
      modelId: selection.modelId,
      profileId: selection.profileId,
    },
    ...(promptService.value ? { service: promptService.value } : {}),
  })
  const written = await updateCard(target, { extensions: next.extensions })
  if (!written) {
    error.value = t('settings.pages.models.model-drivers.dialog.error.update-failed')
    return
  }

  emit('bound', { driverId: driverId.value, ...selection })
  open.value = false
}
</script>

<template>
  <div
    v-if="open"
    :class="[
      'fixed inset-0 z-[9999]',
      'flex items-center justify-center',
      'bg-black/50 p-4',
    ]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="driver-model-dialog-title"
  >
    <div
      :class="[
        'max-h-[85vh] w-full max-w-2xl flex flex-col gap-3 overflow-y-auto',
        'border border-neutral-200 rounded-2xl bg-white p-4 shadow-xl',
        'dark:border-neutral-800 dark:bg-neutral-900',
      ]"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex flex-col">
          <h2 id="driver-model-dialog-title" class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
            {{ t('settings.pages.models.model-drivers.dialog.title') }}
          </h2>
          <p class="text-[11px] text-neutral-500">
            {{ t('settings.pages.models.model-drivers.dialog.description') }}
          </p>
        </div>
        <button
          type="button"
          :class="[
            'rounded-lg p-1',
            'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600',
            'dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
          ]"
          :aria-label="t('settings.pages.models.model-drivers.dialog.cancel')"
          @click="open = false"
        >
          <div class="i-solar:close-square-bold-duotone text-xl" />
        </button>
      </div>

      <div v-if="drivers.length > 1" class="flex flex-wrap gap-1">
        <button
          v-for="driver in drivers"
          :key="driver.driverId"
          type="button"
          :class="[
            'px-2 py-1 text-xs rounded-lg border transition',
            driver.driverId === driverId
              ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
              : 'border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300',
          ]"
          @click="driverId = driver.driverId"
        >
          {{ driver.name }}
        </button>
      </div>

      <p v-if="loading" class="p-3 text-xs text-neutral-500">
        {{ t('settings.pages.models.model-drivers.dialog.loading') }}
      </p>
      <p
        v-else-if="error"
        :class="[
          'border border-amber-500/40 rounded-lg p-2',
          'bg-amber-500/5',
          'text-xs text-amber-600 dark:text-amber-400',
        ]"
      >
        {{ error }}
      </p>

      <template v-if="!loading && driverId">
        <!--
          Both sources bind the same way, so this is a view switch, not a mode: the driver's picker is the richer
          surface and the default, AIRI's list is the one that always answers.
        -->
        <div
          :class="[
            'flex gap-1 self-start p-1',
            'rounded-lg bg-neutral-100 dark:bg-neutral-800/70',
          ]"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="source === 'driver'"
            :class="[
              'px-2 py-1 text-xs rounded-md transition',
              source === 'driver'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
                : 'text-neutral-500',
            ]"
            @click="source = 'driver'"
          >
            {{ t('settings.pages.models.model-drivers.dialog.source-driver') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="source === 'airi'"
            :class="[
              'px-2 py-1 text-xs rounded-md transition',
              source === 'airi'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
                : 'text-neutral-500',
            ]"
            @click="source = 'airi'"
          >
            {{ t('settings.pages.models.model-drivers.dialog.source-airi') }}
          </button>
        </div>

        <DriverPickerHost
          v-if="source === 'driver'"
          :key="driverId"
          :adapter="adapter"
          :driver-id="driverId"
          :character-id="characterId"
          :current-model-id="currentModelId"
          :current-profile-id="currentProfileId"
          @select="onSelect"
          @cancel="open = false"
          @no-picker="onNoPicker"
        />
        <AiriModelPicker
          v-else
          :key="driverId"
          :adapter="adapter"
          :driver-id="driverId"
          :current-model-id="currentModelId"
          :current-profile-id="currentProfileId"
          :current-reason="unavailableReason"
          @select="onSelect"
          @cancel="open = false"
        />
      </template>

      <div class="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <Button variant="secondary" @click="open = false">
          {{ t('settings.pages.models.model-drivers.dialog.cancel') }}
        </Button>
      </div>
    </div>
  </div>
</template>
