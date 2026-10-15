import type { Tool } from '@xsai/shared-chat'

import { describe, expect, it, vi } from 'vitest'

import { toolStepLimitMessage, withToolStepBudget } from './tool-call-budget'

function fakeTool(name: string, execute = vi.fn(async () => 'ok')): Tool {
  return {
    type: 'function',
    function: { name, parameters: {} },
    execute,
  } as unknown as Tool
}

// A round is identified by the conversation length when its calls run.
function round(length: number) {
  return { messages: Array.from({ length }), toolCallId: 'x' } as any
}

describe('withToolStepBudget', () => {
  it('leaves room after the budget for the model to answer', () => {
    expect(withToolStepBudget(undefined, 20).maxSteps).toBe(23)
  })

  it('runs tools until the step budget is spent, then refuses', async () => {
    const execute = vi.fn(async () => 'ok')
    const { tools } = withToolStepBudget([fakeTool('a', execute)], 2)

    expect(await tools![0].execute({}, round(2))).toBe('ok')
    expect(await tools![0].execute({}, round(4))).toBe('ok')
    expect(await tools![0].execute({}, round(6))).toBe(toolStepLimitMessage(2))
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('counts parallel calls of one round as a single step', async () => {
    const { tools } = withToolStepBudget([fakeTool('a'), fakeTool('b')], 1)

    expect(await tools![0].execute({}, round(2))).toBe('ok')
    expect(await tools![1].execute({}, round(2))).toBe('ok')
    expect(await tools![1].execute({}, round(5))).toBe(toolStepLimitMessage(1))
  })

  it('treats a non-positive limit as one step', () => {
    expect(withToolStepBudget(undefined, 0).maxSteps).toBe(4)
  })
})
