import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planGroundedAnswer } from './prototypes/groundedAnswerPlan'
import { fingerprintCompiledBuild } from '../../e2e/helpers/buildFingerprint'
import { inspectBuildProvenance } from '../../e2e/helpers/buildProvenance'
import type { prepareReasoningDiagnostic20261005 } from './reasoningDiagnostic20261005'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Same six recorded full contexts; only the rejected C prototype planner changes. */
export async function prepareGroundedDiagnostic20261005(baselinePath: string) {
  const baselineBytes = await readFile(baselinePath)
  const baseline = JSON.parse(baselineBytes.toString('utf8')) as Awaited<
    ReturnType<typeof prepareReasoningDiagnostic20261005>
  >
  if (baseline.kind !== 'native-reasoning-answer-20261005' || baseline.cases.length !== 6)
    throw new Error('Expected the frozen six-case A plan')
  const compiledBuildHashes = await fingerprintCompiledBuild()
  if (JSON.stringify(compiledBuildHashes) !== JSON.stringify(baseline.compiledBuildHashes))
    throw new Error('Compiled worker changed since A/B')
  const cases = baseline.cases.map((entry) => {
    const plan = planGroundedAnswer(entry.question, entry.hits, entry.language, 8192)
    if (!plan) throw new Error(`Complete original context cannot fit: ${entry.caseId}`)
    return { ...entry, arm: 'C', plan }
  })
  const sourcePaths = [
    'tests/evals/native-calibration/groundedDiagnostic20261005.ts',
    'tests/bench/grounded-answer-20261005.cjs',
    'tests/evals/native-calibration/prototypes/groundedAnswerPlan.ts',
    'tests/evals/native-calibration/prototypes/groundedAnswer.ts',
    'src/main/services/qa/sourceQuantities.ts',
    'src/main/services/qa/sourceCalculations.ts',
    'src/main/services/llm/prompt.ts',
    'src/shared/citationMarkers.ts',
  ]
  return {
    ...baseline,
    kind: 'native-grounded-answer-20261005',
    candidate: 'C-bounded-grounded-answer-with-derived-arithmetic',
    createdAt: new Date().toISOString(),
    baselinePlan: { path: baselinePath, sha256: hash(baselineBytes) },
    limitation:
      'Six previously observed DEV cases. Same full recorded context, fixed order, compiled worker and model as A/B. C changes grammar bounds, evidence instructions and deterministic arithmetic annotations together; not an isolated arithmetic-effect experiment. Quote presence is not semantic entailment. No retry or oracle source filtering.',
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
    throw new Error('Usage: tsx groundedDiagnostic20261005.ts <frozen-A-plan> <new-C-plan>')
  await writeFile(
    output,
    JSON.stringify(await prepareGroundedDiagnostic20261005(baseline), null, 2) + '\n',
    { flag: 'wx' },
  )
}
