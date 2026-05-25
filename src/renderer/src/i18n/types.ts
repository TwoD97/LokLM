// Shared i18n types for the renderer. Mirrors the wizard's lightweight
// dict-based approach ( no i18next dependency ) : flat dot-keyed strings ,
// {placeholder} interpolation , English-first with EN fallback.

export type Locale = 'en' | 'de'

/** One domain's strings in both locales. Keys are flat , dot-joined , and
 *  domain-prefixed ( e.g. 'chat.sources' , 'auth.unlock' ) so the merged
 *  DICT has no collisions across domains. */
export interface DomainDict {
  en: Record<string, string>
  de: Record<string, string>
}
