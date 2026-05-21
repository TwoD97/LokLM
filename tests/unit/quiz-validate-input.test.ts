import { describe, it, expect } from 'vitest'
import { validateCreateInput } from '../../src/main/services/quiz/QuizService'
import type { CreateQuizInput } from '../../src/shared/quiz'

function input(overrides: Partial<CreateQuizInput> = {}): CreateQuizInput {
  return {
    workspaceId: 1,
    name: 'Sample',
    documentIds: [1, 2],
    questionCount: 5,
    ...overrides,
  }
}

describe('validateCreateInput', () => {
  it('accepts a well-formed input', () => {
    expect(() => validateCreateInput(input())).not.toThrow()
  })

  it('rejects empty / whitespace-only names', () => {
    expect(() => validateCreateInput(input({ name: '' }))).toThrow(/1–128 characters/)
    expect(() => validateCreateInput(input({ name: '   ' }))).toThrow(/1–128 characters/)
  })

  it('rejects names over 128 characters', () => {
    expect(() => validateCreateInput(input({ name: 'x'.repeat(129) }))).toThrow(/1–128 characters/)
  })

  it('accepts the 128-char boundary', () => {
    expect(() => validateCreateInput(input({ name: 'x'.repeat(128) }))).not.toThrow()
  })

  it('rejects empty documentIds', () => {
    expect(() => validateCreateInput(input({ documentIds: [] }))).toThrow(/at least one document/i)
  })

  it('rejects question counts outside the allowed set', () => {
    for (const bad of [0, 1, 4, 7, 11, 25, 100] as number[]) {
      expect(() => validateCreateInput(input({ questionCount: bad as 5 | 10 | 20 }))).toThrow(
        /questionCount/,
      )
    }
  })

  it('accepts 5, 10, and 20', () => {
    for (const ok of [5, 10, 20] as const) {
      expect(() => validateCreateInput(input({ questionCount: ok }))).not.toThrow()
    }
  })

  it('rejects non-integer workspaceId', () => {
    expect(() => validateCreateInput(input({ workspaceId: 1.5 as unknown as number }))).toThrow(
      /workspaceId/,
    )
  })
})
