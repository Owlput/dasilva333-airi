/**
 * The records the host owns about models, profiles, pending payloads and migration progress (§4.5).
 *
 * Everything here is a **host** fact: it exists so the catalogue, a card chip and the unavailable-model
 * view can answer with no driver installed, no window open and no model mounted. Nothing in this module
 * ever holds model bytes, and nothing here mirrors a driver's storage — the driver owns the asset, the
 * host owns the name it gave it.
 *
 * The stores are thin on purpose. Each one is a key space plus the two decisions worth stating (a
 * create refuses a duplicate id; a tombstone is written beside a removal rather than inside one), and
 * they all go through {@link WindowStorage} so the same code runs in main, in a renderer and in a
 * test.
 */
import type {
  ContractResult,
  HostModelProfileRecord,
  HostNamedModelRecord,
  ModelId,
  ModelProfileId,
  PendingModelPayload,
} from '../../contract'
import type { WindowStorage } from '../storage'

import { ContractFailureCode } from '../../contract'
import { HOST_STORAGE_KEYS } from './keys'

function failure(code: ContractFailureCode, message: string): { ok: false, error: { code: ContractFailureCode, message: string } } {
  return { ok: false, error: { code, message } }
}

/**
 * Rebuild the catalog filter key from the parts a record has.
 *
 * The host owns this string (it is what `HostAnnotationFields.searchKey` is for), so it is derived
 * rather than supplied: a caller that could set it could set it out of step with the fields the filter
 * actually matches. Migration passes the legacy `searchKeyInputs` and gets the same treatment (§D8).
 */
