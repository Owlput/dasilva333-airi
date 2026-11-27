/**
 * The cue broker and its transaction table (RFC 0002 §4.2, §9.3, §9.6, §9.7; plan §4.4).
 *
 * This is the piece that makes "one renderer can be mounted many times" work. A caller does not talk to
 * a mount: it sends a **transaction** addressed to a driver plus a surface/purpose, the broker mints its
 * correlation value, finds the mounts that match, and settles exactly once.
 *
 * Four separations decide the whole design:
 *
 *   - **acceptance is not settlement** (§9.3). `submit` answers immediately with a correlation value; the
 *     outcome arrives later on the endpoint's settlement channel. A caller that only wants
 *     fire-and-forget ignores the second half, and one that wants the answer awaits it — but neither ever
 *     blocks acceptance on a model load.
 *   - **addressing is not identity** (§9.2). A target names a driver and, optionally, a surface and a
 *     purpose. Nothing in this file accepts a mount id from a caller, so "a cue reached the wrong
 *     viewport" would have to be a selection this broker made.
 *   - **refusal is not failure.** `NO_TARGET`, `RENDERER_NOT_READY` and `SUPERSEDED` are settled,
 *     successful transactions with `handled: false`. An error is reserved for work that was attempted and
 *     broke — a malformed envelope, a driver with no manager, a deadline that passed.
 *   - **the broker does not fan out.** `ModelDriverManager.deliver` decides which mounts receive a
 *     transaction and how their outcomes combine (§4.4 step 5); the broker provides one ordered pipe per
 *     driver. The table therefore records a driver and a target, never a list of mounts.
 */
import type {
  ContractResult,
  CueAck,
  CueEnvelope,
  CueEnvelopeInput,
  CueSendOptions,
  CueWithdrawalReport,
  CueWithdrawalRequest,
  CueWithdrawalTargetResult,
  HostLogger,
  ModelDriverId,
  ModelDriverManager,
  OperationNonce,
  RendererMountDescriptor,
} from '../../contract'
import type { LiveMountRegistry } from './mounts'

import {
  ContractFailureCode,
  CUE_WITHDRAWAL_LIMITS,
  CueRejection,
  CueTransactionState,
  CueWithdrawalKind,
  CueWithdrawalOutcome,
  isTerminalTransactionState,
} from '../../contract'
import { assertAckShape, validateCueEnvelope, validateWithdrawalRequest } from '../../validate'
import { mountAcceptsCues } from './mounts'

