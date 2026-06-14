import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RegistryEntry {
  label: string
  role: string
  repo?: string
  declaredLicense?: string
  licenseClass: string
  allowedInDefaultMatrix: boolean
}
export interface PackRef {
  label: string
  role: 'answer-llm' | 'embedder' | 'reranker' | 'judge'
}
export interface ValidateRow {
  label: string
  role: string
  repo: string
  declaredLicense: string
  licenseClass: string
  allowed: boolean
  reason: string
}
export interface ValidateResult {
  ok: boolean
  rows: ValidateRow[]
  violations: string[]
}

/** Default-Matrix erlaubt NUR licenseClass='osi-permissive' UND allowedInDefaultMatrix=true.
 *  Jede Verletzung => ok=false. Keine stillen Fallbacks. */
export function validateLicenses(registry: RegistryEntry[], packRefs: PackRef[]): ValidateResult {
  const byLabel = new Map<string, RegistryEntry>()
  for (const e of registry) byLabel.set(e.label, e)
  const rows: ValidateRow[] = []
  const violations: string[] = []

  // duplicate labels in the packs
  const seen = new Map<string, number>()
  for (const p of packRefs) seen.set(p.label, (seen.get(p.label) ?? 0) + 1)
  for (const [label, n] of seen) {
    if (n > 1) violations.push(`duplicate label "${label}" appears ${n}× across packs`)
  }

  for (const ref of packRefs) {
    const e = byLabel.get(ref.label)
    let reason = 'ok'
    let allowed = true
    if (!e) {
      allowed = false
      reason = 'NOT in license registry'
    } else if (e.role !== ref.role) {
      allowed = false
      reason = `registry role "${e.role}" != pack role "${ref.role}"`
    } else if (e.licenseClass !== 'osi-permissive') {
      allowed = false
      reason = `licenseClass "${e.licenseClass}" is not osi-permissive`
    } else if (!e.allowedInDefaultMatrix) {
      allowed = false
      reason = 'allowedInDefaultMatrix=false'
    }
    if (!allowed) violations.push(`${ref.label} (${ref.role}): ${reason}`)
    rows.push({
      label: ref.label,
      role: ref.role,
      repo: e?.repo ?? '?',
      declaredLicense: e?.declaredLicense ?? '?',
      licenseClass: e?.licenseClass ?? 'MISSING',
      allowed,
      reason,
    })
  }
  return { ok: violations.length === 0, rows, violations }
}

function main(): void {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  const registryPath = join(__dirname, '..', 'model-license-registry.json')
  const modelPackPath = join(__dirname, '..', 'answer', 'model-pack.json')
  const embedderPackPath = join(__dirname, '..', 'answer', 'embedder-pack.json')
  const rerankerPackPath = join(__dirname, '..', 'answer', 'reranker-pack.json')

  const registry: { models: RegistryEntry[] } = JSON.parse(readFileSync(registryPath, 'utf-8'))
  const modelPack: { models: { label: string }[] } = JSON.parse(
    readFileSync(modelPackPath, 'utf-8'),
  )
  const embedderPack: { embedders: { label: string }[] } = JSON.parse(
    readFileSync(embedderPackPath, 'utf-8'),
  )
  const rerankerPack: { rerankers: { label: string }[] } = JSON.parse(
    readFileSync(rerankerPackPath, 'utf-8'),
  )

  const packRefs: PackRef[] = [
    ...modelPack.models.map((m) => ({ label: m.label, role: 'answer-llm' as const })),
    ...embedderPack.embedders.map((e) => ({ label: e.label, role: 'embedder' as const })),
    ...rerankerPack.rerankers.map((r) => ({ label: r.label, role: 'reranker' as const })),
    { label: 'mistral-small-3.2-24b', role: 'judge' as const },
  ]

  const result = validateLicenses(registry.models, packRefs)

  // Print table
  const cols = [
    'label',
    'role',
    'repo',
    'declaredLicense',
    'licenseClass',
    'allowed',
    'reason',
  ] as const
  const widths = cols.map((c) => Math.max(c.length, ...result.rows.map((r) => String(r[c]).length)))

  const pad = (s: string, w: number) => s.padEnd(w)
  const header = cols.map((c, i) => pad(c, widths[i] ?? c.length)).join(' | ')
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-')
  console.log(header)
  console.log(sep)
  for (const row of result.rows) {
    console.log(cols.map((c, i) => pad(String(row[c]), widths[i] ?? c.length)).join(' | '))
  }
  console.log('')

  if (result.ok) {
    console.log(`LICENSE CHECK PASSED — ${result.rows.length} models, all OSI-permissive`)
    process.exit(0)
  } else {
    for (const v of result.violations) {
      console.error(`VIOLATION: ${v}`)
    }
    process.exit(1)
  }
}

// Entry-point guard: only run CLI when this file is executed directly
const __filename = fileURLToPath(import.meta.url)
if (
  process.argv[1] &&
  (process.argv[1] === __filename ||
    process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/'))
) {
  main()
}
