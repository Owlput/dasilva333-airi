/**
 * The prompt service: publication, reconciliation and arbitration over the prompt store (§5.4, D5, P1-D26).
 *
 * The store (`./prompts.ts`) answers "what does AIRI hold". This module answers the three questions that need
 * both AIRI's copy and the character card:
 *
 *   1. **what may prompt assembly inject** — the store, and only the store. Assembly never reads
 *      `avatar.prompt`, because prompt assembly must not mutate character data and a card can be behind;
 *   2. **what happens at activation** — a card-only snapshot seeds the store (text *and* tokens, one version)
 *      and is handed back to the driver so its own history continues from that version; a store that is
 *      newer wins; a card that is newer, or that disagrees at the same version, is a conflict;
 *   3. **what an arbitration does** — the user picks a copy, the host writes it with
 *      `max(all versions seen) + 1` (the one version the host mints, P1-D26) and hands that pair back to the
 *      driver so the driver's record of the prompt agrees with AIRI's.
 *
 * **Two homes, one authority.** The driver owns the prompt and its version history; AIRI keeps the current
 * publication and the card's portable snapshot. AIRI keeps no archive: a losing copy of an arbitration stays in
 * the driver's own history, which is why the resolution is *delivered* rather than stored here.
 *
 * Everything in this file is pure over the store port and the snapshot it is handed: no Vue, no card, no
 * storage layout. The character card is the embedder's, which is what keeps this testable in Node.
 */
import type {
  ContractResult,
  ModelDriverId,
  ModelPromptPublication,
  ModelPromptSnapshot,
} from '../../contract'

import { PromptPublicationState, validatePromptPublication } from '../../validate'

/** Which three ids a prompt belongs to. The same triple a binding carries, minus the prompt itself. */
export interface PromptBinding {
  modelDriverId: ModelDriverId
  modelId: string
  profileId: string
}

/**
 * What reconciliation found, one row per case of §5.4's table.
 *
 * The names are the table's, not the code's: a reader checking the implementation against the plan should not
 * have to translate.
 */
export enum PromptReconciliation {
  /** Nothing anywhere. A fault if the driver is prompt-capable and has been activated (D5). */
  NONE = 'none',
  /** The card was the only copy: it was written into the store and handed back to the driver. */
  SEEDED = 'seeded',
  /** The store's copy is the one to inject — because the card is absent, behind, or in agreement. */
  STORE = 'store',
  /** The card holds a copy of a different binding; it is never injected. */
  FOREIGN = 'foreign',
  /** The card is newer, or both claim the same version with different content. The user decides. */
  CONFLICT = 'conflict',
}

/** Both copies of a conflict, as the arbitration surface shows them. */
export interface PromptConflict {
  /** The copy AIRI holds, when there is one. */
  device?: ModelPromptPublication
  /** The copy the card carries. */
  card: ModelPromptSnapshot
}

export interface PromptReconciliationResult {
  outcome: PromptReconciliation
  /** The pair prompt assembly may inject. Absent when nothing is injected, which includes a conflict. */
  publication?: ModelPromptPublication
  /** Present only for `CONFLICT`. */
  conflict?: PromptConflict
  /**
   * Whether the arbitration surface should be *raised* for this conflict.
   *
   * `false` for a pair that was already raised: a driver that republishes on every activation must not turn a
   * standing disagreement into a dialog the user dismisses twice.
   */
  raise?: boolean
}

export type PromptArbitrationWinner = 'device' | 'card'

export interface PromptArbitrationRequest {
  binding: PromptBinding
  /** Which copy the user chose. */
  winner: PromptArbitrationWinner
  /** The card's snapshot, which the caller rewrites with the resolved pair. */
  card: ModelPromptSnapshot
}

export interface PromptArbitrationResult {
  /** The pair now held by the store, and to be written to the card. */
  publication: ModelPromptPublication
  /** The losing copy, handed to the driver so its own history records the decision. */
  loser?: { source: PromptArbitrationWinner, publication: ModelPromptPublication }
}

/**
 * Hand one pair back to the driver that owns it (the host→driver half, D26).
 *
 * Deliberately a port: in Electron it is an IPC push addressed to the window running that driver's entry; in
 * an in-process host it is the adapter's handler set. The prompt service decides *what* is handed back, never
 * how it travels.
 */
export interface PromptResolutionDelivery {
  deliver: (driverId: ModelDriverId, publication: ModelPromptPublication) => void | Promise<void>
}

export interface HostPromptServiceOptions {
  /** The current-publication store, over the window's primitives. */
  store: PromptStoreLike
  /** Where a seeded or arbitrated pair is handed back to the driver. Absent = nowhere to deliver it. */
  resolution?: PromptResolutionDelivery
}