/** Wall clock plus timers, injected so a deadline test does not have to wait for one. */
export interface BrokerScheduler {
  now: () => number
  setTimeout: (handler: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const defaultScheduler: BrokerScheduler = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

/**
 * How long a caller gets by default.
 *
 * Fifteen seconds is long enough for a model load on a slow disk and short enough that a caller which
 * forgot to pass a deadline still gets an answer instead of a promise that never settles. Capture is the
 * documented slow case and passes its own, shorter one.
 */
export const DEFAULT_CUE_TIMEOUT_MS = 15_000

/**
 * How long a terminal transaction stays in the table.
 *
 * Kept for a while rather than dropped on settlement, because a withdrawal request or a diagnostics
 * surface may ask about a correlation that has just finished; dropped eventually, because a long-running
 * app would otherwise accumulate one record per cue forever.
 */
export const TRANSACTION_RETENTION_MS = 60_000

/** How many terminal transactions the table may hold before the oldest is evicted regardless of age. */
export const TRANSACTION_TABLE_LIMIT = 512

export interface BrokerDependencies {
  mounts: LiveMountRegistry
  /** The manager of one driver, or `undefined` when the driver is known but has none. */
  getManager: (driverId: ModelDriverId) => ModelDriverManager | undefined
  /** Whether the driver exists at all. Distinguishes "unknown driver" from "driver with no manager". */
  isDriverKnown: (driverId: ModelDriverId) => boolean
  /**
   * The settlement channel to the window that submitted a transaction.
   *
   * Called once per **later** settlement. A transaction that settles inside `submit` is returned as
   * `immediate` and never reaches here, so a caller cannot receive the same outcome twice.
   */
  deliver: (windowId: string, nonce: OperationNonce, result: ContractResult<CueAck>) => void
  scheduler?: BrokerScheduler
  defaultTimeoutMs?: number
  logger?: HostLogger
}

export interface SubmitAccepted {
  nonce: OperationNonce
  /**
   * The envelope as the bus built it, with the correlation value and the bus's timestamp.
   *
   * Returned so a channel can hand it to its own observers without reconstructing a second value that
   * could disagree with what was delivered.
   */
  envelope: CueEnvelope
  /**
   * Present when the transaction settled before `submit` returned — a `NO_TARGET`, a `dropIfNotReady`
   * drop. An error is never immediate: it is the failure branch of `submit` itself.
   */
  immediate?: ContractResult<CueAck>
}

interface Transaction {
  nonce: OperationNonce
  driverId: ModelDriverId
  windowId: string
  envelope: CueEnvelope
  state: CueTransactionState
  acceptedAt: number
  deadlineAt: number
  timer?: unknown
  settled: boolean
  settledAt?: number
}

export interface WindowClosedInput {
  windowId: string
  /** Drivers that had a mount in the window that is going away. */
  drivers: ReadonlySet<ModelDriverId>
}

export interface CueBroker {
  /**
   * Accept one transaction.
   *
   * Validation, correlation minting and target resolution all happen here, so a malformed envelope is
   * refused before anything is delivered: no renderer ever sees a half-valid transaction.
   */
  submit: (windowId: string, input: CueEnvelopeInput, options?: CueSendOptions) => Promise<ContractResult<SubmitAccepted>>
  withdraw: (request: CueWithdrawalRequest) => Promise<ContractResult<CueWithdrawalReport>>
  /** A window went away (§4.4 step 8). */
  windowClosed: (input: WindowClosedInput) => void
  /** The host is going down: every non-terminal transaction settles `aborted`. */
  shutdown: () => void
  /** A mount changed state, so a queued transaction may now be deliverable. */
  pump: () => void
  /** Diagnostics: the state of one transaction, or `undefined` when it is not in the table. */
  stateOf: (nonce: OperationNonce) => CueTransactionState | undefined
  /** Diagnostics: how many transactions are not terminal. */
  pendingCount: () => number
}

export function createCueBroker(deps: BrokerDependencies): CueBroker {
  const scheduler = deps.scheduler ?? defaultScheduler
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_CUE_TIMEOUT_MS

  const transactions = new Map<OperationNonce, Transaction>()
  /** FIFO per driver: a transaction keeps its place while it waits for a ready mount. */
  const queues = new Map<ModelDriverId, OperationNonce[]>()
  let counter = 0

  const enqueue = (driverId: ModelDriverId, nonce: OperationNonce) => {
    const queue = queues.get(driverId) ?? []
    queue.push(nonce)
    queues.set(driverId, queue)
  }

  const dequeue = (driverId: ModelDriverId, nonce: OperationNonce) => {
    const queue = queues.get(driverId)
    if (!queue)
      return
    const index = queue.indexOf(nonce)
    if (index >= 0)
      queue.splice(index, 1)
    if (queue.length === 0)
      queues.delete(driverId)
  }

  const clearTimer = (transaction: Transaction) => {
    if (transaction.timer !== undefined) {
      scheduler.clearTimeout(transaction.timer)
      transaction.timer = undefined
    }
  }

  /** Mark a transaction terminal and hand its outcome to the endpoint. Idempotent by design. */
  const settle = (transaction: Transaction, result: ContractResult<CueAck>, state: CueTransactionState) => {
    if (transaction.settled)
      return
    transaction.settled = true
    transaction.state = state
    transaction.settledAt = scheduler.now()
    clearTimer(transaction)
    dequeue(transaction.driverId, transaction.nonce)
    deps.deliver(transaction.windowId, transaction.nonce, result)
  }

  /** Keep the table bounded: age out terminal records, then hard-cap them. */
  const prune = () => {
    const now = scheduler.now()
    for (const [nonce, transaction] of transactions) {
      if (transaction.settled && transaction.settledAt !== undefined && now - transaction.settledAt > TRANSACTION_RETENTION_MS)
        transactions.delete(nonce)
    }

    if (transactions.size <= TRANSACTION_TABLE_LIMIT)
      return

    const terminal = [...transactions.values()]
      .filter(transaction => transaction.settled)
      .sort((left, right) => (left.settledAt ?? 0) - (right.settledAt ?? 0))
    for (const transaction of terminal) {
      if (transactions.size <= TRANSACTION_TABLE_LIMIT)
        break
      transactions.delete(transaction.nonce)
    }
  }

  const matchingMounts = (envelope: CueEnvelope): RendererMountDescriptor[] =>
    deps.mounts.snapshot().filter((mount) => {
      if (mount.modelDriverId !== envelope.target.modelDriverId)
        return false
      if (envelope.target.surface !== undefined && mount.surface !== envelope.target.surface)
        return false
      if (envelope.target.purpose !== undefined && mount.purpose !== envelope.target.purpose)
        return false
      return true
    })

  const rejectedAck = (
    driverId: ModelDriverId,
    nonce: OperationNonce,
    reason: CueRejection,
    slotCount: number,
    message?: string,
  ): CueAck => ({
    nonce,
    modelDriverId: driverId,
    results: Array.from({ length: slotCount }, () => ({ status: 'rejected' as const, reason })),
    handled: false,
    ...(message ? { message } : {}),
  })

  const failure = (code: ContractFailureCode, message: string): ContractResult<never> => ({
    ok: false,
    error: { code, message },
  })

  /** Settle immediately with a successful transaction whose slots were all refused. */
  const settleAsRefused = (
    transaction: Transaction,
    reason: CueRejection,
    message: string,
  ): ContractResult<CueAck> => {
    const ack = rejectedAck(transaction.driverId, transaction.nonce, reason, transaction.envelope.cues.length, message)
    transaction.settled = true
    transaction.state = CueTransactionState.CANCELLED
    transaction.settledAt = scheduler.now()
    clearTimer(transaction)
    return { ok: true, value: ack }
  }

  /**
   * Deliver one transaction to its driver, if a mount of it can take the envelope now.
   *
   * Returns `false` when a mount exists but none is ready — the caller then decides whether to queue or
   * drop, which is why this is a predicate rather than a side effect.
   */
  const tryDeliver = (transaction: Transaction): boolean => {
    if (transaction.settled || transaction.state === CueTransactionState.RUNNING)
      return true

    const envelope = transaction.envelope
    const driverId = transaction.driverId

    const manager = deps.getManager(driverId)
    if (!manager) {
      // The driver went away between accept and delivery. Not a malformed envelope: a driver that is
      // gone is exactly what `driver-unavailable` names.
      settle(
        transaction,
        failure(ContractFailureCode.DRIVER_UNAVAILABLE, `No manager is registered for \`${driverId}\``),
        CueTransactionState.ERROR,
      )
      return true
    }

    const candidates = matchingMounts(envelope)

    if (candidates.length === 0) {
      // Nothing to wait for: this is the broker's own settled answer, delivered to the caller rather than
      // decided by the adapter.
      settle(
        transaction,
        {
          ok: true,
          value: rejectedAck(driverId, transaction.nonce, CueRejection.NO_TARGET, envelope.cues.length, 'No mount matches this target'),
        },
        CueTransactionState.CANCELLED,
      )
      return true
    }

    if (!candidates.some(mountAcceptsCues))
      return false

    transaction.state = CueTransactionState.RUNNING
    dequeue(driverId, transaction.nonce)

    void (async () => {
      let outcome: ContractResult<CueAck>
      try {
        const answer = await manager.deliver(envelope)
        if (!answer.ok) {
          outcome = answer
        }
        else {
          const shape = assertAckShape(answer.value, envelope.cues.length)
          if (!shape.ok) {
            outcome = shape
          }
          else if (shape.value.modelDriverId !== driverId || shape.value.nonce !== transaction.nonce) {
            // An ack that names another driver or another correlation is forged or misrouted. Settling
            // the caller with it would attribute one driver's outcome to another, so it is discarded and
            // the transaction fails cleanly instead of waiting for its deadline.
            outcome = failure(
              ContractFailureCode.INTERNAL,
              `An acknowledgement for transaction ${transaction.nonce} named driver \`${shape.value.modelDriverId}\` and nonce ${shape.value.nonce}`,
            )
          }
          else {
            outcome = answer
          }
        }
      }
      catch (error) {
        outcome = {
          ok: false,
          error: {
            code: ContractFailureCode.INTERNAL,
            message: `Driver \`${driverId}\` threw while delivering transaction ${transaction.nonce}`,
            cause: error,
          },
        }
      }

      settle(transaction, outcome, outcome.ok ? CueTransactionState.COMPLETE : CueTransactionState.ERROR)
    })()

    return true
  }

  /** Apply one withdrawal to what the broker still holds, per §9.7's result table. */
  const applyLocalWithdrawal = (request: CueWithdrawalRequest): CueWithdrawalTargetResult[] => {
    const driverId = request.modelDriverId
    const results: CueWithdrawalTargetResult[] = []

    const belongs = (transaction: Transaction): boolean => {
      if (transaction.driverId !== driverId)
        return false
      if (request.nonces)
        return request.nonces.includes(transaction.nonce)
      if (request.address) {
        if (request.address.surface !== undefined && transaction.envelope.target.surface !== request.address.surface)
          return false
        if (request.address.purpose !== undefined && transaction.envelope.target.purpose !== request.address.purpose)
          return false
        return true
      }
      return false
    }

    const selected = [...transactions.values()].filter(belongs).sort((left, right) => left.nonce - right.nonce)

    const cancelBeforeStart = (transaction: Transaction) => {
      results.push({ nonce: transaction.nonce, state: transaction.state, outcome: CueWithdrawalOutcome.CANCELLED })
      settle(
        transaction,
        failure(ContractFailureCode.CANCELLED, `Withdrawn by \`${request.kind}\` before it started`),
        CueTransactionState.CANCELLED,
      )
    }

    if (request.kind === CueWithdrawalKind.POP || request.kind === CueWithdrawalKind.POP_ALL) {
      // "Newest that has not started" is a question about the queue, and the not-started set is the queue.
      const queued = selected.filter(transaction => transaction.state === CueTransactionState.QUEUED)
      const targets = request.kind === CueWithdrawalKind.POP ? queued.slice(-1) : queued

      if (targets.length === 0) {
        results.push({ outcome: CueWithdrawalOutcome.EMPTY })
        return results
      }

      for (const transaction of targets)
        cancelBeforeStart(transaction)
      return results
    }

    for (const transaction of selected) {
      if (isTerminalTransactionState(transaction.state)) {
        results.push({ nonce: transaction.nonce, state: transaction.state, outcome: CueWithdrawalOutcome.SETTLED })
        continue
      }

      const running = transaction.state === CueTransactionState.RUNNING

      switch (request.kind) {
        case CueWithdrawalKind.CANCEL:
          // `cancel` never stops work that has started; the transaction continues untouched.
          if (running) {
            results.push({ nonce: transaction.nonce, state: transaction.state, outcome: CueWithdrawalOutcome.RUNNING })
          }
          else {
            cancelBeforeStart(transaction)
          }
          break

        case CueWithdrawalKind.ABORT:
        case CueWithdrawalKind.DUMP:
          if (running) {
            results.push({ nonce: transaction.nonce, state: transaction.state, outcome: CueWithdrawalOutcome.REQUESTED })
          }
          else {
            cancelBeforeStart(transaction)
          }
          break

        case CueWithdrawalKind.ABORT_CURRENT:
          // "The running transaction" is singular and it is the oldest one still running, so a second
          // call after it settles addresses the next one rather than repeating itself.
          if (running && results.every(result => result.outcome !== CueWithdrawalOutcome.REQUESTED))
            results.push({ nonce: transaction.nonce, state: transaction.state, outcome: CueWithdrawalOutcome.REQUESTED })
          break
      }
    }

    if (results.length === 0) {
      // Nothing was held. Answer per named correlation when the request named some, because "unknown"
      // and "already settled" are different facts about a specific value.
      if (request.nonces) {
        for (const nonce of request.nonces)
          results.push({ nonce, outcome: CueWithdrawalOutcome.UNKNOWN })
      }
      else {
        results.push({ outcome: CueWithdrawalOutcome.EMPTY })
      }
    }

    return results
  }

  const mergeReports = (
    request: CueWithdrawalRequest,
    local: CueWithdrawalTargetResult[],
    forwarded: CueWithdrawalReport,
  ): CueWithdrawalReport => {
    // One entry per target: the broker's outcome wins for a nonce it held, because it is the side that
    // observed the state; the manager's entries fill in everything the broker never saw.
    const byNonce = new Map<number, CueWithdrawalTargetResult>()

    for (const result of forwarded.results) {
      if (result.nonce !== undefined)
        byNonce.set(result.nonce, result)
    }
    for (const result of local) {
      if (result.nonce !== undefined)
        byNonce.set(result.nonce, result)
    }

    // Entries without a correlation value are placeholders — "nothing matched that selection" from one side
    // or the other — so at most one of them may survive. If the broker produced any result of its own, the
    // manager's placeholder is dropped: a second "empty" next to a real cancellation would read as a
    // contradictory answer to the same selection. Only when the broker had nothing at all does the
    // manager's report speak for the whole request.
    const localPlaceholders = local.filter(result => result.nonce === undefined)
    const forwardedPlaceholders = forwarded.results.filter(result => result.nonce === undefined)
    const rest = localPlaceholders.length > 0
      ? localPlaceholders
      : local.length === 0
        ? forwardedPlaceholders
        : []

    const merged = [...byNonce.values(), ...rest]
    const capped = merged.slice(0, CUE_WITHDRAWAL_LIMITS.maxReportEntries)
    return {
      kind: request.kind,
      results: capped,
      count: merged.length,
      ...(merged.length > capped.length ? { truncated: true } : {}),
    }
  }

  return {
    async submit(windowId, input, options = {}) {
      prune()

      const pinned = input.nonce
      if (pinned !== undefined) {
        if (transactions.has(pinned)) {
          return failure(
            ContractFailureCode.INVALID_ENVELOPE,
            `Correlation value ${pinned} is already in use; a nonce is minted by the host and is never reused`,
          )
        }
        counter = Math.max(counter, pinned)
      }
      counter += 1
      const nonce = pinned ?? counter

      const envelope = { ...input, nonce, at: scheduler.now() } as CueEnvelope
      const validated = validateCueEnvelope(envelope)
      if (!validated.ok)
        return validated

      const driverId = validated.value.target.modelDriverId
      if (!deps.isDriverKnown(driverId)) {
        // The driver set is a host fact, so an envelope naming a driver that does not exist is not
        // routable at all — and the contract's word for "not a transaction the host can route" is
        // `INVALID_ENVELOPE`.
        return failure(
          ContractFailureCode.INVALID_ENVELOPE,
          `No driver \`${driverId}\` is registered; a transaction is addressed to exactly one driver`,
        )
      }

      if (!deps.getManager(driverId))
        return failure(ContractFailureCode.DRIVER_UNAVAILABLE, `Driver \`${driverId}\` has no manager`)

      const now = scheduler.now()
      const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
      const transaction: Transaction = {
        nonce,
        driverId,
        windowId,
        envelope: validated.value,
        state: CueTransactionState.SUBMITTED,
        acceptedAt: now,
        deadlineAt: now + timeoutMs,
        settled: false,
      }
      transactions.set(nonce, transaction)

      transaction.timer = scheduler.setTimeout(() => {
        if (transaction.settled)
          return
        settle(
          transaction,
          failure(ContractFailureCode.TIMEOUT, `Transaction ${nonce} did not settle within ${timeoutMs}ms`),
          CueTransactionState.ERROR,
        )
      }, timeoutMs)

      const candidates = matchingMounts(envelope)

      if (candidates.length === 0)
        return { ok: true, value: { nonce, envelope: validated.value, immediate: settleAsRefused(transaction, CueRejection.NO_TARGET, 'No mount matches this target') } }

      if (!candidates.some(mountAcceptsCues)) {
        if (options.dropIfNotReady) {
          return {
            ok: true,
            value: {
              nonce,
              envelope: validated.value,
              immediate: settleAsRefused(transaction, CueRejection.RENDERER_NOT_READY, 'Dropped: the addressed mount is not ready'),
            },
          }
        }

        // Wait for readiness, in the driver's FIFO order, until a mount is ready or the deadline passes.
        transaction.state = CueTransactionState.QUEUED
        enqueue(driverId, nonce)
        return { ok: true, value: { nonce, envelope: validated.value } }
      }

      if (!tryDeliver(transaction)) {
        transaction.state = CueTransactionState.QUEUED
        enqueue(driverId, nonce)
      }

      return { ok: true, value: { nonce, envelope: validated.value } }
    },

    async withdraw(request) {
      const validated = validateWithdrawalRequest(request)
      if (!validated.ok)
        return validated
      const value = validated.value

      const manager = deps.getManager(value.modelDriverId)
      if (!manager)
        return failure(ContractFailureCode.DRIVER_UNAVAILABLE, `Driver \`${value.modelDriverId}\` has no manager`)

      // The manager is asked first, deliberately. It owns the receiver's queue and its answer can fail;
      // cancelling broker-held work first would leave a half-applied withdrawal behind on that failure,
      // with no way for the caller to tell what happened.
      let forward: ContractResult<CueWithdrawalReport>
      try {
        forward = await manager.withdraw(value)
      }
      catch (error) {
        return {
          ok: false,
          error: {
            code: ContractFailureCode.INTERNAL,
            message: `Driver \`${value.modelDriverId}\` threw while withdrawing`,
            cause: error,
          },
        }
      }
      if (!forward.ok)
        return forward

      return { ok: true, value: mergeReports(value, applyLocalWithdrawal(value), forward.value) }
    },

    windowClosed(input) {
      for (const transaction of transactions.values()) {
        if (transaction.settled)
          continue

        const delivered = transaction.state === CueTransactionState.RUNNING

        if (transaction.windowId === input.windowId) {
          // The caller is gone, so there is nobody left to tell; the code still records which half of the
          // contract applies — `window-gone` when the work had been delivered, `cancelled` when it never
          // started.
          settle(
            transaction,
            failure(
              delivered ? ContractFailureCode.WINDOW_GONE : ContractFailureCode.CANCELLED,
              `Window \`${input.windowId}\` went away`,
            ),
            delivered ? CueTransactionState.ABORTED : CueTransactionState.CANCELLED,
          )
          continue
        }

        if (delivered && input.drivers.has(transaction.driverId)) {
          // A mount of the addressing driver lived in the window that just closed, and this transaction
          // had already been handed to the driver. Nothing inside the window decided it: the window did.
          settle(
            transaction,
            failure(
              ContractFailureCode.WINDOW_GONE,
              `The window hosting driver \`${transaction.driverId}\` went away`,
            ),
            CueTransactionState.ABORTED,
          )
        }
      }
    },

    shutdown() {
      for (const transaction of transactions.values()) {
        if (transaction.settled)
          continue
        // A host restart is not a window closing: no mount decided this, and the app is going down.
        settle(
          transaction,
          failure(ContractFailureCode.ABORTED, 'The host is shutting down'),
          CueTransactionState.ABORTED,
        )
      }
    },

    pump() {
      // One pass per driver, in FIFO order, without waiting for completion: envelope ordering per driver
      // is what the contract promises, not one-at-a-time execution.
      for (const driverId of [...queues.keys()]) {
        const queue = queues.get(driverId)
        if (!queue)
          continue
        for (const nonce of [...queue]) {
          const transaction = transactions.get(nonce)
          if (!transaction || transaction.settled) {
            dequeue(driverId, nonce)
            continue
          }
          if (!tryDeliver(transaction))
            break
        }
      }
    },

    stateOf(nonce) {
      return transactions.get(nonce)?.state
    },

    pendingCount() {
      let count = 0
      for (const transaction of transactions.values()) {
        if (!isTerminalTransactionState(transaction.state))
          count += 1
      }
      return count
    },
  }
}
