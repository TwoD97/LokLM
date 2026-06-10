import { describe, it, expect } from 'vitest'
import { DICT } from './index'

// Guards the single most fragile property of the hand-maintained dual-dict
// design: every UI string must exist in BOTH locales with the same
// {placeholders}. useT() silently falls back EN→key, so a dropped DE key would
// otherwise ship untranslated text to exactly the German users this targets,
// with no runtime error. This test makes that a build failure instead.

function placeholders(s: string): Set<string> {
  const out = new Set<string>()
  for (const m of s.matchAll(/\{(\w+)\}/g)) out.add(m[1]!)
  return out
}

describe('i18n DE/EN parity', () => {
  it('has identical key sets in both locales', () => {
    const en = Object.keys(DICT.en).sort()
    const de = Object.keys(DICT.de).sort()
    const missingInDe = en.filter((k) => !(k in DICT.de))
    const missingInEn = de.filter((k) => !(k in DICT.en))
    expect(missingInDe, `keys present in en but missing in de: ${missingInDe.join(', ')}`).toEqual(
      [],
    )
    expect(missingInEn, `keys present in de but missing in en: ${missingInEn.join(', ')}`).toEqual(
      [],
    )
    expect(de).toEqual(en)
  })

  it('uses the same {placeholders} for every shared key', () => {
    const mismatches: string[] = []
    for (const key of Object.keys(DICT.en)) {
      if (!(key in DICT.de)) continue
      const en = placeholders(DICT.en[key]!)
      const de = placeholders(DICT.de[key]!)
      const same = en.size === de.size && [...en].every((p) => de.has(p))
      if (!same) {
        mismatches.push(`${key}: en{${[...en].join(',')}} vs de{${[...de].join(',')}}`)
      }
    }
    expect(mismatches, `placeholder mismatches:\n${mismatches.join('\n')}`).toEqual([])
  })
})
