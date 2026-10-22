import { describe, expect, it, vi } from 'vitest'

import { evaluateCadenceSplits } from './classifier'

describe('evaluateCadenceSplits', () => {
  it('returns single bubble for text without newlines without calling System 1', async () => {
    const mockExecute = vi.fn()
    const result = await evaluateCadenceSplits('Hello there world!', {
      systemOneExecute: mockExecute,
    })

    expect(result.bubbles).toEqual(['Hello there world!'])
    expect(result.evaluations).toHaveLength(0)
    expect(result.pausesMs).toHaveLength(0)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('splits when score meets or exceeds default splitThreshold (0.45) and bundles choice rhythm question', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      answers: {
        b_0: { type: 'noul', noul: 0.47 },
        c_0: {
          type: 'choice',
          choice: 'conversational_beat',
          probabilities: { rapid_burst: 0.2, conversational_beat: 0.7, thoughtful_pause: 0.1 },
        },
      },
    })

    const text = 'Wait really?\nI had no idea that happened!'
    const result = await evaluateCadenceSplits(text, {
      systemOneExecute: mockExecute,
    })

    expect(mockExecute).toHaveBeenCalledTimes(1)
    const callArgs = mockExecute.mock.calls[0]
    expect(callArgs[0]).toContain('You are splitting one outgoing text into casual chat bubbles.')
    expect(callArgs[1].b_0.instructions).toBe('Would a casual texter hit send after "Wait really?" and start a new bubble at "I had no idea that happened!"?')
    expect(callArgs[1].c_0.type).toBe('choice')
    expect(callArgs[1].c_0.criteria).toHaveProperty('rapid_burst')
    expect(callArgs[1].c_0.criteria).toHaveProperty('conversational_beat')
    expect(callArgs[1].c_0.criteria).toHaveProperty('thoughtful_pause')

    expect(result.bubbles).toEqual(['Wait really?', 'I had no idea that happened!'])
    expect(result.evaluations).toHaveLength(1)
    expect(result.evaluations[0].isSplit).toBe(true)
    expect(result.evaluations[0].score).toBe(0.47)
    expect(result.evaluations[0].rhythmCategory).toBe('conversational_beat')

    // Expected beat = 350*0.2 + 900*0.7 + 1800*0.1 = 70 + 630 + 180 = 880ms
    // Typing length = "I had no idea that happened!".length (28) * 35 = 980ms
    // Total delay = 880 + 980 = 1860ms
    expect(result.evaluations[0].expectedBeatMs).toBe(880)
    expect(result.evaluations[0].calculatedDelayMs).toBe(1860)
    expect(result.pausesMs).toEqual([1860])
  })

  it('keeps lines joined when score is below splitThreshold', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      answers: {
        b_0: { type: 'noul', noul: 0.25 },
        c_0: { type: 'choice', choice: 'rapid_burst' },
      },
    })

    const text = '1. Item one\n2. Item two'
    const result = await evaluateCadenceSplits(text, {
      systemOneExecute: mockExecute,
    })

    expect(result.bubbles).toEqual(['1. Item one\n\n2. Item two'])
    expect(result.evaluations).toHaveLength(1)
    expect(result.evaluations[0].isSplit).toBe(false)
    expect(result.evaluations[0].score).toBe(0.25)
    expect(result.pausesMs).toHaveLength(0)
  })

  it('respects maxBubbles ceiling', async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      answers: {
        b_0: { type: 'noul', noul: 0.9 },
        b_1: { type: 'noul', noul: 0.9 },
      },
    })

    const text = 'Line 1\nLine 2\nLine 3'
    const result = await evaluateCadenceSplits(text, {
      splitThreshold: 0.65,
      maxBubbles: 2,
      systemOneExecute: mockExecute,
    })

    expect(result.bubbles).toHaveLength(2)
    expect(result.bubbles[0]).toBe('Line 1')
    expect(result.bubbles[1]).toBe('Line 2\n\nLine 3')
  })

  it('returns single original message safely if System 1 throws', async () => {
    const mockExecute = vi.fn().mockRejectedValue(new Error('Network error'))
    const text = 'First line\nSecond line'

    const result = await evaluateCadenceSplits(text, {
      systemOneExecute: mockExecute,
    })

    expect(result.bubbles).toEqual([text])
    expect(result.evaluations).toHaveLength(0)
    expect(result.pausesMs).toHaveLength(0)
  })
})
