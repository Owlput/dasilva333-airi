/**
 * Pointer input for the mounts in one window, converted once (§5.2, exit criterion 6, P2-D16).
 *
 * The contract says a renderer receives pointer events already in **its own box's** coordinates
 * (`RendererPointerEvent.point`, `RendererPointerService`). Something has to do that subtraction, and this module is
 * that something: the host UI that owns a mount's element measures the element and feeds the raw event here; a
 * renderer subscribes through `services.pointer` and never touches `clientX`/`getBoundingClientRect` itself.
 *
 * Four rules, and why each is a rule rather than a choice:
 *
 *   1. **Per mount, by id.** A window can host several mounts of the same driver (`acting` and `preview` side by side),
 *      each with its own box. A subscription names the mount it wants, and a dispatch names the mount it happened in,
 *      so one box's coordinates can never reach another box's drawing.
 *   2. **The box is read at dispatch time, not at subscribe time.** A mount moves and resizes while it lives — layout,
 *      scrolling, a window resize, a drag — and a box captured once would convert every later event against stale
 *      geometry.
 *   3. **No clamping and no scaling.** A point may be negative or beyond the box while a gesture is captured, which the
 *      contract explicitly permits; device-pixel-ratio scaling is the renderer's business, because the contract's
 *      space is CSS pixels.
 *   4. **A subscription for an id with no live box is accepted and never called.** That is the contract's wording for a
 *      renderer that subscribes before its host measured it, and it is also what keeps a released mount from receiving
 *      anything after its element is gone.
 *
 * This module is pure: no DOM, no Vue, no window. The element, the listeners and the measurement belong to the host UI
 * (`MountHost.vue`); everything that can be asserted about the conversion is assertable in Node.
 */
import type { RendererPointerEvent, RendererPointerService } from '../../contract/host-services'
import type { RendererMountPoint } from '../../contract/shared'

import {
  RendererPointerPhase,
  RendererPointerType,
  RendererWheelMode,
} from '../../contract/host-services'

/** A mount's drawing box in viewport coordinates, CSS pixels — the two numbers a conversion needs. */
export interface PointerBox {
  left: number
  top: number
}

/** How the host answers "where is this mount now"; asked per dispatch, never cached. */
export type PointerBoxSource = () => PointerBox | undefined

/**
 * The subset of a DOM `PointerEvent`/`WheelEvent` this conversion reads.
 *
 * Structural rather than the DOM type so the host UI can pass the real event, a test can pass an object literal, and
 * this package does not need `lib.dom` to compile its host core.
 */
export interface RawPointerEvent {
  phase: RendererPointerPhase
  pointerId: number
  clientX: number
  clientY: number
  /** `PointerEvent.pointerType` as the platform reports it: `mouse`, `touch`, `pen`, or something else. */
  pointerType?: string
  buttons?: number
  button?: number
  wheel?: { deltaX: number, deltaY: number, deltaZ?: number, deltaMode?: number }
  modifiers?: { alt?: boolean, ctrl?: boolean, meta?: boolean, shift?: boolean }
  /** `Event.timeStamp`, so a gesture can be timed by the platform's clock when it has one. */
  timeStamp?: number
}

export interface PointerHubOptions {
  /** The clock used when an event carries no usable timestamp. */
  now?: () => number
  /** A subscriber that throws is reported here instead of starving the other subscribers. */
  onError?: (mountId: string, error: unknown) => void
}

export interface PointerHub {
  /**
   * Tell the hub where a mount's box is.
   *
   * A snapshot is enough for a fixed box; a function is what a live element wants, because it is re-read per dispatch.
   * Passing `undefined` forgets the box, which makes the mount's subscriptions inert rather than wrong.
   */
  setBox: (mountId: string, box: PointerBox | PointerBoxSource | undefined) => void
  /**
   * Deliver one raw event, addressed to the mount it happened in.
   *
   * A dispatch with no subscriber does nothing at all — no box read, no allocation — which matters because pointer
   * moves arrive far more often than anything else the host handles.
   */
  dispatch: (mountId: string, event: RawPointerEvent) => void
  /** Drop a mount: its subscriptions stop receiving and its box is forgotten. What unmounting a mount calls. */
  release: (mountId: string) => void
  /** The service the driver receives as `HostServices.pointer`. */
  service: RendererPointerService
  /** Forget every mount. What disposing the adapter calls. */
  dispose: () => void
}

