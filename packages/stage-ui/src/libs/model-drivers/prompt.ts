/**
 * The prompt's card-facing half: assembly, activation reconciliation and arbitration (§5.4, D5, P1-D26).
 *
 * The rules live in the SDK's `HostPromptService`; this module is the seam a character card crosses:
 *
 *   - **assembly** reads the store and never `avatar.prompt`. A card snapshot is a portable copy, not the
 *     authority, and prompt assembly must not mutate character data — so staleness is repaired at activation or
 *     on a card write, never while building a system prompt;
 *   - **activation** reconciles once: a card-only snapshot seeds the store (text and tokens together), a
 *     store-newer card is refreshed, a card-newer pair becomes a conflict and injects nothing;
 *   - **arbitration** writes `max + 1` to the store, returns the same pair for the card's snapshot, and leaves the
 *     losing copy to the driver, which receives the resolved pair through `HostPromptService.onResolution`.
 *
 * No Pinia, no Vue, no storage layout: a service and a card in, a value out.
 */
import type { ContractResult, ModelPromptPublication } from '@proj-airi/stage-renderer-sdk'
import type {
  HostPromptService,
  PromptArbitrationWinner,
  PromptBinding,
  PromptConflict,
  PromptReconciliation,
} from '@proj-airi/stage-renderer-sdk/host'

import type { CardAvatarCarrier } from './binding'

import { ContractFailureCode } from '@proj-airi/stage-renderer-sdk'
import { PromptReconciliation as Outcome } from '@proj-airi/stage-renderer-sdk/host'

import { readCardBinding, withCardPromptSnapshot } from './binding'

/** What `buildSystemPrompt` injects for a migrated binding, and nothing else. */
export interface ModelPromptAssembly {
  text: string
  tokens: string[]
  version: number
}

/** The binding a prompt belongs to, from a card. `undefined` when the card has no new-path binding. */
export function promptBindingFor(card: CardAvatarCarrier): PromptBinding | undefined {
  const { binding } = readCardBinding(card)
  if (!binding)
    return undefined
  return {
    modelDriverId: binding.driverId,
    modelId: binding.modelId,
    profileId: binding.profileId,
  }
}

/**
 * The pair prompt assembly may inject for this card, or `undefined` when it must inject none.
 *
 * `undefined` covers every reason there is: no binding, nothing published, a standing conflict, or a snapshot
 * that belongs to another binding. Assembly therefore needs one check, not four, and none of them can fall back
 * to the legacy `acting.modelExpressionPrompt` — that switch is per binding and is the store's presence.
 */
export async function resolveModelPromptForCard(input: {
  service: HostPromptService
  card: CardAvatarCarrier
}): Promise<ModelPromptAssembly | undefined> {
  const binding = promptBindingFor(input.card)
  if (!binding)
    return undefined

  const { binding: avatar } = readCardBinding(input.card)
  const snapshot = avatar?.prompt
  const publication = await input.service.injectable({
    binding,
    ...(snapshot ? { snapshot } : {}),
  })
  if (!publication)
    return undefined

  return { text: publication.text, tokens: [...publication.tokens], version: publication.version }
}

export interface CardPromptReconciliation {
  /** The card to persist: rewritten only when the store supplied a newer or seeded pair. */
  card: CardAvatarCarrier
  outcome: PromptReconciliation
  publication?: ModelPromptPublication
  conflict?: PromptConflict
  /** Whether the arbitration surface should be raised for this conflict (once per distinct version pair). */
  raise?: boolean
}

/**
 * Reconcile at activation.
 *
 * Returns a *new* card when the store has a pair the card should carry — seeding or refreshing a stale snapshot —
 * and the original card object otherwise, so a caller can compare by identity and skip a write.
 */
export async function reconcileModelPromptForCard(input: {
  service: HostPromptService
  card: CardAvatarCarrier
}): Promise<CardPromptReconciliation> {
  const binding = promptBindingFor(input.card)
  if (!binding)
    return { card: input.card, outcome: Outcome.NONE }

  const { binding: avatar } = readCardBinding(input.card)
  const snapshot = avatar?.prompt

  const result = await input.service.reconcile({
    binding,
    ...(snapshot ? { snapshot } : {}),
  })

  // Only two outcomes rewrite the card: a seed (the card was the only copy, and now both sides agree) and a store
  // copy that supersedes a stale snapshot. A conflict writes nothing; the user decides.
  const shouldWrite = Boolean(result.publication)
    && (result.outcome === Outcome.SEEDED || result.outcome === Outcome.STORE)

  const card = shouldWrite && result.publication
    ? withCardPromptSnapshot(input.card, toSnapshot(result.publication))
    : input.card

  return {
    card,
    outcome: result.outcome,
    ...(result.publication ? { publication: result.publication } : {}),
    ...(result.conflict ? { conflict: result.conflict } : {}),
    ...(result.raise !== undefined ? { raise: result.raise } : {}),
  }
}

/**
 * Apply the user's choice.
 *
 * The store is written first and the card snapshot is returned for the caller to persist in the same
 * transaction; the resolved pair is delivered to the driver by the service, so this function never talks to a
 * window.
 */
export async function arbitrateModelPromptForCard(input: {
  service: HostPromptService
  card: CardAvatarCarrier
  winner: PromptArbitrationWinner
  /** The conflict both copies came from, as the arbitration surface showed it. */
  conflict: PromptConflict
}): Promise<ContractResult<{ card: CardAvatarCarrier, publication: ModelPromptPublication }>> {
  const binding = promptBindingFor(input.card)
  if (!binding)
    return failure('This character has no model binding, so it has no model prompt to arbitrate')

  const result = await input.service.arbitrate({
    binding,
    winner: input.winner,
    card: input.conflict.card,
  })
  if (!result.ok)
    return result

  return {
    ok: true,
    value: {
      card: withCardPromptSnapshot(input.card, toSnapshot(result.value.publication)),
      publication: result.value.publication,
    },
  }
}

function toSnapshot(publication: ModelPromptPublication) {
  return {
    modelId: publication.modelId,
    profileId: publication.profileId,
    text: publication.text,
    tokens: [...publication.tokens],
    version: publication.version,
    publishedAt: publication.publishedAt,
  }
}

function failure(message: string): { ok: false, error: { code: ContractFailureCode, message: string } } {
  return { ok: false, error: { code: ContractFailureCode.INTERNAL, message } }
}
