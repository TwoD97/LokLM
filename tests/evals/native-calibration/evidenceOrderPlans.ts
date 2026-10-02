import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { RetrievalHit } from '../../../src/shared/documents'
import {
  parseEvidenceAssessment,
  planEvidenceAssessment,
} from '../../../src/main/services/qa/evidenceAssessment'
import { loadCalibrationSplit } from './fixtures'

const assessedSource = 'src/main/services/qa/evidenceAssessment.ts'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const { selectEvidenceCases } = createRequire(import.meta.url)(
  '../../bench/evidence-selection.cjs',
) as {
  selectEvidenceCases: <T extends { caseId: string; order: string }>(
    plans: T[],
    selection?: string,
  ) => { selectedCases: string[]; unrequestedCases: string[]; cases: T[] }
}

/** Exact supplied-hit perturbations; duplicates retain their text and get new IDs. */
export function evidenceOrderVariants(a: RetrievalHit, b: RetrievalHit) {
  const duplicate = (hit: RetrievalHit, id: number): RetrievalHit => ({
    ...hit,
    document_id: id,
    chunk_id: id,
  })
  const nextId = Math.max(a.document_id, a.chunk_id, b.document_id, b.chunk_id) + 100
  return [
    { order: 'A-B', hits: [a, b] },
    { order: 'B-A', hits: [b, a] },
    { order: 'A-B-Acopy', hits: [a, b, duplicate(a, nextId)] },
    { order: 'B-A-Bcopy', hits: [b, a, duplicate(b, nextId + 1)] },
  ]
}

export async function prepareEvidenceOrderPlans() {
  const manifest = await loadCalibrationSplit('authority-dev-20261002')
  const requestedContext = 8192
  const cases = []
  for (const caseId of ['authority-dev-01', 'authority-dev-03']) {
    const entry = manifest.cases.find((candidate) => candidate.id === caseId)!
    const hits = await Promise.all(
      entry.requiredSourceKeys.map(async (key) => {
        const source = manifest.sources.find((candidate) => candidate.key === key)!
        const id = manifest.sources.indexOf(source) + 1
        return {
          document_id: id,
          chunk_id: id,
          document_title: source.title,
          ordinal: 0,
          page_from: null,
          page_to: null,
          heading_path: null,
          language: 'en' as const,
          text: await readFile(source.absolutePath, 'utf8'),
          score: 1,
        }
      }),
    )
    if (hits.length !== 2) throw new Error('Order probe requires exactly two original sources')
    for (const variant of evidenceOrderVariants(hits[0]!, hits[1]!)) {
      const plan = planEvidenceAssessment(entry.question, variant.hits, requestedContext)
      if (!plan) throw new Error(`Assessment plan does not fit: ${caseId}/${variant.order}`)
      cases.push({ caseId, question: entry.question, ...variant, plan })
    }
  }
  return {
    schemaVersion: 1,
    kind: 'native-evidence-order-plans',
    createdAt: new Date().toISOString(),
    requestedContext,
    modelFile: 'models/Qwen3.5-4B-Q4_K_M.gguf',
    sourceHashes: Object.fromEntries(
      await Promise.all(
        [
          assessedSource,
          'src/main/services/llm/prompt.ts',
          'src/main/services/workers/chatWrapper.ts',
        ].map(async (path) => [path, hash(await readFile(path))]),
      ),
    ),
    cases,
  }
}

async function main() {
  const [mode, input, output] = process.argv.slice(2)
  if (mode === '--prepare' && input && !output) {
    const prepared = await prepareEvidenceOrderPlans()
    prepared.sourceHashes['out/main/modelsWorker.js'] = hash(
      await readFile('out/main/modelsWorker.js'),
    )
    await writeFile(input, JSON.stringify(prepared, null, 2) + '\n', {
      flag: 'wx',
    })
    return
  }
  if (mode === '--report' && input && output) {
    const raw = JSON.parse(await readFile(input, 'utf8')) as {
      prepared: Awaited<ReturnType<typeof prepareEvidenceOrderPlans>>
      configuration?: { selectedCases?: string[]; unrequestedCases?: string[] }
      observations: Array<{ caseId: string; order: string; raw?: string; error?: string }>
    }
    if (hash(await readFile(assessedSource)) !== raw.prepared.sourceHashes[assessedSource])
      throw new Error('Assessment parser changed after the prepared experiment')
    const selection = selectEvidenceCases(
      raw.prepared.cases,
      raw.configuration?.selectedCases?.join(','),
    )
    const observed = new Set(raw.observations.map((entry) => `${entry.caseId}/${entry.order}`))
    if ([...observed].some((id) => !selection.selectedCases.includes(id)))
      throw new Error('Observation was not in the selected case/order list')
    const observations = raw.observations.map((observation) => {
      const plan = raw.prepared.cases.find(
        (entry) => entry.caseId === observation.caseId && entry.order === observation.order,
      )
      if (!plan) throw new Error('Unknown order observation')
      const parsed = observation.raw ? parseEvidenceAssessment(observation.raw, plan.hits) : null
      return { ...observation, parsed, parseAccepted: !!parsed, manualSemanticReviewRequired: true }
    })
    await writeFile(
      output,
      JSON.stringify(
        {
          kind: 'native-evidence-order-review',
          configuration: {
            selectedCases: selection.selectedCases,
            unrequestedCases: selection.unrequestedCases,
          },
          unobservedSelectedCases: selection.selectedCases.filter((id) => !observed.has(id)),
          limitation:
            'Fixed-context model assessment only, not retrieval or final-answer quality. Exact quote and source membership do not establish entailment, authority, or correct conflict classification. Duplicates are intentionally separate source IDs with identical text.',
          observations,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    )
    return
  }
  throw new Error('Use --prepare plans.json OR --report raw.json review.json')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()
