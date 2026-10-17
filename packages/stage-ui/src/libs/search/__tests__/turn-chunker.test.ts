import { describe, expect, it } from 'vitest'

import { chunkTurnText, TURN_CHUNK_OVERLAP, TURN_CHUNK_SIZE } from '../turn-chunker'

describe('chunkTurnText', () => {
  it('passes short turns through untouched with stable shape', () => {
    const text = 'Hello, Theodore.'
    const chunks = chunkTurnText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ index: 0, total: 1, text })
  })

  it('passes boundary-length turns through untouched', () => {
    const text = 'x'.repeat(TURN_CHUNK_SIZE)
    expect(chunkTurnText(text)).toHaveLength(1)
  })

  it('splits long turns into overlapping deterministic windows', () => {
    const text = 'word '.repeat(800) // 4000 chars
    const chunks = chunkTurnText(text)
    expect(chunks.length).toBeGreaterThan(1)
    // Every chunk reports the same total and sequential indexes.
    for (const [i, c] of chunks.entries()) {
      expect(c.index).toBe(i)
      expect(c.total).toBe(chunks.length)
      expect(c.text.length).toBeLessThanOrEqual(TURN_CHUNK_SIZE)
    }
    // Overlap: the tail of one window reappears verbatim at the head of the
    // next (199 chars here: 1500 window trimmed to whitespace at 1499).
    expect(chunks[1].text.slice(0, 199)).toBe(chunks[0].text.slice(-199))
    // Full coverage: first window starts at 0, last window reaches the end.
    expect(chunks[0].text).toBe(text.slice(0, chunks[0].text.length))
    expect(text.trimEnd().endsWith(chunks[chunks.length - 1].text.slice(-20))).toBe(true)
  })

  it('keeps every window under the survival ceiling even for mega-turns', () => {
    const words: string[] = []
    for (let i = 0; i < 60000; i++) words.push(`w${i}`)
    const text = words.join(' ') // ~390k chars, all unique
    const chunks = chunkTurnText(text)
    expect(chunks.length).toBeGreaterThan(100)
    for (const c of chunks)
      expect(c.text.length).toBeLessThanOrEqual(TURN_CHUNK_SIZE)
    // Fresh content advances every window (no infinite stall on overlap).
    expect(new Set(chunks.map(c => c.text)).size).toBe(chunks.length)
  })

  it('handles spaceless text without stalling', () => {
    const text = 'x'.repeat(TURN_CHUNK_SIZE + TURN_CHUNK_OVERLAP + 10)
    const chunks = chunkTurnText(text)
    expect(chunks.length).toBe(2)
    expect(chunks[0].total).toBe(2)
  })
})
