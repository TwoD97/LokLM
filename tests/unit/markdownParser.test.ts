import { describe, it, expect } from 'vitest'
import { parseMarkdownSections, stripFrontmatter } from '@main/services/documents/markdownParser'

describe('stripFrontmatter', () => {
  it('removes a leading YAML frontmatter block', () => {
    const out = stripFrontmatter('---\ntitle: Hello\ndraft: true\n---\n# Body\n')
    expect(out).toBe('# Body\n')
  })

  it('leaves text alone when there is no frontmatter', () => {
    const out = stripFrontmatter('# Heading\nbody\n')
    expect(out).toBe('# Heading\nbody\n')
  })

  it('does not strip --- inside the body', () => {
    const text = '# A\n---\n# B\n'
    expect(stripFrontmatter(text)).toBe(text)
  })

  it('strips a leading UTF-8 BOM before parsing frontmatter', () => {
    const out = stripFrontmatter('﻿---\ntitle: x\n---\nbody')
    expect(out).toBe('body')
  })
})

describe('parseMarkdownSections', () => {
  it('emits one section per ATX heading with nested breadcrumb', () => {
    const md = ['# A', 'alpha body', '## B', 'beta body', '## C', 'gamma body'].join('\n')
    const out = parseMarkdownSections(md)
    expect(out).toEqual([
      { headingPath: ['A'], text: 'alpha body' },
      { headingPath: ['A', 'B'], text: 'beta body' },
      { headingPath: ['A', 'C'], text: 'gamma body' },
    ])
  })

  it('emits a preamble section (empty headingPath) for content above the first heading', () => {
    const md = 'intro paragraph\nstill intro\n\n# First Heading\nbody\n'
    const out = parseMarkdownSections(md)
    expect(out[0]).toEqual({ headingPath: [], text: 'intro paragraph\nstill intro' })
    expect(out[1]).toEqual({ headingPath: ['First Heading'], text: 'body' })
  })

  it('pops the breadcrumb when a sibling-level heading appears', () => {
    const md = ['# Top', 'a', '## Sub', 'b', '# Other', 'c'].join('\n')
    const out = parseMarkdownSections(md)
    expect(out.map((s) => s.headingPath)).toEqual([['Top'], ['Top', 'Sub'], ['Other']])
  })

  it('drops headings with no body', () => {
    const md = '# Empty\n\n# Has Body\ncontent\n'
    const out = parseMarkdownSections(md)
    expect(out).toEqual([{ headingPath: ['Has Body'], text: 'content' }])
  })

  it('ignores # lines inside fenced code blocks', () => {
    const md = [
      '# Real Heading',
      'before',
      '```sh',
      '# this is a shell comment, NOT a heading',
      'rm -rf node_modules',
      '```',
      'after',
    ].join('\n')
    const out = parseMarkdownSections(md)
    expect(out).toHaveLength(1)
    expect(out[0]!.headingPath).toEqual(['Real Heading'])
    expect(out[0]!.text).toContain('# this is a shell comment')
    expect(out[0]!.text).toContain('after')
  })

  it('honors setext H1 / H2 underlines', () => {
    const md = [
      'Title One',
      '=========',
      'body one',
      '',
      'Title Two',
      '---------',
      'body two',
    ].join('\n')
    const out = parseMarkdownSections(md)
    expect(out).toEqual([
      { headingPath: ['Title One'], text: 'body one' },
      { headingPath: ['Title One', 'Title Two'], text: 'body two' },
    ])
  })

  it('strips a leading YAML frontmatter block before parsing', () => {
    const md = ['---', 'title: x', '---', '# H', 'body'].join('\n')
    const out = parseMarkdownSections(md)
    expect(out).toEqual([{ headingPath: ['H'], text: 'body' }])
  })

  it('trims trailing # markers from ATX headings', () => {
    const md = '## Heading with closing hashes ##\nbody\n'
    const out = parseMarkdownSections(md)
    expect(out).toEqual([{ headingPath: ['Heading with closing hashes'], text: 'body' }])
  })
})
