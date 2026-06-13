/**
 * Prompt-builder tests for the Write assistant. Pure-string assertions on the
 * invariants that matter for a small model: the right per-mode/per-language
 * instruction is selected , the input is embedded verbatim , the source
 * language is pinned (never translate) , and the "output only the rewrite"
 * guard is present so the model doesn't add a preamble.
 */

import { describe, it, expect } from 'vitest'

import { buildWritePrompt } from '../../src/main/services/writing/prompt'
import { WRITING_MODES } from '../../src/shared/writing'

describe('buildWritePrompt', () => {
  it('embeds the input text verbatim', () => {
    const text = 'Teh quick brown fox jumpd.'
    expect(buildWritePrompt('en', 'improve', text)).toContain(text)
  })

  it('pins the language and forbids a preamble (EN)', () => {
    const p = buildWritePrompt('en', 'improve', 'hello')
    expect(p).toMatch(/same language as the input \(English\)/i)
    expect(p).toMatch(/output only the rewritten text/i)
    expect(p).toMatch(/no quotation marks/i)
  })

  it('pins the language and forbids a preamble (DE)', () => {
    const p = buildWritePrompt('de', 'formal', 'hallo')
    expect(p).toMatch(/derselben Sprache wie die Eingabe \(Deutsch\)/i)
    expect(p).toMatch(/nur den umgeschriebenen Text/i)
    expect(p).toMatch(/keine Anführungszeichen/i)
  })

  it('selects a distinct , non-empty instruction for every mode in both languages', () => {
    for (const lang of ['en', 'de'] as const) {
      const heads = WRITING_MODES.map((m) => buildWritePrompt(lang, m, 'x').split('\n')[0]!)
      // Each mode's leading instruction line is unique within the language.
      expect(new Set(heads).size).toBe(WRITING_MODES.length)
      for (const h of heads) expect(h.length).toBeGreaterThan(0)
    }
  })

  it('formal vs casual produce different instructions', () => {
    expect(buildWritePrompt('en', 'formal', 'x')).not.toBe(buildWritePrompt('en', 'casual', 'x'))
  })
})
