<script setup lang="ts">
import { CharacterAvatar } from '@proj-airi/stage-ui/components'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

const emit = defineEmits<{
  (e: 'openStagingSettings'): void
}>()

const airiCardStore = useAiriCardStore()
const { activeCard, activeCardId } = storeToRefs(airiCardStore)

// ==========================================
// Cast & Staging / Color Customization Logic
// ==========================================
const PRESET_SWATCHES = [
  '#6EE7B7',
  '#2DD4BF',
  '#38BDF8',
  '#6366F1',
  '#A855F7',
  '#EC4899',
  '#FB7185',
  '#F97316',
  '#FBBF24',
  '#FACC15',
  '#A3E635',
  '#94A3B8',
]

const activePickerTarget = ref<string | null>(null)
const pickerHexInput = ref('')
const copiedHex = ref(false)

const activeCharacterName = computed(() => {
  return activeCard.value?.name || 'Character'
})

const activeDisplayModelId = computed(() => {
  if (!activeCardId.value)
    return undefined
  return airiCardStore.getCardDisplayModelId(activeCardId.value)
})

const cardDefaultColor = computed(() => {
  return activeCard.value?.extensions?.airi?.textColor
})

const stagingVisualAssets = computed(() => {
  return activeCard.value?.extensions?.airi?.visual_assets || {}
})

