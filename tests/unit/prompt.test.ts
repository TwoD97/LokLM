import { describe, it, expect } from 'vitest'
import {
  buildPrompt,
  buildSystemPrompt,
  renderFallback,
  stripThink,
  ThinkFilter,
  LoopDetector,
  REFUSAL_TEXT,
  REPETITION_HINT_TEXT,
  condense,
  chunkifyForStream,
  packHitsToBudget,
  answerMaxTokens,
  estimateTokens,
  estimateHistoryTokens,
} from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

const hit = (id: number, text: string, title = 'doc.md'): RetrievalHit => ({
  chunk_id: id,
  document_id: id,
  document_title: title,
  ordinal: 0,
  page_from: 1,
  page_to: 1,
  heading_path: null,
  text,
  score: 1.0,
  language: null,
})

describe('buildPrompt', () => {
  it('emits source block with [doc:X, chunk:Y] markers', () => {
    const out = buildPrompt('was steht da?', [hit(5, 'Wir testen Wochenbuch.', 'Wochenbuch.pdf')])
    expect(out).toContain('[doc:5, chunk:5]')
    expect(out).toContain('Wochenbuch.pdf')
    expect(out).toContain('Wir testen Wochenbuch.')
    expect(out).toContain('was steht da?')
  })

  it('emits Context: (none) when no hits', () => {
    const out = buildPrompt('hello', [])
    expect(out).toContain('Context: (none)')
  })

  it('renders the contextPreamble above the hits inside the Context block', () => {
    const out = buildPrompt(
      'worum geht es?',
      [hit(7, 'Detailauszug.', 'Wochenbuch.pdf')],
      undefined,
      'de',
      undefined,
      'Document overview — "Wochenbuch.pdf" (background):\nKurzer Überblick.',
    )
    const ctxStart = out.indexOf('Context:')
    const preambleAt = out.indexOf('Kurzer Überblick.')
    const hitAt = out.indexOf('[doc:7, chunk:7]')
    expect(ctxStart).toBeGreaterThanOrEqual(0)
    expect(preambleAt).toBeGreaterThan(ctxStart)
    expect(hitAt).toBeGreaterThan(preambleAt)
  })

  it('preamble with zero hits still renders a Context block, not (none)', () => {
    const out = buildPrompt('worum geht es?', [], undefined, 'en', undefined, 'Overview text only.')
    expect(out).not.toContain('Context: (none)')
    expect(out).toContain('Overview text only.')
  })

  it('preamble renders AFTER the pinned section — never ahead of the stable prefix', () => {
    const out = buildPrompt(
      'q',
      [hit(2, 'rag fact')],
      undefined,
      'en',
      [hit(9, 'pinned fact')],
      'Overview preamble.',
    )
    const pinnedAt = out.indexOf('Context (pinned):')
    const preambleAt = out.indexOf('Overview preamble.')
    const ragAt = out.indexOf('rag fact')
    expect(pinnedAt).toBeGreaterThanOrEqual(0)
    expect(preambleAt).toBeGreaterThan(pinnedAt)
    expect(ragAt).toBeGreaterThan(preambleAt)
  })

  it('embeds conversation history when provided', () => {
    const out = buildPrompt(
      'follow up',
      [hit(1, 'fact one')],
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
    )
    expect(out).toContain('first question')
    expect(out).toContain('first answer')
    expect(out).toMatch(/Previous conversation/i)
  })

  it('truncates oversized history messages', () => {
    const huge = 'x'.repeat(5000)
    const out = buildPrompt('q', [hit(1, 'fact')], [{ role: 'user', content: huge }])
    expect(out.length).toBeLessThan(huge.length + 2000)
    expect(out).toContain('truncated')
  })

  // Pinned chunks lead the prompt so the [system][pinned] token prefix stays
  // byte-identical across turns in a workspace — node-llama-cpp's sequence
  // alignment then reuses its KV state instead of re-prefilling it every turn.
  // History sits between pinned and RAG context so the history *prefix* (all
  // turns but the newest) is also stable and reused.
  describe('pinned context section', () => {
    const history = [
      { role: 'user' as const, content: 'first question' },
      { role: 'assistant' as const, content: 'first answer' },
    ]

    it('renders pinned hits in a leading section, before history and RAG context', () => {
      const out = buildPrompt('q', [hit(2, 'rag fact')], history, 'en', [hit(9, 'pinned fact')])
      const pinnedIdx = out.indexOf('Context (pinned):')
      const historyIdx = out.indexOf('Previous conversation')
      const ragIdx = out.indexOf('Context:')
      expect(pinnedIdx).toBe(0)
      expect(out).toContain('[doc:9, chunk:9]')
      expect(out).toContain('pinned fact')
      expect(historyIdx).toBeGreaterThan(pinnedIdx)
      expect(ragIdx).toBeGreaterThan(historyIdx)
    })

    it('omits Context: (none) when pinned content is present without RAG hits', () => {
      const out = buildPrompt('q', [], undefined, 'en', [hit(9, 'pinned fact')])
      expect(out).not.toContain('Context: (none)')
      expect(out).toContain('Context (pinned):')
      expect(out).toContain('pinned fact')
    })

    it('leaves the no-pin layout byte-identical to the legacy shape', () => {
      const legacy = buildPrompt('q', [hit(1, 'fact')], history, 'en')
      const explicit = buildPrompt('q', [hit(1, 'fact')], history, 'en', [])
      expect(explicit).toBe(legacy)
      expect(legacy).not.toContain('Context (pinned):')
    })
  })

  it('includes page number when present', () => {
    const h = { ...hit(7, 'text'), page_from: 42 }
    const out = buildPrompt('q', [h])
    expect(out).toContain('p.42')
  })

  it('renders § breadcrumb instead of page when heading_path is set (markdown)', () => {
    const h = { ...hit(7, 'text'), page_from: null, heading_path: ['Intro', 'Why'] }
    const out = buildPrompt('q', [h])
    expect(out).toContain('§ Intro › Why')
    expect(out).not.toMatch(/p\.\d/)
  })

  it('renders both § and page when PDF has bookmarks', () => {
    const h = { ...hit(7, 'text'), page_from: 12, heading_path: ['Chapter 2'] }
    const out = buildPrompt('q', [h])
    expect(out).toContain('§ Chapter 2')
    expect(out).toContain('p.12')
  })

  it('tags chunk language in header when chunk lang differs from response lang', () => {
    // German user asks question, retrieval surfaces an English-language chunk.
    // The model needs to know it must translate the quoted material rather
    // than echo it verbatim — `, lang:en` in the header is the signal.
    const h = { ...hit(7, 'text'), language: 'en' as const }
    const out = buildPrompt('q', [h], undefined, 'de')
    expect(out).toContain('lang:en')
  })

  it('omits the language tag when chunk lang matches response lang', () => {
    // German chunk + German response = no translation happening, no need to
    // burn tokens telling the model what it already knows.
    const h = { ...hit(7, 'text'), language: 'de' as const }
    const out = buildPrompt('q', [h], undefined, 'de')
    expect(out).not.toContain('lang:')
  })

  it('omits the language tag when chunk language is null (legacy/unknown)', () => {
    // Chunks ingested before mig 0007 have null language. Tagging them would
    // be guessing — silent fallback is the safer default.
    const h = { ...hit(7, 'text'), language: null }
    const out = buildPrompt('q', [h], undefined, 'de')
    expect(out).not.toContain('lang:')
  })

  it("omits the language tag when chunk language is 'other'", () => {
    // eld returns 'other' for languages outside LokLM's DE/EN scope (e.g. FR,
    // ES). The model can't reliably translate every world language, so don't
    // imply it should — leave the header untagged and trust the response-
    // language constraint in the system prompt.
    const h = { ...hit(7, 'text'), language: 'other' as const }
    const out = buildPrompt('q', [h], undefined, 'en')
    expect(out).not.toContain('lang:')
  })

  it('omits the language tag when no response language is supplied', () => {
    // Backwards compat: callers that don't pass `responseLang` (e.g. legacy
    // tests, debug tooling) get the original header format with no tag.
    const h = { ...hit(7, 'text'), language: 'en' as const }
    const out = buildPrompt('q', [h])
    expect(out).not.toContain('lang:')
  })
})

