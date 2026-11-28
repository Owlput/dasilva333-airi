/**
 * Projecting one ACT token onto a Live2D action (RFC 0002 §9.8, plan D-10).
 *
 * The contract says the token travels verbatim and the renderer projects it: AIRI never learns what a token played, and
 * a caller that wants one specific unit uses `ExpressionCue`/`MotionCue` instead. So this module owns exactly one
 * thing — turning the token form this driver publishes (`prompt.ts`) back into the action it names.
 *
 * The accepted form is the published one, `<|ACT:emotion="happy"|>` and `<|ACT:motion="Idle#0"|>`, because that is
 * what AIRI's marker parser resolves and what the prompt's token list carries. A bare `emotion="happy"` is tolerated
 * (a caller that stripped the pipes should not go silent), anything else is not an action this driver can perform and
 * is reported as `unknown-key` rather than guessed at — a marker parser elsewhere could split the value differently.
 */
export type Live2DAct = { kind: 'emotion', key: string } | { kind: 'motion', key: string }

const MARKER = /^\s*<\|ACT:([A-Za-z]+)="([^"]*)"\|>\s*$/
const BARE = /^\s*([A-Z]+)="([^"]*)"\s*$/i

function toAct(kind: string, key: string): Live2DAct | undefined {
  // The value is the driver's own vocabulary key; one that arrived empty addressed nothing, so it is not an action.
  if (key.length === 0)
    return undefined
  if (kind === 'emotion')
    return { kind: 'emotion', key }
  if (kind === 'motion')
    return { kind: 'motion', key }
  return undefined
}

/** The action one ACT token names, or `undefined` when this driver has no projection for it. */
export function parseLive2DActToken(token: string): Live2DAct | undefined {
  const marked = MARKER.exec(token)
  if (marked)
    return toAct(marked[1], marked[2])

  const bare = BARE.exec(token)
  if (bare)
    return toAct(bare[1], bare[2])

  return undefined
}
