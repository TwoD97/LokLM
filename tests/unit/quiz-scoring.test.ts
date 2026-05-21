import { describe, it, expect } from 'vitest'
import { scoreAnswers } from '../../src/main/services/quiz/scoring'

const QUESTIONS = [
  { id: 10, correctIndex: 0 },
  { id: 11, correctIndex: 2 },
  { id: 12, correctIndex: 3 },
]

describe('scoreAnswers', () => {
  it('scores all-correct as the full count', () => {
    const result = scoreAnswers(QUESTIONS, [
      { questionId: 10, selectedIndex: 0 },
      { questionId: 11, selectedIndex: 2 },
      { questionId: 12, selectedIndex: 3 },
    ])
    expect(result.score).toBe(3)
    expect(result.scored.every((s) => s.correct)).toBe(true)
  })

  it('scores all-wrong as zero', () => {
    const result = scoreAnswers(QUESTIONS, [
      { questionId: 10, selectedIndex: 1 },
      { questionId: 11, selectedIndex: 0 },
      { questionId: 12, selectedIndex: 1 },
    ])
    expect(result.score).toBe(0)
    expect(result.scored.every((s) => !s.correct)).toBe(true)
  })

  it('scores mixed correctness per question', () => {
    const result = scoreAnswers(QUESTIONS, [
      { questionId: 10, selectedIndex: 0 }, // correct
      { questionId: 11, selectedIndex: 1 }, // wrong
      { questionId: 12, selectedIndex: 3 }, // correct
    ])
    expect(result.score).toBe(2)
    expect(result.scored.map((s) => [s.questionId, s.correct])).toEqual([
      [10, true],
      [11, false],
      [12, true],
    ])
  })

  it('preserves the order of the input answers in scored', () => {
    // Even if the runner shuffles questions visually, it submits answers in
    // whatever order it has. The handler should return scored in submission
    // order so the renderer can correlate by index when needed.
    const result = scoreAnswers(QUESTIONS, [
      { questionId: 12, selectedIndex: 3 },
      { questionId: 10, selectedIndex: 0 },
      { questionId: 11, selectedIndex: 2 },
    ])
    expect(result.scored.map((s) => s.questionId)).toEqual([12, 10, 11])
    expect(result.score).toBe(3)
  })

  it('throws when an answer references a question not in the deck', () => {
    expect(() =>
      scoreAnswers(QUESTIONS, [
        { questionId: 10, selectedIndex: 0 },
        { questionId: 99, selectedIndex: 0 },
      ]),
    ).toThrow(/Question 99 does not belong to this attempt/)
  })

  it('throws on out-of-range selectedIndex', () => {
    for (const bad of [-1, 4, 5, 100]) {
      expect(() => scoreAnswers(QUESTIONS, [{ questionId: 10, selectedIndex: bad }])).toThrow(
        /Invalid selectedIndex/,
      )
    }
  })

  it('throws on non-integer selectedIndex', () => {
    for (const bad of [1.5, NaN, Infinity, -Infinity]) {
      expect(() => scoreAnswers(QUESTIONS, [{ questionId: 10, selectedIndex: bad }])).toThrow(
        /Invalid selectedIndex/,
      )
    }
  })

  it('handles an empty deck + empty answers without throwing', () => {
    const result = scoreAnswers([], [])
    expect(result.score).toBe(0)
    expect(result.scored).toEqual([])
  })

  it('does not throw when the deck is non-empty but answers is empty', () => {
    // The IPC handler doesn't enforce "answers.length === questions.length";
    // that's a spec validation, not a scoring concern. An empty submission
    // scores zero. (The renderer always submits a full answer set.)
    const result = scoreAnswers(QUESTIONS, [])
    expect(result.score).toBe(0)
    expect(result.scored).toEqual([])
  })
})
