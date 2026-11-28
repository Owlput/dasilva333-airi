import type { PropType } from 'vue'

import type {
  ContractResult,
  CueAck,
  CueEnvelope,
  RendererMountInteractionMode,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../../contract'
/**
 * The stub fixture's renderer components: a mount, a panel and a picker (§4.8, §5.2, §5.6).
 *
 * Written as render-function components rather than `.vue` files on purpose: the fixture lives in the SDK, and
 * an SFC would need a Vue SFC build in a package whose only renderer dependency is `vue` itself. Everything a
 * real driver's component does at the contract boundary — readiness, the eight emits, the exposed queries, a
 * `select` from a picker — is what these three do, and the host cannot tell them apart from a real driver's.
 *
 * The mount binds to this window's stub session (`stubWindowSession`), which is where the provider entry put the
 * models and the handover state. That is also the shape a real driver has: its component reads the services and
 * state its own entry established, not a module the host hands it.
 */
import type { ModelDriverPanelHostSurface, ModelDriverPanelProps, ModelPickerProps } from '../../contract/components'
import type { HostServices } from '../../contract/host-services'
import type { RendererMountProps, RendererQualityHint } from '../../contract/renderer-mount'
import type { StubMount } from './stub-driver'

import { defineComponent, h, onUnmounted, ref, watch } from 'vue'

import {
  ContractFailureCode,
  RendererMountReadinessState as Readiness,
} from '../../contract'
import { stubWindowSession } from './stub-entry'

export const StubMountComponent = defineComponent({
  name: 'StubModelMount',
  props: {
    modelDriverId: { type: String, required: false, default: undefined },
    mountId: { type: String, required: true },
    characterId: { type: String, required: false, default: undefined },
    // The enum-valued props are declared with their contract type rather than `String`: a Vue `String` prop resolves
    // to `string`, which would make this component unassignable to `RendererMountComponent` and hide a real mismatch
    // behind a cast (P2-D6).
    purpose: { type: String as PropType<RendererMountPurpose>, required: true },
    surface: { type: String as PropType<RendererMountSurfaceKind>, required: true },
    paused: { type: Boolean, required: true },
    visible: { type: Boolean, required: true },
    reducedMotion: { type: Boolean, required: false, default: false },
    qualityHint: { type: String as PropType<RendererQualityHint>, required: false, default: undefined },
    interactionMode: { type: String as PropType<RendererMountInteractionMode>, required: false, default: undefined },
  },
  emits: [
    'state-change',
    'first-frame',
    'context-change',
    'disposed',
    'error',
    'hit-area-change',
    'animation-finished',
    'cue-rejected',
  ],
  setup(props, { emit, expose }) {
    const state = ref<RendererMountReadinessState>(Readiness.UNMOUNTED)
    const loaded = ref<string[]>([])
    const session = stubWindowSession(props.modelDriverId ?? '')

    let mount: StubMount | undefined
    if (session) {
      mount = session.openMount({
        surface: props.surface as RendererMountProps['surface'],
        purpose: props.purpose as RendererMountProps['purpose'],
      })
      mount.attach(props.mountId)
    }
    else {
      emit('error', {
        code: ContractFailureCode.DRIVER_UNAVAILABLE,
        message: `No stub session in this window for \`${props.modelDriverId ?? '(no driver)'}\``,
      })
    }

    const moveTo = (next: RendererMountReadinessState) => {
      state.value = next
      mount?.moveTo(next)
      emit('state-change', next)
    }

    // The declared walk a stage takes: mounted, then ready to be told which model to show.
    moveTo(Readiness.MOUNTING)
    queueMicrotask(() => {
      moveTo(Readiness.READY_FOR_MODEL)
      emit('first-frame')
    })

    // The mount survives a model change, so a load moves through `loading-model` rather than back to ready.
    watch(() => props.paused, (paused) => {
      if (paused)
        mounted?.stopAll?.()
    })

    const mounted = {
      async handle(envelope: CueEnvelope): Promise<ContractResult<CueAck>> {
        const load = envelope.cues.find(cue => cue.kind === 'load')
        if (load && load.kind === 'load') {
          moveTo(Readiness.LOADING_MODEL)
          loaded.value = [...new Set([...loaded.value, load.modelId])]
          moveTo(Readiness.MODEL_LOADED)
        }
        return mount
          ? mount.handle(envelope)
          : { ok: true, value: { nonce: envelope.nonce, modelDriverId: props.modelDriverId ?? 'unknown', mountId: props.mountId, results: [], handled: false } }
      },
      occupiesPoint: (point: { x: number, y: number }) => mount?.occupiesPoint(point) ?? false,
      hitTest: (point: { x: number, y: number }) => mount?.hitTest(point) ?? null,
      stopAll: () => {},
      dispose: () => {
        if (session && mount)
          session.mounts.splice(session.mounts.indexOf(mount), 1)
      },
    }

    // The contract's exposed members, so the host's queries reach the same object the protocol drives.
    expose(mounted)

    onUnmounted(() => {
      moveTo(Readiness.UNMOUNTED)
      emit('disposed')
      mounted.dispose()
    })

    return () => h('div', {
      'data-stub-mount': props.mountId,
      'data-readiness': state.value,
      'data-surface': props.surface,
      'data-purpose': props.purpose,
      'data-paused': String(props.paused),
      'data-visible': String(props.visible),
      'style': {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '4px',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: props.visible ? '#6ee7b7' : '#52525b',
        background: 'rgba(9, 9, 11, 0.55)',
        border: '1px dashed rgba(110, 231, 183, 0.35)',
      },
    }, [
      h('strong', `stub mount · ${props.surface}/${props.purpose}`),
      h('span', `readiness: ${state.value}`),
      h('span', loaded.value.length > 0 ? `models: ${loaded.value.join(', ')}` : 'no model loaded'),
    ])
  },
})

/**
 * The stub panel.
 *
 * It proves the two things a panel must not do and the two it must: it edits the driver's own storage and
 * publishes through `services.prompt`, and it never touches host state. The `panel-note` it writes is read back
 * from the same driver namespace, which is also what shows the panel and the mount see one storage.
 */
export const StubPanelComponent = defineComponent({
  name: 'StubModelPanel',
  props: {
    modelId: { type: String, required: true },
    profileId: { type: String, required: false, default: undefined },
    mountId: { type: String, required: false, default: undefined },
    surface: { type: String as PropType<RendererMountSurfaceKind>, required: true },
    hostSurface: { type: String as PropType<ModelDriverPanelHostSurface>, required: true },
    readiness: { type: String as PropType<RendererMountReadinessState>, required: true },
    readOnly: { type: Boolean, required: false, default: false },
    services: { type: Object as PropType<HostServices>, required: true },
  },
  emits: [],
  setup(props) {
    const propsValue = props as unknown as ModelDriverPanelProps
    const note = ref('(not read yet)')
    const published = ref('(nothing published)')

    const read = async () => {
      const value = await propsValue.services.storage.get<string>('panel-note')
      note.value = value ?? '(no note)'
    }
    void read()

    return () => h('div', { 'data-stub-panel': props.modelId, 'style': { display: 'grid', gap: '6px', fontFamily: 'monospace', fontSize: '12px' } }, [
      h('strong', `stub panel · ${props.hostSurface} · ${props.surface}`),
      h('span', `model ${props.modelId} / profile ${props.profileId ?? '(none)'} · readiness ${props.readiness}`),
      h('span', `panel note: ${note.value}`),
      h('span', `publication: ${published.value}`),
      h('button', {
        type: 'button',
        disabled: props.readOnly,
        onClick: async () => {
          if (props.readOnly)
            return
          await propsValue.services.storage.set('panel-note', `edited at ${new Date().toISOString()}`)
          await read()
          propsValue.services.prompt.publish({
            modelDriverId: propsValue.services.modelDriverId,
            modelId: props.modelId,
            profileId: props.profileId ?? '',
            text: '',
            tokens: [],
            version: Date.now(),
            publishedAt: Date.now(),
          })
          published.value = 'empty publication sent'
        },
      }, props.readOnly ? 'read-only' : 'publish an empty prompt'),
    ])
  },
})

/** The stub picker: lists the session's models and emits the pair the host binds. */
export const StubPickerComponent = defineComponent({
  name: 'StubModelPicker',
  props: {
    characterId: { type: String, required: false, default: undefined },
    currentModelId: { type: String, required: false, default: undefined },
    currentProfileId: { type: String, required: false, default: undefined },
    services: { type: Object as PropType<HostServices>, required: true },
  },
  emits: ['select', 'cancel'],
  setup(props, { emit }) {
    const propsValue = props as unknown as ModelPickerProps
    const session = stubWindowSession(propsValue.services.modelDriverId)
    const models = session ? [...session.state.models.values()] : []

    return () => h('div', { 'data-stub-picker': '', 'style': { display: 'grid', gap: '6px', fontFamily: 'monospace', fontSize: '12px' } }, [
      h('strong', `stub picker · ${models.length} model(s)`),
      ...models.map(model => h('button', {
        'type': 'button',
        'data-model-id': model.modelId,
        'onClick': () => emit('select', { modelId: model.modelId, profileId: model.profileId }),
      }, `${model.name}${model.modelId === props.currentModelId ? ' (current)' : ''}`)),
      h('button', { type: 'button', onClick: () => emit('cancel') }, 'cancel'),
    ])
  },
})

/** What the panels entry resolves to: one declaration, mounted in every host surface. */
export const STUB_PANEL_DECLARATIONS = [
  {
    id: 'stub-panel',
    label: 'Stub panel',
    component: async () => ({ default: StubPanelComponent }),
  },
]
