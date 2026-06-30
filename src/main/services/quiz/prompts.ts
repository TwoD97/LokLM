// Prompt templates for the quiz generator. Bilingual: each builder takes a
// `lang` and returns the localized string. One grammar-constrained call per
// quiz unit; the model is told to output JSON only and the generator's code
// validation is the only quality gate — there is no retry.

import type { QuizLanguage } from '../../../shared/quiz'

/** Per-question output budget: a 4-option MCQ + short explanation + a couple
 *  of citation ids fits well under this. maxTokens for a unit call =
 *  PER_UNIT_MAX_QUESTIONS * PER_QUESTION_TOKEN_BUDGET + a little headroom,
 *  bounding runaway generation. Has to accommodate the schema maxLength
 *  bounds ( stem 220 + 4 options × 140 + explanation 280 = ~1.1k chars ≈
 *  ~320 tokens ). */
export const PER_QUESTION_TOKEN_BUDGET = 320

/** Hard ceiling on one unit's question count — the "≤8 per paragraph" cap. The
 *  model is asked to hit a size-scaled target (targetQuestionCount) and may go
 *  up to here, but no further. Also stops a degenerate model decoding forever. */
export const PER_UNIT_MAX_QUESTIONS = 8

/** Soft ceiling on a whole deck: question count approaches but never reaches
 *  this however large the document, so a 200-page book yields a usable deck
 *  (and a bounded number of LLM calls) instead of thousands of questions. */
export const MAX_DECK_QUESTIONS = 110
/** Document size (tokens) at which a deck reaches HALF of MAX_DECK_QUESTIONS.
 *  Smaller ⇒ density ramps up faster with document size. ~9k tokens ≈ a long
 *  article → ~55 questions. */
export const DECK_HALF_TOKENS = 9000

/** Target number of questions for a whole document — a saturating function of
 *  its size (Michaelis–Menten): dense for short docs, leveling off for long
 *  ones. This, not a fixed tokens-per-question, is what scales the quiz to the
 *  document. */
export function targetDeckSize(docTokens: number): number {
  if (docTokens <= 0) return 0
  return (MAX_DECK_QUESTIONS * docTokens) / (docTokens + DECK_HALF_TOKENS)
}

/** A single unit's question target: its proportional share of the document-wide
 *  targetDeckSize, clamped to [1, PER_UNIT_MAX_QUESTIONS]. Summed across a
 *  document's units this approximates targetDeckSize(docTokens). The prompt asks
 *  the model to aim for this; it stays free to write fewer for thin material. */
export function targetQuestionCount(unitTokens: number, docTokens: number): number {
  if (docTokens <= 0) return 1
  const share = targetDeckSize(docTokens) * (unitTokens / docTokens)
  return Math.max(1, Math.min(PER_UNIT_MAX_QUESTIONS, Math.round(share)))
}

/** node-llama-cpp GbnfJsonSchema for the batch-of-MCQs array. The grammar
 *  enforces JSON *syntax* + the value shapes here (enum for correct_index,
 *  integer/string arrays); the "exactly 4 distinct options", "ids ⊆ allowed",
 *  and non-empty-string checks stay in the TS validators since the grammar
 *  can't express them. Passed straight to llama.createGrammarForJsonSchema in
 *  the worker.
 *
 *  The array + options length bounds are load-bearing, not cosmetic: without
 *  `minItems`/`maxItems` a weak model takes the lazy path and emits
 *  `"options": []` (or a whole empty array), which then fails validation →
 *  zero questions. `maxItems` doubles as the unit quota so a verbose model
 *  can't keep going past the questions we asked for.
 *
 *  maxItems = PER_UNIT_MAX_QUESTIONS is the anti-runaway bound, not a quota:
 *  between 1 and the ceiling, the grammar lets the model close the array
 *  whenever it judges the material covered.
 *
 *  maxLength on stem/options/explanation bounds the per-field decode so the
 *  PER_QUESTION_TOKEN_BUDGET cap is actually achievable. Option maxLength 140:
 *  German compound words ( Sitzungsschlüssel, Verschlüsselungsverfahren )
 *  routinely push a single option past 100 chars; a tighter cap truncated
 *  distinct distractors into textual duplicates which validation then
 *  rejected. node-llama-cpp 3.x honours both the array length keywords and the
 *  string length keywords. */
