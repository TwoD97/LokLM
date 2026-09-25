import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CitationAliasDecoder,
  CitationAliasOutput,
  createCitationAliases,
  decodeCitationAliases,
} from '@main/services/llm/citationAliases'
import { buildPrompt, buildSystemPrompt } from '@main/services/llm/prompt'
import type { RetrievalHit } from '@shared/documents'

afterEach(() => vi.unstubAllEnvs())

const hit = (document_id: number, chunk_id: number, text = 'A factual source.'): RetrievalHit => ({
  document_id,
  chunk_id,
  text,
  document_title: 'Reference',
  ordinal: 0,
  page_from: null,
  page_to: null,
  heading_path: null,
  language: 'en',
  score: 1,
})
const aliases = createCitationAliases([hit(2, 7), hit(3, 9)])
const one = '[doc:2, chunk:7]'
const two = '[doc:3, chunk:9]'

describe('prompt-local citation aliases', () => {
  it('deduplicates pinned pairs and reserves literal labels anywhere in prompt content', () => {
    const pinned = hit(1, 4, 'Literal [S1] and code `[S3]`.')
    const table = createCitationAliases(
      [pinned, hit(2, 7)],
      [pinned],
      ['Question [S2]', 'History [S4]'],
    )
    expect([...table.labels.values()]).toEqual(['[S5]', '[S6]'])
    expect([...table.canonical.values()]).toEqual(['[doc:1, chunk:4]', one])
    expect(decodeCitationAliases('Literal [S1]; evidence [S5].', table)).toBe(
      'Literal [S1]; evidence [doc:1, chunk:4].',
    )
  })

  it('changes only source headers and leaves question, history, preamble and payload literal', () => {
    const source = hit(2, 7, 'const sample = "[S1]";\n[doc:88, chunk:99] is literal source text.')
    const question = 'Explain literal [S2]?'
    const history = [{ role: 'assistant' as const, content: 'Earlier [doc:42, chunk:10].' }]
    const table = createCitationAliases(
      [source],
      [],
      [question, ...history.map((x) => x.content), 'Overview [S3]'],
    )
    const prompt = buildPrompt(question, [source], history, 'en', [], 'Overview [S3]', table)
    expect(prompt).toContain('[S4] (Reference)\n' + source.text)
    expect(prompt).toContain('Assistant: ' + history[0]!.content)
    expect(prompt).toContain('Overview [S3]')
    expect(prompt).toContain('Question: ' + question + '\n\n')
  })

  it('keeps the production citation instructions unchanged unless the experiment is enabled', () => {
    vi.stubEnv('LOKLM_CITATION_ALIASES', undefined)
    expect(buildSystemPrompt('en')).toContain('[doc:<documentId>, chunk:<chunkId>]')
    vi.stubEnv('LOKLM_CITATION_ALIASES', '1')
    expect(buildSystemPrompt('en')).toContain('[S<number>]')
    expect(buildSystemPrompt('de')).toContain('[S<Nummer>]')
    expect(buildSystemPrompt('en')).not.toContain('[doc:<documentId>, chunk:<chunkId>]')
  })
})

