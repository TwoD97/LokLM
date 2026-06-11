// Prompt templates for the quiz generator. Bilingual: each builder takes a
// `lang` and returns the localized string. One grammar-constrained call per
// quiz unit; the model is told to output JSON only and the generator's code
// validation is the only quality gate — there is no retry.

import type { QuizLanguage } from '../../../shared/quiz'

/** Per-question output budget: a 4-option MCQ + short explanation + a couple
 *  of citation ids fits well under this. maxTokens for a unit call =
 *  count * PER_QUESTION_TOKEN_BUDGET + a little headroom, bounding runaway
 *  generation. Has to accommodate the schema maxLength bounds ( stem 220 +
 *  4 options × 140 + explanation 280 = ~1.1k chars ≈ ~320 tokens ). */
export const PER_QUESTION_TOKEN_BUDGET = 320

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
 *  maxLength on stem/options/explanation bounds the per-field decode so the
 *  PER_QUESTION_TOKEN_BUDGET cap is actually achievable. Option maxLength 140:
 *  German compound words ( Sitzungsschlüssel, Verschlüsselungsverfahren )
 *  routinely push a single option past 100 chars; a tighter cap truncated
 *  distinct distractors into textual duplicates which validation then
 *  rejected. node-llama-cpp 3.x honours both the array length keywords and the
 *  string length keywords. */
export function questionListSchema(maxItems: number): object {
  return {
    type: 'array',
    minItems: 1,
    maxItems,
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
  }
}

export interface UnitQuestionPromptInput {
  language: QuizLanguage
  /** Document the unit came from — orientation for the model. */
  docTitle: string
  /** Section heading of the unit (or doc title fallback). */
  unitTitle: string
  /** Chunks formatted as "[chunk:42] <text>" — the LLM is told to cite by id. */
  groundingBlock: string
  /** Number of MCQs to request in this single call (the unit's quota). */
  count: number
}

/** Per-unit builder: asks for an ARRAY of `count` MCQs grounded ONLY in the
 *  unit's chunks. No avoid-list — cross-unit duplicates are structurally
 *  unlikely (different units = different material) and the deck-level
 *  normalized stem dedup catches the rest in code. */
export function buildUnitQuestionPrompt(input: UnitQuestionPromptInput): string {
  const { language, docTitle, unitTitle, groundingBlock, count } = input
  if (language === 'de') {
    return `Du schreibst genau ${count} verschiedene Multiple-Choice-Fragen für eine Studierende.

Dokument: ${docTitle}
Abschnitt: ${unitTitle}

Quellmaterial (jeder Eintrag ist ein zitierbarer Chunk — nutze NUR dieses Material):
${groundingBlock}

Anforderungen:
- Genau ${count} Frage(n), ${count > 1 ? 'alle klar voneinander verschieden, ' : ''}ausschließlich auf dem Quellmaterial oben basierend.
- Teste Verständnis oder Anwendung, NICHT triviales Auswendiglernen.
- Jede Frage hat genau 4 Antwortmöglichkeiten — ALLE VIER MÜSSEN UNTERSCHIEDLICH sein (keine Duplikate, keine Umformulierungen derselben Antwort), alle plausibel, genau EINE richtig.
- Die richtige Antwort muss eine inhaltliche Aussage sein — niemals "alle/keine der genannten".
- Die Erklärung muss begründen, warum die richtige Antwort stimmt, und sich auf das Material stützen.
- "source_chunk_ids" enthält nur Chunk-IDs, die oben tatsächlich vorkommen, primär zuerst.

Antworte AUSSCHLIESSLICH mit einem JSON-Array von ${count} Objekt(en):
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
  return `Write exactly ${count} distinct multiple-choice question(s) for a learner.

Document: ${docTitle}
Section: ${unitTitle}

Source material (each entry is a citable chunk — use ONLY this material):
${groundingBlock}

Requirements:
- Exactly ${count} question(s)${count > 1 ? ', all clearly distinct from each other' : ''}, grounded solely in the source material above.
- Test understanding or application, NOT trivial recall.
- Each question has exactly 4 options — ALL FOUR MUST BE DISTINCT (no duplicates, no rewordings of the same answer), all plausible, exactly ONE correct.
- The correct answer must be a substantive statement — never "all/none of the above".
- The explanation must justify the correct answer using the material.
- "source_chunk_ids" lists only chunk ids that actually appear above, primary first.

Reply with ONLY a JSON array of ${count} object(s):
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
