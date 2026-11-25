/**
 * Executable checks for the contract's shapes.
 *
 * These exist because the boundary is crossed by code the host did not compile: a driver declares
 * itself in JSON-shaped data before anything of it runs, an ack arrives from another window, and a
 * withdrawal request can be built by a panel. A type is only a claim at that boundary, so every
 * claim the host acts on has a check here, and each check fails with a **readable reason** rather
 * than a bare code — the host presents these to the user, not only to a log.
 *
 * What deliberately does **not** live here: which driver exists, whether a mount is ready, what a
 * card references. Those are host facts, not shapes.
 */
import type {
  CueAck,
  CueEnvelope,
  CueWithdrawalRequest,
} from './contract/cues'
import type { ModelPromptPublication } from './contract/host-services'
import type { ModelDriverCapabilities, ModelDriverManifest } from './contract/manifest'
import type { ContractFailure, ContractResult, ModelDriverContractVersion, RendererMountReadinessState } from './contract/shared'

import { formatContractVersion, isContractCompatible } from './compatibility'
import {
  CUE_WITHDRAWAL_LIMITS,
  CueKind,
  CueRejection,
  CueSource,
  CueTransactionState,
  CueWithdrawalKind,
  GazeMode,
  ResetScope,
} from './contract/cues'
import { CapabilityDiscoveryMode } from './contract/manifest'
import { RendererMountInteractionMode } from './contract/renderer-mount'
import {
  ContractFailureCode,
  isReadinessTransitionAllowed,
  MODEL_DRIVER_CONTRACT_VERSION,
  READINESS_TRANSITIONS,
  RendererMountReadinessState as ReadinessState,
} from './contract/shared'

/** One thing wrong with one value, addressed by a dotted path a person can follow. */
export interface ValidationIssue {
  path: string
  message: string
}

/**
 * Every capability key of this contract revision.
 *
 * Enumerated rather than derived from a sample object, because it *is* the revision's key set: a probe
 * MUST report all of them (RFC §6.4), and a source scan is how the test asserts this list stays in
 * step with the interface.
 */
export const MODEL_DRIVER_CAPABILITY_KEYS = [
  'probe',
  'previewModel',
  'capabilityDiscovery',
  'profiles',
  'prompt',
  'modelTransfer',
  'driverTransfer',
  'panels',
  'deactivate',
  'purge',
  'migration',
  'cues',
  'interactionModes',
  'occupiesPoint',
  'hitTest',
  'stopAll',
  'dispose',
] as const

/** The three capabilities that are a value from an enum rather than a boolean. */
const CAPABILITY_ENUM_KEYS = ['capabilityDiscovery', 'cues', 'interactionModes'] as const

const CUE_KIND_VALUES = new Set<string>(Object.values(CueKind))
const CUE_SOURCE_VALUES = new Set<string>(Object.values(CueSource))
/** Exported so a host can validate a withdrawal report's observed states without restating them. */
export const CUE_TRANSACTION_STATE_VALUES = new Set<string>(Object.values(CueTransactionState))
const CUE_WITHDRAWAL_KIND_VALUES = new Set<string>(Object.values(CueWithdrawalKind))
const CUE_REJECTION_VALUES = new Set<string>(Object.values(CueRejection))
const DISCOVERY_MODE_VALUES = new Set<string>(Object.values(CapabilityDiscoveryMode))
const INTERACTION_MODE_VALUES = new Set<string>(Object.values(RendererMountInteractionMode))
const GAZE_MODE_VALUES = new Set<string>(Object.values(GazeMode))
const RESET_SCOPE_VALUES = new Set<string>(Object.values(ResetScope))
const READINESS_STATE_VALUES = new Set<string>(Object.values(ReadinessState))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function issuesText(headline: string, issues: ValidationIssue[]): string {
  const shown = issues
    .slice(0, 4)
    .map(issue => `${issue.path}: ${issue.message}`)
    .join('; ')
  const more = issues.length > 4 ? `; and ${issues.length - 4} more` : ''
  return `${headline} (${shown}${more})`
}

