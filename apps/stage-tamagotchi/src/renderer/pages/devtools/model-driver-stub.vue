<script setup lang="ts">
/**
 * Dev-only route: `/devtools/model-driver-stub` (§4.8).
 *
 * It exercises the whole Phase 1 chain against the stub fixture and nothing else: row pull → manager →
 * `requestRenderer` → this window's provider entry → registry-issued mount id → readiness → cue → settlement →
 * capture, plus a withdrawal. Two windows showing this page prove that each window has its own adapter and its
 * own mount id while sharing one host, one driver and one storage namespace.
 *
 * **The chain itself is asserted headless** in `packages/stage-renderer-sdk/src/host/in-process.test.ts`, which
 * composes the real service with real adapters and covers what this page shows. What remains here is the part
 * only Electron has: one adapter per real window, the eventa hop, and the app's storage backend. Treat the page
 * as smoke for those, not as the phase's only end-to-end evidence.
 *
 * It does **not** prove addressing: the page registers only an `acting` mount, so "a cue to `acting` never
 * reaches a `stage` mount" is asserted in `packages/stage-renderer-sdk/src/host/core/host.test.ts`, where the harness can
 * create both kinds.
 *
 * It is deliberately not a component of the host UI: no production surface imports it, and the plan ships no
 * host UI in this phase (§4.9 criterion 6). The route itself is a file-based route, so like every other
 * `/devtools/*` page it is present in the bundle — but the stub driver only exists in a development build
 * (`is.dev`, P1-D6), so outside development the page renders a notice instead of a screen of buttons whose
 * only possible answer is `driver-disabled`.
 */
import type { ContractResult, CueAck, MountId } from '@proj-airi/stage-renderer-sdk'
import type { StubMount } from '@proj-airi/stage-renderer-sdk/testing'

import type { ModelDriverAdapter } from '../../libs/model-drivers'

