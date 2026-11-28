<script setup lang="ts">
/**
 * The host's model-import panel (§5.3).
 *
 * The host owns the dialog: it takes the input, hands the same files to every driver it asks, merges what they
 * report, orders the reports by confidence, shows the findings, and only commits what the user confirms. The driver
 * owns its format through the `IMPORT` entry this panel loads — `adapter.importEntry(driverId)`, which is resolved
 * and imported exactly like a mount, a panel or a picker.
 *
 * The input arrives one of two ways: `files` when a driver's picker already has them (a builtin it ships, a drop,
 * its own file input) — then the panel skips its chooser and goes straight to the parts the driver reported — or
 * from this panel's own input for a host-side import. Either way the same `File[]` is what probe reads and what
 * `confirmImport` receives, and only the driver that was handed the files is asked.
 *
 * Identity is the adapter's: this panel asks `adapter.mintModelId()`/`mintProfileId()` for each part it commits and
 * hands the ids to the driver, which writes under exactly them. The panel never mints, and the driver never does.
 *
 * The labels are plain English rather than i18n keys because this build mounts the panel from the dev route only;
 * placement (settings, onboarding) is P2-D18's, and it brings the keys with it.
 */
import type {
  ModelDriverAdapter,
  ModelDriverId,
  ModelImportCommitEntry,
  ModelImportPart,
  ModelProbeResult,
} from '@proj-airi/stage-renderer-sdk'

import { Button } from '@proj-airi/ui'
import { computed, ref, shallowRef, watch } from 'vue'

const props = defineProps<{
  adapter: ModelDriverAdapter
  /** The drivers to ask. A driver that ships no import entry is reported as skipped, not hidden. */
  driverIds: ModelDriverId[]
  /**
   * The input the caller already holds, when a picker handed it over.
   *
   * Present means the panel does not ask for a file: it probes these immediately and shows the parts. Absent (or
   * empty) means the host-side import, where the user picks from this panel's own input.
   */
  files?: File[]
}>()

const emit = defineEmits<{
  (event: 'imported', entries: ModelImportCommitEntry[]): void
  (event: 'cancel'): void
}>()

interface ImportReport {
  driverId: ModelDriverId
  probe: ModelProbeResult
}

const chosen = shallowRef<File[]>([])
const reports = ref<ImportReport[]>([])
const skipped = ref<Array<{ driverId: ModelDriverId, reason: string }>>([])
const selected = ref(new Set<string>())
const probing = ref(false)
const committing = ref(false)
const error = ref<string>()
const acceptFindings = ref(false)

const keyOf = (driverId: ModelDriverId, partIndex: number) => `${driverId}:${partIndex}`

const selectedParts = computed(() => reports.value.flatMap(report =>
  report.probe.parts
    .filter(part => selected.value.has(keyOf(report.driverId, part.partIndex)))
    .map(part => ({ driverId: report.driverId, part }))),
)

const hasBlocking = computed(() => reports.value.some(report => (report.probe.blockingFindings?.length ?? 0) > 0))

function isSelected(driverId: ModelDriverId, part: ModelImportPart): boolean {
  return selected.value.has(keyOf(driverId, part.partIndex))
}

function toggle(driverId: ModelDriverId, part: ModelImportPart) {
  const next = new Set(selected.value)
  const key = keyOf(driverId, part.partIndex)
  if (next.has(key))
    next.delete(key)
  else
    next.add(key)
  selected.value = next
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes)
    return ''
  if (bytes < 1024 * 1024)
    return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function onFileChange(event: Event) {
  const element = event.target as HTMLInputElement
  const picked = Array.from(element.files ?? [])
  // Cleared before the await, so picking the same file again still fires `change`.
  element.value = ''
  if (picked.length > 0)
    await probe(picked)
}

async function probe(picked: File[]) {
  probing.value = true
  error.value = undefined
  reports.value = []
  skipped.value = []
  selected.value = new Set()
  acceptFindings.value = false
  chosen.value = picked

  try {
    for (const driverId of props.driverIds) {
      const entry = await props.adapter.importEntry(driverId)
      if (!entry.ok) {
        skipped.value.push({ driverId, reason: entry.error.message })
        continue
      }
      if (!entry.value) {
        skipped.value.push({ driverId, reason: 'The driver ships no import surface.' })
        continue
      }

      const result = await entry.value.probe({ files: picked })
      if (!result.ok) {
        skipped.value.push({ driverId, reason: `${result.error.code}: ${result.error.message}` })
        continue
      }

      reports.value.push({ driverId, probe: result.value })
    }

    // Confidence orders the reports; the user still confirms. An input nobody could read is not an error here —
    // the skipped list says why, and the user can try another file.
    reports.value.sort((left, right) => right.probe.confidence - left.probe.confidence)

    // Preselect what nothing is blocking. A report with blocking findings starts unselected and needs the
    // explicit "import anyway" below, because the host must not decide that for the user.
    const preselected = new Set<string>()
    for (const report of reports.value) {
      if (report.probe.blockingFindings?.length)
        continue
      for (const part of report.probe.parts)
        preselected.add(keyOf(report.driverId, part.partIndex))
    }
    selected.value = preselected
  }
  finally {
    probing.value = false
  }
}

/**
 * A picker handed the input over with the request, so there is nothing to ask for here: probe the files it was
 * given and go straight to the parts. A host-side import has no `files` and shows the chooser instead.
 */
