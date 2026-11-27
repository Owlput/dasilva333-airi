/**
 * The broker's transaction table, from every side a caller can reach it.
 *
 * The assertions are written against §4.4's steps rather than against the implementation: an envelope is
 * validated before anything is delivered, a target resolves to the mounts that match, a settlement happens
 * exactly once, and every withdrawal kind answers per §9.7's table. Where the contract and the plan disagree
 * — `window-gone` versus `aborted` — the contract wins, and the test says which one it is asserting.
 */
import { describe, expect, it } from 'vitest'

import {
  ContractFailureCode,
  CUE_WITHDRAWAL_LIMITS,
  CueRejection,
  CueTransactionState,
  CueWithdrawalKind,
  CueWithdrawalOutcome,
  RendererMountPurpose,
  RendererMountReadinessState,
  RendererMountSurfaceKind,
} from '../../contract'
import { createTestHost, envelope, unwrap } from '../testing/harness'
import { STUB_DRIVER_ID } from '../testing/stub-driver'

async function setup(options: Parameters<typeof createTestHost>[0] = {}) {
  const host = await createTestHost(options)
  const window = host.openWindow('control-strip')
  return { host, window }
}

/**
 * An envelope assembled past the type system, for the validator tests.
 *
 * `source` and `override` are supplied here so each case only states what it is breaking.
 */
function raw(partial: Record<string, unknown>) {
  return {
    source: 'host',
    override: false,
    ...partial,
  } as never
}

/**
 * Hold every delivery inside `running` until the returned function is called.
 *
 * `running` is the state the withdrawal rules turn on — it is what separates `cancel` from `abort` and
 * "the running transaction" from the queue — and the stub only reaches it while `deliver` awaits this gate.
 */
function holdDelivery(host: { driver: { deliverGate?: Promise<void> } }): () => void {
  let open: () => void = () => {}
  host.driver.deliverGate = new Promise<void>((resolve) => {
    open = resolve
  })
  return open
}

