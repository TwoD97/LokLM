// Generated LLM-discovery index (Answer.AI llms.txt spec). Derived from the
// cluster topology so it never drifts from the real routes.
import { personas, pillars, pillarUrl, personaUrl } from './cluster'

export function buildLlmsTxt(siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '')
  const lines: string[] = []
  lines.push('# LokLM')
  lines.push('')
  lines.push(
    '> Local AI knowledge assistant with source citations — runs fully offline, encrypted on-device, no cloud APIs.',
  )
  lines.push('')
  lines.push(`Site: ${base}`)
  lines.push('')
  lines.push('## Pillars')
  for (const p of pillars) {
    lines.push(`- [${p.key} (DE)](${base}${pillarUrl(p.key, 'de')})`)
    lines.push(`- [${p.key} (EN)](${base}${pillarUrl(p.key, 'en')})`)
  }
  lines.push('')
  lines.push('## Use cases')
  for (const p of personas) {
    lines.push(`- [${p.key} (DE)](${base}${personaUrl(p.key, 'de')})`)
    lines.push(`- [${p.key} (EN)](${base}${personaUrl(p.key, 'en')})`)
  }
  lines.push('')
  lines.push('## Project')
  lines.push('- [GitHub](https://github.com/TwoD97/LokLM)')
  lines.push(`- [Privacy (DE)](${base}/privacy)`)
  lines.push(`- [Privacy (EN)](${base}/en/privacy)`)
  return lines.join('\n') + '\n'
}
