/**
 * Retaining a legacy entry, and handing it back for a revert (D-16, D-9).
 *
 * The port is a memory implementation, so this runs in Node. What it proves: the payload lands in the driver's own
 * storage, a repeat is a no-op rather than a second copy, a conflicting legacy id is refused instead of silently
 * replacing an origin a revert might need, and a restore answers the legacy id plus the bytes — from the imported row
 * when there is one, from the retained copy otherwise.
 */
import type { HostStorageInterface, ModelDriverLegacyHandoverEntry } from '@proj-airi/stage-renderer-sdk'

import { ContractFailureCode, LEGACY_HANDOVER_SCHEMA_VERSION } from '@proj-airi/stage-renderer-sdk'
import { describe, expect, it } from 'vitest'

import {
  listRetainedLegacyEntries,
  migrateLive2DEntry,
  readRetainedLegacyEntry,
  removeRetainedLegacyEntry,
  restoreLive2DLegacyPayload,
  unusedLegacyMembers,
} from './legacy'
import { writeModelBytes } from './storage'

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

const DRIVER = 'ai.moeru.airi.live2d'

function handover(overrides: Partial<ModelDriverLegacyHandoverEntry> = {}): ModelDriverLegacyHandoverEntry {
  return {
    schemaVersion: LEGACY_HANDOVER_SCHEMA_VERSION,
    driverId: DRIVER,
    createdAt: 1_700_000_000_000,
    modelId: 'model_new',
    legacyModelId: 'display-model-7',
    meta: { name: 'Hiyori', tags: ['live2d'] },
    settings: { selectedModelId: 'display-model-7', values: { live2dFollowSpeed: 4 } },
    values: { scale: 1.2 },
    placement: { x: 10, y: -20, scale: 1.5 },
    prompt: 'Be gentle.',
    files: [
      { name: 'Hiyori.zip', mimeType: 'application/zip', bytes: new Uint8Array([80, 75, 3, 4]) },
    ],
    ...overrides,
  }
}

describe('retaining a legacy entry', () => {
  it('writes the entry under its minted model id and reports it retained', async () => {
    const storage = memoryStorage()
    const result = await migrateLive2DEntry(storage, handover())

    expect(result.ok).toBe(true)
    if (!result.ok)
      return
    expect(result.value.retained).toBe(true)
    expect(Object.keys(storage.dump())).toEqual(['legacy/model_new'])

    const retained = await readRetainedLegacyEntry(storage, 'model_new')
    expect(retained?.legacyModelId).toBe('display-model-7')
    expect(retained?.meta.name).toBe('Hiyori')
    expect(retained?.placement).toEqual({ x: 10, y: -20, scale: 1.5 })
    // The bytes are base64 because the storage port JSON-serializes values; the same reason model bytes are.
    expect(retained?.files?.[0].base64).toBe('UEsDBA==')
  })

  it('answers a repeat as the same offer instead of writing a second copy', async () => {
    const storage = memoryStorage()
    await migrateLive2DEntry(storage, handover())
    const first = await readRetainedLegacyEntry(storage, 'model_new')

    const again = await migrateLive2DEntry(storage, handover())
    expect(again.ok).toBe(true)
    const second = await readRetainedLegacyEntry(storage, 'model_new')
    // The retention time is the first write's: a crash replay must not look like a fresh retention.
    expect(second?.retainedAt).toBe(first?.retainedAt)
    expect(Object.keys(storage.dump())).toHaveLength(1)
  })

  it('refuses a second legacy origin for the same model id', async () => {
    const storage = memoryStorage()
    await migrateLive2DEntry(storage, handover())

    const conflict = await migrateLive2DEntry(storage, handover({ legacyModelId: 'display-model-other' }))
    expect(conflict.ok).toBe(false)
    if (conflict.ok)
      return
    expect(conflict.error.code).toBe(ContractFailureCode.MODEL_ID_CONFLICT)
    expect((await readRetainedLegacyEntry(storage, 'model_new'))?.legacyModelId).toBe('display-model-7')
  })

  it('refuses a handover for another driver or another schema', async () => {
    const storage = memoryStorage()

    const otherDriver = await migrateLive2DEntry(storage, handover({ driverId: 'ai.moeru.airi.spine' }))
    expect(otherDriver.ok).toBe(false)
    if (!otherDriver.ok)
      expect(otherDriver.error.code).toBe(ContractFailureCode.UNSUPPORTED_INPUT)

    const otherSchema = await migrateLive2DEntry(storage, handover({ schemaVersion: 99 as typeof LEGACY_HANDOVER_SCHEMA_VERSION }))
    expect(otherSchema.ok).toBe(false)

    expect(Object.keys(storage.dump())).toEqual([])
  })

  it('names the members it will not interpret, so the host keeps them itself', () => {
    expect(unusedLegacyMembers(handover())).toEqual([
      'prompt',
      'settings.values.live2dFollowSpeed',
      'values.scale',
    ])

    const withExtras = unusedLegacyMembers(handover({
      url: 'https://example.test/preset.model3.json',
      outfits: [{ id: 'casual' }],
      assets: [{ key: 'texture', name: 'texture.png', bytes: new Uint8Array([1]) }],
      values: {},
      settings: { values: {} },
    }))
    expect(withExtras).toEqual(['url', 'outfits', 'assets', 'prompt'])
  })

  it('lists and removes retained entries without touching the models themselves', async () => {
    const storage = memoryStorage()
    await migrateLive2DEntry(storage, handover())
    expect(await listRetainedLegacyEntries(storage)).toHaveLength(1)

    await removeRetainedLegacyEntry(storage, 'model_new')
    expect(await listRetainedLegacyEntries(storage)).toHaveLength(0)
  })
})