export function buildSearchKey(input: {
  displayName?: string
  tags?: string[]
  groups?: string[]
  extra?: string[]
}): string {
  return [
    input.displayName ?? '',
    ...(input.tags ?? []),
    ...(input.groups ?? []),
    ...(input.extra ?? []),
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Apply the derived `searchKey` to a record, so no caller has to remember to. */
export function withDerivedSearchKey<T extends { displayName: string, tags?: string[], groups?: string[] }>(record: T): T {
  return { ...record, searchKey: buildSearchKey(record) }
}

export interface ModelRecordStore {
  get: (modelId: ModelId) => Promise<HostNamedModelRecord | undefined>
  has: (modelId: ModelId) => Promise<boolean>
  list: () => Promise<HostNamedModelRecord[]>
  /**
   * Create one record, refusing an id that already has one.
   *
   * The refusal is the host's duplicate-import answer (`MODEL_ID_CONFLICT`): the adapter minted a
   * fresh id for this import, so a record that already exists under it means either the same import ran
   * twice or the caller reused an id. Either way the import must surface a conflict rather than replace
   * a model the user can still see.
   */
  create: (record: HostNamedModelRecord) => Promise<ContractResult<HostNamedModelRecord>>
  /** Update the annotation block. Upserts, because a write always follows a create the host itself did. */
  put: (record: HostNamedModelRecord) => Promise<HostNamedModelRecord>
  /** Patch one record in place; returns the new value, or `undefined` when there is no such record. */
  patch: (modelId: ModelId, patch: Partial<Omit<HostNamedModelRecord, 'modelId'>>) => Promise<HostNamedModelRecord | undefined>
  remove: (modelId: ModelId) => Promise<void>
}

export interface ProfileRecordStore {
  get: (profileId: ModelProfileId) => Promise<HostModelProfileRecord | undefined>
  has: (profileId: ModelProfileId) => Promise<boolean>
  list: () => Promise<HostModelProfileRecord[]>
  listForModel: (modelId: ModelId) => Promise<HostModelProfileRecord[]>
  create: (record: HostModelProfileRecord) => Promise<ContractResult<HostModelProfileRecord>>
  put: (record: HostModelProfileRecord) => Promise<HostModelProfileRecord>
  remove: (profileId: ModelProfileId) => Promise<void>
  /** Drop every profile of one model, for the model-removal path. */
  removeForModel: (modelId: ModelId) => Promise<number>
}

export interface TombstoneStore {
  /** Write the durable "the user deleted this" marker that a catalog reconcile reads. */
  mark: (modelId: ModelId) => Promise<void>
  clear: (modelId: ModelId) => Promise<void>
  has: (modelId: ModelId) => Promise<boolean>
  list: () => Promise<ModelId[]>
}

export interface PendingPayloadStore {
  put: (payload: PendingModelPayload) => Promise<PendingModelPayload>
  get: (payloadId: string) => Promise<PendingModelPayload | undefined>
  list: () => Promise<PendingModelPayload[]>
  remove: (payloadId: string) => Promise<void>
}

export interface MigrationMarkerStore {
  hasModelMarker: (modelId: ModelId) => Promise<boolean>
  writeModelMarker: (modelId: ModelId) => Promise<void>
  clearModelMarker: (modelId: ModelId) => Promise<void>
  modelMarkers: () => Promise<ModelId[]>
  hasDriverMarker: (driverId: string) => Promise<boolean>
  writeDriverMarker: (driverId: string) => Promise<void>
  clearDriverMarker: (driverId: string) => Promise<void>
  driverMarkers: () => Promise<string[]>
}

export interface HostRecordStores {
  models: ModelRecordStore
  profiles: ProfileRecordStore
  tombstones: TombstoneStore
  pending: PendingPayloadStore
  markers: MigrationMarkerStore
}

function readList<T>(port: WindowStorage, prefix: string): Promise<T[]> {
  return readAll(port, prefix).then(values => values.map(value => value as T))
}

async function readAll(port: WindowStorage, prefix: string): Promise<unknown[]> {
  const keys = await port.keys(prefix)
  const values = await Promise.all(keys.map(key => port.get(key)))
  return values.filter((value): value is unknown => value !== undefined)
}

/** Every store the host core keeps, over one port. */
export function createHostRecordStores(port: WindowStorage): HostRecordStores {
  const models: ModelRecordStore = {
    get: modelId => port.get<HostNamedModelRecord>(HOST_STORAGE_KEYS.model(modelId)),
    async has(modelId) {
      return (await port.get(HOST_STORAGE_KEYS.model(modelId))) !== undefined
    },
    list: () => readList<HostNamedModelRecord>(port, HOST_STORAGE_KEYS.models),
    async create(record) {
      const key = HOST_STORAGE_KEYS.model(record.modelId)
      if (await port.get(key) !== undefined)
        return failure(ContractFailureCode.MODEL_ID_CONFLICT, `A model record already exists for \`${record.modelId}\``)
      const stored = withDerivedSearchKey(record)
      await port.set(key, stored)
      return { ok: true, value: stored }
    },
    async put(record) {
      const stored = withDerivedSearchKey(record)
      await port.set(HOST_STORAGE_KEYS.model(record.modelId), stored)
      return stored
    },
    async patch(modelId, patch) {
      const current = await port.get<HostNamedModelRecord>(HOST_STORAGE_KEYS.model(modelId))
      if (!current)
        return undefined
      const next = withDerivedSearchKey({ ...current, ...patch })
      await port.set(HOST_STORAGE_KEYS.model(modelId), next)
      return next
    },
    remove: modelId => port.remove(HOST_STORAGE_KEYS.model(modelId)),
  }

  const profiles: ProfileRecordStore = {
    get: profileId => port.get<HostModelProfileRecord>(HOST_STORAGE_KEYS.profile(profileId)),
    async has(profileId) {
      return (await port.get(HOST_STORAGE_KEYS.profile(profileId))) !== undefined
    },
    list: () => readList<HostModelProfileRecord>(port, HOST_STORAGE_KEYS.profiles),
    async listForModel(modelId) {
      const all = await readList<HostModelProfileRecord>(port, HOST_STORAGE_KEYS.profiles)
      return all.filter(profile => profile.modelId === modelId)
    },
    async create(record) {
      const key = HOST_STORAGE_KEYS.profile(record.profileId)
      if (await port.get(key) !== undefined) {
        // There is no `PROFILE_ID_CONFLICT` in the contract, and it would be a lie to reuse the model
        // one: the adapter mints a profile id exactly once per save, so a duplicate is a caller bug
        // rather than a user-facing conflict. `INTERNAL` says that without inventing a vocabulary.
        return failure(
          ContractFailureCode.INTERNAL,
          `A profile record already exists for \`${record.profileId}\`; profile ids are minted once and never reused`,
        )
      }
      const stored = withDerivedSearchKey(record)
      await port.set(key, stored)
      return { ok: true, value: stored }
    },
    async put(record) {
      const stored = withDerivedSearchKey(record)
      await port.set(HOST_STORAGE_KEYS.profile(record.profileId), stored)
      return stored
    },
    remove: profileId => port.remove(HOST_STORAGE_KEYS.profile(profileId)),
    async removeForModel(modelId) {
      const owned = await profiles.listForModel(modelId)
      await Promise.all(owned.map(profile => port.remove(HOST_STORAGE_KEYS.profile(profile.profileId))))
      return owned.length
    },
  }

  const tombstones: TombstoneStore = {
    mark: modelId => port.set(HOST_STORAGE_KEYS.deleted(modelId), true),
    clear: modelId => port.remove(HOST_STORAGE_KEYS.deleted(modelId)),
    async has(modelId) {
      return (await port.get(HOST_STORAGE_KEYS.deleted(modelId))) !== undefined
    },
    async list() {
      const keys = await port.keys(HOST_STORAGE_KEYS.deletedRoot)
      return keys.map(key => key.slice(HOST_STORAGE_KEYS.deletedRoot.length)).sort()
    },
  }

  const pending: PendingPayloadStore = {
    put: async (payload) => {
      await port.set(HOST_STORAGE_KEYS.pending(payload.payloadId), payload)
      return payload
    },
    get: payloadId => port.get<PendingModelPayload>(HOST_STORAGE_KEYS.pending(payloadId)),
    list: () => readList<PendingModelPayload>(port, HOST_STORAGE_KEYS.pendingRoot),
    remove: payloadId => port.remove(HOST_STORAGE_KEYS.pending(payloadId)),
  }

  const markers: MigrationMarkerStore = {
    async hasModelMarker(modelId) {
      return (await port.get(HOST_STORAGE_KEYS.modelMigrationMarker(modelId))) !== undefined
    },
    writeModelMarker: modelId => port.set(HOST_STORAGE_KEYS.modelMigrationMarker(modelId), true),
    clearModelMarker: modelId => port.remove(HOST_STORAGE_KEYS.modelMigrationMarker(modelId)),
    async modelMarkers() {
      const keys = await port.keys(HOST_STORAGE_KEYS.modelMigrationMarkers)
      return keys.map(key => key.slice(HOST_STORAGE_KEYS.modelMigrationMarkers.length)).sort()
    },
    async hasDriverMarker(driverId) {
      return (await port.get(HOST_STORAGE_KEYS.driverMigrationMarker(driverId))) !== undefined
    },
    writeDriverMarker: driverId => port.set(HOST_STORAGE_KEYS.driverMigrationMarker(driverId), true),
    clearDriverMarker: driverId => port.remove(HOST_STORAGE_KEYS.driverMigrationMarker(driverId)),
    async driverMarkers() {
      const keys = await port.keys(HOST_STORAGE_KEYS.driverMigrationMarkers)
      return keys.map(key => key.slice(HOST_STORAGE_KEYS.driverMigrationMarkers.length)).sort()
    },
  }

  return { models, profiles, tombstones, pending, markers }
}
