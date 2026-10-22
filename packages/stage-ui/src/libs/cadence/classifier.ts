import type { System1Answer, System1Response } from '../providers/types'

export type CadenceRhythmCategory = 'rapid_burst' | 'conversational_beat' | 'thoughtful_pause'

export interface CadenceBoundaryEvaluation {
  index: number
  before: string
  after: string
  score: number
  isSplit: boolean
  rhythmCategory?: CadenceRhythmCategory
  rhythmProbabilities?: Record<CadenceRhythmCategory, number>
  expectedBeatMs?: number
  calculatedDelayMs?: number
}

export interface CadenceSplitResult {
  bubbles: string[]
  evaluations: CadenceBoundaryEvaluation[]
  pausesMs: number[]
  latencyMs?: number
}

export interface CadenceEvaluateOptions {
  splitThreshold?: number
  maxBubbles?: number
  dynamicPacing?: boolean
  rapidBurstMs?: number
  conversationalBeatMs?: number
  thoughtfulPauseMs?: number
  typingCadenceMsPerChar?: number
  minDelayMs?: number
  maxDelayCeilingMs?: number
  systemOneExecute: (
    state: string,
    questions: Record<string, any>,
  ) => Promise<System1Response | { answers?: Record<string, System1Answer> }>
}

/**
 * Extracts candidate lines and evaluates newline boundaries with Jev System-1
 * to produce intelligently split chat bubbles with semantic cadence delay pacing.
 */
export async function evaluateCadenceSplits(
  rawText: string,
  options: CadenceEvaluateOptions,
): Promise<CadenceSplitResult> {
  const threshold = options.splitThreshold ?? 0.45
  const maxBubbles = Math.max(1, Math.min(10, options.maxBubbles ?? 4))
  const dynamicPacing = options.dynamicPacing !== false

  const rapidBurstMs = options.rapidBurstMs ?? 350
  const conversationalBeatMs = options.conversationalBeatMs ?? 900
  const thoughtfulPauseMs = options.thoughtfulPauseMs ?? 1800
  const typingCadenceMsPerChar = options.typingCadenceMsPerChar ?? 35
  const minDelayMs = options.minDelayMs ?? 350
  const maxDelayCeilingMs = options.maxDelayCeilingMs ?? 3500

  const clean = rawText.trim()
  if (!clean) {
    return { bubbles: [], evaluations: [], pausesMs: [] }
  }

  // Split on single or multiple newlines
  const lines = clean
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0)

  // If there's only 1 chunk or maxBubbles is 1, return the original text directly
  if (lines.length <= 1 || maxBubbles <= 1) {
    return {
      bubbles: [clean],
      evaluations: [],
      pausesMs: [],
    }
  }

  // Evaluate all line boundaries across the full text
  const boundaryCount = lines.length - 1
  const questions: Record<string, any> = {}

  for (let i = 0; i < boundaryCount; i++) {
    const before = lines[i]
    const after = lines[i + 1]

    // Noul split probability question (Approach 3 bidirectional anchor)
    questions[`b_${i}`] = {
      type: 'noul',
      instructions: `Would a casual texter hit send after "${before}" and start a new bubble at "${after}"?`,
    }

    // Optional choice rhythm tempo question (Option 2 contrastive buckets)
    if (dynamicPacing) {
      questions[`c_${i}`] = {
        type: 'choice',
        instructions: `What is the natural conversational pause after sending "${before}" before typing "${after}"?`,
        criteria: {
          rapid_burst: 'Immediate follow-up sent in quick succession (quick 300-500ms beat).',
          conversational_beat: 'Standard natural typing pause between distinct thoughts (800-1200ms beat).',
          thoughtful_pause: 'Longer pause to think, check something, or wrap up (1500-2500ms beat).',
        },
      }
    }
  }

  const startTime = Date.now()
  let response: System1Response | { answers?: Record<string, System1Answer> } = { answers: {} }

  try {
    response = await options.systemOneExecute(
      `You are splitting one outgoing text into casual chat bubbles.\nRules: Keep an unfinished lead-in line and any tightly coupled group of lines together in one bubble. Start a new bubble only on a clear shift to a separate conversational beat (like a new paragraph, topic shift, or sign-off).\n\nComplete text:\n"""\n${clean}\n"""`,
      questions,
    )
  }
  catch (err) {
    console.error('[Cadence] System 1 boundary evaluation failed:', err)
    return {
      bubbles: [clean],
      evaluations: [],
      pausesMs: [],
      latencyMs: Date.now() - startTime,
    }
  }

  const latencyMs = Date.now() - startTime
  const evaluations: CadenceBoundaryEvaluation[] = []
  const bubbles: string[] = []
  const pausesMs: number[] = []
  let currentBubble = lines[0]

  for (let i = 0; i < boundaryCount; i++) {
    const before = lines[i]
    const after = lines[i + 1]
    const score = response.answers?.[`b_${i}`]?.noul ?? 0.0
    const isSplit = score >= threshold && bubbles.length + 1 < maxBubbles

    let rhythmCategory: CadenceRhythmCategory | undefined
    let rhythmProbabilities: Record<CadenceRhythmCategory, number> | undefined
    let expectedBeatMs: number | undefined
    let calculatedDelayMs: number | undefined

    if (dynamicPacing) {
      const choiceAnswer = response.answers?.[`c_${i}`]
      rhythmCategory = (choiceAnswer?.choice as CadenceRhythmCategory) || 'conversational_beat'
      const probs = choiceAnswer?.probabilities as Record<CadenceRhythmCategory, number> | undefined

      if (probs) {
        rhythmProbabilities = probs
        expectedBeatMs = Math.round(
          rapidBurstMs * (probs.rapid_burst ?? 0)
          + conversationalBeatMs * (probs.conversational_beat ?? 0)
          + thoughtfulPauseMs * (probs.thoughtful_pause ?? 0),
        )
      }
      else {
        expectedBeatMs = rhythmCategory === 'rapid_burst'
          ? rapidBurstMs
          : rhythmCategory === 'thoughtful_pause'
            ? thoughtfulPauseMs
            : conversationalBeatMs
      }

      // Physical typing duration estimated from the character length of the upcoming line
      const typingMs = Math.round(after.length * typingCadenceMsPerChar)
      calculatedDelayMs = Math.max(minDelayMs, Math.min(maxDelayCeilingMs, expectedBeatMs + typingMs))
    }

    evaluations.push({
      index: i,
      before,
      after,
      score,
      isSplit,
      rhythmCategory,
      rhythmProbabilities,
      expectedBeatMs,
      calculatedDelayMs,
    })

    if (isSplit) {
      bubbles.push(currentBubble)
      if (calculatedDelayMs !== undefined) {
        pausesMs.push(calculatedDelayMs)
      }
      currentBubble = after
    }
    else {
      currentBubble = `${currentBubble}\n\n${after}`
    }
  }

  // Append remaining lines if any exceeded boundaryCount
  if (lines.length - 1 > boundaryCount) {
    const remaining = lines.slice(boundaryCount + 1).join('\n\n')
    currentBubble = `${currentBubble}\n\n${remaining}`
  }

  bubbles.push(currentBubble)

  return {
    bubbles,
    evaluations,
    pausesMs,
    latencyMs,
  }
}