function failure(code: ContractFailureCode, headline: string, issues: ValidationIssue[]): ContractFailure {
  return { code, message: issuesText(headline, issues), details: { issues } }
}

/** All three of these shape checks fail as one code: the value is not what it claims to be. */
const SHAPE_CODE = ContractFailureCode.INVALID_PACKAGE
/** An ack that does not match the transaction it answers is the driver's own contract violation. */
const ACK_CODE = ContractFailureCode.INTERNAL

/**
 * Validate a declaration, then its compatibility (C14).
 *
 * The order matters: a manifest is checked as data first, so a malformed one is reported as malformed
 * rather than as a version problem, and the version is checked second, so a driver of the right shape
 * built for the wrong revision gets the message that names the revision.
 *
 * The entry set is checked **exhaustively**: `entry.manager` is the only entry point a declaration may
 * name (C15, RFC §6.1). A declaration that also names `provider`, `mount`, `panels` or `picker` is
 * refused, because that is exactly the shape that lets a DOM-free process load renderer code.
 */
export function validateManifest(
  input: unknown,
  options: { hostVersion?: ModelDriverContractVersion } = {},
): ContractResult<ModelDriverManifest> {
  if (!isRecord(input))
    return { ok: false, error: failure(SHAPE_CODE, 'A driver declaration must be an object', [{ path: '$', message: 'got a non-object' }]) }

  const issues: ValidationIssue[] = []

  if (!isNonEmptyString(input.id))
    issues.push({ path: 'id', message: 'must be a non-empty string' })
  if (!isNonEmptyString(input.name))
    issues.push({ path: 'name', message: 'must be a non-empty string' })
  if (!isNonEmptyString(input.driverVersion))
    issues.push({ path: 'driverVersion', message: 'must be a non-empty version string' })
  else if (!/^\d+\.\d+\.\d+/.test(input.driverVersion))
    issues.push({ path: 'driverVersion', message: 'must start with major.minor.patch' })

  const declaredVersion = input.contractVersion
  if (!isRecord(declaredVersion) || !isFiniteNumber(declaredVersion.major) || !isFiniteNumber(declaredVersion.minor)) {
    issues.push({ path: 'contractVersion', message: 'must be `{ major: number, minor: number }`' })
  }

  const requirements = input.requirements
  if (!isRecord(requirements))
    issues.push({ path: 'requirements', message: 'must be an object (it may be empty)' })

  const entry = input.entry
  if (!isRecord(entry)) {
    issues.push({ path: 'entry', message: 'must be an object' })
  }
  else {
    const entryKeys = Object.keys(entry)
    if (!isNonEmptyString(entry.manager))
      issues.push({ path: 'entry.manager', message: 'must be a non-empty module specifier' })
    const extraEntries = entryKeys.filter(key => key !== 'manager')
    if (extraEntries.length > 0) {
      issues.push({
        path: 'entry',
        message: `names ${extraEntries.join(', ')}; \`manager\` is the only entry point a declaration may name (RFC §6.1) — the manager resolves the rest`,
      })
    }
  }

  const capabilities = assertCapabilityCompleteness(input.capabilities)
  if (!capabilities.ok)
    issues.push({ path: 'capabilities', message: capabilities.error.message })

  if (issues.length > 0)
    return { ok: false, error: failure(SHAPE_CODE, 'Invalid driver declaration', issues) }

  // Shape is sound, so the revision is worth naming.
  const declared = declaredVersion as ModelDriverContractVersion
  const host = options.hostVersion ?? MODEL_DRIVER_CONTRACT_VERSION
  const compatibility = isContractCompatible(declared, host)
  if (!compatibility.ok) {
    return {
      ok: false,
      error: {
        ...compatibility.error,
        details: {
          declared: formatContractVersion(declared),
          host: formatContractVersion(host),
        },
      },
    }
  }

  return { ok: true, value: input as unknown as ModelDriverManifest }
}

/**
 * Assert that a probe reports every capability key of this revision, with the right kind of value
 * (C17, RFC §6.4).
 *
 * "Complete" is a MUST, not a nicety: the host decides whether to offer a surface by reading this
 * answer, so a missing key would either be guessed at or silently treated as false. An **unknown**
 * key is refused too — it means the driver was built against a revision this host does not speak, and
 * the honest answer is a version refusal rather than silently ignoring what it said.
 */
