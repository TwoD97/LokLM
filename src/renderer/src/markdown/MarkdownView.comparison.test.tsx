/** Exercise the actual renderer on program-rendered original source spans. */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { escapeSourceMarkdown, sourceQuoteMarkdown } from '@shared/sourceQuoteMarkdown'
import { renderSourceLinkedAnswer } from '@shared/sourceLinkedAnswer'
import { MarkdownView } from './MarkdownView'

describe('typed comparison original-source display', () => {
  it.each([
    '[link](https://example.invalid) [doc:999, chunk:999] `code` <b>x</b> &lt;tag&gt; $value$',
    'Header\n\n    [doc:999, chunk:999] `code`',
    '```text\nA literal sentence.\n\n[doc:999, chunk:999]\n```',
  ])(
    'keeps compact inline original units literal and the attached program source navigable',
    (literal) => {
      const content = `The excerpts do not establish a definitive answer: “${escapeSourceMarkdown(literal)}” [doc:1, chunk:10].`
      const transformed = transformCitationMarkers(content, new Set(['1-10']))
      const view = render(<MarkdownView>{transformed.text}</MarkdownView>)
      expect(view.container.querySelector('b, code, .katex')).toBeNull()
      expect(view.container.textContent).toContain('[doc:999, chunk:999]')
      expect(view.container.textContent).not.toContain('\\[')
      expect(view.container.querySelectorAll('a[href^="#cite-"]')).toHaveLength(1)
      expect(view.container.querySelector('a[href="#cite-1-10"]')).not.toBeNull()
    },
  )

  it.each(['    ', '\t'])(
    'does not expose escape backslashes in indented original source: %j',
    (indent) => {
      const literal = `Header\n\n${indent}[doc:999, chunk:999] \`code\``
      const content = `${sourceQuoteMarkdown(literal)}\n\n[doc:1, chunk:10]`
      const transformed = transformCitationMarkers(content, new Set(['1-10']))
      const view = render(<MarkdownView>{transformed.text}</MarkdownView>)
      const quote = view.container.querySelector('blockquote')!
      expect(quote.textContent).toContain(`${indent}[doc:999, chunk:999] \`code\``)
      expect(quote.textContent).not.toContain('\\[')
      expect(quote.textContent).not.toContain('\\`')
      expect(quote.querySelector('pre, code, a[href^="#cite-"]')).toBeNull()
      expect(view.container.querySelectorAll('a[href^="#cite-"]')).toHaveLength(1)
    },
  )

  it('preserves literal visible characters through the actual GFM/math/HTML pipeline', () => {
    const literal =
      '[link](https://example.invalid) [doc:999, chunk:999] `code` <b>x</b> &lt;tag&gt; $value$'
    const other = 'The second source statement differs.'
    const content = `${sourceQuoteMarkdown(literal)}\n\n[doc:1, chunk:10]\n\n${sourceQuoteMarkdown(other)}\n\n[doc:2, chunk:20]`
    const transformed = transformCitationMarkers(content, new Set(['1-10', '2-20']))
    const view = render(<MarkdownView>{transformed.text}</MarkdownView>)
    const quotes = view.container.querySelectorAll('blockquote')
    expect(quotes).toHaveLength(2)
    expect(quotes[0]!.textContent?.trim()).toBe(literal)
    expect(quotes[1]!.textContent?.trim()).toBe(other)
    expect(view.container.querySelector('b, code, .katex')).toBeNull()
    expect(view.container.querySelectorAll('blockquote a[href^="#cite-"]')).toHaveLength(0)
    expect(
      [...view.container.querySelectorAll('blockquote a')].some(
        (link) => link.textContent === 'link',
      ),
    ).toBe(false)
    expect(
      [...view.container.querySelectorAll('a[href^="#cite-"]')].map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(['#cite-1-10', '#cite-2-20'])
  })
})

describe('source-linked answer records in the actual Markdown reader', () => {
  const supplied = new Set(['1:10', '2:20'])
  const project = (blocks: Array<{ text: string; sources: string[] }>) =>
    renderSourceLinkedAnswer(blocks, supplied, 32_000)
  const renderProjected = (text: string) => {
    const transformed = transformCitationMarkers(text, new Set(['1-10', '2-20']))
    return render(<MarkdownView>{transformed.text}</MarkdownView>)
  }

  it('renders independently attached results as two actual source links', () => {
    const markdown = project([
      { text: 'The first result is **six**.', sources: ['1:10'] },
      { text: 'The second result is seven.', sources: ['2:20'] },
    ])!
    const view = renderProjected(markdown)
    const paragraphs = view.container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]!.querySelector('a')?.getAttribute('href')).toBe('#cite-1-10')
    expect(paragraphs[1]!.querySelector('a')?.getAttribute('href')).toBe('#cite-2-20')
    expect(view.container.querySelector('strong')?.textContent).toBe('six')
  })

  it('keeps code, tables, lists, inline links and their program citations usable', () => {
    const records = [
      '```js\nfunction result() { return 6 }\n```',
      '| Source | Result |\n| --- | --- |\n| A | 6 |',
      '- Result one\n- Result two',
      '[Further documentation](https://example.invalid)',
      '    [doc:999, chunk:999]\n    literal source example',
    ]
    const view = renderProjected(project(records.map((text) => ({ text, sources: ['1:10'] })))!)
    expect(view.container.querySelectorAll('pre')).toHaveLength(2)
    expect(view.container.querySelector('table')?.textContent).toContain('A6')
    expect(view.container.querySelectorAll('li')).toHaveLength(2)
    expect(view.container.querySelector('a[href="https://example.invalid"]')).not.toBeNull()
    expect(view.container.querySelectorAll('a[href="#cite-1-10"]')).toHaveLength(records.length)
    expect(view.container.querySelector('a[href="#cite-999-999"]')).toBeNull()
  })

  it.each([
    '<script>hidden',
    '<pre>hidden',
    '<style>hidden',
    '<textarea>hidden',
    '<?hidden',
    '<![CDATA[hidden',
    '<script',
    '<pre class="incomplete',
    '$$\nx + y',
    '$$',
  ])('rejects reader syntax that would absorb a generated chip: %s', (text) => {
    const unsafe = renderProjected(`${text}\n\n[doc:1, chunk:10]`)
    expect(unsafe.container.querySelector('a[href="#cite-1-10"]')).toBeNull()
    expect(project([{ text, sources: ['1:10'] }])).toBeNull()
  })

  it('rejects raw single-line HTML even when its same-line citation would be absorbed', () => {
    for (const text of [
      '<div>hidden',
      '<pre>x</pre>',
      '<div',
      '<table',
      '<section class="incomplete',
    ]) {
      const unsafe = renderProjected(`${text} [doc:1, chunk:10]`)
      expect(unsafe.container.querySelector('a[href="#cite-1-10"]')).toBeNull()
      expect(project([{ text, sources: ['1:10'] }])).toBeNull()
    }
  })

  it('does not let math delimiters across records hide either program attachment', () => {
    expect(
      project([
        { text: '$$\nx + y', sources: ['1:10'] },
        { text: '$$', sources: ['2:20'] },
      ]),
    ).toBeNull()
  })

  it.each([
    '`<script>` is literal code.',
    '```html\n<script>literal text\n```',
    '\\<script> is escaped.',
    '$$\nx + y\n$$',
    '$$x + y$$',
    '$x + y$',
  ])('preserves literal HTML/closed math with an actual visible chip: %s', (text) => {
    const markdown = project([{ text, sources: ['1:10'] }])!
    expect(markdown).not.toBeNull()
    const view = renderProjected(markdown)
    expect(view.container.querySelectorAll('a[href="#cite-1-10"]')).toHaveLength(1)
  })
})

