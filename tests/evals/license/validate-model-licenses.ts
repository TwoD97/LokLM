import { existsSync, readFileSync } from 'node:fs'
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
 *  Jede Verletzung => ok=false. Keine stillen Fallbacks.
 *
 *  packGroups: Array of named pack groups. Duplicate-label check runs WITHIN each
 *  group (not across groups) — cross-pack duplicates (e.g. bge-m3 in both default
 *  and code pack) are expected and allowed. The merged unique set of refs is
 *  validated against the registry. */
export function validateLicenses(
  registry: RegistryEntry[],
  packRefs: PackRef[],
  packGroups?: Array<{ name: string; refs: PackRef[] }>,
): ValidateResult {
  const byLabel = new Map<string, RegistryEntry>()
  for (const e of registry) byLabel.set(e.label, e)
  const rows: ValidateRow[] = []
  const violations: string[] = []

  // Duplicate-label check: WITHIN each pack group (not across packs).
  // Falls back to the flat packRefs list treated as one group if packGroups absent.
  const groups = packGroups ?? [{ name: 'default', refs: packRefs }]
  for (const group of groups) {
    const seen = new Map<string, number>()
    for (const p of group.refs) seen.set(p.label, (seen.get(p.label) ?? 0) + 1)
    for (const [label, n] of seen) {
      if (n > 1) violations.push(`duplicate label "${label}" appears ${n}× in pack "${group.name}"`)
    }
  }

  // Deduplicate refs by label for the validation table (cross-pack duplicates
  // show once — same registry entry, no added value in repeating the row).
  const seenLabels = new Set<string>()
  const uniqueRefs: PackRef[] = []
  for (const ref of packRefs) {
    if (!seenLabels.has(ref.label)) {
      seenLabels.add(ref.label)
      uniqueRefs.push(ref)
    }
  }

  for (const ref of uniqueRefs) {
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
  const answerDir = join(__dirname, '..', 'answer')

  // Default packs (always present)
  const modelPackPath = join(answerDir, 'model-pack.json')
  const embedderPackPath = join(answerDir, 'embedder-pack.json')
  const rerankerPackPath = join(answerDir, 'reranker-pack.json')

  // Code packs (optional — skip gracefully if not present)
  const codeEmbedderPackPath = join(answerDir, 'embedder-pack-code.json')
  const codeRerankerPackPath = join(answerDir, 'reranker-pack-code.json')
  const codeLlmPackPath = join(answerDir, 'code-llm-pack.json')

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

  // Build pack groups for within-pack duplicate detection
  const packGroups: Array<{ name: string; refs: PackRef[] }> = [
    {
      name: 'model-pack',
      refs: modelPack.models.map((m) => ({ label: m.label, role: 'answer-llm' as const })),
    },
    {
      name: 'embedder-pack',
      refs: embedderPack.embedders.map((e) => ({ label: e.label, role: 'embedder' as const })),
    },
    {
      name: 'reranker-pack',
      refs: rerankerPack.rerankers.map((r) => ({ label: r.label, role: 'reranker' as const })),
    },
    {
      name: 'judge',
      refs: [{ label: 'mistral-small-3.2-24b', role: 'judge' as const }],
    },
  ]

  // Conditionally add code packs if they exist
  if (existsSync(codeEmbedderPackPath)) {
    const codeEmbedderPack: { embedders: { label: string }[] } = JSON.parse(
      readFileSync(codeEmbedderPackPath, 'utf-8'),
    )
    packGroups.push({
      name: 'embedder-pack-code',
      refs: codeEmbedderPack.embedders.map((e) => ({ label: e.label, role: 'embedder' as const })),
    })
  }
  if (existsSync(codeRerankerPackPath)) {
    const codeRerankerPack: { rerankers: { label: string }[] } = JSON.parse(
      readFileSync(codeRerankerPackPath, 'utf-8'),
    )
    packGroups.push({
      name: 'reranker-pack-code',
      refs: codeRerankerPack.rerankers.map((r) => ({ label: r.label, role: 'reranker' as const })),
    })
  }
  if (existsSync(codeLlmPackPath)) {
    const codeLlmPack: { models: { label: string }[] } = JSON.parse(
      readFileSync(codeLlmPackPath, 'utf-8'),
    )
    packGroups.push({
      name: 'code-llm-pack',
      refs: codeLlmPack.models.map((m) => ({ label: m.label, role: 'answer-llm' as const })),
    })
  }

  // Flatten all refs (cross-pack duplicates are fine; deduplication happens inside validateLicenses)
  const packRefs: PackRef[] = packGroups.flatMap((g) => g.refs)

  const result = validateLicenses(registry.models, packRefs, packGroups)

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
