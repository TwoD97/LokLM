import { afterAll, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
const { cases, wellFormed } = vi.hoisted(() => {
  const wellFormed = (value: unknown): boolean => typeof value === 'string'
    ? !/[\ud800-\udfff]/u.test(value)
    : value !== null && typeof value === 'object' ? Object.values(value).every(wellFormed) : true
  return { cases: [] as unknown[], wellFormed }
})
vi.mock('../../src/main/services/qa/answerFormat', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/main/services/qa/answerFormat')>()
  return { requestsSingleSentence: (question: string) => { const expected = original.requestsSingleSentence(question); cases.push({ kind: 'format', question, expected }); return expected } }
})
vi.mock('../../src/shared/sourceQuoteMarkdown', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/shared/sourceQuoteMarkdown')>()
  return Object.fromEntries(Object.entries(original).map(([kind, fn]) => [kind, (text: string) => { const expected = fn(text); cases.push({ kind, text, expected }); return expected }]))
})
vi.mock('../../src/main/services/qa/conflictSummary', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/main/services/qa/conflictSummary')>()
  const markers = await import('../../src/shared/citationMarkers')
  return { ...original, conflictSummarySchema: (ids: string[]) => {
    const value = original.conflictSummarySchema(ids)
    cases.push({ kind: 'schema', ids: [...ids], expected: JSON.stringify(value) })
    return value
  }, renderConflictSummary: (...args: Parameters<typeof original.renderConflictSummary>) => {
    let rejection: string | null = null
    const expected = original.renderConflictSummary(args[0], args[1], args[2], args[3], reason => { rejection = reason; args[4](reason) })
    cases.push({ kind: 'summary', raw: JSON.stringify(args[0]) ?? 'null', unicodeTransport: wellFormed(args[0]), faultInjected: vi.isMockFunction(markers.findCitationMatches), sources: [...args[1]].map(([id, source]) => [id, source.text]), language: args[2], max: args[3], expected, rejection })
    return expected
  } }
})
await import('../../tests/unit/answer-format.test')
await import('../../tests/unit/conflict-summary.test')
await import('../../tests/unit/comparison-summary.test')
it('captures source escaping and formatting at Unicode and line boundaries', async () => {
  const format = await import('../../src/main/services/qa/answerFormat')
  const markdown = await import('../../src/shared/sourceQuoteMarkdown')
  for (const text of ["\\`*_[]{}()#!|~+-.$:@ & <script> [doc:1, chunk:2]", '    code\n\tindent\r\n \r😀', '&#32; &lt; \\ [x](#cite-1-2)', '\n\n', '  ', '', '\u0085\ufeff\u2028\u2029']) {
    markdown.escapeSourceMarkdown(text); markdown.sourceQuoteMarkdown(text)
  }
  for (const end of ['\n', '\r', '\u0085', '\ufeff', '\u2028', '\u2029']) format.requestsSingleSentence(`Answer in one sentence.${end}`)
})
afterAll(async () => {
  await writeFile('native/crates/core/tests/fixtures/original-conflict-summary.json', JSON.stringify({ runtime: { node: process.versions.node, icu: process.versions.icu, unicode: process.versions.unicode }, cases }, null, 2) + '\n')
})
