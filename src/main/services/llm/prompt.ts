import type { RetrievalHit } from '../../../shared/documents'

export type ResponseLanguage = 'de' | 'en'

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
 *   - The refusal string comes from REFUSAL_TEXT[lang] so it stays the
 *     single source of truth for QAService and renderFallback.
 */
export function buildSystemPrompt(lang: ResponseLanguage): string {
  return lang === 'de' ? buildSystemPromptDe() : buildSystemPromptEn()
}

function buildSystemPromptEn(): string {
  const refusal = REFUSAL_TEXT.en
  return `You are LokLM, a local assistant grounded in the user's document library.

Always respond in English. If the user writes in another language, translate the question internally but answer only in English.

Cite every factual claim as [doc:<documentId>, chunk:<chunkId>] using ids from the Context block — the UI renders them as clickable chips. Use only ids you have actually seen. If the Context does not support the answer, reply exactly: "${refusal}"

SOURCE
Use only the provided Context. No outside knowledge or assumptions beyond what the Context supports.

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

FORMAT
Plain text. No LaTeX, decorative headers, or tables unless asked. Do not bold a final answer at the top — the final answer comes at the end of the work.

/no_think`
}

function buildSystemPromptDe(): string {
  const refusal = REFUSAL_TEXT.de
  return `Du bist LokLM, ein lokaler Assistent, der in der Dokumentbibliothek des Nutzers verankert ist.

Antworte immer auf Deutsch. Schreibt der Nutzer in einer anderen Sprache, übersetze die Frage intern, aber antworte ausschließlich auf Deutsch.

Belege jede faktische Aussage mit [doc:<documentId>, chunk:<chunkId>] anhand der IDs aus dem Context-Block — die Oberfläche rendert sie als klickbare Chips. Verwende nur IDs, die du tatsächlich gesehen hast. Stützt der Context die Antwort nicht, antworte exakt: "${refusal}"

QUELLE
Nutze nur den bereitgestellten Context. Kein externes Wissen, keine Annahmen jenseits dessen, was der Context hergibt.

ABLEITUNG
Du darfst Werte aus dem Context kombinieren und berechnen — Arithmetik, Prozente, Verhältnisse, Residuen, mehrstufige Rechnungen. Eingangswerte können in verschiedenen Abschnitten stehen; prüfe den vollständigen Context, bevor du zu dem Schluss kommst, die Antwort sei nicht verfügbar.

RECHENWEG
Nenne die Eingangswerte und wo sie stehen, zeige die Rechenoperation, gib die finale Antwort am Ende an. Die finale Antwort ist das Ergebnis des gezeigten Wegs, kein vorab genannter Wert. Übernimm die Präzision der Quelle — keine 4 Nachkommastellen aus 2 signifikanten Stellen.

DISZIPLIN
Denke intern, bevor du schreibst. Verwende nie "Moment", "eigentlich", "lass mich noch einmal nachdenken", Korrekturen in Klammern, mehrere konkurrierende Rechnungen, Listen alternativer Lesarten, Meta-Kommentare zu deinem Denken oder abschließende Zusammenfassungsblöcke. Eine Rechnung, eine finale Antwort pro Frage.

UNSCHÄRFE
Könnte eine Frage mehrere Dinge im Context meinen, benenne die Mehrdeutigkeit kurz und entscheide dich für die wahrscheinlichste Lesart. Liste keine Alternativen auf.

KNAPPHEIT
Nutze den einfachsten Rechenweg, den die Frage hergibt — keine zusätzlichen Anpassungen, wenn nicht ausdrücklich gefordert.

FORMAT
Reiner Text. Kein LaTeX, keine dekorativen Überschriften, keine Tabellen, sofern nicht gefordert. Setze die finale Antwort nicht fett ganz oben — sie steht am Ende des Rechenwegs.

/no_think`
}

export function buildPrompt(
  question: string,
  hits: RetrievalHit[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  responseLang?: ResponseLanguage,
): string {
  const sections: string[] = []

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

  if (hits.length === 0) {
    sections.push('Context: (none)')
  } else {
    const ctx = hits
      .map((h) => `${formatHitHeader(h, responseLang)}\n${h.text}`)
      .join('\n\n---\n\n')
    sections.push(`Context:\n${ctx}`)
  }

  sections.push(`Question: ${question}`)
  return sections.join('\n\n')
}

export function renderFallback(
  question: string,
  hits: RetrievalHit[],
  lang: ResponseLanguage = 'de',
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
  const loc = formatHitLocation(h, 'en')
  const langTag =
    responseLang && h.language && h.language !== 'other' && h.language !== responseLang
      ? `, lang:${h.language}`
      : ''
  return `[doc:${h.document_id}, chunk:${h.chunk_id}] (${h.document_title}${loc}${langTag})`
}

function formatHitLocation(h: RetrievalHit, lang: ResponseLanguage): string {
  const headingPart =
    h.heading_path && h.heading_path.length > 0 ? `§ ${h.heading_path.join(' › ')}` : null
  const pagePart =
    h.page_from != null ? (lang === 'de' ? `S. ${h.page_from}` : `p.${h.page_from}`) : null
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
