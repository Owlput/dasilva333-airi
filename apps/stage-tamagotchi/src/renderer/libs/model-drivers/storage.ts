/**
 * The app's storage primitives, and the host's own stores layered on them (§4.6, D17).
 *
 * Main has no web storage (§1.7), so every persisted host fact — model records, profiles, the prompt store,
 * migration markers — lives here, in a renderer, addressed under `local:model-drivers/…` in the app's existing
 * `airi-local` unstorage namespace. That is the key space `docs/data-catalog.md` documents, so the catalog and
 * the code agree by construction rather than by discipline.
 *
 * This module supplies two things and nothing else:
 *
 *   - **the primitives.** `createUnstoragePort` turns the app's unstorage instance into a `WindowStorage` — get,
 *     set, remove, a prefix scan — and knows nothing about drivers. Any subsystem in this window can take the
 *     same object;
 *   - **the host's own stores.** Records and prompts are host records with their own key prefixes, so they are
 *     composed here from the same primitives and handed to the adapter as a prompt sink.
 *
 * **Driver namespaces are not composed here.** The adapter composes them from these primitives, one per driver,
 * so there is one place that knows the layout and one hub that fans out a window's writes
 * (`adapter.storageFor(driverId)` is the same namespace a driver sees as `HostServices.storage`).
 */
import type { WindowStorage } from '@proj-airi/stage-renderer-sdk'
import type { HostRecordStores, PromptStore } from '@proj-airi/stage-renderer-sdk/host'

import {
  createHostRecordStores,
  createPromptStore,
} from '@proj-airi/stage-renderer-sdk/host'

/**
 * The app's unstorage namespace for device-local values. Keys under it are `local:…`.
 *
 * The backend is passed in rather than imported here, so this module stays free of the app's database (and of
 * IndexedDB, which a test or an in-process host does not have). `bootstrapModelDriverAdapter` supplies the real
 * one; a test supplies a map.
 */
const LOCAL_NAMESPACE = 'local:'

/** The subset of `unstorage`'s surface the primitive needs, so a test can pass a plain object. */
export interface UnstorageLike {
  getItem: <T = unknown>(key: string) => Promise<T | null>
  setItem: (key: string, value: unknown) => Promise<void>
  removeItem: (key: string) => Promise<void>
  getKeys: (base?: string) => Promise<string[]>
}

/**
 * Wrap a `unstorage` instance as a window storage primitive, namespaced.
 *
 * `keys(prefix)` returns **full** keys (with the namespace prefix stripped but the prefix argument included),
 * because the host's backup reads them back with `get`: a key that cannot be re-read is not a key.
 */
export function createUnstoragePort(backend: UnstorageLike, namespace = LOCAL_NAMESPACE): WindowStorage {
  const toBackendKey = (key: string) => `${namespace}${key}`

  return {
    async get<T>(key: string) {
      const value = await backend.getItem<T>(toBackendKey(key))
      // `unstorage` says `null` for "absent"; the port says `undefined`, because a stored `null` is a value.
      return value === null ? undefined : value
    },

    async set<T>(key: string, value: T) {
      await backend.setItem(toBackendKey(key), value)
    },

    async remove(key: string) {
      await backend.removeItem(toBackendKey(key))
    },

    async keys(prefix = '') {
      const keys = await backend.getKeys(toBackendKey(prefix))
      return keys.map(key => key.slice(namespace.length))
    },
  }
}

export interface RendererHostStorage {
  /** The window's primitives: what the adapter composes a driver namespace from. */
  port: WindowStorage
  records: HostRecordStores
  prompts: PromptStore
}

/**
 * The renderer's host storage.
 *
 * One instance per window: the records are shared through IndexedDB, so a second window reading the catalogue
 * and this one are reading the same keys — which is what makes a cross-window view of the same host records
 * correct without a sync.
 */
export function createRendererHostStorage(backend: UnstorageLike): RendererHostStorage {
  const port = createUnstoragePort(backend)

  return {
    port,
    records: createHostRecordStores(port),
    prompts: createPromptStore(port),
  }
}