describe('cue broker', () => {
  it('settles a transaction with no matching mount as NO_TARGET, without delivering anything', async () => {
    const { host, window } = await setup()
    await window.mount({ surface: 'stage', purpose: 'stage' })

    const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
    const settled = unwrap(await receipt.settled)

    // A settled, successful transaction with `handled: false` — an answer, not an error.
    expect(settled.handled).toBe(false)
    expect(settled.results).toEqual([{ status: 'rejected', reason: CueRejection.NO_TARGET }])
    expect(settled.nonce).toBe(receipt.nonce)
    expect(settled.modelDriverId).toBe(STUB_DRIVER_ID)
    expect(host.driver.delivered).toHaveLength(0)
  })

  it('refuses a structurally invalid envelope before anything is delivered', async () => {
    const { host, window } = await setup()
    await window.mount({ surface: 'acting', purpose: 'acting' })

    // These payloads are deliberately beyond the type system: an envelope arrives from another process, so
    // the validator is the only thing standing between a malformed transaction and a renderer.
    const empty = await window.cueChannel.send(raw({
      cues: [],
      target: { modelDriverId: STUB_DRIVER_ID },
    }))
    expect(empty.ok).toBe(false)
    if (!empty.ok)
      expect(empty.error.code).toBe(ContractFailureCode.INVALID_ENVELOPE)

    // Capture must be alone: its failure is a whole-send error.
    const mixed = await window.cueChannel.send(raw({
      cues: [{ kind: 'capture' }, { kind: 'act', actToken: 'happy' }],
      target: { modelDriverId: STUB_DRIVER_ID },
    }))
    expect(mixed.ok).toBe(false)

    // A transient load is not expressible.
    const transient = await window.cueChannel.send(raw({
      cues: [{ kind: 'load', modelId: 'model_x' }],
      persistent: false,
      target: { modelDriverId: STUB_DRIVER_ID },
    }))
    expect(transient.ok).toBe(false)

    expect(host.driver.delivered).toHaveLength(0)
  })

  it('refuses an envelope addressed to a driver the host does not know', async () => {
    const { window } = await setup()
    const result = await window.cueChannel.send(raw({
      cues: [{ kind: 'act', actToken: 'happy' }],
      target: { modelDriverId: 'ai.moeru.airi.not-installed' },
    }))

    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.code).toBe(ContractFailureCode.INVALID_ENVELOPE)
  })

  it('mints one correlation value per transaction and honours a pinned one', async () => {
    const { window } = await setup()
    await window.mount({ surface: 'acting', purpose: 'acting' })

    const first = unwrap(await window.cueChannel.send(envelope('acting')))
    const second = unwrap(await window.cueChannel.send(envelope('acting')))
    expect(second.nonce).toBeGreaterThan(first.nonce)

    const pinned = unwrap(await window.cueChannel.send({ ...envelope('acting'), nonce: 9001 }))
    expect(pinned.nonce).toBe(9001)
    const ack = unwrap(await pinned.settled)
    expect(ack.nonce).toBe(9001)

    // A pinned value that is already in the table would give two transactions one correlation, so it is
    // refused rather than silently renumbered.
    const duplicate = await window.cueChannel.send({ ...envelope('acting'), nonce: 9001 })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok)
      expect(duplicate.error.code).toBe(ContractFailureCode.INVALID_ENVELOPE)
  })

  it('delivers only to the mounts the target matches', async () => {
    const { host, window } = await setup()
    const acting = await window.mount({ surface: 'acting', purpose: 'acting' })
    const stage = await window.mount({ surface: 'stage', purpose: 'stage' })

    unwrap(await unwrap(await window.cueChannel.send(envelope('acting'))).settled)

    expect(acting.mount.received).toHaveLength(1)
    // The stage mount shares the window and the driver, and still receives nothing: `purpose` is what
    // separates the two live stages, and nothing may fall back to "the" mount.
    expect(stage.mount.received).toHaveLength(0)
    expect(host.driver.delivered).toHaveLength(1)
  })

  it('drops a transaction addressed at a mount that is not ready, when asked', async () => {
    const { host, window } = await setup()
    const mounting = await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

    const receipt = unwrap(await window.cueChannel.send(envelope('acting'), { dropIfNotReady: true }))
    const ack = unwrap(await receipt.settled)

    expect(ack.handled).toBe(false)
    expect(ack.results).toEqual([{ status: 'rejected', reason: CueRejection.RENDERER_NOT_READY }])
    expect(mounting.mount.received).toHaveLength(0)
    expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.CANCELLED)
  })

  it('waits for a mount that is not ready yet, then delivers in FIFO order', async () => {
    const { host, window } = await setup()
    const { mountId, mount } = await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

    const first = unwrap(await window.cueChannel.send(envelope('acting')))
    const second = unwrap(await window.cueChannel.send(envelope('acting')))
    expect(host.core.broker.pendingCount()).toBe(2)
    expect(mount.received).toHaveLength(0)

    mount.moveTo(RendererMountReadinessState.READY_FOR_MODEL)
    await host.core.mounts.update(mountId, { readiness: RendererMountReadinessState.READY_FOR_MODEL })

    const firstAck = unwrap(await first.settled)
    const secondAck = unwrap(await second.settled)
    expect(firstAck.handled).toBe(true)
    expect(secondAck.handled).toBe(true)

    expect(host.driver.delivered).toHaveLength(2)
    expect(host.driver.delivered[0].nonce).toBe(first.nonce)
    expect(host.driver.delivered[1].nonce).toBe(second.nonce)
  })

  it('settles a transaction whose deadline passes without leaving the caller waiting', async () => {
    const { host, window } = await setup()
    await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

    const receipt = unwrap(await window.cueChannel.send(envelope('acting'), { timeoutMs: 500 }))
    await host.scheduler.advance(500)

    const settled = await receipt.settled
    expect(settled.ok).toBe(false)
    if (!settled.ok)
      expect(settled.error.code).toBe(ContractFailureCode.TIMEOUT)
    expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.ERROR)
    expect(host.core.broker.pendingCount()).toBe(0)
  })

  it('discards an ack attributed to another driver instead of settling with it', async () => {
    const { host, window } = await setup()
    await window.mount({ surface: 'acting', purpose: 'acting' })

    // A driver that answers for someone else is forged or misrouted; the transaction must fail rather
    // than report another driver's outcome to the caller.
    host.driver.failures.misattributeAck = 'driver'
    const forged = unwrap(await window.cueChannel.send(envelope('acting')))
    const settled = await forged.settled
    expect(settled.ok).toBe(false)
    if (!settled.ok)
      expect(settled.error.message).toContain('named driver')

    // The same rule for a correlation value this transaction never had.
    host.driver.failures.misattributeAck = 'nonce'
    const wrongNonce = unwrap(await window.cueChannel.send(envelope('acting')))
    const wrongSettled = await wrongNonce.settled
    expect(wrongSettled.ok).toBe(false)
  })

  describe('window gone', () => {
    it('settles a delivered transaction with window-gone', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })

      // Hold the delivery in `running`, then take the window away.
      let open: () => void = () => {}
      host.driver.deliverGate = new Promise<void>((resolve) => {
        open = resolve
      })

      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.RUNNING)

      await window.close()

      const settled = await receipt.settled
      expect(settled.ok).toBe(false)
      if (!settled.ok)
        expect(settled.error.code).toBe(ContractFailureCode.WINDOW_GONE)

      // Releasing the gate afterwards must not resurrect the transaction.
      open()
      await Promise.resolve()
      expect(host.core.broker.pendingCount()).toBe(0)
    })

    it('settles an undelivered transaction as cancelled', async () => {
      const { window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
      await window.close()

      const settled = await receipt.settled
      expect(settled.ok).toBe(false)
      if (!settled.ok)
        expect(settled.error.code).toBe(ContractFailureCode.CANCELLED)
    })

    it('drops the mounts of the window that went away', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })
      expect(await host.core.mounts.list()).toHaveLength(1)

      await window.close()
      expect(await host.core.mounts.list()).toHaveLength(0)
    })
  })

  it('settles every pending transaction aborted when the host shuts down', async () => {
    const { host } = await setup()
    const window = host.openWindow('acting-window')
    await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

    const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
    await host.core.shutdown()

    const settled = await receipt.settled
    expect(settled.ok).toBe(false)
    if (!settled.ok)
      expect(settled.error.code).toBe(ContractFailureCode.ABORTED)
  })

  describe('withdrawals', () => {
    it('cancels a transaction that has not started', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.CANCEL,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [receipt.nonce],
      }))

      expect(report.results).toEqual([
        { nonce: receipt.nonce, state: CueTransactionState.QUEUED, outcome: CueWithdrawalOutcome.CANCELLED },
      ])
      const settled = await receipt.settled
      expect(settled.ok).toBe(false)
      if (!settled.ok)
        expect(settled.error.code).toBe(ContractFailureCode.CANCELLED)
      expect(host.core.broker.pendingCount()).toBe(0)
    })

    it('refuses to cancel a transaction that is already running', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })

      let open: () => void = () => {}
      host.driver.deliverGate = new Promise<void>((resolve) => {
        open = resolve
      })

      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.CANCEL,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [receipt.nonce],
      }))

      expect(report.results[0].outcome).toBe(CueWithdrawalOutcome.RUNNING)
      // `cancel` never stops started work: the transaction is still running.
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.RUNNING)

      open()
      expect(unwrap(await receipt.settled).handled).toBe(true)
    })

    it('abort-current withdraws the running transaction', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })

      let open: () => void = () => {}
      host.driver.deliverGate = new Promise<void>((resolve) => {
        open = resolve
      })
      await window.cueChannel.send(envelope('acting'))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT_CURRENT,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toHaveLength(1)
      expect(report.results[0].outcome).toBe(CueWithdrawalOutcome.REQUESTED)
      open()
    })

    it('pops the newest queued transaction and pops all of them', async () => {
      const { window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

      const first = unwrap(await window.cueChannel.send(envelope('acting')))
      const second = unwrap(await window.cueChannel.send(envelope('acting')))

      const popped = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))
      expect(popped.results[0].nonce).toBe(second.nonce)

      const all = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP_ALL,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))
      expect(all.results).toHaveLength(1)
      expect(all.results[0].nonce).toBe(first.nonce)

      // Nothing queued and nothing named: the request answered `empty`, which is a success.
      const nothing = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP_ALL,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))
      expect(nothing.results[0].outcome).toBe(CueWithdrawalOutcome.EMPTY)
    })

    it('dumps every non-terminal transaction of the receiver', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.DUMP,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.count).toBeGreaterThanOrEqual(1)
      expect(report.results.some(result => result.outcome === CueWithdrawalOutcome.CANCELLED)).toBe(true)
      expect(host.core.broker.pendingCount()).toBe(0)
      const settled = await receipt.settled
      expect(settled.ok).toBe(false)
    })

    it('answers unknown for a correlation it never held', async () => {
      const { window } = await setup()
      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.CANCEL,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [424242],
      }))
      expect(report.results[0]).toMatchObject({ nonce: 424242, outcome: CueWithdrawalOutcome.UNKNOWN })
    })

    it('refuses a request outside the declared bounds', async () => {
      const { window } = await setup()
      const nonces = Array.from({ length: 65 }, (_, index) => index + 1)
      const result = await window.registryClient.withdraw({
        kind: CueWithdrawalKind.CANCEL,
        modelDriverId: STUB_DRIVER_ID,
        nonces,
      })
      expect(result.ok).toBe(false)
    })

    it('refuses a pop that names correlations instead of an address', async () => {
      const { window } = await setup()
      const result = await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [1],
      })
      expect(result.ok).toBe(false)
    })

    it('refuses a withdrawal that names no target, and withdraws nothing', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))

      const result = await window.registryClient.withdraw(raw({
        kind: CueWithdrawalKind.CANCEL,
        modelDriverId: STUB_DRIVER_ID,
      }))

      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error.code).toBe(ContractFailureCode.INVALID_ENVELOPE)
      expect(host.core.broker.pendingCount()).toBe(1)
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.QUEUED)
    })

    // ---- `abort` --------------------------------------------------------------
    //
    // The only kind whose running case is decided by the driver: the host asks, and the transaction
    // settles with whatever the driver answers. §9.7 has a result row for all four states of a target,
    // so all four are asserted.

    it('abort cancels work that has not started', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [receipt.nonce],
      }))

      expect(report.results).toEqual([
        { nonce: receipt.nonce, state: CueTransactionState.QUEUED, outcome: CueWithdrawalOutcome.CANCELLED },
      ])
      expect(report.count).toBe(1)
      expect(host.core.broker.pendingCount()).toBe(0)
      const settled = await receipt.settled
      expect(settled.ok).toBe(false)
      if (!settled.ok)
        expect(settled.error.code).toBe(ContractFailureCode.CANCELLED)
    })

    it('abort asks the running transaction to stop, and the driver decides how it settles', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const open = holdDelivery(host)

      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [receipt.nonce],
      }))

      expect(report.results).toEqual([
        { nonce: receipt.nonce, state: CueTransactionState.RUNNING, outcome: CueWithdrawalOutcome.REQUESTED },
      ])
      // `requested` is a request, not a stop: nothing has settled, and the transaction is still running.
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.RUNNING)

      open()
      // The stub finishes the work it was doing, so its own outcome is the settlement — not `aborted`.
      expect(unwrap(await receipt.settled).handled).toBe(true)
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.COMPLETE)
    })

    it('abort reports a transaction that already settled as it settled', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
      unwrap(await receipt.settled)

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [receipt.nonce],
      }))

      expect(report.results).toEqual([
        { nonce: receipt.nonce, state: CueTransactionState.COMPLETE, outcome: CueWithdrawalOutcome.SETTLED },
      ])
      // A terminal transaction is not withdrawn again: the answer reports the state it reached.
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.COMPLETE)
    })

    it('an address selects what it names, so a withdrawal cannot reach another purpose', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const queued = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.CANCEL,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.CHAT },
      }))

      // Nothing matched: one placeholder, and the work that exists is untouched.
      expect(report.results).toEqual([{ outcome: CueWithdrawalOutcome.EMPTY }])
      expect(report.count).toBe(1)
      expect(host.core.broker.stateOf(queued.nonce)).toBe(CueTransactionState.QUEUED)
      expect(host.core.broker.pendingCount()).toBe(1)
    })

    // ---- `abort-current` ------------------------------------------------------

    it('abort-current answers empty when nothing is running, and leaves the queue in place', async () => {
      const { host, window } = await setup()
      const { mountId, mount } = await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT_CURRENT,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toEqual([{ outcome: CueWithdrawalOutcome.EMPTY }])
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.QUEUED)

      // Still queued, so it renders once the mount is ready: `abort-current` touched nothing.
      mount.moveTo(RendererMountReadinessState.READY_FOR_MODEL)
      await host.core.mounts.update(mountId, { readiness: RendererMountReadinessState.READY_FOR_MODEL })
      expect(unwrap(await receipt.settled).handled).toBe(true)
    })

    it('abort-current asks the oldest running transaction to stop and does not repeat itself', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const open = holdDelivery(host)

      // Delivery is ordered per driver but does not wait for completion, so two transactions of one
      // driver can be running at once. "The running transaction" then has to mean one of them, and the
      // broker takes the oldest.
      const first = unwrap(await window.cueChannel.send(envelope('acting')))
      const second = unwrap(await window.cueChannel.send(envelope('acting')))
      expect(host.core.broker.stateOf(second.nonce)).toBe(CueTransactionState.RUNNING)

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT_CURRENT,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toEqual([
        { nonce: first.nonce, state: CueTransactionState.RUNNING, outcome: CueWithdrawalOutcome.REQUESTED },
      ])
      // The second one was not asked to stop, and is still running.
      expect(host.core.broker.stateOf(second.nonce)).toBe(CueTransactionState.RUNNING)

      open()
      expect(unwrap(await first.settled).handled).toBe(true)
      expect(unwrap(await second.settled).handled).toBe(true)
    })

    it('abort-current answers only for the transaction that is running when the request lists others', async () => {
      // NOTICE: §9.7's request table names `abort-current` but its result table has no row for it, and
      // the rule above that table — "one result per target it was given or selected" — would ask for an
      // entry per named correlation. The broker answers for the running one only. Pinned here so the
      // reading has to change by decision rather than by drift.
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })
      const queued = unwrap(await window.cueChannel.send(envelope('acting')))

      await window.mount({ surface: 'acting', purpose: 'chat' })
      const open = holdDelivery(host)
      const running = unwrap(await window.cueChannel.send(envelope('chat')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.ABORT_CURRENT,
        modelDriverId: STUB_DRIVER_ID,
        nonces: [queued.nonce, running.nonce],
      }))

      expect(report.results).toEqual([
        { nonce: running.nonce, state: CueTransactionState.RUNNING, outcome: CueWithdrawalOutcome.REQUESTED },
      ])
      expect(report.count).toBe(1)
      expect(host.core.broker.stateOf(queued.nonce)).toBe(CueTransactionState.QUEUED)

      open()
      expect(unwrap(await running.settled).handled).toBe(true)
    })

    // ---- `pop`, `pop-all` and `dump` ------------------------------------------

    it('pop leaves a running transaction alone and answers empty', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const open = holdDelivery(host)
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      // `pop` is a question about the queue, and a running transaction is not in it.
      expect(report.results).toEqual([{ outcome: CueWithdrawalOutcome.EMPTY }])
      expect(host.core.broker.stateOf(receipt.nonce)).toBe(CueTransactionState.RUNNING)

      open()
      expect(unwrap(await receipt.settled).handled).toBe(true)
    })

    it('pop-all cancels the queue and leaves the running transaction alone', async () => {
      const { host, window } = await setup()
      // Two transactions of one driver with one address: one addressed at a mount that is not ready
      // (so it queues), one at a ready mount (so it runs). The address below matches on the purpose
      // they share, because that is what selection reads — a rendered mount is not consulted.
      await window.mount({ surface: 'stage', purpose: 'acting', readiness: 'mounting' })
      const queued = unwrap(await window.cueChannel.send({
        ...envelope('acting'),
        target: { modelDriverId: STUB_DRIVER_ID, surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.ACTING },
      }))
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const open = holdDelivery(host)
      const running = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP_ALL,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toEqual([
        { nonce: queued.nonce, state: CueTransactionState.QUEUED, outcome: CueWithdrawalOutcome.CANCELLED },
      ])
      expect(host.core.broker.stateOf(running.nonce)).toBe(CueTransactionState.RUNNING)
      expect(host.core.broker.pendingCount()).toBe(1)

      open()
      expect(unwrap(await running.settled).handled).toBe(true)
    })

    it('dump cancels the queue and asks the running transaction to stop, in one report', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'stage', purpose: 'acting', readiness: 'mounting' })
      const queued = unwrap(await window.cueChannel.send({
        ...envelope('acting'),
        target: { modelDriverId: STUB_DRIVER_ID, surface: RendererMountSurfaceKind.STAGE, purpose: RendererMountPurpose.ACTING },
      }))
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const open = holdDelivery(host)
      const running = unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.DUMP,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toEqual([
        { nonce: queued.nonce, state: CueTransactionState.QUEUED, outcome: CueWithdrawalOutcome.CANCELLED },
        { nonce: running.nonce, state: CueTransactionState.RUNNING, outcome: CueWithdrawalOutcome.REQUESTED },
      ])
      expect(report.count).toBe(2)
      expect(host.core.broker.pendingCount()).toBe(1)

      open()
      expect(unwrap(await running.settled).handled).toBe(true)
    })

    it('dump reports a transaction that already settled, which §9.7 calls not applicable', async () => {
      // NOTICE: §9.7's result table leaves `dump`'s terminal row "not applicable", but the broker applies
      // one rule to every kind outside the queue and reports the state the transaction settled with.
      // Pinned here so the divergence is visible; matching the RFC is a decision, not a cleanup.
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting' })
      const receipt = unwrap(await window.cueChannel.send(envelope('acting')))
      unwrap(await receipt.settled)

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.DUMP,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toEqual([
        { nonce: receipt.nonce, state: CueTransactionState.COMPLETE, outcome: CueWithdrawalOutcome.SETTLED },
      ])
      expect(host.core.broker.pendingCount()).toBe(0)
    })

    it('caps a report at the declared limit and still counts every target', async () => {
      const { host, window } = await setup()
      await window.mount({ surface: 'acting', purpose: 'acting', readiness: 'mounting' })

      const total = CUE_WITHDRAWAL_LIMITS.maxReportEntries + 1
      for (let index = 0; index < total; index += 1)
        unwrap(await window.cueChannel.send(envelope('acting')))

      const report = unwrap(await window.registryClient.withdraw({
        kind: CueWithdrawalKind.POP_ALL,
        modelDriverId: STUB_DRIVER_ID,
        address: { purpose: RendererMountPurpose.ACTING },
      }))

      expect(report.results).toHaveLength(CUE_WITHDRAWAL_LIMITS.maxReportEntries)
      expect(report.count).toBe(total)
      expect(report.truncated).toBe(true)
      // Every one of them was withdrawn; only the report is short.
      expect(host.core.broker.pendingCount()).toBe(0)
    })
  })
})
