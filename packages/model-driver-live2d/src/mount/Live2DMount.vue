<script setup lang="ts">
/**
 * One Live2D mount (RFC 0002 §8, plan §6.3).
 *
 * The host mounts this component inside the box it owns and then does only two things: sends cues, and asks the
 * declared queries. Everything visible — the canvas, the model, the caption, the gaze — is this component's, and
 * two mounts of this driver share nothing (plan D-1: the legacy singleton must not reappear here).
 *
 * Cues arrive through `cues.handle`, *not* through a prop: the host addresses the window's provider entry, that
 * entry forwards the envelope to the mounts it registered, and this component answers with one `CueAck` per send.
 * Readiness is reported as the component's own claim (`state-change`), and the host starts the load only when it
 * hears `ready-for-model`.
 */
import type {
  ContractFailure,
  ContractResult,
  CueAck,
  CueEnvelope,
  CueOutcome,
  CueResult,
  CueSink,
  HostStorageInterface,
  ModelId,
  ModelProfileId,
  RendererMountDisposeStrategy,
  RendererMountHitArea,
  RendererMountHitAreaChange,
  RendererMountInteractionMode,
  RendererMountPoint,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
  RendererQualityHint,

  Unsubscribe,
} from '@proj-airi/stage-renderer-sdk'

import type { Live2DMountBinding } from '../session'

import {
  ContractFailureCode,
  CueKind,
  CueRejection,
  RendererMountReadinessState as Readiness,
  ResetScope,
} from '@proj-airi/stage-renderer-sdk'
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import { parseLive2DActToken } from '../act'
import { Live2DView } from '../live2d/view'
import { LIVE2D_DRIVER_ID } from '../manifest'
import { live2dSession } from '../session'
import { base64ToBytes, readModelBytes, readModelRecord, readProfile, watchProfile, writeModelPreview } from '../storage'

const props = defineProps<{
  modelDriverId?: string
  mountId: string
  characterId?: string
  purpose: RendererMountPurpose
  surface: RendererMountSurfaceKind
  paused: boolean
  visible: boolean
  reducedMotion?: boolean
  qualityHint?: RendererQualityHint
  interactionMode?: RendererMountInteractionMode
}>()

const emit = defineEmits<{
  (event: 'state-change', state: RendererMountReadinessState): void
  (event: 'first-frame'): void
  (event: 'context-change', valid: boolean): void
  (event: 'disposed'): void
  (event: 'error', failure: ContractFailure): void
  (event: 'hit-area-change', change: RendererMountHitAreaChange): void
  (event: 'animation-finished', nonce: number): void
  (event: 'cue-rejected', payload: { nonce: number, index: number, kind: CueKind, reason: CueRejection }): void
}>()

const root = ref<HTMLElement>()
const view = shallowRef<Live2DView>()

let readiness: RendererMountReadinessState = Readiness.UNMOUNTED
let loaded = false
let pointerSubscription: (() => void) | undefined
let lastArea: string | null = null
/** Which model and profile this mount shows, so a profile cue can be resolved without repeating a model id. */
let currentModelId: ModelId | undefined
let currentProfileId: ModelProfileId | undefined
let unwatchProfile: Unsubscribe | undefined

function moveTo(next: RendererMountReadinessState): void {
  readiness = next
  emit('state-change', next)
}

function failLoad(code: ContractFailureCode, message: string): { ok: false, error: ContractFailure } {
  const failure: ContractFailure = { code, message }
  emit('error', failure)
  return { ok: false, error: failure }
}

function resolved(kind: Exclude<CueKind, CueKind.CAPTURE>): CueOutcome {
  // A union discriminant is not assignable to the contract's distributed `{ kind: K }` union, so the value is
  // narrowed once here rather than cast at each call site.
  return { status: 'resolved', value: { kind } as CueResult }
}

function rejected(reason: CueRejection, message: string): CueOutcome {
  return { status: 'rejected', reason, message }
}

/**
 * Put one stored profile body on the view, and keep following it.
 *
 * The body is driver storage, not a cue payload: a `ProfileCue` names the profile and nothing else, exactly as the
 * contract says AIRI must not decompose a profile (D-9). `adopt` is false for a `persistent: false` try-on — the
 * look is applied but the mount's own state still names the saved profile, so a reset puts that one back.
 *
 * Resolves `false` when the profile does not exist, which the caller reports as `unknown-key`.
 */
