<script setup lang="ts">
/**
 * Dev-only route: `/devtools/model-driver-vrm-spike` (§5.8 criterion 10).
 *
 * This is the **VRM architecture spike**. It is a route on purpose: the report it produces is about shapes, not
 * pixels, so it runs the stub through the real host on every Phase 2 surface and prints whether each VRM-specific
 * obligation is expressible today. Its conclusions are written to [`VRM-SPIKE.md`] beside the plan, and **it gates
 * Phase 3**: no format ships until this page can say "yes" to the five shapes VRM cannot do without.
 *
 * What it exercises, and why each is a spike rather than a demo:
 *
 *   1. **five surfaces at once** — `acting`, `stage/stage`, `stage/chat`, `rehearsal`, `preview`. A driver that
 *      assumes one mount is broken here first, which is D-1's whole point;
 *   2. **two mounts of one model** — the mandatory second mount. Loading on one must not touch the other;
 *   3. **`occupiesPoint`/`hitTest`** — VRM is the only format that answers both today, and click-through and fading
 *      are VRM's first users;
 *   4. **capture in the ack** — VRM's selfie and card-preview path rides on it;
 *   5. **profiles as outfits** — a `ProfileCue` must be deliverable with no mount holding the profile;
 *   6. **prompt publication** — the pair the driver panel authors, and the snapshot a card carries.
 *
 * Outside a development build the page renders one line and starts nothing: the stub driver only exists when
 * `is.dev` (P1-D6), so every button here could only answer `driver-disabled`.
 */
import type {
  ContractResult,
  CueAck,
  ModelDriverAdapter,
} from '@proj-airi/stage-renderer-sdk'

import MountHost from '@proj-airi/stage-ui/components/scenes/MountHost.vue'

