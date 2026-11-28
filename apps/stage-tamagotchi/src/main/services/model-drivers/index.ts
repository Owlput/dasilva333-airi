/**
 * The model-driver host, wired into Electron main (§4.1, §4.2).
 *
 * Everything that decides *what* the host does lives in the SDK (`@proj-airi/stage-renderer-sdk/host`,
 * `service.ts`): the registry, the broker, the entry relay and its timeout, the manager channels, the
 * `state.json` debounce, the window-closed and shutdown ordering, and the suite that exercises them. This file
 * is the composition root and nothing else — it supplies the four resources the service cannot own:
 *
 *   - **windows** — which `webContents` is which window, the shared background window, and `BrowserWindow`;
 *   - **transport** — one eventa push per message kind, delivered to one window;
 *   - **state** — the `{userData}/model-drivers/state.json` file (`./state-store.ts`);
 *   - **sender identity** — the window an invoke came from, which is the one fact a renderer must not be able
 *     to choose for itself.
 *
 * Main still holds **no storage** — no IndexedDB, no record store, no prompt store — because those live where
 * the web platform does, in a renderer (D1, §1.7).
 */
import type { HostLogger } from '@proj-airi/stage-renderer-sdk'
import type {
  DriverStateSnapshot,
  DriverTableEntry,
  ModelDriverHostPush,
} from '@proj-airi/stage-renderer-sdk/host'

import type { ModelDriverHostState } from '../../../shared/model-drivers-eventa'
import type { InvokeSender } from './handlers'
import type { ModelDriverStateStore } from './state-store'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import {
  createConsoleLogger,
  createModelDriverHostService as createHostService,
} from '@proj-airi/stage-renderer-sdk/host'
import { app, BrowserWindow, ipcMain, webContents } from 'electron'

import {
  modelDriverCueSettledEventa,
  modelDriverManagerMessageEventa,
  modelDriverOpenEntryEventa,
  modelDriverPromptResolutionEventa,
} from '../../../shared/model-drivers-eventa'
import { registerModelDriverHandlers, resolveIpcSender } from './handlers'

/**
 * The shape of the app's global main-process context.
 *
 * Derived rather than written out: eventa's `EventContext` is parameterised by the per-transport options, and a
 * hand-written `<undefined, undefined>` would be a different, incompatible type.
 */
type MainEventContext = ReturnType<typeof createContext>['context']

/** The background window, as far as this service is concerned: start it, look at it, close it. */
export interface ModelDriverBackgroundWindowPort {
  ensure: () => Promise<BrowserWindow | null>
  get: () => BrowserWindow | undefined
  close: () => Promise<void>
}

export interface ModelDriverHostServiceOptions {
  /** The global (window-agnostic) main-process context. Handlers derive the sender from it. */
  context: MainEventContext
  state: ModelDriverStateStore
  background: ModelDriverBackgroundWindowPort
  /** The static first-party table (§4.2 step 1). */
  table: DriverTableEntry[]
  logger?: HostLogger
}

/**
 * The host's name for a renderer window.
 *
 * Derived from the `webContents` id so it cannot be chosen by a renderer and needs no second registry of
 * windows: a window that reloads keeps its identity, and a window that goes away takes its mounts with it.
 */
export function modelDriverWindowId(webContentsId: number): string {
  return `w${webContentsId}`
}

export interface ModelDriverHostService {
  /** Read the declarations, create the managers, write the normalized state. Called once, at startup. */
  start: () => Promise<void>
  snapshot: () => ModelDriverHostState
  /** A window went away: drop its mounts, its channels and everything it left waiting. */
  windowClosed: (windowId: string) => Promise<void>
  shutdown: () => Promise<void>
}

