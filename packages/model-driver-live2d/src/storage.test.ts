/**
 * Storage layout and binary round-tripping.
 *
 * The base64 encode exists because the host's storage port JSON-serializes values; a test that only stored a string
 * would not prove the bytes survive. These use a memory implementation of the port, so they run in Node.
 */
import type { HostStorageInterface } from '@proj-airi/stage-renderer-sdk'

import type { StoredLive2DModel } from './storage'

import { describe, expect, it } from 'vitest'

import {
  base64ToBytes,
  bytesToBase64,
  listModelRecords,
  purgeAll,
  readModelBytes,
  readModelRecord,
  removeModelRecord,
  writeModelBytes,
  writeModelPreview,
  writeModelRecord,
} from './storage'

function memoryStorage(): HostStorageInterface & { dump: () => Record<string, unknown> } {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(values.get(key) as T | undefined),
    set: async <T>(key: string, value: T) => {
      values.set(key, value)
    },
    remove: (key: string) => {
      values.delete(key)
      return Promise.resolve()
    },
    keys: () => Promise.resolve([...values.keys()]),
    watch: () => () => {},
    dump: () => Object.fromEntries(values),
  }
}

const RECORD: StoredLive2DModel = {
  modelId: 'model_1',
  name: 'Hiyori',
  importedAt: 1,
  byteSize: 3,
  settingsFile: 'Hiyori.model3.json',
  profiles: [{ profileId: 'profile_1', name: 'Default' }],
  expressions: [{ key: 'happy', label: 'Happy' }],
  motions: [{ key: 'Idle#0', group: 'Idle', index: 0 }],
  hitAreas: ['Head'],
}

describe('live2d storage', () => {
  it('round-trips bytes through base64 without corrupting them', () => {
    const bytes = new Uint8Array(70_000)
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = index % 251

    const restored = base64ToBytes(bytesToBase64(bytes))
    expect(restored.length).toBe(bytes.length)
    expect(restored).toEqual(bytes)
  })

  it('lists records but never the nested bytes or profile keys', async () => {
    const storage = memoryStorage()
    await writeModelRecord(storage, RECORD)
    await writeModelBytes(storage, RECORD.modelId, 'AAAA')
    await storage.set(`model/${RECORD.modelId}/profile/profile_1`, { profileId: 'profile_1' })

    const records = await listModelRecords(storage)
    expect(records).toHaveLength(1)
    expect(records[0].modelId).toBe(RECORD.modelId)
    expect(await readModelBytes(storage, RECORD.modelId)).toBe('AAAA')
    expect(Object.keys(storage.dump())).toContain(`model/${RECORD.modelId}/bytes`)
  })

  it('removes a model and everything under it', async () => {
    const storage = memoryStorage()
    await writeModelRecord(storage, RECORD)
    await writeModelBytes(storage, RECORD.modelId, 'AAAA')
    await storage.set(`model/${RECORD.modelId}/profile/profile_1`, { profileId: 'profile_1' })

    await removeModelRecord(storage, RECORD.modelId)
    expect(await readModelRecord(storage, RECORD.modelId)).toBeUndefined()
    expect(await readModelBytes(storage, RECORD.modelId)).toBeUndefined()
    expect(await storage.keys()).toEqual([])
  })

  it('purge deletes every key in the driver namespace', async () => {
    const storage = memoryStorage()
    await writeModelRecord(storage, RECORD)
    await writeModelBytes(storage, RECORD.modelId, 'AAAA')
    await purgeAll(storage)
    expect(await storage.keys()).toEqual([])
  })

  it('attaches a thumbnail to the record without touching anything else', async () => {
    const storage = memoryStorage()
    await writeModelRecord(storage, RECORD)

    const written = await writeModelPreview(storage, RECORD.modelId, 'data:image/webp;base64,AAAA')
    expect(written).toBe(true)

    const record = await readModelRecord(storage, RECORD.modelId)
    expect(record?.preview).toBe('data:image/webp;base64,AAAA')
    expect(record?.name).toBe(RECORD.name)
    expect(record?.expressions).toEqual(RECORD.expressions)
  })

  it('does not create a record for a model that is gone', async () => {
    const storage = memoryStorage()
    const written = await writeModelPreview(storage, 'model_missing', 'data:image/webp;base64,AAAA')
    expect(written).toBe(false)
    expect(await storage.keys()).toEqual([])
  })
})
