import type { CueEnvelope } from './contract/cues'
import type { ModelDriverCapabilities, ModelDriverManifest } from './contract/manifest'

import { describe, expect, it } from 'vitest'

import { isContractCompatible } from './compatibility'
import {
  CueKind,
  CueRejection,
  CueSource,
  CueWithdrawalKind,
  GazeMode,
  ResetScope,
} from './contract/cues'
import { CapabilityDiscoveryMode } from './contract/manifest'
import { RendererMountInteractionMode } from './contract/renderer-mount'
import {
  isReady,
  MODEL_DRIVER_CONTRACT_VERSION,
  READINESS_TRANSITIONS,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from './contract/shared'
import {
  assertAckShape,
  assertCapabilityCompleteness,
  assertReadinessTransition,
  CUE_TRANSACTION_STATE_VALUES,
  evaluatePromptPublicationState,
  isPromptPublicationNewer,
  MODEL_DRIVER_CAPABILITY_KEYS,
  PromptPublicationState,
  validateCueEnvelope,
  validateManifest,
  validatePromptPublication,
  validateWithdrawalRequest,
} from './validate'

/** Every capability key present, so a test can remove exactly one and see it named. */
function completeCapabilities(): ModelDriverCapabilities {
  return {
    probe: true,
    previewModel: true,
    capabilityDiscovery: CapabilityDiscoveryMode.STATIC,
    profiles: true,
    prompt: true,
    modelTransfer: true,
    driverTransfer: true,
    panels: true,
    deactivate: true,
    purge: true,
    migration: true,
    cues: [CueKind.ACT, CueKind.EXPRESSION, CueKind.MOTION],
    interactionModes: [RendererMountInteractionMode.TACTILE, RendererMountInteractionMode.NONE],
    occupiesPoint: true,
    hitTest: true,
    stopAll: true,
    dispose: true,
  }
}

function validManifest(): ModelDriverManifest {
  return {
    id: 'ai.moeru.airi.stage.test',
    name: 'Test Driver',
    driverVersion: '1.2.3',
    contractVersion: { ...MODEL_DRIVER_CONTRACT_VERSION },
    capabilities: completeCapabilities(),
    requirements: {},
    entry: { manager: '@proj-airi/stage-ui-test/driver/manager' },
  }
}

function envelope(overrides: Partial<CueEnvelope> = {}): CueEnvelope {
  return {
    cues: [{ kind: CueKind.LOAD, modelId: 'model-1' }],
    source: CueSource.AGENT,
    override: true,
    nonce: 1,
    at: 1_700_000_000_000,
    target: { modelDriverId: 'ai.moeru.airi.stage.test' },
    ...overrides,
  }
}

describe('isContractCompatible', () => {
  it('accepts the contract revision this package defines', () => {
    expect(isContractCompatible(MODEL_DRIVER_CONTRACT_VERSION).ok).toBe(true)
  })

  it('rejects a 0.0 draft against the 0.1 published shape with a readable reason', () => {
    const result = isContractCompatible({ major: 0, minor: 0 })
    expect(result.ok).toBe(false)
    if (result.ok)
      throw new Error('expected a rejection')
    expect(result.error.code).toBe('contract-version-mismatch')
    expect(result.error.message).toContain('below 1.0')
  })

  it('requires an exactly matching minor below 1.0', () => {
    expect(isContractCompatible({ major: 0, minor: 1 }).ok).toBe(true)
    expect(isContractCompatible({ major: 0, minor: 2 }).ok).toBe(false)
  })

  it('accepts an older minor of the same major from 1.0', () => {
    expect(isContractCompatible({ major: 1, minor: 2 }, { major: 1, minor: 4 }).ok).toBe(true)
    expect(isContractCompatible({ major: 1, minor: 4 }, { major: 1, minor: 4 }).ok).toBe(true)
  })

  it('rejects a newer minor a build cannot know, and another major', () => {
    expect(isContractCompatible({ major: 1, minor: 5 }, { major: 1, minor: 4 }).ok).toBe(false)
    expect(isContractCompatible({ major: 2, minor: 0 }, { major: 1, minor: 4 }).ok).toBe(false)
  })

  it('rejects a pre-1.0 revision paired with a 1.0-or-later one', () => {
    expect(isContractCompatible({ major: 1, minor: 0 }, { major: 0, minor: 1 }).ok).toBe(false)
    expect(isContractCompatible({ major: 0, minor: 1 }, { major: 1, minor: 0 }).ok).toBe(false)
  })
})

describe('validateManifest', () => {
  it('accepts a complete declaration', () => {
    const result = validateManifest(validManifest())
    expect(result.ok).toBe(true)
  })

  it('names the missing capability key', () => {
    const capabilities: Record<string, unknown> = { ...completeCapabilities() }
    delete capabilities.prompt
    const result = validateManifest({ ...validManifest(), capabilities })
    expect(result.ok).toBe(false)
    if (result.ok)
      throw new Error('expected a rejection')
    expect(result.error.message).toContain('capabilities.prompt')
  })

  it('refuses a declaration that names an entry beyond the manager', () => {
    const manifest = validManifest()
    const result = validateManifest({
      ...manifest,
      entry: { manager: manifest.entry.manager, provider: './provider' },
    })
    expect(result.ok).toBe(false)
    if (result.ok)
      throw new Error('expected a rejection')
    expect(result.error.message).toContain('manager')
    expect(result.error.message).toContain('provider')
  })

  it('rejects a 0.0 declaration after the shape is sound', () => {
    const result = validateManifest({ ...validManifest(), contractVersion: { major: 0, minor: 0 } })
    expect(result.ok).toBe(false)
    if (result.ok)
      throw new Error('expected a rejection')
    expect(result.error.code).toBe('contract-version-mismatch')
  })

  it('rejects a non-object', () => {
    expect(validateManifest('nope').ok).toBe(false)
  })
})

describe('assertCapabilityCompleteness', () => {
  it('accepts the complete record and every declared key is one it checks', () => {
    expect(assertCapabilityCompleteness(completeCapabilities()).ok).toBe(true)
    expect(MODEL_DRIVER_CAPABILITY_KEYS).toContain('prompt')
    expect(MODEL_DRIVER_CAPABILITY_KEYS).toContain('interactionModes')
  })

  it('rejects a record missing any key', () => {
    for (const key of MODEL_DRIVER_CAPABILITY_KEYS) {
      const partial: Record<string, unknown> = { ...completeCapabilities() }
      delete partial[key]
      const result = assertCapabilityCompleteness(partial)
      expect(result.ok, `deleting ${key} should fail`).toBe(false)
      if (!result.ok)
        expect(result.error.message).toContain(key)
    }
  })

  it('rejects a key this revision does not define', () => {
    const result = assertCapabilityCompleteness({ ...completeCapabilities(), futureThing: true })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('futureThing')
  })

  it('refuses `load` among the optional cue kinds', () => {
    const result = assertCapabilityCompleteness({
      ...completeCapabilities(),
      cues: [CueKind.LOAD],
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('must not list `load`')
  })

  it('refuses a point-of-interest cue with no capability discovery', () => {
    const result = assertCapabilityCompleteness({
      ...completeCapabilities(),
      capabilityDiscovery: CapabilityDiscoveryMode.NONE,
      cues: [CueKind.VIEW],
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('view')
  })

  it('refuses an unknown interaction mode', () => {
    const result = assertCapabilityCompleteness({
      ...completeCapabilities(),
      interactionModes: ['wiggle'],
    })
    expect(result.ok).toBe(false)
  })
})

describe('validateCueEnvelope', () => {
  it('accepts a load transaction addressed by driver, surface and purpose', () => {
    const result = validateCueEnvelope(envelope({
      target: {
        modelDriverId: 'ai.moeru.airi.stage.test',
        surface: RendererMountSurfaceKind.ACTING,
        purpose: RendererMountPurpose.ACTING,
      },
    }))
    expect(result.ok).toBe(true)
  })

  it('requires a target', () => {
    const { target: _target, ...rest } = envelope()
    const result = validateCueEnvelope(rest)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.code).toBe('invalid-envelope')
  })

  it('refuses capture sharing an envelope', () => {
    const result = validateCueEnvelope(envelope({
      cues: [{ kind: CueKind.CAPTURE }, { kind: CueKind.ACT, actToken: 'joy' }],
    }))
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('capture must be the only cue')
  })

  it('accepts capture alone', () => {
    expect(validateCueEnvelope(envelope({ cues: [{ kind: CueKind.CAPTURE }] })).ok).toBe(true)
  })

  it('refuses a transient load, reset or caption', () => {
    for (const cue of [
      { kind: CueKind.LOAD, modelId: 'm' },
      { kind: CueKind.RESET, scope: ResetScope.ALL },
      { kind: CueKind.CAPTION, text: 'hi', utteranceId: 'u1' },
    ]) {
      const result = validateCueEnvelope(envelope({ cues: [cue as never], persistent: false }))
      expect(result.ok).toBe(false)
    }
  })

  it('accepts a transient expression', () => {
    const result = validateCueEnvelope(envelope({
      cues: [{ kind: CueKind.EXPRESSION, key: 'joy' }],
      persistent: false,
    }))
    expect(result.ok).toBe(true)
  })

  it('refuses an unknown cue kind', () => {
    const result = validateCueEnvelope(envelope({ cues: [{ kind: 'teleport' } as never] }))
    expect(result.ok).toBe(false)
  })

  it('requires the point of interest a gaze names', () => {
    const result = validateCueEnvelope(envelope({
      cues: [{ kind: CueKind.GAZE, mode: GazeMode.POINT_OF_INTEREST }],
    }))
    expect(result.ok).toBe(false)
  })
})

describe('assertAckShape', () => {
  it('accepts one outcome per cue', () => {
    const result = assertAckShape({
      nonce: 1,
      modelDriverId: 'ai.moeru.airi.stage.test',
      results: [{ status: 'resolved', value: { kind: CueKind.LOAD } }],
      handled: true,
    }, 1)
    expect(result.ok).toBe(true)
  })

  it('refuses a results array that does not align with the cues', () => {
    const result = assertAckShape({
      nonce: 1,
      modelDriverId: 'ai.moeru.airi.stage.test',
      results: [],
      handled: true,
    }, 1)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('one outcome per cue')
  })

  it('refuses handled disagreeing with its own outcomes', () => {
    const result = assertAckShape({
      nonce: 1,
      modelDriverId: 'ai.moeru.airi.stage.test',
      results: [{ status: 'rejected', reason: CueRejection.NO_TARGET }],
      handled: true,
    }, 1)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('results.every')
  })

  it('carries NO_TARGET as a settled, unapplied outcome', () => {
    const result = assertAckShape({
      nonce: 7,
      modelDriverId: 'ai.moeru.airi.stage.test',
      results: [{ status: 'rejected', reason: CueRejection.NO_TARGET }],
      handled: false,
    }, 1)
    expect(result.ok).toBe(true)
  })

  it('requires the answering driver', () => {
    const result = assertAckShape({
      nonce: 1,
      results: [{ status: 'resolved', value: { kind: CueKind.ACT } }],
      handled: true,
    }, 1)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('modelDriverId')
  })
})

describe('validateWithdrawalRequest', () => {
  it('accepts every request kind with a well-formed target', () => {
    for (const kind of [CueWithdrawalKind.CANCEL, CueWithdrawalKind.ABORT, CueWithdrawalKind.ABORT_CURRENT, CueWithdrawalKind.DUMP]) {
      expect(validateWithdrawalRequest({ kind, modelDriverId: 'd', nonces: [1] }).ok, kind).toBe(true)
    }
    for (const kind of [CueWithdrawalKind.POP, CueWithdrawalKind.POP_ALL]) {
      expect(validateWithdrawalRequest({ kind, modelDriverId: 'd', address: { surface: 'stage' } }).ok, kind).toBe(true)
    }
  })

  it('refuses naming both target families or neither', () => {
    expect(validateWithdrawalRequest({ kind: CueWithdrawalKind.CANCEL, modelDriverId: 'd' }).ok).toBe(false)
    expect(validateWithdrawalRequest({
      kind: CueWithdrawalKind.CANCEL,
      modelDriverId: 'd',
      nonces: [1],
      address: { surface: 'stage' },
    }).ok).toBe(false)
  })

  it('refuses `pop` naming correlations', () => {
    const result = validateWithdrawalRequest({ kind: CueWithdrawalKind.POP, modelDriverId: 'd', nonces: [1] })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('address')
  })

  it('refuses more correlations than the host bounds', () => {
    const nonces = Array.from({ length: 65 }, (_, index) => index + 1)
    const result = validateWithdrawalRequest({ kind: CueWithdrawalKind.CANCEL, modelDriverId: 'd', nonces })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toContain('64')
  })

  it('refuses an unknown request kind', () => {
    expect(validateWithdrawalRequest({ kind: 'nuke', modelDriverId: 'd', nonces: [1] }).ok).toBe(false)
  })
})

describe('prompt publication', () => {
  const publication = (version: number, text = 'be kind', tokens: string[] = ['joy']) => ({
    modelDriverId: 'd',
    modelId: 'm',
    profileId: 'p',
    text,
    tokens,
    version,
    publishedAt: 1_700_000_000_000 + version,
  })

  it('accepts an empty publication for any driver', () => {
    expect(validatePromptPublication(publication(1, '', [])).ok).toBe(true)
  })

  it('refuses a text without its token list', () => {
    const { tokens: _tokens, ...rest } = publication(1)
    expect(validatePromptPublication(rest).ok).toBe(false)
  })

  it('treats a missing publication on a prompt-capable driver as a fault, never as empty', () => {
    expect(evaluatePromptPublicationState({ promptCapable: true })).toBe(PromptPublicationState.MISSING)
    expect(evaluatePromptPublicationState({
      promptCapable: true,
      current: publication(1, '', []),
    })).toBe(PromptPublicationState.PUBLISHED)
  })

  it('expects nothing from a driver without the prompt capability', () => {
    expect(evaluatePromptPublicationState({ promptCapable: false })).toBe(PromptPublicationState.NONE)
  })

  it('discards a publication that is not strictly newer', () => {
    expect(isPromptPublicationNewer({ version: 2 }, { version: 1 })).toBe(true)
    expect(isPromptPublicationNewer({ version: 1 }, { version: 1 })).toBe(false)
    expect(isPromptPublicationNewer({ version: 1 }, { version: 2 })).toBe(false)
    expect(evaluatePromptPublicationState({
      promptCapable: true,
      current: publication(2),
      incoming: publication(2),
    })).toBe(PromptPublicationState.STALE)
  })
})

describe('readiness', () => {
  it('accepts every declared transition and refuses an undeclared one', () => {
    const states = Object.values(RendererMountReadinessState)

    for (const from of states) {
      for (const to of states) {
        const declared = from === to || READINESS_TRANSITIONS[from].includes(to)
        expect(assertReadinessTransition(from, to).ok, `${from} → ${to}`).toBe(declared)
      }
    }
  })

  it('counts only two states as ready', () => {
    const ready = Object.values(RendererMountReadinessState).filter(isReady)
    expect(ready).toEqual([RendererMountReadinessState.READY_FOR_MODEL, RendererMountReadinessState.MODEL_LOADED])
  })

  it('declares every state in the transition table', () => {
    expect(Object.keys(READINESS_TRANSITIONS).sort()).toEqual(Object.values(RendererMountReadinessState).sort())
    expect(CUE_TRANSACTION_STATE_VALUES.size).toBe(7)
  })
})
