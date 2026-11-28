/**
 * The stub driver's window half, as this app's provider entry (§4.8).
 *
 * The entry is the SDK's fixture (`startStubProviderEntry`); what is app-specific is the **session registry**.
 * The dev route needs to reach the instance its own window's entry created — the route creates a mount, the entry
 * owns the delivery loop, and both are in this window — so a module-level map is the honest bridge. It cannot leak
 * across windows because this module is instantiated once per renderer bundle, and each window is its own bundle.
 *
 * A real driver never needs the registry: a mount component *is* the owner of its entry's mounts.
 */
import type { DriverEntryStartOptions, DriverProviderEntry, ModelDriverId } from '@proj-airi/stage-renderer-sdk'
import type { StubModel, StubWindowSession } from '@proj-airi/stage-renderer-sdk/testing'

import { registerStubWindowSession, startStubProviderEntry } from '@proj-airi/stage-renderer-sdk/testing'

export type { StubWindowSession } from '@proj-airi/stage-renderer-sdk/testing'

/** The one model the fixture seeds, so a row pull, a load cue and a capture have something to address. */
const DEMO_MODEL: StubModel = {
  modelId: 'model_stub_demo',
  profileId: 'profile_stub_demo',
  name: 'Stub model',
}

const sessions = new Map<ModelDriverId, StubWindowSession>()
const listeners = new Set<(driverId: ModelDriverId) => void>()

/** What the adapter's loader table calls for the stub's provider specifier. */
export function startProviderEntry(options: DriverEntryStartOptions): DriverProviderEntry {
  return startStubProviderEntry({
    ...options,
    models: [DEMO_MODEL],
    onSession(session) {
      sessions.set(options.driverId, session)
      // The fixture's own mount/panel/picker components read the SDK's per-window session registry, which is the
      // only bridge they have to this entry: an SDK module cannot import an app module. Registering in both maps
      // is deliberate — the app's is the route's handle, the SDK's is the components'.
      registerStubWindowSession(session)
      for (const listener of [...listeners])
        listener(options.driverId)
    },
  })
}

/** The session this window's entry created, once it has run. */
export function stubSession(driverId: ModelDriverId): StubWindowSession | undefined {
  return sessions.get(driverId)
}

/** Be told when an entry starts in this window. */
export function onStubSession(handler: (driverId: ModelDriverId) => void): () => void {
  listeners.add(handler)
  return () => {
    listeners.delete(handler)
  }
}

/** Resolve once the entry has been started in this window, or reject when it never is. */
export function whenStubSession(driverId: ModelDriverId, timeoutMs = 10_000): Promise<StubWindowSession> {
  const existing = sessions.get(driverId)
  if (existing)
    return Promise.resolve(existing)

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stop: (() => void) | undefined

    const finish = () => {
      if (timer !== undefined)
        clearTimeout(timer)
      stop?.()
    }

    timer = setTimeout(() => {
      finish()
      reject(new Error(`The stub driver entry did not start in this window within ${timeoutMs}ms`))
    }, timeoutMs)

    stop = onStubSession((started) => {
      if (started !== driverId)
        return
      finish()
      const session = sessions.get(driverId)
      if (session)
        resolve(session)
      else
        reject(new Error(`Stub session for \`${driverId}\` disappeared while waiting for it`))
    })
  })
}
