/**
 * The pointer hub: the one conversion from a window's event to a mount's box (§5.2, exit criterion 6, P2-D16).
 *
 * What is asserted here is the arithmetic and the addressing, because those are the two things that go wrong quietly:
 * a coordinate space that is off by the wrong rect draws a hit test where the pointer is not, and a stream delivered
 * to the wrong mount makes two avatars react to one gesture. The DOM listeners themselves live in `MountHost.vue` and
 * are not exercised here (no DOM in a Node suite) — what this suite proves is everything those listeners delegate to.
 */
import type { PointerBox, RawPointerEvent } from './core/pointer'

import { describe, expect, it } from 'vitest'

import {
  RendererPointerPhase,
  RendererPointerType,
  RendererWheelMode,
} from '../contract/host-services'
import { createPointerHub, toRendererEvent } from './core/pointer'

/** The raw event a browser would hand the host, with the boring fields defaulted. */
function raw(overrides: Partial<RawPointerEvent> = {}): RawPointerEvent {
  return {
    phase: RendererPointerPhase.MOVE,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...overrides,
  }
}

function box(left: number, top: number): PointerBox {
  return { left, top }
}

describe('pointer conversion', () => {
  it('lands a client point inside the addressed mount\'s box', () => {
    const hub = createPointerHub()
    const received: Array<{ x: number, y: number }> = []
    hub.setBox('mount_a', box(100, 50))
    hub.service.subscribe('mount_a', event => received.push(event.point))

    hub.dispatch('mount_a', raw({ clientX: 130, clientY: 80 }))

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ x: 30, y: 30 })
  })

  it('gives two mounts their own coordinates for one client point, and never crosses them', () => {
    const hub = createPointerHub()
    const left: number[] = []
    const right: number[] = []
    // Two mounts of the same driver, side by side, exactly the case a "global" stream would break.
    hub.setBox('mount_left', box(0, 0))
    hub.setBox('mount_right', box(400, 0))
    hub.service.subscribe('mount_left', event => left.push(event.point.x))
    hub.service.subscribe('mount_right', event => right.push(event.point.x))

    hub.dispatch('mount_left', raw({ clientX: 420, clientY: 0 }))

    expect(left).toEqual([420])
    expect(right).toHaveLength(0)

    hub.dispatch('mount_right', raw({ clientX: 420, clientY: 0 }))
    expect(right).toEqual([20])
  })

  it('keeps negative and over-range points, because a captured gesture leaves the box', () => {
    const hub = createPointerHub()
    const points: Array<{ x: number, y: number }> = []
    hub.setBox('mount_a', box(10, 10))
    hub.service.subscribe('mount_a', event => points.push(event.point))

    hub.dispatch('mount_a', raw({ clientX: 0, clientY: 0, phase: RendererPointerPhase.MOVE, buttons: 1 }))
    hub.dispatch('mount_a', raw({ clientX: 500, clientY: 400, phase: RendererPointerPhase.MOVE, buttons: 1 }))

    expect(points[0]).toEqual({ x: -10, y: -10 })
    expect(points[1]).toEqual({ x: 490, y: 390 })
  })

  it('reads the box again for every event, so a moved or resized mount converts correctly', () => {
    const hub = createPointerHub()
    const xs: number[] = []
    let current = box(0, 0)
    hub.setBox('mount_a', () => current)
    hub.service.subscribe('mount_a', event => xs.push(event.point.x))

    hub.dispatch('mount_a', raw({ clientX: 100, clientY: 0 }))
    current = box(60, 0)
    hub.dispatch('mount_a', raw({ clientX: 100, clientY: 0 }))

    expect(xs).toEqual([100, 40])
  })

  it('does not measure anything when no renderer is listening', () => {
    const hub = createPointerHub()
    let measured = 0
    hub.setBox('mount_a', () => {
      measured += 1
      return box(0, 0)
    })

    hub.dispatch('mount_a', raw())
    expect(measured).toBe(0)
  })
})

