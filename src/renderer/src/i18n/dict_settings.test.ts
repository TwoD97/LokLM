import { describe, it, expect } from 'vitest'
import { DICT } from './index'

const THEME_KEYS = [
  'settings.basic.theme',
  'settings.basic.themeSub',
  'settings.basic.themeSystem',
  'settings.basic.themeLight',
  'settings.basic.themeDark',
]

describe('theme i18n keys', () => {
  for (const key of THEME_KEYS) {
    it(`is defined in both locales: ${key}`, () => {
      expect(DICT.en[key]).toBeTruthy()
      expect(DICT.de[key]).toBeTruthy()
    })
  }
})