export function assertCapabilityCompleteness(input: unknown): ContractResult<ModelDriverCapabilities> {
  if (!isRecord(input))
    return { ok: false, error: failure(SHAPE_CODE, 'Capabilities must be an object', [{ path: 'capabilities', message: 'got a non-object' }]) }

  const issues: ValidationIssue[] = []
  const present = new Set(Object.keys(input))

  for (const key of MODEL_DRIVER_CAPABILITY_KEYS) {
    if (!present.has(key))
      issues.push({ path: `capabilities.${key}`, message: 'is missing; a probe must report every key of the revision' })
  }

  for (const key of Object.keys(input)) {
    if (!(MODEL_DRIVER_CAPABILITY_KEYS as readonly string[]).includes(key))
      issues.push({ path: `capabilities.${key}`, message: 'is not a key of this contract revision' })
  }

  for (const key of MODEL_DRIVER_CAPABILITY_KEYS) {
    if (!present.has(key))
      continue
    const value = input[key]
    if ((CAPABILITY_ENUM_KEYS as readonly string[]).includes(key))
      continue
    if (typeof value !== 'boolean')
      issues.push({ path: `capabilities.${key}`, message: 'must be a boolean' })
  }

  if (present.has('capabilityDiscovery') && (typeof input.capabilityDiscovery !== 'string' || !DISCOVERY_MODE_VALUES.has(input.capabilityDiscovery)))
    issues.push({ path: 'capabilities.capabilityDiscovery', message: `must be one of ${[...DISCOVERY_MODE_VALUES].join(', ')}` })

  if (present.has('cues')) {
    if (!isStringArray(input.cues)) {
      issues.push({ path: 'capabilities.cues', message: 'must be an array of cue kinds' })
    }
    else {
      const unknown = input.cues.filter(kind => !CUE_KIND_VALUES.has(kind))
      if (unknown.length > 0)
        issues.push({ path: 'capabilities.cues', message: `names unknown cue kinds: ${unknown.join(', ')}` })
      if (input.cues.includes(CueKind.LOAD)) {
        issues.push({
          path: 'capabilities.cues',
          message: 'must not list `load`: every mount must handle a load, so declaring it says nothing',
        })
      }
      if (new Set(input.cues).size !== input.cues.length)
        issues.push({ path: 'capabilities.cues', message: 'must not repeat a cue kind' })
      if (input.cues.includes(CueKind.VIEW) && input.capabilityDiscovery === CapabilityDiscoveryMode.NONE) {
        issues.push({
          path: 'capabilities.cues',
          message: 'declares `view` while capability discovery is `none`; a point of interest only exists as a capability descriptor',
        })
      }
    }
  }

  if (present.has('interactionModes')) {
    if (!isStringArray(input.interactionModes)) {
      issues.push({ path: 'capabilities.interactionModes', message: 'must be an array of interaction modes' })
    }
    else {
      const unknown = input.interactionModes.filter(mode => !INTERACTION_MODE_VALUES.has(mode))
      if (unknown.length > 0)
        issues.push({ path: 'capabilities.interactionModes', message: `names unknown modes: ${unknown.join(', ')}` })
    }
  }

  if (issues.length > 0)
    return { ok: false, error: failure(SHAPE_CODE, 'Incomplete or invalid capability record', issues) }

  return { ok: true, value: input as unknown as ModelDriverCapabilities }
}

/**
 * Validate one delivered transaction (C2, C8, C17).
 *
 * Three rules of the transaction itself, beyond each cue's own addressing:
 *
 *   - **capture must be alone.** Its failure is a whole-send error, so a mixed envelope could not
 *     report it honestly and would leave the other cues unapplied for a reason unrelated to them;
 *   - **`persistent: false` cannot carry a load, a reset or a caption.** None of them has a transient
 *     form: a load and a reset have no "try it without saving", and a caption must never be saved as
 *     state at all;
 *   - **the target must be routable.** A driver id and, when present, values from the declared
 *     surface/purpose vocabularies. Nothing addresses a mount.
 */
