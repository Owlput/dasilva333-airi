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
      'bg-white/95 dark:bg-neutral-800/95 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60 shadow-xs px-3.5 py-2.5',
      'flex flex-col gap-2 items-start w-full transition-all',
    ]"
  >
    <template #trigger="{ visible, setVisible }">
      <button
        :class="[
          'w-full text-start flex items-center justify-between gap-2 group cursor-pointer select-none',
        ]"
        @click="setVisible(!visible)"
      >
        <div class="min-w-0 flex flex-1 items-center gap-2.5">
          <div
            v-if="groupState === 'executing'"
            i-eos-icons:loading class="shrink-0 text-base text-primary-500"
          />
          <div
            v-else-if="groupState === 'error'"
            i-ph:warning-circle-duotone class="shrink-0 text-base text-red-500"
          />
          <div
            v-else
            i-ph:check-circle-duotone class="shrink-0 text-base text-emerald-500"
          />
          <code class="shrink-0 text-xs text-neutral-800 font-medium tracking-tight font-mono dark:text-neutral-200">
            {{ calls.length }} tool calls
          </code>
          <span class="truncate text-xs text-neutral-500 font-mono dark:text-neutral-400" :title="nameSummary">
            {{ nameSummary }}
          </span>
          <span v-if="errorCount > 0" class="shrink-0 text-xs text-red-500 op-80">({{ errorCount }} failed)</span>
        </div>

        <div
          class="i-solar:alt-arrow-down-linear shrink-0 text-xs text-neutral-400 transition-transform duration-200 dark:text-neutral-500 group-hover:text-neutral-600 dark:group-hover:text-neutral-300"
          :class="[visible ? 'rotate-180' : '']"
        />
      </button>
    </template>
    <div
      :class="[
        'rounded-lg p-2.5 w-full mt-1',
        'bg-neutral-100/70 dark:bg-neutral-900/70',
        'flex flex-col gap-2',
      ]"
    >
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
