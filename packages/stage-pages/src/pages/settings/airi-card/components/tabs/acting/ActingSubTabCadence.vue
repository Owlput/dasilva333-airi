<script setup lang="ts">
import type { CadenceBoundaryEvaluation } from '@proj-airi/stage-ui/libs/cadence'

import { evaluateCadenceSplits } from '@proj-airi/stage-ui/libs/cadence'
import { useSystemOneStore } from '@proj-airi/stage-ui/stores/modules/system-one'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

const multiBubbleEnabled = defineModel<boolean>('multiBubbleEnabled', { default: false })
const splitThreshold = defineModel<number>('splitThreshold', { default: 0.45 })
const interBubblePauseMs = defineModel<number>('interBubblePauseMs', { default: 800 })
const typingCadenceMsPerChar = defineModel<number>('typingCadenceMsPerChar', { default: 35 })
const maxBubblesPerTurn = defineModel<number>('maxBubblesPerTurn', { default: 4 })
const dynamicPacingEnabled = defineModel<boolean>('dynamicPacingEnabled', { default: true })
const rapidBurstMs = defineModel<number>('rapidBurstMs', { default: 350 })
const conversationalBeatMs = defineModel<number>('conversationalBeatMs', { default: 900 })
const thoughtfulPauseMs = defineModel<number>('thoughtfulPauseMs', { default: 1800 })
const maxDelayCeilingMs = defineModel<number>('maxDelayCeilingMs', { default: 3500 })

const systemOneStore = useSystemOneStore()
const router = useRouter()

const isSystemOneConfigured = computed(() => systemOneStore.configured)
const showAdvancedPacing = ref(false)