export function validateCueEnvelope(input: unknown): ContractResult<CueEnvelope> {
  if (!isRecord(input))
    return { ok: false, error: envelopeFailure([{ path: '$', message: 'got a non-object' }]) }

  const issues: ValidationIssue[] = []

  if (!isFiniteNumber(input.nonce))
    issues.push({ path: 'nonce', message: 'must be a finite number minted by the broker' })
  if (!isFiniteNumber(input.at))
    issues.push({ path: 'at', message: 'must be a finite epoch-milliseconds number' })
  if (typeof input.override !== 'boolean')
    issues.push({ path: 'override', message: 'must be a boolean' })
  if (typeof input.source !== 'string' || !CUE_SOURCE_VALUES.has(input.source))
    issues.push({ path: 'source', message: `must be one of ${[...CUE_SOURCE_VALUES].join(', ')}` })
  if (input.persistent !== undefined && typeof input.persistent !== 'boolean')
    issues.push({ path: 'persistent', message: 'must be a boolean when present' })

  const target = input.target
  if (!isRecord(target)) {
    issues.push({ path: 'target', message: 'is required; a transaction with no target is unroutable' })
  }
  else {
    if (!isNonEmptyString(target.modelDriverId))
      issues.push({ path: 'target.modelDriverId', message: 'must be a non-empty driver id' })
    if (target.surface !== undefined && !isNonEmptyString(target.surface))
      issues.push({ path: 'target.surface', message: 'must be a surface label when present' })
    if (target.purpose !== undefined && !isNonEmptyString(target.purpose))
      issues.push({ path: 'target.purpose', message: 'must be a purpose label when present' })
  }

  const cues = input.cues
  if (!Array.isArray(cues) || cues.length === 0) {
    issues.push({ path: 'cues', message: 'must be a non-empty array; a transaction applies at least one cue' })
  }
  else {
    cues.forEach((cue, index) => {
      issues.push(...validateCue(cue, index))
    })

    const kinds = cues
      .filter(isRecord)
      .map(cue => cue.kind)
      .filter((kind): kind is string => typeof kind === 'string')

    if (kinds.includes(CueKind.CAPTURE) && kinds.length > 1) {
      issues.push({
        path: 'cues',
        message: 'capture must be the only cue in its envelope; its failure is a whole-send error',
      })
    }

    if (input.persistent === false) {
      const notTransient = kinds.filter(kind => kind === CueKind.LOAD || kind === CueKind.RESET || kind === CueKind.CAPTION)
      if (notTransient.length > 0) {
        issues.push({
          path: 'persistent',
          message: `cannot be false with ${[...new Set(notTransient)].join(', ')}: it has no transient form`,
        })
      }
    }
  }

  if (issues.length > 0)
    return { ok: false, error: envelopeFailure(issues) }

  return { ok: true, value: input as unknown as CueEnvelope }
}

function validateCue(cue: unknown, index: number): ValidationIssue[] {
  const path = `cues.${index}`
  if (!isRecord(cue))
    return [{ path, message: 'must be an object' }]

  const kind = cue.kind
  if (typeof kind !== 'string' || !CUE_KIND_VALUES.has(kind))
    return [{ path: `${path}.kind`, message: `must be one of ${[...CUE_KIND_VALUES].join(', ')}` }]

  const issues: ValidationIssue[] = []
  const requireString = (field: string) => {
    if (!isNonEmptyString(cue[field]))
      issues.push({ path: `${path}.${field}`, message: 'must be a non-empty string' })
  }
  const requireEnum = (field: string, values: Set<string>) => {
    if (typeof cue[field] !== 'string' || !values.has(cue[field] as string))
      issues.push({ path: `${path}.${field}`, message: `must be one of ${[...values].join(', ')}` })
  }

  switch (kind as CueKind) {
    case CueKind.LOAD:
      requireString('modelId')
      break
    case CueKind.ACT:
      requireString('actToken')
      break
    case CueKind.EXPRESSION:
      requireString('key')
      break
    case CueKind.MOTION:
      requireString('key')
      break
    case CueKind.EFFECT:
      requireString('effect')
      break
    case CueKind.PROFILE:
      requireString('profileId')
      break
    case CueKind.GAZE:
      requireEnum('mode', GAZE_MODE_VALUES)
      if (cue.mode === GazeMode.POINT_OF_INTEREST)
        requireString('pointOfInterestId')
      break
    case CueKind.VIEW:
      requireString('pointOfInterestId')
      break
    case CueKind.CAPTION:
      requireString('text')
      requireString('utteranceId')
      break
    case CueKind.RESET:
      requireEnum('scope', RESET_SCOPE_VALUES)
      break
    case CueKind.CAPTURE:
      break
  }

  return issues
}