describe('buildSystemPrompt', () => {
  it('keeps citation markup verbatim in both languages', () => {
    // Parser-critical literals — UI keys off these exact tokens for chip
    // rendering. Translating them (Dokument/Stück, etc.) would silently
    // break citation parsing on the DE prompt.
    expect(buildSystemPrompt('de')).toContain('[doc:<documentId>, chunk:<chunkId>]')
    expect(buildSystemPrompt('en')).toContain('[doc:<documentId>, chunk:<chunkId>]')
  })

  it('contains /no_think directive in both languages', () => {
    expect(buildSystemPrompt('de')).toMatch(/no_think/)
    expect(buildSystemPrompt('en')).toMatch(/no_think/)
  })

  it('binds the response language natively', () => {
    // Language-matched prompts (research: Cross-Lingual Prompt Steerability,
    // MultiQ) reduce English-drift on smaller models — so the DE variant is
    // written in German end-to-end rather than English-prompt-with-German-target.
    expect(buildSystemPrompt('de')).toMatch(/auf Deutsch/)
    expect(buildSystemPrompt('en')).toMatch(/in English/)
  })

  it('embeds the centralized refusal string verbatim', () => {
    expect(buildSystemPrompt('de')).toContain(REFUSAL_TEXT.de)
    expect(buildSystemPrompt('en')).toContain(REFUSAL_TEXT.en)
  })

  it('references the Context block header by its literal name', () => {
    // buildPrompt always emits `Context:` (English) regardless of response
    // language — the system rules must reference it by that literal so the
    // model links its constraints to the right section header.
    expect(buildSystemPrompt('de')).toContain('Context')
    expect(buildSystemPrompt('en')).toContain('Context')
  })

  it('enforces derivation + calculation discipline rules', () => {
    const en = buildSystemPrompt('en')
    // Calc reasoning order + ban on self-correction phrases — the rules that
    // distinguish this prompt from the original short version.
    expect(en).toMatch(/SOURCE/)
    expect(en).toMatch(/DERIVATION/)
    expect(en).toMatch(/CALCULATIONS/)
    expect(en).toMatch(/wait/)
    expect(en).toMatch(/actually/)

    const de = buildSystemPrompt('de')
    expect(de).toMatch(/QUELLE/)
    expect(de).toMatch(/ABLEITUNG/)
    expect(de).toMatch(/RECHENWEG/)
    expect(de).toMatch(/Moment/)
    expect(de).toMatch(/eigentlich/)
  })
})

