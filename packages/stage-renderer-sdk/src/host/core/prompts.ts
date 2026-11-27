/**
 * The prompt store: one atomic `(text, tokens, version)` pair per `(driver, model, profile)` (D5, §4.5).
 *
 * **It is a copy, not the history.** The driver owns its prompt: it mints the version, stores it and tracks
 * every modification (D26). This store holds the *current* publication — the one prompt assembly reads without
 * waiting for a window — and the card holds a portable snapshot of the same pair. Nothing here is a record of
 * what a prompt used to be; a superseded publication is simply replaced, and the losing side of an arbitration
 * stays in the driver's own history rather than in an archive of ours.
 *
 * Three rules, and this file is the whole of them:
 *
 *   1. **one pair.** A publication carries text *and* the ACT token list it was written against, under
 *      one `version`. There is no member for a text without its tokens, so a stale pair cannot be
 *      assembled from two writes;
 *   2. **strictly newer wins, by version, and nothing else.** A publication that is not strictly newer
 *      is discarded — never merged, never compared by `publishedAt`, because a device clock is not an
 *      arbiter of authorship;
 *   3. **an empty publication is a value.** `('', [])` is stored as an entry. "The driver published
 *      nothing for this model/profile" is a different state (`MISSING`, a fault for a prompt-capable
 *      driver) and this store keeps the two apart rather than collapsing them.
 *
 * What this store deliberately does **not** do: reconciliation against a character card, and history. Deciding
 * which of two copies wins at activation is §5.4 (Phase 2), and it needs the card, the user and a conflict
 * surface; keeping the trail of a prompt's versions is the driver's job, because the driver is what authored
 * them.
 */
import type {
  ContractResult,
  ModelPromptPublication,
} from '../../contract'
import type { PromptPublicationState } from '../../validate'
import type { WindowStorage } from '../storage'

import {
  evaluatePromptPublicationState,
  isPromptPublicationNewer,
  PromptPublicationState as PromptState,
  validatePromptPublication,
} from '../../validate'
import { HOST_STORAGE_KEYS } from './keys'

export interface PromptPublishOutcome {
  /** `PUBLISHED` when the publication was stored, `STALE` when it was discarded. */
  state: PromptPublicationState
  /** Whatever the store holds now, which for a stale publication is the copy that beat it. */
  current?: ModelPromptPublication
}

export interface PromptStore {
  /**
   * Publish one pair.
   *
   * Stale is not an error: a driver that republishes a cached pair has done nothing wrong, so this
   * answers `ok: true` with `state: 'stale'` and the copy that is retained. A malformed publication is
   * an error, because the shape is the host's to enforce at the boundary.
   */
  publish: (publication: ModelPromptPublication) => Promise<ContractResult<PromptPublishOutcome>>
  get: (driverId: string, modelId: string, profileId: string) => Promise<ModelPromptPublication | undefined>
  list: () => Promise<ModelPromptPublication[]>
  /**
   * The state of one prompt for one binding.
   *
   * This is what lets the driver panel report a **fault** ("prompt-capable, published nothing") without
   * the host ever pretending an absent publication is an empty one.
   */
  stateFor: (input: {
    driverId: string
    modelId: string
    profileId: string
    promptCapable: boolean
  }) => Promise<PromptPublicationState>
  /** Drop one current publication. Used by a model removal, not by staleness. */
  remove: (driverId: string, modelId: string, profileId: string) => Promise<void>
}

export function createPromptStore(port: WindowStorage): PromptStore {
  const store: PromptStore = {
    async publish(publication) {
      const validated = validatePromptPublication(publication)
      if (!validated.ok)
        return validated
      const incoming = validated.value

      const current = await store.get(incoming.modelDriverId, incoming.modelId, incoming.profileId)
      if (current && !isPromptPublicationNewer(incoming, current)) {
        return {
          ok: true,
          value: { state: PromptState.STALE, current },
        }
      }

      // A superseded copy is simply replaced. The driver owns the history of its own publications (D26), so
      // there is nothing here to lose: this store is the current copy that prompt assembly reads, and the card
      // keeps a portable snapshot of the same pair.
      await port.set(
        HOST_STORAGE_KEYS.prompt(incoming.modelDriverId, incoming.modelId, incoming.profileId),
        incoming,
      )
      return { ok: true, value: { state: PromptState.PUBLISHED, current: incoming } }
    },

    get(driverId, modelId, profileId) {
      return port.get<ModelPromptPublication>(HOST_STORAGE_KEYS.prompt(driverId, modelId, profileId))
    },

    async list() {
      const keys = await port.keys(HOST_STORAGE_KEYS.prompts)
      const values = await Promise.all(keys.map(key => port.get<ModelPromptPublication>(key)))
      return values.filter((value): value is ModelPromptPublication => value !== undefined)
    },

    async stateFor(input) {
      const current = await store.get(input.driverId, input.modelId, input.profileId)
      return evaluatePromptPublicationState({ promptCapable: input.promptCapable, current })
    },

    remove(driverId, modelId, profileId) {
      return port.remove(HOST_STORAGE_KEYS.prompt(driverId, modelId, profileId))
    },
  }

  return store
}
