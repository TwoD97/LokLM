import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Api } from '../../src/preload'
import type { StreamEvent, SystemInfo } from '../../src/shared/documents'
import { launchApp } from './helpers/launch'
import { createWorkspace, registerAndUnlock } from './helpers/seed'
import { fingerprintCompiledBuild } from './helpers/buildFingerprint'
import { describeBoundedThoughts } from '../evals/native-calibration/boundedThoughts'

// Requires a built bounded-thought candidate and an exclusive GPU grant.
// LOKLM_NATIVE_BOUNDED_LIFECYCLE=1 LOKLM_RETRIEVAL_TRACE=1
// LOKLM_EVIDENCE_ASSESSMENT=0 LOKLM_TIER=standard LOKLM_LLM_CONTEXT_SIZE=8192
// No traces/screenshots or recovery material are retained.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

type Terminal = Extract<StreamEvent, { type: 'done' | 'error' }>
interface TurnSnapshot {
  events: StreamEvent[]
  settled: boolean
  reply?: Terminal
  rejection?: string
}
interface HarnessGlobal {
  api: Api
  boundedLifecycle: Record<string, TurnSnapshot & { off: () => void }>
}

const WORKSPACE = 'Synthetic bounded lifecycle'
const QUESTION =
  'What is the approved Quay Library Monday opening time? Answer in one short sentence.'
// Long synthetic question expands only the cancelled prefill; reuse asks the
// short real source question. Its labels carry no authority or private data.
const PREFILL_QUESTION =
  QUESTION +
  '\nSynthetic reference labels: ' +
  Array.from({ length: 300 }, (_, index) => 'reference label ' + index + ' unchanged.').join(' ')
const SOURCES = [
  {
    name: 'Approved Monday schedule.txt',
    text: 'Quay Library approved Monday schedule.\nThe Quay Library opens at 09:00 on Monday and closes at 17:00. This schedule is approved.\n',
  },
  {
    name: 'Proposed Monday schedule.txt',
    text: 'Quay Library proposed Monday schedule.\nThe proposal is to open the Quay Library at 10:00 on Monday and close at 18:00. This proposal has not been approved and does not replace the approved Monday schedule.\n',
  },
]

async function startTurn(
  page: Page,
  streamId: string,
  workspaceId: number,
  documentIds: number[],
  question = QUESTION,
): Promise<number> {
  return page.evaluate(
    async ({ streamId, workspaceId, documentIds, question }) => {
      const globals = globalThis as unknown as HarnessGlobal
      globals.boundedLifecycle ??= {}
      const conversation = await globals.api.conversations.create(workspaceId, streamId)
      const state: TurnSnapshot & { off: () => void } = {
        events: [],
        settled: false,
        off: () => undefined,
      }
      globals.boundedLifecycle[streamId] = state
      state.off = globals.api.chat.onEvent(streamId, (event) => state.events.push(event))
      void globals.api.chat
        .stream(streamId, workspaceId, question, {
          conversationId: conversation.id,
          language: 'en',
          topK: 2,
          activeDocumentIds: documentIds,
          multiQuery: false,
          contextualize: false,
          routing: false,
          rerank: false,
          wholeDocFallback: false,
        })
        .then(
          (reply) => {
            if (reply) state.reply = reply
          },
          (error: unknown) => {
            state.rejection = error instanceof Error ? error.message : String(error)
          },
        )
        .finally(() => {
          state.settled = true
        })
      return conversation.id
    },
    { streamId, workspaceId, documentIds, question },
  )
}

function snapshot(page: Page, streamId: string): Promise<TurnSnapshot> {
  return page.evaluate((id) => {
    const { events, settled, reply, rejection } = (globalThis as unknown as HarnessGlobal)
      .boundedLifecycle[id]!
    return {
      events,
      settled,
      ...(reply ? { reply } : {}),
      ...(rejection ? { rejection } : {}),
    }
  }, streamId)
}