describe('stripThink', () => {
  it('removes <think>…</think> blocks', () => {
    expect(stripThink('hello <think>internal</think> world')).toBe('hello  world')
  })

  it('removes multiline thinking blocks', () => {
    expect(stripThink('a <think>\nlots\nof\nlines\n</think> b')).toBe('a  b')
  })

  it('leaves text without thinking tags alone', () => {
    expect(stripThink('plain text here')).toBe('plain text here')
  })
})

describe('ThinkFilter', () => {
  it('passes through text with no thinking tags (across feed+flush)', () => {
    // feed() holds back the last few chars in case a '<think>' tag spans a
    // chunk boundary; flush() releases the tail. Real callers always feed
    // streamed pieces and flush at end-of-response.
    const filter = new ThinkFilter()
    const out = filter.feed('clean text') + filter.flush()
    expect(out).toBe('clean text')
  })

  it('strips a single <think>...</think> across multiple chunks', () => {
    const filter = new ThinkFilter()
    const parts = ['hello <thi', 'nk>x</thi', 'nk> world']
    const out = parts.map((p) => filter.feed(p)).join('') + filter.flush()
    expect(out).toContain('hello')
    expect(out).toContain('world')
    expect(out).not.toContain('<think>')
    expect(out).not.toContain('x</think>')
  })

  it('reset() clears buffer state', () => {
    const filter = new ThinkFilter()
    filter.feed('<thi') // partial open held in buffer
    filter.reset()
    const out = filter.feed('hello') + filter.flush()
    expect(out).toBe('hello')
  })
})

describe('LoopDetector', () => {
  it('does not trip on normal varied prose', () => {
    const det = new LoopDetector()
    const text =
      'Die Antwort auf deine Frage ist vielschichtig. Wir betrachten zunächst die Definition, ' +
      'dann die historische Entwicklung, und schließlich die praktischen Auswirkungen heute. ' +
      'Im ersten Abschnitt zeigt sich, dass die Begriffe nicht einheitlich verwendet werden.'
    expect(det.feed(text)).toBe(false)
    expect(det.isTripped()).toBe(false)
  })

  it('trips on a verbatim sentence repeated three times', () => {
    const det = new LoopDetector()
    const line = 'Diese Information findet sich nicht in den bereitgestellten Dokumenten. '
    expect(det.feed(line + line)).toBe(false)
    expect(det.feed(line)).toBe(true)
    expect(det.isTripped()).toBe(true)
  })

  it('trips on tight token-level repetition (single phrase spiral)', () => {
    const det = new LoopDetector()
    // 'haha ' * 200 — short cycle but the 40-char trailing window still
    // appears multiple times non-overlapping inside the rolling buffer.
    let tripped = false
    for (let i = 0; i < 200 && !tripped; i++) {
      tripped = det.feed('haha ')
    }
    expect(tripped).toBe(true)
  })

  it('ignores whitespace/punctuation-only tails', () => {
    const det = new LoopDetector()
    // Pure newline runs (e.g. trailing list separators) shouldn't be flagged.
    expect(det.feed('\n'.repeat(500))).toBe(false)
  })

  it('stays tripped once triggered (idempotent feed)', () => {
    const det = new LoopDetector()
    const line = 'Wir haben das Thema bereits ausführlich besprochen und kommen jetzt zum Punkt. '
    det.feed(line.repeat(4))
    expect(det.isTripped()).toBe(true)
    // Further feeds short-circuit to true without re-scanning.
    expect(det.feed('anything')).toBe(true)
  })

  it('reset() clears tripped state', () => {
    const det = new LoopDetector()
    const line = 'Wir kommen jetzt zum Punkt der eigentlichen Diskussion und Antwort. '
    det.feed(line.repeat(5))
    expect(det.isTripped()).toBe(true)
    det.reset()
    expect(det.isTripped()).toBe(false)
    expect(det.feed('fresh varied text comes through cleanly')).toBe(false)
  })
})