export const QUESTION_LIST_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: PER_UNIT_MAX_QUESTIONS,
  items: {
    type: 'object',
    properties: {
      stem: { type: 'string', minLength: 8, maxLength: 220 },
      options: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 140 },
        minItems: 4,
        maxItems: 4,
      },
      correct_index: { enum: [0, 1, 2, 3] },
      explanation: { type: 'string', minLength: 8, maxLength: 280 },
      source_chunk_ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
    },
  },
} as const

export interface UnitQuestionPromptInput {
  language: QuizLanguage
  /** Document the unit came from — orientation for the model. */
  docTitle: string
  /** Section heading of the unit (or doc title fallback). */
  unitTitle: string
  /** Chunks formatted as "[chunk:42] <text>" — the LLM is told to cite by id. */
  groundingBlock: string
  /** Token size of this unit — its share of the document-wide question target. */
  unitTokens: number
  /** Token size of the whole document — sets the overall density (targetDeckSize)
   *  the unit's share is drawn from. */
  docTokens: number
}

/** Per-unit builder: coverage-first. The model is asked to write a question for
 *  every distinct, testable fact, aiming for a size-scaled target and bounded
 *  by the PER_UNIT_MAX_QUESTIONS ceiling. Grounded ONLY in the unit's chunks.
 *  No avoid-list — cross-unit duplicates are structurally unlikely (different
 *  units = different material) and the deck-level normalized stem dedup catches
 *  the rest in code. */
export function buildUnitQuestionPrompt(input: UnitQuestionPromptInput): string {
  const { language, docTitle, unitTitle, groundingBlock, unitTokens, docTokens } = input
  const max = PER_UNIT_MAX_QUESTIONS
  const target = targetQuestionCount(unitTokens, docTokens)
  if (language === 'de') {
    return `Du schreibst Multiple-Choice-Fragen für eine Studierende.

Dokument: ${docTitle}
Abschnitt: ${unitTitle}

Quellmaterial (jeder Eintrag ist ein zitierbarer Chunk — nutze NUR dieses Material):
${groundingBlock}

Anforderungen:
- Decke den Stoff DICHT ab: schreibe für JEDE eigenständige, prüfungswürdige Information eine eigene Frage. Ziel sind etwa ${target} Fragen (mindestens 1, höchstens ${max}). Schöpfe den echten Prüfstoff voll aus.
- Keine Wiederholungen und keine Trivialfragen: jede Frage testet eine ANDERE Information; frage Verständnis oder Anwendung, nicht bloßes Auswendiglernen. Nur wenn das Material wirklich wenig hergibt, schreibe entsprechend weniger als das Ziel.
- Alle Fragen klar voneinander verschieden, ausschließlich auf dem Quellmaterial oben basierend.
- Jede Frage hat genau 4 Antwortmöglichkeiten — ALLE VIER MÜSSEN UNTERSCHIEDLICH sein (keine Duplikate, keine Umformulierungen derselben Antwort), alle plausibel, genau EINE richtig.
- Die richtige Antwort muss eine inhaltliche Aussage sein — niemals "alle/keine der genannten".
- Die Erklärung muss begründen, warum die richtige Antwort stimmt, und sich auf das Material stützen.
- "source_chunk_ids" enthält nur Chunk-IDs, die oben tatsächlich vorkommen, primär zuerst.

Antworte AUSSCHLIESSLICH mit einem JSON-Array:
[
  {
    "stem": "...",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "...",
    "source_chunk_ids": [1, 2]
  }
]

Kein Vorspann, kein Code-Block, keine zusätzlichen Felder.

/no_think`
  }
  return `Write multiple-choice questions for a learner.

Document: ${docTitle}
Section: ${unitTitle}

Source material (each entry is a citable chunk — use ONLY this material):
${groundingBlock}

Requirements:
- Cover the material DENSELY: write a separate question for EVERY distinct, exam-worthy piece of information. Aim for about ${target} questions (at least 1, at most ${max}). Exhaust the real testable content.
- No repetition and no trivia: each question tests a DIFFERENT fact; probe understanding or application, not rote recall. Only if the material genuinely supports fewer, write fewer than the target.
- All questions clearly distinct from each other, grounded solely in the source material above.
- Each question has exactly 4 options — ALL FOUR MUST BE DISTINCT (no duplicates, no rewordings of the same answer), all plausible, exactly ONE correct.
- The correct answer must be a substantive statement — never "all/none of the above".
- The explanation must justify the correct answer using the material.
- "source_chunk_ids" lists only chunk ids that actually appear above, primary first.

Reply with ONLY a JSON array:
[
  {
    "stem": "...",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "...",
    "source_chunk_ids": [1, 2]
  }
]

No preamble, no code fences, no extra fields.

/no_think`
}
