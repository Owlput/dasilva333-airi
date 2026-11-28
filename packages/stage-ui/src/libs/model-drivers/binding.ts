/**
 * The character-card half of the model-driver binding (§4.5, §5.6, D4).
 *
 * The SDK carries the *table* — eight states, what each renders and what it offers — and this module is the one
 * place that reads and writes it on an actual card. Three rules are enforced here rather than in each view:
 *
 *   1. `avatar` absent ≡ `{}` ≡ "no new-path binding". Nothing materializes the empty object on read.
 *   2. **Nothing here writes `extensions.airi.modules.displayModelId`.** It is frozen at cutover and only the
 *      revert transaction writes it afterwards (D10); a helper that took a card and returned one with the frozen
 *      field changed would be the exact bug the guard forbids.
 *   3. A write merges into the existing extension, so an unrelated field (`outfits`, `acting`, a future one) is
 *      never dropped by a rebind.
 *
 * The functions are pure: a card in, a new card out. That is what lets the binding write join a single IndexedDB
 * transaction at cutover (§6.5 step 5) without a store having to orchestrate two writes.
 */
import type { ModelPromptSnapshot } from '@proj-airi/stage-renderer-sdk'
import type { AvatarBinding, AvatarStateInput, AvatarStateResult } from '@proj-airi/stage-renderer-sdk/host'

import {
  hasNewPathBinding,
  parseAvatar,
  resolveAvatarState,
} from '@proj-airi/stage-renderer-sdk/host'

/** The card fields this module reads: structurally typed so a store's richer card object fits without a cast. */
export interface CardAvatarCarrier {
  extensions?: {
    airi?: {
      avatar?: unknown
      modules?: { displayModelId?: string }
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface CardBindingRead {
  /** The new-path binding, when the card has one. */
  binding?: AvatarBinding
  /** Why the card's `avatar` was rejected, for row 8 of the table. */
  invalid?: string
  /** The frozen legacy id, untouched and still the revert target. */
  legacyDisplayModelId?: string
  /** Whether this card is still on the legacy path (`modules.displayModelId` present, no `avatar.modelId`). */
  legacy: boolean
}

/** Read a card's binding and frozen legacy id without changing anything. */
export function readCardBinding(card: CardAvatarCarrier): CardBindingRead {
  const airi = card.extensions?.airi
  const parsed = parseAvatar(airi?.avatar)
  const legacyDisplayModelId = airi?.modules?.displayModelId

  return {
    ...(parsed.kind === 'bound' ? { binding: parsed.binding } : {}),
    ...(parsed.kind === 'invalid' ? { invalid: parsed.reason } : {}),
    ...(legacyDisplayModelId ? { legacyDisplayModelId } : {}),
    legacy: !hasNewPathBinding(airi?.avatar) && Boolean(legacyDisplayModelId),
  }
}

function withAiriExtension(card: CardAvatarCarrier, patch: Record<string, unknown>): CardAvatarCarrier {
  const extensions = card.extensions ?? {}
  const airi = extensions.airi ?? {}
  return {
    ...card,
    extensions: {
      ...extensions,
      airi: { ...airi, ...patch },
    },
  }
}

/**
 * Write a new-path binding onto a card.
 *
 * `prompt` is optional and, when given, travels as the complete portable snapshot — text and tokens together.
 * Passing none leaves any existing snapshot alone rather than clearing it: a rebind that happens to know no
 * publication yet must not delete authored guidance.
 */
export function withCardBinding(
  card: CardAvatarCarrier,
  binding: AvatarBinding,
  prompt?: ModelPromptSnapshot,
): CardAvatarCarrier {
  // The snapshot survives a rebind that carries none: either side may supply the new pair, and when neither does the
  // card's own copy is kept. It cannot leak into a prompt for the wrong model, because `classifyPromptPair` reads a
  // snapshot of another binding as `foreign` and injects nothing (P2-D4, §5.4 row 6).
  const carried = prompt ?? binding.prompt ?? readCardBinding(card).binding?.prompt
  const avatar: AvatarBinding = {
    driverId: binding.driverId,
    modelId: binding.modelId,
    profileId: binding.profileId,
    ...(carried ? { prompt: carried } : {}),
  }
  return withAiriExtension(card, { avatar })
}

/** Attach or replace only the prompt snapshot, leaving the three ids untouched. */
export function withCardPromptSnapshot(card: CardAvatarCarrier, snapshot: ModelPromptSnapshot): CardAvatarCarrier {
  const read = readCardBinding(card)
  if (!read.binding)
    return card
  return withCardBinding(card, read.binding, snapshot)
}

/**
 * Clear the new-path binding — what a revert writes.
 *
 * `{}` rather than deleting the field, so the card's shape does not depend on which path it was last written by,
 * and `modules.displayModelId` is deliberately still untouched: the revert transaction writes it from the
 * driver's `LegacyRestorePayload` (D9), in the same transaction, not here.
 */
export function withCardBindingCleared(card: CardAvatarCarrier): CardAvatarCarrier {
  return withAiriExtension(card, { avatar: {} })
}

/** Classify a card against §5.6, from facts the caller has already gathered. */
export function resolveCardAvatarState(
  card: CardAvatarCarrier,
  facts: Omit<AvatarStateInput, 'avatar' | 'legacyDisplayModelId'>,
): AvatarStateResult {
  const read = readCardBinding(card)
  return resolveAvatarState({
    avatar: card.extensions?.airi?.avatar,
    ...(read.legacyDisplayModelId ? { legacyDisplayModelId: read.legacyDisplayModelId } : {}),
    ...facts,
  })
}
