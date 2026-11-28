/**
 * The stub driver through the host's rules (§4.8, §9.1): load, refusal, capture, two mounts, and the migration
 * surface the phase's queue and §9.3 run against.
 *
 * The fixture is only worth having if a host behaviour asserted against it would also hold against a real driver.
 * So these cases use the host's own calls — a cue channel, the registry client, the runtime the window activated —
 * and never reach into the stub's internals to shortcut a step.
 *
 * The two that are easy to under-test and expensive to get wrong are here explicitly:
 *
 *   - **two mounts of one model do not bleed state** (D-1 is the obligation every driver has, and preview is the
 *     mandatory second mount);
 *   - **move-import is observable**: the fixture retains the *same* `Uint8Array` it was handed, so a host that
 *     hands a copy cannot claim move-import by accident (D-16).
 */
import type { LegacyRestorePayload, ModelDriverLegacyHandoverEntry, ModelDriverLegacyHandoverReport } from '../contract'

import { describe, expect, it } from 'vitest'

import {
  ContractFailureCode,
  CueKind,
  CueRejection,
  CueSource,
  LEGACY_HANDOVER_SCHEMA_VERSION,
  RendererMountReadinessState,
} from '../contract'
import { createTestHost, envelope, unwrap } from './testing/harness'
import { STUB_DRIVER_ID } from './testing/stub-driver'

const DEMO_MODEL = { modelId: 'model_stub_demo', profileId: 'profile_stub_demo', name: 'Stub model' }

/**
 * A load transaction, addressed the way a host addresses one.
 *
 * The harness's `envelope()` is an ACT cue — the common case for a "one transaction reached the mount" test — so a
 * case that needs the mount to *load* something states that explicitly rather than reusing it.
 */
function loadEnvelope() {
  return {
    cues: [{ kind: CueKind.LOAD, modelId: DEMO_MODEL.modelId, profileId: DEMO_MODEL.profileId }],
    source: CueSource.HOST,
    override: false,
    target: { modelDriverId: STUB_DRIVER_ID, purpose: 'acting' },
  } as never
}

/** Seed the model the fixture's rows and load cues refer to. */
function seedModel(host: Awaited<ReturnType<typeof createTestHost>>) {
  host.driver.models.set(DEMO_MODEL.modelId, DEMO_MODEL)
}

function handover(overrides: Partial<ModelDriverLegacyHandoverEntry> = {}): ModelDriverLegacyHandoverEntry {
  return {
    schemaVersion: LEGACY_HANDOVER_SCHEMA_VERSION,
    driverId: STUB_DRIVER_ID,
    createdAt: 1,
    modelId: 'model_migrated',
    legacyModelId: 'display-model-legacy-1',
    meta: { name: 'Legacy Airi', tags: ['cute'], groups: ['test'] },
    settings: { values: { scale: 1 } },
    placement: { x: 0, y: 0, scale: 1 },
    prompt: 'Legacy acting prompt.',
    files: [{ name: 'model.bin', bytes: new Uint8Array([1, 2, 3]) }],
    ...overrides,
  }
}

