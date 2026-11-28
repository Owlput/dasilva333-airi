/**
 * One driver's storage namespace: isolation, `keys()`, `watch` and concurrent writes (§4.6, §9.1).
 *
 * Isolation is structural rather than a rule a driver is trusted to follow — the adapter composes the prefix, so
 * a driver never sees a full key and cannot name another driver's. These cases assert that from both ends: the
 * driver's view, and what actually landed in the window's primitives.
 */
import type { WindowStorage } from './storage'

import { describe, expect, it } from 'vitest'

import { createDriverStorage, createDriverStorageHub, driverStorageRoot } from './storage'

const ALPHA = 'ai.moeru.airi.test.storage.alpha'
const BETA = 'ai.moeru.airi.test.storage.beta'

function createRecorder() {
  const map = new Map<string, unknown>()
  const port: WindowStorage = {
    async get<T>(key: string) {
      return map.get(key) as T | undefined
    },
    async set(key, value) {
      map.set(key, value)
    },
    async remove(key) {
      map.delete(key)
    },
    async keys(prefix = '') {
      return [...map.keys()].filter(key => key.startsWith(prefix)).sort()
    },
  }
  return { map, port }
}

describe('driver storage namespaces', () => {
  it('isolates two drivers that use the same relative key', async () => {
    const { port } = createRecorder()
    const alpha = createDriverStorage({ store: port, driverId: ALPHA })
    const beta = createDriverStorage({ store: port, driverId: BETA })

    await alpha.set('settings', { scale: 1.2 })
    await beta.set('settings', { scale: 0.8 })

    expect(await alpha.get('settings')).toEqual({ scale: 1.2 })
    expect(await beta.get('settings')).toEqual({ scale: 0.8 })
  })

  it('scopes keys() to the driver, and strips the prefix from what it returns', async () => {
    const { map, port } = createRecorder()
    const alpha = createDriverStorage({ store: port, driverId: ALPHA })
    const beta = createDriverStorage({ store: port, driverId: BETA })

    await alpha.set('a/one', 1)
    await alpha.set('a/two', 2)
    await beta.set('b/one', 3)

    expect(await alpha.keys()).toEqual(['a/one', 'a/two'])
    expect(await beta.keys()).toEqual(['b/one'])

    // What the primitives hold is the composed path, which is the proof that the driver never named it.
    expect([...map.keys()].sort()).toEqual([
      `${driverStorageRoot(ALPHA)}a/one`,
      `${driverStorageRoot(ALPHA)}a/two`,
      `${driverStorageRoot(BETA)}b/one`,
    ])
  })

  it('normalises a leading slash so a driver cannot escape its namespace by accident', async () => {
    const { map, port } = createRecorder()
    const alpha = createDriverStorage({ store: port, driverId: ALPHA })

    await alpha.set('/settings', true)

    expect(await alpha.get('settings')).toBe(true)
    expect([...map.keys()]).toEqual([`${driverStorageRoot(ALPHA)}settings`])
  })

  it('fans a write out to every handle in the same window, and not to another driver', async () => {
    const { port } = createRecorder()
    const hub = createDriverStorageHub()
    const first = createDriverStorage({ store: port, driverId: ALPHA, hub })
    const second = createDriverStorage({ store: port, driverId: ALPHA, hub })
    const other = createDriverStorage({ store: port, driverId: BETA, hub })

    const seen: Array<unknown> = []
    const seenOther: Array<unknown> = []
    first.watch('theme', value => seen.push(value))
    second.watch('theme', value => seen.push(value))
    other.watch('theme', value => seenOther.push(value))

    await first.set('theme', 'dark')
    await first.remove('theme')

    // A panel and a mount in one window see each other's writes — each of them twice, once per write — and a
    // second driver's namespace hears nothing.
    expect(seen).toEqual(['dark', 'dark', undefined, undefined])
    expect(seenOther).toEqual([])
  })

  it('is last-write-wins for concurrent writes, which is the documented driver responsibility', async () => {
    const { port } = createRecorder()
    const alpha = createDriverStorage({ store: port, driverId: ALPHA })

    await Promise.all([
      alpha.set('counter', 1),
      alpha.set('counter', 2),
      alpha.set('counter', 3),
    ])

    expect(await alpha.get('counter')).toBe(3)
  })

  it('is a no-op watch when the window has no hub', async () => {
    const { port } = createRecorder()
    const alpha = createDriverStorage({ store: port, driverId: ALPHA })

    const unsubscribe = alpha.watch('settings', () => {
      throw new Error('a watch without a hub must not fire')
    })
    await alpha.set('settings', {})
    unsubscribe()
    expect(await alpha.get('settings')).toEqual({})
  })
})
