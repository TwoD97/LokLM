import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sourceQuantityAnnotations } from '../../../src/main/services/qa/sourceQuantities'
import { sourceCalculationAnnotations } from '../../../src/main/services/qa/sourceCalculations'
import { estimateTokens } from '../../../src/main/services/llm/prompt'
import { fingerprintCompiledBuild } from '../../e2e/helpers/buildFingerprint'
import { inspectBuildProvenance } from '../../e2e/helpers/buildProvenance'
import type { prepareReasoningDiagnostic20261005 } from './reasoningDiagnostic20261005'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Same exact A instruction/framing, plus the C arithmetic annotations only. */
export async function prepareAnnotatedDiagnostic20261005(baselinePath: string) {
  const baselineBytes = await readFile(baselinePath)
  const baseline = JSON.parse(baselineBytes.toString('utf8')) as Awaited<
    ReturnType<typeof prepareReasoningDiagnostic20261005>
  >
  if (baseline.kind !== 'native-reasoning-answer-20261005' || baseline.cases.length !== 6)
    throw new Error('Expected the frozen six-case A plan')
  const compiledBuildHashes = await fingerprintCompiledBuild()
  if (JSON.stringify(compiledBuildHashes) !== JSON.stringify(baseline.compiledBuildHashes))
    throw new Error('Compiled worker changed since A/B/C')
  const cases = baseline.cases.map((entry) => {
    if (entry.arm !== 'A') throw new Error('Expected A, not another candidate')
    const arithmetic = [
      sourceQuantityAnnotations(entry.hits).annotation,
      sourceCalculationAnnotations(entry.question, entry.hits).annotation,
    ]
      .filter(Boolean)
      .join('\n\n')
    const prompt = `${entry.plan.prompt}${arithmetic ? `\n\nDerived arithmetic checks:\n${arithmetic}` : ''}`
    if (estimateTokens(prompt) + estimateTokens(entry.plan.systemPrompt) + 512 + 820 > 8192)
      throw new Error(`Complete original context cannot fit: ${entry.caseId}`)
    return { ...entry, arm: 'D', plan: { ...entry.plan, prompt } }
  })
  const sourcePaths = [
    'tests/evals/native-calibration/annotatedDiagnostic20261005.ts',
    'tests/bench/annotated-answer-20261005.cjs',
    'src/main/services/qa/sourceQuantities.ts',
    'src/main/services/qa/sourceCalculations.ts',
    'src/main/services/llm/prompt.ts',
  ]
  return {
    ...baseline,
    kind: 'native-annotated-answer-20261005',
    candidate: 'D-A-prose-with-derived-arithmetic-only',
    createdAt: new Date().toISOString(),
    baselinePlan: { path: baselinePath, sha256: hash(baselineBytes) },
    limitation:
      'Six previously observed DEV cases. A system and original prompt framing unchanged; only the same deterministic arithmetic annotations used in C are appended. No structured grammar, source oracle, retries or semantic verification claim.',
    sourceHashes: Object.fromEntries(
      await Promise.all(sourcePaths.map(async (path) => [path, hash(await readFile(path))])),
    ),
    compiledBuildHashes,
    buildProvenance: await inspectBuildProvenance(),
    cases,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const baseline = process.argv[2]
  const output = process.argv[3]
  if (!baseline || !output)
    throw new Error('Usage: tsx annotatedDiagnostic20261005.ts <frozen-A-plan> <new-D-plan>')
  await writeFile(
    output,
    JSON.stringify(await prepareAnnotatedDiagnostic20261005(baseline), null, 2) + '\n',
    { flag: 'wx' },
  )
}
