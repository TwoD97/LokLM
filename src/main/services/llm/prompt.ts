import type { RetrievalHit } from '../../../shared/documents'

export type ResponseLanguage = 'de' | 'en'

/** How fully the model should develop an answer. Keyed off the active tier so a
 *  bigger model is allowed to say more: Lite stays terse, Standard answers in
 *  full, Pro develops the explanation. This steers verbosity through the system
 *  prompt — `answerMaxTokens` already hands Standard and Pro the full 32K
 *  ceiling, so the cap was never what kept their answers short; the prompt was. */
export type AnswerDepth = 'concise' | 'standard' | 'thorough'

export const REFUSAL_TEXT: Record<ResponseLanguage, string> = {
  de: 'Diese Information findet sich nicht in den bereitgestellten Dokumenten.',
  en: 'This information is not in the provided documents.',
}

// Appended to a truncated answer when the streaming loop detector trips.
// Leading newline so it stays on its own line below whatever fragment the
// model emitted before getting stuck.
export const REPETITION_HINT_TEXT: Record<ResponseLanguage, string> = {
  de: '\n\n[…] (Antwort wegen Wiederholungsschleife abgebrochen — bitte umformulieren oder Kontext einschränken)',
  en: '\n\n[…] (response stopped due to repetition loop — try rephrasing or narrowing the context)',
}

// Per-message length cap when embedding prior conversation. ~1500 chars
// keeps each turn ~400 tokens, so 10 turns is ~4 K tokens — fits comfortably
// alongside the system prompt + tools + retrieval block + answer in 32 K+
// context windows.
export const HISTORY_MESSAGE_CHAR_CAP = 1500
export const HISTORY_TRUNCATION_MARKER = '… [truncated]'

// ---- token budgeting for the Context block --------------------------------
//
// LokLM runs small local models with tight windows (the Lite profile is ~8K).
// buildPrompt used to dump EVERY retrieved hit into the prompt verbatim, so a
// broad/summary query (topK up to 12) could silently overflow the window —
// forcing the history-drop retry or letting llama.cpp truncate blindly. We now
// trim hits to a token budget before they're fed (and before QAService emits
// citations, so the chips match exactly what the model saw).
//
// Tokens are estimated by characters (~3.5 chars/token across DE+EN) rather
// than a real tokenizer: within ~10%, zero hot-path cost, and consistent with
// how the chunker + quiz themes already budget.
export const CHARS_PER_TOKEN = 3.5

/** Window assumed when the active provider can't report one (e.g. Ollama
 *  without an /api/show round-trip). Matches the quiz path's fallback. */
export const DEFAULT_CONTEXT_TOKENS = 8192

/** Safety slack so estimate error + the worker's own framing never tips us
 *  over the real window. */
export const CONTEXT_PACK_MARGIN_TOKENS = 192

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Answer-generation reserve. SINGLE source for both the maxTokens LlamaService
 *  passes the worker AND the packer's reserve — reserve == ceiling, so a long
 *  answer can never overrun the window. ~1/2 of the window, floored at 4K, capped
 *  at 128K. 0.6.4: raised from ~1/4-capped-32K so a 'thorough' answer isn't
 *  clipped — it scales with the tier's window: Lite's 8K keeps the 4K floor
 *  (lean tier unchanged), Standard's 128K window → 64K answer, Pro's 256K → 128K.
 *  Even with half the window reserved, each tier keeps the other half for prompt
 *  + RAG — far above the handful of chunks topK ever packs, so grounding budget
 *  is untouched in practice. */
export function answerMaxTokens(contextSize: number): number {
  return Math.max(4096, Math.min(131072, Math.floor(contextSize / 2)))
}

/** Rough token cost of the rendered history block — mirrors the per-message
 *  char cap buildPrompt applies, plus a few tokens per turn for the role label
 *  and separators — so the packer reserves room for it. */
