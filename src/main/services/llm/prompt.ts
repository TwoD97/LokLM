import type { RetrievalHit } from '../../../shared/documents'

export type ResponseLanguage = 'de' | 'en'

export const REFUSAL_TEXT: Record<ResponseLanguage, string> = {
  de: 'Diese Information findet sich nicht in den bereitgestellten Dokumenten.',
  en: 'This information is not in the provided documents.',
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
 * Lastenheft's bilingual scope. The "translate internally" clause prevents
 * the model from echoing the user's input language when it doesn't match
 * the configured response language.
 */
export function buildSystemPrompt(lang: ResponseLanguage): string {
  const refusal = REFUSAL_TEXT[lang]
  const langName = lang === 'de' ? 'German' : 'English'
  return `You are LokLM, a local assistant grounded in the user's document library.

Always respond in ${langName}. If the user writes in another language, translate the question internally but answer only in ${langName}.

Cite every factual claim as [doc:<documentId>, chunk:<chunkId>] using ids from the Context block — the UI renders them as clickable chips. If neither the Context nor a tool call supports the answer, reply: "${refusal}"

Tools (call only when the Context is clearly insufficient — they all run on the active workspace):
- summarizeDocument — "what is doc X about" / "overview"
- readDocumentRange — "walk through chapter N" (chain via nextOrdinal)
- searchLibrary — Context is missing the topic
- listDocuments / listWorkspaces / getCorpusStats — aggregates

Use only ids you have actually seen.

/no_think`
}

export function buildPrompt(
  question: string,
  hits: RetrievalHit[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
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
      .map(
        (h) =>
          `[doc:${h.document_id}, chunk:${h.chunk_id}] (${h.document_title}${
            h.page_from != null ? `, p.${h.page_from}` : ''
          })\n${h.text}`,
      )
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
      const loc =
        h.page_from != null ? (lang === 'de' ? `, S. ${h.page_from}` : `, p. ${h.page_from}`) : ''
      return `• ${snippet} [doc:${h.document_id}, chunk:${h.chunk_id}] (${h.document_title}${loc})`
    })
    .join('\n')
  return intro + body
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
