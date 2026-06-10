// Prompt templates for the quiz generator. Bilingual: each builder takes a
// `lang` and returns the localized string. The model is told to output JSON
// only — the generator validates and retries once on bad output.

import type { QuizLanguage } from '../../../shared/quiz'

/** Token budget used by themes.ts to decide whole-doc vs outline path. The
 *  prompt scaffolding around the doc content + the requested output reserves
 *  ~1.4k tokens; the remainder is what we can give to the document itself. */
export const THEME_PROMPT_RESERVE_TOKENS = 600
export const THEME_OUTPUT_RESERVE_TOKENS = 800
export const QUESTION_PROMPT_RESERVE_TOKENS = 800
export const QUESTION_OUTPUT_RESERVE_TOKENS = 500

/** Conservative ceiling on usable content tokens when we can't probe the live
 *  LLM context window. Lite / Full / XL all fit this; Ollama models usually do
 *  too. The theme path uses this when LlamaService.lastPlan isn't available. */
export const FALLBACK_CONTEXT_TOKENS = 8192

/** Per-question output budget for the batch generator: a 4-option MCQ + short
 *  explanation + a couple of citation ids fits well under this. maxTokens for a
 *  batch call = count * PER_QUESTION_TOKEN_BUDGET, bounding runaway generation. */
export const PER_QUESTION_TOKEN_BUDGET = 320

/** Per-question cap on CPU. Has to accommodate the schema maxLength bounds
 *  ( stem 220 + 4 options × 140 + explanation 280 = ~1.1k chars ≈ ~320 tokens
 *  per question , plus JSON overhead ). Set with a safety margin so the model
 *  doesn't get cut off mid-question on the second item of a batch=2 call. */
export const PER_QUESTION_TOKEN_BUDGET_CPU = 380

/** maxTokens cap for one windowed theme-extraction call. Windows ask for only a
 *  few themes so this is plenty, and it bounds runaway generation. */
export const THEME_EXTRACTION_MAX_TOKENS = 1024

/** Tighter theme-extraction cap on CPU inference — one window only, brief
 *  titles/summaries (see THEME_LIST_SCHEMA maxLength below). */
export const THEME_EXTRACTION_MAX_TOKENS_CPU = 400

/** Grounding-chunk char slice fed into the batch prompt. Shorter on CPU so the
 *  prompt is cheaper to ingest. */
export const GROUNDING_CHUNK_CHARS = 1200
export const GROUNDING_CHUNK_CHARS_CPU = 500

// node-llama-cpp GbnfJsonSchema objects. The grammar enforces JSON *syntax* +
// the value shapes here (enum for correct_index, integer/string arrays); the
// "exactly 4 distinct options", "ids ⊆ allowed", and non-empty-string checks
// stay in the TS validators since the grammar can't express them. These are
// passed straight to llama.createGrammarForJsonSchema in the worker.

/** Schema for the theme-extraction array. Same lazy-path bug as
 *  QUESTION_LIST_SCHEMA: without `minItems: 1` a weak / cold model finds the
 *  shortest valid output, `[]`, and bails — observed on a 2B model on CPU
 *  emitting `[ ]` in 8 characters of decode and ending the call. minLength on
 *  title/summary similarly stops the model from satisfying the array bound
 *  with empty-string themes. maxLength caps a verbose model so the grammar
 *  doesn't let a tiny budget get blown on one theme. */
export const THEME_LIST_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 100 },
      summary: { type: 'string', minLength: 10, maxLength: 250 },
      weight: { type: 'integer' },
    },
  },
} as const

/** Schema for the batch-of-MCQs array. The array + options length bounds are
 *  load-bearing, not cosmetic: without `minItems`/`maxItems` a weak model takes
 *  the lazy path and emits `"options": []` (or a whole empty array), which then
 *  fails validation → zero questions → the deck fails. Forcing exactly 4
 *  options + ≥1 question makes the grammar reject those degenerate shapes.
 *
 *  maxLength on stem/options/explanation bounds the per-field decode so the
 *  PER_QUESTION_TOKEN_BUDGET_CPU = 220 cap is actually achievable: without
 *  these caps a weak model on CPU can blow the budget on a single verbose
 *  explanation and truncate everything that follows. node-llama-cpp 3.x honours
 *  both the length keywords (minItems/maxItems) and the string length keywords
 *  (minLength/maxLength). */
