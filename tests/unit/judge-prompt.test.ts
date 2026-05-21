import { describe, it, expect } from 'vitest'
import { buildJudgePrompt, parseJudgeOutput } from '../evals/judge/Judge'

describe('buildJudgePrompt', () => {
  describe('focused intent (default, backward compat)', () => {
    it('uses the single-ground-truth prompt when intent is omitted', () => {
      const prompt = buildJudgePrompt({
        question: 'Was ist Argon2id?',
        expectedChunkText: 'Argon2id ist ein Passwort-Hashing-Algorithmus.',
        providedChunks: ['Chunk A text', 'Chunk B text'],
        generatedAnswer: 'Argon2id ist ein KDF.',
      })
      expect(prompt).toContain('Ground-Truth-Quelltext:')
      expect(prompt).not.toContain('Erforderliche Punkte')
      expect(prompt).not.toContain('COVERAGE')
    })

    it('uses the single-ground-truth prompt when intent is explicitly focused', () => {
      const prompt = buildJudgePrompt({
        question: 'Was ist Argon2id?',
        intent: 'focused',
        expectedChunkText: 'Argon2id ist ein Passwort-Hashing-Algorithmus.',
        providedChunks: ['x'],
        generatedAnswer: 'Argon2id ist ein KDF.',
      })
      expect(prompt).toContain('Ground-Truth-Quelltext:')
      expect(prompt).not.toContain('Erforderliche Punkte')
    })
  })

  describe('broad intent (coverage prompt)', () => {
    it('renders all expectedChunkTexts as required points', () => {
      const prompt = buildJudgePrompt({
        question: 'Welche Chunking-Strategien gibt es?',
        intent: 'broad',
        expectedChunkText: 'Festes Token-Fenster.',
        expectedChunkTexts: [
          'Festes Token-Fenster.',
          'Semantisches Chunking.',
          'Hierarchisches Chunking.',
        ],
        providedChunks: ['retrieved 1', 'retrieved 2'],
        generatedAnswer: 'Antwort.',
      })
      expect(prompt).toContain('Listen-/Vergleichs-Antwort')
      expect(prompt).toContain('Erforderliche Punkte')
      expect(prompt).toContain('COVERAGE')
      expect(prompt).toContain('Erforderlicher Punkt 1: Festes Token-Fenster.')
      expect(prompt).toContain('Erforderlicher Punkt 2: Semantisches Chunking.')
      expect(prompt).toContain('Erforderlicher Punkt 3: Hierarchisches Chunking.')
    })

    it('falls back to [expectedChunkText] when expectedChunkTexts is absent', () => {
      const prompt = buildJudgePrompt({
        question: 'Vergleiche A und B.',
        intent: 'broad',
        expectedChunkText: 'Nur ein Punkt.',
        providedChunks: ['x'],
        generatedAnswer: 'Antwort.',
      })
      expect(prompt).toContain('Erforderlicher Punkt 1: Nur ein Punkt.')
      expect(prompt).not.toContain('Erforderlicher Punkt 2:')
    })
  })

  describe('summary intent', () => {
    it('labels the prompt as Zusammenfassung', () => {
      const prompt = buildJudgePrompt({
        question: 'Fasse das Dokument zusammen.',
        intent: 'summary',
        expectedChunkText: 'Punkt 1.',
        expectedChunkTexts: ['Punkt 1.', 'Punkt 2.', 'Punkt 3.', 'Punkt 4.'],
        providedChunks: ['x'],
        generatedAnswer: 'Antwort.',
      })
      expect(prompt).toContain('Zusammenfassung')
      expect(prompt).toContain('Erforderlicher Punkt 4: Punkt 4.')
    })
  })

  it('all three intents share the same output format → parseJudgeOutput works for all', () => {
    const sample = `correctness: 7\ngroundedness: 8\nhelpfulness: 6\nreason: ok`
    const out = parseJudgeOutput(sample)
    expect(out.parsed).toBe(true)
    expect(out.correctness).toBeCloseTo(0.7, 5)
    expect(out.groundedness).toBeCloseTo(0.8, 5)
    expect(out.helpfulness).toBeCloseTo(0.6, 5)
    expect(out.score).toBeCloseTo((0.7 + 0.8 + 0.6) / 3, 5)
  })
})
