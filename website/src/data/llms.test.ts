import { describe, it, expect } from 'vitest'
import { buildLlmsTxt, buildLlmsFullTxt, type LlmsFullPost } from './llms'

describe('buildLlmsTxt', () => {
  const txt = buildLlmsTxt('https://loklm.com')

  it('starts with an H1 and carries the site url', () => {
    expect(txt.startsWith('# LokLM')).toBe(true)
    expect(txt).toContain('https://loklm.com')
  })

  it('lists pillar + persona pages in both locales', () => {
    expect(txt).toContain('https://loklm.com/lokale-ki')
    expect(txt).toContain('https://loklm.com/en/local-ai')
    expect(txt).toContain('https://loklm.com/einsatz/anwalt')
    expect(txt).toContain('https://loklm.com/en/use-cases/lawyer')
  })

  it('links the GitHub repo', () => {
    expect(txt).toContain('https://github.com/TwoD97/LokLM')
  })

  it('strips a trailing slash from the site url', () => {
    expect(buildLlmsTxt('https://loklm.com/')).toContain('https://loklm.com/lokale-ki')
  })

  it('carries an overview, key facts and a FAQ section', () => {
    expect(txt).toContain('## Key facts')
    expect(txt).toContain('MIT')
    expect(txt).toContain('## FAQ')
    expect(txt).toContain('## Blog')
    expect(txt).toContain('/llms-full.txt')
  })

  it('lists provided posts with their markdown mirror', () => {
    const withPosts = buildLlmsTxt('https://loklm.com', [
      {
        title: 'Taxonomy',
        description: 'd',
        url: 'https://loklm.com/en/blog/taxonomy-of-local-ai',
        lang: 'en',
      },
    ])
    expect(withPosts).toContain('https://loklm.com/en/blog/taxonomy-of-local-ai.md')
    expect(withPosts).toContain('Taxonomy (EN)')
  })
})

describe('buildLlmsFullTxt', () => {
  const posts: LlmsFullPost[] = [
    {
      title: 'First Post',
      description: 'A summary.',
      url: 'https://loklm.com/blog/first',
      lang: 'de',
      body: 'Full body text of the first post.',
    },
  ]
  const full = buildLlmsFullTxt('https://loklm.com', posts)

  it('starts with the full-content heading and the overview', () => {
    expect(full.startsWith('# LokLM — full content')).toBe(true)
    expect(full).toContain('## Key facts')
  })

  it('inlines each post title, source url and full body', () => {
    expect(full).toContain('# First Post')
    expect(full).toContain('Source: https://loklm.com/blog/first')
    expect(full).toContain('Full body text of the first post.')
  })
})
