/**
 * The Live2D manager: main's half of the driver (RFC 0002 §4.2, §6.5).
 *
 * It is deliberately thin, and every answer that needs model data goes through `handle.requestRenderer` and
 * the `ManagerChannel` — the only path a manager has. Main holds no storage, no model bytes and no renderer
 * state, so:
 *
 *   - `listModels` asks the window that runs the provider entry (which owns the driver's storage);
 *   - `deliver` forwards the envelope and returns the window's combined ack;
 *   - `resolveEntrypoint` answers with the specifiers the renderer's loader table knows;
 *   - `queryMount`/`commandMount` ask the same window about its own mounts.
 *
 * **DOM-free.** This module is imported by Electron main, so it may not touch Pixi, Vue, a canvas or
 * IndexedDB. It imports the contract for types and values only (plan D2, `assert-main-dom-free.mjs`).
 */
import type {
  ContractResult,
  CueAck,
  CueEnvelope,
  CueWithdrawalReport,
  CueWithdrawalRequest,
  EntrypointRequest,
  EntrypointResolution,
  ManagerChannel,
  ModelDriverManager,
  ModelSummary,
  MountCommand,
  MountCommandAnswer,
  MountQuery,
  MountQueryAnswer,
  MountSelection,
  RegistryHandle,

  RendererMountPurpose,
  RendererMountSurfaceKind,
} from '@proj-airi/stage-renderer-sdk'

import {
  ContractFailureCode,
  ModelDriverEntryKind,
} from '@proj-airi/stage-renderer-sdk'

import { LIVE2D_DRIVER_ID, LIVE2D_IMPORT_SPECIFIER, LIVE2D_MANAGER_SPECIFIER, LIVE2D_MOUNT_SPECIFIER, LIVE2D_PANELS_SPECIFIER, LIVE2D_PICKER_SPECIFIER, LIVE2D_PROVIDER_SPECIFIER } from './manifest'
import { isLive2DProviderReply } from './protocol'

const ok = <T>(value: T): ContractResult<T> => ({ ok: true, value })
const fail = (code: ContractFailureCode, message: string): ContractResult<never> => ({ ok: false, error: { code, message } })

/**
 * Correlations are process-wide, not per manager.
 *
 * After a main-process restart a second manager can be wired to the same channel object (the window's entry
 * is reused), and both instances route replies into their own waiting maps. A per-manager counter would let
 * the released instance consume the live one's reply; monotonic ids cannot (the stub fixture learned this
 * the hard way, `stub-driver.ts`).
 */
let nextCallId = 0

