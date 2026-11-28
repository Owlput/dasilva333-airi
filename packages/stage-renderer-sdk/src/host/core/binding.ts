/**
 * The character↔model binding: its shape, and every state it can be in (§4.5, §5.6, D4).
 *
 * Two rules are load-bearing and both are easy to get wrong in a view:
 *
 *   1. **`avatar` absent ≡ `{}`** — both mean "no new-path binding". The empty object is a normal state, so it is
 *      materialized on the next card write, never on read: opening a library must not rewrite every card.
 *   2. **legacy detection keys on the absence of `avatar.modelId`, never on the absence of the object.** A legacy
 *      card that gains `avatar: {}` on its next save would otherwise become indistinguishable from an unbound
 *      migrated card and its cutover would silently stop.
 *
 * This module answers "which of the eight states is this character in, and what may it render" from facts the
 * caller supplies. It reads no card, no store and no record; the embedder assembles the facts. That is what makes
 * the table checkable without a Pinia store, an IndexedDB or a window — and it is the table, verbatim, from §5.6.
 */
import type { CharacterModelBinding, DriverStatus } from '../../contract'
import type { ModelPromptSnapshot } from '../../contract'

import { classifyBindingAvailability, DriverStatus as DriverState, UnavailableModelReason } from '../../contract'

/** One binding as a card carries it: three ids that are required together, plus an optional prompt snapshot. */
export interface AvatarBinding {
  driverId: string
  modelId: string
  profileId: string
  /** A complete portable snapshot of the driver's current publication, text and tokens together (D5). */
  prompt?: ModelPromptSnapshot
}

/** What `extensions.airi.avatar` may have been parsed into. `absent` covers `undefined`, `null` and `{}`. */
export type ParsedAvatar
  = | { kind: 'absent' }
    | { kind: 'bound', binding: AvatarBinding }
    | { kind: 'invalid', reason: string }

/**
 * Whether this card is on the new path.
 *
 * The one predicate the whole migration depends on, so it is a function rather than three `?.` chains in three
 * views: `avatar.modelId`, not "the object is there".
 */
export function hasNewPathBinding(avatar: unknown): boolean {
  return parseAvatar(avatar).kind === 'bound'
}

/**
 * Read `extensions.airi.avatar` without validating the ids against anything.
 *
 * All three ids are required together; a partial object is row 8 of the table — invalid, rejected at load or
 * import — and never silently completed from the frozen `modules.displayModelId`.
 */
export function parseAvatar(avatar: unknown): ParsedAvatar {
  if (avatar === undefined || avatar === null)
    return { kind: 'absent' }

  if (typeof avatar !== 'object' || Array.isArray(avatar))
    return { kind: 'invalid', reason: '`extensions.airi.avatar` must be an object' }

  const record = avatar as Record<string, unknown>
  const keys = ['driverId', 'modelId', 'profileId'] as const
  const present = keys.filter(key => record[key] !== undefined)
  const ids = Object.keys(record).filter(key => key !== 'prompt' && !(keys as readonly string[]).includes(key))

  // `{}` is the empty state; anything with no ids and no known field is treated as absent rather than invalid, so
  // a schema that materializes `avatar: { }` on save cannot make a card unreadable.
  if (present.length === 0) {
    if (ids.length === 0 && record.prompt === undefined)
      return { kind: 'absent' }
    return { kind: 'invalid', reason: 'An avatar binding needs `driverId`, `modelId` and `profileId` together' }
  }

  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string' || value.length === 0) {
      return {
        kind: 'invalid',
        reason: present.length < keys.length
          ? `An avatar binding is incomplete: \`${key}\` is missing; all three ids are required together`
          : `\`${key}\` must be a non-empty string`,
      }
    }
  }

  return {
    kind: 'bound',
    binding: {
      driverId: record.driverId as string,
      modelId: record.modelId as string,
      profileId: record.profileId as string,
      ...(record.prompt !== undefined ? { prompt: record.prompt as ModelPromptSnapshot } : {}),
    },
  }
}