describe('pointer subscriptions', () => {
  it('accepts a subscription for a mount with no box and never calls it', () => {
    const hub = createPointerHub()
    let called = 0
    hub.service.subscribe('mount_unknown', () => {
      called += 1
    })

    hub.dispatch('mount_unknown', raw())
    expect(called).toBe(0)
  })

  it('stops delivering once the caller unsubscribes, and after the mount is released', () => {
    const hub = createPointerHub()
    let called = 0
    hub.setBox('mount_a', box(0, 0))
    const stop = hub.service.subscribe('mount_a', () => {
      called += 1
    })

    hub.dispatch('mount_a', raw())
    stop()
    stop()
    hub.dispatch('mount_a', raw())
    expect(called).toBe(1)

    hub.service.subscribe('mount_a', () => {
      called += 1
    })
    hub.release('mount_a')
    hub.dispatch('mount_a', raw())
    expect(called).toBe(1)
  })

  it('does not let a stale unsubscribe silence a subscription made after the mount was released', () => {
    const hub = createPointerHub()
    let called = 0
    hub.setBox('mount_a', box(0, 0))
    const stopOld = hub.service.subscribe('mount_a', () => {
      called += 1
    })

    // The id is released and a new subscription is made for the same id (a remount), then the old closure runs late.
    hub.release('mount_a')
    hub.setBox('mount_a', box(0, 0))
    hub.service.subscribe('mount_a', () => {
      called += 1
    })
    stopOld()

    hub.dispatch('mount_a', raw())
    expect(called).toBe(1)
  })

  it('keeps one renderer\'s exception from starving the others, and reports it', () => {
    const failures: Array<[string, string]> = []
    const hub = createPointerHub({
      onError: (mountId, error) => {
        failures.push([mountId, String(error)])
      },
    })
    let survived = 0
    hub.setBox('mount_a', box(0, 0))
    hub.service.subscribe('mount_a', () => {
      throw new Error('renderer blew up')
    })
    hub.service.subscribe('mount_a', () => {
      survived += 1
    })

    hub.dispatch('mount_a', raw())

    expect(survived).toBe(1)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.[0]).toBe('mount_a')
  })

  it('forgets every mount when the adapter is disposed', () => {
    const hub = createPointerHub()
    let called = 0
    hub.setBox('mount_a', box(0, 0))
    hub.service.subscribe('mount_a', () => {
      called += 1
    })

    hub.dispose()
    hub.dispatch('mount_a', raw())

    expect(called).toBe(0)
  })
})

describe('the translated event', () => {
  it('maps the platform pointer type and refuses to guess an unknown one', () => {
    expect(toRendererEvent(raw({ pointerType: 'mouse' }), { x: 0, y: 0 }, () => 0).pointerType).toBe(RendererPointerType.MOUSE)
    expect(toRendererEvent(raw({ pointerType: 'touch' }), { x: 0, y: 0 }, () => 0).pointerType).toBe(RendererPointerType.TOUCH)
    expect(toRendererEvent(raw({ pointerType: 'pen' }), { x: 0, y: 0 }, () => 0).pointerType).toBe(RendererPointerType.PEN)
    expect(toRendererEvent(raw({ pointerType: 'graphics-tablet' }), { x: 0, y: 0 }, () => 0).pointerType).toBe(RendererPointerType.UNKNOWN)
    expect(toRendererEvent(raw(), { x: 0, y: 0 }, () => 0).pointerType).toBe(RendererPointerType.UNKNOWN)
  })

  it('carries a button only where a button changed, and defaults the mask to nothing held', () => {
    const down = toRendererEvent(raw({ phase: RendererPointerPhase.DOWN, button: 0 }), { x: 0, y: 0 }, () => 0)
    const move = toRendererEvent(raw({ phase: RendererPointerPhase.MOVE, buttons: 1 }), { x: 0, y: 0 }, () => 0)

    expect(down.button).toBe(0)
    expect(down.buttons).toBe(0)
    expect(move.button).toBeUndefined()
    expect(move.buttons).toBe(1)
  })

  it('carries wheel deltas with the platform\'s unit, and nothing at all on other phases', () => {
    const pixel = toRendererEvent(
      raw({ phase: RendererPointerPhase.WHEEL, wheel: { deltaX: 1, deltaY: -2, deltaMode: 0 } }),
      { x: 0, y: 0 },
      () => 0,
    )
    const page = toRendererEvent(
      raw({ phase: RendererPointerPhase.WHEEL, wheel: { deltaX: 0, deltaY: 3, deltaMode: 2 } }),
      { x: 0, y: 0 },
      () => 0,
    )
    const move = toRendererEvent(raw(), { x: 0, y: 0 }, () => 0)

    expect(pixel.wheel).toEqual({ deltaX: 1, deltaY: -2, deltaZ: 0, mode: RendererWheelMode.PIXEL })
    expect(page.wheel?.mode).toBe(RendererWheelMode.PAGE)
    expect(move.wheel).toBeUndefined()
  })

  it('reports modifiers as absent rather than guessed, and times an event from the platform clock', () => {
    const event = toRendererEvent(raw({ timeStamp: 1_234 }), { x: 0, y: 0 }, () => 9_999)

    expect(event.modifiers).toEqual({ alt: false, ctrl: false, meta: false, shift: false })
    expect(event.at).toBe(1_234)

    const untimed = toRendererEvent(raw(), { x: 0, y: 0 }, () => 9_999)
    expect(untimed.at).toBe(9_999)
  })
})
