<script setup lang="ts">
import { useSandbox } from '@proj-airi/stage-ui/composables/use-sandbox'
import { ansiToHtml } from '@proj-airi/stage-ui/libs/sandbox'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores'
import { useLocalStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const cardStore = useAiriCardStore()
const isSandboxAllowed = computed(() => {
  const tools = cardStore.activeCard?.extensions?.airi?.generation?.known?.allowedTools
  return Boolean(tools && (tools.includes('bash') || tools.includes('mcp_bash')))
})

async function handleEnableSandbox() {
  if (!cardStore.activeCard || !cardStore.activeCardId)
    return
  const card = cardStore.activeCard
  const airi = card.extensions?.airi
  const currentTools = airi?.generation?.known?.allowedTools ?? ['text_journal', 'image_journal']
  const nextTools = currentTools.includes('bash') ? currentTools : [...currentTools, 'bash']

  await cardStore.updateCard(cardStore.activeCardId, {
    extensions: {
      ...card.extensions,
      airi: {
        ...airi,
        generation: {
          ...airi?.generation,
          known: {
            ...airi?.generation?.known,
            allowedTools: nextTools,
          },
        },
      },
    },
  } as any)
}

const activeTab = useLocalStorage<'widgets' | 'terminal'>('airi:mobile-workspace-tab', 'widgets')

const {
  isExecuting,
  commandHistory,
  exec,
  clearLogs,
  reset,
  mountedWidgets,
  unmountWidget,
  mountPersistedWidget,
  getPersistedWidgets,
} = useSandbox()

// --- Terminal State ---
const commandInput = ref('')
const commandHistoryNav = ref<string[]>([])
const navIndex = ref(-1)
const terminalScrollRef = ref<HTMLDivElement | null>(null)

// Auto-scroll terminal on new command output
watch(
  () => commandHistory.value.length,
  async () => {
    await nextTick()
    if (terminalScrollRef.value) {
      terminalScrollRef.value.scrollTop = terminalScrollRef.value.scrollHeight
    }
  },
)

async function handleRunCommand() {
  const cmd = commandInput.value.trim()
  if (!cmd || isExecuting.value)
    return

  commandHistoryNav.value.push(cmd)
  navIndex.value = -1
  commandInput.value = ''

  await exec(cmd)
  await reloadPersistedWidgets()
}

function handleHistoryNav(direction: 'up' | 'down') {
  if (commandHistoryNav.value.length === 0)
    return

  if (direction === 'up') {
    if (navIndex.value === -1) {
      navIndex.value = commandHistoryNav.value.length - 1
    }
    else if (navIndex.value > 0) {
      navIndex.value--
    }
  }
  else if (direction === 'down') {
    if (navIndex.value !== -1) {
      if (navIndex.value < commandHistoryNav.value.length - 1) {
        navIndex.value++
      }
      else {
        navIndex.value = -1
        commandInput.value = ''
        return
      }
    }
  }

  if (navIndex.value !== -1) {
    commandInput.value = commandHistoryNav.value[navIndex.value] || ''
  }
}

// --- Widgets State ---
const persistedWidgets = ref<any[]>([])
const onStageSectionOpen = ref(true)
const moreWidgetsSectionOpen = ref(true)

async function reloadPersistedWidgets() {
  try {
    persistedWidgets.value = await getPersistedWidgets()
  }
  catch {
    persistedWidgets.value = []
  }
}

onMounted(async () => {
  await reloadPersistedWidgets()
})

const onStageWidgets = computed(() => {
  return mountedWidgets.value.filter(w => w.surface === 'widget')
})

const offlineWidgets = computed(() => {
  const mountedIds = new Set(mountedWidgets.value.map(w => w.id))
  return persistedWidgets.value.filter(w => !mountedIds.has(w.id))
})

async function handleToggleOnStage(widget: any) {
  const isCurrentlyMounted = mountedWidgets.value.some(w => w.id === widget.id && w.surface === 'widget')
  if (isCurrentlyMounted) {
    unmountWidget(widget.id)
  }
  else {
    await mountPersistedWidget(widget.id || widget.sourcePath || widget.path)
  }
  await reloadPersistedWidgets()
}

async function handleMountOfflineWidget(widget: any) {
  await mountPersistedWidget(widget.id || widget.sourcePath || widget.path)
  await reloadPersistedWidgets()
}

function getWidgetTitle(widget: any): string {
  if (widget.title)
    return widget.title
  const path = widget.sourcePath || widget.path || ''
  const filename = path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Widget'
  if (filename.includes('strawberry'))
    return 'Arona\'s Strawberry Pet 🍓'
  if (filename.includes('relu') || filename.includes('companion'))
    return 'ReLU Debugger Buddy'
  if (filename.includes('cafe') || filename.includes('pos'))
    return 'Haven Cafe POS'
  if (filename.includes('vit') || filename.includes('vitals'))
    return 'Vit-AIRI Dev Pulse'
  return filename.replace(/[-_]/g, ' ')
}

function getWidgetSubtitle(widget: any): string {
  if (widget.description)
    return widget.description
  const title = (widget.title || widget.sourcePath || widget.path || '').toLowerCase()
  if (title.includes('strawberry') || title.includes('pet'))
    return 'Your little stage companion.'
  if (title.includes('relu') || title.includes('companion'))
    return 'Companion tools at a glance.'
  if (title.includes('cafe') || title.includes('pos'))
    return 'Your café’s little counter.'
  if (title.includes('vit') || title.includes('pulse') || title.includes('vitals'))
    return 'Workspace activity at a glance.'
  return widget.sourcePath || widget.path || 'Interactive stage widget'
}

function isStrawberryWidget(widget: any): boolean {
  const name = (widget.title || widget.sourcePath || widget.path || '').toLowerCase()
  return name.includes('strawberry') || name.includes('pet')
}
</script>

<template>
  <div
    :class="[
      'fixed inset-x-3 bottom-20 z-50 max-h-[78dvh] flex flex-col',
      'sm:max-w-lg sm:inset-x-auto sm:right-6 sm:bottom-20 sm:w-full',
      'rounded-3xl border border-sky-100/90 dark:border-neutral-800/80',
      'bg-white/95 dark:bg-neutral-900/95',
      'backdrop-blur-xl shadow-2xl shadow-sky-500/10 dark:shadow-black/60',
      'transition-all duration-300',
    ]"
  >
    <!-- Top Drag Indicator -->
    <div class="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-700" />

    <!-- Header -->
    <div class="flex items-center justify-between px-5 pb-2.5 pt-3">
      <div class="flex items-center gap-2.5">
        <div class="size-9.5 flex shrink-0 items-center justify-center border border-cyan-200/60 rounded-xl bg-cyan-50 text-sm text-cyan-500 font-bold font-mono dark:border-cyan-800/40 dark:bg-cyan-950/40 dark:text-cyan-400">
          &gt;_
        </div>
        <div class="flex flex-col">
          <h2 class="text-sm text-neutral-800 font-bold leading-tight dark:text-neutral-100">
            Workspace
          </h2>
          <p class="text-[11px] text-neutral-400 leading-tight">
            Your companion's tools and widgets
          </p>
        </div>
      </div>

      <button
        type="button"
        class="size-7 flex items-center justify-center rounded-lg bg-neutral-100/80 text-neutral-400 transition-colors dark:bg-neutral-800/80 hover:bg-neutral-200/80 dark:text-neutral-400 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title="Close Workspace"
        @click="emit('close')"
      >
        <div class="i-solar:close-square-bold text-base" />
      </button>
    </div>

    <!-- Segmented Tab Switcher -->
    <div class="px-5 pb-3 pt-1">
      <div class="dark:border-neutral-750 flex gap-1 border border-neutral-200/50 rounded-xl bg-neutral-100/90 p-1 dark:bg-neutral-800/70">
        <button
          type="button"
          :class="[
            'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
            activeTab === 'widgets'
              ? 'bg-white text-sky-500 border border-sky-400 shadow-sm dark:bg-neutral-900 dark:text-sky-400 dark:border-sky-500'
              : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200',
          ]"
          @click="activeTab = 'widgets'"
        >
          <div class="i-solar:widget-2-bold-duotone text-sm" />
          Widgets
        </button>
        <button
          type="button"
          :class="[
            'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
            activeTab === 'terminal'
              ? 'bg-white text-sky-500 border border-sky-400 shadow-sm dark:bg-neutral-900 dark:text-sky-400 dark:border-sky-500'
              : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200',
          ]"
          @click="activeTab = 'terminal'"
        >
          <div class="i-solar:code-square-bold-duotone text-sm" />
          Virtual Terminal
        </button>
      </div>
    </div>

    <!-- TAB 1: WIDGETS -->
    <div
      v-if="activeTab === 'widgets'"
      class="flex-1 overflow-y-auto px-5 pb-5 space-y-3.5"
    >
      <div class="text-[11px] text-neutral-500 dark:text-neutral-400">
        Choose what appears on your stage.
      </div>

      <!-- Section: On Stage -->
      <div class="border border-sky-100/80 rounded-2xl bg-white/95 p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
        <button
          type="button"
          class="w-full flex select-none items-center justify-between text-left"
          @click="onStageSectionOpen = !onStageSectionOpen"
        >
          <div class="flex items-center gap-2">
            <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">On stage</span>
            <span class="rounded-full bg-cyan-100 px-2 py-0.2 text-[10px] text-cyan-600 font-bold dark:bg-cyan-950/60 dark:text-cyan-400">
              {{ onStageWidgets.length }}
            </span>
          </div>
          <div
            class="i-solar:alt-arrow-down-bold text-xs text-neutral-400 transition-transform duration-200"
            :class="onStageSectionOpen ? 'rotate-180' : ''"
          />
        </button>

        <div v-if="onStageSectionOpen" class="mt-2.5 space-y-2">
          <div
            v-for="widget in onStageWidgets"
            :key="widget.id"
            class="border-neutral-150/80 flex items-center justify-between border rounded-xl bg-white p-2.5 dark:border-neutral-800/80 dark:bg-neutral-900/90"
          >
            <div class="min-w-0 flex items-center gap-2.5 pr-2">
              <div
                v-if="isStrawberryWidget(widget)"
                class="size-9 flex shrink-0 items-center justify-center border border-pink-100 rounded-xl bg-pink-50 text-lg text-pink-500 shadow-sm dark:border-pink-900/30 dark:bg-pink-950/30"
              >
                🍓
              </div>
              <div
                v-else
                class="size-9 flex shrink-0 items-center justify-center rounded-xl bg-violet-100/80 text-base text-violet-500 dark:bg-violet-950/40 dark:text-violet-400"
              >
                <div class="i-solar:widget-bold text-base" />
              </div>
              <div class="min-w-0 flex flex-col">
                <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-100">
                  {{ getWidgetTitle(widget) }}
                </span>
                <span class="truncate text-[10px] text-neutral-400">
                  {{ getWidgetSubtitle(widget) }}
                </span>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                :class="[
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                  'bg-sky-500',
                ]"
                title="Toggle stage visibility"
                @click="handleToggleOnStage(widget)"
              >
                <span
                  aria-hidden="true"
                  class="pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                />
              </button>
            </div>
          </div>

          <div
            v-if="onStageWidgets.length === 0"
            class="py-4 text-center text-xs text-neutral-400"
          >
            No widgets currently mounted on the stage.
          </div>
        </div>
      </div>

      <!-- Section: More Widgets -->
      <div class="border border-sky-100/80 rounded-2xl bg-white/95 p-3.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
        <button
          type="button"
          class="w-full flex select-none items-center justify-between text-left"
          @click="moreWidgetsSectionOpen = !moreWidgetsSectionOpen"
        >
          <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">More widgets</span>
          <div
            class="i-solar:alt-arrow-down-bold text-xs text-neutral-400 transition-transform duration-200"
            :class="moreWidgetsSectionOpen ? 'rotate-180' : ''"
          />
        </button>

        <div v-if="moreWidgetsSectionOpen" class="mt-2.5 space-y-2">
          <div
            v-for="widget in offlineWidgets"
            :key="widget.id"
            class="border-neutral-150/80 flex items-center justify-between border rounded-xl bg-white p-2.5 dark:border-neutral-800/80 dark:bg-neutral-900/90"
          >
            <div class="min-w-0 flex items-center gap-2.5 pr-2">
              <div
                v-if="isStrawberryWidget(widget)"
                class="size-9 flex shrink-0 items-center justify-center border border-pink-100 rounded-xl bg-pink-50 text-lg text-pink-500 shadow-sm dark:border-pink-900/30 dark:bg-pink-950/30"
              >
                🍓
              </div>
              <div
                v-else
                class="size-9 flex shrink-0 items-center justify-center rounded-xl bg-violet-100/80 text-base text-violet-500 dark:bg-violet-950/40 dark:text-violet-400"
              >
                <div class="i-solar:widget-bold text-base" />
              </div>
              <div class="min-w-0 flex flex-col">
                <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-100">
                  {{ getWidgetTitle(widget) }}
                </span>
                <span class="truncate text-[10px] text-neutral-400">
                  {{ getWidgetSubtitle(widget) }}
                </span>
              </div>
            </div>

            <button
              type="button"
              class="flex shrink-0 items-center gap-1 border border-sky-400 rounded-full px-3 py-1 text-xs text-sky-500 font-semibold transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40"
              @click="handleMountOfflineWidget(widget)"
            >
              <div class="i-solar:add-circle-linear text-sm" />
              Add
            </button>
          </div>

          <div
            v-if="offlineWidgets.length === 0"
            class="py-3 text-center text-xs text-neutral-400"
          >
            No other persisted widgets in <code class="font-mono">/workspace</code>.
          </div>
        </div>
      </div>

      <!-- Footer Persistence Note -->
      <div class="flex items-center gap-2 pt-1 text-[11px] text-neutral-400">
        <div class="i-solar:info-circle-bold size-4 shrink-0 text-neutral-400" />
        <span>Widgets stay on your stage when you close this window.</span>
      </div>
    </div>

    <!-- TAB 2: VIRTUAL TERMINAL -->
    <div
      v-else-if="activeTab === 'terminal'"
      class="min-h-0 flex flex-1 flex-col px-5 pb-5 space-y-3"
    >
      <!-- If Sandbox is not enabled for character -->
      <div
        v-if="!isSandboxAllowed"
        class="my-auto flex flex-1 flex-col items-center justify-center border border-sky-100/80 rounded-2xl bg-white/95 p-6 text-center shadow-sm space-y-3 dark:border-neutral-800 dark:bg-neutral-900/60"
      >
        <div class="size-12 flex items-center justify-center border border-cyan-200/60 rounded-2xl bg-cyan-50 text-xl text-cyan-500 font-bold font-mono shadow-inner dark:border-cyan-800/40 dark:bg-cyan-950/40 dark:text-cyan-400">
          &gt;_
        </div>
        <div class="space-y-1">
          <h3 class="text-sm text-neutral-800 font-bold dark:text-neutral-100">
            Virtual Terminal Disabled
          </h3>
          <p class="max-w-xs text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
            {{ cardStore.activeCard?.name || 'Your companion' }} does not currently have permission to execute commands or interact with the POSIX workspace.
          </p>
        </div>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs text-white font-semibold shadow-md transition-all active:scale-95 hover:bg-sky-600"
          @click="handleEnableSandbox"
        >
          <div class="i-solar:shield-check-bold text-sm" />
          Enable Virtual Terminal
        </button>
        <span class="text-[10px] text-neutral-400">
          Enables in-memory POSIX terminal and interactive widgets
        </span>
      </div>

      <!-- If Sandbox is enabled, render active terminal -->
      <template v-else>
        <!-- Workspace Status Card -->
        <div class="flex shrink-0 items-center justify-between border border-sky-100/80 rounded-2xl bg-white/90 p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/80">
          <div class="flex items-center gap-2.5">
            <div class="size-9 flex shrink-0 items-center justify-center border border-cyan-200/60 rounded-xl bg-cyan-50 text-sm text-cyan-500 font-bold font-mono dark:border-cyan-800/40 dark:bg-cyan-950/40 dark:text-cyan-400">
              &gt;_
            </div>
            <div class="flex flex-col">
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">AIRI Workspace</span>
                <span class="text-[10px] text-neutral-400 font-mono">/workspace</span>
              </div>
              <span class="text-[11px] text-neutral-400">
                Built-in virtual workspace.
              </span>
            </div>
          </div>

          <span class="flex items-center gap-1.5 border border-emerald-200 rounded-full bg-emerald-50 px-2.5 py-0.8 text-[11px] text-emerald-500 font-bold dark:border-emerald-800/40 dark:bg-emerald-950/60 dark:text-emerald-400">
            <span class="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            Ready
          </span>
        </div>

        <!-- Terminal Header -->
        <div class="flex shrink-0 items-center justify-between pt-0.5">
          <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">Terminal</span>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="flex items-center gap-1 border border-neutral-200/80 rounded-lg bg-white/80 px-2.5 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              title="Clear buffer"
              @click="clearLogs"
            >
              <div class="i-solar:trash-bin-trash-bold text-xs text-neutral-400" />
              Clear
            </button>
            <button
              type="button"
              class="flex items-center gap-1 border border-neutral-200/80 rounded-lg bg-white/80 px-2.5 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              title="Restart sandbox"
              @click="reset"
            >
              <div class="i-solar:restart-square-linear text-xs text-neutral-400" />
              Restart
            </button>
          </div>
        </div>

        <!-- Command History Feed -->
        <div
          ref="terminalScrollRef"
          class="max-h-[340px] min-h-[160px] flex-1 overflow-y-auto pr-0.5 space-y-2.5"
        >
          <div
            v-if="commandHistory.length === 0"
            class="select-none border border-sky-100/70 rounded-2xl bg-sky-50/30 p-4 text-xs text-neutral-400 font-mono dark:border-neutral-800 dark:bg-neutral-900/40"
          >
            <div class="text-sky-500 font-bold">
              airi@sandbox:~$ # Workspace ready.
            </div>
            <div class="mt-1 text-[11px] text-neutral-400">
              Run commands to inspect files, query state, or test widgets.
            </div>
          </div>

          <div
            v-for="entry in commandHistory"
            :key="entry.id"
            class="border border-sky-100/80 rounded-2xl bg-sky-50/40 p-3 space-y-2 dark:border-neutral-800 dark:bg-neutral-900/60"
          >
            <!-- Command Prompt Header -->
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-1.5 font-mono">
                <span class="text-sky-500 font-bold">airi@sandbox:~$</span>
                <span class="text-neutral-900 font-bold dark:text-neutral-100">{{ entry.command }}</span>
              </div>
              <div class="flex items-center gap-1.5 font-mono">
                <span v-if="entry.durationMs" class="text-[10px] text-neutral-400">
                  {{ entry.durationMs }} ms
                </span>
                <span
                  :class="[
                    'rounded-full px-2 py-0.2 text-[10px] font-bold lowercase',
                    entry.exitCode === 0
                      ? 'bg-emerald-100/80 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-rose-100/80 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
                  ]"
                >
                  exit {{ entry.exitCode }}
                </span>
              </div>
            </div>

            <!-- Command Stdout / Stderr -->
            <pre
              v-if="entry.stdout"
              class="overflow-x-auto whitespace-pre text-[11px] text-neutral-700 leading-relaxed font-mono dark:text-neutral-300"
              v-html="ansiToHtml(entry.stdout)"
            />
            <pre
              v-if="entry.stderr"
              class="overflow-x-auto whitespace-pre text-[11px] text-rose-500 leading-relaxed font-mono dark:text-rose-400"
              v-html="ansiToHtml(entry.stderr)"
            />
          </div>
        </div>

        <!-- Command Input Bar -->
        <div class="flex shrink-0 items-center gap-2 border border-neutral-200/80 rounded-2xl bg-white/90 p-1.5 pl-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/90">
          <span class="shrink-0 text-xs text-sky-500 font-bold font-mono">
            airi@sandbox:~$
          </span>
          <input
            v-model="commandInput"
            type="text"
            placeholder="Run a command..."
            class="flex-1 bg-transparent text-xs text-neutral-800 font-mono outline-none dark:text-neutral-100 placeholder:text-neutral-400"
            :disabled="isExecuting"
            @keydown.enter.prevent="handleRunCommand"
            @keydown.up.prevent="handleHistoryNav('up')"
            @keydown.down.prevent="handleHistoryNav('down')"
          >
          <button
            type="button"
            :disabled="isExecuting || !commandInput.trim()"
            :class="[
              'shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all',
              commandInput.trim() && !isExecuting
                ? 'bg-sky-500 text-white hover:bg-sky-600 shadow-sky-500/25 active:scale-95'
                : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500 cursor-not-allowed',
            ]"
            @click="handleRunCommand"
          >
            <div class="i-solar:plain-bold text-xs" />
            Run
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