export function createModelDriverHostService(options: ModelDriverHostServiceOptions): ModelDriverHostService {
  const logger = options.logger ?? createConsoleLogger()

  /** Windows whose adapter identified itself. Only these can run a driver entry, so this is `liveWindows`. */
  const registered = new Map<string, number>()

  let shuttingDown = false

  const windowIdOf = modelDriverWindowId

  /**
   * The sender of an invoke, as the handler table wants it.
   *
   * Every window-scoped handler resolves the acting window this way and never from the payload: a renderer must not
   * be able to send a cue as another window or register a mount in one (§4.3). The extraction itself lives in
   * `./handlers.ts` so it can be asserted without Electron; this is only the app's `webContents` interpretation.
   */
  const resolveSender = (handlerOptions: unknown): InvokeSender | undefined => {
    const sender = resolveIpcSender(handlerOptions)
    return sender && !sender.isDestroyed() ? { windowId: windowIdOf(sender.id), tag: sender.id } : undefined
  }

  const windowOf = (windowId: string): BrowserWindow | undefined => {
    const id = registered.get(windowId)
    if (id !== undefined) {
      const contents = webContents.fromId(id)
      const window = contents ? BrowserWindow.fromWebContents(contents) : null
      if (window && !window.isDestroyed())
        return window
    }

    // The background window is not a "live renderer" the registry may reuse, but it is still a window a
    // manager's request may be served by, so it must be addressable.
    const background = options.background.get()
    if (background && !background.isDestroyed() && windowIdOf(background.webContents.id) === windowId)
      return background

    return undefined
  }

  /**
   * Deliver one event to one window.
   *
   * The `deliver` callback rather than a (contract, payload) pair keeps the payload typed against its own
   * contract at every call site: a generic `emit(event, payload)` here would erase the correlation between the
   * two and turn a payload mistake into an untyped one.
   */
  const emitTo = (window: BrowserWindow, deliver: (context: MainEventContext) => void): boolean => {
    if (window.isDestroyed())
      return false
    const { context, dispose } = createContext(ipcMain, window)
    try {
      deliver(context)
      return true
    }
    catch (error) {
      logger.warn('model-drivers', `Could not deliver an event to \`${window.id}\``, error)
      return false
    }
    finally {
      dispose()
    }
  }

  const emitToWindow = (windowId: string, deliver: (context: MainEventContext) => void): boolean => {
    const window = windowOf(windowId)
    return window ? emitTo(window, deliver) : false
  }

  const backgroundWindowId = (): string | undefined => {
    const background = options.background.get()
    return background ? windowIdOf(background.webContents.id) : undefined
  }

  /** One push per message kind. This switch is the whole of the host's transport knowledge. */
  const push = (windowId: string, message: ModelDriverHostPush): boolean => {
    switch (message.kind) {
      case 'cue-settled':
        return emitToWindow(windowId, context => context.emit(modelDriverCueSettledEventa, {
          nonce: message.nonce,
          result: message.result,
        }))
      case 'open-entry':
        return emitToWindow(windowId, context => context.emit(modelDriverOpenEntryEventa, {
          requestId: message.requestId,
          driverId: message.driverId,
          specifier: message.specifier,
          ...(message.surface !== undefined ? { surface: message.surface } : {}),
          ...(message.purpose !== undefined ? { purpose: message.purpose } : {}),
        }))
      case 'manager-message':
        return emitToWindow(windowId, context => context.emit(modelDriverManagerMessageEventa, {
          driverId: message.driverId,
          message: message.message,
        }))
      case 'prompt-resolution':
        return emitToWindow(windowId, context => context.emit(modelDriverPromptResolutionEventa, {
          driverId: message.driverId,
          publication: message.publication,
        }))
    }
  }

  const service = createHostService({
    table: options.table,
    logger,
    transport: { push },
    windows: {
      liveWindows: () => {
        const background = backgroundWindowId()
        return [...registered.keys()].filter(windowId => windowId !== background)
      },
      ensureBackgroundWindow: async () => {
        const window = await options.background.ensure()
        if (!window || window.isDestroyed())
          return null
        return windowIdOf(window.webContents.id)
      },
      backgroundStarted: () => options.background.get() !== undefined,
      closeBackgroundWindow: () => options.background.close(),
    },
    state: {
      read: async () => options.state.read(),
      write: async (snapshot: DriverStateSnapshot) => options.state.write(snapshot),
    },
  })

  // ---------------------------------------------------------------------------------------------
  // IPC
  // ---------------------------------------------------------------------------------------------

  registerModelDriverHandlers({
    context: options.context,
    control: service,
    resolveSender,
    onIdentified: sender => registered.set(sender.windowId, sender.tag),
    logger,
  })

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------

  const hostService: ModelDriverHostService = {
    start: () => service.start(),
    snapshot: () => service.snapshot(),
    windowClosed: windowId => service.windowClosed(windowId),
    shutdown: async () => {
      if (shuttingDown)
        return
      shuttingDown = true

      await service.shutdown()
      registered.clear()
    },
  }

  // A window going away drops its mounts, settles what it left waiting and forgets its channels (§4.4 step 8).
  // Registered by the service rather than by the app's entry point so the ownership is obvious: whoever created
  // the registry also observes the windows its mounts live in.
  app.on('browser-window-created', (_event, window) => {
    const windowId = windowIdOf(window.webContents.id)
    window.once('closed', () => {
      registered.delete(windowId)
      void hostService.windowClosed(windowId).catch((error) => {
        logger.error('model-drivers', `Failed to tear down window \`${windowId}\``, error)
      })
    })
  })

  return hostService
}
