<script setup lang="ts">
import type { CadenceBoundaryEvaluation } from '@proj-airi/stage-ui/libs/cadence'

import { evaluateCadenceSplits } from '@proj-airi/stage-ui/libs/cadence'
import { useSystemOneStore } from '@proj-airi/stage-ui/stores/modules/system-one'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

const multiBubbleEnabled = defineModel<boolean>('multiBubbleEnabled', { default: false })
const splitThreshold = defineModel<number>('splitThreshold', { default: 0.45 })
const interBubblePauseMs = defineModel<number>('interBubblePauseMs', { default: 800 })
const typingCadenceMsPerChar = defineModel<number>('typingCadenceMsPerChar', { default: 45 })
const maxBubblesPerTurn = defineModel<number>('maxBubblesPerTurn', { default: 4 })

const systemOneStore = useSystemOneStore()
const router = useRouter()

const isSystemOneConfigured = computed(() => systemOneStore.configured)

// Audition Sandbox State
const SAMPLE_PRESETS = [
  {
    name: 'Casual Quips',
    text: `Wait really?\n\nI had no idea that happened!\n\nTell me everything right now.`,
  },
  {
    name: 'Sarcastic Comeback',
    text: `Oh wow, what a complete surprise.\n\nYou really thought that was going to work?\n\nBetter luck next time.`,
  },
  {
    name: 'Markdown List (Joined)',
    text: `Here are the steps to follow:\n1. First step in the instructions\n2. Second step in the instructions\n3. Third step in the instructions`,
  },
]

const testText = ref(SAMPLE_PRESETS[0].text)
const isEvaluating = ref(false)
const evaluationError = ref<string | null>(null)
const evalLatency = ref<number | null>(null)
const boundaryEvaluations = ref<CadenceBoundaryEvaluation[]>([])
const resolvedBubbles = ref<string[]>([])

// Playback Simulation State
const isPlayingSimulation = ref(false)
const simulatedRevealedBubbles = ref<string[]>([])
const isSimulatedTyping = ref(false)
let simulationTimeout: any = null

function applyPreset(presetText: string) {
  testText.value = presetText
  resolvedBubbles.value = []
  boundaryEvaluations.value = []
  evalLatency.value = null
  evaluationError.value = null
  stopSimulation()
}

async function runEvaluation() {
  if (!isSystemOneConfigured.value)
    return

  isEvaluating.value = true
  evaluationError.value = null
  stopSimulation()

  try {
    const res = await evaluateCadenceSplits(testText.value, {
      splitThreshold: splitThreshold.value,
      maxBubbles: maxBubblesPerTurn.value,
      systemOneExecute: (state, questions) => systemOneStore.execute(state, questions),
    })

    resolvedBubbles.value = res.bubbles
    boundaryEvaluations.value = res.evaluations
    evalLatency.value = res.latencyMs ?? null
  }
  catch (err: any) {
    evaluationError.value = err?.message || String(err)
  }
  finally {
    isEvaluating.value = false
  }
}

function stopSimulation() {
  if (simulationTimeout) {
    clearTimeout(simulationTimeout)
    simulationTimeout = null
  }
  isPlayingSimulation.value = false
  isSimulatedTyping.value = false
}

async function playBurstSimulation() {
  if (resolvedBubbles.value.length === 0) {
    await runEvaluation()
  }

  if (resolvedBubbles.value.length === 0)
    return

  stopSimulation()
  isPlayingSimulation.value = true
  simulatedRevealedBubbles.value = []

  let index = 0
  const bubbles = resolvedBubbles.value

  const stepNext = () => {
    if (index >= bubbles.length) {
      isPlayingSimulation.value = false
      isSimulatedTyping.value = false
      return
    }

    const currentText = bubbles[index]
    isSimulatedTyping.value = true

    // Simulated typing duration clamped between 300ms and 1800ms for demo feel
    const typeDelay = Math.min(
      1800,
      Math.max(300, currentText.length * typingCadenceMsPerChar.value),
    )

    simulationTimeout = setTimeout(() => {
      isSimulatedTyping.value = false
      simulatedRevealedBubbles.value.push(currentText)
      index++

      if (index < bubbles.length) {
        simulationTimeout = setTimeout(() => {
          stepNext()
        }, interBubblePauseMs.value)
      }
      else {
        isPlayingSimulation.value = false
      }
    }, typeDelay)
  }

  stepNext()
}

function navigateToSystemOneSettings() {
  router.push('/settings/modules/system-one')
}