describe('REPETITION_HINT_TEXT', () => {
  it('has both de and en variants, non-empty and distinct', () => {
    expect(REPETITION_HINT_TEXT.de.length).toBeGreaterThan(0)
    expect(REPETITION_HINT_TEXT.en.length).toBeGreaterThan(0)
    expect(REPETITION_HINT_TEXT.de).not.toBe(REPETITION_HINT_TEXT.en)
  })
})

describe('renderFallback', () => {
  it('returns a citation-listing string when hits exist', () => {
    const out = renderFallback('q', [hit(2, 'snippet')], 'de')
    expect(out).toContain('[doc:2, chunk:2]')
  })

  it('returns the refusal string when no hits', () => {
    expect(renderFallback('q', [], 'de')).toBe(REFUSAL_TEXT.de)
    expect(renderFallback('q', [], 'en')).toBe(REFUSAL_TEXT.en)
  })
})

describe('REFUSAL_TEXT', () => {
  it('has both de and en variants, non-empty and distinct', () => {
    expect(REFUSAL_TEXT.de.length).toBeGreaterThan(0)
    expect(REFUSAL_TEXT.en.length).toBeGreaterThan(0)
    expect(REFUSAL_TEXT.de).not.toBe(REFUSAL_TEXT.en)
  })
})

describe('condense', () => {
  it('collapses whitespace and trims', () => {
    expect(condense('  hello   world   ', 100)).toBe('hello world')
  })

  it('truncates with ellipsis when over max', () => {
    const out = condense('a'.repeat(200), 10)
    expect(out).toHaveLength(10)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('chunkifyForStream', () => {
  it('returns at least one chunk for non-empty text', () => {
    const out = chunkifyForStream('hello world this is a longer message that will be chunked')
    expect(out.length).toBeGreaterThan(0)
    expect(out.join('')).toContain('hello')
  })

  it('returns empty array for empty input', () => {
    expect(chunkifyForStream('')).toEqual([])
  })
})

describe('answerMaxTokens', () => {
  it('reserves ~1/4 of the window, floored at 4K', () => {
    // 8K Lite: ctx/4 = 2048, floored to 4096.
    expect(answerMaxTokens(8192)).toBe(4096)
  })
  it('caps the reserve at 32K on huge windows', () => {
    expect(answerMaxTokens(131072)).toBe(32768)
    expect(answerMaxTokens(1_000_000)).toBe(32768)
  })
})

describe('estimateHistoryTokens', () => {
  it('is 0 for missing/empty history', () => {
    expect(estimateHistoryTokens()).toBe(0)
    expect(estimateHistoryTokens([])).toBe(0)
  })
  it('caps each message at the per-message char cap', () => {
    const huge = [{ role: 'user' as const, content: 'x'.repeat(100_000) }]
    // Capped at HISTORY_MESSAGE_CHAR_CAP (1500) + ~12 overhead → ~432 tokens,
    // NOT 100k/3.5. The exact number isn't the point; that the cap bounds it is.
    expect(estimateHistoryTokens(huge)).toBeLessThan(600)
  })
})

describe('packHitsToBudget', () => {
  // ~350-char chunks → ~100 tokens text + small header + separator ≈ 114 tokens each.
  const body = (n: number): string => `chunk ${n} ` + 'word '.repeat(70)
  const hits = [1, 2, 3, 4, 5].map((i) => hit(i, body(i)))

  it('returns all hits when the budget is generous', () => {
    expect(packHitsToBudget(hits, 100_000)).toHaveLength(5)
  })

  it('drops the lowest-ranked tail when over budget, preserving order', () => {
    const oneCost = estimateTokens(body(1)) + estimateTokens('[doc:1, chunk:1] (doc.md, p.1)') + 4
    const packed = packHitsToBudget(hits, oneCost * 2 + 10) // room for ~2 hits
    expect(packed).toHaveLength(2)
    expect(packed.map((h) => h.chunk_id)).toEqual([1, 2]) // top-ranked kept, in order
  })

  it('always keeps at least the top hit even if it alone exceeds the budget', () => {
    expect(packHitsToBudget(hits, 0)).toHaveLength(1)
    expect(packHitsToBudget(hits, 0)[0]!.chunk_id).toBe(1)
  })

  it('returns a single-hit list unchanged regardless of budget', () => {
    const one = [hit(9, body(9))]
    expect(packHitsToBudget(one, 0)).toEqual(one)
  })
})