export const QUESTION_LIST_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      stem: { type: 'string', minLength: 8, maxLength: 220 },
      options: {
        type: 'array',
        // Option maxLength is the load-bearing number: German compound words
        // ( Sitzungsschlüssel, Schlüsselaustausch, Verschlüsselungsverfahren )
        // routinely push a single option past 100 chars. The old cap of 80
        // truncated distinct distractors mid-word, leaving them textually
        // identical after the cut , and our validator then rejected the whole
        // question as options-not-distinct — observed on a 2B + German bench.
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

export interface ThemeExtractionInput {
  language: QuizLanguage
  /** Document title — gives the model context for naming themes. */
  docTitle: string
  /** The window's actual chunk text, already packed to fit the budget. */
  body: string
  /** Approximate number of themes to extract. Generator tunes to deck size. */
  targetCount: number
}

export function buildThemeExtractionPrompt(input: ThemeExtractionInput): string {
  const { language, docTitle, body, targetCount } = input
  if (language === 'de') {
    return `Du analysierst ein Studienmaterial und extrahierst die wichtigsten Lernthemen.

Dokumenttitel: ${docTitle}

Dokumentinhalt:
${body}

Gib eine JSON-Liste mit ungefähr ${targetCount} verschiedenen, didaktisch wertvollen Lernthemen zurück. Jedes Thema:
- "title": kurze, konzeptuelle Überschrift (max. 80 Zeichen)
- "summary": ein bis zwei Sätze, die das zu verstehende Konzept beschreiben
- "weight": ganzzahliges Gewicht 1–10, basierend auf der Wichtigkeit im Material

Themen müssen sich klar voneinander unterscheiden — keine Wiederholungen, keine Trivialwiederkennung. Konzentriere dich auf Verständnis und Anwendung, nicht auf reine Auswendiglerngegenstände.

Antworte AUSSCHLIESSLICH mit gültigem JSON-Array, keine Erklärung, keinen Vorspann, keinen Code-Block.

/no_think`
  }
  return `You are analysing study material to extract its key learning themes.

Document title: ${docTitle}

Document content:
${body}

Return a JSON list of approximately ${targetCount} distinct, pedagogically valuable learning themes. Each theme:
- "title": short conceptual heading (max 80 chars)
- "summary": one or two sentences describing the concept to be understood
- "weight": integer 1–10 reflecting how prominent the theme is in the material

Themes must be clearly distinct — no repetition, no pure recall trivia. Focus on understanding and application, not memorisation.

Reply with ONLY a valid JSON array, no preamble, no explanation, no code fences.

/no_think`
}

export interface BatchQuestionGenerationInput {
  language: QuizLanguage
  themeTitle: string
  themeSummary: string
  /** Chunks formatted as "[chunk:42] <text>" — the LLM is told to cite by id. */
  groundingBlock: string
  /** Stems already accepted in this deck — the avoid-list. */
  avoidStems: string[]
  /** Number of MCQs to request in this single call. */
  count: number
}

/** Batch builder: asks for an ARRAY of `count` MCQs grounded in the chunks. One
 *  grammar-constrained call per theme replaces the old one-question-per-call
 *  loop. Bilingual to match buildQuestionGenerationPrompt. */
export function buildBatchQuestionGenerationPrompt(input: BatchQuestionGenerationInput): string {
  const { language, themeTitle, themeSummary, groundingBlock, avoidStems, count } = input
  const avoidBlock =
    avoidStems.length > 0 ? avoidStems.map((s) => `- ${s}`).join('\n') : '(noch keine — none yet)'
  if (language === 'de') {
    return `Du schreibst genau ${count} verschiedene Multiple-Choice-Fragen für eine Studierende.

Thema: ${themeTitle}
Konzept: ${themeSummary}

Quellmaterial (jeder Eintrag ist ein zitierbarer Chunk):
${groundingBlock}

Bereits gestellte Fragen (NICHT wiederholen, nicht umformulieren):
${avoidBlock}

Anforderungen:
- Genau ${count} Fragen, alle klar voneinander verschieden.
- Teste Verständnis oder Anwendung, NICHT triviales Auswendiglernen.
- Jede Frage hat genau 4 Antwortmöglichkeiten — ALLE VIER MÜSSEN UNTERSCHIEDLICH sein (keine Duplikate, keine Umformulierungen derselben Antwort), alle plausibel, genau EINE richtig.
- Die Erklärung muss begründen, warum die richtige Antwort stimmt, und sich auf das Material stützen.
- "source_chunk_ids" enthält nur Chunk-IDs, die oben tatsächlich vorkommen, primär zuerst.

Antworte AUSSCHLIESSLICH mit einem JSON-Array von ${count} Objekten:
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
  return `Write exactly ${count} distinct multiple-choice questions for a learner.

Theme: ${themeTitle}
Concept: ${themeSummary}

Source material (each entry is a citable chunk):
${groundingBlock}

Questions already asked (do NOT repeat, do NOT paraphrase):
${avoidBlock}

Requirements:
- Exactly ${count} questions, all clearly distinct from each other.
- Test understanding or application, NOT trivial recall.
- Each question has exactly 4 options — ALL FOUR MUST BE DISTINCT (no duplicates, no rewordings of the same answer), all plausible, exactly ONE correct.
- The explanation must justify the correct answer using the material.
- "source_chunk_ids" lists only chunk ids that actually appear above, primary first.

Reply with ONLY a JSON array of ${count} objects:
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

/** Mega-batch prompt: asks for ALL deck questions across ALL themes in ONE
 *  call. CPU-only path — collapses N theme calls into 1 so prefill is paid
 *  once instead of N times ( saves ~3-5 min on a 5-theme deck on 2B/CPU ).
 *  Themes + all grounding chunks are stuffed into the single prompt; the model
 *  is asked to distribute Q across themes by weight. */
export interface DeckQuestionGenerationInput {
  language: QuizLanguage
  /** Pre-formatted theme list: each line is `- "Title" (Gewicht/weight N): summary`. */
  themeBlock: string
  /** All grounding chunks across themes, dedup'd and formatted with [chunk:N]
   *  prefixes. */
  groundingBlock: string
  avoidStems: string[]
  /** Total questions for the whole deck. */
  count: number
}

export function buildDeckQuestionGenerationPrompt(input: DeckQuestionGenerationInput): string {
  const { language, themeBlock, groundingBlock, avoidStems, count } = input
  const avoidBlock =
    avoidStems.length > 0 ? avoidStems.map((s) => `- ${s}`).join('\n') : '(noch keine — none yet)'
  if (language === 'de') {
    return `Du schreibst genau ${count} verschiedene Multiple-Choice-Fragen für eine Studierende.

Themen (verteile die Fragen gleichmäßig nach Gewicht):
${themeBlock}

Quellmaterial (jeder Eintrag ist ein zitierbarer Chunk):
${groundingBlock}

Bereits gestellte Fragen (NICHT wiederholen, nicht umformulieren):
${avoidBlock}

Anforderungen:
- Genau ${count} Fragen insgesamt, alle klar voneinander verschieden.
- Verteile die Fragen sinnvoll über die Themen — gewichtigere Themen bekommen mehr Fragen.
- Teste Verständnis oder Anwendung, NICHT triviales Auswendiglernen.
- Jede Frage hat genau 4 Antwortmöglichkeiten — ALLE VIER MÜSSEN UNTERSCHIEDLICH sein (keine Duplikate, keine Umformulierungen derselben Antwort), alle plausibel, genau EINE richtig.
- Die Erklärung muss begründen, warum die richtige Antwort stimmt, und sich auf das Material stützen.
- "source_chunk_ids" enthält nur Chunk-IDs, die oben tatsächlich vorkommen, primär zuerst.

Antworte AUSSCHLIESSLICH mit einem JSON-Array von ${count} Objekten:
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
  return `Write exactly ${count} distinct multiple-choice questions for a learner.

Themes (distribute questions across themes by weight):
${themeBlock}

Source material (each entry is a citable chunk):
${groundingBlock}

Questions already asked (do NOT repeat, do NOT paraphrase):
${avoidBlock}

Requirements:
- Exactly ${count} questions total, all clearly distinct from each other.
- Distribute the questions sensibly across themes — heavier themes get more questions.
- Test understanding or application, NOT trivial recall.
- Each question has exactly 4 options — ALL FOUR MUST BE DISTINCT (no duplicates, no rewordings of the same answer), all plausible, exactly ONE correct.
- The explanation must justify the correct answer using the material.
- "source_chunk_ids" lists only chunk ids that actually appear above, primary first.

Reply with ONLY a JSON array of ${count} objects:
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

/** Retry prompt when the previous output failed JSON validation. We send it as
 *  a new generateRaw call (not a multi-turn chat) — the LLM provider's
 *  generateRaw is single-turn. The retry prompt restates the contract. */
export function buildJsonRetryPrompt(language: QuizLanguage, original: string): string {
  if (language === 'de') {
    return `Deine vorherige Antwort war kein gültiges JSON. Antworte JETZT NUR mit einem JSON-Objekt, das genau dem geforderten Schema folgt. Keine Erklärung, kein Code-Block.

Ursprüngliche Aufgabe:
${original}

/no_think`
  }
  return `Your previous output was not valid JSON. Reply NOW with ONLY a JSON object matching the required schema. No preamble, no code fences.

Original task:
${original}

/no_think`
}