async function applyProfile(
  modelId: ModelId,
  profileId: ModelProfileId,
  options: { adopt: boolean } = { adopt: true },
): Promise<boolean> {
  const store = live2dSession.hostServices()?.storage
  const renderer = view.value
  if (!store || !renderer)
    return false

  const profile = await readProfile(store, modelId, profileId)
  renderer.applyProfile(profile?.body)

  if (!options.adopt)
    return profile !== undefined

  currentModelId = modelId
  currentProfileId = profileId
  // A panel in another window edits this body; re-applying is how a slider becomes visible without a cue per pixel.
  unwatchProfile?.()
  unwatchProfile = watchProfile(store, modelId, profileId, (value) => {
    if (currentProfileId === profileId)
      view.value?.applyProfile(value?.body)
  })
  return profile !== undefined
}

/** Stop following a profile, and forget which one this mount shows. */
function releaseProfile(): void {
  unwatchProfile?.()
  unwatchProfile = undefined
  currentProfileId = undefined
}

/**
 * Fill in this model's thumbnail once, from the mount that rendered it (D-8).
 *
 * Fire-and-forget: `ready-for-model` must not wait on an encode, and a preview is cosmetic. Written only when the
 * record has none, so a second mount of the same model costs nothing; a failure leaves the row without one and a
 * later mount tries again.
 */
async function ensurePreview(storage: HostStorageInterface, modelId: ModelId, current: Live2DView): Promise<void> {
  const record = await readModelRecord(storage, modelId)
  if (!record || record.preview)
    return

  const preview = await current.capturePreview()
  if (!preview)
    return

  if (await writeModelPreview(storage, modelId, preview))
    live2dSession.notifyModelsChanged()
}

/**
 * Apply one envelope.
 *
 * A load that breaks is the whole send's error (nothing else could be applied to a model that is not there); every
 * other cue is per-slot, so one unsupported key does not fail its neighbours. A refusal is not a failure: the ack
 * still resolves, with `rejected` in that slot (RFC §9.4).
 */
