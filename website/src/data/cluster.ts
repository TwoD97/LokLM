// Single source of truth for the SEO topical-cluster topology.
// Localized DE slugs (not English mirrors) per the strategy spec.
import type { Lang } from '../i18n/ui'

export type PersonaKey = 'lawyer' | 'research' | 'consulting' | 'development'
export type PillarKey = 'privacy' | 'architecture' | 'benchmarks'
export type PersonaIcon = 'lawyer' | 'researcher' | 'consultant' | 'developer'

export interface Persona {
  key: PersonaKey
  icon: PersonaIcon
  slug: { de: string; en: string } // no leading slash
  /** pillars this persona links up to (rule 3: one privacy + one technical) */
  pillars: [PillarKey, PillarKey]
}

export interface Pillar {
  key: PillarKey
  slug: { de: string; en: string } // no leading slash
}

export const personas: Persona[] = [
  {
    key: 'lawyer',
    icon: 'lawyer',
    slug: { de: 'einsatz/anwalt', en: 'use-cases/lawyer' },
    pillars: ['privacy', 'architecture'],
  },
  {
    key: 'research',
    icon: 'researcher',
    slug: { de: 'einsatz/forschung', en: 'use-cases/research' },
    pillars: ['privacy', 'benchmarks'],
  },
  {
    key: 'consulting',
    icon: 'consultant',
    slug: { de: 'einsatz/beratung', en: 'use-cases/consulting' },
    pillars: ['privacy', 'architecture'],
  },
  {
    key: 'development',
    icon: 'developer',
    slug: { de: 'einsatz/entwicklung', en: 'use-cases/development' },
    pillars: ['architecture', 'benchmarks'],
  },
]

export const pillars: Pillar[] = [
  { key: 'privacy', slug: { de: 'lokale-ki', en: 'local-ai' } },
  { key: 'architecture', slug: { de: 'architektur', en: 'architecture' } },
  { key: 'benchmarks', slug: { de: 'benchmarks', en: 'benchmarks' } },
]

function localise(lang: Lang, slug: string): string {
  return lang === 'de' ? `/${slug}` : `/en/${slug}`
}

export function personaUrl(key: PersonaKey, lang: Lang): string {
  const p = personas.find((x) => x.key === key)
  if (!p) throw new Error(`unknown persona: ${key}`)
  return localise(lang, p.slug[lang])
}

export function pillarUrl(key: PillarKey, lang: Lang): string {
  const p = pillars.find((x) => x.key === key)
  if (!p) throw new Error(`unknown pillar: ${key}`)
  return localise(lang, p.slug[lang])
}

export function getPersona(key: PersonaKey): Persona {
  const p = personas.find((x) => x.key === key)
  if (!p) throw new Error(`unknown persona: ${key}`)
  return p
}

export function getPillar(key: PillarKey): Pillar {
  const p = pillars.find((x) => x.key === key)
  if (!p) throw new Error(`unknown pillar: ${key}`)
  return p
}