/**
 * Assert that an ack answers the transaction it claims to (C5, C17).
 *
 * The two things this catches that are otherwise silent: a **short results array** (which would
 * misalign every later slot against its cue) and a `handled` that disagrees with its own outcomes
 * (which is derived, so a disagreement is always a bug). It also rejects an ack attributed to no
 * driver, because the broker settles the caller's transaction from the driver it names.
 */
export function assertAckShape(input: unknown, expectedSlotCount: number): ContractResult<CueAck> {
  if (!isRecord(input))
    return { ok: false, error: failure(ACK_CODE, 'An acknowledgement must be an object', [{ path: '$', message: 'got a non-object' }]) }

  const issues: ValidationIssue[] = []

  if (!isFiniteNumber(input.nonce))
    issues.push({ path: 'nonce', message: 'must echo the envelope nonce' })
  if (!isNonEmptyString(input.modelDriverId))
    issues.push({ path: 'modelDriverId', message: 'must name the driver that answered' })
  if (input.mountId !== undefined && !isNonEmptyString(input.mountId))
    issues.push({ path: 'mountId', message: 'must be a mount id when present' })
  if (input.message !== undefined && typeof input.message !== 'string')
    issues.push({ path: 'message', message: 'must be a string when present' })
  if (typeof input.handled !== 'boolean')
    issues.push({ path: 'handled', message: 'must be a boolean' })

  const results = input.results
  if (!Array.isArray(results) || results.length !== expectedSlotCount) {
    issues.push({
      path: 'results',
      message: `must contain exactly one outcome per cue (${expectedSlotCount})`,
    })
  }
  else {
    results.forEach((outcome, index) => {
      issues.push(...validateOutcome(outcome, index))
    })

    if (typeof input.handled === 'boolean') {
      const derived = results.every(result => isRecord(result) && result.status === 'resolved')
      if (input.handled !== derived)
        issues.push({ path: 'handled', message: 'must equal `results.every(resolved)`' })
    }
  }

  if (issues.length > 0)
    return { ok: false, error: failure(ACK_CODE, 'Invalid acknowledgement', issues) }

  return { ok: true, value: input as unknown as CueAck }
}

function validateOutcome(outcome: unknown, index: number): ValidationIssue[] {
  const path = `results.${index}`
  if (!isRecord(outcome))
    return [{ path, message: 'must be an object' }]

  if (outcome.status === 'resolved') {
    if (!isRecord(outcome.value) || typeof outcome.value.kind !== 'string' || !CUE_KIND_VALUES.has(outcome.value.kind))
      return [{ path: `${path}.value`, message: 'a resolved outcome must carry a `{ kind }` value' }]
    return []
  }

  if (outcome.status === 'rejected') {
    if (typeof outcome.reason !== 'string' || !CUE_REJECTION_VALUES.has(outcome.reason))
      return [{ path: `${path}.reason`, message: `must be one of ${[...CUE_REJECTION_VALUES].join(', ')}` }]
    return []
  }

  return [{ path: `${path}.status`, message: 'must be `resolved` or `rejected`' }]
}

/**
 * Validate one withdrawal request (C4, RFC §9.7).
 *
 * "One target family, one driver" is the whole rule, and it is checked here rather than left to the
 * broker because a request that names correlations belonging to two drivers, or names none at all, has
 * no correct interpretation — it is malformed, not partially applied.
 *
 * `pop` and `pop-all` select **by receiver**, so they must use `address`; a correlation list would ask
 * for "the newest of these", which is a different question with a confusing answer.
 */