async function waitForTerminal(
  page: Page,
  streamId: string,
  timeout: number,
  locked = false,
): Promise<TurnSnapshot> {
  // The invoke response can arrive before the event on its separate channel.
  await expect
    .poll(
      async () => {
        const result = await snapshot(page, streamId)
        return (
          result.settled &&
          result.events.some((event) => event.type === 'done' || event.type === 'error')
        )
      },
      { timeout, intervals: [100, 250, 500] },
    )
    .toBe(true)
  const result = await snapshot(page, streamId)
  const terminals = result.events.filter((event) => event.type === 'done' || event.type === 'error')
  expect(terminals).toHaveLength(1)
  if (locked) {
    // Private IPC admission retires the invoke response after vault lock. The
    // push channel still sends one deliberately empty cancellation terminal.
    expect(result.rejection).toMatch(/\bLockedError\b|(?:^|:\s*)locked$/i)
    expect(result.reply).toBeUndefined()
  } else {
    expect(result.rejection).toBeUndefined()
    expect(result.reply).toEqual(terminals[0])
  }
  return result
}

async function residentChat(page: Page, expectedModelPath?: string): Promise<SystemInfo> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const api = (globalThis as unknown as { api: Api }).api
          const status = await api.llm.status()
          return status.state === 'ready' && status.resident === true
        }),
      { timeout: 180_000, intervals: [500, 1000] },
    )
    .toBe(true)
  const info = await page.evaluate(() => (globalThis as unknown as { api: Api }).api.llm.info())
  expect(info.resolvedPlacement).toBe('gpu')
  expect(info.profile).toBe('full')
  expect(info.selectedProfile).toBe('full')
  expect(info.modelCapacity?.contextSize).toBe(8192)
  expect(info.modelName).toMatch(/^Qwen3\.5-4B.*\.gguf$/i)
  if (expectedModelPath) expect(info.modelPath).toBe(expectedModelPath)
  return info
}

function assertCancelled(result: TurnSnapshot, locked: boolean): void {
  expect(result.events.filter((event) => event.type === 'token')).toEqual([])
  expect(result.events.filter((event) => event.type === 'error')).toEqual([])
  expect(result.events.filter((event) => event.type === 'done')).toEqual([
    {
      type: 'done',
      full_text: locked ? '' : '_[Answer interrupted.]_',
      // Ordinary Stop retains retrieved sources for inspecting the interrupted
      // turn; vault lock suppresses all private payload in its terminal event.
      citations: locked
        ? []
        : result.events.flatMap((event) =>
            event.type === 'citation'
              ? [{ doc_id: event.doc_id, chunk_id: event.chunk_id, score: event.score }]
              : [],
          ),
      outcome: 'cancelled',
    },
  ])
  expect(
    result.events.some(
      (event) => event.type === 'stage' && event.stage === 'evidence' && event.status === 'done',
    ),
  ).toBe(false)
}

function assertPartialPrefill(observed: ReturnType<typeof describeBoundedThoughts>): void {
  expect(observed.activeLogged).toBe(true)
  expect(observed.unsupportedWrapperLogged).toBe(false)
  expect(observed.setupFailedLogged).toBe(false)
  expect(observed.malformedStatusLogs).toBe(0)
  expect(observed.malformedMetricsLogs).toBe(0)
  const metrics = observed.metrics.filter((entry) => entry.cancelled).at(-1)
  expect(metrics).toBeDefined()
  if (!metrics) throw new Error('Missing cancelled bounded-generation metrics.')
  expect(metrics.route).toBe('main')
  expect(metrics.boundedThoughts.prefillBatches).toBeGreaterThan(0)
  expect(metrics.boundedThoughts.prefillTokens).toBeGreaterThan(0)
  // The final prompt token belongs to the first sampling call. A completed
  // prefix is promptTokens - 1, so merely comparing with promptTokens would
  // also admit cancellation during first-token decoding after full prefill.
  expect(metrics.boundedThoughts.prefillTokens).toBeLessThan(
    metrics.boundedThoughts.promptTokens - 1,
  )
  expect(metrics.boundedThoughts.thoughtTokens).toBe(0)
  expect(metrics.boundedThoughts.visibleTokens).toBe(0)
  expect(metrics.boundedThoughts.combinedTokens).toBe(0)
}

