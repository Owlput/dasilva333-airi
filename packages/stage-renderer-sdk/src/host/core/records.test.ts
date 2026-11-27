/**
 * The host's own records: models, profiles, prompts, markers, driver storage, id minting and the backup.
 *
 * Everything here is what AIRI must still know with **no driver installed, no window open and no model
 * mounted** — so these are the assertions that a catalogue, a card chip and the unavailable-model view
 * depend on. The prompt cases are the ones worth reading twice: "nothing published" and "published nothing"
 * are different states, and collapsing them is the bug the store exists to prevent.
 */
import type { HostNamedModelRecord, ModelPromptPublication } from '../../contract'

import { describe, expect, it } from 'vitest'

import { ContractFailureCode } from '../../contract'
import { PromptPublicationState } from '../../validate'
import { createTestHost, unwrap } from '../testing/harness'
import { STUB_DRIVER_ID } from '../testing/stub-driver'
import { classifyHostId, createIdMinter } from './ids'
import { HOST_STORAGE_KEYS } from './keys'
import { buildSearchKey } from './records'
import { createMemoryStoragePort } from './storage'

function model(overrides: Partial<HostNamedModelRecord> = {}): HostNamedModelRecord {
  return {
    modelId: 'model_a',
    displayName: 'Airi',
    importedAt: 1,
    ...overrides,
  }
}

function publication(overrides: Partial<ModelPromptPublication> = {}): ModelPromptPublication {
  return {
    modelDriverId: STUB_DRIVER_ID,
    modelId: 'model_a',
    profileId: 'profile_a',
    text: 'Be kind.',
    tokens: ['happy'],
    version: 1,
    publishedAt: 10,
    ...overrides,
  }
}

describe('host records', () => {
  it('creates a model record once and refuses a duplicate identity', async () => {
    const host = await createTestHost()
    unwrap(await host.core.records.models.create(model()))

    const duplicate = await host.core.records.models.create(model())
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok)
      expect(duplicate.error.code).toBe(ContractFailureCode.MODEL_ID_CONFLICT)

    expect(await host.core.records.models.list()).toHaveLength(1)
  })

  it('derives the search key from the fields a filter matches', async () => {
    const host = await createTestHost()
    const stored = unwrap(await host.core.records.models.create(model({ tags: ['Cute'], nsfw: false })))
    expect(stored.searchKey).toBe('airi cute')
    expect(buildSearchKey({ displayName: '  Airi  ', tags: ['Cute', 'Stage'], groups: ['Airis'] })).toBe('airi cute stage airis')

    // A patch recomputes it, so a caller cannot set the two out of step.
    const patched = await host.core.records.models.patch('model_a', { displayName: 'Renamed' })
    expect(patched?.searchKey).toBe('renamed cute')
  })

  it('keeps profiles under their model and drops them with it', async () => {
    const host = await createTestHost()
    unwrap(await host.core.records.profiles.create({ profileId: 'profile_a', modelId: 'model_a', displayName: 'Default', createdAt: 1 }))
    unwrap(await host.core.records.profiles.create({ profileId: 'profile_b', modelId: 'model_a', displayName: 'Outfit', createdAt: 2 }))
    unwrap(await host.core.records.profiles.create({ profileId: 'profile_c', modelId: 'model_b', displayName: 'Other', createdAt: 3 }))

    expect(await host.core.records.profiles.listForModel('model_a')).toHaveLength(2)
    expect(await host.core.records.profiles.removeForModel('model_a')).toBe(2)
    expect(await host.core.records.profiles.list()).toHaveLength(1)
  })

  it('writes a tombstone beside a removal so a reconcile can see it', async () => {
    const host = await createTestHost()
    await host.core.records.tombstones.mark('model_a')
    expect(await host.core.records.tombstones.has('model_a')).toBe(true)
    expect(await host.core.records.tombstones.list()).toEqual(['model_a'])

    await host.core.records.tombstones.clear('model_a')
    expect(await host.core.records.tombstones.has('model_a')).toBe(false)
  })

  it('keeps a pending payload unaddressable', async () => {
    const host = await createTestHost()
    const payload = {
      payloadId: 'payload_1',
      displayName: 'Old model',
      legacyModelId: 'display-model-old',
      createdAt: 1,
    }
    await host.core.records.pending.put(payload)

    const [listed] = await host.core.records.pending.list()
    // No `modelId` and no `profileId`: a `LoadCue` needs a `ModelId`, so a payload that was never imported
    // cannot construct one (C12).
    expect('modelId' in listed).toBe(false)
    expect('profileId' in listed).toBe(false)
    expect(listed.legacyModelId).toBe('display-model-old')
  })

  it('records migration markers for a model and a driver', async () => {
    const host = await createTestHost()
    expect(await host.core.records.markers.hasModelMarker('model_a')).toBe(false)

    await host.core.records.markers.writeModelMarker('model_a')
    await host.core.records.markers.writeDriverMarker(STUB_DRIVER_ID)

    expect(await host.core.records.markers.hasModelMarker('model_a')).toBe(true)
    expect(await host.core.records.markers.modelMarkers()).toEqual(['model_a'])
    expect(await host.core.records.markers.driverMarkers()).toEqual([STUB_DRIVER_ID])
  })
})

