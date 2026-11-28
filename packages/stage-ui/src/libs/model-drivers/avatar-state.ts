/**
 * One character's §5.6 state, resolved for a view that has to decide what to render.
 *
 * `resolveAvatarState` is pure and takes **facts the caller gathered**; this composable is the caller for a live
 * card. The two facts that must not come from the card:
 *
 *   - **the driver's status** comes from the host's own list (`hostState`), because a card cannot know whether the
 *     driver it names is installed or was disabled;
 *   - **the model and profile** come from a **row pull**, not from a cached read: a binding is renderable only if the
 *     driver answers for it *now*, and serving a row from a cache written before the model was removed is exactly
 *     row 5 rendered as row 4.
 *
 * A pull is not made when the driver is anything but enabled, so a disabled driver costs one call, not two. A window
 * with no adapter answers `'absent'` rather than "bound, but nothing to mount": it cannot host driver code at all,
 * which is §5.6 row 6, and it keeps the stage from flashing an empty mount while a bootstrap is in flight.
 *
 * Results are keyed by the binding's three ids. Until the facts for the *current* binding arrive, `state` is
 * `undefined`, so a card switch never renders the previous character's verdict for a frame.
 */
import type { ModelDriverAdapter } from '@proj-airi/stage-renderer-sdk'
import type { AvatarStateResult } from '@proj-airi/stage-renderer-sdk/host'
import type { ComputedRef } from 'vue'

import type { CardAvatarCarrier, CardBindingRead } from './binding'

import { DriverStatus } from '@proj-airi/stage-renderer-sdk'
import { driverStatusOf } from '@proj-airi/stage-renderer-sdk/host'
import { computed, ref, shallowRef, watch } from 'vue'

import { readCardBinding, resolveCardAvatarState } from './binding'

/** The facts `resolveAvatarState` needs that a card cannot answer for itself. */
interface CardAvatarFacts {
  driver: DriverStatus | 'absent'
  modelRecordPresent: boolean
  profileRecordPresent: boolean
  /** The host could not be asked, or the driver failed to answer for this binding (§5.6 row 4's reason). */
  runtimeFailed?: boolean
}

const NO_FACTS: CardAvatarFacts = {
  driver: 'absent',
  modelRecordPresent: false,
  profileRecordPresent: false,
}

export interface CardAvatarStateInput {
  /** The character's card; `undefined` while the library is still loading. */
  card: () => CardAvatarCarrier | undefined
  /** This window's adapter, when it has one. */
  adapter: () => ModelDriverAdapter | undefined
  /** Whether this build still renders the card's frozen legacy model (row 2 vs row 3). */
  legacyRendererAvailable: () => boolean
}

export interface CardAvatarState {
  /** What the card says, without judging it. */
  read: ComputedRef<CardBindingRead | undefined>
  /** The §5.6 verdict, or `undefined` until the current binding has been resolved. */
  state: ComputedRef<AvatarStateResult | undefined>
  /** Re-ask the host. Call after an import or a removal, when the rows a binding pointed at may have changed. */
  refresh: () => Promise<void>
}

export function useCardAvatarState(input: CardAvatarStateInput): CardAvatarState {
  const read = computed<CardBindingRead | undefined>(() => {
    const card = input.card()
    return card ? readCardBinding(card) : undefined
  })

  /** Identity of the binding the facts describe; `''` for "no new-path binding". */
  const key = computed(() => {
    const binding = read.value?.binding
    if (!binding)
      return read.value?.invalid ? 'invalid' : ''
    return `${binding.driverId}\u0000${binding.modelId}\u0000${binding.profileId}`
  })

  const facts = shallowRef<CardAvatarFacts>(NO_FACTS)
  const resolvedKey = ref<string>()

  // One counter for the whole composable: a pull that started for the previous card must not write its facts over the
  // current one's, which is the same race a `load` has with a card switch.
  let generation = 0

  async function refresh(): Promise<void> {
    const token = ++generation
    const wanted = key.value
    const binding = read.value?.binding
    const adapter = input.adapter()

    let next: CardAvatarFacts = NO_FACTS
    try {
      if (adapter && binding) {
        const host = await adapter.hostState()
        const driver = driverStatusOf(host.drivers, binding.driverId)

        if (driver === DriverStatus.ENABLED) {
          const pulled = await adapter.pullRows(binding.driverId)
          // A pull that failed says nothing about the model: it says this window could not get an answer. Reporting
          // that as "model missing" would send the user to import a model that may be sitting right there.
          next = {
            driver,
            modelRecordPresent: pulled.ok && (pulled.value ?? []).some(row => row.modelId === binding.modelId),
            profileRecordPresent: pulled.ok
              && (pulled.value ?? []).some(row => row.modelId === binding.modelId && row.profileId === binding.profileId),
            ...(pulled.ok ? {} : { runtimeFailed: true }),
          }
        }
        else {
          next = { ...NO_FACTS, driver }
        }
      }
    }
    catch {
      // The host itself is unreachable from this window (an IPC hop that never answered, a closed channel). The
      // binding is still valid and the card is still readable, so the answer is a failure, not a broken binding.
      next = { ...NO_FACTS, runtimeFailed: true }
    }

    if (token !== generation)
      return
    facts.value = next
    resolvedKey.value = wanted
  }

  watch([key, input.adapter], () => void refresh(), { immediate: true })

  const state = computed<AvatarStateResult | undefined>(() => {
    const current = read.value
    if (!current)
      return undefined
    // The card names a different binding than the one these facts were gathered for: say nothing yet rather than
    // render the previous character's answer.
    if (resolvedKey.value !== key.value)
      return undefined

    const card = input.card()
    if (!card)
      return undefined

    return resolveCardAvatarState(card, {
      legacyRendererAvailable: input.legacyRendererAvailable(),
      driver: facts.value.driver,
      modelRecordPresent: facts.value.modelRecordPresent,
      profileRecordPresent: facts.value.profileRecordPresent,
      ...(facts.value.runtimeFailed ? { runtimeFailed: true } : {}),
    })
  })

  return { read, state, refresh }
}