describe('redundant source labels in the actual reader', () => {
  it.each([
    ['The policy  (doc:1:10)\nNext line.', 0],
    ['The policy (doc:1:10)  \nNext line.', 1],
  ] as const)(
    'preserves hard-versus-soft line breaks when removing a label: %s',
    (text, breaks) => {
      const markdown = renderSourceLinkedAnswer(
        [{ text, sources: ['1:10'] }],
        new Set(['1:10']),
        32_000,
      )!
      const transformed = transformCitationMarkers(markdown, new Set(['1-10']))
      const view = render(<MarkdownView>{transformed.text}</MarkdownView>)
      expect(view.container.querySelectorAll('br')).toHaveLength(breaks)
      expect(view.container.textContent).not.toContain('(doc:1:10)')
      expect(view.container.querySelectorAll('a[href^="#cite-"]')).toHaveLength(1)
    },
  )
  it.each([
    '> The source says\n(doc:9:90) as its identifier.',
    '- > The source says\n  (doc:9:90) as its identifier.',
  ])('preserves lazy blockquote content in the real renderer: %s', (text) => {
    const markdown = renderSourceLinkedAnswer(
      [{ text, sources: ['1:10'] }],
      new Set(['1:10']),
      32_000,
    )!
    const transformed = transformCitationMarkers(markdown, new Set(['1-10']))
    const view = render(<MarkdownView>{transformed.text}</MarkdownView>)
    expect(view.container.querySelector('blockquote')?.textContent).toContain(
      '(doc:9:90) as its identifier.',
    )
    expect(view.container.querySelectorAll('a[href^="#cite-"]')).toHaveLength(1)
  })
  it('shows only program citations while preserving quoted/code/link examples', () => {
    const supplied = new Set(['1:10'])
    const original =
      'The policy (doc:1:10) applies. "(doc:9:90)" and `(doc:8:80)` are literal examples. [(doc:7:70)](https://example.invalid) is an ordinary link.'
    const markdown = renderSourceLinkedAnswer(
      [{ text: original, sources: ['1:10'] }],
      supplied,
      32_000,
    )!
    const transformed = transformCitationMarkers(markdown, new Set(['1-10']))
    const view = render(<MarkdownView>{transformed.text}</MarkdownView>)
    expect(view.container.textContent).toContain('The policy applies.')
    expect(view.container.textContent).not.toContain('(doc:1:10)')
    expect(view.container.textContent).toContain('"(doc:9:90)"')
    expect(view.container.querySelector('code')?.textContent).toBe('(doc:8:80)')
    expect(view.container.querySelector('a[href="https://example.invalid"]')?.textContent).toBe(
      '(doc:7:70)',
    )
    expect(view.container.querySelectorAll('a[href^="#cite-"]')).toHaveLength(1)
    expect(view.container.querySelector('a[href^="#cite-"]')?.getAttribute('href')).toBe(
      '#cite-1-10',
    )
  })
})
