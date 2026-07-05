import { describe, it, expect } from 'vitest'
import { buildLlmsTxt, buildLlmsFullTxt, type LlmsFullPost } from './llms'

const SITE = 'https://loklm.com'

describe('buildLlmsTxt', () => {
  const output = buildLlmsTxt(SITE)

  it('opens with the project H1 and references the site url', () => {
    expect(output.startsWith('# LokLM')).toBe(true)
    expect(output).toContain(SITE)
  })

  it('links every pillar and persona page for DE as well as EN', () => {
    expect(output).toContain('https://loklm.com/lokale-ki')
    expect(output).toContain('https://loklm.com/en/local-ai')
    expect(output).toContain('https://loklm.com/einsatz/anwalt')
    expect(output).toContain('https://loklm.com/en/use-cases/lawyer')
  })

  it('points readers to the GitHub repository', () => {
    expect(output).toContain('https://github.com/TwoD97/LokLM')
  })

  it('tolerates a site url ending in a slash without doubling separators', () => {
    expect(buildLlmsTxt('https://loklm.com/')).toContain('https://loklm.com/lokale-ki')
  })

  it('includes the overview sections: key facts, FAQ, blog, llms-full pointer', () => {
    expect(output).toContain('## Key facts')
    expect(output).toContain('MIT')
    expect(output).toContain('## FAQ')
    expect(output).toContain('## Blog')
    expect(output).toContain('/llms-full.txt')
  })

  it('renders passed-in posts together with their .md mirror url', () => {
    const post = {
      title: 'Taxonomy',
      description: 'd',
      url: 'https://loklm.com/en/blog/taxonomy-of-local-ai',
      lang: 'en' as const,
    }
    const withPosts = buildLlmsTxt(SITE, [post])
    expect(withPosts).toContain('https://loklm.com/en/blog/taxonomy-of-local-ai.md')
    expect(withPosts).toContain('Taxonomy (EN)')
  })
})

describe('buildLlmsFullTxt', () => {
  const fixture: LlmsFullPost = {
    title: 'First Post',
    description: 'A summary.',
    url: 'https://loklm.com/blog/first',
    lang: 'de',
    body: 'Full body text of the first post.',
  }
  const output = buildLlmsFullTxt(SITE, [fixture])

  it('leads with the full-content H1 followed by the key-facts overview', () => {
    expect(output.startsWith('# LokLM — full content')).toBe(true)
    expect(output).toContain('## Key facts')
  })

  it('embeds title, source url and complete body of every post', () => {
    expect(output).toContain('# First Post')
    expect(output).toContain('Source: https://loklm.com/blog/first')
    expect(output).toContain('Full body text of the first post.')
  })
})
