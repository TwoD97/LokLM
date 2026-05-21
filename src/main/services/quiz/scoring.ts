// Pure helper called by the `quiz:finish-attempt` IPC handler. Kept here (not
// inlined in main/index.ts) so it's directly unit-testable — the runner sends
// the ORIGINAL option index per question (after un-shuffling its display perm),
// and this function is the single source of truth for how those indices map to
// correctness + the deck-level score. Mismatch here = silently wrong scores
// across the whole app.

export interface ScorableQuestion {
  id: number
  correctIndex: number
}

export interface SubmittedAnswer {
  questionId: number
  selectedIndex: number
}

export interface ScoredAnswer extends SubmittedAnswer {
  correct: boolean
}

export interface ScoringResult {
  scored: ScoredAnswer[]
  score: number
}

/**
 * Validate each submitted answer against the deck's questions and compute the
 * score. Throws on any invalid input — the IPC handler propagates the error
 * back to the renderer rather than persisting a partial attempt.
 *
 * Validation rules:
 *  - every `questionId` MUST belong to the deck (i.e. exist in `questions`)
 *  - `selectedIndex` MUST be an integer in [0, 3]
 *
 * The 0..3 range matches the spec's MCQ shape; a future deck shape change
 * would need to widen this guard.
 */
export function scoreAnswers(
  questions: ReadonlyArray<ScorableQuestion>,
  answers: ReadonlyArray<SubmittedAnswer>,
): ScoringResult {
  const correctById = new Map(questions.map((q) => [q.id, q.correctIndex]))
  const scored: ScoredAnswer[] = []
  let score = 0
  for (const a of answers) {
    const correctIdx = correctById.get(a.questionId)
    if (correctIdx === undefined) {
      throw new Error(`Question ${a.questionId} does not belong to this attempt`)
    }
    if (!Number.isInteger(a.selectedIndex) || a.selectedIndex < 0 || a.selectedIndex > 3) {
      throw new Error(`Invalid selectedIndex ${a.selectedIndex} for question ${a.questionId}`)
    }
    const correct = a.selectedIndex === correctIdx
    if (correct) score += 1
    scored.push({ questionId: a.questionId, selectedIndex: a.selectedIndex, correct })
  }
  return { scored, score }
}
