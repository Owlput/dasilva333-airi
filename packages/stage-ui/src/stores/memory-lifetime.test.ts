import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applySurgicalSectionLock,
  arePacksContentEqual,
  buildBaseArchivePrompt,
  buildDayTranscriptWithBudget,
  clampToYesterday,
  countPackBullets,
  formatDayWindowDoc,
  parseDocLocalDayKey,
  parseLocalDayEnd,
  renderDistilledArtifactMd,
  renderPackForReview,
} from './memory-lifetime'
import { evaluateLifetimeDayGateAnswers } from './modules/system-one'

// ROOT CAUSE (F-04):
// `new Date("YYYY-MM-DD")` parses as UTC midnight, so STMM day keys shifted
// back one day in Western timezones when the watermark was computed, and
// `toISOString().slice(11, 16)` printed UTC HH:MM inside local-day buckets.
// Helpers now treat bare day keys as local and format times in local HH:MM.
describe('memory-lifetime pure helpers: local day handling (F-04)', () => {
  it('returns bare YYYY-MM-DD keys untouched instead of UTC-shifting them', () => {
    expect(parseDocLocalDayKey('2026-10-12')).toBe('2026-10-12')
  })

  it('resolves local end-of-day to 23:59:59.999 with no sub-second gap', () => {
    expect(parseLocalDayEnd('2026-10-12')).toBe(new Date(2026, 9, 12, 23, 59, 59, 999).getTime())
    expect(parseLocalDayEnd('not-a-day')).toBe(0)
  })

  it('formats day-window timestamps in local HH:MM, not UTC', () => {
    const local = new Date(2026, 9, 12, 21, 5, 0)
    const rendered = formatDayWindowDoc({ id: 'raw:x:0', layer: 'raw', timestamp: local.toISOString(), text: 'User: hi' } as any)
    expect(rendered.startsWith('[21:05] [RAW]')).toBe(true)
  })

  describe('clampToYesterday (F-01 watermark sealing)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 9, 14, 14, 30, 0))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('clamps today and future days back to yesterday', () => {
      expect(clampToYesterday('2026-10-14')).toBe('2026-10-13')
      expect(clampToYesterday('2026-10-20')).toBe('2026-10-13')
    })

    it('leaves completed days untouched', () => {
      expect(clampToYesterday('2026-10-01')).toBe('2026-10-01')
      expect(clampToYesterday('2026-10-13')).toBe('2026-10-13')
    })
  })
})

// ROOT CAUSE (F-05):
// A flat `.slice(0, 24000)` tail-truncation dropped late-night raw turns AND
// sacral LTMM journal entries. The budget now always preserves LTMM in full
// and samples raw head (40%) + tail (60%) around an omission marker.
describe('memory-lifetime pure helpers: day transcript budget (F-05)', () => {
  function rawDoc(id: string, text: string) {
    return { id, layer: 'raw', timestamp: new Date(2026, 9, 13, 12, 0).toISOString(), text } as any
  }

  it('preserves every LTMM doc intact while bounding raw turns', () => {
    const raw = [rawDoc('raw:1', `User: ${'morning talk '.repeat(1200)}`), rawDoc('raw:2', `User: ${'late night talk '.repeat(1200)}`)]
    const journalA = '[Journal: Big Day] engaged at sunset, cried happy tears, promised forever'
    const journalB = '[Journal: Small Joy] shared ramen at midnight diner, new ritual'
    const docs = [
      ...raw,
      { id: 'ltmm:a', layer: 'ltmm', timestamp: new Date(2026, 9, 13, 23, 50).toISOString(), text: journalA } as any,
      { id: 'ltmm:b', layer: 'ltmm', timestamp: new Date(2026, 9, 13, 23, 55).toISOString(), text: journalB } as any,
    ]
    const transcript = buildDayTranscriptWithBudget(docs, 24000)
    expect(transcript.length).toBeLessThanOrEqual(24000 + 2500)
    expect(transcript).toContain(journalA)
    expect(transcript).toContain(journalB)
    expect(transcript).toContain('... [middle of day omitted for token budget] ...')
  })

  it('keeps short days completely intact with no omission marker', () => {
    const docs = [rawDoc('raw:1', 'User: Good morning!')]
    const transcript = buildDayTranscriptWithBudget(docs, 24000)
    expect(transcript).toContain('Good morning!')
    expect(transcript).not.toContain('omitted for token budget')
  })
})