/**
 * The subset of `PromptStore` this service needs.
 *
 * Written as an interface rather than importing the concrete type so a card-only test can supply a map, and so
 * the dependency is legible: this service reads and writes the current publication, and nothing else.
 */
export interface PromptStoreLike {
  publish: (publication: ModelPromptPublication) => Promise<ContractResult<{ state: PromptPublicationState, current?: ModelPromptPublication }>>
  get: (driverId: string, modelId: string, profileId: string) => Promise<ModelPromptPublication | undefined>
}

export interface HostPromptService {
  /** Store one publication. Staleness is the store's rule, not a failure. */
  publish: (publication: ModelPromptPublication) => Promise<ContractResult<PromptPublicationState>>
  /**
   * Reconcile the card's snapshot against the store at activation (§5.4).
   *
   * This is the only place the two copies are compared. Import and restore merely *cause* divergence, because
   * a backup already carries the store and a bare card carries only its own snapshot.
   */
  reconcile: (input: { binding: PromptBinding, snapshot?: ModelPromptSnapshot }) => Promise<PromptReconciliationResult>
  /**
   * What prompt assembly may inject for one binding, or `undefined` when it must inject none.
   *
   * Reads the store, never the card: a stale card cannot leak into a prompt. The card's snapshot is passed only
   * so a standing **conflict** can suppress injection — §5.4 says no model prompt is injected for that binding
   * while the disagreement stands, and the flag is derived rather than stored so a conflict cannot go stale.
   *
   * It seeds nothing. Seeding is activation's job (`reconcile`), because assembly must not mutate character data.
   */
  injectable: (input: { binding: PromptBinding, snapshot?: ModelPromptSnapshot }) => Promise<ModelPromptPublication | undefined>
  /**
   * Resolve a conflict the user arbitrated.
   *
   * Writes `max(device.version, card.version) + 1` — the only version AIRI ever mints — stores it, and hands it
   * to the driver through the resolution port. Returns the winning pair for the caller to write to the card in
   * the same transaction.
   */
  arbitrate: (request: PromptArbitrationRequest) => Promise<ContractResult<PromptArbitrationResult>>
  /** The publication state of one binding, for the driver panel's fault surface (D5). */
  stateFor: (binding: PromptBinding & { promptCapable: boolean }) => Promise<PromptPublicationState>
}

export function createHostPromptService(options: HostPromptServiceOptions): HostPromptService {
  const { store, resolution } = options

  /**
   * Distinct version pairs already raised.
   *
   * In-memory on purpose: "raised once" is a property of one session's UI, and persisting it would let a conflict
   * stay silent forever after a user dismissed it once on another device.
   */
  const raisedConflicts = new Set<string>()

  const deliver = async (publication: ModelPromptPublication): Promise<void> => {
    if (!resolution)
      return
    try {
      await resolution.deliver(publication.modelDriverId, publication)
    }
    catch {
      // Delivering is the driver's bookkeeping, never the host's decision: the store and the card are already
      // written, and a window that cannot record the pair has nothing the user can act on.
    }
  }

  const service: HostPromptService = {
    async publish(publication) {
      const stored = await store.publish(publication)
      if (!stored.ok)
        return stored
      return { ok: true, value: stored.value.state }
    },

    async reconcile({ binding, snapshot }) {
      const device = await store.get(binding.modelDriverId, binding.modelId, binding.profileId)
      const pair = classifyPromptPair({ binding, device, snapshot })

      switch (pair.kind) {
        // Row 1 and rows 2/3's prompt half: no card copy at all. Whatever the store holds is what is injected, and
        // an absent store is `NONE`, which is a fault only while the driver is prompt-capable and activated.
        case 'none':
          return { outcome: PromptReconciliation.NONE }
        case 'store':
          return { outcome: PromptReconciliation.STORE, publication: pair.device }
        // Row 6: the snapshot belongs to another binding. Never seeded over the right copy.
        case 'foreign':
          return { outcome: PromptReconciliation.FOREIGN }
        // Row 3 of the table: the card is the only copy. Seeding keeps the text and tokens together, and hands the
        // pair back so the driver's next publication is strictly newer than it instead of being discarded.
        case 'card-only': {
          const stored = await store.publish(pair.publication)
          if (!stored.ok)
            return { outcome: PromptReconciliation.NONE }
          const publication = stored.value.current ?? pair.publication
          await deliver(publication)
          return { outcome: PromptReconciliation.SEEDED, publication }
        }
        // The two remaining cases — a card strictly newer, or the same version with different content — are a
        // disagreement only the user can settle (§5.4). Nothing is injected while it stands, and it is raised once
        // per distinct version pair so a driver that republishes on every activation does not nag.
        case 'conflict': {
          const key = `${binding.modelDriverId}\u0000${binding.modelId}\u0000${binding.profileId}\u0000${pair.device.version}\u0000${pair.card.version}`
          const raise = !raisedConflicts.has(key)
          raisedConflicts.add(key)
          return {
            outcome: PromptReconciliation.CONFLICT,
            conflict: { device: pair.device, card: pair.card },
            raise,
          }
        }
      }
    },

    async injectable({ binding, snapshot }) {
      const device = await store.get(binding.modelDriverId, binding.modelId, binding.profileId)
      const pair = classifyPromptPair({ binding, device, snapshot })
      // Only a store copy is injected: a card-only pair waits for activation to seed it, and a conflict injects
      // nothing at all.
      return pair.kind === 'store' ? pair.device : undefined
    },

    async arbitrate({ binding, winner, card }) {
      const device = await store.get(binding.modelDriverId, binding.modelId, binding.profileId)

      // One version strictly above every copy the user was shown, so neither side can supersede the decision by
      // publishing a cached pair afterwards (P1-D26).
      const version = Math.max(device?.version ?? 0, card.version) + 1
      const winningContent = winner === 'card'
        ? { text: card.text, tokens: card.tokens }
        : device
          ? { text: device.text, tokens: device.tokens }
          : { text: card.text, tokens: card.tokens }

      const publication: ModelPromptPublication = {
        modelDriverId: binding.modelDriverId,
        modelId: binding.modelId,
        profileId: binding.profileId,
        text: winningContent.text,
        tokens: [...winningContent.tokens],
        version,
        publishedAt: Date.now(),
      }

      const validated = validatePromptPublication(publication)
      if (!validated.ok)
        return validated

      const stored = await store.publish(publication)
      if (!stored.ok)
        return stored

      await deliver(publication)

      // The losing copy is reported, not archived: AIRI keeps no history, so the caller may show it and the driver
      // records it through the resolution delivery (P1-D26).
      const loser = winner === 'card'
        ? (device ? { source: 'device' as const, publication: device } : undefined)
        : { source: 'card' as const, publication: toPublication(binding, card) }

      return {
        ok: true,
        value: {
          publication,
          ...(loser ? { loser } : {}),
        },
      }
    },

    stateFor({ modelDriverId, modelId, profileId, promptCapable }) {
      return store.get(modelDriverId, modelId, profileId).then(current => current
        ? PromptPublicationState.PUBLISHED
        : (promptCapable ? PromptPublicationState.MISSING : PromptPublicationState.NONE))
    },
  }

  return service
}