export function createPointerHub(options: PointerHubOptions = {}): PointerHub {
  const now = options.now ?? (() => Date.now())
  const boxes = new Map<string, PointerBoxSource>()
  const subscribers = new Map<string, Set<(event: RendererPointerEvent) => void>>()

  const readBox = (mountId: string): PointerBox | undefined => {
    const source = boxes.get(mountId)
    if (!source)
      return undefined
    try {
      return source()
    }
    catch {
      // A measurement can throw when the element is mid-teardown; that is "no box right now", not a broken mount.
      return undefined
    }
  }

  const service: RendererPointerService = {
    subscribe(mountId, handler) {
      const handlers = subscribers.get(mountId) ?? new Set()
      handlers.add(handler)
      subscribers.set(mountId, handlers)

      let stopped = false
      return () => {
        if (stopped)
          return
        stopped = true
        handlers.delete(handler)
        // Only drop the map entry this closure was created for: a mount that was released and re-registered has a new
        // set, and a late unsubscribe from the old subscription must not silence the new one.
        if (handlers.size === 0 && subscribers.get(mountId) === handlers)
          subscribers.delete(mountId)
      }
    },
  }

  return {
    setBox(mountId, box) {
      if (!box) {
        boxes.delete(mountId)
        return
      }
      boxes.set(mountId, typeof box === 'function' ? box : () => box)
    },

    dispatch(mountId, event) {
      const handlers = subscribers.get(mountId)
      if (!handlers || handlers.size === 0)
        return

      const box = readBox(mountId)
      if (!box)
        return

      const converted = toRendererEvent(event, { x: event.clientX - box.left, y: event.clientY - box.top }, now)
      for (const handler of [...handlers]) {
        try {
          handler(converted)
        }
        catch (error) {
          options.onError?.(mountId, error)
        }
      }
    },

    release(mountId) {
      boxes.delete(mountId)
      subscribers.delete(mountId)
    },

    service,

    dispose() {
      boxes.clear()
      subscribers.clear()
    },
  }
}

/**
 * The one conversion: a raw event plus the point already derived from a box becomes the contract's event.
 *
 * Split out because every field's rule is worth asserting on its own — `button` exists only where a button changed,
 * `wheel` only on a wheel event, and an unknown `pointerType` is `UNKNOWN` rather than a guess.
 */
export function toRendererEvent(
  event: RawPointerEvent,
  point: RendererMountPoint,
  now: () => number,
): RendererPointerEvent {
  const withButton = event.phase === RendererPointerPhase.DOWN || event.phase === RendererPointerPhase.UP

  return {
    phase: event.phase,
    pointerId: event.pointerId,
    pointerType: toPointerType(event.pointerType),
    point: { x: point.x, y: point.y },
    buttons: event.buttons ?? 0,
    ...(withButton && event.button !== undefined ? { button: event.button } : {}),
    ...(event.phase === RendererPointerPhase.WHEEL && event.wheel
      ? {
          wheel: {
            deltaX: event.wheel.deltaX,
            deltaY: event.wheel.deltaY,
            deltaZ: event.wheel.deltaZ ?? 0,
            mode: toWheelMode(event.wheel.deltaMode),
          },
        }
      : {}),
    modifiers: {
      alt: event.modifiers?.alt ?? false,
      ctrl: event.modifiers?.ctrl ?? false,
      meta: event.modifiers?.meta ?? false,
      shift: event.modifiers?.shift ?? false,
    },
    at: typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp) ? event.timeStamp : now(),
  }
}

function toPointerType(pointerType: string | undefined): RendererPointerType {
  switch (pointerType) {
    case 'mouse':
      return RendererPointerType.MOUSE
    case 'touch':
      return RendererPointerType.TOUCH
    case 'pen':
      return RendererPointerType.PEN
    default:
      return RendererPointerType.UNKNOWN
  }
}

function toWheelMode(deltaMode: number | undefined): RendererWheelMode {
  switch (deltaMode) {
    case 1:
      return RendererWheelMode.LINE
    case 2:
      return RendererWheelMode.PAGE
    default:
      return RendererWheelMode.PIXEL
  }
}
