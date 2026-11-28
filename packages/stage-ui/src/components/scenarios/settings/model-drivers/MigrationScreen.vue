<script setup lang="ts">
/**
 * The one migration surface, three hosts (§5.10): the post-update screen, the onboarding stepper and Settings → Data.
 *
 * It **precedes anything moving**. What it shows before a run is what will change, the storage verdict (including
 * "this device cannot measure", which is a disclosure and not a guess — D17), the export offer, and the choice
 * between normal and progressive deletion. What it shows after one is `N of M`, the parked models with their
 * reasons, and the fact that a partial result is **terminal** (D13): committed models stay committed and nothing is
 * rolled back.
 *
 * Presentational on purpose. The run, the gate and the deletion action live in the service; this component takes
 * their results and emits the three user decisions — start, switch mode, and delete the remaining legacy copies.
 */
import type { MigrationMode, MigrationReport } from '../../../../libs/model-drivers/migration'

import { Button } from '@proj-airi/ui'
import { computed, ref } from 'vue'

import { formatBytes } from '../../../../libs/model-drivers/migration'

const props = defineProps<{
  driverName: string
  /** `null` before the first run: the screen is then the pre-flight. */
  report: MigrationReport | null
  running?: boolean
  /** The user's current answer to the deletion policy; progressive is only ever a recommendation. */
  mode?: MigrationMode
  /** The size of the retained legacy copies, once the driver has fully migrated and deletion is offered. */
  retainedLegacyBytes?: number
  /** Whether any character still renders this driver's legacy path — deletion is unavailable while one does. */
  blockedByCharacters?: string[]
  /** The export that precedes a run, so a full library does not need its own headroom. */
  exportEnabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'start', mode: MigrationMode): void
  (event: 'export'): void
  (event: 'delete-legacy'): void
  (event: 'close'): void
}>()

const chosenMode = ref<MigrationMode>(props.mode ?? 'normal')

const gate = computed(() => props.report?.gate)
const parked = computed(() => props.report?.results.filter(result => result.status === 'parked') ?? [])
const deletionAvailable = computed(() => Boolean(props.report?.complete) && (props.blockedByCharacters?.length ?? 0) === 0)
</script>

<template>
  <div class="max-w-xl flex flex-col gap-3 p-1 text-sm">
    <header>
      <h2 class="text-base text-neutral-100 font-semibold">
        Migrate {{ driverName }} models
      </h2>
      <p class="text-xs text-neutral-400">
        Models move one at a time, each as its own transaction. Characters keep rendering while their model is still
        on the legacy path, and a model that fails stays there with a badge instead of failing the run.
      </p>
    </header>

    <section v-if="!report" class="flex flex-col gap-2 border border-neutral-700/60 rounded p-2">
      <h3 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
        What will change
      </h3>
      <ul class="list-disc pl-4 text-xs text-neutral-400">
        <li>The model is copied into the driver, bound to a fresh identity, and its prompt is handed over.</li>
        <li>The card keeps its frozen legacy id, so a revert can put the character back on the old renderer.</li>
        <li>Nothing is deleted until you choose progressive deletion, or ask for it after the run.</li>
      </ul>

      <div v-if="gate" class="rounded p-2 text-xs" :class="gate.ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200'">
        {{ gate.message }}
      </div>
      <div v-else class="rounded bg-neutral-800/60 p-2 text-xs text-neutral-300">
        Free space has not been measured yet. This app will not guess: when it cannot measure, it says so and offers
        progressive deletion, which needs only the largest single model's room.
      </div>

      <fieldset class="flex flex-col gap-1">
        <legend class="text-xs text-neutral-300 font-semibold">
          Legacy copies
        </legend>
        <label class="flex items-start gap-2 text-xs text-neutral-300">
          <input v-model="chosenMode" type="radio" value="normal">
          <span>Keep them until I ask (needs the whole library's space free).</span>
        </label>
        <label class="flex items-start gap-2 text-xs text-neutral-300">
          <input v-model="chosenMode" type="radio" value="progressive">
          <span>Delete each one as its model commits (needs only the largest model's space).</span>
        </label>
      </fieldset>

      <div class="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" label="Start migration" :disabled="running" @click="emit('start', chosenMode)" />
        <Button v-if="exportEnabled" variant="secondary" size="sm" label="Export a backup first" :disabled="running" @click="emit('export')" />
        <Button variant="ghost" size="sm" label="Not now" :disabled="running" @click="emit('close')" />
      </div>
    </section>

    <section v-else class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between">
        <h3 class="text-xs text-neutral-300 font-semibold tracking-wide uppercase">
          Progress
        </h3>
        <span class="text-xs text-neutral-300 font-mono">{{ report.summary }}</span>
      </div>

      <div v-if="report.blocked" class="rounded bg-amber-500/10 p-2 text-xs text-amber-200">
        The run did not start, and nothing was imported. Free space, enable progressive deletion, or cancel.
      </div>
      <div v-else-if="running" class="rounded bg-neutral-800/60 p-2 text-xs text-neutral-300">
        Running: {{ report.summary }} committed. A partial result is terminal — every committed model stays
        committed if this stops.
      </div>
      <div v-else-if="report.complete" class="rounded bg-emerald-500/10 p-2 text-xs text-emerald-200">
        Every model of this driver transferred ({{ report.summary }}).
      </div>
      <div v-else class="rounded bg-amber-500/10 p-2 text-xs text-amber-200">
        {{ report.summary }} committed. The rest stay on the legacy path; that is a terminal state, not a failure to
        undo.
      </div>

      <ul v-if="parked.length > 0" class="flex flex-col gap-1">
        <li v-for="result in parked" :key="result.legacyModelId" class="rounded bg-red-500/10 p-2 text-xs text-red-200">
          <strong>{{ result.name }}</strong> — needs attention ({{ result.reason }})
          <div v-if="result.message" class="opacity-80">
            {{ result.message }}
          </div>
        </li>
      </ul>

      <ul v-if="report.results.some(result => result.warning)" class="flex flex-col gap-1">
        <li v-for="result in report.results.filter(entry => entry.warning)" :key="`warn-${result.legacyModelId}`" class="rounded bg-neutral-800/60 p-2 text-xs text-neutral-300">
          {{ result.name }}: {{ result.warning }}
        </li>
      </ul>

      <div v-if="deletionAvailable" class="flex flex-col gap-1 border border-neutral-700/60 rounded p-2">
        <p class="text-xs text-neutral-300">
          The retained legacy copies still take {{ formatBytes(retainedLegacyBytes ?? 0) }}.
          Deleting them frees that space, and after deletion a downgraded build could no longer render these models
          — the driver can still restore them for this version.
        </p>
        <Button variant="danger" size="sm" label="Delete legacy copies…" @click="emit('delete-legacy')" />
      </div>
      <div v-else-if="report.complete && blockedByCharacters?.length" class="rounded bg-neutral-800/60 p-2 text-xs text-neutral-300">
        Legacy copies cannot be deleted while these characters still render on the legacy path:
        {{ blockedByCharacters.join(', ') }}. Migrate or re-bind them first.
      </div>

      <div class="flex justify-end">
        <Button variant="ghost" size="sm" label="Close" @click="emit('close')" />
      </div>
    </section>
  </div>
</template>
