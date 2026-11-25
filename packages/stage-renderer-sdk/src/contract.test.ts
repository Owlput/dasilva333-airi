/**
 * The parts of Phase 0 that are vocabulary rather than behaviour: the renamed members, the exhaustive
 * enums, the shapes that exist specifically to make a wrong construction not typecheck, and the one
 * mapping between two status vocabularies.
 *
 * Several assertions are compile-time by design (`@ts-expect-error` under `tsc --noEmit`, which covers
 * `src/**`), because the guarantee being checked is "this cannot be built", not "this is rejected at
 * runtime".
 */
import type { Adapter } from './contract/adapter'
import type { CueAck, CueTarget, EffectCue, LoadCue, OptionalCueKind } from './contract/cues'
import type { ModelPromptSnapshot } from './contract/host-services'
import type { ModelDriverCapabilities, ModelDriverEntryPoints } from './contract/manifest'
import type { LegacyRestorePayload, ModelDriverLegacyHandoverReport } from './contract/migration'
import type { ModelState } from './contract/model'
import type { PendingModelPayload } from './contract/references'
import type { RegistryHandle } from './contract/registry'
import type { RendererMountProps } from './contract/renderer-mount'
import type { HostReferenceEvidence } from './contract/shared'

import { describe, expect, it } from 'vitest'