// Audition Sandbox State
const SAMPLE_PRESETS = [
  {
    name: 'Grocery List (Benchmark)',
    text: `Hey dont forget to bring the grocery list tonight\n\nmake sure to bring\n-bananas\n-pears\n-lettuce\n-milk\n-eggs\n\nlove ya see you soon`,
  },
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
const evalPausesMs = ref<number[]>([])

// Playback Simulation State
const isPlayingSimulation = ref(false)
const simulatedRevealedBubbles = ref<string[]>([])
const isSimulatedTyping = ref(false)
let simulationTimeout: any = null

function applyPreset(presetText: string) {
  testText.value = presetText
  resolvedBubbles.value = []
  boundaryEvaluations.value = []
  evalPausesMs.value = []
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
      dynamicPacing: dynamicPacingEnabled.value,
      rapidBurstMs: rapidBurstMs.value,
      conversationalBeatMs: conversationalBeatMs.value,
      thoughtfulPauseMs: thoughtfulPauseMs.value,
      typingCadenceMsPerChar: typingCadenceMsPerChar.value,
      maxDelayCeilingMs: maxDelayCeilingMs.value,
      systemOneExecute: (state, questions) => systemOneStore.execute(state, questions),
    })

    resolvedBubbles.value = res.bubbles
    boundaryEvaluations.value = res.evaluations
    evalPausesMs.value = res.pausesMs
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

    // Simulated typing duration clamped between 250ms and 1500ms
    const typeDelay = Math.min(
      1500,
      Math.max(250, currentText.length * typingCadenceMsPerChar.value),
    )

    simulationTimeout = setTimeout(() => {
      isSimulatedTyping.value = false
      simulatedRevealedBubbles.value.push(currentText)
      index++

      if (index < bubbles.length) {
        // Dynamic pacing delay calculated from Jev semantic expectation + upcoming physical length
        const pauseDelay = evalPausesMs.value[index - 1] ?? interBubblePauseMs.value
        simulationTimeout = setTimeout(() => {
          stepNext()
        }, pauseDelay)
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
            Conversational Cadence evaluates newline split boundaries and semantic delay pacing using non-autoregressive discrete decisions (Jev 1.13 or on-device Laya). Multi-bubble cadence cannot be enabled without an active System 1 provider.
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
      <div class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="i-solar:tuning-square-2-bold-duotone text-base text-primary-500" />
          <h4 class="text-xs text-neutral-800 font-semibold tracking-wider uppercase dark:text-neutral-200">
            Cadence Tuning Parameters
          </h4>
        </div>
        <button
          type="button"
          class="flex items-center gap-1 text-[11px] text-primary-600 font-medium dark:text-primary-400 hover:underline"
          @click="showAdvancedPacing = !showAdvancedPacing"
        >
          <span>{{ showAdvancedPacing ? 'Hide Rhythm Weights' : 'Tune Rhythm Weights' }}</span>
          <span :class="showAdvancedPacing ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear'" class="text-xs" />
        </button>
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
            Jev probability required to split a boundary (0.45 recommended). Lower values split more eagerly; higher values keep paragraphs joined.
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

        <!-- Typing Cadence Per Character -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Simulated Typing Velocity
            </label>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 font-medium font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ typingCadenceMsPerChar }} ms/char
            </span>
          </div>
          <input
            v-model.number="typingCadenceMsPerChar"
            type="range"
            min="10"
            max="80"
            step="5"
            class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
          >
          <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
            Physical typing speed modeling character output length (25–40 ms/char recommended).
          </span>
        </div>

        <!-- Dynamic Semantic Pacing Toggle -->
        <div class="flex flex-col justify-center gap-1.5">
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <label for="dynamic-pacing-toggle" class="cursor-pointer text-xs text-neutral-700 font-medium dark:text-neutral-300">
                Jev Semantic Delay Pacing
              </label>
              <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
                Evaluates conversational rhythm (rapid burst vs beat vs pause) in parallel with boundary splits.
              </span>
            </div>
            <input
              id="dynamic-pacing-toggle"
              v-model="dynamicPacingEnabled"
              type="checkbox"
              class="h-4 w-4 border-gray-300 rounded text-primary-600 focus:ring-primary-500"
            >
          </div>
        </div>
      </div>

      <!-- Advanced Pacing Weights (Collapsible) -->
      <div v-if="showAdvancedPacing" class="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <h5 class="mb-3 text-[11px] text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
          Rhythm Softmax Durations & Safety Ceiling
        </h5>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-neutral-600 dark:text-neutral-400">Rapid Burst</span>
              <span class="font-mono">{{ rapidBurstMs }}ms</span>
            </div>
            <input
              v-model.number="rapidBurstMs"
              type="range"
              min="150"
              max="700"
              step="25"
              class="h-1 w-full cursor-pointer appearance-none rounded bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
            >
          </div>

          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-neutral-600 dark:text-neutral-400">Conversational Beat</span>
              <span class="font-mono">{{ conversationalBeatMs }}ms</span>
            </div>
            <input
              v-model.number="conversationalBeatMs"
              type="range"
              min="400"
              max="1600"
              step="50"
              class="h-1 w-full cursor-pointer appearance-none rounded bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
            >
          </div>

          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-neutral-600 dark:text-neutral-400">Thoughtful Pause</span>
              <span class="font-mono">{{ thoughtfulPauseMs }}ms</span>
            </div>
            <input
              v-model.number="thoughtfulPauseMs"
              type="range"
              min="800"
              max="3000"
              step="100"
              class="h-1 w-full cursor-pointer appearance-none rounded bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
            >
          </div>

          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-neutral-600 dark:text-neutral-400">Safety Ceiling</span>
              <span class="font-mono">{{ maxDelayCeilingMs }}ms</span>
            </div>
            <input
              v-model.number="maxDelayCeilingMs"
              type="range"
              min="1500"
              max="6000"
              step="250"
              class="h-1 w-full cursor-pointer appearance-none rounded bg-neutral-200 accent-primary-600 dark:bg-neutral-700"
            >
          </div>
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
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="preset in SAMPLE_PRESETS"
            :key="preset.name"
            type="button"
            :class="[
              'px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors',
              testText === preset.text
                ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 dark:border-primary-600'
                : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
            ]"
            @click="applyPreset(preset.text)"
          >
            {{ preset.name }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <textarea
          v-model="testText"
          rows="5"
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
          <div class="flex items-center justify-between text-[11px] text-neutral-600 font-semibold uppercase dark:text-neutral-400">
            <span>Boundary Decisions & Pacing ({{ boundaryEvaluations.length }} boundaries evaluated)</span>
            <span class="text-[10px] text-neutral-400 font-normal lowercase">
              Threshold: {{ splitThreshold.toFixed(2) }}
            </span>
          </div>
          <div class="flex flex-col gap-2">
            <div
              v-for="b in boundaryEvaluations"
              :key="b.index"
              class="flex flex-wrap items-center justify-between gap-2 border border-neutral-100 rounded-lg bg-neutral-50/70 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-950/40"
            >
              <div class="min-w-48 flex flex-1 items-center gap-2 overflow-hidden">
                <span class="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-mono dark:bg-neutral-800">
                  #{{ b.index + 1 }}
                </span>
                <span class="truncate text-neutral-500 font-mono">
                  "{{ b.before }}" → "{{ b.after }}"
                </span>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <!-- Rhythm Category Badge -->
                <template v-if="b.rhythmCategory">
                  <span
                    v-if="b.rhythmCategory === 'rapid_burst'"
                    class="border border-cyan-200 rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800 font-medium dark:border-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300"
                  >
                    Rapid {{ Math.round((b.rhythmProbabilities?.rapid_burst ?? 1) * 100) }}%
                  </span>
                  <span
                    v-else-if="b.rhythmCategory === 'conversational_beat'"
                    class="border border-amber-200 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 font-medium dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  >
                    Beat {{ Math.round((b.rhythmProbabilities?.conversational_beat ?? 1) * 100) }}%
                  </span>
                  <span
                    v-else
                    class="border border-purple-200 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-800 font-medium dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                  >
                    Pause {{ Math.round((b.rhythmProbabilities?.thoughtful_pause ?? 1) * 100) }}%
                  </span>
                </template>

                <!-- P(split) -->
                <span class="text-[11px] text-neutral-500 font-mono">
                  P(split) = {{ b.score.toFixed(2) }}
                </span>

                <!-- Split / Joined Badge -->
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

                <!-- Calculated Stagger Delay if Split -->
                <span
                  v-if="b.isSplit && b.calculatedDelayMs"
                  class="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary-700 font-mono dark:bg-primary-950/60 dark:text-primary-300"
                >
                  +{{ b.calculatedDelayMs }}ms
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
              Simulating dynamic delivery...
            </span>
          </div>

          <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-xl bg-neutral-100/50 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
            <!-- Normal preview when not running simulation -->
            <template v-if="!isPlayingSimulation && simulatedRevealedBubbles.length === 0">
              <div
                v-for="(bubble, bIdx) in resolvedBubbles"
                :key="bIdx"
                class="flex flex-col self-start gap-1"
              >
                <span v-if="bIdx > 0 && evalPausesMs[bIdx - 1]" class="text-[10px] text-neutral-400 font-mono">
                  ↳ +{{ evalPausesMs[bIdx - 1] }}ms stagger
                </span>
                <div class="max-w-[85%] border border-primary-500/20 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-neutral-800 shadow-sm transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                  <div class="whitespace-pre-wrap">
                    {{ bubble }}
                  </div>
                </div>
              </div>
            </template>

            <!-- Dynamic step-by-step simulated playback -->
            <template v-else>
              <div
                v-for="(bubble, bIdx) in simulatedRevealedBubbles"
                :key="bIdx"
                class="flex flex-col self-start gap-1"
              >
                <span v-if="bIdx > 0 && evalPausesMs[bIdx - 1]" class="text-[10px] text-primary-500 font-mono">
                  ↳ +{{ evalPausesMs[bIdx - 1] }}ms stagger
                </span>
                <div class="max-w-[85%] animate-fade-in border border-primary-500/20 rounded-2xl bg-white px-3.5 py-2.5 text-xs text-neutral-800 shadow-sm transition-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                  <div class="whitespace-pre-wrap">
                    {{ bubble }}
                  </div>
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
