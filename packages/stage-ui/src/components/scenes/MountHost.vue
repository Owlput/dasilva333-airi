<script setup lang="ts">
/**
 * MountHost — the host side of one mounted renderer (§5.2).
 *
 * It owns exactly five things: the container, the mount identity, the readiness it reports, the props/cues it passes
 * down, and the pointer stream it measures. It never holds the renderer's canvas, app, camera or scene graph; the only
 * handle it keeps is the component instance, for the declared queries (`occupiesPoint`, `hitTest`, `stopAll`, `dispose`).
 *
 * The order is the plan's:
 *
 *   1. register the mount with the adapter, which asks the **registry** for the id — a mount is unaddressable until
 *      that resolves, so nothing else starts before it;
 *   2. `ensureEntry`, so *this* window is the one running the driver's code (P1-D19: the host steers channels by
 *      address, and a row pull can land anywhere);
 *   3. ask the **manager** which mount specifier this address resolves to, and import it through the adapter;
 *   4. mount it with props — no model prop, no size prop — and let the `LoadCue` tell it which model to show.
 *
 * The load is sent once the mount reports `ready-for-model`, not before: a cue delivered to a `mounting` mount is
 * refused as `renderer-not-ready`, and a queued one would race the driver's own first frame.
 *
 * **Pointer input is measured here and converted once** (exit criterion 6, P2-D16). This component owns the element
 * the mount draws in, so it is the only place that can answer "where is this mount now"; it installs capture-phase
 * listeners on that element and hands every event to the window's pointer hub addressed with this mount's id. A
 * renderer subscribes to `services.pointer` and receives the same events in its own box's coordinates, which is why a
 * second mount of the same driver is unaffected: it has its own element, its own box and its own id.
 */
import type {
  ContractFailure,
  CueEnvelopeInput,
  ModelDriverAdapter,
  ModelDriverId,
  OperationNonce,
  RendererMountComponent,
  RendererMountHitArea,
  RendererMountHitAreaChange,
  RendererMountInteractionMode,
  RendererMountPoint,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'
import type { RawPointerEvent } from '@proj-airi/stage-renderer-sdk/host'

import {
  ContractFailureCode,
  CueKind,
  CueSource,
  RendererMountReadinessState as Readiness,
  RendererPointerPhase,
} from '@proj-airi/stage-renderer-sdk'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

const props = defineProps<{
  /** The window's adapter. Supplied rather than imported so the same component serves Electron, Web and Pocket. */
  adapter: ModelDriverAdapter
  driverId: ModelDriverId
  surface: RendererMountSurfaceKind
  purpose: RendererMountPurpose
  characterId?: string
  /** Host-decided pause. The renderer honours it and never self-pauses. */
  paused?: boolean
  visible?: boolean
  reducedMotion?: boolean
  qualityHint?: string
  interactionMode?: RendererMountInteractionMode
  /** The model to load once the mount is ready. `null`/absent means "mount it empty". */
  model?: { modelId: string, profileId: string } | null
}>()

const emit = defineEmits<{
  (event: 'state-change', state: RendererMountReadinessState): void
  (event: 'first-frame'): void
  (event: 'disposed'): void
  (event: 'error', failure: ContractFailure): void
  (event: 'hit-area-change', change: RendererMountHitAreaChange): void
  (event: 'animation-finished', nonce: OperationNonce): void
  (event: 'cue-rejected', payload: { nonce: OperationNonce, index: number, kind: CueKind, reason: string }): void
  (event: 'load-failed', message: string): void
}>()

/** The members the contract lets the host call on a mounted renderer. */
interface MountExposed {
  occupiesPoint?: (point: RendererMountPoint) => boolean
  hitTest?: (point: RendererMountPoint) => RendererMountHitArea | null
  stopAll?: () => void
  dispose?: (strategy: 'shallow' | 'deep') => void
}

// `shallowRef`, not `ref`: a deep `ref` wraps the component definition in a reactive proxy, and a reactive
// component is exactly what Vue warns about (and pays for) — the definition is replaced wholesale and never
// mutated, so there is nothing here to track. `DriverPanelHost`/`DriverPickerHost` hold their components the
// same way.
const mountInstance = shallowRef<RendererMountComponent>()
const mountRef = shallowRef<unknown>()
const mountId = ref<string>()
const readiness = ref<RendererMountReadinessState>(Readiness.UNMOUNTED)
const failure = ref<ContractFailure>()

/** The element this mount draws in: measured for the pointer, and the container the listeners live on. */
const rootRef = shallowRef<HTMLElement>()

/**
 * The DOM events this host forwards, and the contract phase each becomes.
 *
 * `enter`/`leave` are here as well as `move` because a renderer that only wants a hover state should not have to
 * diff positions to find it. `cancel` is the browser taking the pointer away (a modal, a touch interruption), which is
 * not the same thing as the pointer leaving.
 */
const POINTER_EVENTS: Array<[string, RendererPointerPhase]> = [
  ['pointerenter', RendererPointerPhase.ENTER],
  ['pointerleave', RendererPointerPhase.LEAVE],
  ['pointermove', RendererPointerPhase.MOVE],
  ['pointerdown', RendererPointerPhase.DOWN],
  ['pointerup', RendererPointerPhase.UP],
  ['pointercancel', RendererPointerPhase.CANCEL],
  ['wheel', RendererPointerPhase.WHEEL],
]

const pointerListeners: Array<() => void> = []

let loadedModelId: string | undefined

const exposedMount = (): MountExposed | undefined => mountRef.value as MountExposed | undefined

/** The props the contract defines. Anything else would be a second, untyped channel into a renderer. */
const mountProps = computed(() => {
  const id = mountId.value
  if (!id)
    return undefined
  return {
    modelDriverId: props.driverId,
    mountId: id,
    ...(props.characterId ? { characterId: props.characterId } : {}),
    purpose: props.purpose,
    surface: props.surface,
    paused: props.paused ?? false,
    visible: props.visible ?? true,
    ...(props.reducedMotion !== undefined ? { reducedMotion: props.reducedMotion } : {}),
    ...(props.qualityHint ? { qualityHint: props.qualityHint } : {}),
    ...(props.interactionMode ? { interactionMode: props.interactionMode } : {}),
  }
})

function fail(code: ContractFailureCode, message: string): void {
  const value: ContractFailure = { code, message }
  failure.value = value
  emit('error', value)
}

/** Read a DOM event into the hub's structural shape; the wheel fields exist only on a wheel event. */
function toRawPointer(event: PointerEvent | WheelEvent, phase: RendererPointerPhase): RawPointerEvent {
  const isWheel = 'deltaX' in event
  return {
    phase,
    pointerId: 'pointerId' in event ? event.pointerId : 0,
    clientX: event.clientX,
    clientY: event.clientY,
    ...('pointerType' in event && event.pointerType ? { pointerType: event.pointerType } : {}),
    buttons: event.buttons,
    ...(phase === RendererPointerPhase.DOWN || phase === RendererPointerPhase.UP ? { button: event.button } : {}),
    ...(isWheel ? { wheel: { deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode } } : {}),
    modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
    timeStamp: event.timeStamp,
  }
}

/**
 * Point a mount's box at this component's element.
 *
 * A function rather than a rectangle: layout, scrolling and a window resize move the box while the mount lives, and a
 * snapshot taken here would convert every later gesture against geometry that no longer exists (P2-D16).
 */
function registerPointerBox(id: string): void {
  const element = rootRef.value
  if (!element)
    return
  props.adapter.pointer.setBox(id, () => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  })
}

