import { describe, expect, it, vi } from 'vitest'

import {
  BACKGROUND_WINDOW_TAG,
  BACKGROUND_WINDOW_WEB_PREFERENCES,
  createBackgroundWindowLifecycle,
  isQuitRelevantWindow,
  shouldQuitNow,
} from './policy'

function createHarness(options: { failFirst?: boolean } = {}) {
  let alive = false
  let attempts = 0

  const start = vi.fn(async () => {
    attempts += 1
    if (options.failFirst && attempts === 1)
      return false
    alive = true
    return true
  })

  const close = vi.fn(async () => {
    alive = false
  })

  const lifecycle = createBackgroundWindowLifecycle({
    start,
    isAlive: () => alive,
    close,
  })

  return {
    lifecycle,
    start,
    close,
    isAlive: () => alive,
    closeByHand: () => {
      alive = false
    },
  }
}

describe('background window lifecycle', () => {
  it('is lazy: nothing starts until a consumer asks', () => {
    const harness = createHarness()

    expect(harness.start).not.toHaveBeenCalled()
    expect(harness.lifecycle.isStarted()).toBe(false)
    expect(harness.lifecycle.consumers()).toEqual([])
  })

  it('starts once and shares the start between concurrent consumers', async () => {
    const harness = createHarness()

    const [first, second] = await Promise.all([
      harness.lifecycle.acquire('manager'),
      harness.lifecycle.acquire('migration'),
    ])

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(harness.lifecycle.consumers()).toEqual(['manager', 'migration'])
  })

  it('treats one reason asked for twice as one consumer', async () => {
    const harness = createHarness()

    await harness.lifecycle.acquire('manager')
    await harness.lifecycle.acquire('manager')

    expect(harness.lifecycle.consumers()).toEqual(['manager'])
    expect(harness.start).toHaveBeenCalledTimes(1)
  })

  it('releases a claim, and releasing a claim it does not hold is a no-op', async () => {
    const harness = createHarness()

    await harness.lifecycle.acquire('migration')
    harness.lifecycle.release('migration')
    harness.lifecycle.release('never-claimed')

    expect(harness.lifecycle.consumers()).toEqual([])
    // Releasing a claim never closes the window: once started it lives until shutdown (D11).
    expect(harness.close).not.toHaveBeenCalled()
    expect(harness.lifecycle.isStarted()).toBe(true)
  })

  it('does not remember a failed start, so a later request may retry', async () => {
    const harness = createHarness({ failFirst: true })

    await expect(harness.lifecycle.acquire('manager')).resolves.toBe(false)
    await expect(harness.lifecycle.acquire('manager')).resolves.toBe(true)

    expect(harness.start).toHaveBeenCalledTimes(2)
  })

  it('starts a new window when the previous one went away', async () => {
    const harness = createHarness()

    await harness.lifecycle.acquire('manager')
    harness.closeByHand()

    expect(harness.lifecycle.isStarted()).toBe(false)

    await harness.lifecycle.acquire('manager')
    expect(harness.start).toHaveBeenCalledTimes(2)
  })

  it('closes once at shutdown, clears the claims and is idempotent', async () => {
    const harness = createHarness()

    await harness.lifecycle.acquire('manager')
    await Promise.all([harness.lifecycle.shutdown(), harness.lifecycle.shutdown()])

    expect(harness.close).toHaveBeenCalledTimes(1)
    expect(harness.lifecycle.consumers()).toEqual([])
    expect(harness.lifecycle.isStarted()).toBe(false)

    // A second shutdown after the first finished stays a no-op.
    await harness.lifecycle.shutdown()
    expect(harness.close).toHaveBeenCalledTimes(1)
  })

  it('does not close a window it never started', async () => {
    const harness = createHarness()

    await harness.lifecycle.shutdown()

    expect(harness.close).not.toHaveBeenCalled()
  })

  it('notifies observers on a claim and on shutdown', async () => {
    const harness = createHarness()
    const onChange = vi.fn()
    harness.lifecycle.onChange(onChange)

    await harness.lifecycle.acquire('manager')
    const afterStart = onChange.mock.calls.length
    await harness.lifecycle.shutdown()

    expect(afterStart).toBeGreaterThan(0)
    expect(onChange.mock.calls.length).toBeGreaterThan(afterStart)
  })
})

describe('the background window and the quit decision', () => {
  it('is never quit relevant, however it is created', () => {
    expect(isQuitRelevantWindow({ [BACKGROUND_WINDOW_TAG]: true })).toBe(false)
    expect(isQuitRelevantWindow({ [BACKGROUND_WINDOW_TAG]: true, isDestroyed: () => false })).toBe(false)
  })

  it('treats an ordinary window as quit relevant, and a destroyed one as gone', () => {
    expect(isQuitRelevantWindow({})).toBe(true)
    expect(isQuitRelevantWindow({ isDestroyed: () => false })).toBe(true)
    expect(isQuitRelevantWindow({ isDestroyed: () => true })).toBe(false)
  })

  it('quits exactly when no counted window is left', () => {
    expect(shouldQuitNow([])).toBe(true)
    expect(shouldQuitNow([{ [BACKGROUND_WINDOW_TAG]: true }])).toBe(true)
    expect(shouldQuitNow([{ [BACKGROUND_WINDOW_TAG]: true }, { isDestroyed: () => true }])).toBe(true)
    expect(shouldQuitNow([{ [BACKGROUND_WINDOW_TAG]: true }, {}])).toBe(false)
  })
})

describe('the background window requirements are declared as data', () => {
  it('disables background throttling, which is the reason it is a separate window', () => {
    expect(BACKGROUND_WINDOW_WEB_PREFERENCES.backgroundThrottling).toBe(false)
  })
})