onBeforeUnmount(() => {
  stopSimulation()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-neutral-200/80 pb-3 dark:border-neutral-800">
      <div class="flex items-center gap-2">
        <div class="i-solar:chat-round-line-bold-duotone text-lg text-primary-500" />
        <h3 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
          Conversational Cadence & Multi-Bubble Delivery
        </h3>
      </div>
      <span
        :class="[
          'px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider',
          multiBubbleEnabled && isSystemOneConfigured
            ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300 border border-green-200 dark:border-green-800'
            : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700',
        ]"
      >
        {{ multiBubbleEnabled && isSystemOneConfigured ? 'Active' : 'Disabled' }}
      </span>
    </div>

    <!-- System 1 Mandatory Coprocessor Gate Warning -->
    <div
      v-if="!isSystemOneConfigured"
      class="border border-amber-500/40 rounded-xl bg-amber-500/10 p-4 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200"
    >
      <div class="flex items-start gap-3">
        <div class="i-solar:shield-warning-bold-duotone mt-0.5 shrink-0 text-base text-amber-600 dark:text-amber-400" />
        <div class="flex flex-1 flex-col gap-1.5">
          <div class="font-semibold">
            System 1 Coprocessor Required
          </div>
          <p class="leading-relaxed opacity-90">
            Conversational Cadence evaluates newline split boundaries using non-autoregressive discrete decisions (Jev 1.13 or on-device Laya). Multi-bubble cadence cannot be enabled without an active System 1 provider.
          </p>
          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              class="flex items-center gap-1.5 border border-amber-600/30 rounded-lg bg-amber-600 px-3 py-1.5 text-white font-medium shadow-sm transition-all active:scale-98 hover:bg-amber-700"
              @click="navigateToSystemOneSettings"
            >
              <span>Configure System 1</span>
              <span class="i-solar:arrow-right-bold text-xs" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Master Enable Switch -->
    <div class="border border-neutral-200/80 rounded-xl bg-white p-4 shadow-sm dark:border-neutral-700/80 dark:bg-neutral-900/60">
      <div class="flex items-center justify-between">
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <input
              id="multi-bubble-toggle"
              v-model="multiBubbleEnabled"
              type="checkbox"
              :disabled="!isSystemOneConfigured"
              class="h-4 w-4 border-gray-300 rounded text-primary-600 disabled:opacity-50 focus:ring-primary-500"
            >
            <label
              for="multi-bubble-toggle"
              :class="[
                'text-sm font-semibold select-none',
                isSystemOneConfigured ? 'cursor-pointer text-neutral-800 dark:text-neutral-100' : 'cursor-not-allowed text-neutral-400 dark:text-neutral-600',
              ]"
            >
              Enable Multi-Bubble Burst Delivery
            </label>
          </div>
          <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
            Intelligently splits single-turn LLM replies across natural newline boundaries into consecutive virtual chat bubbles.
          </p>
        </div>
      </div>
    </div>

    <!-- Cadence Tuning Parameters -->
    <div
      class="border border-neutral-200/80 rounded-xl bg-white p-4 shadow-sm dark:border-neutral-700/80 dark:bg-neutral-900/60"
      :class="{ 'opacity-60 pointer-events-none': !multiBubbleEnabled || !isSystemOneConfigured }"
    >
      <div class="mb-3 flex items-center gap-2">
        <div class="i-solar:tuning-square-2-bold-duotone text-base text-primary-500" />
        <h4 class="text-xs text-neutral-800 font-semibold tracking-wider uppercase dark:text-neutral-200">
          Cadence Tuning Parameters
        </h4>
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
        <!-- Split Confidence Threshold -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Split Confidence Threshold
            </label>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 font-medium font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ splitThreshold.toFixed(2) }}
            </span>
          </div>
          <input
            v-model.number="splitThreshold"
            type="range"
            min="0.35"
            max="0.75"
            step="0.05"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
          >
          <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
            Jev probability required to split a boundary (0.45 recommended). Lower values split more eagerly into separate bubbles; higher values keep paragraphs joined.
          </span>
        </div>

        <!-- Max Bubbles Per Turn -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Max Bubbles Per Turn
            </label>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 font-medium font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ maxBubblesPerTurn }} bubbles
            </span>
          </div>
          <input
            v-model.number="maxBubblesPerTurn"
            type="range"
            min="1"
            max="6"
            step="1"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
          >
          <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
            Ceiling on the number of individual bubbles produced for a single assistant reply.
          </span>
        </div>

        <!-- Inter-Bubble Pause -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Inter-Bubble Pause Delay
            </label>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 font-medium font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ interBubblePauseMs }} ms
            </span>
          </div>
          <input
            v-model.number="interBubblePauseMs"
            type="range"
            min="300"
            max="2500"
            step="50"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
          >
          <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
            Staggered pause interval between consecutive bubbles popping into view.
          </span>
        </div>

        <!-- Typing Cadence Per Character -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Simulated Typing Cadence
            </label>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 font-medium font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ typingCadenceMsPerChar }} ms/char
            </span>
          </div>
          <input
            v-model.number="typingCadenceMsPerChar"
            type="range"
            min="15"
            max="100"
            step="5"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
          >
          <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
            Rate at which the typing indicator holds between bursts before dispatching each bubble.
          </span>
        </div>
      </div>
    </div>

    <!-- Cadence Audition Sandbox -->
    <div class="border border-neutral-200/80 rounded-xl bg-white p-4 shadow-sm dark:border-neutral-700/80 dark:bg-neutral-900/60">
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="i-solar:test-tube-bold-duotone text-base text-primary-500" />
          <h4 class="text-xs text-neutral-800 font-semibold tracking-wider uppercase dark:text-neutral-200">
            Cadence Audition Sandbox
          </h4>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            v-for="preset in SAMPLE_PRESETS"
            :key="preset.name"
            type="button"
            class="border border-neutral-200 rounded-lg px-2.5 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-700 hover:border-neutral-300 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            @click="applyPreset(preset.text)"
          >
            {{ preset.name }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <textarea
          v-model="testText"
          rows="4"
          placeholder="Enter dialogue text with newline splits to test..."
          class="w-full border border-neutral-200 rounded-lg p-2.5 text-xs font-mono transition-colors dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-950/60 dark:text-neutral-200 focus:outline-none"
        />

        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              :disabled="isEvaluating || !isSystemOneConfigured || !testText.trim()"
              class="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs text-white font-medium shadow-sm transition-all active:scale-98 disabled:cursor-not-allowed hover:bg-primary-700 disabled:opacity-50"
              @click="runEvaluation"
            >
              <span v-if="isEvaluating" class="i-eos-icons:loading text-xs" />
              <span v-else class="i-solar:play-bold text-xs" />
              <span>Evaluate Jev Splits</span>
            </button>

            <button
              v-if="resolvedBubbles.length > 0"
              type="button"
              :disabled="isPlayingSimulation"
              class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-100 px-3.5 py-1.5 text-xs text-neutral-800 font-medium transition-all active:scale-98 dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700"
              @click="playBurstSimulation"
            >
              <span v-if="isPlayingSimulation" class="i-solar:stop-circle-bold text-xs text-rose-500" />
              <span v-else class="i-solar:play-circle-bold text-xs text-emerald-500" />
              <span>{{ isPlayingSimulation ? 'Simulating...' : 'Simulate Delivery Burst' }}</span>
            </button>
          </div>

          <span v-if="evalLatency !== null" class="text-[11px] text-neutral-500 font-mono dark:text-neutral-400">
            Jev latency: {{ evalLatency }}ms
          </span>
        </div>

        <!-- Evaluation Error -->
        <div v-if="evaluationError" class="border border-rose-200 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {{ evaluationError }}
        </div>

        <!-- Boundary Decisions Matrix -->
        <div v-if="boundaryEvaluations.length > 0" class="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div class="text-[11px] text-neutral-600 font-semibold uppercase dark:text-neutral-400">
            Boundary Classification Decisions ({{ boundaryEvaluations.length }} boundaries evaluated)
          </div>
          <div class="flex flex-col gap-2">
            <div
              v-for="b in boundaryEvaluations"
              :key="b.index"
              class="flex items-center justify-between border border-neutral-100 rounded-lg bg-neutral-50/70 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-950/40"
            >
              <div class="flex items-center gap-2 overflow-hidden">
                <span class="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-mono dark:bg-neutral-800">
                  #{{ b.index + 1 }}
                </span>
                <span class="max-w-60 truncate text-neutral-500 font-mono">
                  "{{ b.before }}" → "{{ b.after }}"
                </span>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="text-[11px] text-neutral-500 font-mono">
                  P(split) = {{ b.score.toFixed(2) }}
                </span>
                <span
                  :class="[
                    'px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
                    b.isSplit
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
                  ]"
                >
                  {{ b.isSplit ? 'Split' : 'Joined' }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Simulated Visual Chat Bubbles Preview -->
        <div v-if="resolvedBubbles.length > 0" class="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div class="flex items-center justify-between">
            <div class="text-[11px] text-neutral-600 font-semibold uppercase dark:text-neutral-400">
              Resolved Output ({{ resolvedBubbles.length }} {{ resolvedBubbles.length === 1 ? 'bubble' : 'bubbles' }})
            </div>
            <span v-if="isPlayingSimulation" class="animate-pulse text-[11px] text-primary-500 font-medium">
              Playing burst cadence...
            </span>
          </div>

          <div class="flex flex-col gap-2 border border-neutral-200/80 rounded-xl bg-neutral-100/50 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
            <!-- Normal preview when not running simulation -->
            <template v-if="!isPlayingSimulation && simulatedRevealedBubbles.length === 0">
              <div
                v-for="(bubble, bIdx) in resolvedBubbles"
                :key="bIdx"
                class="max-w-[85%] self-start border border-primary-500/20 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-neutral-800 shadow-sm transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <div class="whitespace-pre-wrap">
                  {{ bubble }}
                </div>
              </div>
            </template>

            <!-- Dynamic step-by-step simulated playback -->
            <template v-else>
              <div
                v-for="(bubble, bIdx) in simulatedRevealedBubbles"
                :key="bIdx"
                class="max-w-[85%] animate-fade-in self-start border border-primary-500/20 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-neutral-800 shadow-sm transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <div class="whitespace-pre-wrap">
                  {{ bubble }}
                </div>
              </div>

              <div
                v-if="isSimulatedTyping"
                class="flex items-center self-start gap-1.5 border border-neutral-300 rounded-2xl border-dashed bg-neutral-50 px-3.5 py-2 text-xs text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900/60"
              >
                <span class="i-eos-icons:three-dots-loading text-base" />
                <span class="text-[11px] italic">typing...</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
