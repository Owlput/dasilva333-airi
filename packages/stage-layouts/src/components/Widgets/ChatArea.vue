<script setup lang="ts">
import {
  ChatImagesPopover,
  StageBackgroundDialogPicker,
} from '@proj-airi/stage-ui/components'
import { useChatComposer } from '@proj-airi/stage-ui/composables'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSettings, useSettingsAudioDevice, useSettingsChat } from '@proj-airi/stage-ui/stores/settings'
import { BasicContentEditable } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { BackgroundDialogPicker } from '../Backgrounds'

const props = defineProps<{
  tools?: any[]
}>()

const backgroundDialogOpen = ref(false)
const stageBackgroundDialogOpen = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

const { themeColorsHueDynamic } = storeToRefs(useSettings())
const settingsChat = useSettingsChat()
const settingsAudioDevice = useSettingsAudioDevice()
const { enabled: isAudioInputEnabled, stream: audioStream } = storeToRefs(settingsAudioDevice)

const airiCardStore = useAiriCardStore()
const { activeCardId } = storeToRefs(airiCardStore)
const { t } = useI18n()

// Initialize shared useChatComposer composable
const {
  messageInput,
  attachments,
  isComposing,
  isImagineMode,
  handleFilePaste,
  handleFileSelect,
  removeAttachment,
  handleSend,
  sending,
  canStop,
  stopGeneration,
} = useChatComposer({
  tools: props.tools,
})

async function handleVoiceClick() {
  if (!audioStream.value && !isAudioInputEnabled.value) {
    try {
      await settingsAudioDevice.askPermission()
    }
    catch (err) {
      console.error('Microphone permission error:', err)
    }
  }
  isAudioInputEnabled.value = !isAudioInputEnabled.value
}

function handleScreenshotClick() {
  // Vision capture is typically restricted in browser unless using getDisplayMedia
  toast.info('Vision capture is optimized for desktop. Please use the attach button for screenshots.')
}
</script>

