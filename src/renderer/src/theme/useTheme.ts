import { useEffect } from 'react'
import { useSettings } from '../settings/useSettings'

export type ThemePref = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

const MQ_DARK = '(prefers-color-scheme: dark)'

/** Maps the stored preference to the theme that should actually render. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): EffectiveTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light'
  return pref
}

/** Resolves `pref` against the current OS preference and writes it to
 *  document.documentElement.dataset.theme — the single source the CSS
 *  `:root[data-theme='…']` blocks key off. */
export function applyTheme(pref: ThemePref): void {
  const systemPrefersDark =
    typeof window.matchMedia === 'function' ? window.matchMedia(MQ_DARK).matches : true
  document.documentElement.dataset.theme = resolveTheme(pref, systemPrefersDark)
}

/** Applies the persisted theme on mount and whenever it changes. While the
 *  preference is 'system', also re-applies on OS theme changes. Mounted once,
 *  high in the tree, so it covers every app phase (login → unlocked). */
export function useThemeEffect(): void {
  const { settings } = useSettings()
  const pref: ThemePref = settings?.basic.theme ?? 'system'
  useEffect(() => {
    applyTheme(pref)
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(MQ_DARK)
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])
}