describe('prompt store', () => {
  it('stores one atomic pair and discards a publication that is not newer', async () => {
    const host = await createTestHost()
    const first = unwrap(await host.core.prompts.publish(publication({ version: 2 })))
    expect(first.state).toBe(PromptPublicationState.PUBLISHED)

    const stale = unwrap(await host.core.prompts.publish(publication({ version: 1, text: 'older' })))
    // Stale is a normal outcome, not an error: the driver did nothing wrong and the held copy stands.
    expect(stale.state).toBe(PromptPublicationState.STALE)
    expect(stale.current?.text).toBe('Be kind.')

    const sameVersion = unwrap(await host.core.prompts.publish(publication({ version: 2, text: 'different' })))
    expect(sameVersion.state).toBe(PromptPublicationState.STALE)

    expect((await host.core.prompts.get(STUB_DRIVER_ID, 'model_a', 'profile_a'))?.text).toBe('Be kind.')
  })

  it('stores an empty publication as a value', async () => {
    const host = await createTestHost()
    const result = unwrap(await host.core.prompts.publish(publication({ text: '', tokens: [] })))
    expect(result.state).toBe(PromptPublicationState.PUBLISHED)

    const held = await host.core.prompts.get(STUB_DRIVER_ID, 'model_a', 'profile_a')
    expect(held).toMatchObject({ text: '', tokens: [] })
    expect(await host.core.prompts.stateFor({ driverId: STUB_DRIVER_ID, modelId: 'model_a', profileId: 'profile_a', promptCapable: true }))
      .toBe(PromptPublicationState.PUBLISHED)
  })

  it('reports a missing publication for a prompt-capable driver as a fault, and as nothing for one that is not', async () => {
    const host = await createTestHost()

    expect(await host.core.prompts.stateFor({ driverId: STUB_DRIVER_ID, modelId: 'model_a', profileId: 'profile_a', promptCapable: true }))
      .toBe(PromptPublicationState.MISSING)
    expect(await host.core.prompts.stateFor({ driverId: STUB_DRIVER_ID, modelId: 'model_a', profileId: 'profile_a', promptCapable: false }))
      .toBe(PromptPublicationState.NONE)
  })

  it('refuses a malformed publication', async () => {
    const host = await createTestHost()
    const result = await host.core.prompts.publish({ ...publication(), tokens: undefined } as never)
    expect(result.ok).toBe(false)
  })

  it('keeps only the current copy, with no history of its own', async () => {
    const host = await createTestHost()

    unwrap(await host.core.prompts.publish(publication({ version: 1, text: 'First.' })))
    unwrap(await host.core.prompts.publish(publication({ version: 2, text: 'Second.' })))

    // The driver owns the trail of versions (D26). This store is the current publication only, so replacing it
    // leaves nothing behind — and nothing for a backup to carry beyond the pair itself.
    expect((await host.core.prompts.get(STUB_DRIVER_ID, 'model_a', 'profile_a'))?.text).toBe('Second.')
    expect(await host.storage.keys(HOST_STORAGE_KEYS.prompts)).toHaveLength(1)
    expect(await host.storage.keys('model-drivers/prompt-archive/')).toHaveLength(0)
  })
})