<template>
  <div :class="['w-full flex flex-col font-sans ph-no-capture']">
    <input ref="fileInput" type="file" accept="image/*" class="hidden" multiple @change="handleFileSelect">

    <!-- Unified Composer Card -->
    <div
      :class="[
        'relative w-full flex flex-col',
        'rounded-2xl overflow-hidden',
        'bg-neutral-100/70 dark:bg-neutral-900/60 backdrop-blur-xl',
        'border border-neutral-200/50 dark:border-neutral-800/60',
        'shadow-sm transition-all duration-200',
      ]"
    >
      <!-- Attachments Preview -->
      <div v-if="attachments.length > 0" class="flex flex-wrap gap-2 border-b border-neutral-200/30 p-2 dark:border-neutral-800/40">
        <div v-for="(attachment, index) in attachments" :key="index" class="relative">
          <img :src="attachment.url" class="h-16 w-16 rounded-md object-cover">
          <button
            type="button"
            class="absolute h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-[10px] text-white -right-1 -top-1"
            @click="removeAttachment(index)"
          >
            &times;
          </button>
        </div>
      </div>

      <BasicContentEditable
        v-model="messageInput"
        :submit-on-enter="settingsChat.sendMode === 'enter'"
        :placeholder="isImagineMode ? 'Describe a scene to imagine...' : t('stage.message')"
        default-height="64px"
        :class="[
          'min-h-[64px] max-h-[260px] w-full px-4 pt-3.5 pb-1 font-medium outline-none overflow-y-auto bg-transparent',
          'text-neutral-900 dark:text-primary-50',
          'data-[empty]:before:text-neutral-900/60 dark:data-[empty]:before:text-white/60',
          'transition-all duration-250 ease-in-out data-[empty]:before:transition-all data-[empty]:before:duration-250 data-[empty]:before:ease-in-out',
          themeColorsHueDynamic ? 'transition-colors-none data-[empty]:before:transition-colors-none' : '',
        ]"
        @submit="handleSend"
        @paste-file="handleFilePaste"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />

      <!-- Action Row: Left (Images) and Right (Mic + Divider + Send Button) -->
      <div
        :class="[
          'flex items-center justify-between px-3 pb-2.5 pt-1',
        ]"
      >
        <!-- Images Popover -->
        <ChatImagesPopover
          variant="ghost"
          @attach="fileInput?.click()"
          @screenshot="handleScreenshotClick"
        />

        <!-- Right Side: Mic + Divider + Send Split Button -->
        <div class="flex items-center gap-2">
          <!-- Voice / STT Mic Button -->
          <button
            type="button"
            :class="[
              'p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 active:scale-95 transition-all cursor-pointer flex items-center justify-center',
              isAudioInputEnabled ? 'text-rose-500 hover:text-rose-600 animate-pulse' : '',
            ]"
            :title="isAudioInputEnabled ? 'Stop Listening' : 'Voice Input'"
            @click="handleVoiceClick"
          >
            <div :class="[isAudioInputEnabled ? 'i-solar:microphone-3-bold text-xl' : 'i-solar:microphone-linear text-xl']" />
          </button>

          <!-- Subtle Divider -->
          <div class="h-4 w-px bg-neutral-300/60 dark:bg-neutral-700/60" />

          <!-- Smart Send Split Button (Primary Accent) -->
          <div
            :class="[
              'flex items-center overflow-hidden rounded-xl transition-all shadow-sm',
              canStop ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-primary-500 hover:bg-primary-600 text-white',
            ]"
          >
            <button
              v-if="canStop"
              type="button"
              class="h-8.5 flex cursor-pointer items-center justify-center px-3 outline-none transition-transform active:scale-95"
              :title="sending ? 'Stop Generating' : 'Stop Speaking'"
              @click="stopGeneration"
            >
              <div class="i-solar:stop-bold text-base text-white" />
            </button>
            <button
              v-else
              type="button"
              class="h-8.5 flex cursor-pointer items-center justify-center px-3 outline-none transition-transform active:scale-95"
              title="Send Message"
              @click="handleSend"
            >
              <div class="i-solar:plain-2-bold text-base text-white" />
            </button>

            <PopoverRoot>
              <PopoverTrigger as-child>
                <button
                  type="button"
                  class="h-8.5 flex cursor-pointer items-center justify-center border-l border-white/25 px-2 outline-none transition-colors hover:bg-white/10"
                  title="Change Send Key Mode"
                >
                  <div class="i-solar:alt-arrow-down-linear text-xs text-white" />
                </button>
              </PopoverTrigger>
              <PopoverPortal>
                <PopoverContent
                  class="z-100 flex flex-col gap-1 border border-neutral-200 rounded-xl bg-white/95 p-1.5 shadow-2xl backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95"
                  side="top"
                  align="end"
                  :side-offset="8"
                >
                  <div class="px-2 py-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
                    Send Key Mode
                  </div>
                  <button
                    v-for="mode in (['enter', 'ctrl-enter', 'double-enter'] as const)"
                    :key="mode"
                    :class="[
                      'px-3 py-2 text-xs font-semibold rounded-lg transition-all text-left flex items-center justify-between gap-4 cursor-pointer',
                      settingsChat.sendMode === mode
                        ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/50 dark:text-primary-300'
                        : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
                    ]"
                    @click="settingsChat.sendMode = mode"
                  >
                    <span>{{ mode === 'enter' ? 'Enter' : mode === 'ctrl-enter' ? 'Ctrl + Enter' : 'Double Enter' }}</span>
                    <div v-if="settingsChat.sendMode === mode" class="i-solar:check-circle-bold text-sm" />
                  </button>
                </PopoverContent>
              </PopoverPortal>
            </PopoverRoot>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <BackgroundDialogPicker v-model="backgroundDialogOpen" />
    <StageBackgroundDialogPicker v-model="stageBackgroundDialogOpen" :card-id="activeCardId" />
  </div>
</template>