/**
 * Forward this element's events to the hub, addressed with this mount's id.
 *
 * Capture phase on purpose: a renderer that calls `stopPropagation` in its own handler must not be able to starve
 * itself of the stream it is supposed to read, and the host is the documented route. One conversion, here.
 */
function attachPointerListeners(element: HTMLElement): void {
  for (const [type, phase] of POINTER_EVENTS) {
    const listener = (event: Event) => {
      const id = mountId.value
      if (!id)
        return
      props.adapter.pointer.dispatch(id, toRawPointer(event as PointerEvent | WheelEvent, phase))
    }
    const options: AddEventListenerOptions = { capture: true, passive: type !== 'wheel' }
    element.addEventListener(type, listener, options)
    pointerListeners.push(() => element.removeEventListener(type, listener, { capture: true }))
  }
}

function detachPointerListeners(): void {
  for (const remove of pointerListeners.splice(0))
    remove()
}

async function start() {
  failure.value = undefined

  const registered = await props.adapter.registerMount({
    driverId: props.driverId,
    surface: props.surface,
    purpose: props.purpose,
  })
  if (!registered.ok) {
    fail(ContractFailureCode.DRIVER_UNAVAILABLE, `The host refused to register a \`${props.surface}/${props.purpose}\` mount: ${registered.reason}`)
    return
  }
  mountId.value = registered.mountId
  // The element exists from `onMounted` on, and this is the first moment the id it belongs to is known.
  registerPointerBox(registered.mountId)

  // This window must be the one running the driver's code before it can receive a load for the mount it just
  // registered. A refused entry is reported, not swallowed: the mount would otherwise stay empty forever.
  const entry = await props.adapter.ensureEntry(props.driverId)
  if (!entry.ok) {
    failure.value = entry.error
    emit('error', entry.error)
    return
  }

  const component = await props.adapter.mountComponent({
    driverId: props.driverId,
    surface: props.surface,
    purpose: props.purpose,
  })
  if (!component.ok) {
    failure.value = component.error
    emit('error', component.error)
    return
  }
  if (!component.value) {
    fail(ContractFailureCode.INVALID_ENTRYPOINT, `Driver \`${props.driverId}\` ships no mount component for \`${props.surface}/${props.purpose}\``)
    return
  }

  mountInstance.value = component.value
}

