// Single source of truth for the home-page FAQ. The FAQ component renders
// these; the home pages reuse the same list to emit FAQPage JSON-LD so the
// markup and the structured data can never drift apart.
import type { UIKey } from '~/i18n/ui'

export interface FaqKeys {
  q: UIKey
  a: UIKey
}

export const faqKeys: FaqKeys[] = [
  { q: 'faq.q1.q', a: 'faq.q1.a' },
  { q: 'faq.q2.q', a: 'faq.q2.a' },
  { q: 'faq.q3.q', a: 'faq.q3.a' },
  { q: 'faq.q4.q', a: 'faq.q4.a' },
  { q: 'faq.q5.q', a: 'faq.q5.a' },
  { q: 'faq.q6.q', a: 'faq.q6.a' },
  { q: 'faq.q7.q', a: 'faq.q7.a' },
  { q: 'faq.q8.q', a: 'faq.q8.a' },
]