async function handle(envelope: CueEnvelope): Promise<ContractResult<CueAck>> {
  const results: CueOutcome[] = []

  for (let index = 0; index < envelope.cues.length; index += 1) {
    const cue = envelope.cues[index]

    if (cue.kind === CueKind.LOAD) {
      const storage = live2dSession.hostServices()?.storage
      if (!storage)
        return failLoad(ContractFailureCode.DRIVER_UNAVAILABLE, 'The Live2D provider entry is not activated in this window')

      const encoded = await readModelBytes(storage, cue.modelId)
      if (!encoded) {
        moveTo(Readiness.MODEL_ERROR)
        return failLoad(ContractFailureCode.ASSET_MISSING, `No Live2D model \`${cue.modelId}\` in this driver's storage`)
      }

      const current = view.value
      if (!current) {
        moveTo(Readiness.MODEL_ERROR)
        return failLoad(ContractFailureCode.DRIVER_UNAVAILABLE, 'The Live2D view is not running in this mount')
      }

      moveTo(Readiness.LOADING_MODEL)
      try {
        await current.load(base64ToBytes(encoded), `${cue.modelId}.zip`)
        loaded = true
        currentModelId = cue.modelId
        releaseProfile()
        // Appearance arrives with the load: a profile is what this mount should look like, and no profile is the
        // default look rather than a refusal.
        if (cue.profileId)
          await applyProfile(cue.modelId, cue.profileId)
        else
          current.applyProfile(undefined)
        moveTo(Readiness.MODEL_LOADED)
        // A thumbnail is cosmetic and must never delay the ready handshake, so it is generated after the move.
        void ensurePreview(storage, cue.modelId, current).catch(() => {})
        results.push(resolved(CueKind.LOAD))
      }
      catch (error) {
        loaded = false
        moveTo(Readiness.MODEL_ERROR)
        return failLoad(ContractFailureCode.INTERNAL, `Could not load the Live2D model: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }

    if (!loaded || readiness !== Readiness.MODEL_LOADED) {
      results.push(rejected(CueRejection.RENDERER_NOT_READY, 'The mount has no model loaded'))
      emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.RENDERER_NOT_READY })
      continue
    }

    const current = view.value
    if (!current) {
      results.push(rejected(CueRejection.NO_MODEL, 'The Live2D view was disposed'))
      emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.NO_MODEL })
      continue
    }

    switch (cue.kind) {
      case CueKind.EXPRESSION: {
        const applied = await current.setExpression(cue.key)
        results.push(applied ? resolved(cue.kind) : rejected(CueRejection.UNKNOWN_KEY, `No expression \`${cue.key}\``))
        if (!applied)
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNKNOWN_KEY })
        break
      }

      case CueKind.MOTION: {
        try {
          const finished = await current.playMotion(cue.key, cue.repeat)
          results.push(resolved(cue.kind))
          // Completion echoes the transaction, not the motion name: two motions in flight must be distinguishable
          // (D-2). A motion that was replaced never reaches here, which is why this is emitted after the await.
          if (finished)
            emit('animation-finished', envelope.nonce)
        }
        catch (error) {
          results.push(rejected(CueRejection.UNKNOWN_KEY, error instanceof Error ? error.message : String(error)))
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNKNOWN_KEY })
        }
        break
      }

      case CueKind.ACT: {
        // The token travels verbatim and this driver projects it (RFC 0002 §9.8). An unprojectable token is refused
        // with `unknown-key` rather than guessed at: the vocabulary is the driver's, and the published list is what a
        // token was checked against.
        const act = parseLive2DActToken(cue.actToken)
        if (!act) {
          results.push(rejected(CueRejection.UNKNOWN_KEY, `\`${cue.actToken}\` is not an ACT token this driver can perform`))
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNKNOWN_KEY })
          break
        }

        if (act.kind === 'emotion') {
          const applied = await current.setExpression(act.key)
          results.push(applied ? resolved(cue.kind) : rejected(CueRejection.UNKNOWN_KEY, `No expression \`${act.key}\``))
          if (!applied)
            emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNKNOWN_KEY })
          break
        }

        try {
          const finished = await current.playMotion(act.key)
          results.push(resolved(cue.kind))
          // A motion started by a token still echoes the transaction, so a caller can tell two in-flight motions apart
          // (D-2); it is the same `animation-finished` a `MotionCue` emits.
          if (finished)
            emit('animation-finished', envelope.nonce)
        }
        catch (error) {
          results.push(rejected(CueRejection.UNKNOWN_KEY, error instanceof Error ? error.message : String(error)))
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNKNOWN_KEY })
        }
        break
      }

      case CueKind.PROFILE: {
        const modelId = currentModelId
        if (!modelId) {
          results.push(rejected(CueRejection.NO_MODEL, 'No Live2D model is loaded'))
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.NO_MODEL })
          break
        }
        // `persistent: false` is a try-on: applied now, but the mount's saved profile stays what a reset restores.
        const applied = await applyProfile(modelId, cue.profileId, { adopt: envelope.persistent !== false })
        results.push(applied
          ? resolved(cue.kind)
          : rejected(CueRejection.UNKNOWN_KEY, `No profile \`${cue.profileId}\` for this model`))
        if (!applied)
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNKNOWN_KEY })
        break
      }

      case CueKind.GAZE: {
        const applied = current.setGaze(cue.mode, cue.point)
        results.push(applied ? resolved(cue.kind) : rejected(CueRejection.UNSUPPORTED_CUE, `Gaze mode \`${cue.mode}\` is not supported`))
        if (!applied)
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNSUPPORTED_CUE })
        break
      }

      case CueKind.CAPTION: {
        current.setCaption(cue.text)
        results.push(resolved(cue.kind))
        break
      }

      case CueKind.RESET: {
        // A profile lives in driver storage, not in the renderer, so the view cannot reset it: putting the saved
        // body back is the reset, and it is what ends a try-on.
        if (cue.scope === ResetScope.PROFILE) {
          if (!currentModelId || !currentProfileId) {
            results.push(rejected(CueRejection.UNSUPPORTED_CUE, 'This mount shows no saved Live2D profile'))
            emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNSUPPORTED_CUE })
            break
          }
          await applyProfile(currentModelId, currentProfileId)
          results.push(resolved(cue.kind))
          break
        }

        const applied = current.reset(cue.scope)
        // `ALL` means "the saved state", and a profile's resting expression is part of it.
        if (applied && cue.scope === ResetScope.ALL && currentModelId && currentProfileId)
          await applyProfile(currentModelId, currentProfileId)
        results.push(applied ? resolved(cue.kind) : rejected(CueRejection.UNSUPPORTED_CUE, `Reset scope \`${cue.scope}\` is not supported`))
        if (!applied)
          emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNSUPPORTED_CUE })
        break
      }

      case CueKind.CAPTURE: {
        const captured = await current.capture()
        if (!captured)
          return failLoad(ContractFailureCode.INTERNAL, 'The Live2D view could not capture a frame')
        results.push({ status: 'resolved', value: { kind: CueKind.CAPTURE, ...captured } })
        break
      }

      default: {
        results.push(rejected(CueRejection.UNSUPPORTED_CUE, `\`${cue.kind}\` is not declared by this driver`))
        emit('cue-rejected', { nonce: envelope.nonce, index, kind: cue.kind, reason: CueRejection.UNSUPPORTED_CUE })
      }
    }
  }

  return {
    ok: true,
    value: {
      nonce: envelope.nonce,
      modelDriverId: LIVE2D_DRIVER_ID,
      mountId: props.mountId,
      results,
      handled: results.every(outcome => outcome.status === 'resolved'),
    },
  }
}

