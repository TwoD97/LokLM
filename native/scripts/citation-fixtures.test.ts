import { afterAll, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
const { cases } = vi.hoisted(() => ({ cases: [] as unknown[] }))
vi.mock('../../src/shared/citationMarkers', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/shared/citationMarkers')>()
  const wrapped = Object.fromEntries(Object.entries(original).map(([name, fn]) => [name, (...args: any[]) => {
    let rejection: string | null = null
    let supplied = args
    if (name === 'removeRedundantSourceLabels') supplied = [args[0], args[1], (reason: string) => { rejection = reason; args[2]?.(reason) }]
    const expected = (fn as (...args: any[]) => unknown)(...supplied)
    const recorded = name === 'reconcileCitations'
      ? [args[0], args[1], args[1].map(args[2])]
      : args.slice(0, name === 'removeRedundantSourceLabels' ? 2 : args.length).map(arg => arg instanceof Set ? [...arg] : arg ?? null)
    cases.push({ name, args: recorded, expected, rejection })
    return expected
  }]))
  return wrapped
})
await import('../../src/shared/citationMarkers.test')
vi.mock('../../src/shared/sourceLinkedAnswer', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/shared/sourceLinkedAnswer')>()
  return { ...original, renderSourceLinkedAnswer: (...args: Parameters<typeof original.renderSourceLinkedAnswer>) => {
    let rejection: string | null = null
    const expected = original.renderSourceLinkedAnswer(args[0], args[1], args[2], reason => { rejection = reason; args[3]?.(reason) })
    cases.push({ name: 'renderSourceLinkedAnswer', args: [args[0], [...args[1]], args[2]], expected, rejection })
    return expected
  } }
})
await import('../../tests/unit/source-linked-answer.test')
it('captures Unicode, numeric and literal-boundary differential probes', async () => {
  const api = await import('../../src/shared/citationMarkers')
  const sources = new Set(['1:10', '2:20'])
  const allowed = new Set(['1-10', '2-20'])
  const probes = [
    ...['', '😀', '\u0085', '\ufeff', '\u2028', '\r', '\n', '\r\n'].flatMap(gap => [
      `${gap}[doc:1, chunk:10] ${gap}[doc:2, chunk:20]`,
      `[doc:${gap}1, chunk:10]`, `${gap}(doc:1:10)${gap}.`,
    ]),
    ...['0', '01', '9007199254740991', '9007199254740992', '9007199254740993', '9'.repeat(400), '١', '１'].map(id => `[doc:${id}, chunk:10]`),
    ...['', ' ', '    ', '\t', '- ', '1. ', '> ', '> - '].flatMap(prefix => [
      `${prefix}[doc:1, chunk:10]`, `${prefix}(doc:1:10)`,
      `${prefix}~~~\n[doc:1, chunk:10]\n~~~\n[doc:2, chunk:20]`,
      `${prefix}$$\n[doc:1, chunk:10]\n$$\n[doc:2, chunk:20]`,
    ]),
    ...['<div', '<div ', '<dividend', '<script', '<scripted', '<span', '<span ', '<!--', '<!', '<?', 'x<y', '\\<div', '\\\\<div'].map(s => `${s} [doc:1, chunk:10]`),
    ...['`', '``', '$', '$$', '$$$', '"', "'", '„', '«'].flatMap(s => [
      `${s}(doc:1:10)${s} claim (doc:2:20).`, `${s}abc\n\nclaim (doc:1:10).`,
      `${s}abc\\${s} (doc:1:10).`,
    ]),
    '[doc:1, chunk:10]\n\r[ref]', '[doc:1, chunk:10]\n\n[ref]',
    '[label]\r[ref]\r[ref]: url [doc:1, chunk:10]',
    '[x]\n\n[doc:1, chunk:10]', '[x][😀'.repeat(1) + '😀'.repeat(498) + '] [doc:1, chunk:10]',
    'x (doc:1:10)  \nnext', '(doc:1:10)  claim', 'claim (doc:1:10) (doc:2:20).',
    ...['$', '$$'].flatMap(s => ['\\', '\\\\', '\\\\\\', '\\\r', '\\\u2028', '\\😀'].flatMap(escape => [
      `${s}(doc:1:10)${escape}${s}`, `${s}(doc:1:10)${escape}${s}${s}`, `${s}(doc:1:10)${escape}${s}more${s}`,
    ])),
  ]
  for (const text of probes) {
    api.findCitationAttempts(text); api.findCitationMatches(text)
    api.hasUnmaskedCitationSyntax(text); api.hasActiveHtmlSyntax(text)
    api.stripCitationMarkers(text); api.transformCitationMarkers(text, allowed)
    api.removeRedundantSourceLabels(text, sources)
  }
  for (const href of ['#cite-01-010', '#cite-1-10\n', '#cite-1-10\r', '#cite-1-10\u2028', '#cite-1-10\u0085']) api.parseCiteHref(href)
})
it('captures reproducible mixed-syntax probes against the original implementation', async () => {
  const api = await import('../../src/shared/citationMarkers')
  const { renderSourceLinkedAnswer } = await import('../../src/shared/sourceLinkedAnswer')
  const tokens = ['[doc:1, chunk:10]', '(doc:1:10)', '`', '``', '```', '\\', '$', '$$', '(', ')', '[', ']', ':', '<div', '<!--', '-->', '"', '„', '”', '😀', '\n', '\r', '\u2028', '\ufeff', '\t', '    ', '- ', '> ', 'x', 'https://a/', '[ref]: ']
  let seed = 0x4710
  for (let n = 0; n < 256; n++) {
    let text = ''
    for (let t = 0; t < 9; t++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += tokens[seed % tokens.length] }
    api.findCitationAttempts(text); api.hasActiveHtmlSyntax(text); api.hasUnmaskedCitationSyntax(text)
    api.removeRedundantSourceLabels(text, new Set(['1:10']))
    renderSourceLinkedAnswer([{ text, sources: ['1:10'] }, { text: 'Claim.', sources: ['1:10'] }], new Set(['1:10']), 32000)
  }
})
afterAll(async () => {
  await writeFile('native/crates/core/tests/fixtures/original-citation-markers.json', JSON.stringify({ runtime: { node: process.versions.node, icu: process.versions.icu, unicode: process.versions.unicode }, cases }, null, 2) + '\n')
})