const actorConcepts = computed(() => {
  const assets = stagingVisualAssets.value
  return Object.entries(assets)
    .filter(([id, asset]: [string, any]) => {
      if (id.startsWith('actor_') || id.startsWith('actress_'))
        return true
      if (asset?.manifestation?.modelId)
        return true
      return false
    })
    .map(([id, asset]: [string, any]) => {
      const cleanName = id.replace(/^(actor_|actress_)/i, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      return {
        id,
        name: asset?.name || cleanName,
        textColor: asset?.textColor as string | undefined,
        displayModelId: asset?.manifestation?.modelId as string | undefined,
        asset,
      }
    })
})

const isMultiActorCard = computed(() => {
  if (actorConcepts.value.length > 1)
    return true
  if (actorConcepts.value.length === 1) {
    const conceptName = actorConcepts.value[0].name.toLowerCase().trim()
    const cardName = activeCharacterName.value.toLowerCase().trim()
    return conceptName !== cardName
  }
  return false
})

function getActorFallbackColor(actorId: string): string {
  const allKeys = Object.keys(stagingVisualAssets.value).sort()
  let hash = 0
  for (let i = 0; i < actorId.length; i++) {
    hash = actorId.charCodeAt(i) + ((hash << 5) - hash)
  }
  let h = Math.abs(hash) % 360

  const minDistance = 30
  const assignedHues: number[] = []
  for (const key of allKeys) {
    let kHash = 0
    for (let i = 0; i < key.length; i++) {
      kHash = key.charCodeAt(i) + ((kHash << 5) - kHash)
    }
    let kh = Math.abs(kHash) % 360
    let attempts = 0
    while (attempts < 360) {
      let conflict = false
      for (const assigned of assignedHues) {
        const diff = Math.abs(kh - assigned)
        const dist = Math.min(diff, 360 - diff)
        if (dist < minDistance) {
          conflict = true
          break
        }
      }
      if (!conflict)
        break
      kh = (kh + 45) % 360
      attempts++
    }
    assignedHues.push(kh)
    if (key === actorId) {
      h = kh
    }
  }

  return `hsl(${h}, 80%, 60%)`
}

function getActorEffectiveColor(actor: { id: string, textColor?: string }): string {
  if (actor.textColor)
    return actor.textColor
  if (cardDefaultColor.value)
    return cardDefaultColor.value
  return getActorFallbackColor(actor.id)
}

function handleSetCardDefaultColor(color: string | undefined) {
  if (!activeCardId.value || !activeCard.value)
    return
  const extensions = JSON.parse(JSON.stringify(activeCard.value.extensions || {}))
  if (!extensions.airi)
    extensions.airi = {}
  if (color) {
    extensions.airi.textColor = color
  }
  else {
    delete extensions.airi.textColor
  }
  airiCardStore.updateCard(activeCardId.value, {
    ...activeCard.value,
    extensions,
  } as any)
}

function handleSetActorOverrideColor(actorId: string, color: string | undefined) {
  if (!activeCardId.value || !activeCard.value)
    return
  const extensions = JSON.parse(JSON.stringify(activeCard.value.extensions || {}))
  if (!extensions.airi)
    extensions.airi = {}
  if (!extensions.airi.visual_assets)
    extensions.airi.visual_assets = {}
  if (!extensions.airi.visual_assets[actorId]) {
    extensions.airi.visual_assets[actorId] = { description: '' }
  }

  if (color) {
    extensions.airi.visual_assets[actorId].textColor = color
  }
  else {
    delete extensions.airi.visual_assets[actorId].textColor
  }

  airiCardStore.updateCard(activeCardId.value, {
    ...activeCard.value,
    extensions,
  } as any)
}

function openColorPicker(target: 'default' | string) {
  if (activePickerTarget.value === target) {
    activePickerTarget.value = null
    return
  }
  activePickerTarget.value = target
  if (target === 'default') {
    pickerHexInput.value = cardDefaultColor.value || '#6EE7B7'
  }
  else {
    const actor = actorConcepts.value.find(a => a.id === target)
    pickerHexInput.value = actor?.textColor || cardDefaultColor.value || '#6EE7B7'
  }
  copiedHex.value = false
}

function applyPickerColor(color: string | undefined) {
  if (activePickerTarget.value === 'default') {
    handleSetCardDefaultColor(color)
  }
  else if (activePickerTarget.value) {
    handleSetActorOverrideColor(activePickerTarget.value, color)
  }
}

function handleSelectSwatch(hex: string) {
  pickerHexInput.value = hex
  applyPickerColor(hex)
}

function handleHexInputChange() {
  const val = pickerHexInput.value.trim()
  if (/^#([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(val)) {
    applyPickerColor(val)
  }
}

function handleResetPickerColor() {
  if (activePickerTarget.value === 'default') {
    handleSetCardDefaultColor(undefined)
    pickerHexInput.value = ''
  }
  else if (activePickerTarget.value) {
    handleSetActorOverrideColor(activePickerTarget.value, undefined)
    pickerHexInput.value = cardDefaultColor.value || '#6EE7B7'
  }
  activePickerTarget.value = null
}

async function handleCopyHex() {
  if (!pickerHexInput.value)
    return
  try {
    await navigator.clipboard.writeText(pickerHexInput.value)
    copiedHex.value = true
    setTimeout(() => {
      copiedHex.value = false
    }, 1500)
  }
  catch (e) {
    console.error('Failed to copy hex:', e)
  }
}

const currentEditingTargetName = computed(() => {
  if (activePickerTarget.value === 'default')
    return 'Default dialogue color'
  const actor = actorConcepts.value.find(a => a.id === activePickerTarget.value)
  return actor ? actor.name : 'Dialogue color'
})

const currentEditingColor = computed(() => {
  if (activePickerTarget.value === 'default')
    return cardDefaultColor.value
  const actor = actorConcepts.value.find(a => a.id === activePickerTarget.value)
  return actor?.textColor
})

const previewChipStyle = computed(() => {
  const color = cardDefaultColor.value
  if (color) {
    const isHex = color.startsWith('#') && color.length === 7
    const bg = isHex ? `${color}18` : color
    const border = isHex ? `${color}33` : color
    return {
      backgroundColor: bg,
      borderColor: border,
      borderWidth: '1px',
      borderStyle: 'solid',
      color,
    }
  }
  return undefined
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Header Banner -->
    <div class="flex items-center gap-3 px-1 py-1">
      <div class="size-10 flex shrink-0 items-center justify-center border border-purple-500/20 rounded-xl bg-purple-500/15 text-purple-500 dark:bg-purple-500/20">
        <div class="i-solar:masks-bold-duotone size-6" />
      </div>
      <div class="flex flex-col">
        <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">Cast & Staging</span>
        <span class="text-[10px] text-neutral-400 dark:text-neutral-500">Dialogue colors for this card</span>
      </div>
    </div>

    <!-- SECTION: SINGLE CHARACTER -->
    <div v-if="!isMultiActorCard" class="flex flex-col gap-1.5 pt-1">
      <div class="select-none px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
        Card Default
      </div>

      <!-- Single Char Default Row -->
      <div class="flex items-center justify-between border border-neutral-200/50 rounded-xl bg-neutral-50/70 p-2 dark:border-neutral-800/60 dark:bg-neutral-900/40">
        <div class="min-w-0 flex items-center gap-2.5">
          <CharacterAvatar
            :card-id="activeCardId || ''"
            :name="activeCharacterName"
            :display-model-id="activeDisplayModelId"
            size-class="size-8"
            shape="circle"
          />
          <div class="min-w-0 flex flex-col">
            <span
              class="truncate text-xs font-bold"
              :class="cardDefaultColor ? '' : 'text-neutral-800 dark:text-neutral-100'"
              :style="cardDefaultColor ? { color: cardDefaultColor } : undefined"
            >
              {{ activeCharacterName }}
            </span>
            <span class="text-[10px] text-neutral-400 dark:text-neutral-500">Default dialogue color</span>
          </div>
        </div>

        <!-- Swatch Button -->
        <button
          type="button"
          :class="[
            'flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-all cursor-pointer select-none active:scale-95',
            activePickerTarget === 'default'
              ? 'border-primary-500 bg-primary-500/10 shadow-sm'
              : 'border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700',
          ]"
          @click.stop="openColorPicker('default')"
        >
          <span
            class="size-5 shrink-0 border border-black/10 rounded-md shadow-inner dark:border-white/10"
            :style="{ backgroundColor: cardDefaultColor || '#6EE7B7' }"
          />
          <div class="i-solar:alt-arrow-down-linear size-3 text-neutral-400" />
        </button>
      </div>

      <!-- Status Sub-row -->
      <div class="flex items-center justify-between px-1 text-[10px]">
        <span class="text-neutral-400 font-mono dark:text-neutral-500">
          {{ cardDefaultColor ? `Custom · ${cardDefaultColor.toUpperCase()}` : 'Theme color' }}
        </span>
        <button
          v-if="cardDefaultColor"
          type="button"
          class="flex cursor-pointer items-center gap-1 text-primary-500 transition dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300"
          @click="handleSetCardDefaultColor(undefined)"
        >
          <div class="i-solar:restart-linear size-3" />
          <span>Use theme color</span>
        </button>
      </div>

      <!-- Color Picker for Default (when open) -->
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="activePickerTarget === 'default'"
          class="relative my-1 border border-neutral-200/80 rounded-2xl bg-white/95 p-3 shadow-xl backdrop-blur-xl dark:border-neutral-800/90 dark:bg-neutral-900/95"
        >
          <div class="absolute right-6 size-3 rotate-45 border-l border-t border-neutral-200/80 bg-white -top-1.5 dark:border-neutral-800/90 dark:bg-neutral-900" />
          <div class="mb-2.5 flex items-center justify-between">
            <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">
              {{ currentEditingTargetName }}
            </span>
            <button
              type="button"
              class="cursor-pointer rounded-lg p-0.5 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="activePickerTarget = null"
            >
              <div class="i-solar:close-circle-linear size-4" />
            </button>
          </div>

          <div class="grid grid-cols-6 mb-3 gap-2">
            <button
              v-for="swatch in PRESET_SWATCHES"
              :key="swatch"
              type="button"
              :style="{ backgroundColor: swatch }"
              :class="[
                'size-7 rounded-full shadow-sm transition-all cursor-pointer hover:scale-110 active:scale-95 flex items-center justify-center border border-black/10 dark:border-white/10',
                (pickerHexInput.toLowerCase() === swatch.toLowerCase() || currentEditingColor?.toLowerCase() === swatch.toLowerCase())
                  ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 scale-105'
                  : '',
              ]"
              @click="handleSelectSwatch(swatch)"
            >
              <div
                v-if="pickerHexInput.toLowerCase() === swatch.toLowerCase() || currentEditingColor?.toLowerCase() === swatch.toLowerCase()"
                class="i-solar:check-read-bold size-3 text-neutral-900 drop-shadow-sm"
              />
            </button>
          </div>

          <div class="mb-2.5 flex items-center gap-2 border border-neutral-200/80 rounded-xl bg-neutral-100/70 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950/60">
            <div
              class="size-3.5 shrink-0 border border-black/10 rounded-full"
              :style="{ backgroundColor: pickerHexInput || currentEditingColor || 'transparent' }"
            />
            <input
              v-model="pickerHexInput"
              type="text"
              placeholder="#6EE7B7"
              class="flex-1 bg-transparent text-xs text-neutral-800 font-medium font-mono uppercase outline-none dark:text-neutral-200"
              @input="handleHexInputChange"
            >
            <button
              type="button"
              title="Copy Hex"
              class="cursor-pointer p-0.5 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="handleCopyHex"
            >
              <div :class="copiedHex ? 'i-solar:check-read-linear text-emerald-500' : 'i-solar:copy-linear'" class="size-3.5" />
            </button>
          </div>

          <button
            type="button"
            class="w-full flex cursor-pointer items-center justify-center gap-1.5 py-1 text-[11px] text-neutral-500 font-medium transition dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            @click="handleResetPickerColor"
          >
            <div class="i-solar:restart-linear size-3.5" />
            <span>Use theme color</span>
          </button>
        </div>
      </Transition>

      <!-- Live Dialogue Preview Box -->
      <div class="my-1 border border-neutral-200/60 rounded-xl bg-neutral-100/60 p-3 dark:border-neutral-800/80 dark:bg-neutral-900/50">
        <div class="mb-1.5 flex items-center">
          <span
            class="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase transition-colors"
            :class="!cardDefaultColor ? 'bg-primary-500/10 border border-primary-500/20 text-primary-600 dark:text-primary-400' : ''"
            :style="previewChipStyle"
          >
            {{ activeCharacterName }}
          </span>
        </div>
        <div
          class="text-xs font-medium leading-relaxed transition-colors"
          :class="!cardDefaultColor ? 'text-primary-700 dark:text-primary-100' : ''"
          :style="cardDefaultColor ? { color: cardDefaultColor } : undefined"
        >
          "Ready when you are, Sensei."
        </div>
      </div>

      <span class="px-1 text-[10px] text-neutral-400 dark:text-neutral-500">
        Used for this card's dialogue and name tags.
      </span>
    </div>

    <!-- SECTION: MULTIPLE CHARACTERS -->
    <div v-else class="flex flex-col gap-2 pt-1">
      <!-- Card Default Section -->
      <div class="select-none px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
        Card Default
      </div>

      <div class="flex items-center justify-between border border-neutral-200/50 rounded-xl bg-neutral-50/70 p-2 dark:border-neutral-800/60 dark:bg-neutral-900/40">
        <div class="min-w-0 flex items-center gap-2.5">
          <div class="size-8 flex shrink-0 items-center justify-center rounded-lg bg-neutral-200/60 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <div class="i-solar:document-text-linear size-4.5" />
          </div>
          <div class="min-w-0 flex flex-col">
            <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-100">
              Default dialogue color
            </span>
            <span class="text-[10px] text-neutral-400 dark:text-neutral-500">For characters without an override</span>
          </div>
        </div>

        <!-- Swatch Button -->
        <button
          type="button"
          :class="[
            'flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-all cursor-pointer select-none active:scale-95',
            activePickerTarget === 'default'
              ? 'border-primary-500 bg-primary-500/10 shadow-sm'
              : 'border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700',
          ]"
          @click.stop="openColorPicker('default')"
        >
          <span
            class="size-5 shrink-0 border border-black/10 rounded-md shadow-inner dark:border-white/10"
            :style="{ backgroundColor: cardDefaultColor || '#6EE7B7' }"
          />
          <div class="i-solar:alt-arrow-down-linear size-3 text-neutral-400" />
        </button>
      </div>

      <!-- Status Sub-row -->
      <div class="flex items-center justify-between px-1 text-[10px]">
        <span class="text-neutral-400 font-mono dark:text-neutral-500">
          {{ cardDefaultColor ? `Custom · ${cardDefaultColor.toUpperCase()}` : 'Automatic colors' }}
        </span>
        <button
          v-if="cardDefaultColor"
          type="button"
          class="flex cursor-pointer items-center gap-1 text-primary-500 transition dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300"
          @click="handleSetCardDefaultColor(undefined)"
        >
          <div class="i-solar:restart-linear size-3" />
          <span>Use automatic colors</span>
        </button>
      </div>

      <!-- Color Picker for Default (when open in multi-char mode) -->
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="activePickerTarget === 'default'"
          class="relative my-1 border border-neutral-200/80 rounded-2xl bg-white/95 p-3 shadow-xl backdrop-blur-xl dark:border-neutral-800/90 dark:bg-neutral-900/95"
        >
          <div class="absolute right-6 size-3 rotate-45 border-l border-t border-neutral-200/80 bg-white -top-1.5 dark:border-neutral-800/90 dark:bg-neutral-900" />
          <div class="mb-2.5 flex items-center justify-between">
            <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">
              {{ currentEditingTargetName }}
            </span>
            <button
              type="button"
              class="cursor-pointer rounded-lg p-0.5 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="activePickerTarget = null"
            >
              <div class="i-solar:close-circle-linear size-4" />
            </button>
          </div>

          <div class="grid grid-cols-6 mb-3 gap-2">
            <button
              v-for="swatch in PRESET_SWATCHES"
              :key="swatch"
              type="button"
              :style="{ backgroundColor: swatch }"
              :class="[
                'size-7 rounded-full shadow-sm transition-all cursor-pointer hover:scale-110 active:scale-95 flex items-center justify-center border border-black/10 dark:border-white/10',
                (pickerHexInput.toLowerCase() === swatch.toLowerCase() || currentEditingColor?.toLowerCase() === swatch.toLowerCase())
                  ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 scale-105'
                  : '',
              ]"
              @click="handleSelectSwatch(swatch)"
            >
              <div
                v-if="pickerHexInput.toLowerCase() === swatch.toLowerCase() || currentEditingColor?.toLowerCase() === swatch.toLowerCase()"
                class="i-solar:check-read-bold size-3 text-neutral-900 drop-shadow-sm"
              />
            </button>
          </div>

          <div class="mb-2.5 flex items-center gap-2 border border-neutral-200/80 rounded-xl bg-neutral-100/70 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950/60">
            <div
              class="size-3.5 shrink-0 border border-black/10 rounded-full"
              :style="{ backgroundColor: pickerHexInput || currentEditingColor || 'transparent' }"
            />
            <input
              v-model="pickerHexInput"
              type="text"
              placeholder="#6EE7B7"
              class="flex-1 bg-transparent text-xs text-neutral-800 font-medium font-mono uppercase outline-none dark:text-neutral-200"
              @input="handleHexInputChange"
            >
            <button
              type="button"
              title="Copy Hex"
              class="cursor-pointer p-0.5 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="handleCopyHex"
            >
              <div :class="copiedHex ? 'i-solar:check-read-linear text-emerald-500' : 'i-solar:copy-linear'" class="size-3.5" />
            </button>
          </div>

          <button
            type="button"
            class="w-full flex cursor-pointer items-center justify-center gap-1.5 py-1 text-[11px] text-neutral-500 font-medium transition dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            @click="handleResetPickerColor"
          >
            <div class="i-solar:restart-linear size-3.5" />
            <span>Use automatic colors</span>
          </button>
        </div>
      </Transition>

      <!-- Character Overrides Section -->
      <div class="select-none px-1 pt-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
        Character Overrides
      </div>

      <div class="flex flex-col gap-1.5">
        <template v-for="actor in actorConcepts" :key="actor.id">
          <div class="flex items-center justify-between border border-neutral-200/50 rounded-xl bg-neutral-50/70 p-2 dark:border-neutral-800/60 dark:bg-neutral-900/40">
            <div class="min-w-0 flex items-center gap-2.5">
              <CharacterAvatar
                :card-id="activeCardId || ''"
                :name="actor.name"
                :display-model-id="actor.displayModelId"
                size-class="size-8"
                shape="circle"
              />
              <div class="min-w-0 flex flex-col">
                <span
                  class="truncate text-xs font-bold"
                  :class="actor.textColor ? '' : (cardDefaultColor ? '' : 'text-neutral-800 dark:text-neutral-100')"
                  :style="actor.textColor ? { color: actor.textColor } : (cardDefaultColor ? { color: cardDefaultColor } : undefined)"
                >
                  {{ actor.name }}
                </span>
                <span class="text-[10px] text-neutral-400 dark:text-neutral-500">
                  {{ actor.textColor ? 'Custom color' : 'Uses card default' }}
                </span>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <!-- Swatch Button -->
              <button
                type="button"
                :class="[
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-all cursor-pointer select-none active:scale-95',
                  activePickerTarget === actor.id
                    ? 'border-primary-500 bg-primary-500/10 shadow-sm'
                    : 'border-neutral-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700',
                ]"
                @click.stop="openColorPicker(actor.id)"
              >
                <span
                  class="size-5 shrink-0 border border-black/10 rounded-md shadow-inner dark:border-white/10"
                  :style="{ backgroundColor: getActorEffectiveColor(actor) }"
                />
                <div class="i-solar:alt-arrow-down-linear size-3 text-neutral-400" />
              </button>

              <!-- Reset / Link Indicator -->
              <button
                v-if="actor.textColor"
                type="button"
                title="Reset to card default"
                class="cursor-pointer rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                @click.stop="handleSetActorOverrideColor(actor.id, undefined)"
              >
                <div class="i-solar:restart-linear size-4" />
              </button>
              <div
                v-else
                title="Uses card default"
                class="p-1 text-neutral-400/60"
              >
                <div class="i-solar:link-linear size-4" />
              </div>
            </div>
          </div>

          <!-- Color Picker for Actor Override (when open) -->
          <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
          >
            <div
              v-if="activePickerTarget === actor.id"
              class="relative my-1 border border-neutral-200/80 rounded-2xl bg-white/95 p-3 shadow-xl backdrop-blur-xl dark:border-neutral-800/90 dark:bg-neutral-900/95"
            >
              <div class="absolute right-6 size-3 rotate-45 border-l border-t border-neutral-200/80 bg-white -top-1.5 dark:border-neutral-800/90 dark:bg-neutral-900" />
              <div class="mb-2.5 flex items-center justify-between">
                <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">
                  {{ currentEditingTargetName }}
                </span>
                <button
                  type="button"
                  class="cursor-pointer rounded-lg p-0.5 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
                  @click="activePickerTarget = null"
                >
                  <div class="i-solar:close-circle-linear size-4" />
                </button>
              </div>

              <div class="grid grid-cols-6 mb-3 gap-2">
                <button
                  v-for="swatch in PRESET_SWATCHES"
                  :key="swatch"
                  type="button"
                  :style="{ backgroundColor: swatch }"
                  :class="[
                    'size-7 rounded-full shadow-sm transition-all cursor-pointer hover:scale-110 active:scale-95 flex items-center justify-center border border-black/10 dark:border-white/10',
                    (pickerHexInput.toLowerCase() === swatch.toLowerCase() || currentEditingColor?.toLowerCase() === swatch.toLowerCase())
                      ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900 scale-105'
                      : '',
                  ]"
                  @click="handleSelectSwatch(swatch)"
                >
                  <div
                    v-if="pickerHexInput.toLowerCase() === swatch.toLowerCase() || currentEditingColor?.toLowerCase() === swatch.toLowerCase()"
                    class="i-solar:check-read-bold size-3 text-neutral-900 drop-shadow-sm"
                  />
                </button>
              </div>

              <div class="mb-2.5 flex items-center gap-2 border border-neutral-200/80 rounded-xl bg-neutral-100/70 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950/60">
                <div
                  class="size-3.5 shrink-0 border border-black/10 rounded-full"
                  :style="{ backgroundColor: pickerHexInput || currentEditingColor || 'transparent' }"
                />
                <input
                  v-model="pickerHexInput"
                  type="text"
                  placeholder="#6EE7B7"
                  class="flex-1 bg-transparent text-xs text-neutral-800 font-medium font-mono uppercase outline-none dark:text-neutral-200"
                  @input="handleHexInputChange"
                >
                <button
                  type="button"
                  title="Copy Hex"
                  class="cursor-pointer p-0.5 text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
                  @click="handleCopyHex"
                >
                  <div :class="copiedHex ? 'i-solar:check-read-linear text-emerald-500' : 'i-solar:copy-linear'" class="size-3.5" />
                </button>
              </div>

              <button
                type="button"
                class="w-full flex cursor-pointer items-center justify-center gap-1.5 py-1 text-[11px] text-neutral-500 font-medium transition dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                @click="handleResetPickerColor"
              >
                <div class="i-solar:restart-linear size-3.5" />
                <span>Use card default</span>
              </button>
            </div>
          </Transition>
        </template>
      </div>

      <span class="px-1 text-[10px] text-neutral-400 dark:text-neutral-500">
        Character overrides take priority over the card default.
      </span>
    </div>

    <!-- Divider & Staging Settings Link -->
    <div class="my-1 border-t border-neutral-200/40 dark:border-neutral-800/40" />

    <button
      type="button"
      class="w-full flex cursor-pointer items-center justify-between rounded-xl px-2 py-1.5 text-xs text-primary-500 font-semibold transition hover:bg-primary-500/10 dark:text-primary-400"
      @click="emit('openStagingSettings')"
    >
      <span>Open full Staging settings</span>
      <div class="i-solar:arrow-right-up-linear size-4" />
    </button>
  </div>
</template>
