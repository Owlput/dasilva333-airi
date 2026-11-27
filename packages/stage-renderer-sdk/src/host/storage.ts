/**
 * The storage layers, from a window's primitives down to one driver's namespace.
 *
 * Three layers, and each one only knows the one below it:
 *
 *   1. **the application's primitives** — `WindowStorage`: get, set, remove, a prefix scan. It knows nothing
 *      about drivers, records or layout, which is what lets any other subsystem in the same window reuse it;
 *   2. **the adapter** — `createDriverStorage`: binds one primitives object to one driver id, adds the prefix
 *      on the way in, strips it on the way out, scopes `keys()`, and routes `watch` through a per-window hub.
 *      This is where isolation lives;
 *   3. **the driver** — `HostStorageInterface`: relative keys inside its own namespace, no idea where it is.
 *
 * Isolation is therefore structural rather than a rule a driver is trusted to follow: a driver cannot name
 * another driver's key, because it never sees a composed path. The host core's own records and prompt store do
 * not go through layer 2 — they address the primitives directly with their own prefixes, which is why this file
 * exports both the primitive and the one function that narrows it.
 */
import type { HostStorageInterface, ModelPromptPublication } from '../contract/host-services'
import type { ContractResult, ModelDriverId } from '../contract/shared'

/**
 * A window's storage primitives.
 *
 * Deliberately unaware of drivers, records and layout: the same object can back a driver's namespace, the host's
 * record stores, a panel's scratch data or anything else that lives in one window. `keys(prefix)` is a prefix
 * scan, not a glob — that is all a namespace facade, a backup or an enumeration needs.
 *
 * Values are opaque and structured-cloneable. An implementation that hands out references would let a caller
 * mutate a stored value without a `set`; a real backend clones implicitly, and a test backend must do so
 * explicitly to be honest about it.
 */
export interface WindowStorage {
  get: <T = unknown>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  remove: (key: string) => Promise<void>
  keys: (prefix?: string) => Promise<string[]>
}

/**
 * Where a published prompt goes.
 *
 * The adapter does not store prompts: the store's rules (strictly newer wins, an empty pair is a value, a
 * superseded publication is replaced rather than archived — P1-D26) belong with the records the host owns, and the embedder builds that store from the same
 * primitives. The adapter only reports a refusal.
 */
export interface PromptSink {
  publish: (publication: ModelPromptPublication) => Promise<ContractResult<unknown>>
}

/**
 * In-process fan-out for one driver's storage writes.
 *
 * Deliberately per driver rather than per window: a driver gets one handle per mount, panel, picker and provider
 * instance, all addressing the same namespace, so a write through one handle has to reach the others in this
 * window.
 *
 * A write reaching a *different* window is a transport question this package does not answer: there is no
 * cross-window relay today, so `watch` fans out inside the window that hosts the adapter and nowhere else.
 */
export interface DriverStorageHub {
  subscribe: (driverId: string, key: string, handler: (value: unknown) => void) => () => void
  publish: (driverId: string, key: string, value: unknown) => void
}

export function createDriverStorageHub(): DriverStorageHub {
  const handlers = new Map<string, Set<(value: unknown) => void>>()
  const id = (driverId: string, key: string) => `${driverId}\u0000${key}`

  return {
    subscribe(driverId, key, handler) {
      const bucket = handlers.get(id(driverId, key)) ?? new Set()
      bucket.add(handler)
      handlers.set(id(driverId, key), bucket)
      return () => {
        bucket.delete(handler)
        if (bucket.size === 0)
          handlers.delete(id(driverId, key))
      }
    },
    publish(driverId, key, value) {
      const bucket = handlers.get(id(driverId, key))
      if (!bucket)
        return
      for (const handler of [...bucket]) {
        try {
          handler(value)
        }
        catch {
          // A watcher that throws must not break the write that triggered it, or one buggy panel would make a
          // driver's storage unwritable.
        }
      }
    },
  }
}

/**
 * The prefix one driver's namespace is rooted at.
 *
 * A driver never learns it: it is a physical location, and the facade below adds and strips it. It matches the
 * localforage instance name the same driver's payloads live in, so the two halves of a driver's data are under
 * the same name rather than two unrelated ones.
 */
export function driverStorageRoot(driverId: ModelDriverId): string {
  return `airi-driver-${driverId}/`
}

export interface DriverStorageOptions {
  /** The window's primitives. This is the only thing the facade needs, and it knows nothing about drivers. */
  store: WindowStorage
  driverId: ModelDriverId
  /** Cross-instance write feed for this window. Absent means `watch` is a no-op. */
  hub?: DriverStorageHub
}

/**
 * One driver's view of its own storage (§4.6): its keys, and only its keys.
 *
 * A key the driver passes is a relative path; the root is added on the way in and stripped on the way out, and
 * `keys()` lists only what is below it.
 */
export function createDriverStorage(options: DriverStorageOptions): HostStorageInterface {
  const { driverId, hub, store } = options
  const root = driverStorageRoot(driverId)
  const absolute = (key: string) => `${root}${key.replace(/^\/+/, '')}`
  const relative = (key: string) => key.slice(root.length)

  return {
    get<T>(key: string) {
      return store.get<T>(absolute(key))
    },
    async set<T>(key: string, value: T) {
      await store.set(absolute(key), value)
      hub?.publish(driverId, key, value)
    },
    async remove(key: string) {
      await store.remove(absolute(key))
      hub?.publish(driverId, key, undefined)
    },
    async keys() {
      const keys = await store.keys(root)
      return keys.map(relative).filter(key => key.length > 0)
    },
    watch<T>(key: string, handler: (value: T | undefined) => void) {
      if (!hub)
        return () => {}
      return hub.subscribe(driverId, key, value => handler(value as T | undefined))
    },
  }
}
