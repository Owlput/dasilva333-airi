/**
 * The shared background window's policy, with no Electron in it (§4.1, D11).
 *
 * The window itself is three lines of `BrowserWindow` options; everything that is easy to get wrong lives
 * here instead, so it can be reasoned about (and tested) without a display:
 *
 *   - **lazy, single-flight start.** The first consumer starts it, concurrent consumers share that start, and
 *     a failed start is not remembered — a later request may retry, because a build that cannot open one
 *     window is not a build that should refuse forever;
 *   - **consumers are named, not counted.** A request that is retried must not leak a count; the consumer set
 *     is a `Set` of reasons, so `acquire` twice with one reason is one consumer;
 *   - **it never counts for the quit decision.** The app quits when the last *visible* window closes, and this
 *     window is never one of them (D11, §4.3);
 *   - **shutdown closes it explicitly.** Nothing else is allowed to: while started it lives until shutdown.
 */
import type { Unsubscribe } from '@proj-airi/stage-renderer-sdk'

/**
 * The marker main puts on the window object, so the quit gate can recognise it without keeping a second
 * registry of windows. A symbol would be tidier but the tag has to survive a `BrowserWindow` that main did not
 * create through this module.
 */
export const BACKGROUND_WINDOW_TAG = '__airi_background_window'

/**
 * The `webPreferences` this window requires.
 *
 * `backgroundThrottling: false` is the whole point of a separate window (D11): a hidden renderer whose timers
 * are throttled to once per second cannot hold a deadline, serve a manager request promptly, or run the
 * migration queue at a predictable rate. It is exported as data rather than only written inline so the
 * requirement is visible at the place that documents it.
 */
export const BACKGROUND_WINDOW_WEB_PREFERENCES = {
  backgroundThrottling: false,
} as const

/** The minimum main needs to know about a window to answer "is it part of the quit decision". */
export interface QuitCandidate {
  isDestroyed?: () => boolean
  [BACKGROUND_WINDOW_TAG]?: boolean
}

/** Whether closing this window may trigger the app's quit sequence. The background window never does. */
export function isQuitRelevantWindow(window: QuitCandidate): boolean {
  if (window[BACKGROUND_WINDOW_TAG] === true)
    return false
  return window.isDestroyed ? !window.isDestroyed() : true
}

/**
 * Whether the app should quit after a window closed.
 *
 * Pure so the rule is inspectable: "quit when no window that counts is left". Calling it with no windows at
 * all is `true`, which is the same answer `window-all-closed` gives.
 */
export function shouldQuitNow(windows: readonly QuitCandidate[]): boolean {
  return !windows.some(isQuitRelevantWindow)
}

export interface BackgroundWindowLifecycle {
  /** A consumer needs the window right now. Starts it if this is the first consumer; returns success. */
  acquire: (reason: string) => Promise<boolean>
  /** The consumer is done. The window stays up (D11); only the claim is dropped. */
  release: (reason: string) => void
  /** The claims currently held, for diagnostics. */
  consumers: () => string[]
  /** Whether a start has succeeded (so a window exists unless it was closed). */
  isStarted: () => boolean
  /** Shutdown: close the window explicitly, whatever claims remain. Idempotent. */
  shutdown: () => Promise<void>
  /** Observe start and shutdown, for a service that has to react to both. */
  onChange: (handler: () => void) => Unsubscribe
}

export function createBackgroundWindowLifecycle(deps: {
  /** Bring the window up. Called at most once per successful lifecycle. */
  start: () => Promise<boolean>
  /** Whether the window is still there. A window the user closed is not a started lifecycle. */
  isAlive: () => boolean
  /** Tear the window down. Called once by `shutdown`, and again if the user closed it by hand. */
  close: () => Promise<void>
}): BackgroundWindowLifecycle {
  const claims = new Set<string>()
  const handlers = new Set<() => void>()

  let started = false
  let startInFlight: Promise<boolean> | undefined
  let shutdownInFlight: Promise<void> | undefined

  const emit = () => {
    for (const handler of [...handlers]) {
      try {
        handler()
      }
      catch {
        // One observer throwing must not stop the rest, or a single broken panel would freeze the lifecycle.
      }
    }
  }

  const lifecycle: BackgroundWindowLifecycle = {
    async acquire(reason) {
      claims.add(reason)
      emit()

      // A window that went away (the user closed it, or it crashed) is not a started lifecycle: the next
      // consumer starts a new one rather than believing a boolean.
      if (started && deps.isAlive())
        return true

      started = false

      // Single flight: two managers asking at once (two row pulls at boot, say) must not create two windows.
      startInFlight ??= Promise.resolve(deps.start())
        .then((ok) => {
          started = ok
          return ok
        })
        .catch(() => false)
        .finally(() => {
          startInFlight = undefined
        })

      const ok = await startInFlight
      if (ok)
        emit()
      return ok
    },

    release(reason) {
      if (claims.delete(reason))
        emit()
    },

    consumers: () => [...claims],

    isStarted: () => started && deps.isAlive(),

    async shutdown() {
      // Idempotent: shutdown is called from `before-quit` and may be reached twice by two quit paths.
      if (shutdownInFlight)
        return shutdownInFlight

      claims.clear()
      shutdownInFlight = (async () => {
        if (started) {
          started = false
          await deps.close()
        }
      })()

      try {
        await shutdownInFlight
      }
      finally {
        shutdownInFlight = undefined
        emit()
      }
    },

    onChange(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }

  return lifecycle
}
