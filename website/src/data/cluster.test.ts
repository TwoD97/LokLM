import { describe, it, expect } from 'vitest'
import { personas, pillars, personaUrl, pillarUrl } from './cluster'

describe('cluster topology', () => {
  it('has four personas with both locale slugs', () => {
    expect(personas.map((p) => p.key)).toEqual(['lawyer', 'research', 'consulting', 'development'])
    for (const p of personas) {
      expect(p.slug.de).toMatch(/^einsatz\//)
      expect(p.slug.en).toMatch(/^use-cases\//)
    }
  })

  it('has three pillars with both locale slugs', () => {
    expect(pillars.map((p) => p.key)).toEqual(['privacy', 'architecture', 'benchmarks'])
  })

  it('personaUrl builds DE (unprefixed) and EN (/en) absolute paths', () => {
    expect(personaUrl('lawyer', 'de')).toBe('/einsatz/anwalt')
    expect(personaUrl('lawyer', 'en')).toBe('/en/use-cases/lawyer')
  })

  it('pillarUrl builds DE and EN paths', () => {
    expect(pillarUrl('privacy', 'de')).toBe('/lokale-ki')
    expect(pillarUrl('privacy', 'en')).toBe('/en/local-ai')
    expect(pillarUrl('architecture', 'de')).toBe('/architektur')
  })
})