describe('driver storage', () => {
  it('isolates one driver from another, and from the host records', async () => {
    const host = await createTestHost()
    const one = host.core.driverStorage('ai.moeru.airi.one')
    const two = host.core.driverStorage('ai.moeru.airi.two')

    await one.set('settings/scale', 2)
    await two.set('settings/scale', 3)

    expect(await one.get('settings/scale')).toBe(2)
    expect(await two.get('settings/scale')).toBe(3)
    expect(await one.keys()).toEqual(['settings/scale'])

    // A host record is not reachable through a driver's namespace, whatever key the driver asks for.
    unwrap(await host.core.records.models.create(model()))
    expect(await one.get('../models/model_a')).toBeUndefined()
  })

  it('notifies a watcher when another handle writes the same key', async () => {
    const host = await createTestHost()
    const first = host.core.driverStorage(STUB_DRIVER_ID)
    const second = host.core.driverStorage(STUB_DRIVER_ID)

    const seen: unknown[] = []
    const unsubscribe = first.watch('theme', value => seen.push(value))

    await second.set('theme', 'dark')
    await first.set('theme', 'light')

    expect(seen).toEqual(['dark', 'light'])
    unsubscribe()
    await second.set('theme', 'again')
    expect(seen).toHaveLength(2)
  })
})

describe('id minting', () => {
  it('mints host ids with a readable prefix and never repeats one', () => {
    const minter = createIdMinter()
    const ids = new Set<string>()
    for (let index = 0; index < 50; index++)
      ids.add(minter.mintModelId())

    expect(ids.size).toBe(50)
    expect(classifyHostId([...ids][0])).toBe('model')
    expect(classifyHostId(minter.mintProfileId())).toBe('profile')
    // Nothing here can produce a mount id: the registry issues those.
    expect(classifyHostId('mount_1')).toBe('mount')
  })

  it('re-rolls when a random source repeats, and gives up loudly rather than duplicating', () => {
    let calls = 0
    const minter = createIdMinter({
      random: () => {
        calls += 1
        // Repeats twice, then moves on: a broken source that eventually produces a new value.
        return calls <= 2 ? 'same' : `value-${calls}`
      },
    })

    expect(minter.mintModelId()).toBe('model_same')
    expect(minter.mintModelId()).toBe('model_value-3')

    const stuck = createIdMinter({ random: () => 'forever' })
    stuck.mintModelId()
    expect(() => stuck.mintModelId()).toThrow(/unique host id/)
  })
})

describe('backup and restore', () => {
  it('brings back the catalogue, rows, prompt and the opaque driver bundle', async () => {
    const host = await createTestHost()
    const window = host.openWindow('control-strip')
    await window.mount({ surface: 'acting', purpose: 'acting' })

    // Catalogue.
    unwrap(await host.core.records.models.create(model()))
    unwrap(await host.core.records.profiles.create({ profileId: 'profile_a', modelId: 'model_a', displayName: 'Default', createdAt: 1 }))
    // Prompt.
    unwrap(await host.core.prompts.publish(publication({ version: 2 })))
    // An opaque bundle the host must carry without reading.
    await host.storage.set(HOST_STORAGE_KEYS.driverBundle(STUB_DRIVER_ID), new Blob(['opaque-driver-state']))
    // Rows, pulled through the renderer.
    host.driver.models.set('model_a', { modelId: 'model_a', profileId: 'profile_a', name: 'A' })
    unwrap(await host.core.registry.refreshRows(STUB_DRIVER_ID))

    const backup = await host.core.backup()
    expect(backup.entries.length).toBeGreaterThan(0)

    // A fresh host over empty storage, as a restore-on-another-device would be.
    const restored = await createTestHost({ storage: createMemoryStoragePort() })
    unwrap(await restored.core.restore(backup))

    expect(await restored.core.records.models.get('model_a')).toMatchObject({ displayName: 'Airi' })
    expect(await restored.core.records.profiles.get('profile_a')).toMatchObject({ modelId: 'model_a' })
    expect((await restored.core.prompts.get(STUB_DRIVER_ID, 'model_a', 'profile_a'))?.version).toBe(2)
    expect((await restored.storage.get(HOST_STORAGE_KEYS.driverBundle(STUB_DRIVER_ID))) instanceof Blob).toBe(true)
    expect(restored.core.registry.getRows(STUB_DRIVER_ID)).toHaveLength(1)
  })

  it('refuses a backup from a version it does not understand', async () => {
    const host = await createTestHost()
    const result = await host.core.restore({ version: 2 as never, createdAt: 0, entries: [], state: host.core.registry.snapshot() })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.code).toBe(ContractFailureCode.INVALID_PACKAGE)
  })
})