import {
  CUE_WITHDRAWAL_LIMITS,
  CueKind,
  CueRejection,
  CueTransactionState,
  CueWithdrawalKind,
  GazeMode,
  isTerminalTransactionState,
  ResetScope,
} from './contract/cues'
import {
  CapabilityDiscoveryMode,
  ModelDriverDomRequirement,
} from './contract/manifest'
import { LEGACY_HANDOVER_SCHEMA_VERSION } from './contract/migration'
import {
  ModelProfileSaveMode,
} from './contract/provider'
import {
  classifyBindingAvailability,
  DriverStatus,
  UnavailableModelReason,
} from './contract/references'
import {
  ModelDriverEntryKind,
  MountRegistrationRefusal,
  RendererRequestRefusal,
} from './contract/registry'
import { RendererMountInteractionMode } from './contract/renderer-mount'
import {
  ContractFailureCode,
  MODEL_DRIVER_CONTRACT_VERSION,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from './contract/shared'

/** A compile-time assertion that still keeps the file free of unused locals. */
function expectType<T>(_value: T): void {}

describe('contract revision', () => {
  it('is 0.1, the first shipped shape', () => {
    expect(MODEL_DRIVER_CONTRACT_VERSION).toEqual({ major: 0, minor: 1 })
  })
})

describe('the adapter mints model and profile ids, never a mount id', () => {
  it('exposes both minting members', () => {
    expectType<Adapter['mintModelId']>(undefined as never)
    expectType<Adapter['mintProfileId']>(undefined as never)
  })

  it('has no mount-id minting member at all', () => {
    // @ts-expect-error the registry issues mount ids; a renderer cannot construct one (C1, C22)
    expectType<Adapter['mintMountId']>(undefined)
  })

  it('mints unique ids for a sequence of imports', () => {
    let sequence = 0
    const mint = () => `model-${sequence++}`
    const ids = Array.from({ length: 100 }, mint)
    expect(new Set(ids).size).toBe(100)
  })
})

describe('cue addressing names a driver, not a mount', () => {
  it('accepts driver plus surface plus purpose', () => {
    const target: CueTarget = {
      modelDriverId: 'ai.moeru.airi.stage.test',
      surface: RendererMountSurfaceKind.ACTING,
      purpose: RendererMountPurpose.ACTING,
    }
    expect(target.modelDriverId).toBe('ai.moeru.airi.stage.test')
  })

  it('has no mount id in the target', () => {
    // @ts-expect-error a transaction never names a mount (C2)
    expectType<CueTarget>({ modelDriverId: 'd', mountId: 'mount-1' })
  })

  it('renamed ACTOR to ACTING on the surface, purpose and host-window vocabularies', () => {
    expect(RendererMountSurfaceKind.ACTING).toBe('acting')
    expect(RendererMountPurpose.ACTING).toBe('acting')
    expect(Object.values(RendererMountSurfaceKind)).not.toContain('actor')
    expect(Object.values(RendererMountPurpose)).not.toContain('actor')
  })
})

describe('cue vocabulary deltas', () => {
  it('spells the act cue kind `act`', () => {
    expect(CueKind.ACT).toBe('act')
  })

  it('has an effect cue and an effect reset scope', () => {
    expect(CueKind.EFFECT).toBe('effect')
    expect(ResetScope.EFFECT).toBe('effect')
    const effect: EffectCue = { kind: CueKind.EFFECT, effect: 'aura', durationMs: 1200 }
    expect(effect.effect).toBe('aura')
  })

  it('can address a point of interest as a gaze target', () => {
    expect(GazeMode.POINT_OF_INTEREST).toBe('pointOfInterest')
  })

  it('carries NO_TARGET as a rejection, not a failure', () => {
    expect(CueRejection.NO_TARGET).toBe('no-target')
    expect(Object.values(ContractFailureCode)).not.toContain('no-target')
  })

  it('types declared cues as the optional kinds beyond load', () => {
    // @ts-expect-error every mount must handle a load, so it cannot be declared as optional (C8)
    expectType<ModelDriverCapabilities['cues']>([CueKind.LOAD])
  })

  it('declares interaction modes as a typed subset', () => {
    const modes: ModelDriverCapabilities['interactionModes'] = [
      RendererMountInteractionMode.TACTILE,
      RendererMountInteractionMode.NONE,
    ]
    expect(modes).toHaveLength(2)
  })
})

describe('failure vocabulary', () => {
  it('is exhaustive, so adding a code forces this test to be updated', () => {
    const expected: Record<ContractFailureCode, true> = {
      [ContractFailureCode.UNSUPPORTED_INPUT]: true,
      [ContractFailureCode.INVALID_PACKAGE]: true,
      [ContractFailureCode.ASSET_MISSING]: true,
      [ContractFailureCode.ASSET_CORRUPT]: true,
      [ContractFailureCode.DRIVER_UNAVAILABLE]: true,
      [ContractFailureCode.HOST_SERVICE_MISSING]: true,
      [ContractFailureCode.MODEL_ID_CONFLICT]: true,
      [ContractFailureCode.MODEL_REFERENCED]: true,
      [ContractFailureCode.PROFILE_REFERENCED]: true,
      [ContractFailureCode.PROFILE_MISSING]: true,
      [ContractFailureCode.CAPTURE_FAILED]: true,
      [ContractFailureCode.TIMEOUT]: true,
      [ContractFailureCode.INVALID_ENVELOPE]: true,
      [ContractFailureCode.INVALID_ENTRYPOINT]: true,
      [ContractFailureCode.ABORTED]: true,
      [ContractFailureCode.CANCELLED]: true,
      [ContractFailureCode.WINDOW_GONE]: true,
      [ContractFailureCode.CONTRACT_VERSION_MISMATCH]: true,
      [ContractFailureCode.INTERNAL]: true,
    }

    expect(Object.keys(expected).sort()).toEqual(Object.values(ContractFailureCode).sort())
  })

  it('renamed RENDERER_UNAVAILABLE to DRIVER_UNAVAILABLE', () => {
    expect(ContractFailureCode.DRIVER_UNAVAILABLE).toBe('driver-unavailable')
    expect(ContractFailureCode).not.toHaveProperty('RENDERER_UNAVAILABLE')
  })

  it('carries the evidence a reference gate refuses with', () => {
    const evidence: HostReferenceEvidence = { characterId: 'character-1', characterName: 'Airi' }
    const failure = {
      code: ContractFailureCode.MODEL_REFERENCED,
      message: 'Airi still uses this model',
      references: [evidence],
    }
    expect(failure.references[0].characterId).toBe('character-1')
  })
})

describe('the acknowledgement splits acceptance from settlement', () => {
  it('drops requestId and answers with the driver id', () => {
    // @ts-expect-error the broker routes by nonce and driver, so the host-minted requestId is gone (C5)
    expectType<CueAck['requestId']>(undefined)
    expectType<CueAck['modelDriverId']>(undefined as never)
    expectType<CueAck['message']>(undefined as never)
  })

  it('defines seven transaction states, four of them terminal', () => {
    const states = Object.values(CueTransactionState)
    expect(states).toHaveLength(7)
    const terminal = states.filter(isTerminalTransactionState)
    expect(terminal.sort()).toEqual([
      CueTransactionState.ABORTED,
      CueTransactionState.CANCELLED,
      CueTransactionState.COMPLETE,
      CueTransactionState.ERROR,
    ].sort())
  })

  it('defines six withdrawal requests with a bounded target list', () => {
    expect(Object.values(CueWithdrawalKind)).toHaveLength(6)
    expect(CUE_WITHDRAWAL_LIMITS.maxNoncesPerRequest).toBe(64)
    expect(CUE_WITHDRAWAL_LIMITS.maxReportEntries).toBe(256)
  })
})

describe('no size reaches a driver', () => {
  it('has no viewport prop', () => {
    const base: RendererMountProps = {
      mountId: 'mount-1',
      purpose: RendererMountPurpose.STAGE,
      paused: false,
      visible: true,
      surface: RendererMountSurfaceKind.STAGE,
    }
    // @ts-expect-error the container is the viewport; the host passes no size (C20)
    expectType<RendererMountProps>({ ...base, viewport: { width: 640, height: 480 } })
  })
})

describe('the declaration names the manager only', () => {
  it('has a single entry point', () => {
    // @ts-expect-error the manager resolves the rest at the moment a window needs it (C15)
    expectType<ModelDriverEntryPoints>({ manager: '@proj-airi/x/driver/manager', provider: '@proj-airi/x/driver/provider' })
  })

  it('addresses every entry kind the manager can resolve', () => {
    expect(Object.values(ModelDriverEntryKind)).toEqual(['provider', 'mount', 'panels', 'picker'])
  })
})

describe('registry handle and mount registration', () => {
  it('hands the manager no storage', () => {
    // @ts-expect-error main has no IndexedDB, so a manager must ask for a renderer to reach storage (C22)
    expectType<RegistryHandle['storage']>(undefined)
  })

  it('refuses a renderer request only with host-owned reasons', () => {
    expect(Object.values(RendererRequestRefusal)).toEqual([
      'window-unavailable',
      'entry-failed',
      'driver-disabled',
      'shutting-down',
    ])
  })

  it('refuses a mount registration only when it must', () => {
    expect(Object.values(MountRegistrationRefusal)).toEqual([
      'driver-disabled',
      'shutting-down',
    ])
  })
})

describe('model states and pending payloads', () => {
  it('no longer has a pending-import state', () => {
    // @ts-expect-error a payload is not a model state; it has no identity (C12)
    expectType<ModelState>('pending-import')
  })

  it('a pending payload is not addressable', () => {
    // @ts-expect-error a pending payload has no identity, so it cannot construct a LoadCue (C12)
    expectType<PendingModelPayload['modelId']>(undefined)
    expectType<Pick<PendingModelPayload, 'legacyModelId' | 'displayName'>>(undefined as never)
  })

  it('a load cue needs a model id', () => {
    // @ts-expect-error a load without a model is not expressible
    expectType<LoadCue>({ kind: CueKind.LOAD })
  })
})

describe('prompt publication is an atomic pair', () => {
  it('a snapshot always carries its token list', () => {
    // @ts-expect-error text never exists without the tokens it was written against (C7)
    expectType<ModelPromptSnapshot>({ modelId: 'm', profileId: 'p', text: 't', version: 1, publishedAt: 0 })
  })

  it('the publication names the driver, the model and the profile', () => {
    expectType<ModelPromptSnapshot>({
      modelId: 'm',
      profileId: 'p',
      text: '',
      tokens: [],
      version: 1,
      publishedAt: 0,
    })
  })
})

describe('migration and revert shapes', () => {
  it('reports retention, and has no absorbed boolean', () => {
    // @ts-expect-error retention is the whole answer; there is no absorbed flag and no aggregate (C13)
    expectType<ModelDriverLegacyHandoverReport>({ retained: true, absorbed: true })
  })

  it('ships schema version 1', () => {
    expect(LEGACY_HANDOVER_SCHEMA_VERSION).toBe(1)
  })

  it('a restore payload must carry the legacy identity', () => {
    // @ts-expect-error the legacy id is what the legacy record is recreated under (C23)
    expectType<LegacyRestorePayload>({
      schemaVersion: 1,
      driverId: 'd',
      modelId: 'm',
      meta: { name: 'x' },
    })
  })
})

describe('two status vocabularies, one mapping', () => {
  const base = { modelRecordPresent: true, profileRecordPresent: true }

  it('maps driver health first', () => {
    expect(classifyBindingAvailability({ ...base, driver: 'absent' }).available).toBe(false)
    expect(classifyBindingAvailability({ ...base, driver: DriverStatus.NOT_INSTALLED })).toEqual({
      available: false,
      reason: UnavailableModelReason.DRIVER_UNKNOWN,
    })
    expect(classifyBindingAvailability({ ...base, driver: DriverStatus.DISABLED })).toEqual({
      available: false,
      reason: UnavailableModelReason.DRIVER_DISABLED,
    })
    expect(classifyBindingAvailability({ ...base, driver: DriverStatus.ERROR })).toEqual({
      available: false,
      reason: UnavailableModelReason.DRIVER_ERROR,
    })
  })

  it('then a mount that already failed', () => {
    expect(classifyBindingAvailability({
      ...base,
      driver: DriverStatus.ENABLED,
      runtimeFailed: true,
    })).toEqual({ available: false, reason: UnavailableModelReason.RUNTIME_ERROR })
  })

  it('then the model, then the profile', () => {
    expect(classifyBindingAvailability({
      driver: DriverStatus.ENABLED,
      modelRecordPresent: false,
      profileRecordPresent: true,
    })).toEqual({ available: false, reason: UnavailableModelReason.MODEL_MISSING })

    expect(classifyBindingAvailability({
      driver: DriverStatus.ENABLED,
      modelRecordPresent: true,
      profileRecordPresent: false,
    })).toEqual({ available: false, reason: UnavailableModelReason.PROFILE_MISSING })
  })

  it('only reports available when everything resolves', () => {
    expect(classifyBindingAvailability({ ...base, driver: DriverStatus.ENABLED })).toEqual({ available: true })
    expect(Object.values(UnavailableModelReason)).toContain('profile-missing')
  })
})

describe('remaining vocabulary stays anchored', () => {
  it('keeps the option kinds that name a driver surface', () => {
    expect(ModelDriverDomRequirement.CANVAS).toBe('canvas')
    expect(CapabilityDiscoveryMode.RUNTIME).toBe('runtime')
    expect(ModelProfileSaveMode.UPSERT).toBe('upsert')
    expect(Object.values(RendererMountReadinessState)).toHaveLength(7)
  })

  it('keeps the optional cue kind union free of load', () => {
    const kinds: OptionalCueKind[] = [CueKind.ACT, CueKind.EFFECT]
    expect(kinds).toHaveLength(2)
  })
})