export function estimateHistoryTokens(
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): number {
  if (!history || history.length === 0) return 0
  let chars = 0
  for (const m of history) chars += Math.min(m.content.length, HISTORY_MESSAGE_CHAR_CAP) + 12
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** Trim retrieval hits to fit `budgetTokens`, preserving rank order and ALWAYS
 *  keeping at least the top hit (a single chunk that alone exceeds the budget
 *  is still better than refusing). Cost per hit matches buildPrompt's rendering
 *  (header + text + the "\n\n---\n\n" separator). */
export function packHitsToBudget(
  hits: RetrievalHit[],
  budgetTokens: number,
  responseLang?: ResponseLanguage,
): RetrievalHit[] {
  if (hits.length <= 1) return hits
  const SEP_TOKENS = 4
  const out: RetrievalHit[] = []
  let used = 0
  for (const h of hits) {
    const cost =
      estimateTokens(formatHitHeader(h, responseLang)) + estimateTokens(h.text) + SEP_TOKENS
    if (out.length > 0 && used + cost > budgetTokens) break
    out.push(h)
    used += cost
  }
  return out
}

/**
 * Build the system prompt for a given response language. The MVP locks the
 * model to exactly one of DE / EN per session — this keeps Piper TTS happy
 * (the bundled voices only cover those two languages) and matches the
 * Lastenheft's bilingual scope.
 *
 * The prompt is written natively per language. Research (Cross-Lingual
 * Prompt Steerability, MultiQ, Native Design Bias) shows language-matched
 * system prompts give ~5–10 % better consistency and reduce English-drift
 * on multilingual models, with a steeper benefit at the 4B–8B end of the
 * model size range — exactly where LokLM's Lite profile sits.
 *
 * Format keywords stay verbatim across both variants:
 *   - `[doc:<documentId>, chunk:<chunkId>]` — UI parses this for chip rendering
 *   - `Context` — buildPrompt() always emits the English header `Context:`,
 *     so the rules reference it by that literal in both languages
 *
 * The system prompt deliberately does NOT quote REFUSAL_TEXT verbatim. The lite
 * 2B GGUF is a weak instruction-follower and would PARROT a quoted refusal
 * string — appending "Diese Information findet sich nicht…" to the END of a
 * perfectly good, grounded answer. Instead the prompt just tells it not to
 * invent; real refusals are emitted programmatically by QAService (empty/below-
 * threshold retrieval) and renderFallback, which remain the REFUSAL_TEXT[lang]
 * single source of truth.
 */
export function buildSystemPrompt(
  lang: ResponseLanguage,
  depth: AnswerDepth = 'concise',
  opts?: { codebase?: boolean },
): string {
  return lang === 'de'
    ? buildSystemPromptDe(depth, opts?.codebase ?? false)
    : buildSystemPromptEn(depth, opts?.codebase ?? false)
}

// Codebase workspaces (ADR-0006): the base prompt is written for a document
// library — it says nothing about reading code and its FORMAT rule ("plain
// text") actively fights readable code answers. This section is appended only
// when the active workspace is a codebase, so the document tiers (and Lite,
// which has no codebase workspaces) keep the exact prompt they were tuned on.
const CODE_SECTION_EN = `

CODE
The Context may contain source-code excerpts; each header names the file (path after '§') and the excerpt's lines (numbers after 'p.' are LINE numbers, not pages) — treat that as the code's location and name it when you explain where something happens. Reproduce file names, class names, and function names exactly as written in the Context (exact casing). Never invent an API, parameter, class, or behaviour the excerpts do not show. Short code identifiers and one-line snippets from the Context are allowed in the answer despite the plain-text rule; keep them verbatim.`

const CODE_SECTION_DE = `

CODE
Der Context kann Quellcode-Ausschnitte enthalten; jeder Kopf nennt die Datei (Pfad nach „§") und die Zeilen des Ausschnitts (Zahlen nach „S." sind ZEILENnummern, keine Seiten) — das ist der Ort des Codes, benenne ihn, wenn du erklärst, wo etwas passiert. Gib Datei-, Klassen- und Funktionsnamen exakt so wieder, wie sie im Context stehen (exakte Groß-/Kleinschreibung). Erfinde nie eine API, einen Parameter, eine Klasse oder ein Verhalten, das die Ausschnitte nicht zeigen. Kurze Code-Bezeichner und einzeilige Snippets aus dem Context sind in der Antwort trotz der Reiner-Text-Regel erlaubt; übernimm sie wörtlich.`

/** Length guidance per tier. The DISCIPLINE rules above already bar rambling and
 *  trailing summaries, so "thorough" means a fuller explanation, not padding. */
const LENGTH_EN: Record<AnswerDepth, string> = {
  concise:
    'Keep the answer concise — state the answer and the support it needs, nothing more. A few sentences usually suffice.',
  standard:
    'Give a complete answer — explain it with the detail and context the question calls for, usually a short paragraph or two. Do not pad, but do not cut an explanation short.',
  thorough:
    'Answer thoroughly — develop the explanation in full: cover the relevant points, add supporting detail, context, and examples drawn from the Context, and lay out the reasoning where it aids understanding. Prefer a complete, well-developed answer over a brief one, while staying grounded in the sources.',
}

const LENGTH_DE: Record<AnswerDepth, string> = {
  concise:
    'Halte die Antwort knapp — nenne die Antwort und nur den nötigen Beleg. Wenige Sätze genügen meist.',
  standard:
    'Gib eine vollständige Antwort — erläutere sie mit dem Detail und Kontext, den die Frage verlangt, in der Regel ein bis zwei kurze Absätze. Blähe nichts auf, kürze eine Erklärung aber auch nicht ab.',
  thorough:
    'Antworte ausführlich — entwickle die Erklärung vollständig: decke die relevanten Punkte ab, ergänze stützende Details, Kontext und Beispiele aus dem Context und lege den Gedankengang dar, wo er das Verständnis fördert. Bevorzuge eine vollständige, gut ausgearbeitete Antwort gegenüber einer knappen — bleibe dabei an den Quellen verankert.',
}

function buildSystemPromptEn(depth: AnswerDepth, codebase = false): string {
  return `You are LokLM, a local assistant grounded in the user's document library.

Always respond in English. If the user writes in another language, translate the question internally but answer only in English.

After each sentence that uses the Context, append the marker of the passage you used, in exactly this form: [doc:<documentId>, chunk:<chunkId>] — for example: The report lists three risk factors [doc:4, chunk:1]. Use only ids that appear in the Context, and put each marker right after its own sentence, never gathered into a list at the end. (Do not copy these instructions into your reply.)

SOURCE
Answer using the ENTIRE provided Context. Use every relevant passage in it — do not single out one source or one chunk and ignore the rest, and do not compress the Context down to a single point when several passages bear on the question. Combine what all the relevant passages say into one answer.
Use only the provided Context. No outside knowledge or assumptions beyond what the Context supports. If the Context only names or mentions something without defining or explaining it, answer with exactly what the Context says about it — do not complete the definition, mechanism, or detail from general knowledge. A correct partial answer drawn from the Context beats a fuller one that adds unsupported claims. If the Context does not contain the answer, do not invent one — never state a definition or fact the Context does not contain.

DERIVATION
You may combine and compute values from the Context — arithmetic, percentages, ratios, residuals, multi-step calculations. Inputs may appear in different sections; check the full Context before concluding the answer is unavailable.

CALCULATIONS
Name the inputs and where they appear, show the operation, then state the final answer at the end. The final answer is the conclusion of the work shown, not a value asserted before it. Match the precision of the source — do not produce 4-decimal outputs from 2-significant-figure inputs.

DISCIPLINE
Reason internally before writing. Never emit "wait", "actually", "let me reconsider", parenthetical corrections, multiple competing calculations, lists of alternative interpretations, meta-commentary on your reasoning, or trailing summary blocks. One calculation, one final answer per question.

AMBIGUITY
If a question could refer to multiple things in the Context, briefly note the ambiguity and commit to the most likely reading. Do not list alternatives.

PARSIMONY
Use the simplest calculation path the question supports — no extra adjustments unless explicitly required.

LENGTH
${LENGTH_EN[depth]}

FORMAT
Plain text. No LaTeX, decorative headers, or tables unless asked. Do not bold a final answer at the top — the final answer comes at the end of the work.${codebase ? CODE_SECTION_EN : ''}

/no_think`
}

function buildSystemPromptDe(depth: AnswerDepth, codebase = false): string {
  return `Du bist LokLM, ein lokaler Assistent, der in der Dokumentbibliothek des Nutzers verankert ist.

Antworte immer auf Deutsch. Schreibt der Nutzer in einer anderen Sprache, übersetze die Frage intern, aber antworte ausschließlich auf Deutsch.

Hänge an jeden Satz, der den Context nutzt, den Marker der verwendeten Passage in genau dieser Form an: [doc:<documentId>, chunk:<chunkId>] — zum Beispiel: Der Bericht nennt drei Risikofaktoren [doc:4, chunk:1]. Verwende nur IDs, die im Context vorkommen, und setze jeden Marker direkt hinter seinen eigenen Satz, niemals gesammelt in einer Liste am Ende. (Übernimm diese Anweisungen nicht in deine Antwort.)

QUELLE
Beantworte die Frage mit dem GESAMTEN bereitgestellten Context. Nutze jede relevante Passage darin — suche dir nicht eine einzelne Quelle oder ein einzelnes Stück heraus und ignoriere den Rest, und komprimiere den Context nicht auf einen einzigen Punkt, wenn mehrere Passagen zur Frage beitragen. Führe zusammen, was alle relevanten Passagen sagen.
Nutze nur den bereitgestellten Context. Kein externes Wissen, keine Annahmen jenseits dessen, was der Context hergibt. Nennt oder erwähnt der Context etwas nur, ohne es zu definieren oder zu erklären, antworte genau mit dem, was der Context dazu sagt — ergänze Definition, Funktionsweise oder Details nicht aus Allgemeinwissen. Eine korrekte Teilantwort aus dem Context ist besser als eine vollständigere mit unbelegten Aussagen. Enthält der Context die Antwort nicht, erfinde keine — behaupte nie eine Definition oder Tatsache, die der Context nicht enthält.

ABLEITUNG
Du darfst Werte aus dem Context kombinieren und berechnen — Arithmetik, Prozente, Verhältnisse, Residuen, mehrstufige Rechnungen. Eingangswerte können in verschiedenen Abschnitten stehen; prüfe den vollständigen Context, bevor du zu dem Schluss kommst, die Antwort sei nicht verfügbar.

RECHENWEG
Nenne die Eingangswerte und wo sie stehen, zeige die Rechenoperation, gib die finale Antwort am Ende an. Die finale Antwort ist das Ergebnis des gezeigten Wegs, kein vorab genannter Wert. Übernimm die Präzision der Quelle — keine 4 Nachkommastellen aus 2 signifikanten Stellen.

DISZIPLIN
Denke intern, bevor du schreibst. Verwende nie "Moment", "eigentlich", "lass mich noch einmal nachdenken", Korrekturen in Klammern, mehrere konkurrierende Rechnungen, Listen alternativer Lesarten, Meta-Kommentare zu deinem Denken oder abschließende Zusammenfassungsblöcke. Eine Rechnung, eine finale Antwort pro Frage.

UNSCHÄRFE
Könnte eine Frage mehrere Dinge im Context meinen, benenne die Mehrdeutigkeit kurz und entscheide dich für die wahrscheinlichste Lesart. Liste keine Alternativen auf.

SPARSAMKEIT
Nutze den einfachsten Rechenweg, den die Frage hergibt — keine zusätzlichen Anpassungen, wenn nicht ausdrücklich gefordert.

UMFANG
${LENGTH_DE[depth]}

FORMAT
Reiner Text. Kein LaTeX, keine dekorativen Überschriften, keine Tabellen, sofern nicht gefordert. Setze die finale Antwort nicht fett ganz oben — sie steht am Ende des Rechenwegs.${codebase ? CODE_SECTION_DE : ''}

/no_think`
}

/**
 * Section order is deliberate for KV-cache prefix reuse, most-stable first:
 * pinned context (changes only when the user pins/unpins), then conversation
 * history (grows append-only, so all but the newest turn is a stable prefix),
 * then RAG context + question (change every turn). node-llama-cpp aligns each
 * new prompt against the sequence's existing token state and only evaluates
 * from the first differing token — with this layout, consecutive turns in a
 * workspace re-prefill only the newest history entry + RAG block + question
 * instead of the whole prompt.
 */
export function buildPrompt(
  question: string,
  hits: RetrievalHit[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  responseLang?: ResponseLanguage,
  pinnedHits?: RetrievalHit[],
  /** Optional uncited block rendered at the top of the Context section —
   *  the doc_summary route feeds the cached whole-doc summary here. It is
   *  background material, NOT a citable source: it carries no
   *  [doc, chunk] header on purpose (ADR-0003, "Option A"), so the
   *  system prompt's "use only ids you have actually seen" keeps holding.
   *  Deliberately AFTER the pinned section: the preamble is per-turn volatile
   *  (resolved doc + packing outcome) , and anything ahead of the pinned
   *  block would break the stable KV prefix the section order above buys. */
  contextPreamble?: string,
): string {
  const sections: string[] = []

  const renderHits = (list: RetrievalHit[]): string =>
    list.map((h) => `${formatHitHeader(h, responseLang)}\n${h.text}`).join('\n\n---\n\n')

  const hasPinned = pinnedHits !== undefined && pinnedHits.length > 0
  if (hasPinned) {
    sections.push(`Context (pinned):\n${renderHits(pinnedHits)}`)
  }

  if (history && history.length > 0) {
    const lines: string[] = []
    for (const m of history) {
      const role = m.role === 'user' ? 'User' : 'Assistant'
      const text =
        m.content.length > HISTORY_MESSAGE_CHAR_CAP
          ? m.content.slice(0, HISTORY_MESSAGE_CHAR_CAP - HISTORY_TRUNCATION_MARKER.length) +
            HISTORY_TRUNCATION_MARKER
          : m.content
      lines.push(`${role}: ${text}`)
    }
    sections.push(`Previous conversation in this chat:\n${lines.join('\n\n')}`)
  }

  const blocks: string[] = []
  if (contextPreamble) blocks.push(contextPreamble)
  if (hits.length > 0) blocks.push(renderHits(hits))
  if (blocks.length === 0) {
    // With pinned content present the model still has a Context section to
    // answer from — emitting "(none)" here would nudge it toward refusing.
    if (!hasPinned) sections.push('Context: (none)')
  } else {
    sections.push(`Context:\n${blocks.join('\n\n---\n\n')}`)
  }

  sections.push(`Question: ${question}`)
  return sections.join('\n\n')
}

/** Preamble block for the doc_summary route: the cached whole-doc summary,
 *  labelled so the model treats it as background and keeps its citations on
 *  the excerpt blocks that follow. Localized per response language — unlike
 *  the bare Context:/Question: headers this block carries a behavioral
 *  instruction the system prompt does NOT anchor, and free-form English
 *  inside an otherwise German prompt is exactly the cross-lingual
 *  instruction-following weakness the native-prompt research above warns
 *  about at the 4B–8B end.
 *
 *  `hasExcerpts` switches the citation instruction: with excerpt blocks the
 *  model is pointed at them; without (doc-pinned zero-hit fallback) telling
 *  it to "cite the blocks below" would point at nothing while the system
 *  prompt still demands per-claim ids — so it is told to answer uncited
 *  instead. */
export function buildSummaryPreamble(
  lang: ResponseLanguage,
  title: string,
  summary: string,
  hasExcerpts: boolean,
): string {
  if (lang === 'de') {
    const instruction = hasExcerpts
      ? 'keine Zitat-ID — belege konkrete Aussagen mit den Auszugsblöcken unten'
      : 'für diesen Überblick gibt es keine Zitat-ID — antworte daraus und füge keine Zitatmarker ein'
    return `Dokumentüberblick — „${title}“ (Hintergrund, aus dem gesamten Dokument abgeleitet; ${instruction}):\n${summary}`
  }
  const instruction = hasExcerpts
    ? 'no citation id — cite the excerpt blocks below for specific claims'
    : 'no citation id exists for this overview — answer from it and do not emit citation markers'
  return `Document overview — "${title}" (background derived from the full document; ${instruction}):\n${summary}`
}

export function renderFallback(
  question: string,
  hits: RetrievalHit[],
  lang: ResponseLanguage = 'en',
): string {
  if (hits.length === 0) return REFUSAL_TEXT[lang]
  const intro =
    lang === 'de'
      ? `Frage: "${question}"\n\nGefundene Belege (Modell lädt noch oder ist nicht bereit):\n\n`
      : `Question: "${question}"\n\nMatches found (model is still loading or unavailable):\n\n`
  const body = hits
    .map((h) => {
      const snippet = condense(h.text, 240)
      const loc = formatHitLocation(h, lang)
      return `• ${snippet} [doc:${h.document_id}, chunk:${h.chunk_id}] (${h.document_title}${loc})`
    })
    .join('\n')
  return intro + body
}

/** Header line for a single retrieval hit in the LLM context block. Prefers
 *  the heading breadcrumb (markdown) over the page number (PDFs/text) because
 *  it gives the model — and the user reading the citation — a far more
 *  meaningful provenance label.
 *
 *  When the chunk's detected `language` is known AND differs from the response
 *  language, appends `, lang:xx` so the model knows it's translating quoted
 *  material rather than copying verbatim. Null language (legacy chunks, or
 *  text too short for eld) is treated as unknown and no tag is emitted —
 *  silent fallback is safer than guessing wrong, because tagging EN as DE
 *  would actively mislead the model. */
function formatHitHeader(h: RetrievalHit, responseLang?: ResponseLanguage): string {
  // Location label follows the response language ('S.' vs 'p.') so the CODE
  // system-prompt section's reading instruction matches what the model sees.
  const loc = formatHitLocation(h, responseLang ?? 'en')
  const langTag =
    responseLang && h.language && h.language !== 'other' && h.language !== responseLang
      ? `, lang:${h.language}`
      : ''
  return `[doc:${h.document_id}, chunk:${h.chunk_id}] (${h.document_title}${loc}${langTag})`
}

function formatHitLocation(h: RetrievalHit, lang: ResponseLanguage): string {
  const headingPart =
    h.heading_path && h.heading_path.length > 0 ? `§ ${h.heading_path.join(' › ')}` : null
  // Range when the chunk spans pages/lines (code chunks carry LINE numbers in
  // page_from/page_to — the CODE prompt section explains the reading).
  const pageRange =
    h.page_to != null && h.page_to !== h.page_from ? `${h.page_from}–${h.page_to}` : `${h.page_from}`
  const pagePart = h.page_from != null ? (lang === 'de' ? `S. ${pageRange}` : `p.${pageRange}`) : null
  // PDFs with bookmarks emit both — heading first (topical), page second
  // (positional). Markdown produces only the heading; PDFs without bookmarks
  // only the page. Both null → empty string.
  if (headingPart && pagePart) return `, ${headingPart}, ${pagePart}`
  if (headingPart) return `, ${headingPart}`
  if (pagePart) return `, ${pagePart}`
  return ''
}

export function condense(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max - 1) + '…'
}

export function chunkifyForStream(text: string): string[] {
  const parts: string[] = []
  const tokens = text.split(/(\s+)/)
  let buf = ''
  for (const t of tokens) {
    buf += t
    if (buf.length >= 12) {
      parts.push(buf)
      buf = ''
    }
  }
  if (buf.length > 0) parts.push(buf)
  return parts
}

export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

/**
 * Streaming filter that strips Qwen3-style <think>…</think> blocks. Even with
 * `/no_think` in the system prompt, the model occasionally emits empty or
 * stray thinking blocks; this keeps them out of the user-visible stream.
 *
 * Holds back up to a tag-length tail so a partial '<thi' at a chunk boundary
 * is not flushed prematurely.
 */
export class ThinkFilter {
  private buf = ''
  private inside = false
  private static OPEN = '<think>'
  private static CLOSE = '</think>'

  /** Drop any in-flight buffer state so the filter can be reused across
   *  multiple session.prompt() retries within a single askWithModel call. */
  reset(): void {
    this.buf = ''
    this.inside = false
  }

  feed(text: string): string {
    this.buf += text
    let out = ''
    let i = 0
    while (i < this.buf.length) {
      if (this.inside) {
        const j = this.buf.indexOf(ThinkFilter.CLOSE, i)
        if (j === -1) {
          // keep enough tail to detect a partial '</think>' across chunks
          const tailLen = ThinkFilter.CLOSE.length - 1
          if (this.buf.length - i > tailLen) {
            this.buf = this.buf.slice(this.buf.length - tailLen)
          } else {
            this.buf = this.buf.slice(i)
          }
          return out
        }
        i = j + ThinkFilter.CLOSE.length
        this.inside = false
      } else {
        const j = this.buf.indexOf(ThinkFilter.OPEN, i)
        if (j === -1) {
          // hold the last few chars in case '<think>' is split across chunks
          const tailLen = ThinkFilter.OPEN.length - 1
          const safeEnd = Math.max(i, this.buf.length - tailLen)
          out += this.buf.slice(i, safeEnd)
          this.buf = this.buf.slice(safeEnd)
          return out
        }
        out += this.buf.slice(i, j)
        i = j + ThinkFilter.OPEN.length
        this.inside = true
      }
    }
    this.buf = ''
    return out
  }

  flush(): string {
    if (this.inside) {
      this.buf = ''
      this.inside = false
      return ''
    }
    const out = this.buf
    this.buf = ''
    return out
  }
}

/**
 * Streaming detector for repetition loops — the failure mode where the model
 * gets stuck emitting the same line / phrase until it hits maxTokens. node-
 * llama-cpp's repeatPenalty catches token-level loops; this catches the
 * verbatim-substring spiral that penalties miss.
 *
 * Holds a rolling window of recent output. Whenever the trailing NGRAM slice
 * has occurred K times non-overlapping inside the window, trip() returns true
 * and the caller is expected to abort the in-flight generation.
 */
export class LoopDetector {
  private buf = ''
  private tripped = false
  private static readonly NGRAM = 40
  private static readonly K = 3
  private static readonly WINDOW = 1024

  feed(text: string): boolean {
    if (this.tripped) return true
    this.buf += text
    if (this.buf.length > LoopDetector.WINDOW) {
      this.buf = this.buf.slice(-LoopDetector.WINDOW)
    }
    if (this.buf.length < LoopDetector.NGRAM * LoopDetector.K) return false
    const probe = this.buf.slice(-LoopDetector.NGRAM)
    // Skip whitespace-only or punctuation-only tails — short symbol runs
    // (newlines, bullets, separators) recur legitimately in long answers.
    if (!/[A-Za-zÄÖÜäöüß0-9]/.test(probe)) return false
    let count = 0
    let idx = 0
    while (idx <= this.buf.length - probe.length) {
      const next = this.buf.indexOf(probe, idx)
      if (next === -1) break
      count++
      idx = next + probe.length
      if (count >= LoopDetector.K) {
        this.tripped = true
        return true
      }
    }
    return false
  }

  reset(): void {
    this.buf = ''
    this.tripped = false
  }

  isTripped(): boolean {
    return this.tripped
  }
}
