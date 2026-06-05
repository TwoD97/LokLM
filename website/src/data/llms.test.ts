import { describe, it, expect } from 'vitest'
import { buildLlmsTxt } from './llms'

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
})
