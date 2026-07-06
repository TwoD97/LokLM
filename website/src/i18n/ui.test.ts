import { describe, it, expect } from 'vitest'
import { ui, t, languages, defaultLang } from './ui'

const locales = Object.keys(ui) as Array<keyof typeof ui>

describe('translation dictionaries', () => {
  it('exactly de and en are defined, in ui and in the language labels', () => {
    expect(locales.sort()).toEqual(['de', 'en'])
    expect(Object.keys(languages).sort()).toEqual(['de', 'en'])
  })

  it('the default locale is among the defined ones', () => {
    expect(locales).toContain(defaultLang)
  })

  it('neither locale is missing keys the other one has', () => {
    const deKeys = Object.keys(ui.de).sort()
    const enKeys = Object.keys(ui.en).sort()
    const onlyInDe = deKeys.filter((k) => !(k in ui.en))
    const onlyInEn = enKeys.filter((k) => !(k in ui.de))
    expect(onlyInDe).toEqual([])
    expect(onlyInEn).toEqual([])
  })

  for (const locale of ['de', 'en'] as const) {
    it(`${locale}: every value is a non-empty string`, () => {
      for (const [key, value] of Object.entries(ui[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe('string')
        expect(value.trim().length, `${locale}.${key} is empty`).toBeGreaterThan(0)
      }
    })
  }

  it('no value carries stray leading or trailing whitespace', () => {
    for (const locale of locales) {
      for (const [key, value] of Object.entries(ui[locale])) {
        expect(value, `${locale}.${key} has surrounding whitespace`).toBe(value.trim())
      }
    }
  })
})

describe('interpolation tokens', () => {
  // A {token} embedded in one locale's string must exist in the other locale
  // too, otherwise interpolation breaks after switching languages. Today only
  // social.contributorsMore uses {n}, but the scan covers any {…} token.
  const TOKEN_RE = /\{[a-zA-Z][a-zA-Z0-9_]*\}/g

  it('every de string and its en counterpart use the same token set', () => {
    for (const [key, deValue] of Object.entries(ui.de)) {
      const inDe = (deValue.match(TOKEN_RE) ?? []).sort()
      const enValue = ui.en[key as keyof typeof ui.en]
      const inEn = (enValue.match(TOKEN_RE) ?? []).sort()
      expect(inEn, `${key}: placeholder drift between de and en`).toEqual(inDe)
    }
  })

  it('social.contributorsMore keeps its {n} token in de and en', () => {
    expect(ui.de['social.contributorsMore']).toContain('{n}')
    expect(ui.en['social.contributorsMore']).toContain('{n}')
  })
})

describe('t()', () => {
  it('resolves a key to the string of the requested locale', () => {
    expect(t('en', 'nav.features')).toBe('Features')
    expect(t('de', 'nav.features')).toBe('Funktionen')
  })

  it('produces a string for every known key in either locale', () => {
    for (const key of Object.keys(ui.de) as Array<keyof typeof ui.de>) {
      expect(typeof t('de', key)).toBe('string')
      expect(typeof t('en', key)).toBe('string')
    }
  })
})

describe('SEO cluster copy', () => {
  const pillarKeys = ['privacy', 'architecture', 'benchmarks'].flatMap((p) => [
    `pillar.${p}.title`,
    `pillar.${p}.lead`,
  ])
  const personaKeys = ['lawyer', 'research', 'consulting', 'development'].flatMap((p) => [
    `persona.${p}.title`,
    `persona.${p}.lead`,
  ])
  const navKeys = ['cluster.relatedPillars', 'cluster.relatedPersonas', 'cluster.readArchitecture']

  it('all pillar, persona and cluster-nav keys exist in both locales', () => {
    for (const key of [...pillarKeys, ...personaKeys, ...navKeys]) {
      expect(ui.de, `de missing ${key}`).toHaveProperty([key])
      expect(ui.en, `en missing ${key}`).toHaveProperty([key])
    }
  })
})

describe('persona FAQ copy', () => {
  it('every persona ships question/answer pairs q1-a3 in both locales', () => {
    for (const persona of ['lawyer', 'research', 'consulting', 'development'] as const) {
      for (let i = 1; i <= 3; i++) {
        for (const key of [`persona.${persona}.faq.q${i}`, `persona.${persona}.faq.a${i}`]) {
          expect(ui.de, `de ${key}`).toHaveProperty([key])
          expect(ui.en, `en ${key}`).toHaveProperty([key])
        }
      }
    }
  })
})
