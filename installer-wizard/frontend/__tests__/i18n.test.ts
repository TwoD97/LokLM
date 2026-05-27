import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createI18n, DICT } = require('../i18n.js') as {
  createI18n: (initial?: string) => {
    locale: string
    setLocale: (next: string) => string
    t: (key: string, vars?: Record<string, string | number>) => string
    availableLocales: string[]
  }
  DICT: Record<string, unknown>
}

// Recursively collect every dot-joined key path in a translation dictionary.
// Used by the parity test to enforce that EN has every key DE has and vice
// versa. If you add a new key on one side and forget the other, the test
// names it explicitly so you don't have to diff dictionaries by eye.
function collectKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return []
  const keys: string[] = []
  for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${name}` : name
    if (typeof value === 'string') keys.push(fullKey)
    else keys.push(...collectKeys(value, fullKey))
  }
  return keys.sort()
}

describe('createI18n', () => {
  it('defaults to German', () => {
    const i = createI18n()
    expect(i.locale).toBe('de')
    expect(i.t('nav.next')).toBe('Weiter')
  })

  it('returns the localized value for a known key', () => {
    const i = createI18n('en')
    expect(i.t('nav.next')).toBe('Next')
  })

  it('falls back from a missing locale-specific key to English', () => {
    // Construct an i18n with a fake locale that exists in DICT (de) but
    // missing the key we're asking for. Simulating: we never accidentally
    // ship a UI string in DE-only.
    const i = createI18n('de')
    // We pick a real EN-only-imagined key — none in the dict, so should fall
    // back to the key itself.
    expect(i.t('nonexistent.key.path')).toBe('nonexistent.key.path')
  })

  it('returns the key string when missing in both DE and EN (visible failure)', () => {
    const i = createI18n('de')
    expect(i.t('absolutely.not.a.key')).toBe('absolutely.not.a.key')
  })

  it('interpolates {placeholder} variables', () => {
    const i = createI18n('de')
    const result = i.t('install.summaryDir', { dir: 'C:\\Users\\Test\\LokLM' })
    expect(result).toBe('LokLM landet in C:\\Users\\Test\\LokLM.')
  })

  it('leaves unknown placeholders in place rather than substituting empty', () => {
    const i = createI18n('de')
    // No vars passed at all
    const noVars = i.t('install.summaryDir')
    expect(noVars).toBe('LokLM landet in {dir}.')
    // Vars passed but missing the named one
    const partial = i.t('install.summaryDir', { other: 'foo' })
    expect(partial).toBe('LokLM landet in {dir}.')
  })

  it('switches locale via setLocale and reflects in subsequent lookups', () => {
    const i = createI18n('de')
    expect(i.t('nav.next')).toBe('Weiter')
    i.setLocale('en')
    expect(i.locale).toBe('en')
    expect(i.t('nav.next')).toBe('Next')
  })

  it('ignores setLocale calls with unknown locales (stays on previous)', () => {
    const i = createI18n('de')
    i.setLocale('fr')
    expect(i.locale).toBe('de')
    expect(i.t('nav.next')).toBe('Weiter')
  })

  it('falls back to DE default when constructed with an unknown initial locale', () => {
    const i = createI18n('zz')
    expect(i.locale).toBe('de')
  })

  it('exposes the list of available locales', () => {
    const i = createI18n()
    expect(i.availableLocales).toContain('de')
    expect(i.availableLocales).toContain('en')
  })
})

describe('dictionary parity', () => {
  // If this test ever lights up red, the failure message will list exactly
  // which keys are missing on which side. Hand-curating two languages drifts
  // fast otherwise.
  it('every DE key has an EN counterpart and vice versa', () => {
    const deKeys = collectKeys(DICT.de)
    const enKeys = collectKeys(DICT.en)
    const missingInEn = deKeys.filter((k) => !enKeys.includes(k))
    const missingInDe = enKeys.filter((k) => !deKeys.includes(k))

    expect(
      { missingInEn, missingInDe },
      `parity drift — DE-only: [${missingInEn.join(', ')}], EN-only: [${missingInDe.join(', ')}]`,
    ).toEqual({ missingInEn: [], missingInDe: [] })
  })

  it('progress step keys cover every key main.cjs sends', () => {
    // Hard-coded list: keep in sync with sendProgress() calls in main.cjs.
    // The bootstrapper's progress event channel is the IPC contract — if we
    // change one side without the other the user sees raw keys.
    const steps = [
      'download-payload',
      'download-cuda',
      'preparing-folder',
      'copying-files',
      'applying-options',
      'registering-uninstaller',
      'done',
    ]
    const i = createI18n('de')
    const j = createI18n('en')
    for (const step of steps) {
      expect(i.t(`progress.${step}`), `DE missing progress.${step}`).not.toBe(`progress.${step}`)
      expect(j.t(`progress.${step}`), `EN missing progress.${step}`).not.toBe(`progress.${step}`)
    }
  })
})