watch(() => props.files, (files) => {
  if (files && files.length > 0)
    void probe(files)
}, { immediate: true })

async function commit() {
  const picked = chosen.value
  if (picked.length === 0 || committing.value || selectedParts.value.length === 0)
    return

  committing.value = true
  error.value = undefined
  const committed: ModelImportCommitEntry[] = []

  try {
    for (const report of reports.value) {
      const parts = report.probe.parts.filter(part => isSelected(report.driverId, part))
      if (parts.length === 0)
        continue

      const result = await report.probe.confirmImport({
        selections: parts.map(part => ({
          partIndex: part.partIndex,
          // The adapter's ids, one pair per committed part: the driver writes under exactly these and echoes them.
          modelId: props.adapter.mintModelId(),
          profileId: props.adapter.mintProfileId(),
        })),
        input: { files: picked },
        ...(acceptFindings.value && report.probe.blockingFindings?.length ? { force: true } : {}),
      })

      if (!result.ok) {
        error.value = `${report.driverId}: ${result.error.message}`
        continue
      }
      committed.push(...result.value.entries)
    }

    if (committed.some(entry => entry.result.ok))
      emit('imported', committed)
    else if (!error.value)
      error.value = 'Nothing was imported.'
  }
  finally {
    committing.value = false
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-3', 'text-sm']">
    <div :class="['flex flex-col gap-1']">
      <template v-if="props.files?.length">
        <span :class="['text-xs text-neutral-400']">Input</span>
        <span :class="['text-xs']">{{ props.files.map(file => file.name).join(', ') }}</span>
      </template>
      <template v-else>
        <label :class="['text-xs text-neutral-400']" for="model-import-file">Model archive</label>
        <input
          id="model-import-file"
          type="file"
          multiple
          :class="['border border-neutral-700 rounded px-2 py-1', 'text-xs', 'bg-neutral-900/40']"
          :disabled="probing || committing"
          @change="onFileChange"
        >
      </template>
      <div v-if="probing" :class="['text-xs text-neutral-400']">
        Asking the driver what is in this input…
      </div>
    </div>

    <div v-if="error" :class="['border border-red-500/40 rounded p-2', 'text-xs text-red-200']">
      {{ error }}
    </div>

    <div
      v-for="report in reports"
      :key="report.driverId"
      :class="['flex flex-col gap-2', 'border border-neutral-700/60 rounded p-2']"
    >
      <div :class="['flex items-center justify-between gap-2']">
        <span :class="['text-xs font-medium']">{{ report.probe.name ?? report.driverId }}</span>
        <span :class="['text-[10px] text-neutral-400']">
          {{ report.driverId }} · confidence {{ Math.round(report.probe.confidence * 100) }}%
        </span>
      </div>

      <div v-if="report.probe.warnings?.length" :class="['text-xs text-amber-200']">
        <div v-for="warning in report.probe.warnings" :key="warning">
          ⚠ {{ warning }}
        </div>
      </div>
      <div v-if="report.probe.plannedFixes?.length" :class="['text-xs text-neutral-400']">
        <div v-for="fix in report.probe.plannedFixes" :key="fix">
          ↻ {{ fix }}
        </div>
      </div>
      <div v-if="report.probe.blockingFindings?.length" :class="['text-xs text-red-200']">
        <div v-for="finding in report.probe.blockingFindings" :key="finding">
          ✕ {{ finding }}
        </div>
      </div>

      <div v-if="report.probe.parts.length === 0" :class="['text-xs text-neutral-400']">
        No model was found in this input.
      </div>

      <label
        v-for="part in report.probe.parts"
        :key="part.partIndex"
        :class="['flex items-start gap-2', 'cursor-pointer']"
      >
        <input
          type="checkbox"
          :checked="isSelected(report.driverId, part)"
          :disabled="committing"
          @change="toggle(report.driverId, part)"
        >
        <span :class="['flex flex-col']">
          <span :class="['text-xs']">
            {{ part.name }}
            <span v-if="part.meta.format" :class="['text-neutral-400']">· {{ part.meta.format }}</span>
            <span v-if="part.meta.sizeBytes" :class="['text-neutral-400']">· {{ formatBytes(part.meta.sizeBytes) }}</span>
          </span>
          <span v-if="part.meta.suggestedProfileName" :class="['text-[10px] text-neutral-400']">
            Default profile: {{ part.meta.suggestedProfileName }}
          </span>
        </span>
      </label>
    </div>

    <div v-if="skipped.length" :class="['flex flex-col gap-1', 'text-xs text-neutral-400']">
      <div v-for="entry in skipped" :key="entry.driverId">
        {{ entry.driverId }}: {{ entry.reason }}
      </div>
    </div>

    <label v-if="hasBlocking" :class="['flex items-center gap-2', 'text-xs text-amber-200']">
      <input v-model="acceptFindings" type="checkbox" :disabled="committing">
      Import anyway, accepting the findings above
    </label>

    <div :class="['flex items-center justify-end gap-2']">
      <Button variant="secondary" size="sm" label="Cancel" :disabled="committing" @click="emit('cancel')" />
      <Button
        variant="primary"
        size="sm"
        :label="committing ? 'Importing…' : `Import ${selectedParts.length || ''}`"
        :loading="committing"
        :disabled="probing || committing || selectedParts.length === 0"
        @click="commit"
      />
    </div>
  </div>
</template>