test('bounded thoughts stop during partial prefill, reuse the worker, and retire on vault lock', async () => {
  test.skip(
    process.env['LOKLM_NATIVE_BOUNDED_LIFECYCLE'] !== '1',
    'Requires installed models, a bounded-thought build, and exclusive GPU access',
  )
  test.setTimeout(660_000)
  expect(process.env['LOKLM_EVIDENCE_ASSESSMENT']).toBe('0')
  expect(process.env['LOKLM_RETRIEVAL_TRACE']).toBe('1')
  expect(process.env['LOKLM_TIER']).toBe('standard')
  const requestedContext = Number(process.env['LOKLM_LLM_CONTEXT_SIZE'])
  expect(requestedContext).toBe(8192)
  const output = process.env['LOKLM_NATIVE_BOUNDED_LIFECYCLE_OUTPUT']
    ? resolve(process.env['LOKLM_NATIVE_BOUNDED_LIFECYCLE_OUTPUT'])
    : test.info().outputPath('bounded-lifecycle')
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output) // Never overwrite an earlier native run.
  const compiledHashes = await fingerprintCompiledBuild()
  const report: {
    startedAt: string
    requestedContext: number
    configuration: {
      tier: 'standard'
      selectedProfile: 'full'
      maxBoundedThoughtTokens: 128
      purpose: string
    }
    model?: { path: string; sha256: string }
    compiledHashes: Record<string, string>
    phases: Array<Record<string, unknown>>
    completedAt?: string
    failure?: string
  } = {
    startedAt: new Date().toISOString(),
    requestedContext,
    configuration: {
      tier: 'standard',
      selectedProfile: 'full',
      maxBoundedThoughtTokens: 128,
      purpose:
        'Partial-prefill Stop and same-worker reuse, followed by vault-lock retirement; not answer-quality evidence.',
    },
    compiledHashes,
    phases: [],
  }
  let logs = ''
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined
  const flush = () =>
    Promise.all([
      writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n'),
      writeFile(join(output, 'app.log'), logs),
    ])
  try {
    launched = await launchApp()
    const { app, page, userDataDir } = launched
    const recordLog = (data: unknown): void => {
      logs += String(data)
    }
    app.process().stdout?.on('data', recordLog)
    app.process().stderr?.on('data', recordLog)
    await registerAndUnlock(page, 'Bounded lifecycle test')
    const initialWorkspaces = await page.evaluate(() =>
      (globalThis as unknown as { api: Api }).api.workspaces.list(),
    )
    if (initialWorkspaces.length > 0)
      await expect(page.locator('.library')).toBeVisible({ timeout: 120_000 })
    const workspaceId = await createWorkspace(page, WORKSPACE)
    await page.evaluate(async (id) => {
      const api = (globalThis as unknown as { api: Api }).api
      await api.settings.update({
        basic: { language: 'en', answerLanguage: 'en', startView: 'library', llmProfile: 'full' },
        // Exercise explicit lock below, not an unrelated idle-timer expiry.
        security: { autoLockMinutes: 0 },
      })
      await api.workspaces.setDefault(id)
    }, workspaceId)
    // Refresh the shell's workspace list from our seeded default. API creation
    // alone does not update the mounted shell's selection.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: WORKSPACE, exact: true })).toBeVisible(
      { timeout: 180_000 },
    )
    const initialInfo = await residentChat(page)
    const modelPath = initialInfo.modelPath
    if (!modelPath) throw new Error('Native lifecycle test requires a resolved bundled model path.')
    const modelHash = createHash('sha256')
    for await (const chunk of createReadStream(modelPath)) modelHash.update(chunk)
    report.model = { path: modelPath, sha256: modelHash.digest('hex') }
    report.phases.push({ phase: 'full-at-8k-startup', info: initialInfo })
    const documentIds: number[] = []
    for (const source of SOURCES) {
      const path = join(userDataDir, source.name)
      await writeFile(path, source.text)
      const document = await page.evaluate(
        ({ workspaceId, path }) =>
          (globalThis as unknown as { api: Api }).api.documents.import(workspaceId, path),
        { workspaceId, path },
      )
      documentIds.push(document.id)
    }
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const api = (globalThis as unknown as { api: Api }).api
            const documents = await api.documents.list(id)
            return (
              documents.length === 2 &&
              documents.every(
                (document) => document.status === 'ready' && document.chunkCount === 1,
              ) &&
              (await api.models.activity()).phase === 'idle'
            )
          }, workspaceId),
        { timeout: 180_000, intervals: [500, 1000] },
      )
      .toBe(true)

    const rawStarts = () =>
      (logs.match(/llm\.boundedThoughts: \{"status":"active","maxThoughtTokens":128\}/g) ?? [])
        .length
    const beginBoundedPrefill = async (streamId: string): Promise<number> => {
      const starts = rawStarts()
      const id = await startTurn(page, streamId, workspaceId, documentIds, PREFILL_QUESTION)
      await expect
        .poll(
          async () => {
            const turn = await snapshot(page, streamId)
            return turn.events.some(
              (event) =>
                event.type === 'stage' && event.stage === 'evidence' && event.status === 'start',
            )
          },
          { timeout: 180_000, intervals: [100, 250] },
        )
        .toBe(true)
      // Stage start alone precedes native dispatch. Observe the actual native
      // prompt start too, so this cannot pass by only cancelling preflight.
      await expect.poll(rawStarts, { timeout: 30_000, intervals: [10, 20] }).toBe(starts + 1)
      const active = await snapshot(page, streamId)
      expect(active.settled).toBe(false)
      expect(active.events.filter((event) => event.type === 'token')).toEqual([])
      expect(
        new Set(
          active.events.flatMap((event) => (event.type === 'citation' ? [event.doc_id] : [])),
        ),
      ).toEqual(new Set(documentIds))
      return id
    }
    const savedTurn = (id: number) =>
      page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.conversations.getWithMessages(id),
        id,
      )
    const assertReuse = async (streamId: string): Promise<void> => {
      const logOffset = logs.length
      const id = await startTurn(page, streamId, workspaceId, [documentIds[0]!])
      const result = await waitForTerminal(page, streamId, 180_000)
      expect(result.reply).toMatchObject({ type: 'done', outcome: 'completed' })
      expect(result.reply && 'full_text' in result.reply ? result.reply.full_text : '').toMatch(
        /\b(?:0?9[:.]00|9\s*a\.?m\.?|nine)\b/i,
      )
      // The checked path also runs on reuse. No worker restart may conceal
      // a broken sequence after Stop; lock below must create a new worker.
      expect(
        result.events.some((event) => event.type === 'stage' && event.stage === 'evidence'),
      ).toBe(true)
      await expect
        .poll(() => describeBoundedThoughts([logs.slice(logOffset)]).metrics.length, {
          timeout: 60_000,
        })
        .toBe(1)
      const metrics = describeBoundedThoughts([logs.slice(logOffset)])
      expect(metrics.activeLogged).toBe(true)
      expect(metrics.statuses).toContainEqual({ status: 'active', maxThoughtTokens: 128 })
      expect(metrics.unsupportedWrapperLogged).toBe(false)
      expect(metrics.setupFailedLogged).toBe(false)
      expect(metrics.malformedStatusLogs).toBe(0)
      expect(metrics.malformedMetricsLogs).toBe(0)
      expect(metrics.metrics[0]).toMatchObject({
        route: 'main',
        cancelled: false,
      })
      expect(metrics.metrics[0]!.completionReason).toMatch(/^(?:eogToken|stopGenerationTrigger)$/)
      expect(metrics.metrics[0]!.boundedThoughts.visibleTokens).toBeGreaterThan(0)
      const source = result.events.find(
        (event) => event.type === 'citation' && event.doc_id === documentIds[0],
      )
      expect(source?.type).toBe('citation')
      if (!source || source.type !== 'citation')
        throw new Error('Missing approved source citation.')
      expect(result.reply?.full_text).toContain(`[doc:${source.doc_id}, chunk:${source.chunk_id}]`)
      expect(result.reply?.citations).toContainEqual({
        doc_id: source.doc_id,
        chunk_id: source.chunk_id,
        score: source.score,
      })
      const persisted = await savedTurn(id)
      expect(persisted.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(persisted.messages[1]!.content).toBe(result.reply?.full_text)
      report.phases.push({
        phase: streamId,
        metrics,
        result,
        persisted,
        info: await residentChat(page, modelPath),
      })
      await flush()
    }

    const workersBeforeStop = (logs.match(/modelsWorker ready/g) ?? []).length
    expect(workersBeforeStop).toBeGreaterThan(0)
    const cancelConversation = await beginBoundedPrefill('evidence-cancel')
    const cancelAt = Date.now()
    await page.evaluate(() =>
      (globalThis as unknown as { api: Api }).api.chat.cancel('evidence-cancel'),
    )
    const cancelled = await waitForTerminal(page, 'evidence-cancel', 60_000)
    assertCancelled(cancelled, false)
    const persistedCancel = await savedTurn(cancelConversation)
    expect(persistedCancel.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(persistedCancel.messages[1]!.content).toBe('_[Answer interrupted.]_')
    expect(persistedCancel.messages[1]!.pipeline).toContainEqual({
      stage: 'evidence',
      status: 'running',
    })
    expect(
      persistedCancel.messages[1]!.citations.map((citation) => citation.chunkId).sort(),
    ).toEqual(
      cancelled.events
        .flatMap((event) => (event.type === 'citation' ? [event.chunk_id] : []))
        .sort(),
    )
    await expect
      .poll(() => logs, { timeout: 60_000 })
      .toMatch(/llm\.generateRaw finished: task=utility elapsedMs=\d+ cancelled=true/)
    const cancelledMetrics = describeBoundedThoughts([logs])
    report.phases.push({
      phase: 'cancel',
      metrics: cancelledMetrics,
      elapsedMs: Date.now() - cancelAt,
      result: cancelled,
      persisted: persistedCancel,
    })
    // Require observed partial native prefill, not a timing assumption.
    assertPartialPrefill(cancelledMetrics)
    await assertReuse('reuse-after-cancel')
    expect((logs.match(/modelsWorker ready/g) ?? []).length).toBe(workersBeforeStop)
    // Keep old listeners alive through another native turn, detecting late
    // content or duplicate terminals instead of merely sleeping for a deadline.
    expect(await snapshot(page, 'evidence-cancel')).toEqual(cancelled)

    const lockedConversation = await beginBoundedPrefill('evidence-lock')
    const workersBeforeLock = (logs.match(/modelsWorker ready/g) ?? []).length
    const lockAt = Date.now()
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    const locked = await waitForTerminal(page, 'evidence-lock', 60_000, true)
    assertCancelled(locked, true)
    expect(
      await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.status()),
    ).toMatchObject({ locked: true })
    expect(
      await page.evaluate(() => (globalThis as unknown as { api: Api }).api.llm.status()),
    ).toMatchObject({ resident: false })
    report.phases.push({ phase: 'lock', elapsedMs: Date.now() - lockAt, result: locked })
    await flush()
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { api: Api }).api.auth.login('Demo-Vault-2026!'),
      ),
    ).toEqual({ ok: true })
    await residentChat(page, modelPath)
    // Wait for the shell's own activation before issuing new workspace work.
    await expect(page.locator('.library')).toBeVisible({ timeout: 120_000 })
    await expect(
      page.getByRole('heading', { level: 1, name: WORKSPACE, exact: true }),
    ).toBeVisible()
    const persistedLock = await savedTurn(lockedConversation)
    expect(persistedLock.messages.map((message) => message.role)).toEqual(['user'])
    expect((logs.match(/modelsWorker ready/g) ?? []).length).toBeGreaterThan(workersBeforeLock)
    await assertReuse('reuse-after-unlock')
    expect(await snapshot(page, 'evidence-lock')).toEqual(locked)
    expect(await snapshot(page, 'evidence-cancel')).toEqual(cancelled)
    expect(await fingerprintCompiledBuild()).toEqual(compiledHashes)
    report.phases.push({ phase: 'retired-lock-persistence', persisted: persistedLock })
    report.completedAt = new Date().toISOString()
  } catch (error) {
    report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error)
    throw error
  } finally {
    try {
      if (launched) {
        await launched.page
          .evaluate(() => {
            const state = (globalThis as unknown as Partial<HarnessGlobal>).boundedLifecycle
            for (const turn of Object.values(state ?? {})) turn.off()
          })
          .catch(() => undefined)
        await launched.cleanup()
      }
    } finally {
      await flush()
    }
  }
})
