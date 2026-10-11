<script setup lang="ts">
import type { MountedWidget } from '../../../libs/sandbox'

import { useDraggable } from '@vueuse/core'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useSandbox } from '../../../composables/use-sandbox'
import { buildWidgetIframeSrcdoc } from '../../../libs/sandbox'
import { tryGetMcpToolBridge } from '../../../stores/mcp-tool-bridge'

const props = withDefaults(defineProps<{
  widget: MountedWidget
  index?: number
}>(), {
  index: 0,
})

const { unmountWidget, setWidgetSurface, updateWidgetPosition, readFile } = useSandbox()

const cardEl = ref<HTMLElement | null>(null)
const dragHandleRef = ref<HTMLElement | null>(null)

const isCollapsed = ref(false)
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)
const iframeKey = ref(0)
const iframeHeight = ref(160)
const iframeSrcdoc = ref('')

const initialX = props.widget.position?.x ?? (typeof window !== 'undefined'
  ? Math.max(16, window.innerWidth - 360 - (props.index * 24))
  : 100)
const initialY = props.widget.position?.y ?? (typeof window !== 'undefined'
  ? Math.max(80, 100 + (props.index * 36))
  : 100)

const { x, y, style, isDragging } = useDraggable(cardEl, {
  handle: dragHandleRef,
  initialValue: { x: initialX, y: initialY },
})

// Persist position whenever dragging ends
watch(isDragging, (dragging) => {
  if (!dragging) {
    const currentPos = { x: Math.round(x.value), y: Math.round(y.value) }
    void updateWidgetPosition(props.widget.id, currentPos)
  }
})

async function refreshActiveWidget() {
  isLoading.value = true
  errorMessage.value = null
  try {
    iframeSrcdoc.value = await buildWidgetIframeSrcdoc(props.widget, readFile)
    iframeKey.value++
  }
  catch (err: any) {
    errorMessage.value = err.message || 'Failed to render widget'
  }
  finally {
    isLoading.value = false
  }
}

async function handleDockToPanel() {
  await setWidgetSurface(props.widget.id, 'panel')
}

function handleClose() {
  unmountWidget(props.widget.id)
}

function handleIframeMessage(e: MessageEvent) {
  if (e.data?.type === 'widget-resize' && typeof e.data.height === 'number') {
    const targetHeight = Math.max(120, Math.min(Math.ceil(e.data.height), 560))
    if (Math.abs(iframeHeight.value - targetHeight) > 2) {
      iframeHeight.value = targetHeight
    }
  }
  else if (e.data?.type === 'mcp-call') {
    const { id, name, args } = e.data
    const bridge = tryGetMcpToolBridge()
    const target = e.source as WindowProxy | null
    if (!bridge) {
      target?.postMessage({ type: 'mcp-call-result', id, error: 'MCP tool bridge not available' }, '*')
      return
    }
    bridge.callTool({ name, arguments: args })
      .then((res) => {
        if (res.isError) {
          target?.postMessage({ type: 'mcp-call-result', id, error: String(res.toolResult || 'MCP tool execution failed') }, '*')
        }
        else {
          target?.postMessage({ type: 'mcp-call-result', id, result: res.structuredContent ?? res.toolResult ?? res.content }, '*')
        }
      })
      .catch((err: any) => {
        target?.postMessage({ type: 'mcp-call-result', id, error: err.message || 'MCP tool error' }, '*')
      })
  }
}

watch(() => props.widget.code, () => {
  void refreshActiveWidget()
})

onMounted(() => {
  window.addEventListener('message', handleIframeMessage)
  void refreshActiveWidget()
})

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage)
})
</script>

<template>
  <div
    ref="cardEl"
    :style="style"
    :class="[
      'fixed z-40 flex flex-col select-none pointer-events-auto',
      'w-[320px] max-w-[90vw] overflow-hidden rounded-2xl',
      'border border-black/5 dark:border-white/10 shadow-2xl backdrop-blur-xl',
      'bg-white/85 dark:bg-neutral-900/85 text-neutral-800 dark:text-neutral-100',
      'transition-shadow duration-200 hover:shadow-primary-500/10',
    ]"
  >
    <!-- Card Header / Drag Handle -->
    <div
      ref="dragHandleRef"
      :class="[
        'flex items-center justify-between gap-1.5 px-3 py-2 cursor-grab active:cursor-grabbing select-none',
        'border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-neutral-950/40',
      ]"
    >
      <div class="min-w-0 flex flex-1 items-center gap-1.5">
        <span class="i-solar:widget-5-bold-duotone shrink-0 text-sm text-primary-500" />
        <span class="truncate text-xs text-neutral-900 font-bold dark:text-neutral-100">
          {{ widget.title || widget.path.split('/').pop() || 'Widget' }}
        </span>
      </div>

      <!-- Window Action Controls -->
      <div class="flex shrink-0 items-center gap-1" @pointerdown.stop>
        <button
          type="button"
          :title="isCollapsed ? 'Expand widget' : 'Collapse widget'"
          class="flex cursor-pointer items-center justify-center rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-700 dark:hover:bg-neutral-800/50 dark:hover:text-neutral-200"
          @click="isCollapsed = !isCollapsed"
        >
          <span :class="isCollapsed ? 'i-solar:alt-arrow-down-linear' : 'i-solar:alt-arrow-up-linear'" class="text-xs" />
        </button>

        <button
          type="button"
          title="Reload widget canvas"
          class="flex cursor-pointer items-center justify-center rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-700 dark:hover:bg-neutral-800/50 dark:hover:text-neutral-200"
          @click="refreshActiveWidget"
        >
          <span class="i-solar:refresh-linear text-xs" :class="{ 'animate-spin': isLoading }" />
        </button>

        <button
          type="button"
          title="Dock back to widgets panel"
          class="flex cursor-pointer items-center justify-center rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-primary-600 dark:hover:bg-neutral-800/50 dark:hover:text-primary-400"
          @click="handleDockToPanel"
        >
          <span class="i-solar:minimize-square-3-bold-duotone text-xs" />
        </button>

        <button
          type="button"
          title="Close widget"
          class="flex cursor-pointer items-center justify-center rounded-lg p-1 text-neutral-400 transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
          @click="handleClose"
        >
          <span class="i-solar:close-circle-bold-duotone text-xs" />
        </button>
      </div>
    </div>

    <!-- Card Viewport (Hidden when collapsed) -->
    <div v-show="!isCollapsed" class="relative w-full overflow-hidden bg-transparent">
      <iframe
        :key="iframeKey"
        :srcdoc="iframeSrcdoc"
        allowtransparency="true"
        sandbox="allow-scripts allow-forms allow-same-origin"
        :class="[
          'block w-full border-0 bg-transparent transition-[height] duration-200',
          isDragging ? 'pointer-events-none' : '',
        ]"
        :style="{ height: `${iframeHeight}px`, backgroundColor: 'transparent' }"
      />

      <div
        v-if="errorMessage"
        class="m-2 flex items-center gap-1.5 border border-rose-500/30 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
      >
        <span class="i-solar:danger-triangle-bold-duotone shrink-0 text-sm" />
        <span class="truncate">{{ errorMessage }}</span>
      </div>
    </div>
  </div>
</template>