describe('memory-lifetime pure helpers: pack guards (F-06/F-08)', () => {
  const basePack = {
    relationship_core: ['bonded companions', 'playful teasing dynamic'],
    user_patterns: ['says good morning daily', 'shares dinner photos'],
    shared_rituals: ['midnight ramen'],
    stable_topics: ['romance anime', 'rust programming'],
    meaningful_old_moments: ['first stargazing night'],
    inside_jokes_or_motifs: ['rubber duck debugging'],
    compression_notes: ['merged duplicate tea bullets'],
  }

  it('counts bullets across the six content sections only', () => {
    expect(countPackBullets(basePack)).toBe(2 + 2 + 1 + 2 + 1 + 1)
  })

  it('detects identical packs for the true-diff guard', () => {
    expect(arePacksContentEqual(basePack, { ...basePack })).toBe(true)
    expect(arePacksContentEqual(basePack, { ...basePack, user_patterns: ['changed'] })).toBe(false)
  })

  it('strips Compression Notes from live distilled content but keeps them for review', () => {
    const live = renderDistilledArtifactMd('Airi', basePack)
    expect(live).not.toContain('Compression Notes')
    expect(live).not.toContain('merged duplicate tea bullets')
    expect(live).toContain('## Meaningful Old Moments')
    const review = renderPackForReview(basePack)
    expect(review).toContain('compression_notes:')
    expect(review).toContain('merged duplicate tea bullets')
  })

  it('folds prior incremental bullets into the base archive prompt (F-02)', () => {
    const prompt = buildBaseArchivePrompt(
      'Airi',
      { rawTurnCount: 10, stmmBlockCount: 2, ltmmEntryCount: 1 },
      [{ durable_facts: ['met at the cafe'], recurring_preferences: [], recurring_topics: [], relationship_dynamics: [], user_mannerisms: [], meaningful_moments: [], inside_jokes_or_motifs: [] }],
      { ...basePack, relationship_core: ['loves late-night ramen'] },
    )
    expect(prompt).toContain('met at the cafe')
    expect(prompt).toContain('loves late-night ramen')
    expect(prompt).toContain('Manifest context: 13 documents (10 raw / 2 stmm / 1 ltmm).')
  })
})

describe('system-1 (Jev) pure helpers: gate evaluation & surgical section lock', () => {
  const basePack = {
    relationship_core: ['bonded companions'],
    user_patterns: ['says good morning daily'],
    shared_rituals: ['midnight ramen'],
    stable_topics: ['rust programming'],
    meaningful_old_moments: ['first stargazing night'],
    inside_jokes_or_motifs: ['rubber duck debugging'],
    compression_notes: ['note'],
  }

  it('fast-exits when all 6 sections land in distractor basins', () => {
    const res = evaluateLifetimeDayGateAnswers({
      relationship_core: { choice: 'already_captured_in_pack', confidence: 0.92 },
      user_patterns: { choice: 'transient_routine_banter', confidence: 0.88 },
      shared_rituals: { choice: 'no_relevant_evidence', confidence: 0.95 },
      stable_topics: { choice: 'already_captured_in_pack', confidence: 0.91 },
      meaningful_old_moments: { choice: 'no_relevant_evidence', confidence: 0.99 },
      inside_jokes_or_motifs: { choice: 'transient_routine_banter', confidence: 0.84 },
    })

    expect(res.shouldInvokeSystem2).toBe(false)
    expect(res.triggeredSections).toEqual([])
    expect(res.auditNote).toBe('System-1 gate: routine day (no durable section changes)')
  })

  it('ignores low-confidence positive choices below the 0.60 threshold', () => {
    const res = evaluateLifetimeDayGateAnswers({
      inside_jokes_or_motifs: { choice: 'durable_new_addition', confidence: 0.42 },
    })
    expect(res.shouldInvokeSystem2).toBe(false)
    expect(res.triggeredSections).toEqual([])
  })

  it('unlocks only sections with calibrated conviction >= 0.60', () => {
    const res = evaluateLifetimeDayGateAnswers({
      relationship_core: { choice: 'already_captured_in_pack', confidence: 0.90 },
      inside_jokes_or_motifs: { choice: 'durable_new_addition', confidence: 0.86 },
    })
    expect(res.shouldInvokeSystem2).toBe(true)
    expect(res.triggeredSections).toEqual(['inside_jokes_or_motifs'])
    expect(res.auditNote).toBe('System-1: unlocked [inside_jokes_or_motifs], 5 sections frozen')
  })

  it('freezes un-triggered sections even when System 2 mutates or drops them', () => {
    const hallucinatedSystem2Pack = {
      relationship_core: ['REWRITTEN BY SYSTEM 2'],
      user_patterns: [], // System 2 accidentally wiped this section!
      shared_rituals: ['midnight ramen'],
      stable_topics: ['rust programming'],
      meaningful_old_moments: ['WIPED OLD MOMENT'],
      inside_jokes_or_motifs: ['rubber duck debugging', 'captain capybara'],
      compression_notes: [],
    }

    const locked = applySurgicalSectionLock(basePack, hallucinatedSystem2Pack, ['inside_jokes_or_motifs'])

    // Locked sections stay 100% byte-identical to basePack
    expect(locked.relationship_core).toEqual(['bonded companions'])
    expect(locked.user_patterns).toEqual(['says good morning daily'])
    expect(locked.meaningful_old_moments).toEqual(['first stargazing night'])
    // Only the unlocked section accepts System 2's update
    expect(locked.inside_jokes_or_motifs).toEqual(['rubber duck debugging', 'captain capybara'])
  })
})