/** Send the load once and only once per model, and only to a mount that reported ready. */
async function loadModelIfReady(state: RendererMountReadinessState) {
  const model = props.model
  const id = mountId.value
  if (!model || !id || state !== Readiness.READY_FOR_MODEL)
    return
  const key = `${model.modelId}/${model.profileId}`
  if (loadedModelId === key)
    return

  loadedModelId = key
  const envelope: CueEnvelopeInput = {
    cues: [{ kind: CueKind.LOAD, modelId: model.modelId, profileId: model.profileId }],
    source: CueSource.HOST,
    override: true,
    target: { modelDriverId: props.driverId, surface: props.surface, purpose: props.purpose },
  }

  const receipt = await props.adapter.cues.send(envelope)
  if (!receipt.ok) {
    emit('load-failed', receipt.error.message)
    return
  }
  const settled = await receipt.value.settled
  if (!settled.ok)
    emit('load-failed', settled.error.message)
  else if (!settled.value.handled)
    emit('load-failed', `No mount of driver \`${props.driverId}\` handled the load`)
}

async function onStateChange(state: RendererMountReadinessState) {
  readiness.value = state
  emit('state-change', state)

  // A refused transition is the host's answer, not a suggestion: report it and stop claiming the new state.
  const id = mountId.value
  if (id) {
    const reported = await props.adapter.setReadiness(id, state)
    if (!reported.ok)
      emit('load-failed', reported.error.message)
  }

  if (state === Readiness.MODEL_ERROR || state === Readiness.MOUNT_ERROR)
    fail(ContractFailureCode.INTERNAL, `The mount reported \`${state}\` while loading \`${props.model?.modelId ?? '(no model)'}\``)

  await loadModelIfReady(state)
}

function onMountError(value: ContractFailure) {
  failure.value = value
  emit('error', value)
}

function onHitAreaChange(change: RendererMountHitAreaChange) {
  emit('hit-area-change', change)
}

function onAnimationFinished(nonce: OperationNonce) {
  emit('animation-finished', nonce)
}

function onCueRejected(payload: { nonce: OperationNonce, index: number, kind: CueKind, reason: string }) {
  emit('cue-rejected', payload)
}

watch(() => props.model, async () => {
  // A model change on one mount is a `LoadCue`, not a remount: the mount survives it (only a driver change replaces
  // it, §5.6). The readiness walk back to `ready-for-model` is what re-arms the load.
  loadedModelId = undefined
  await loadModelIfReady(readiness.value === Readiness.MODEL_LOADED ? Readiness.READY_FOR_MODEL : readiness.value)
})

onMounted(() => {
  const element = rootRef.value
  if (element)
    attachPointerListeners(element)
  void start()
})

onBeforeUnmount(() => {
  detachPointerListeners()
  const id = mountId.value
  // `unregisterMount` releases this mount's pointer subscriptions as well, so nothing here can outlive the element.
  if (id)
    void props.adapter.unregisterMount(id)
  mountId.value = undefined
  mountInstance.value = undefined
  emit('disposed')
})

/** The declared queries, in the shape the contract spells them. */
defineExpose({
  mountId,
  readiness,
  occupiesPoint: (point: RendererMountPoint) => exposedMount()?.occupiesPoint?.(point) ?? false,
  hitTest: (point: RendererMountPoint) => exposedMount()?.hitTest?.(point) ?? null,
  stopAll: () => exposedMount()?.stopAll?.(),
  dispose: (strategy: 'shallow' | 'deep') => exposedMount()?.dispose?.(strategy),
})
</script>

<template>
  <div ref="rootRef" class="relative h-full w-full">
    <component
      :is="mountInstance"
      v-if="mountInstance && mountProps"
      :key="mountId"
      ref="mountRef"
      v-bind="mountProps"
      @state-change="onStateChange"
      @first-frame="emit('first-frame')"
      @context-change="() => {}"
      @disposed="emit('disposed')"
      @error="onMountError"
      @hit-area-change="onHitAreaChange"
      @animation-finished="onAnimationFinished"
      @cue-rejected="onCueRejected"
    />
    <div v-else-if="failure" class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-neutral-950/60 p-3 text-center text-xs text-red-300 font-mono">
      <span>This mount could not be created.</span>
      <span class="opacity-80">{{ failure.message }}</span>
      <span class="opacity-60">{{ failure.code }}</span>
    </div>
  </div>
</template>
