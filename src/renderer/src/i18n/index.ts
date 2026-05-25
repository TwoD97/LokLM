// Merged renderer dictionary + the useT() hook.
//
// Each domain owns a dict_<domain>.ts file ( en + de maps ). They're merged
// here into one flat DICT per locale. Keys are domain-prefixed so the spread
// can't collide. English-first : useT reads the user's settings.basic.language
// and falls back to EN ( then to the raw key ) for any missing string , so a
// half-translated build degrades to English rather than blank.

import { useSettings } from '../settings/useSettings'
import type { Locale } from './types'
import { authDict } from './dict_auth'
import { shellDict } from './dict_shell'
import { chatDict } from './dict_chat'
import { libraryDict } from './dict_library'
import { settingsDict } from './dict_settings'
import { modelsDict } from './dict_models'
import { quizDict } from './dict_quiz'
import { commonDict } from './dict_common'

const DOMAINS = [
  authDict,
  shellDict,
  chatDict,
  libraryDict,
  settingsDict,
  modelsDict,
  quizDict,
  commonDict,
]

function merge(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of DOMAINS) Object.assign(out, d[locale])
  return out
}

export const DICT: Record<Locale, Record<string, string>> = {
  en: merge('en'),
  de: merge('de'),
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  )
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string

/**
 * Translation hook. Reactive to the response-language setting ( the same
 * setting that drives the LLM's answer language ) , so flipping DE/EN in
 * settings re-renders the whole UI. EN-first with EN→key fallback.
 *
 * Usage : const t = useT(); <button>{t('common.close')}</button>
 */
export function useT(): TFn {
  const { settings } = useSettings()
  const locale: Locale = settings?.basic.language === 'de' ? 'de' : 'en'
  return (key, vars) => {
    const hit = DICT[locale][key] ?? DICT.en[key] ?? key
    return interpolate(hit, vars)
  }
}