export function createManager(handle: RegistryHandle): ModelDriverManager {
  const waiting = new Map<number, { key: string, resolve: (value: unknown) => void, reject: (error: { code: ContractFailureCode, message: string }) => void }>()
  const changeHandlers = new Set<() => void>()

  /** Channels held by address. `surface`/`purpose` absent means "any" and is a distinct address. */
  const channels = new Map<string, ManagerChannel>()
  /** One in-flight request per address, so two concurrent calls never open two pipes to one window. */
  const opening = new Map<string, Promise<ContractResult<ManagerChannel>>>()

  const channelKey = (surface?: RendererMountSurfaceKind, purpose?: RendererMountPurpose) =>
    `${surface ?? '*'}/${purpose ?? '*'}`

  const ensureChannel = (surface?: RendererMountSurfaceKind, purpose?: RendererMountPurpose): Promise<ContractResult<ManagerChannel>> => {
    const key = channelKey(surface, purpose)
    const existing = channels.get(key)
    if (existing)
      return Promise.resolve(ok(existing))

    const inFlight = opening.get(key)
    if (inFlight)
      return inFlight

    const pending = (async (): Promise<ContractResult<ManagerChannel>> => {
      const requested = await handle.requestRenderer({
        driverId: LIVE2D_DRIVER_ID,
        ...(surface ? { surface } : {}),
        ...(purpose ? { purpose } : {}),
      })
      if (!requested.ok)
        return fail(ContractFailureCode.DRIVER_UNAVAILABLE, `No renderer could run the Live2D driver: ${requested.reason}`)

      channels.set(key, requested.channel)
      requested.channel.onMessage((message) => {
        if (!isLive2DProviderReply(message))
          return
        if (message.type === 'notify') {
          for (const handler of [...changeHandlers])
            handler()
          return
        }
        const pendingCall = waiting.get(message.id)
        if (!pendingCall)
          return
        waiting.delete(message.id)
        if (message.type === 'error')
          pendingCall.reject({ code: message.error.code, message: message.error.message })
        else
          pendingCall.resolve(message.value)
      })
      return ok(requested.channel)
    })()

    opening.set(key, pending)
    void pending.finally(() => opening.delete(key))
    return pending
  }

  /**
   * A closed channel is reported, not inferred (§4.3).
   *
   * The registry owns the channel; when the window behind it dies the manager drops its copy and fails
   * everything in flight on that address with `window-gone`, so the next call asks for a renderer again.
   */
  handle.onChange((change) => {
    if (change.kind !== 'channel-closed')
      return
    const key = channelKey(change.surface, change.purpose)
    if (!channels.has(key))
      return

    channels.delete(key)
    opening.delete(key)
    for (const [id, pending] of [...waiting]) {
      if (pending.key !== key)
        continue
      waiting.delete(id)
      pending.reject({
        code: ContractFailureCode.WINDOW_GONE,
        message: `Window \`${change.windowId}\` closed while a Live2D call was in flight`,
      })
    }
  })

  const call = async <T>(
    surface: RendererMountSurfaceKind | undefined,
    purpose: RendererMountPurpose | undefined,
    payload: Record<string, unknown>,
  ): Promise<ContractResult<T>> => {
    const key = channelKey(surface, purpose)
    const channel = await ensureChannel(surface, purpose)
    if (!channel.ok)
      return channel

    const id = nextCallId += 1
    const answer = new Promise<T>((resolve, reject) => {
      waiting.set(id, { key, resolve: resolve as (value: unknown) => void, reject })
    })
    channel.value.send({ type: 'call', id, ...payload })

    try {
      return ok(await answer)
    }
    catch (error) {
      return { ok: false, error: error as { code: ContractFailureCode, message: string } }
    }
  }

  return {
    modelDriverId: LIVE2D_DRIVER_ID,

    listModels: () => call<ModelSummary[]>(undefined, undefined, { method: 'list-models' }),

    async resolveEntrypoint(request: EntrypointRequest): Promise<ContractResult<EntrypointResolution>> {
      switch (request.kind) {
        case ModelDriverEntryKind.PROVIDER:
          return ok({ specifier: LIVE2D_PROVIDER_SPECIFIER })
        case ModelDriverEntryKind.MOUNT:
          return ok({ specifier: LIVE2D_MOUNT_SPECIFIER })
        case ModelDriverEntryKind.PANELS:
          return ok({ specifier: LIVE2D_PANELS_SPECIFIER })
        case ModelDriverEntryKind.PICKER:
          return ok({ specifier: LIVE2D_PICKER_SPECIFIER })
        case ModelDriverEntryKind.IMPORT:
          return ok({ specifier: LIVE2D_IMPORT_SPECIFIER })
        default:
          return fail(ContractFailureCode.INVALID_ENTRYPOINT, `Unknown entry kind \`${String((request as { kind: unknown }).kind)}\``)
      }
    },

    async deliver(envelope: CueEnvelope): Promise<ContractResult<CueAck>> {
      const answer = await call<CueAck>(envelope.target.surface, envelope.target.purpose, {
        method: 'deliver',
        envelope,
      })
      if (!answer.ok)
        return answer

      // The window reports a broken load as `{ failure }` rather than as an ack, because a load that broke is
      // the whole send's error (`LoadCue`); everything else is a per-slot rejection inside a normal ack.
      const value = answer.value as unknown as { failure?: { code: ContractFailureCode, message: string } }
      if (value.failure)
        return { ok: false, error: value.failure }
      return ok(answer.value)
    },

    async withdraw(request: CueWithdrawalRequest): Promise<ContractResult<CueWithdrawalReport>> {
      const answer = await call<CueWithdrawalReport>(request.address?.surface, request.address?.purpose, {
        method: 'withdraw',
        request,
      })
      if (!answer.ok)
        return answer
      // The manager owns the report's `kind`; a window answers with what it still had, which is always empty
      // for this driver today (cues are applied immediately, never queued).
      return ok({ ...answer.value, kind: request.kind })
    },

    onModelsChanged(handler: () => void) {
      changeHandlers.add(handler)
      return () => {
        changeHandlers.delete(handler)
      }
    },

    queryMount: (selection: MountSelection, query: MountQuery) =>
      call<MountQueryAnswer[]>(selection.surface, selection.purpose, { method: 'query-mount', selection, query }),

    commandMount: (selection: MountSelection, command: MountCommand) =>
      call<MountCommandAnswer[]>(selection.surface, selection.purpose, { method: 'command-mount', selection, command }),
  }
}

/** Re-exported so main's table and this manager cannot disagree about the module it lives in. */
export { LIVE2D_MANAGER_SPECIFIER }
