import type { RetrievalHit } from '../../../shared/documents'

export interface CitationAliases {
  /** Canonical document/chunk pair to a prompt-local label. */
  readonly labels: ReadonlyMap<string, string>
  /** Only passages actually supplied to this ask can acquire a citation. */
  readonly canonical: ReadonlyMap<string, string>
}

export function citationAliasesEnabled(): boolean {
  return process.env['LOKLM_CITATION_ALIASES'] === '1'
}

const ANGLE_LOOKAHEAD = 1024
const ANGLE_TOKEN =
  /^(?:<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Z]+\s[^>]*>)/

function couldBeAngleMarkup(text: string): boolean {
  if (text.length === 1) return true
  if (!/[A-Za-z/!?]/.test(text[1] ?? '')) return false
  const tagName = /^<\/?[A-Za-z][A-Za-z0-9-]*(?=\s)/.exec(text)?.[0]
  if (!tagName) return true
  let quote = ''
  for (const char of text.slice(tagName.length)) {
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if ('<>`[]'.includes(char)) return false
  }
  return true
}

/** Assign labels to headers only. Reserve any labels already present as literal
 * input so copying source text never accidentally creates a citation. */
export function createCitationAliases(
  hits: readonly RetrievalHit[],
  pinned: readonly RetrievalHit[] = [],
  otherText: readonly string[] = [],
): CitationAliases {
  const supplied = [...pinned, ...hits]
  const reserved = new Set<string>()
  for (const text of [
    ...otherText,
    ...supplied.flatMap((hit) => [hit.text, hit.document_title, ...(hit.heading_path ?? [])]),
  ]) {
    for (const match of text.matchAll(/\[S[1-9]\d*\]/g)) reserved.add(match[0])
  }
  const labels = new Map<string, string>()
  const canonical = new Map<string, string>()
  let next = 1
  for (const hit of supplied) {
    const key = `${hit.document_id}:${hit.chunk_id}`
    if (labels.has(key)) continue
    let label: string
    do label = `[S${next++}]`
    while (reserved.has(label))
    labels.set(key, label)
    canonical.set(label, `[doc:${hit.document_id}, chunk:${hit.chunk_id}]`)
  }
  return { labels, canonical }
}

/** Incremental, bounded-lookahead decoder. Markdown code, links, escaped
 * brackets and unknown labels remain literal. It never scans/replaces source
 * payloads or old canonical citations. */
export class CitationAliasDecoder {
  private buffer = ''
  private inlineTicks = 0
  private fence: { char: string; length: number } | null = null
  private closingFence = false
  private delimiterRun: { char: string; length: number; atLineStart: boolean } | null = null
  private indentedLine = false
  private linePrefix = ''
  private bracketDepth = 0
  private destinationDepth = 0
  private afterBracket = false
  private angle = false
  private word = ''
  private previous = ''

  constructor(private readonly aliases: CitationAliases) {}

  reset(): void {
    this.buffer = ''
    this.inlineTicks = 0
    this.fence = null
    this.closingFence = false
    this.delimiterRun = null
    this.indentedLine = false
    this.linePrefix = ''
    this.bracketDepth = 0
    this.destinationDepth = 0
    this.afterBracket = false
    this.angle = false
    this.word = ''
    this.previous = ''
  }

  feed(text: string): string {
    this.buffer += text
    return this.drain(false)
  }

  flush(): string {
    return this.drain(true)
  }

  private record(text: string): void {
    for (const char of text) {
      if (char === '\n') this.linePrefix = ''
      else if (this.linePrefix.length < 128) this.linePrefix += char
      if (/\s/.test(char)) this.word = ''
      else if (this.word.length < 256) this.word += char
      this.previous = char
    }
  }