function sameContent(left: Pick<ModelPromptSnapshot, 'text' | 'tokens'>, right: Pick<ModelPromptSnapshot, 'text' | 'tokens'>): boolean {
  if (left.text !== right.text)
    return false
  if (left.tokens.length !== right.tokens.length)
    return false
  return left.tokens.every((token, index) => token === right.tokens[index])
}

/**
 * Which of §5.4's rows a `(binding, card snapshot, store copy)` triple is, without acting on it.
 *
 * Split out so assembly (`injectable`) and activation (`reconcile`) cannot drift: one function decides, one seeds,
 * the other injects. The table's six rows are the six cases below, in order.
 */
export type PromptPair
  = | { kind: 'none' }
    | { kind: 'store', device: ModelPromptPublication }
    | { kind: 'foreign' }
    | { kind: 'card-only', publication: ModelPromptPublication }
    | { kind: 'conflict', device: ModelPromptPublication, card: ModelPromptSnapshot }

export function classifyPromptPair(input: {
  binding: PromptBinding
  device?: ModelPromptPublication
  snapshot?: ModelPromptSnapshot
}): PromptPair {
  const { binding, device, snapshot } = input

  if (!snapshot)
    return device ? { kind: 'store', device } : { kind: 'none' }

  if (snapshot.modelId !== binding.modelId || snapshot.profileId !== binding.profileId)
    return { kind: 'foreign' }

  if (!device) {
    return {
      kind: 'card-only',
      publication: {
        modelDriverId: binding.modelDriverId,
        modelId: binding.modelId,
        profileId: binding.profileId,
        text: snapshot.text,
        tokens: [...snapshot.tokens],
        version: snapshot.version,
        publishedAt: snapshot.publishedAt,
      },
    }
  }

  // An identical pair at any version is an agreement, not a disagreement.
  if (sameContent(device, snapshot))
    return { kind: 'store', device }

  // The store is strictly newer: the card is merely behind.
  if (device.version > snapshot.version)
    return { kind: 'store', device }

  // A card at or above the store's version with different content: the user decides.
  return { kind: 'conflict', device, card: snapshot }
}

function toPublication(binding: PromptBinding, snapshot: ModelPromptSnapshot): ModelPromptPublication {
  return {
    modelDriverId: binding.modelDriverId,
    modelId: binding.modelId,
    profileId: binding.profileId,
    text: snapshot.text,
    tokens: [...snapshot.tokens],
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
  }
}
