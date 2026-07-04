import { describe, it, expect } from 'vitest'
import { personas, pillars, personaUrl, pillarUrl } from './cluster'

describe('SEO cluster data', () => {
  it('defines the four personas, each with a DE and an EN slug', () => {
    expect(personas.map((p) => p.key)).toEqual(['lawyer', 'research', 'consulting', 'development'])
    for (const persona of personas) {
      expect(persona.slug.de).toMatch(/^einsatz\//)
      expect(persona.slug.en).toMatch(/^use-cases\//)
    }
  })

  it('defines the three pillars', () => {
    expect(pillars.map((p) => p.key)).toEqual(['privacy', 'architecture', 'benchmarks'])
  })

  it('personaUrl yields root-relative DE paths and /en-prefixed EN paths', () => {
    expect(personaUrl('lawyer', 'de')).toBe('/einsatz/anwalt')
    expect(personaUrl('lawyer', 'en')).toBe('/en/use-cases/lawyer')
  })

  it('pillarUrl yields the localized pillar path per locale', () => {
    expect(pillarUrl('privacy', 'de')).toBe('/lokale-ki')
    expect(pillarUrl('privacy', 'en')).toBe('/en/local-ai')
    expect(pillarUrl('architecture', 'de')).toBe('/architektur')
  })
})