import {
  CueKind,
  CueRejection,
  CueSource,
  CueWithdrawalKind,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'
import { onUnmounted, ref } from 'vue'

import { STUB_DRIVER_ID } from '../../../shared/model-driver-specifiers'
import { bootstrapModelDriverAdapter } from '../../libs/model-drivers'
import { stubSession, whenStubSession } from '../../libs/model-drivers/stub-entry'

const SURFACE = RendererMountSurfaceKind.ACTING
const PURPOSE = RendererMountPurpose.ACTING
const DEMO_MODEL_ID = 'model_stub_demo'
const DEMO_PROFILE_ID = 'profile_stub_demo'
const isDev = import.meta.env.DEV

const loading = ref<string>()
const log = ref<string[]>([])
const hostState = ref('(not read yet)')
const windowModels = ref('(not read yet)')
const mountId = ref<MountId>()
const entryStarted = ref(false)

let adapter: ModelDriverAdapter | undefined
let mount: StubMount | undefined

function say(line: string) {
  log.value = [`${new Date().toLocaleTimeString()}  ${line}`, ...log.value].slice(0, 80)
}

function describeAck(result: ContractResult<CueAck>): string {
  if (!result.ok)
    return `failed: ${result.error.message}`

  const ack = result.value
  const slots = ack.results.map((slot, index) => slot.status === 'resolved'
    ? `#${index} resolved`
    : `#${index} rejected (${slot.reason})`).join(', ')
  return `handled=${ack.handled} nonce=${ack.nonce} [${slots}]`
}

async function run<T>(label: string, action: () => Promise<T>, describe: (value: T) => string = String) {
  const current = adapter
  if (!current) {
    say('no adapter in this window; nothing to do')
    return
  }

  loading.value = label
  try {
    say(`${label}…`)
    say(`${label}: ${describe(await action())}`)
  }
  catch (error) {
    say(`${label} threw: ${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    loading.value = undefined
  }
}

/**
 * What *this window* holds.
 *
 * The authority for model metadata is the window: the records live in web storage and the driver's half owns
 * their meaning (§1.7, D1). Main keeps a projection for pickers — that is `pullRows` below — so the two are
 * separate buttons and separate panels, and a difference between them is a stale host cache rather than a
 * disagreement about the truth.
 */
function readWindowModels() {
  const session = stubSession(STUB_DRIVER_ID)
  if (!session) {
    windowModels.value = 'this window does not host the driver entry'
    say('no driver entry in this window; register the mount first')
    return
  }

  const models = [...session.state.models.values()]
  windowModels.value = models.length
    ? models.map(model => `${model.modelId} (${model.profileId ?? 'no profile'}) ${model.name}`).join('\n')
    : '(none)'
  say(`this window has ${models.length} model(s)`)
}

/** The host's cached projection, read back through main. Never the authority — see `readWindowModels`. */
async function pullRows() {
  await run('pull rows (host cache)', async () => {
    const result = await adapter!.pullRows(STUB_DRIVER_ID)
    if (!result.ok)
      throw new Error(result.error.message)
    return result.value
  }, rows => `${rows.length} row(s): ${rows.map(row => row.name).join(', ') || '(none)'}`)

  // The pull is what made the registry ask this window for the driver's code, so the entry exists now.
  entryStarted.value = Boolean(adapter?.entries().get(STUB_DRIVER_ID))
}

async function register() {
  if (mountId.value) {
    say(`this window already registered ${mountId.value}`)
    return
  }

  // Register the mount, then start the driver's entry *here* rather than waiting to be asked.
  //
  // The host steers its channel by address, and a row pull is an unaddressed request that any live window can
  // serve — in a real session that is the stage window, which holds no mount. So a pull can bind the manager's
  // pipe to a window that registered nothing, and a mount created here would never receive. `ensureEntry` makes
  // this window host the entry itself; the next addressed request (`{ surface, purpose }`) ranks the window
  // holding the mount first and finds the entry already running.
  await run('register mount', async () => {
    const result = await adapter!.registerMount({ driverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE })
    if (!result.ok)
      throw new Error(`refused: ${result.reason}`)
    return result.mountId
  }, (id) => {
    mountId.value = id
    return id
  })

  if (!mountId.value)
    return

  // The host refuses a readiness state the machine cannot reach, so the walk is explicit: a fresh descriptor
  // is `unmounted`, and `ready-for-model` is only reachable through `mounting`. Jumping straight to ready would
  // be refused, the mount would stay unmounted, and a mount that is not ready never receives a cue.
  const mounting = await adapter!.setReadiness(mountId.value, RendererMountReadinessState.MOUNTING)
  if (!mounting.ok) {
    say(`could not report \`mounting\`: ${mounting.error.message}`)
    return
  }

  const started = await adapter!.ensureEntry(STUB_DRIVER_ID)
  entryStarted.value = started.ok
  if (!started.ok) {
    say(`this window could not host the driver entry: ${started.error.message}`)
    return
  }

  const session = await whenStubSession(STUB_DRIVER_ID, 5_000)
  mount = session.openMount({ surface: SURFACE, purpose: PURPOSE })
  mount.attach(mountId.value)

  const ready = await adapter!.setReadiness(mountId.value, RendererMountReadinessState.READY_FOR_MODEL)
  if (!ready.ok) {
    say(`could not report \`ready-for-model\`: ${ready.error.message}`)
    return
  }
  say(`mount ${mountId.value} is ready for a model`)
}

async function loadModel() {
  await run('load cue', async () => {
    const receipt = await adapter!.cues.send({
      cues: [{ kind: CueKind.LOAD, modelId: DEMO_MODEL_ID, profileId: DEMO_PROFILE_ID }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    })
    if (!receipt.ok)
      throw new Error(receipt.error.message)
    say(`accepted, nonce ${receipt.value.nonce}; waiting for settlement`)
    return receipt.value.settled
  }, describeAck)
}

async function capture() {
  await run('capture cue', async () => {
    const receipt = await adapter!.cues.send({
      cues: [{ kind: CueKind.CAPTURE }],
      source: CueSource.USER,
      override: true,
      target: { modelDriverId: STUB_DRIVER_ID, surface: SURFACE, purpose: PURPOSE },
    })
    if (!receipt.ok)
      throw new Error(receipt.error.message)
    return receipt.value.settled
  }, (settled) => {
    if (!settled.ok)
      return describeAck(settled)
    const slot = settled.value.results[0]
    const bytes = slot && slot.status === 'resolved' && slot.value.kind === CueKind.CAPTURE
      ? slot.value.data.byteLength
      : 0
    return `${describeAck(settled)} — ${bytes} capture byte(s)`
  })
}

/** A cue addressed at a surface nothing is mounted on: the host must settle it `NO_TARGET`, not hang. */
async function noTarget() {
  await run('no-target cue', async () => {
    const receipt = await adapter!.cues.send({
      cues: [{ kind: CueKind.CAPTURE }],
      source: CueSource.USER,
      override: true,
      target: {
        modelDriverId: STUB_DRIVER_ID,
        surface: RendererMountSurfaceKind.STAGE,
        purpose: RendererMountPurpose.STAGE,
      },
    })
    if (!receipt.ok)
      throw new Error(receipt.error.message)
    return receipt.value.settled
  }, (settled) => {
    if (!settled.ok)
      return describeAck(settled)
    const allNoTarget = settled.value.results.every(
      slot => slot.status === 'rejected' && slot.reason === CueRejection.NO_TARGET,
    )
    return `${describeAck(settled)} — every slot NO_TARGET: ${allNoTarget}`
  })
}

async function abortCurrent() {
  await run('abort current', async () => {
    // §9.7: every withdrawal names a target — correlations, or a surface and purpose. This button sends the
    // address so it reaches the mount it is about; a request with no target is malformed and the host refuses it.
    const result = await adapter!.withdraw({
      kind: CueWithdrawalKind.ABORT_CURRENT,
      modelDriverId: STUB_DRIVER_ID,
      address: { surface: SURFACE, purpose: PURPOSE },
    })
    if (!result.ok)
      throw new Error(result.error.message)
    return result.value
  }, report => `count=${report.count} results=${report.results.length}`)
}

async function readState() {
  await run('read host state', async () => {
    const state = await adapter!.hostState()
    hostState.value = JSON.stringify(state, null, 2)
    return state
  }, state => `${state.drivers.length} driver(s), ${state.rejections.length} rejection(s)`)
}

onUnmounted(() => {
  if (mountId.value)
    void adapter?.unregisterMount(mountId.value)
  adapter?.dispose()
})

if (isDev) {
  void (async () => {
    adapter = await bootstrapModelDriverAdapter()
    say(adapter ? 'adapter started in this window' : 'no adapter in this window (no eventa context)')
  })()
}
</script>

<template>
  <div v-if="isDev" :class="['mx-auto max-w-3xl', 'flex flex-col gap-4 px-4 py-6', 'font-sans text-sm']">
    <header>
      <h1 :class="['text-lg font-semibold']">
        Model driver stub
      </h1>
      <p :class="['opacity-70']">
        Phase 1 host proof, dev builds only. Open this route in two windows: each window gets its own mount id,
        and both read the same host state. Model metadata is read from this window, not from the host.
      </p>
    </header>

    <div :class="['flex flex-wrap gap-2']">
      <button type="button" :disabled="Boolean(loading)" @click="readWindowModels">
        Read this window's models
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="pullRows">
        Pull rows
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="register">
        Register acting mount
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="loadModel">
        Load demo model
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="capture">
        Capture
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="noTarget">
        Cue to an empty surface
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="abortCurrent">
        Abort current
      </button>
      <button type="button" :disabled="Boolean(loading)" @click="readState">
        Read host state
      </button>
    </div>

    <dl :class="['grid grid-cols-[10rem_1fr] gap-y-1']">
      <dt :class="['opacity-60']">
        Entry running here
      </dt>
      <dd>{{ entryStarted ? 'yes' : 'not yet (register the mount)' }}</dd>
      <dt :class="['opacity-60']">
        Mount id
      </dt>
      <dd>{{ mountId ?? '(none)' }}</dd>
      <dt :class="['opacity-60']">
        Loading
      </dt>
      <dd>{{ loading ?? '(idle)' }}</dd>
    </dl>

    <section>
      <h2 :class="['mb-1 font-medium']">
        Log
      </h2>
      <pre :class="['max-h-96 overflow-auto rounded bg-black/5 p-2 text-xs leading-relaxed']">{{ log.join('\n') }}</pre>
    </section>

    <section>
      <h2 :class="['mb-1 font-medium']">
        This window (authoritative)
      </h2>
      <pre :class="['max-h-64 overflow-auto rounded bg-black/5 p-2 text-xs']">{{ windowModels }}</pre>
    </section>

    <section>
      <h2 :class="['mb-1 font-medium']">
        Host cache
      </h2>
      <pre :class="['max-h-64 overflow-auto rounded bg-black/5 p-2 text-xs']">{{ hostState }}</pre>
    </section>
  </div>
  <div v-else :class="['mx-auto max-w-3xl', 'px-4 py-6', 'font-sans text-sm opacity-70']">
    `/devtools/model-driver-stub` exists in development builds only.
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
</route>
