/**
 * The app's one shared background window (§4.1, D11).
 *
 * It hosts driver code that a manager asked a renderer for, and — from Phase 2 — the migration run. It is
 * hidden, never focused, never counted for the quit decision, and never throttled. What is *policy* (lazy
 * start, consumer claims, shutdown) lives in `./policy.ts`; this file is only the Electron half: what the
 * window is and how it is loaded.
 *
 * Beat sync is untouched: it keeps its own window and its own lifecycle (Phase 1 scope).
 */
import type { BrowserWindow } from 'electron'

import type { BackgroundWindowLifecycle } from './policy'

import { resolve } from 'node:path'

import { BrowserWindow as ElectronBrowserWindow } from 'electron'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getElectronMainDirname, load } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { BACKGROUND_WINDOW_TAG, BACKGROUND_WINDOW_WEB_PREFERENCES, createBackgroundWindowLifecycle } from './policy'

/** The only reason this window is started in Phase 1: a manager needed a renderer that no window could serve. */
const RENDERER_REQUEST_REASON = 'renderer-request'

export interface BackgroundWindowManager {
  /** Bring it up if needed and return the live window, or `null` when it cannot be opened. */
  ensure: () => Promise<BrowserWindow | null>
  /** The window, when one is already up. Never starts it. */
  get: () => BrowserWindow | undefined
  /** Close it explicitly, as shutdown does. Idempotent; safe when it was never started. */
  close: () => Promise<void>
  /** Policy: consumer claims, lazy start and shutdown. */
  lifecycle: BackgroundWindowLifecycle
}

export function setupBackgroundWindow(): BackgroundWindowManager {
  const reusable = createReusableWindow(async () => {
    const window = new ElectronBrowserWindow({
      title: 'AIRI — Background',
      icon,
      show: false,
      frame: false,
      skipTaskbar: true,
      // A hidden window that is never shown still needs a normal frame budget while it runs driver code.
      webPreferences: {
        preload: resolve(getElectronMainDirname(), '../preload/index.cjs'),
        sandbox: true,
        ...BACKGROUND_WINDOW_WEB_PREFERENCES,
      },
    })

    // The quit gate reads this tag rather than keeping a parallel list of windows that could drift from the
    // windows that actually exist.
    ;(window as unknown as Record<string, unknown>)[BACKGROUND_WINDOW_TAG] = true

    await load(window, baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'), 'background.html'))
    return window
  })

  const lifecycle = createBackgroundWindowLifecycle({
    start: async () => {
      const window = await reusable.getWindow()
      return !window.isDestroyed()
    },
    isAlive: () => reusable.hasWindow(),
    close: async () => {
      const window = reusable.getExistingWindow()
      if (!window)
        return
      // `close()` is synchronous about starting the teardown but not about finishing it, and shutdown must not
      // race a window that is still holding a timer.
      await new Promise<void>((resolveClosed) => {
        window.once('closed', () => resolveClosed())
        window.close()
      })
    },
  })

  return {
    lifecycle,

    async ensure() {
      const ok = await lifecycle.acquire(RENDERER_REQUEST_REASON)
      return ok ? (reusable.getExistingWindow() ?? null) : null
    },

    get: () => reusable.getExistingWindow(),

    close: () => lifecycle.shutdown(),
  }
}
