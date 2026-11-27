/**
 * The renderer half of the model-driver host (§4.1, §4.7).
 *
 * Everything here is per window: an adapter that holds this window's identity, the driver entries running in it,
 * and its storage. The registry, the broker and the mount descriptors are in main; a renderer reaches them
 * through the typed IPC in `shared/model-drivers-eventa.ts` and decides nothing about them.
 *
 * The adapter itself is **not** app code: it lives in `@proj-airi/stage-renderer-sdk` beside the contract it
 * implements, because it has no transport of its own and no storage of its own — this file hands it a client
 * (`eventa-client.ts`), the window's storage primitives (`storage.ts`) and the specifiers this build ships. See
 * P1-D24 and P1-D25.
 *
 * `bootstrapModelDriverAdapter()` is called from the shared renderer entry, not only from the background window.
 * Any window running the app entry can serve a driver entry — a manager prefers a live renderer over starting a
 * new one (§4.3) — and the background window is only the fallback when no such window exists.
 */
import type { HostWindowKind, ModelDriverAdapter } from '@proj-airi/stage-renderer-sdk'

import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { createModelDriverAdapter } from '@proj-airi/stage-renderer-sdk'
import { storage } from '@proj-airi/stage-ui/database/storage'

import { createEventaHostClient } from './eventa-client'
import { driverLoaders } from './loaders'
import { createRendererHostStorage } from './storage'

export * from './eventa-client'
export * from './loaders'
export * from './storage'

export type { ModelDriverAdapter } from '@proj-airi/stage-renderer-sdk'

let adapter: ModelDriverAdapter | undefined
let starting: Promise<ModelDriverAdapter | undefined> | undefined

/**
 * Start this window's adapter, once.
 *
 * Idempotent, and tolerant of a window with no eventa context: that is the Web/Pocket case, where the host is
 * in-process and there is nothing to adapt to (Phase 2 wires that host). A failure is logged and reported as
 * "no adapter" rather than thrown, because a window that cannot host driver code must still render everything
 * else.
 */
export function bootstrapModelDriverAdapter(options?: { windowKind?: HostWindowKind }): Promise<ModelDriverAdapter | undefined> {
  starting ??= (async () => {
    const context = getElectronEventaContext()
    if (!context) {
      console.warn('[model-drivers] No eventa context in this window; the adapter was not started')
      return undefined
    }

    // The one place the app's database is wired in: the adapter takes the window's primitives and composes the
    // driver namespaces itself, so it can run against a map in a test and against IndexedDB here (§4.6).
    const hostStorage = createRendererHostStorage(storage)

    adapter = await createModelDriverAdapter({
      client: createEventaHostClient(context),
      storage: hostStorage.port,
      prompts: hostStorage.prompts,
      // What this build can run, which is app policy rather than contract policy: the stub exists in a
      // development build only (§4.8).
      loaders: driverLoaders,
      ...(options?.windowKind ? { windowKind: options.windowKind } : {}),
    })
    return adapter
  })().catch((error) => {
    console.error('[model-drivers] Failed to start the renderer adapter:', error)
    return undefined
  })

  return starting
}

/** The adapter, once `bootstrapModelDriverAdapter` has resolved. */
export function modelDriverAdapter(): ModelDriverAdapter | undefined {
  return adapter
}
