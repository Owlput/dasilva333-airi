<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useSandbox } from '@proj-airi/stage-ui/composables/use-sandbox'
import { buildWidgetIframeSrcdoc, handleWidgetMcpMessage } from '@proj-airi/stage-ui/libs/sandbox'
import { useTheme } from '@proj-airi/ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { electronOpenMainDevtools } from '../../../../shared/eventa'

const props = withDefaults(defineProps<{
  id?: string
  title?: string
  path?: string
  code?: string
  modelValue?: Record<string, any>
  size?: 's' | 'm' | 'l' | { cols?: number, rows?: number }
}>(), {
  id: '',
  title: 'Generative Widget',
  path: '',
  code: '',
})

const { isDark } = useTheme()
const openDevTools = useElectronEventaInvoke(electronOpenMainDevtools)
const { init, mountedWidgets, readFile } = useSandbox()
const iframeRef = ref<HTMLIFrameElement | null>(null)

const targetCode = computed(() => {
  if (props.code)
    return props.code
  if (props.id) {
    const found = mountedWidgets.value.find(w => w.id === props.id)
    if (found?.code)
      return found.code
  }
  return ''
})

const targetPath = computed(() => {
  if (props.path)
    return props.path
  if (props.id) {
    const found = mountedWidgets.value.find(w => w.id === props.id)
    if (found?.path)
      return found.path
  }
  return '/workspace/widget.js'
})

const resolvedWidget = computed(() => {
  const found = props.id ? mountedWidgets.value.find(w => w.id === props.id) : undefined
  return {
    id: props.id || found?.id || 'widget-standalone',
    title: props.title || found?.title || 'Generative Widget',
    path: targetPath.value,
    sourcePath: found?.sourcePath,
    code: targetCode.value,
    state: found?.state,
  }
})

const displayTitle = computed(() => resolvedWidget.value.title || 'Generative Widget')
const iframeSrcdoc = ref('')
const isLoading = ref(false)
const iframeKey = ref(0)
const errorMessage = ref<string | null>(null)
let isRefreshing = false

async function refresh() {
  if (isRefreshing)
    return
  isRefreshing = true
  isLoading.value = true
  errorMessage.value = null
  try {
    let code = targetCode.value
    const path = targetPath.value
    if (!code && path) {
      try {
        code = await readFile(path)
      }
      catch {}
    }
    iframeSrcdoc.value = await buildWidgetIframeSrcdoc({
      id: resolvedWidget.value.id,
      path: path || '/workspace/widget.js',
      sourcePath: resolvedWidget.value.sourcePath,
      code: code || '',
      title: displayTitle.value,
      state: resolvedWidget.value.state,
      isDark: isDark.value,
    }, readFile)
    iframeKey.value++
  }
  catch (err: any) {
    errorMessage.value = err.message || 'Failed to render widget'
  }
  finally {
    isLoading.value = false
    isRefreshing = false
  }
}

watch(isDark, (val) => {
  iframeRef.value?.contentWindow?.postMessage({
    type: 'theme-change',
    isDark: val,
  }, '*')
})

function handleIframeMessage(e: MessageEvent) {
  if (e.data?.type === 'open-devtools') {
    void openDevTools?.()
    return
  }

  void handleWidgetMcpMessage(e)
}

watch([targetCode, targetPath], () => {
  void refresh()
})

onMounted(async () => {
  window.addEventListener('message', handleIframeMessage)
  await init?.()
  void refresh()
})

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage)
})
</script>

<template>
  <div class="h-full w-full flex flex-col select-none overflow-hidden border border-neutral-700/60 rounded-2xl bg-neutral-900/90 shadow-2xl backdrop-blur-xl">
    <!-- Header Bar with clearance for window drag pill (center) and close button (right) -->
    <div class="h-10 flex shrink-0 items-center justify-between border-b border-neutral-800/80 bg-neutral-950/40 px-3">
      <div class="max-w-[45%] flex items-center gap-2">
        <span class="i-solar:widget-5-bold-duotone shrink-0 text-sm text-primary-400" />
        <span class="truncate text-xs text-neutral-200 font-semibold">{{ displayTitle }}</span>
      </div>
      <!-- Right controls: reload button with right margin for close button (✕ at top-2 right-2) -->
      <div class="mr-9 flex items-center gap-1.5">
        <button
          title="Reload widget canvas"
          class="size-6 flex items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
          @click="refresh"
        >
          <span class="i-solar:refresh-linear text-xs" :class="{ 'animate-spin': isLoading }" />
        </button>
      </div>
    </div>

    <!-- Iframe Container taking full remaining space -->
    <div class="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-transparent">
      <div v-if="isLoading" class="backdrop-blur-xs absolute inset-0 z-10 flex items-center justify-center bg-black/40">
        <span class="i-solar:refresh-linear animate-spin text-xl text-primary-400" />
      </div>
      <iframe
        ref="iframeRef"
        :key="iframeKey"
        :srcdoc="iframeSrcdoc"
        sandbox="allow-scripts allow-forms allow-popups"
        class="h-full w-full border-none bg-transparent"
      />
    </div>
  </div>
</template>
