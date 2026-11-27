/**
 * The host core: one object that owns everything the contract needs on the host side (§4.1).
 *
 * It is the composition of the pieces below it, not a fourth implementation of them:
 *
 *   - the **registry** (declarations, managers, flags, rows, renderer requests);
 *   - the **broker** (transactions, correlation, deadlines, withdrawals, window-gone);
 *   - the **mount registry** (descriptors, registry-issued ids, readiness);
 *   - the **record, profile, prompt and marker stores** over one storage port;
 *   - the **id minter**, the cue channels, the per-driver storage facades and the backup.
 *
 * Three host shapes instantiate the same object with different ports: Electron main (an IPC renderer
 * host, no storage of its own), the shared background window and Web/Pocket (in-process renderer host,
 * IndexedDB storage). Nothing here knows which one it is in, which is what keeps a "main-only" shortcut
 * from creeping into the middle of the design.
 */
import type {
  ContractResult,
  CueAck,
  CueChannel,
  CueEnvelopeInput,
  CueSendOptions,
  CueSink,
  CueTransactionReceipt,
  HostLogger,
  HostPromptService,
  HostRegistryClient,
  HostStorageInterface,
  ModelDriverId,
  MountRegistrationResult,
  OperationNonce,
} from '../../contract'
import type { DriverStorageHub, WindowStorage } from '../storage'
import type { BrokerScheduler } from './broker'
import type { PromptStore } from './prompts'
import type { HostRecordStores } from './records'
import type { DriverRegistry, DriverStateSnapshot, DriverTableEntry, RendererHostPort } from './registry'

import { ContractFailureCode, MountRegistrationRefusal } from '../../contract'
import { createSilentLogger } from '../logging'
import { createDriverStorage, createDriverStorageHub } from '../storage'
import { createCueBroker } from './broker'
import { createIdMinter } from './ids'
import { HOST_STORAGE_KEYS } from './keys'
import { createMountRegistry } from './mounts'
import { createPromptStore } from './prompts'
import { createHostRecordStores } from './records'
import { createDriverRegistry } from './registry'

export interface HostCoreDependencies {
  /** Where host records live. A renderer passes IndexedDB; main passes nothing but its own state file. */
  storage: WindowStorage
  /** What can run a driver's renderer code, and how a window is asked for it. */
  rendererHost: RendererHostPort
  logger?: HostLogger
  scheduler?: BrokerScheduler
  /** Persisted host state (flags, rows, retention) read at startup. */
  state?: DriverStateSnapshot
  /** Called whenever the persisted part of host state changes. Main writes `state.json` from this. */
  persistState?: (snapshot: DriverStateSnapshot) => void
  /** Default transaction deadline; see `DEFAULT_CUE_TIMEOUT_MS`. */
  defaultTimeoutMs?: number
}

/** One key of a backup, value included: the host is a custodian, so it copies what it holds verbatim. */
export interface HostBackupEntry {
  key: string
  value: unknown
}

export interface HostBackup {
  version: 1
  createdAt: number
  entries: HostBackupEntry[]
  /** Flags, rows and retention: the part of host state that lives in `state.json` rather than in storage. */
  state: DriverStateSnapshot
}

export interface HostCore {
  readonly mounts: ReturnType<typeof createMountRegistry>
  readonly registry: DriverRegistry
  readonly broker: ReturnType<typeof createCueBroker>
  readonly records: HostRecordStores
  readonly prompts: PromptStore
  /** Read the table and create the managers. Called once, at startup. */
  start: (entries: DriverTableEntry[]) => Promise<void>
  /** The client a renderer adapter holds. `windowId` is the sender's own, never the request's. */
  registryClient: (windowId: string) => HostRegistryClient
  /** The cue channel a renderer adapter holds. One per window, so one bus per window. */
  cueChannel: (windowId: string) => CueChannel
  /** One driver's own storage, isolated by construction. */
  driverStorage: (driverId: ModelDriverId) => HostStorageInterface
  /**
   * The prompt service a driver is activated with.
   *
   * A thin wrapper rather than the store: the contract's `publish` returns `void`, so a rejected
   * publication is logged here instead of being silently dropped.
   */
  promptService: (driverId: ModelDriverId) => HostPromptService
  /** Mint a model id. One minter for the whole host, so two windows cannot hand out the same value. */
  mintModelId: () => string
  /** Mint a profile id, under the same rule. */
  mintProfileId: () => string
  /** A window went away: drop its mounts, forget its channels and settle what it left behind. */
  windowClosed: (windowId: string) => Promise<void>
  /** Settle everything pending and release the managers. */
  shutdown: () => Promise<void>
  /** Every host record plus the persisted state, verbatim. */
  backup: () => Promise<HostBackup>
  /** Write a backup back. Leaves a live registry's flags alone; they apply on the next `start`. */
  restore: (backup: HostBackup) => Promise<ContractResult<void>>
  /** Observe host-level changes (declarations, flags, rows, managers). */
  onEvent: DriverRegistry['onEvent']
}