describe('restoring a legacy entry', () => {
  it('answers the legacy identity and the retained bytes when the model has not been imported', async () => {
    const storage = memoryStorage()
    await migrateLive2DEntry(storage, handover())

    const restored = await restoreLive2DLegacyPayload(storage, 'model_new')
    expect(restored.ok).toBe(true)
    if (!restored.ok)
      return
    expect(restored.value.legacyModelId).toBe('display-model-7')
    expect(restored.value.modelId).toBe('model_new')
    expect(restored.value.meta.name).toBe('Hiyori')
    expect(restored.value.prompt).toBe('Be gentle.')
    expect(restored.value.files?.[0].bytes).toEqual(new Uint8Array([80, 75, 3, 4]))
  })

  it('re-emits from the imported row once the model exists, because that is the live copy', async () => {
    const storage = memoryStorage()
    await migrateLive2DEntry(storage, handover())
    // 'UEsDBA==' decodes to the same four bytes, but from `model/{id}/bytes` rather than the retained payload.
    await writeModelBytes(storage, 'model_new', 'UEsDBA==')

    const restored = await restoreLive2DLegacyPayload(storage, 'model_new')
    expect(restored.ok).toBe(true)
    if (!restored.ok)
      return
    expect(restored.value.files).toHaveLength(1)
    expect(restored.value.files?.[0].name).toBe('display-model-7.zip')
    expect(restored.value.files?.[0].bytes).toEqual(new Uint8Array([80, 75, 3, 4]))
  })

  it('refuses with a readable reason when no legacy origin was retained', async () => {
    const storage = memoryStorage()
    const restored = await restoreLive2DLegacyPayload(storage, 'model_imported_after_cutover')
    expect(restored.ok).toBe(false)
    if (restored.ok)
      return
    expect(restored.error.code).toBe(ContractFailureCode.ASSET_MISSING)
    expect(restored.error.message).toContain('no legacy identity to restore')
  })

  it('keeps the retained entry after a restore, so the model can be migrated again', async () => {
    const storage = memoryStorage()
    await migrateLive2DEntry(storage, handover())
    await restoreLive2DLegacyPayload(storage, 'model_new')
    expect(await readRetainedLegacyEntry(storage, 'model_new')).toBeDefined()
  })
})