describe('incremental citation decoding', () => {
  const cases: Array<[string, string]> = [
    ['Answer [S1]. Next [S2]!', `Answer ${one}. Next ${two}!`],
    ['[S1][S2] [S1]', `${one}${two} ${one}`],
    ['Unknown [S99], malformed [S01], [S], [S1', 'Unknown [S99], malformed [S01], [S], [S1'],
    ['Prior [doc:42, chunk:9] and [S1].', `Prior [doc:42, chunk:9] and ${one}.`],
    ['`[S1]` and ``[S2]`` then [S1]', '`[S1]` and ``[S2]`` then ' + one],
    ['```ts\nconst x = "[S1]";\n```\nAnswer [S2]', '```ts\nconst x = "[S1]";\n```\nAnswer ' + two],
    ['~~~\n[S1]\n~~~\n[S2]', '~~~\n[S1]\n~~~\n' + two],
    [
      '```\n```not a closing fence [S1]\n```\n[S2]',
      '```\n```not a closing fence [S1]\n```\n' + two,
    ],
    ['    const x = [S1];\n\t[S2]\nAnswer [S1]', '    const x = [S1];\n\t[S2]\nAnswer ' + one],
    ['> ~~~\n> [S1]\n> ~~~\nAnswer [S1]', '> ~~~\n> [S1]\n> ~~~\nAnswer ' + one],
    ['- ~~~\n  [S1]\n  ~~~\nAnswer [S1]', '- ~~~\n  [S1]\n  ~~~\nAnswer ' + one],
    ['>     [S1]\nAnswer [S2]', '>     [S1]\nAnswer ' + two],
    [
      '[S1]\n[reference]\n\n[reference]: /url\nAnswer [S2]',
      '[S1]\n[reference]\n\n[reference]: /url\nAnswer ' + two,
    ],
    ['[S1] [reference] then [S2]', '[S1] [reference] then ' + two],
    ['[S1](https://example.test/[S2]) then [S2]', '[S1](https://example.test/[S2]) then ' + two],
    [
      '[link [S1]](url) ![S2](image) [S1][reference]\n[S1]: https://example.test\n[S2]',
      '[link [S1]](url) ![S2](image) [S1][reference]\n[S1]: https://example.test\n' + two,
    ],
    [
      '<https://example.test/[S1]> https://example.test/[S2] [S1]',
      '<https://example.test/[S1]> https://example.test/[S2] ' + one,
    ],
    ['<span title="[S1]">x</span> [S2]', '<span title="[S1]">x</span> ' + two],
    ['x < 5 [S1], x > 2 [S2]', `x < 5 ${one}, x > 2 ${two}`],
    ['The bound x<y follows [S1].', `The bound x<y follows ${one}.`],
    [
      '[link](https://example.test/a "The ` character") Answer [S1].',
      '[link](https://example.test/a "The ` character") Answer ' + one + '.',
    ],
    [
      '[link](https://example.test/a`b) Answer [S1].',
      '[link](https://example.test/a`b) Answer ' + one + '.',
    ],
    ['[label `]` [S1]](url) Answer [S2]', '[label `]` [S1]](url) Answer ' + two],
    ['<https://example.test/a`b> Answer [S1].', '<https://example.test/a`b> Answer ' + one + '.'],
    ['https://example.test/a`b Answer [S1].', 'https://example.test/a`b Answer ' + one + '.'],
    ['<span title="x > [S1]"> [S2]', '<span title="x > [S1]"> ' + two],
    ['\\[S1] and [S2].', '\\[S1] and ' + two + '.'],
  ]
  it.each(cases)('has identical whole-text and streamed decoding: %s', (input, expected) => {
    expect(decodeCitationAliases(input, aliases)).toBe(expected)
    for (let split = 0; split <= input.length; split++) {
      const decoder = new CitationAliasDecoder(aliases)
      expect(
        decoder.feed(input.slice(0, split)) + decoder.feed(input.slice(split)) + decoder.flush(),
      ).toBe(expected)
    }
    const decoder = new CitationAliasDecoder(aliases)
    expect([...input].map((char) => decoder.feed(char)).join('') + decoder.flush()).toBe(expected)
  })

  it('holds only a small partial alias and streams arbitrarily long delimiter runs', () => {
    const decoder = new CitationAliasDecoder(aliases)
    expect(decoder.feed('`'.repeat(10_000))).toHaveLength(10_000)
    expect(decoder.feed('\n[S1]\n' + '`'.repeat(10_000))).toContain('[S1]')
    expect(decoder.feed('\n[S2]') + decoder.flush()).toBe('\n' + two)
  })

  it('bounds reference-link whitespace lookahead and conservatively keeps long labels literal', () => {
    const decoder = new CitationAliasDecoder(aliases)
    expect(decoder.feed('[S1]' + ' '.repeat(257))).toBe('[S1]' + ' '.repeat(257))
    expect(decoder.feed('Answer [S2]') + decoder.flush()).toBe('Answer ' + two)
  })

  it('releases comparison prose as soon as angle markup becomes impossible', () => {
    const decoder = new CitationAliasDecoder(aliases)
    expect(decoder.feed('The bound x<y follows [S1].')).toBe('The bound x<y follows ' + one + '.')
    expect(decoder.flush()).toBe('')
  })

  it('resets partial markers on retry and preserves native counts while holding a marker', () => {
    const output: Array<{ text: string; count: number }> = []
    const adapter = new CitationAliasOutput(aliases, (text, count) => output.push({ text, count }))
    adapter.feed('[S', 2)
    adapter.reset()
    adapter.feed('[', 1)
    adapter.feed('S1', 2)
    adapter.feed(']', 1)
    adapter.flush()
    expect(output).toEqual([{ text: one, count: 4 }])
    expect(adapter.final('[S1]')).toBe(one)
  })
})
