import { describe, it, expect } from 'vitest'
import { classifyQueryBreadth, adaptiveTopK } from '@main/services/qa/QAService'

describe('classifyQueryBreadth', () => {
  describe('focused (default)', () => {
    const cases = [
      'what is argon2id?',
      'wie funktioniert die schlüsselableitung?',
      'who wrote the auth design doc?',
      'wann wurde der vault eingeführt?',
      'explain the wrapped DEK',
      'where is the workspace id stored?',
    ]
    for (const q of cases) {
      it(`"${q}" → focused`, () => {
        expect(classifyQueryBreadth(q)).toBe('focused')
      })
    }
  })

  describe('broad (list / compare)', () => {
    const cases = [
      'list all the auth services',
      'enumerate the chunkers',
      'what are all the embedders supported?',
      'which ones of the rerankers are GPU-only?',
      'compare BM25 and dense retrieval',
      'differences between Qwen and Granite on this corpus',
      'similarities between v3 and v4 vault',
      'BM25 vs dense — when does each win?',
      'nenne alle datenbank-tabellen',
      'welche modelle unterstützt LokLM?',
      'vergleich der reranker-strategien',
      'unterschied zwischen v3 und v4 vault',
      'zähle die schritte des login-flows auf',
      'jeder embedder hat einen profile-namen — welcher?',
    ]
    for (const q of cases) {
      it(`"${q}" → broad`, () => {
        expect(classifyQueryBreadth(q)).toBe('broad')
      })
    }
  })

  describe('summary (whole-doc style)', () => {
    const cases = [
      'summarize this document',
      'give me a summary of the auth design',
      'tldr on the vault layout',
      'tl;dr?',
      'overview of the retrieval pipeline',
      'recap the changes in v4',
      'in a few words: what does QAService do?',
      'fasse das auth-design zusammen',
      'fass das mal zusammen',
      'gib mir einen überblick über den vault',
      'übersicht der retrieval-strategien',
      'kurzfassung bitte',
      'zusammenfassung des kapitels',
    ]
    for (const q of cases) {
      it(`"${q}" → summary`, () => {
        expect(classifyQueryBreadth(q)).toBe('summary')
      })
    }
  })
})

describe('adaptiveTopK', () => {
  it('focused queries get topK = 3 (eval-tuned default)', () => {
    expect(adaptiveTopK('what is argon2id?')).toBe(3)
  })

  it('broad queries get topK = 8', () => {
    expect(adaptiveTopK('list all auth services')).toBe(8)
    expect(adaptiveTopK('compare BM25 and dense retrieval')).toBe(8)
  })

  it('summary queries get topK = 12', () => {
    expect(adaptiveTopK('summarize the auth design')).toBe(12)
    expect(adaptiveTopK('fasse das zusammen')).toBe(12)
  })
})
