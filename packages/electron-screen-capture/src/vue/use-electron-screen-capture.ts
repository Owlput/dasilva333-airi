import type { createContext } from '@moeru/eventa/adapters/electron/renderer'
import type { SourcesOptions } from 'electron'
import type { MaybeRefOrGetter } from 'vue'

import type { ScreenCaptureSetSourceRequest, SerializableDesktopCapturerSource } from '..'

import { defineInvoke } from '@moeru/eventa'
import { toRaw, toValue } from 'vue'

import { screenCapture } from '..'

/**
 * Screen capture commands on the eventa context of the window.
 *
 * Pass the shared context of the window, for example `getElectronEventaContext()` of `@proj-airi/electron-vueuse`.
 * Each eventa context adds an IPC listener that handles every message to the window, and the listener stays for the
 * life of the page.
 */
export function useElectronScreenCapture(context: ReturnType<typeof createContext>['context'] | undefined, sourcesOptions: MaybeRefOrGetter<SourcesOptions>) {
  const invokeGetSources = context ? defineInvoke(context, screenCapture.getSources) : undefined
  const setSource = context ? defineInvoke(context, screenCapture.setSource) : undefined
  const resetSource = context ? defineInvoke(context, screenCapture.resetSource) : undefined

  const checkMacOSPermission = context ? defineInvoke(context, screenCapture.checkMacOSPermission) : undefined
  const requestMacOSPermission = context ? defineInvoke(context, screenCapture.requestMacOSPermission) : undefined

  async function getSources() {
    if (!invokeGetSources)
      return []
    return invokeGetSources(toRaw(toValue(sourcesOptions)))
  }

  async function selectWithSource<R>(
    selectFn: (sources: SerializableDesktopCapturerSource[]) => string,
    useFn: () => Promise<R>,
    request?: Omit<ScreenCaptureSetSourceRequest, 'options' | 'sourceId'>,
  ): Promise<R> {
    const sources = await getSources()
    const sourceId = selectFn(sources)

    let handle: string | undefined
    try {
      if (setSource) {
        handle = await setSource({
          options: toRaw(toValue(sourcesOptions)),
          sourceId,
          timeout: request?.timeout,
        })
      }
      return await useFn()
    }
    finally {
      if (handle && resetSource) {
        await resetSource(handle)
      }
    }
  }

  return {
    getSources,
    setSource: setSource ?? (async () => ''),
    resetSource: resetSource ?? (async () => {}),
    selectWithSource,
    checkMacOSPermission: checkMacOSPermission ?? (async () => 'not-determined' as const),
    requestMacOSPermission: requestMacOSPermission ?? (async () => false),
  }
}
