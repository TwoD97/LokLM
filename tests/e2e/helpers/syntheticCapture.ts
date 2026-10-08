import type { ElectronApplication } from '@playwright/test'
import type { RetrievalHit } from '../../../src/shared/documents'
import { join, resolve } from 'node:path'
import { buildCheckedContextBundle } from '../../../src/main/services/qa/checkedAnswer'
import { conflictSummarySchema } from '../../../src/main/services/qa/conflictSummary'
import {
  installSyntheticWorkerObserver,
  sanitizeSyntheticEvidence,
} from '../../evals/native-calibration/syntheticWorkerCapture'

type Controller = ReturnType<typeof installSyntheticWorkerObserver>
type State = typeof globalThis & { __loklmSyntheticWorkerObserver?: Controller }

export async function installCalibrationWorkerCapture(
  app: ElectronApplication,
  userDataDir: string,
) {
  const admissionSources: RetrievalHit[] = [
    {
      document_id: 1,
      chunk_id: 1,
      document_title: 'Admission fixture',
      text: 'An inert synthetic source.',
      ordinal: 0,
      page_from: null,
      page_to: null,
      heading_path: null,
      language: 'en',
      score: 1,
    },
  ]
  const plan = buildCheckedContextBundle(
    'Synthetic observer admission only.',
    admissionSources,
    'en',
  ).comparisonPlan
  const summaryPlan = buildCheckedContextBundle(
    'Synthetic observer admission only. Answer in one short sentence.',
    admissionSources,
    'en',
  ).comparisonPlan
  const expectedSummaryMaximum = 512
  const expectedSummarySchema = conflictSummarySchema(['1:1'])
  const summarySchema = summaryPlan?.jsonSchema as
    | {
        properties?: {
          result?: {
            oneOf?: Array<{
              properties?: { summary?: unknown }
            }>
          }
        }
      }
    | undefined
  if (
    !plan ||
    !summaryPlan ||
    plan.comparisonMode !== 'full' ||
    summaryPlan.comparisonMode !== 'summary' ||
    plan.summaryMaxCodePoints !== null ||
    summaryPlan.summaryMaxCodePoints !== expectedSummaryMaximum ||
    JSON.stringify(summarySchema?.properties?.result?.oneOf?.[1]?.properties?.summary) !==
      JSON.stringify(expectedSummarySchema) ||
    plan.conciseUnitCount !== 0 ||
    summaryPlan.conciseUnitCount !== 0 ||
    (plan.conciseFallbackReason ?? null) !== null ||
    (summaryPlan.conciseFallbackReason ?? null) !== null
  )
    throw new Error('Synthetic capture schema unavailable')
  return app.evaluate(
    ({ utilityProcess }, args) => {
      if (process.env.NODE_ENV !== 'test' || process.env.LOKLM_DATA_DIR !== args.vaultDir)
        throw new Error('Synthetic capture requires the owned test profile')
      const state = globalThis as State
      if (state.__loklmSyntheticWorkerObserver)
        throw new Error('Synthetic observer already installed')
      // Both functions are trusted test code; neither string contains model or source data.
      const sanitize = (0, eval)(`(${args.sanitize})`) as typeof sanitizeSyntheticEvidence
      const install = (0, eval)(`(${args.install})`) as typeof installSyntheticWorkerObserver
      state.__loklmSyntheticWorkerObserver = install(
        utilityProcess as never,
        sanitize,
        args.options,
      )
      return state.__loklmSyntheticWorkerObserver.status()
    },
    {
      vaultDir: join(userDataDir, 'vault'),
      sanitize: sanitizeSyntheticEvidence.toString(),
      install: installSyntheticWorkerObserver.toString(),
      options: {
        workerPath: resolve('out/main/modelsWorker.js'),
        expectedSchemaJson: JSON.stringify(plan.jsonSchema),
        alternateExpectedSchemaJson: JSON.stringify(summaryPlan.jsonSchema),
        normalizeSourceEnum: true,
        captureSourceLabelShapes: true,
      },
    },
  )
}

export async function armCalibrationWorkerCapture(app: ElectronApplication, caseId: string) {
  const settled = await settleCalibrationWorkerCapture(app)
  return app.evaluate(
    (_electron, input) => {
      const observer = (globalThis as State).__loklmSyntheticWorkerObserver
      if (!observer) return { armed: false, reason: 'not-installed', prior: input.prior }
      const status = observer.status()
      if (status.pending || status.disposed || status.workers < 1 || status.observerErrors)
        return { armed: false, reason: 'observer-unavailable', status, prior: input.prior }
      observer.arm(input.caseId)
      return { armed: true, status: observer.status(), prior: input.prior }
    },
    { caseId, prior: settled },
  )
}

/** Wait for the passive RPC observer after terminal IPC; never change app outcome. */
export async function settleCalibrationWorkerCapture(app: ElectronApplication, timeoutMs = 3000) {
  const started = Date.now()
  const result = await app.evaluate(async (_electron, limit) => {
    const observer = (globalThis as State).__loklmSyntheticWorkerObserver
    if (!observer) return { status: null, rows: [] }
    observer.disarm()
    const until = Date.now() + limit
    while (observer.status().pending && Date.now() < until)
      await new Promise((done) => setTimeout(done, 25))
    return { status: observer.status(), rows: observer.drain() }
  }, timeoutMs)
  return { ...result, settleMs: Date.now() - started }
}

export async function disposeCalibrationWorkerCapture(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = globalThis as State
    const observer = state.__loklmSyntheticWorkerObserver
    if (!observer) return { status: null, rows: [] }
    observer.dispose()
    const result = { status: observer.status(), rows: observer.drain() }
    delete state.__loklmSyntheticWorkerObserver
    return result
  })
}
