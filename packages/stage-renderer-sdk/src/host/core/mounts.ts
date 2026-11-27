/**
 * The live mount registry: descriptors only (§4.1, D1).
 *
 * A multi-window host was missing the centre that answers "which mounts are live, and where" without
 * holding a component reference. This is it. What it is **not**:
 *
 *   - not a record store. There is no persisted mount, no probe result and no web storage here. A mount
 *     exists for the app session and dies with its window;
 *   - not a cue router. A cue names a driver plus a surface/purpose and is delivered through the
 *     manager; `onChanged` is an observer feed, not a delivery path;
 *   - not a place a renderer can register itself. Mount ids are **issued here**, one per registration,
 *     monotonically and never reused — which is what makes `HostRegistryClient.registerMount` the only
 *     way a mount identity comes into existence.
 *
 * Every mutation stamps `updatedAt` from the injected clock, so a descriptor's age is a host fact rather
 * than a renderer's claim.
 */
import type {
  CharacterId,
  ModelDriverId,
  ModelDriverMountRegistry,
  ModelId,
  ModelProfileId,
  MountId,
  RendererMountDescriptor,
  RendererMountPurpose,
  RendererMountQuery,
  RendererMountSurfaceKind,
} from '../../contract'

import { ContractFailureCode, RendererMountReadinessState } from '../../contract'
import { assertReadinessTransition } from '../../validate'

export interface MountRegistrationInput {
  driverId: ModelDriverId
  surface: RendererMountSurfaceKind
  purpose: RendererMountPurpose
  windowId: string
  modelId?: ModelId
  profileId?: ModelProfileId
  characterId?: CharacterId
}

export interface MountRegistryOptions {
  now?: () => number
  /**
   * Refuse an undeclared readiness transition instead of silently dropping it.
   *
   * Default `true`. The contract says a host decides *what to do* about an illegal transition; refusing
   * the write is this implementation's answer, because a descriptor that recorded a state the machine
   * cannot reach would make every later `readiness` reading a lie. A development host surfaces the
   * refusal; a production host may set this to `false`, and the illegal patch is dropped instead.
   */
  strictReadinessTransitions?: boolean
}

export interface LiveMountRegistry extends ModelDriverMountRegistry {
  /**
   * Issue a mount id and record the descriptor.
   *
   * Unconditional: "is this driver enabled" and "is the app shutting down" are registry facts, so the
   * caller checks those and this method only issues. The name differs from the contract's
   * `registerMount` on purpose — the client-facing method, with its refusal vocabulary, belongs to the
   * host core, and nothing in a renderer can reach this one.
   */
  issue: (input: MountRegistrationInput) => Promise<RendererMountDescriptor>
  /** Every mount of one window, dropped together when the window goes away (§4.4 step 8). */
  unregisterWindow: (windowId: string) => Promise<MountId[]>
  /** The windows that currently own at least one mount. */
  listWindows: () => string[]
  /** Synchronous copy, for a caller inside an event handler. Never mutate the result. */
  snapshot: () => RendererMountDescriptor[]
}

export function createMountRegistry(options: MountRegistryOptions = {}): LiveMountRegistry {
  const now = options.now ?? Date.now
  const strict = options.strictReadinessTransitions ?? true
  const mounts = new Map<MountId, RendererMountDescriptor>()
  const handlers = new Set<(mounts: RendererMountDescriptor[]) => void>()
  let counter = 0

  const snapshot = (): RendererMountDescriptor[] =>
    [...mounts.values()].sort((left, right) => left.mountId.localeCompare(right.mountId))

  const emit = () => {
    const current = snapshot()
    for (const handler of [...handlers]) {
      try {
        handler(current)
      }
      catch {
        // An observer that throws must not stop the others, or one panel would break mount tracking.
      }
    }
  }

  const matches = (mount: RendererMountDescriptor, query: RendererMountQuery): boolean => {
    if (query.surface !== undefined && mount.surface !== query.surface)
      return false
    if (query.purpose !== undefined && mount.purpose !== query.purpose)
      return false
    if (query.windowId !== undefined && mount.windowId !== query.windowId)
      return false
    if (query.modelId !== undefined && mount.modelId !== query.modelId)
      return false
    if (query.modelDriverId !== undefined && mount.modelDriverId !== query.modelDriverId)
      return false
    if (query.characterId !== undefined && mount.characterId !== query.characterId)
      return false
    return true
  }

  return {
    async issue(input) {
      counter += 1
      const descriptor: RendererMountDescriptor = {
        mountId: `mount_${counter}`,
        modelDriverId: input.driverId,
        surface: input.surface,
        purpose: input.purpose,
        windowId: input.windowId,
        readiness: RendererMountReadinessState.UNMOUNTED,
        updatedAt: now(),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        ...(input.characterId ? { characterId: input.characterId } : {}),
      }
      mounts.set(descriptor.mountId, descriptor)
      emit()
      return descriptor
    },

    async update(mountId, patch) {
      const current = mounts.get(mountId)
      if (!current) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.INTERNAL,
            message: `No live mount \`${mountId}\`; a mount id is issued by the registry and dropped when its window goes away`,
          },
        }
      }

      if (patch.readiness !== undefined && patch.readiness !== current.readiness) {
        const allowed = assertReadinessTransition(current.readiness, patch.readiness)
        if (!allowed.ok) {
          if (strict)
            return { ok: false, error: allowed.error }
          // Not strict: drop the illegal patch rather than record a state the machine cannot reach.
          return { ok: true, value: current }
        }
      }

      const next: RendererMountDescriptor = {
        ...current,
        ...patch,
        mountId: current.mountId,
        windowId: current.windowId,
        updatedAt: now(),
      }
      mounts.set(mountId, next)
      emit()
      return { ok: true, value: next }
    },

    async unregister(mountId) {
      if (mounts.delete(mountId))
        emit()
      return { ok: true, value: undefined }
    },

    async list() {
      return snapshot()
    },

    async findBy(query) {
      return snapshot().filter(mount => matches(mount, query))
    },

    onChanged(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },

    async unregisterWindow(windowId) {
      const removed = snapshot().filter(mount => mount.windowId === windowId).map(mount => mount.mountId)
      for (const mountId of removed)
        mounts.delete(mountId)
      if (removed.length > 0)
        emit()
      return removed
    },

    listWindows() {
      return [...new Set(snapshot().map(mount => mount.windowId))]
    },

    snapshot,
  }
}

/** Whether a mount can accept a cue right now: the two ready states, and nothing else. */
export function mountAcceptsCues(mount: RendererMountDescriptor): boolean {
  return mount.readiness === RendererMountReadinessState.READY_FOR_MODEL
    || mount.readiness === RendererMountReadinessState.MODEL_LOADED
}