  private contentPrefix(): string {
    // Fences may be nested in block quotes and list items. Remove only one
    // separator after each container so four content spaces still mean code.
    return this.linePrefix
      .replace(/^(?: {0,3}>[ \t]?)+/, '')
      .replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]/, '')
  }

  private finishDelimiter(char: string, length: number, atLineStart: boolean): void {
    if (this.fence) {
      this.closingFence = atLineStart && char === this.fence.char && length >= this.fence.length
    } else if (this.inlineTicks) {
      if (char === '`' && length === this.inlineTicks) this.inlineTicks = 0
    } else if (atLineStart && length >= 3) {
      this.fence = { char, length }
    } else if (char === '`') {
      this.inlineTicks = length
    }
  }

  private drain(final: boolean): string {
    let output = ''
    let index = 0
    const emit = (text: string): void => {
      output += text
      this.record(text)
    }
    while (index < this.buffer.length) {
      const char = this.buffer[index]!
      if (this.delimiterRun) {
        if (char === this.delimiterRun.char) {
          this.delimiterRun.length++
          emit(char)
          index++
          continue
        }
        this.finishDelimiter(
          this.delimiterRun.char,
          this.delimiterRun.length,
          this.delimiterRun.atLineStart,
        )
        this.delimiterRun = null
      }
      if (
        !this.fence &&
        !this.inlineTicks &&
        (/^ {4}/.test(this.contentPrefix()) || /^ {0,3}\t/.test(this.contentPrefix()))
      )
        this.indentedLine = true
      if (this.indentedLine) {
        if (char === '\n') this.indentedLine = false
        emit(char)
        index++
        continue
      }
      if (char === '\\' && !this.fence && !this.inlineTicks) {
        if (index + 1 === this.buffer.length && !final) break
        emit(this.buffer.slice(index, index + 2))
        index += 2
        continue
      }
      const protectedDelimiter =
        this.angle ||
        this.destinationDepth > 0 ||
        (!this.fence && !this.inlineTicks && /^[\w+.-]+:\/\//.test(this.word))
      if ((char === '`' || char === '~') && !protectedDelimiter) {
        let end = index + 1
        while (this.buffer[end] === char) end++
        const length = end - index
        const atLineStart = /^ {0,3}$/.test(this.contentPrefix())
        if (end === this.buffer.length && !final) this.delimiterRun = { char, length, atLineStart }
        else this.finishDelimiter(char, length, atLineStart)
        emit(this.buffer.slice(index, end))
        index = end
        continue
      }
      if (this.fence || this.inlineTicks) {
        if (this.fence && this.closingFence) {
          if (char === '\n') {
            this.fence = null
            this.closingFence = false
          } else if (!/[ \t\r]/.test(char)) this.closingFence = false
        }
        emit(char)
        index++
        continue
      }
      if (this.angle) {
        if (char === '>') this.angle = false
        emit(char)
        index++
        continue
      }
      if (this.destinationDepth) {
        if (char === '(') this.destinationDepth++
        if (char === ')') this.destinationDepth--
        emit(char)
        index++
        continue
      }
      if (this.afterBracket) {
        this.afterBracket = false
        if (char === '(') {
          this.destinationDepth = 1
          emit(char)
          index++
          continue
        }
      }
      if (this.bracketDepth) {
        if (char === '[') this.bracketDepth++
        if (char === ']' && --this.bracketDepth === 0) this.afterBracket = true
        emit(char)
        index++
        continue
      }
      if (char === '<') {
        const rest = this.buffer.slice(index, index + ANGLE_LOOKAHEAD)
        const token = ANGLE_TOKEN.exec(rest)?.[0]
        if (token) {
          emit(token)
          index += token.length
          continue
        }
        const possibleMarkup = couldBeAngleMarkup(rest)
        if (possibleMarkup && !final && rest.length < ANGLE_LOOKAHEAD) break
        // Very long ambiguous markup stays literal conservatively. Ordinary
        // comparisons such as x<y are resolved at flush without hiding citations.
        this.angle = possibleMarkup && rest.length === ANGLE_LOOKAHEAD
        emit(char)
        index++
        continue
      }
      if (char === '[') {
        // URLs and image labels are literal even when they resemble citations.
        const protectedLabel = this.previous === '!' || /^[\w+.-]+:\/\//.test(this.word)
        if (!protectedLabel) {
          const rest = this.buffer.slice(index)
          const marker = /^\[S[1-9]\d*\]/.exec(rest)?.[0]
          if (marker) {
            const suffix = this.buffer.slice(index + marker.length)
            const whitespace = /^\s*/.exec(suffix)![0]
            const nextText = suffix.slice(whitespace.length)
            const following = nextText[0]
            if (following === undefined && !final && whitespace.length <= 256) break
            let adjacentCitation = false
            if (following === '[') {
              const nextMarker = /^\[S[1-9]\d*\]/.exec(nextText)?.[0]
              if (nextMarker) adjacentCitation = this.aliases.canonical.has(nextMarker)
              else if (
                !final &&
                /^\[(?:S(?:[1-9]\d*)?)?$/.test(nextText) &&
                nextText.length < 32 &&
                whitespace.length <= 256
              )
                break
            }
            // Do not rewrite link labels, reference links or definitions.
            if (
              whitespace.length <= 256 &&
              (following !== '(' || whitespace.length > 0) &&
              (following !== '[' || adjacentCitation) &&
              following !== ':'
            ) {
              emit(this.aliases.canonical.get(marker) ?? marker)
              index += marker.length
              continue
            }
          } else if (!final && /^\[(?:S(?:[1-9]\d*)?)?$/.test(rest) && rest.length < 32) {
            break
          }
        }
        this.bracketDepth = 1
      }
      emit(char)
      index++
    }
    if (final && this.delimiterRun) {
      this.finishDelimiter(
        this.delimiterRun.char,
        this.delimiterRun.length,
        this.delimiterRun.atLineStart,
      )
      this.delimiterRun = null
    }
    this.buffer = this.buffer.slice(index)
    return output
  }
}

export function decodeCitationAliases(text: string, aliases: CitationAliases): string {
  const decoder = new CitationAliasDecoder(aliases)
  return decoder.feed(text) + decoder.flush()
}

/** Keep native chunk counts when a partial marker delays visible output. */
export class CitationAliasOutput {
  private readonly decoder: CitationAliasDecoder | null
  private pendingCount = 0

  constructor(
    private readonly aliases: CitationAliases | null,
    private readonly onChunk?: (text: string, count: number) => void,
  ) {
    this.decoder = aliases ? new CitationAliasDecoder(aliases) : null
  }

  reset(): void {
    this.decoder?.reset()
    this.pendingCount = 0
  }

  feed(text: string, count: number): void {
    this.pendingCount += count
    this.emit(this.decoder ? this.decoder.feed(text) : text)
  }

  flush(): void {
    if (this.decoder) this.emit(this.decoder.flush())
  }

  final(text: string): string {
    return this.aliases ? decodeCitationAliases(text, this.aliases) : text
  }

  private emit(text: string): void {
    if (!text) return
    this.onChunk?.(text, this.pendingCount)
    this.pendingCount = 0
  }
}
