import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RetrievalHit } from '../../../src/shared/documents'
import { findCitationMatches } from '../../../src/shared/citationMarkers'
import { estimateTokens } from '../../../src/main/services/llm/prompt'
import { fingerprintCompiledBuild } from '../../e2e/helpers/buildFingerprint'
import { inspectBuildProvenance } from '../../e2e/helpers/buildProvenance'
import type { prepareAnnotatedDiagnostic20261005 } from './annotatedDiagnostic20261005'

export const ORDERED_ANSWER_INSTRUCTION =
  'Return JSON with exactly "check" followed by "answer". First write one short comparison or calculation (at most 240 characters) checking the conclusion against the question and supplied context. Then write the final answer in the requested language and format with the exact citation markers required above. The check is internal and is not part of the final answer; every requested fact and its supporting citation must appear in answer. Output JSON only.'

export const ORDERED_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    check: { type: 'string', minLength: 1, maxLength: 240 },
    answer: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  required: ['check', 'answer'],
  additionalProperties: false,
}

/** Mechanical parse only; neither the check nor the final answer is verified. */
export function parseOrderedAnswer20261005(
  raw: string,
  hits: readonly Pick<RetrievalHit, 'document_id' | 'chunk_id'>[],
): { check: string; answer: string } | null {
  if (raw.length > 12_000) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (
    Object.keys(data).length !== 2 ||
    typeof data.check !== 'string' ||
    typeof data.answer !== 'string' ||
    !data.check.trim() ||
    !data.answer.trim() ||
    Array.from(data.check).length > 240 ||
    Array.from(data.answer).length > 2000
  )
    return null
  // The accepted shape has only two string values. Count original property
  // tokens before JSON's last-value-wins behavior can conceal duplicate keys.
  const keys: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '"') continue
    const start = i++
    while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1
    let after = i + 1
    while (after < raw.length && /\s/u.test(raw[after]!)) after++
    if (raw[after] === ':') keys.push(JSON.parse(raw.slice(start, i + 1)) as string)
  }
  if (keys.length !== 2 || keys[0] !== 'check' || keys[1] !== 'answer') return null
  const supplied = new Set(hits.map((hit) => `${hit.document_id}:${hit.chunk_id}`))
  if (
    findCitationMatches(data.answer).some(
      (marker) => !supplied.has(`${marker.documentId}:${marker.chunkId}`),
    ) ||
    /#cite-/iu.test(data.answer)
  )
    return null
  return { check: data.check, answer: data.answer }
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export async function prepareOrderedDiagnostic20261005(baselinePath: string) {
  const baselineBytes = await readFile(baselinePath)
  const baseline = JSON.parse(baselineBytes.toString('utf8')) as Awaited<
    ReturnType<typeof prepareAnnotatedDiagnostic20261005>
  >
  if (baseline.kind !== 'native-annotated-answer-20261005' || baseline.cases.length !== 6)
    throw new Error('Expected the frozen six-case D plan')
  const compiledBuildHashes = await fingerprintCompiledBuild()
  if (JSON.stringify(compiledBuildHashes) !== JSON.stringify(baseline.compiledBuildHashes))
    throw new Error('Compiled worker changed since A/B/C/D')
  const cases = baseline.cases.map((entry) => {
    const systemPrompt = `${entry.plan.systemPrompt}\n${ORDERED_ANSWER_INSTRUCTION}`
    if (estimateTokens(entry.plan.prompt) + estimateTokens(systemPrompt) + 512 + 820 > 8192)
      throw new Error(`Complete original context cannot fit: ${entry.caseId}`)
    return {
      ...entry,
      arm: 'E',
      plan: { ...entry.plan, systemPrompt, jsonSchema: ORDERED_ANSWER_SCHEMA },
    }
  })
  const sourcePaths = [
    'tests/evals/native-calibration/orderedAnswer20261005.ts',
    'tests/bench/ordered-answer-20261005.cjs',
    'src/main/services/qa/sourceQuantities.ts',
    'src/main/services/qa/sourceCalculations.ts',
    'src/main/services/llm/prompt.ts',
    'src/shared/citationMarkers.ts',
  ]
  return {
    ...baseline,
    kind: 'native-ordered-answer-20261005',
    candidate: 'E-D-with-bounded-check-before-answer-only',
    createdAt: new Date().toISOString(),
    baselinePlan: { path: baselinePath, sha256: hash(baselineBytes) },
    limitation:
      'Six previously observed DEV cases. Exact D prompt/full context, system extended only by two-field comparison-before-answer instruction. Check is model-authored and not verified or shown as the final answer. No evidence selection, source rewriting, oracle filtering, retries or semantic verification claim.',
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
    throw new Error('Usage: tsx orderedAnswer20261005.ts <frozen-D-plan> <new-E-plan>')
  await writeFile(
    output,
    JSON.stringify(await prepareOrderedDiagnostic20261005(baseline), null, 2) + '\n',
    { flag: 'wx' },
  )
}