describe('stub driver through the host', () => {
  it('loads a model by cue and reports the readiness walk', async () => {
    const host = await createTestHost()
    seedModel(host)
    const window = host.openWindow('acting')
    const { mountId, mount } = await window.mount({ surface: 'acting', purpose: 'acting' })

    const receipt = unwrap(await window.cueChannel.send(loadEnvelope()))
    const settled = unwrap(await receipt.settled)

    expect(settled.handled).toBe(true)
    expect(settled.nonce).toBe(receipt.nonce)
    expect(settled.mountId).toBe(mountId)
    expect(mount.modelIds).toEqual([DEMO_MODEL.modelId])
    expect(mount.readiness()).toBe(RendererMountReadinessState.MODEL_LOADED)

    await host.close()
  })

  it('reports a load the mount broke as a failure, and leaves readiness in model-error', async () => {
    const host = await createTestHost()
    seedModel(host)
    const window = host.openWindow('acting')
    const { mount } = await window.mount({
      surface: 'acting',
      purpose: 'acting',
      failLoad: { code: ContractFailureCode.INVALID_PACKAGE, message: 'The model is broken' },
    })

    const receipt = unwrap(await window.cueChannel.send(loadEnvelope()))
    const settled = await receipt.settled

    expect(settled.ok).toBe(false)
    if (!settled.ok)
      expect(settled.error.message).toBe('The model is broken')
    expect(mount.readiness()).toBe(RendererMountReadinessState.MODEL_ERROR)

    await host.close()
  })

  it('rejects a cue kind it does not declare while keeping the mount alive', async () => {
    const host = await createTestHost()
    seedModel(host)
    const window = host.openWindow('acting')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    const receipt = unwrap(await window.cueChannel.send({
      // `view` is the one cue kind the fixture does not declare, so the driver has to refuse it as unsupported
      // rather than silently do nothing.
      cues: [{ kind: CueKind.LOAD, modelId: DEMO_MODEL.modelId, profileId: DEMO_MODEL.profileId }, { kind: CueKind.VIEW, pointOfInterestId: 'face' }],
      source: CueSource.HOST,
      override: false,
      target: { modelDriverId: STUB_DRIVER_ID, purpose: 'acting' },
    } as never))
    const settled = unwrap(await receipt.settled)

    // A load that worked plus a cue the driver refused: the send is handled=false, but the mount did load.
    expect(settled.handled).toBe(false)
    expect(settled.results[0]).toEqual({ status: 'resolved', value: { kind: CueKind.LOAD } })
    expect(settled.results[1]).toMatchObject({ status: 'rejected', reason: CueRejection.UNSUPPORTED_CUE })

    await host.close()
  })

  it('returns capture bytes in the settlement', async () => {
    const host = await createTestHost()
    const window = host.openWindow('acting')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    const receipt = unwrap(await window.cueChannel.send({
      cues: [{ kind: CueKind.CAPTURE }],
      source: CueSource.HOST,
      override: false,
      target: { modelDriverId: STUB_DRIVER_ID, purpose: 'acting' },
    }))
    const settled = unwrap(await receipt.settled)
    const slot = settled.results[0]

    expect(slot?.status).toBe('resolved')
    if (slot?.status === 'resolved' && slot.value.kind === CueKind.CAPTURE) {
      expect(slot.value.mime).toBe('image/png')
      expect(slot.value.data.byteLength).toBeGreaterThan(0)
    }

    await host.close()
  })

  it('keeps two mounts of the same model independent', async () => {
    const host = await createTestHost()
    seedModel(host)
    const acting = host.openWindow('acting')
    const settings = host.openWindow('settings')
    const actingMount = await acting.mount({ surface: 'acting', purpose: 'acting' })
    const previewMount = await settings.mount({ surface: 'preview', purpose: 'preview' })

    const receipt = unwrap(await acting.cueChannel.send(loadEnvelope()))
    unwrap(await receipt.settled)

    // The cue reached the acting mount only: the preview mount has loaded nothing and has received nothing.
    expect(actingMount.mount.modelIds).toEqual([DEMO_MODEL.modelId])
    expect(previewMount.mount.modelIds).toEqual([])
    expect(previewMount.mount.received).toHaveLength(0)

    // A cue addressed at the preview purpose reaches the preview mount and nothing else: two live mounts of one
    // model are independent viewports, which is D-1's obligation.
    const previewCue = unwrap(await acting.cueChannel.send(envelope('preview')))
    const previewSettled = unwrap(await previewCue.settled)
    expect(previewSettled.handled).toBe(true)
    expect(previewMount.mount.received).toHaveLength(1)
    expect(actingMount.mount.received).toHaveLength(1)
    expect(previewMount.mount.modelIds).toEqual([])

    await host.close()
  })
})

describe('the stub migration surface', () => {
  it('retains the handover it was given, bytes by reference, and can emit it back for a revert', async () => {
    const host = await createTestHost()
    const window = host.openWindow('background')
    const opened = await window.openEntry({ driverId: STUB_DRIVER_ID })
    expect(opened.ok).toBe(true)

    const entry = handover()
    const report = unwrap(window.runtime()!.migrate!(entry) as never) as ModelDriverLegacyHandoverReport
    expect(report.retained).toBe(true)

    // Move-import, observably: the retained entry holds the same `Uint8Array`, not a copy of it (D-16).
    const retained = host.driver.retained.get(entry.modelId)
    expect(retained?.files?.[0]?.bytes).toBe(entry.files?.[0]?.bytes)

    const restored = unwrap(window.runtime()!.restoreLegacy!(entry.modelId) as never) as LegacyRestorePayload
    expect(restored.legacyModelId).toBe('display-model-legacy-1')
    expect(restored.meta.name).toBe('Legacy Airi')
    expect(restored.prompt).toBe('Legacy acting prompt.')
    expect(restored.files?.[0]?.bytes).toBe(entry.files?.[0]?.bytes)

    await host.close()
  })

  it('reports retained: false instead of failing, and retains nothing', async () => {
    const host = await createTestHost()
    const window = host.openWindow('background')
    await window.openEntry({ driverId: STUB_DRIVER_ID })

    host.driver.failures.retain = false
    const report = unwrap(window.runtime()!.migrate!(handover()) as never) as ModelDriverLegacyHandoverReport

    expect(report.retained).toBe(false)
    expect(host.driver.retained.size).toBe(0)

    await host.close()
  })

  it('refuses a restore for a model it never retained, with asset-missing', async () => {
    const host = await createTestHost()
    const window = host.openWindow('background')
    await window.openEntry({ driverId: STUB_DRIVER_ID })

    const result = window.runtime()!.restoreLegacy!('model_never_migrated') as never as { ok: boolean, error?: { code: string } }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ContractFailureCode.ASSET_MISSING)

    await host.close()
  })

  it('retains an entry twice without treating the repeat as a new import', async () => {
    const host = await createTestHost()
    const window = host.openWindow('background')
    await window.openEntry({ driverId: STUB_DRIVER_ID })

    const entry = handover()
    window.runtime()!.migrate!(entry)
    const again = unwrap(window.runtime()!.migrate!({ ...entry }) as never) as ModelDriverLegacyHandoverReport

    // Idempotent: a crash between the driver's write and the host's marker replays the identical entry (D8).
    expect(again.retained).toBe(true)
    expect(host.driver.retained.size).toBe(1)

    await host.close()
  })
})