export function validateWithdrawalRequest(input: unknown): ContractResult<CueWithdrawalRequest> {
  if (!isRecord(input))
    return { ok: false, error: envelopeFailureWithPath('$', 'got a non-object') }

  const issues: ValidationIssue[] = []

  if (typeof input.kind !== 'string' || !CUE_WITHDRAWAL_KIND_VALUES.has(input.kind))
    issues.push({ path: 'kind', message: `must be one of ${[...CUE_WITHDRAWAL_KIND_VALUES].join(', ')}` })
  if (!isNonEmptyString(input.modelDriverId))
    issues.push({ path: 'modelDriverId', message: 'must name the one driver this request addresses' })

  const hasNonces = input.nonces !== undefined
  const hasAddress = input.address !== undefined

  if (hasNonces === hasAddress) {
    issues.push({
      path: '$',
      message: 'must name exactly one target: `nonces` or `address`, never both and never neither',
    })
  }

  if (hasNonces) {
    if (!Array.isArray(input.nonces) || input.nonces.length === 0) {
      issues.push({ path: 'nonces', message: 'must be a non-empty array of correlation values' })
    }
    else {
      if (input.nonces.length > CUE_WITHDRAWAL_LIMITS.maxNoncesPerRequest) {
        issues.push({
          path: 'nonces',
          message: `names more than ${CUE_WITHDRAWAL_LIMITS.maxNoncesPerRequest} correlations, which the host does not accept`,
        })
      }
      if (!input.nonces.every(nonce => isFiniteNumber(nonce) && nonce >= 0))
        issues.push({ path: 'nonces', message: 'must all be non-negative finite numbers' })
    }

    if (input.kind === CueWithdrawalKind.POP || input.kind === CueWithdrawalKind.POP_ALL) {
      issues.push({
        path: 'nonces',
        message: `\`${input.kind as string}\` selects by receiver; name an \`address\` instead of correlations`,
      })
    }
  }

  if (hasAddress) {
    const address = input.address
    if (!isRecord(address)) {
      issues.push({ path: 'address', message: 'must be an object' })
    }
    else if (address.surface === undefined && address.purpose === undefined) {
      issues.push({ path: 'address', message: 'must name a surface, a purpose or both' })
    }
    else {
      if (address.surface !== undefined && !isNonEmptyString(address.surface))
        issues.push({ path: 'address.surface', message: 'must be a surface label when present' })
      if (address.purpose !== undefined && !isNonEmptyString(address.purpose))
        issues.push({ path: 'address.purpose', message: 'must be a purpose label when present' })
    }
  }

  if (issues.length > 0)
    return { ok: false, error: envelopeFailure(issues) }

  return { ok: true, value: input as unknown as CueWithdrawalRequest }
}

/**
 * Whether one publication should replace the one held (C7, D5).
 *
 * **Strictly newer, by version, and nothing else.** An equal version with different content is not a
 * newer publication — it is a disagreement, which the host surfaces to the user rather than resolving;
 * an older one is stale and discarded. Comparing `publishedAt` would make a device clock the arbiter,
 * and two devices can disagree about the time without either being wrong.
 */
export function isPromptPublicationNewer(
  incoming: Pick<ModelPromptPublication, 'version'>,
  current: Pick<ModelPromptPublication, 'version'>,
): boolean {
  return incoming.version > current.version
}

/**
 * What state a model/profile's prompt is in.
 *
 * `MISSING` is the one that matters: a driver that declares `capabilities.prompt` and has published
 * nothing for a model it serves is **faulted**, not empty. Keeping the two apart is the whole point —
 * an empty publication (`text: ''`, `tokens: []`) is a deliberate answer and is stored as one, so
 * "nothing published" can be reported as the bug it is (D5, D-17).
 */
