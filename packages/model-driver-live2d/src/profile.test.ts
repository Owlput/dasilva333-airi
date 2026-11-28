/**
 * Profile maths: the part of appearance that can be wrong without a WebGL context.
 *
 * `computeFit` is what puts a model in a box, so these cases are the ones that would otherwise only show up as "the
 * avatar is off screen" in a running app: the breathing room, the scale multiplier, the anchor line and the offsets.
 */
import { describe, expect, it } from 'vitest'

import { computeFit, isProfileBodyEmpty, normalizeProfileBody } from './profile'

describe('live2d profile body', () => {
  it('keeps what it understands and clamps it into a usable range', () => {
    expect(normalizeProfileBody({ scale: 99, opacity: -3, anchorY: 4, offsetX: 12.5, expression: 'happy' }))
      .toEqual({ scale: 4, opacity: 0, anchorY: 1, offsetX: 12.5, expression: 'happy' })

    expect(normalizeProfileBody({ scale: 0 })).toEqual({ scale: 0.1 })
    expect(normalizeProfileBody({ scale: 'big', opacity: Number.NaN })).toEqual({})
  })

  it('treats anything unreadable as the default appearance rather than failing a profile', () => {
    expect(normalizeProfileBody(undefined)).toEqual({})
    expect(normalizeProfileBody(null)).toEqual({})
    expect(normalizeProfileBody('profile')).toEqual({})
    expect(normalizeProfileBody({ unknown: 1, expression: '' })).toEqual({})
  })

  it('knows when a body is worth writing', () => {
    expect(isProfileBodyEmpty({})).toBe(true)
    expect(isProfileBodyEmpty({ scale: 1 })).toBe(false)
    expect(isProfileBodyEmpty({ expression: 'happy' })).toBe(false)
  })
})

describe('live2d fit', () => {
  it('fits a 2:1 model into a square box with breathing room, centred', () => {
    const fit = computeFit({ box: { width: 400, height: 400 }, content: { width: 200, height: 100 } })

    // Width is the constrained axis: 400 / 200 * 0.95.
    expect(fit.scale).toBeCloseTo(1.9, 6)
    expect(fit.x).toBe(200)
    expect(fit.y).toBe(200)
    expect(fit.opacity).toBe(1)
  })

  it('applies the profile scale as a multiplier on the fit, not as a replacement for it', () => {
    const base = computeFit({ box: { width: 400, height: 400 }, content: { width: 200, height: 100 } })
    const zoomed = computeFit({
      box: { width: 400, height: 400 },
      content: { width: 200, height: 100 },
      body: { scale: 2 },
    })

    expect(zoomed.scale).toBeCloseTo(base.scale * 2, 6)
  })

  it('places the model on the anchor line, then applies the offsets', () => {
    const fit = computeFit({
      box: { width: 400, height: 300 },
      content: { width: 100, height: 100 },
      body: { anchorY: 0.75, offsetX: -20, offsetY: 10 },
    })

    expect(fit.x).toBe(180)
    expect(fit.y).toBe(235)
  })

  it('survives a box or a model that reports nothing', () => {
    const fit = computeFit({ box: { width: 0, height: 0 }, content: { width: 0, height: 0 } })

    expect(Number.isFinite(fit.scale)).toBe(true)
    expect(fit.scale).toBeGreaterThan(0)
    expect(fit.x).toBeGreaterThan(0)
    expect(fit.y).toBeGreaterThan(0)
  })
})
