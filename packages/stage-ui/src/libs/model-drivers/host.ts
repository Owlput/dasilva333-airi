/**
 * This window's model-driver host, as the host surfaces reach it (§4.1).
 *
 * The adapter is **per window and app-supplied**: the app entry composes it from the eventa client, the window's
 * storage and the loader table (`bootstrapModelDriverAdapter`), and provides it here once. A surface that needs it —
 * the stage that mounts a driver, the model settings that bind a character — reads it through this key rather than
 * importing an app module, which is what keeps this package usable by a shell that has no adapter at all.
 *
 * A window without one is not an error: stage-web and stage-pocket do not run driver code yet, so `undefined` is the
 * honest answer there and every consumer renders its legacy path. That is why the adapter is a ref and not a value:
 * the app provides it before bootstrapping and fills it in when the bootstrap resolves, and a surface that mounted
 * first re-renders when it appears.
 */
import type { ModelDriverAdapter } from '@proj-airi/stage-renderer-sdk'
import type { HostPromptService } from '@proj-airi/stage-renderer-sdk/host'
import type { InjectionKey, ShallowRef } from 'vue'

import { inject, provide } from 'vue'

/** What a host surface may read from its window. */
export interface ModelDriverHost {
  /** The window's adapter, absent until (or unless) the app bootstrapped one. */
  adapter: ShallowRef<ModelDriverAdapter | undefined>
  /**
   * The window's prompt service, from the same bootstrap.
   *
   * A surface needs it to reconcile a card against the store at bind time (§5.4): the store is the only assembly
   * input, and the card keeps a portable copy. Absent in a window with no adapter, for the same reason.
   */
  prompts: ShallowRef<HostPromptService | undefined>
}

export const modelDriverHostKey: InjectionKey<ModelDriverHost> = Symbol('airi:model-driver-host')

/** Called once by the app entry whose window can host driver code. */
export function provideModelDriverHost(host: ModelDriverHost): void {
  provide(modelDriverHostKey, host)
}

/** The window's host, or `undefined` in a window that cannot run a driver. */
export function useModelDriverHost(): ModelDriverHost | undefined {
  return inject(modelDriverHostKey, undefined)
}
