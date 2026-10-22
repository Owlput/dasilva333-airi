import type { System1Answer, System1Response } from '../providers/types'

export interface CadenceBoundaryEvaluation {
  index: number
  before: string
  after: string
  score: number
  isSplit: boolean
}

export interface CadenceSplitResult {
  bubbles: string[]
  evaluations: CadenceBoundaryEvaluation[]
  latencyMs?: number
}

export interface CadenceEvaluateOptions {
  splitThreshold?: number
  maxBubbles?: number
  systemOneExecute: (
    state: string,
    questions: Record<string, any>,
  ) => Promise<System1Response | { answers?: Record<string, System1Answer> }>
}

/**
 * Extracts candidate lines and evaluates newline boundaries with Jev System-1
 * to produce intelligently split chat bubbles.
 */
export async function evaluateCadenceSplits(
  rawText: string,
  options: CadenceEvaluateOptions,
): Promise<CadenceSplitResult> {
  const threshold = options.splitThreshold ?? 0.45
  const maxBubbles = Math.max(1, Math.min(10, options.maxBubbles ?? 4))

  const clean = rawText.trim()
  if (!clean) {
    return { bubbles: [], evaluations: [] }
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
    }
  }

  // Evaluate all line boundaries across the full text
  const boundaryCount = lines.length - 1
  const questions: Record<string, any> = {}

  for (let i = 0; i < boundaryCount; i++) {
    const before = lines[i]
    const after = lines[i + 1]
    questions[`b_${i}`] = {
      type: 'noul',
      instructions: `Would a casual texter hit send after "${before}" and start a new bubble at "${after}"?`,
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
      latencyMs: Date.now() - startTime,
    }
  }

  const latencyMs = Date.now() - startTime
  const evaluations: CadenceBoundaryEvaluation[] = []
  const bubbles: string[] = []
  let currentBubble = lines[0]

  for (let i = 0; i < boundaryCount; i++) {
    const before = lines[i]
    const after = lines[i + 1]
    const score = response.answers?.[`b_${i}`]?.noul ?? 0.0
    const isSplit = score >= threshold && bubbles.length + 1 < maxBubbles

    evaluations.push({
      index: i,
      before,
      after,
      score,
      isSplit,
    })

    if (isSplit) {
      bubbles.push(currentBubble)
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
    latencyMs,
  }
}
