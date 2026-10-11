<script setup lang="ts">
import type { ChatSlices } from '../../../types/chat'

import { Collapsible } from '@proj-airi/ui'
import { computed } from 'vue'

import ChatToolCallBlock from './tool-call-block.vue'

const props = defineProps<{
  calls: ChatSlices[]
}>()

function toolNameOf(slice: ChatSlices) {
  const toolCall = (slice as any).toolCall
  return toolCall?.function?.name || toolCall?.toolName || 'tool'
}

const groupState = computed(() => {
  const states = props.calls.map(slice => (slice as any).state)
  if (states.includes('executing'))
    return 'executing'
  if (states.includes('error'))
    return 'error'
  return 'done'
})

const errorCount = computed(() => props.calls.filter(slice => (slice as any).state === 'error').length)

const nameSummary = computed(() => {
  const counts = new Map<string, number>()
  for (const slice of props.calls)
    counts.set(toolNameOf(slice), (counts.get(toolNameOf(slice)) ?? 0) + 1)
  return [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(', ')
})
</script>

<template>
  <Collapsible
    :class="[
      'bg-primary-100/40 dark:bg-primary-900/60 rounded-lg px-2 pb-2 pt-2',
      'flex flex-col gap-2 items-start',
    ]"
  >
    <template #trigger="{ visible, setVisible }">
      <button
        :class="[
          'w-full text-start',
        ]"
        @click="setVisible(!visible)"
      >
        <div
          v-if="groupState === 'executing'"
          i-eos-icons:loading class="mr-1 inline-block translate-y-0.5 op-50"
        />
        <div
          v-else-if="groupState === 'error'"
          i-ph:warning-circle-duotone class="mr-1 inline-block translate-y-0.5 text-red-500"
        />
        <div
          v-else
          i-ph:check-circle-duotone class="mr-1 inline-block translate-y-0.5 text-emerald-500"
        />
        <span class="text-sm font-medium">{{ calls.length }} tool calls</span>
        <span class="ml-2 text-xs op-60">{{ nameSummary }}</span>
        <span v-if="errorCount > 0" class="ml-2 text-xs text-red-500 op-80">({{ errorCount }} failed)</span>
      </button>
    </template>
    <div class="w-full flex flex-col gap-2">
      <ChatToolCallBlock
        v-for="(slice, index) in calls"
        :key="index"
        :tool-name="toolNameOf(slice)"
        :args="(slice as any).toolCall?.function?.arguments || (slice as any).toolCall?.args"
        :state="(slice as any).state"
        :result="(slice as any).result"
      />
    </div>
  </Collapsible>
</template>
