import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sourceQuantityAnnotations } from '../../../src/main/services/qa/sourceQuantities'
import { sourceCalculationAnnotations } from '../../../src/main/services/qa/sourceCalculations'
import { fingerprintCompiledBuild } from '../../e2e/helpers/buildFingerprint'
import { inspectBuildProvenance } from '../../e2e/helpers/buildProvenance'
import type { prepareOrderedDiagnostic20261005 } from './orderedAnswer20261005'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Configuration repair only: leave all E source/question/prompt bytes intact. */
export async function prepareOrderedE2Diagnostic20261005(baselinePath: string) {
  const bytes = await readFile(baselinePath)
  const baseline = JSON.parse(bytes.toString('utf8')) as Awaited<
    ReturnType<typeof prepareOrderedDiagnostic20261005>
  >
  if (baseline.kind !== 'native-ordered-answer-20261005' || baseline.cases.length !== 6)
    throw new Error('Expected the frozen six-case E plan')
  const compiledBuildHashes = await fingerprintCompiledBuild()
  if (JSON.stringify(compiledBuildHashes) !== JSON.stringify(baseline.compiledBuildHashes))
    throw new Error('Compiled worker changed since A/B/C/D/E')
  const cases = baseline.cases.map((entry) => {
    const arithmetic = [
      sourceQuantityAnnotations(entry.hits).annotation,
      sourceCalculationAnnotations(entry.question, entry.hits).annotation,
    ]
      .filter(Boolean)
      .join('\n\n')
    if (!entry.plan.prompt.endsWith(`\n\nDerived arithmetic checks:\n${arithmetic}`))
      throw new Error(`Safety guard changes altered annotation bytes: ${entry.caseId}`)
    const jsonSchema = structuredClone(entry.plan.jsonSchema)
    // The installed native repeated-rule expansion rejects maxLength2000.
    // Keep minLength/type/native token bounds; the unchanged parser caps2000.
    const answer = {
      type: jsonSchema.properties.answer.type,
      minLength: jsonSchema.properties.answer.minLength,
    }
    return {
      ...entry,
      arm: 'E2',
      plan: {
        ...entry.plan,
        jsonSchema: { ...jsonSchema, properties: { ...jsonSchema.properties, answer } },
      },
    }
  })
  const sourcePaths = [
    'tests/evals/native-calibration/orderedAnswerE2_20261005.ts',
    'tests/evals/native-calibration/orderedAnswer20261005.ts',
    'tests/bench/ordered-answer-e2-20261005.cjs',
    'src/main/services/qa/sourceQuantities.ts',
    'src/main/services/qa/sourceCalculations.ts',
    'src/main/services/llm/prompt.ts',
    'src/shared/citationMarkers.ts',
  ]
  return {
    ...baseline,
    kind: 'native-ordered-answer-e2-20261005',
    candidate: 'E2-E-with-working-native-grammar',
    createdAt: new Date().toISOString(),
    baselinePlan: { path: baselinePath, sha256: hash(bytes) },
    limitation:
      'Configuration repair of E: only native answer.maxLength is omitted after a no-model grammar smoke. Same prompts/context/sampling, native check240/min1, strict final parser2000 and total512token limit. E aborted outputs remain configuration-invalid, not matched constrained results. Updated arithmetic rejection guards produce identical known-case annotations.',
    sourceHashes: Object.fromEntries(
      await Promise.all(sourcePaths.map(async (path) => [path, hash(await readFile(path))])),
    ),
    compiledBuildHashes,
    buildProvenance: await inspectBuildProvenance(),
    cases,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const baseline = process.argv[2],
    output = process.argv[3]
  if (!baseline || !output)
    throw new Error('Usage: tsx orderedAnswerE2_20261005.ts <frozen-E-plan> <new-E2-plan>')
  await writeFile(
    output,
    JSON.stringify(await prepareOrderedE2Diagnostic20261005(baseline), null, 2) + '\n',
    { flag: 'wx' },
  )
}