const sink: CueSink = { handle }

/**
 * Edge-triggered hit-area changes.
 *
 * The host owns the pointer and converts it once per mount; this subscription is how a *renderer*-caused change is
 * noticed — the model turned, and the region under a still pointer is no longer the same one. Only edges are
 * emitted, never a per-move stream (RFC §8.5, D-3).
 */
function onPointer(event: { point: RendererMountPoint }): void {
  const current = view.value
  if (!current)
    return
  const area = current.hitTest(event.point)?.areaId ?? null
  if (area === lastArea)
    return
  if (lastArea)
    emit('hit-area-change', { areaId: lastArea, entered: false })
  if (area)
    emit('hit-area-change', { areaId: area, entered: true })
  lastArea = area
}

const binding: Live2DMountBinding = {
  mountId: props.mountId,
  surface: props.surface,
  purpose: props.purpose,
  sink,
  readiness: () => readiness,
  occupiesPoint: point => view.value?.occupiesPoint(point) ?? false,
  hitTest: point => view.value?.hitTest(point) ?? null,
  stopAll: () => view.value?.stopAll(),
  dispose: (_strategy: RendererMountDisposeStrategy) => {
    releaseProfile()
    view.value?.destroy()
    view.value = undefined
    loaded = false
  },
}

onMounted(() => {
  // A mount is unaddressable until the registry issues its id, and readiness must not begin before that. The host
  // hands the id in as a prop once it is issued, which is this component's first moment to exist at all.
  moveTo(Readiness.MOUNTING)

  const element = root.value
  if (!element) {
    moveTo(Readiness.MOUNT_ERROR)
    emit('error', { code: ContractFailureCode.INTERNAL, message: 'The Live2D mount has no container element' })
    return
  }

  try {
    const renderer = new Live2DView(element, {
      onFirstFrame: () => emit('first-frame'),
      onHitAreaChange: change => emit('hit-area-change', change),
    })
    view.value = renderer
    renderer.start()
    renderer.setVisible(props.visible)
    renderer.setPaused(props.paused)
  }
  catch (error) {
    moveTo(Readiness.MOUNT_ERROR)
    emit('error', { code: ContractFailureCode.INTERNAL, message: `The Live2D renderer could not start: ${error instanceof Error ? error.message : String(error)}` })
    return
  }

  live2dSession.registerMount(binding)
  pointerSubscription = live2dSession.hostServices()?.pointer.subscribe(props.mountId, onPointer)
  moveTo(Readiness.READY_FOR_MODEL)
})

onUnmounted(() => {
  pointerSubscription?.()
  pointerSubscription = undefined
  releaseProfile()
  currentModelId = undefined
  live2dSession.unregisterMount(props.mountId)
  view.value?.destroy()
  view.value = undefined
  loaded = false
  lastArea = null
  moveTo(Readiness.UNMOUNTED)
  emit('disposed')
})

watch(() => props.paused, paused => view.value?.setPaused(paused))
watch(() => props.visible, visible => view.value?.setVisible(visible))

defineExpose({
  cues: sink,
  occupiesPoint: (point: RendererMountPoint): boolean => view.value?.occupiesPoint(point) ?? false,
  hitTest: (point: RendererMountPoint): RendererMountHitArea | null => view.value?.hitTest(point) ?? null,
  stopAll: () => view.value?.stopAll(),
  dispose: (strategy: RendererMountDisposeStrategy) => binding.dispose(strategy),
})
</script>

<template>
  <div ref="root" class="h-full w-full" />
</template>
