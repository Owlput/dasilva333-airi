/**
 * ACT-token projection (D-10, RFC 0002 §9.8).
 *
 * The tokens this driver publishes are the ones it must be able to perform: `<|ACT:emotion="…"|>` for an expression and
 * `<|ACT:motion="…"|>` for a motion. These cases pin the accepted forms and, just as importantly, that nothing else is
 * guessed at.
 */
import { describe, expect, it } from 'vitest'

import { parseLive2DActToken } from './act'

describe('parsing an ACT token', () => {
  it('projects the two forms the prompt publishes', () => {
    expect(parseLive2DActToken('<|ACT:emotion="happy"|>')).toEqual({ kind: 'emotion', key: 'happy' })
    expect(parseLive2DActToken('<|ACT:motion="Idle#0"|>')).toEqual({ kind: 'motion', key: 'Idle#0' })
  })

  it('keeps a key that contains characters the format uses', () => {
    // Motion keys are `group#index`, and a settings name may contain spaces or punctuation.
    expect(parseLive2DActToken('<|ACT:motion="Tap Body#2"|>')).toEqual({ kind: 'motion', key: 'Tap Body#2' })
    expect(parseLive2DActToken('<|ACT:emotion="F01 (blush)"|>')).toEqual({ kind: 'emotion', key: 'F01 (blush)' })
  })

  it('accepts the bare pair form, but only for the two verbs it knows', () => {
    expect(parseLive2DActToken('emotion="happy"')).toEqual({ kind: 'emotion', key: 'happy' })
    expect(parseLive2DActToken('motion="Idle#0"')).toEqual({ kind: 'motion', key: 'Idle#0' })
    expect(parseLive2DActToken('expression="happy"')).toBeUndefined()
    expect(parseLive2DActToken('sticker="wave"')).toBeUndefined()
  })

  it('tolerates surrounding whitespace around a well-formed token', () => {
    expect(parseLive2DActToken('  <|ACT:emotion="happy"|>\n')).toEqual({ kind: 'emotion', key: 'happy' })
  })

  it('refuses to guess when the token is malformed or names nothing', () => {
    expect(parseLive2DActToken('')).toBeUndefined()
    expect(parseLive2DActToken('happy')).toBeUndefined()
    expect(parseLive2DActToken('<|ACT:emotion=happy|>')).toBeUndefined()
    expect(parseLive2DActToken('<|ACT:emotion=""|>')).toBeUndefined()
    expect(parseLive2DActToken('<|ACT:emotion="happy">')).toBeUndefined()
    expect(parseLive2DActToken('<|ACT:emotion="a" data-x="b"|>')).toBeUndefined()
  })
})