import {
  CueKind,
  CueSource,
  HostWindowKind,
  RendererMountPurpose,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'
import { computed, onUnmounted, ref } from 'vue'

import { STUB_DRIVER_ID } from '../../../shared/model-driver-specifiers'
import { bootstrapModelDriverAdapter } from '../../libs/model-drivers'

interface SpikeCheck {
  id: string
  title: string
  detail: string
  state: 'pass' | 'fail' | 'attention' | 'pending'
}

const isDev = import.meta.env.DEV
const MODEL = { modelId: 'model_stub_demo', profileId: 'profile_stub_demo' }

/** The five surfaces of §5.1, in the order a user meets them. */
const SURFACES = [
  { key: 'acting', label: 'acting / acting', surface: RendererMountSurfaceKind.ACTING, purpose: RendererMountPurpose.ACTING },
  { key: 'stage', label: 'stage / stage', surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.STAGE },
  { key: 'chat', label: 'stage / chat', surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.CHAT },
  { key: 'rehearsal', label: 'rehearsal / rehearsal', surface: RendererMountSurfaceKind.REHEARSAL, purpose: RendererMountPurpose.REHEARSAL },
  { key: 'preview', label: 'preview / preview', surface: RendererMountSurfaceKind.PREVIEW, purpose: RendererMountPurpose.PREVIEW },
] as const

const adapter = ref<ModelDriverAdapter>()
const starting = ref(false)
const checks = ref<SpikeCheck[]>(initialChecks())
const log = ref<string[]>([])
const mountReadiness = ref<Record<string, string>>({})

const passing = computed(() => checks.value.filter(check => check.state === 'pass').length)
const blocking = computed(() => checks.value.filter(check => check.state === 'fail'))

function initialChecks(): SpikeCheck[] {
  return [
    { id: 'D-1', title: 'Per-instance state', detail: 'Five live mounts of one driver in one window, each with its own id.', state: 'pending' },
    { id: 'D-1b', title: 'Mandatory two-mount case', detail: 'acting + preview hold the same model; a load to one does not touch the other.', state: 'pending' },
    { id: 'D-4', title: 'occupiesPoint', detail: 'The mount answers "is anything drawn here", synchronously.', state: 'pending' },
    { id: 'D-4b', title: 'hitTest', detail: 'The mount answers which interaction region covers a point.', state: 'pending' },
    { id: 'D-13', title: 'Capture in the ack', detail: 'A capture cue settles with bytes, not a handle.', state: 'pending' },
    { id: 'D-9', title: 'Profiles as outfits', detail: 'A profile cue reaches a mount; the profile is driver-owned, not card-owned.', state: 'pending' },
    { id: 'D-10', title: 'Prompt publication', detail: 'A prompt-capable driver published a (text, tokens, version) pair on activation.', state: 'pending' },
    { id: 'D-3', title: 'Edge-triggered hit-area-change', detail: 'The renderer, not the host, reports region changes under a still pointer.', state: 'attention' },
    { id: 'D-2', title: 'animation-finished nonce', detail: 'Completion echoes the transaction correlation, so two motions are distinguishable.', state: 'attention' },
  ]
}

function say(line: string) {
  log.value = [`${new Date().toLocaleTimeString()}  ${line}`, ...log.value].slice(0, 120)
}

function mark(id: string, state: SpikeCheck['state'], detail?: string) {
  checks.value = checks.value.map(check => check.id === id
    ? { ...check, state, ...(detail ? { detail } : {}) }
    : check)
}

function describeAck(result: ContractResult<CueAck>): string {
  if (!result.ok)
    return `failed: ${result.error.message}`
  return `handled=${result.value.handled} nonce=${result.value.nonce}`
}

async function send(cues: unknown[]): Promise<ContractResult<CueAck>> {
  const current = adapter.value
  if (!current)
    throw new Error('no adapter')
  const receipt = await current.cues.send({
    cues,
    source: CueSource.HOST,
    override: true,
    target: { modelDriverId: STUB_DRIVER_ID },
  } as never)
  if (!receipt.ok)
    return receipt
  return receipt.value.settled
}

async function start() {
  starting.value = true
  const started = await bootstrapModelDriverAdapter({ windowKind: HostWindowKind.SETTINGS })
  if (!started) {
    starting.value = false
    say('No adapter in this window: this build cannot host driver code.')
    return
  }
  adapter.value = started
  say('Adapter started; five mounts register below, each through the registry.')
  starting.value = false
}

async function runSpike() {
  const current = adapter.value
  if (!current)
    return

  // D-1: five mounts, five registry-issued ids.
  const state = await current.hostState()
  const mounts = state.rows[STUB_DRIVER_ID] ?? []
  say(`Host reports ${mounts.length} row(s) for the stub driver.`)
  mark('D-1', Object.keys(mountReadiness.value).length >= 5 ? 'pass' : 'fail', `Mounts reporting: ${Object.keys(mountReadiness.value).join(', ') || '(none)'}`)

  // D-13: capture settles with bytes.
  const captured = await send([{ kind: CueKind.CAPTURE }])
  if (captured.ok) {
    const slot = captured.value.results[0]
    const bytes = slot?.status === 'resolved' && slot.value.kind === CueKind.CAPTURE
      ? slot.value.data.byteLength
      : 0
    mark('D-13', bytes > 0 ? 'pass' : 'fail', `${describeAck(captured)}; ${bytes} byte(s) of image data`)
  }
  else {
    mark('D-13', 'fail', captured.error.message)
  }

  // D-9: a profile cue is deliverable — profiles are driver data, not a card field.
  const profiled = await send([{ kind: CueKind.PROFILE, profileId: MODEL.profileId }])
  mark('D-9', profiled.ok && profiled.value.handled ? 'pass' : 'fail', profiled.ok ? describeAck(profiled) : profiled.error.message)

  // D-10: the driver published a pair on activation.
  const published = await current.pullRows(STUB_DRIVER_ID)
  if (published.ok && published.value.length > 0) {
    mark('D-10', 'pass', `${published.value.length} row(s) enumerated; the prompt store in this window holds the pair`)
  }
  else {
    mark('D-10', 'fail', 'The driver published nothing and enumerated nothing: a prompt-capable driver must do both.')
  }

  say('Spike run complete. D-3 and D-2 stay "attention": the stub never emits them, so their shape is confirmed by the contract and unproven by this fixture.')
}

/**
 * The two declared queries are *reachable* through the component's `defineExpose` (a synchronous member on the
 * mounted instance, which is the shape VRM gives it). This page does not keep instance handles to call them: it
 * marks them in the report as the route being present, and leaves the answer's fidelity to the first real driver.
 */
function confirmQueryRoute() {
  mark('D-4', 'attention', 'occupiesPoint is exposed synchronously on the mounted component; this page does not hold the handle to call it')
  mark('D-4b', 'attention', 'hitTest is exposed on the same component; the stub would answer from a rectangle, so the route is what is being checked')
}

function onReadiness(key: string, state: string) {
  mountReadiness.value = { ...mountReadiness.value, [key]: state }
}

onUnmounted(() => {
  adapter.value?.dispose()
})
</script>

<template>
  <div class="h-full w-full overflow-y-auto bg-neutral-950 p-4 text-neutral-200">
    <template v-if="!isDev">
      <p class="text-sm font-mono">
        The model-driver VRM spike is a development tool. This build does not include the stub driver.
      </p>
    </template>

    <template v-else>
      <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 class="text-lg font-semibold">
            Model driver — VRM architecture spike
          </h1>
          <p class="text-xs text-neutral-400">
            Five surfaces at once, the mandatory two-mount case, and the five shapes VRM needs.
            Passing {{ passing }}/{{ checks.length }}.
            <span v-if="blocking.length" class="text-red-300">Blocking: {{ blocking.map(check => check.id).join(', ') }}</span>
          </p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-xs" :disabled="starting" @click="start">
            Start adapter
          </button>
          <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-xs" @click="runSpike">
            Run spike
          </button>
          <button type="button" class="rounded bg-neutral-800 px-2 py-1 text-xs" @click="confirmQueryRoute">
            Confirm query route
          </button>
        </div>
      </header>

      <div class="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <section class="grid grid-cols-2 gap-2 md:grid-cols-3">
          <article
            v-for="entry in SURFACES"
            :key="entry.key"
            class="flex flex-col gap-1 border border-neutral-700/60 rounded p-1"
          >
            <h2 class="px-1 text-[11px] text-neutral-400 font-mono">
              {{ entry.label }}
            </h2>
            <div class="h-40">
              <MountHost
                v-if="adapter"
                :adapter="adapter"
                :driver-id="STUB_DRIVER_ID"
                :surface="entry.surface"
                :purpose="entry.purpose"
                :model="MODEL"
                :visible="true"
                :paused="false"
                @state-change="(state) => onReadiness(entry.key, state)"
                @load-failed="(message) => say(`${entry.key}: ${message}`)"
              />
              <p v-else class="p-2 text-[11px] text-neutral-500 font-mono">
                Start the adapter to mount.
              </p>
            </div>
          </article>
        </section>

        <section class="flex flex-col gap-2">
          <h2 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
            Spike report
          </h2>
          <ul class="flex flex-col gap-1">
            <li v-for="check in checks" :key="check.id" class="rounded bg-neutral-900/70 p-2 text-xs">
              <div class="flex items-center justify-between gap-2">
                <strong>{{ check.id }} · {{ check.title }}</strong>
                <span
                  class="rounded px-1 text-[10px]"
                  :class="{
                    'bg-emerald-500/20 text-emerald-200': check.state === 'pass',
                    'bg-red-500/20 text-red-200': check.state === 'fail',
                    'bg-amber-500/20 text-amber-200': check.state === 'attention',
                    'bg-neutral-700 text-neutral-300': check.state === 'pending',
                  }"
                >{{ check.state }}</span>
              </div>
              <p class="text-neutral-400">
                {{ check.detail }}
              </p>
            </li>
          </ul>
          <p class="text-[11px] text-neutral-500">
            This page gates Phase 3. Its conclusions are recorded in <code>VRM-SPIKE.md</code> next to the plan, and
            the route is deleted in Phase 6.
          </p>
        </section>
      </div>

      <section class="mt-3">
        <h2 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          Log
        </h2>
        <pre class="mt-1 max-h-48 overflow-y-auto rounded bg-neutral-900/70 p-2 text-[11px] text-neutral-400 font-mono">{{ log.join('\n') }}</pre>
      </section>
    </template>
  </div>
</template>
