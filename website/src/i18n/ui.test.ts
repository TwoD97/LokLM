import { describe, it, expect } from 'vitest'
import { ui, t, languages, defaultLang } from './ui'

const langs = Object.keys(ui) as Array<keyof typeof ui>

describe('ui dictionary parity', () => {
  it('declares the two known locales', () => {
    expect(langs.sort()).toEqual(['de', 'en'])
    expect(Object.keys(languages).sort()).toEqual(['de', 'en'])
  })

  it('default language is one of the declared locales', () => {
    expect(langs).toContain(defaultLang)
  })

  const deKeys = Object.keys(ui.de).sort()
  const enKeys = Object.keys(ui.en).sort()

  it('de and en have the same set of keys', () => {
    const missingInEn = deKeys.filter((k) => !(k in ui.en))
    const missingInDe = enKeys.filter((k) => !(k in ui.de))
    expect(missingInEn).toEqual([])
    expect(missingInDe).toEqual([])
  })

  it('every key in de has a non-empty string value', () => {
    for (const [key, value] of Object.entries(ui.de)) {
      expect(typeof value, `de.${key}`).toBe('string')
      expect(value.trim().length, `de.${key} is empty`).toBeGreaterThan(0)
    }
  })

  it('every key in en has a non-empty string value', () => {
    for (const [key, value] of Object.entries(ui.en)) {
      expect(typeof value, `en.${key}`).toBe('string')
      expect(value.trim().length, `en.${key} is empty`).toBeGreaterThan(0)
    }
  })

  it('no key has leading/trailing whitespace in any locale', () => {
    for (const lang of langs) {
      for (const [key, value] of Object.entries(ui[lang])) {
        expect(value, `${lang}.${key} has surrounding whitespace`).toBe(value.trim())
      }
    }
  })
})

describe('ui interpolation placeholders', () => {
  // Keys that intentionally contain a {placeholder} need the same placeholder in every locale.
  // Right now only social.contributorsMore uses {n}, but the test scans for any {…} token.
  const PLACEHOLDER_RE = /\{[a-zA-Z][a-zA-Z0-9_]*\}/g

  it('placeholders in de keys appear identically in en', () => {
    for (const [key, deValue] of Object.entries(ui.de)) {
      const dePlaceholders = (deValue.match(PLACEHOLDER_RE) ?? []).sort()
      const enValue = ui.en[key as keyof typeof ui.en]
      const enPlaceholders = (enValue.match(PLACEHOLDER_RE) ?? []).sort()
      expect(enPlaceholders, `${key}: placeholder drift between de and en`).toEqual(dePlaceholders)
    }
  })

  it('social.contributorsMore carries the {n} token in both locales', () => {
    expect(ui.de['social.contributorsMore']).toContain('{n}')
    expect(ui.en['social.contributorsMore']).toContain('{n}')
  })
})

describe('t() helper', () => {
  it('returns the locale value when key exists in target lang', () => {
    expect(t('en', 'nav.features')).toBe('Features')
    expect(t('de', 'nav.features')).toBe('Funktionen')
  })

  it('returns the resolved string for every defined key', () => {
    for (const key of Object.keys(ui.de) as Array<keyof typeof ui.de>) {
      expect(typeof t('de', key)).toBe('string')
      expect(typeof t('en', key)).toBe('string')
    }
  })
})

describe('cluster i18n keys', () => {
  const required = [
    'pillar.privacy.title',
    'pillar.privacy.lead',
    'pillar.architecture.title',
    'pillar.architecture.lead',
    'pillar.benchmarks.title',
    'pillar.benchmarks.lead',
    'persona.lawyer.title',
    'persona.lawyer.lead',
    'persona.research.title',
    'persona.research.lead',
    'persona.consulting.title',
    'persona.consulting.lead',
    'persona.development.title',
    'persona.development.lead',
    'cluster.relatedPillars',
    'cluster.relatedPersonas',
    'cluster.readArchitecture',
  ] as const

  it('exist in both locales', () => {
    for (const key of required) {
      expect(ui.de, `de missing ${key}`).toHaveProperty([key])
      expect(ui.en, `en missing ${key}`).toHaveProperty([key])
    }
  })
})