export enum PromptPublicationState {
  /** The driver is not prompt-capable: nothing is expected and nothing is missing. */
  NONE = 'none',
  /** A publication is held for this model/profile. An empty one is still a publication. */
  PUBLISHED = 'published',
  /** Prompt-capable, and nothing has been published: a runtime fault, surfaced in the driver panel. */
  MISSING = 'missing',
  /** An incoming publication is not strictly newer than the held one, so it is discarded. */
  STALE = 'stale',
}

export function evaluatePromptPublicationState(input: {
  promptCapable: boolean
  current?: Pick<ModelPromptPublication, 'version'> | null
  incoming?: Pick<ModelPromptPublication, 'version'> | null
}): PromptPublicationState {
  if (!input.promptCapable)
    return PromptPublicationState.NONE

  if (input.incoming) {
    if (input.current && !isPromptPublicationNewer(input.incoming, input.current))
      return PromptPublicationState.STALE
    return PromptPublicationState.PUBLISHED
  }

  return input.current ? PromptPublicationState.PUBLISHED : PromptPublicationState.MISSING
}

/**
 * Validate one published prompt.
 *
 * `text` and `tokens` are both required and both may be empty: "no prompt" is `('', [])`, which is a
 * value, and requiring both keys is what stops a text from ever existing without the list it was
 * written against.
 */
export function validatePromptPublication(input: unknown): ContractResult<ModelPromptPublication> {
  if (!isRecord(input))
    return { ok: false, error: failure(SHAPE_CODE, 'A prompt publication must be an object', [{ path: '$', message: 'got a non-object' }]) }

  const issues: ValidationIssue[] = []

  if (!isNonEmptyString(input.modelDriverId))
    issues.push({ path: 'modelDriverId', message: 'must name the publishing driver' })
  if (!isNonEmptyString(input.modelId))
    issues.push({ path: 'modelId', message: 'must name the model this describes' })
  if (!isNonEmptyString(input.profileId))
    issues.push({ path: 'profileId', message: 'must name the profile this describes' })
  if (typeof input.text !== 'string')
    issues.push({ path: 'text', message: 'must be a string; an empty string is a valid prompt' })
  if (!isStringArray(input.tokens))
    issues.push({ path: 'tokens', message: 'must be an array of token strings; an empty array is valid' })
  if (!isFiniteNumber(input.version) || input.version < 0)
    issues.push({ path: 'version', message: 'must be a non-negative number minted by the driver' })
  if (!isFiniteNumber(input.publishedAt))
    issues.push({ path: 'publishedAt', message: 'must be a finite epoch-milliseconds number' })

  if (issues.length > 0)
    return { ok: false, error: failure(SHAPE_CODE, 'Invalid prompt publication', issues) }

  return { ok: true, value: input as unknown as ModelPromptPublication }
}

/**
 * Walk one readiness report against the declared transitions (C9).
 *
 * A host decides what to *do* about an illegal transition; this only says whether it is legal, so the
 * policy stays out of the contract. A redundant report of the current state is accepted, because an
 * idempotent re-emit says nothing new.
 */
export function assertReadinessTransition(
  from: RendererMountReadinessState,
  to: RendererMountReadinessState,
): ContractResult<RendererMountReadinessState> {
  if (!READINESS_STATE_VALUES.has(from) || !READINESS_STATE_VALUES.has(to)) {
    return { ok: false, error: failure(SHAPE_CODE, 'Unknown readiness state', [{ path: '$', message: `got ${String(from)} → ${String(to)}` }]) }
  }

  if (!isReadinessTransitionAllowed(from, to)) {
    return {
      ok: false,
      error: {
        code: SHAPE_CODE,
        message: `Readiness cannot go from \`${from}\` to \`${to}\`; the declared transitions are in READINESS_TRANSITIONS`,
        details: { from, to, allowed: READINESS_TRANSITIONS[from] },
      },
    }
  }

  return { ok: true, value: to }
}

function envelopeFailure(issues: ValidationIssue[]): ContractFailure {
  return failure(ContractFailureCode.INVALID_ENVELOPE, 'Invalid cue envelope', issues)
}

function envelopeFailureWithPath(path: string, message: string): ContractFailure {
  return envelopeFailure([{ path, message }])
}