/** The eight states of §5.6, in the table's order. */
export enum AvatarState {
  /** Row 1: no model was ever chosen. Renders nothing, offers "choose a model". */
  UNBOUND = 'unbound',
  /** Row 2: still on the legacy path, pre-cutoff. Renders the legacy model, offers "migrate". */
  LEGACY = 'legacy',
  /** Row 3: the legacy renderer is gone. The model is unavailable; the character is fine. */
  LEGACY_UNAVAILABLE = 'legacy-unavailable',
  /** Row 4: bound, normal. */
  BOUND = 'bound',
  /** Row 5: the model record is absent. Not an error. */
  MODEL_MISSING = 'model-missing',
  /** Row 6: the driver is disabled or absent. Not an error. */
  DRIVER_MISSING = 'driver-missing',
  /** Row 7: the profile is absent — the one internally inconsistent binding. An error. */
  PROFILE_MISSING = 'profile-missing',
  /** Row 8: some but not all of the three ids. Rejected at load or import. */
  INVALID = 'invalid',
}

/** What the character's view should offer, per state. */
export enum AvatarAction {
  CHOOSE_MODEL = 'choose-model',
  MIGRATE = 'migrate',
  MIGRATE_NOW = 'migrate-now',
  MODEL_CONTROLS = 'model-controls',
  IMPORT_MODEL = 'import-model',
  ENABLE_DRIVER = 'enable-driver',
  CHOOSE_PROFILE = 'choose-profile',
  REBIND = 'rebind',
}

export interface AvatarStateInput {
  /** `extensions.airi.avatar`, raw: absent, `{}` and a partial object are all legal inputs. */
  avatar?: unknown
  /** The frozen `extensions.airi.modules.displayModelId`, if any. */
  legacyDisplayModelId?: string
  /**
   * Whether this build still has the legacy renderer for that format.
   *
   * `true` before a format's cutoff (row 2), `false` after it (row 3). The host knows this; a card does not.
   */
  legacyRendererAvailable: boolean
  /** The driver status, or `'absent'` when no manifest is registered for the binding's driver. */
  driver: DriverStatus | 'absent'
  /** AIRI holds a `HostNamedModelRecord` for `avatar.modelId`. */
  modelRecordPresent: boolean
  /** AIRI holds a `HostModelProfileRecord` for `avatar.profileId`. */
  profileRecordPresent: boolean
  /** The mount reported a failure while rendering this binding. */
  runtimeFailed?: boolean
}

export interface AvatarStateResult {
  state: AvatarState
  /** The four columns §5.6 spells out, in one value, so no view has to re-derive them. */
  renders: boolean
  /** Whether the view should present this as an error rather than a normal state. */
  error: boolean
  action: AvatarAction
  /** The parsed binding, when there is one; absent for rows 1–3. */
  binding?: AvatarBinding
  /** Why the model is unavailable, for rows 5–7. Never adds a state of its own. */
  reason?: UnavailableModelReason
}

/**
 * Classify one character against §5.6.
 *
 * Rules that follow from the table and are enforced here rather than in each view:
 *
 *   - a missing model is not an error; a missing profile is (row 7) — losing a referent is normal, an internally
 *     inconsistent binding is not;
 *   - avatar and prompt are independent: rows 1–3 never suppress a prompt and a prompt conflict never suppresses
 *     an avatar (the prompt is not an input to this function at all);
 *   - an invalid binding renders nothing and is an error, before any record is consulted.
 */
