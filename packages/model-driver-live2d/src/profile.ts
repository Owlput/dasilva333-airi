/**
 * What a Live2D profile *is*: the appearance state the driver owns (D-9, RFC §7.2).
 *
 * AIRI never decomposes a profile. It names a `(modelId, profileId)` pair and this driver decides what that
 * means — which is why the body below is driver-defined, stored in driver storage and applied by the driver's
 * own view. A profile has to be savable with no mount (`saveProfile`), so the body is a plain value and never a
 * snapshot of a live renderer.
 *
 * The maths lives here rather than in the view because it is the part that can be wrong without a WebGL context:
 * a fit that ignores the profile's scale, or an anchor that puts the model outside the box, is a bug no
 * component test would catch. `computeFit` is pure, and `view.ts` is the only caller that also happens to draw.
 */

/** The appearance state of one model profile. Every member is optional; absent means "the default". */
export interface Live2DProfileBody {
  /** Multiplier on the fitted size. `1` fills the box, `2` zooms in and crops, `0.5` shrinks. */
  scale?: number
  /** Horizontal offset from the box centre, in the host's CSS pixels. */
  offsetX?: number
  /** Vertical offset from the anchor line, in the host's CSS pixels. */
  offsetY?: number
  /** Where the model's own centre sits vertically: `0` top, `0.5` middle, `1` bottom. */
  anchorY?: number
  /** Whole-model opacity, `0`..`1`. */
  opacity?: number
  /** An expression applied after load, so a profile can carry a resting face. */
  expression?: string
}

export interface Live2DFitInput {
  box: { width: number, height: number }
  /** The model's own local size, before any fit. */
  content: { width: number, height: number }
  body?: Live2DProfileBody
}

/** The transform a view applies to its model, in the stage's CSS-sized space. */
export interface Live2DFit {
  scale: number
  x: number
  y: number
  opacity: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read a stored body into the shape this driver understands.
 *
 * A profile may come from this driver's own UI, from an older version of it, or — later — from a legacy outfit
 * converted at migration (D-9). So the input is `unknown` and every member is optional: a body that cannot be
 * understood becomes the default appearance rather than a crash or a refused cue, because "show it in the default
 * look" is always better than "do not show it".
 */
export function normalizeProfileBody(body: unknown): Live2DProfileBody {
  if (!body || typeof body !== 'object')
    return {}

  const raw = body as Record<string, unknown>
  const normalized: Live2DProfileBody = {}

  const scale = numberOrUndefined(raw.scale)
  if (scale !== undefined)
    normalized.scale = clamp(scale, 0.1, 4)
  const offsetX = numberOrUndefined(raw.offsetX)
  if (offsetX !== undefined)
    normalized.offsetX = clamp(offsetX, -10_000, 10_000)
  const offsetY = numberOrUndefined(raw.offsetY)
  if (offsetY !== undefined)
    normalized.offsetY = clamp(offsetY, -10_000, 10_000)
  const anchorY = numberOrUndefined(raw.anchorY)
  if (anchorY !== undefined)
    normalized.anchorY = clamp(anchorY, 0, 1)
  const opacity = numberOrUndefined(raw.opacity)
  if (opacity !== undefined)
    normalized.opacity = clamp(opacity, 0, 1)
  if (typeof raw.expression === 'string' && raw.expression.length > 0)
    normalized.expression = raw.expression

  return normalized
}

/** Whether a body changes anything; an empty body is the default look and is not worth a storage write. */
export function isProfileBodyEmpty(body: Live2DProfileBody): boolean {
  return body.scale === undefined && body.offsetX === undefined && body.offsetY === undefined
    && body.anchorY === undefined && body.opacity === undefined && body.expression === undefined
}

/**
 * Fit the model inside the box, with the profile's placement applied.
 *
 * `0.95` is breathing room: a model scaled exactly to the box clips its own outline, which reads as a renderer
 * bug rather than as framing. The result is in the stage's own space, which is CSS-sized by construction — the
 * view scales the stage by the render resolution, so a CSS pixel here is a CSS pixel on screen.
 */
export function computeFit(input: Live2DFitInput): Live2DFit {
  const { box, content } = input
  const body = normalizeProfileBody(input.body)
  const width = Math.max(1, content.width)
  const height = Math.max(1, content.height)
  const base = Math.min(Math.max(1, box.width) / width, Math.max(1, box.height) / height) * 0.95

  return {
    scale: base * (body.scale ?? 1),
    x: Math.max(1, box.width) / 2 + (body.offsetX ?? 0),
    y: Math.max(1, box.height) * (body.anchorY ?? 0.5) + (body.offsetY ?? 0),
    opacity: body.opacity ?? 1,
  }
}