export function createHostCore(deps: HostCoreDependencies): HostCore {
  const logger = deps.logger ?? createSilentLogger()
  const scheduler = deps.scheduler
  const now = scheduler?.now ?? Date.now

  const mounts = createMountRegistry({ now })
  const records = createHostRecordStores(deps.storage)
  const prompts = createPromptStore(deps.storage)
  const hub: DriverStorageHub = createDriverStorageHub()
  const minter = createIdMinter()

  /** Settlements that arrived before the channel that was waiting for them. */
  const earlySettlements = new Map<string, ContractResult<CueAck>>()
  /** The promise a caller is awaiting, per window and correlation value. */
  const waiting = new Map<string, (result: ContractResult<CueAck>) => void>()
  /** Observation sinks, per window. Never a delivery path: a mount gets its own envelope from the driver. */
  const observers = new Map<string, Set<CueSink>>()

  let shuttingDown = false
  // Assigned below, after the broker that refers to it: the two objects call into each other, so one of them has
  // to be declared first without a value. The registry is the later one, which keeps `createCueBroker`'s
  // dependency list visible before it.
  let registry: DriverRegistry

  const settlementKey = (windowId: string, nonce: OperationNonce) => `${windowId}\u0000${nonce}`

  const publishState = () => {
    if (!deps.persistState)
      return
    try {
      deps.persistState(registry.snapshot())
    }
    catch (error) {
      logger.warn('model-drivers', 'Failed to persist host state', error)
    }
  }

  const broker = createCueBroker({
    mounts,
    getManager: driverId => registry.get(driverId),
    isDriverKnown: driverId => registry.isKnown(driverId),
    scheduler,
    defaultTimeoutMs: deps.defaultTimeoutMs,
    logger,
    deliver: (windowId, nonce, result) => {
      const key = settlementKey(windowId, nonce)
      const resolve = waiting.get(key)
      if (resolve) {
        waiting.delete(key)
        resolve(result)
        return
      }
      // A settlement that found nobody waiting is still kept briefly: a caller that attaches its
      // resolver a tick late (an RPC round-trip in main) must not lose the answer.
      earlySettlements.set(key, result)
      if (earlySettlements.size > 256) {
        const oldest = earlySettlements.keys().next()
        if (!oldest.done)
          earlySettlements.delete(oldest.value)
      }
    },
  })

  // A mount changing state is what makes a queued transaction deliverable, and it is also how a
  // readiness report becomes something a waiting caller can act on.
  mounts.onChanged(() => broker.pump())

  registry = createDriverRegistry({
    mounts,
    rendererHost: deps.rendererHost,
    logger,
    now,
  })

  registry.onEvent((event) => {
    if (event.kind === 'flags' || event.kind === 'rows')
      publishState()
  })

  const host: HostCore = {
    mounts,
    registry,
    broker,
    records,
    prompts,

    async start(entries) {
      await registry.load(entries, deps.state)
      publishState()
    },

    registryClient(windowId) {
      return {
        async registerMount(request): Promise<MountRegistrationResult> {
          if (shuttingDown)
            return { ok: false, reason: MountRegistrationRefusal.SHUTTING_DOWN }
          if (!registry.isEnabled(request.driverId))
            return { ok: false, reason: MountRegistrationRefusal.DRIVER_DISABLED }

          // The sender's window identity wins over the request's: a renderer cannot register a mount in
          // another window, so a forged `windowId` has no value to forge.
          const descriptor = await mounts.issue({
            driverId: request.driverId,
            surface: request.surface,
            purpose: request.purpose,
            windowId,
          })
          return { ok: true, mountId: descriptor.mountId }
        },

        withdraw: request => broker.withdraw(request),
      }
    },

    cueChannel(windowId) {
      return {
        async send(input: CueEnvelopeInput, options?: CueSendOptions): Promise<ContractResult<CueTransactionReceipt>> {
          const submitted = await broker.submit(windowId, input, options)
          if (!submitted.ok)
            return submitted

          const { nonce, envelope, immediate } = submitted.value

          // Observers see the envelope, never its settlement: `CueChannel.subscribe` is an observation
          // feed (RFC §9.5), and a mount receives cues from its own driver, not from this bus.
          for (const observer of observers.get(windowId) ?? []) {
            try {
              void observer.handle(envelope)
            }
            catch {
              // An observer is not allowed to break a send it is only watching.
            }
          }

          if (immediate) {
            const key = settlementKey(windowId, nonce)
            earlySettlements.delete(key)
            return { ok: true, value: { nonce, settled: Promise.resolve(immediate) } }
          }

          const key = settlementKey(windowId, nonce)
          const early = earlySettlements.get(key)
          if (early) {
            earlySettlements.delete(key)
            return { ok: true, value: { nonce, settled: Promise.resolve(early) } }
          }

          const settled = new Promise<ContractResult<CueAck>>((resolve) => {
            waiting.set(key, resolve)
          })
          return { ok: true, value: { nonce, settled } }
        },

        subscribe(handler) {
          const bucket = observers.get(windowId) ?? new Set<CueSink>()
          bucket.add(handler)
          observers.set(windowId, bucket)
          return () => {
            bucket.delete(handler)
            if (bucket.size === 0)
              observers.delete(windowId)
          }
        },
      }
    },

    driverStorage(driverId) {
      return createDriverStorage({ store: deps.storage, driverId, hub })
    },

    promptService(driverId) {
      return {
        publish: (publication) => {
          void prompts.publish(publication).then((result) => {
            if (!result.ok) {
              logger.error(
                'model-drivers',
                `Driver \`${driverId}\` published an invalid prompt: ${result.error.message}`,
              )
              return
            }
            if (result.value.state === 'stale') {
              logger.warn(
                'model-drivers',
                `Driver \`${driverId}\` published a prompt for \`${publication.modelId}/${publication.profileId}\` that is not newer than the held one; discarded`,
              )
            }
          })
        },
        // A resolved prompt is handed back to a driver only where the host has an arbitration surface to resolve
        // one from; that surface is Phase 2 (§5.4), and this core is the in-process host a Web or Pocket build
        // would use. Accepted and never called until then — the same shape as `pointer` (P1-D14) — rather than
        // absent, so the contract's channel is satisfiable by every host.
        onResolution: () => () => {},
      }
    },

    mintModelId: () => minter.mintModelId(),
    mintProfileId: () => minter.mintProfileId(),

    async windowClosed(windowId) {
      // Order matters. The transactions are settled **before** the mounts are dropped, because
      // `unregisterWindow` emits a change that pumps the broker — and a pump with no candidates would
      // settle a queued transaction `NO_TARGET`, reporting "nothing ever matched" for work that was
      // waiting on the very window that has just gone away.
      const affected = new Set((await mounts.findBy({ windowId })).map(mount => mount.modelDriverId))
      broker.windowClosed({ windowId, drivers: affected })

      // Nobody can await a transaction whose window is gone, but a caller that still holds the promise in
      // another context (a service in main) must not be left hanging. Anything left here was unknown to the
      // broker, which should not happen; the honest answer is still "that window went away".
      for (const [key, resolve] of [...waiting]) {
        if (!key.startsWith(`${windowId}\u0000`))
          continue
        waiting.delete(key)
        resolve({
          ok: false,
          error: { code: ContractFailureCode.WINDOW_GONE, message: `Window \`${windowId}\` went away` },
        })
      }

      await mounts.unregisterWindow(windowId)

      registry.forgetManagerChannels(windowId)

      observers.delete(windowId)
    },

    async shutdown() {
      shuttingDown = true
      broker.shutdown()
      for (const [key, resolve] of [...waiting]) {
        waiting.delete(key)
        resolve({
          ok: false,
          error: { code: ContractFailureCode.ABORTED, message: 'The host is shutting down' },
        })
      }
      await registry.release()
      observers.clear()
    },

    async backup() {
      const keys = await deps.storage.keys(HOST_STORAGE_KEYS.root)
      const entries: HostBackupEntry[] = []
      for (const key of keys) {
        const value = await deps.storage.get(key)
        if (value !== undefined)
          entries.push({ key, value })
      }
      return { version: 1, createdAt: now(), entries, state: registry.snapshot() }
    },

    async restore(backup) {
      if (backup.version !== 1) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.INVALID_PACKAGE,
            message: `Unsupported host backup version ${String(backup.version)}; this build understands version 1`,
          },
        }
      }

      for (const entry of backup.entries)
        await deps.storage.set(entry.key, entry.value)

      // Rows are a display cache and can be restored live. Flags and retention are read by `start`, so a
      // running registry keeps the flags the user has set since boot.
      registry.primeRows(backup.state.rows, backup.state.rowsUpdatedAt)
      return { ok: true, value: undefined }
    },

    onEvent: handler => registry.onEvent(handler),
  }

  return host
}