export function resolveAvatarState(input: AvatarStateInput): AvatarStateResult {
  const parsed = parseAvatar(input.avatar)

  if (parsed.kind === 'invalid') {
    return { state: AvatarState.INVALID, renders: false, error: true, action: AvatarAction.REBIND }
  }

  if (parsed.kind === 'absent') {
    if (!input.legacyDisplayModelId)
      return { state: AvatarState.UNBOUND, renders: false, error: false, action: AvatarAction.CHOOSE_MODEL }

    return input.legacyRendererAvailable
      ? { state: AvatarState.LEGACY, renders: true, error: false, action: AvatarAction.MIGRATE }
      : { state: AvatarState.LEGACY_UNAVAILABLE, renders: false, error: false, action: AvatarAction.MIGRATE_NOW }
  }

  const availability = classifyBindingAvailability({
    driver: input.driver,
    modelRecordPresent: input.modelRecordPresent,
    profileRecordPresent: input.profileRecordPresent,
    ...(input.runtimeFailed !== undefined ? { runtimeFailed: input.runtimeFailed } : {}),
  })

  if (availability.available) {
    return {
      state: AvatarState.BOUND,
      renders: true,
      error: false,
      action: AvatarAction.MODEL_CONTROLS,
      binding: parsed.binding,
    }
  }

  switch (availability.reason) {
    case UnavailableModelReason.DRIVER_UNKNOWN:
    case UnavailableModelReason.DRIVER_DISABLED:
    case UnavailableModelReason.DRIVER_ERROR:
      return {
        state: AvatarState.DRIVER_MISSING,
        renders: false,
        error: false,
        action: AvatarAction.ENABLE_DRIVER,
        binding: parsed.binding,
        reason: availability.reason,
      }
    case UnavailableModelReason.RUNTIME_ERROR:
      // A mount that failed is the driver's runtime problem, not a missing referent; the action stays the
      // model controls so the user can retry rather than re-bind.
      return {
        state: AvatarState.BOUND,
        renders: false,
        error: false,
        action: AvatarAction.MODEL_CONTROLS,
        binding: parsed.binding,
        reason: availability.reason,
      }
    case UnavailableModelReason.PROFILE_MISSING:
      return {
        state: AvatarState.PROFILE_MISSING,
        renders: false,
        error: true,
        action: AvatarAction.CHOOSE_PROFILE,
        binding: parsed.binding,
        reason: availability.reason,
      }
    case UnavailableModelReason.MODEL_MISSING:
    default:
      return {
        state: AvatarState.MODEL_MISSING,
        renders: false,
        error: false,
        action: AvatarAction.IMPORT_MODEL,
        binding: parsed.binding,
        reason: UnavailableModelReason.MODEL_MISSING,
      }
  }
}

/** The avatar object a card write produces for a chosen model. */
export function writeAvatarBinding(binding: AvatarBinding): AvatarBinding {
  return {
    driverId: binding.driverId,
    modelId: binding.modelId,
    profileId: binding.profileId,
    ...(binding.prompt ? { prompt: binding.prompt } : {}),
  }
}

/**
 * The avatar object a revert transaction writes.
 *
 * Deliberately `{}` and not `undefined`: the revert clears the new-path binding while keeping the field present,
 * so the card's shape does not depend on which path it was last written by.
 */
export function clearAvatarBinding(): Record<string, never> {
  return {}
}

/** Project a binding into the record AIRI stores when it binds a character, stamping the host clock. */
export function toCharacterModelBinding(binding: AvatarBinding, at: number): CharacterModelBinding {
  return {
    modelDriverId: binding.driverId,
    modelId: binding.modelId,
    profileId: binding.profileId,
    boundAt: at,
  }
}

/**
 * The driver status for a binding, from the host's driver list.
 *
 * A binding that names a driver no manifest registered is `'absent'`; that is the difference between "turn it
 * back on" and "install it", and §5.6 rows 6 and 5 are the same row otherwise.
 */
export function driverStatusOf(
  drivers: ReadonlyArray<{ driverId: string, status: DriverStatus }>,
  driverId: string,
): DriverStatus | 'absent' {
  const found = drivers.find(driver => driver.driverId === driverId)
  if (!found)
    return 'absent'
  return found.status === DriverState.NOT_INSTALLED ? 'absent' : found.status
}
