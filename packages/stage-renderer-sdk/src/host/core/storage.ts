/**
 * The in-memory storage backend used by the tests and the harness.
 *
 * The host core no longer defines its own storage shape. The primitive (`WindowStorage`: get, set, remove, a
 * prefix scan) lives in the contract package, because the renderer adapter composes driver namespaces from it and
 * the host core reads its records from the same object — one shape, one place. What stays here is the map
 * implementation, which is only ever a test backend.
 *
 * It clones on read on purpose: a port is a boundary, so reading must not hand out a reference into storage, or a
 * caller that mutates a record would silently change what is persisted without a `set`. A real backend does that
 * implicitly; this one says so explicitly.
 */
import type { WindowStorage } from '../storage'

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function')
    return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

/** An in-memory port: the test backend, and the fallback for a host with no persistence. */
export function createMemoryStoragePort(initial: Record<string, unknown> = {}): WindowStorage {
  const map = new Map<string, unknown>(Object.entries(initial))

  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      if (!map.has(key))
        return undefined
      return cloneValue(map.get(key) as T)
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, cloneValue(value))
    },
    async remove(key: string): Promise<void> {
      map.delete(key)
    },
    async keys(prefix = ''): Promise<string[]> {
      return [...map.keys()].filter(key => key.startsWith(prefix)).sort()
    },
  }
}
