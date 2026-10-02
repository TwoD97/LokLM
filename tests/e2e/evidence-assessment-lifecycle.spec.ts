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

// Source-only harness until an exclusive native slot is granted. Explicitly
// opt into both this test and the experimental production assessment branch:
// LOKLM_NATIVE_EVIDENCE_LIFECYCLE=1 LOKLM_EVIDENCE_ASSESSMENT=1
// LOKLM_TIER=standard LOKLM_LLM_CONTEXT_SIZE=8192 pnpm exec playwright test --config
// tests/e2e/playwright.config.ts evidence-assessment-lifecycle
// Registration discards recovery material inside the disposable renderer.
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
  evidenceLifecycle: Record<string, TurnSnapshot & { off: () => void }>
}

const WORKSPACE = 'Synthetic evidence lifecycle'
const QUESTION =
  'What is the approved Quay Library Monday opening time? Answer in one short sentence.'
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
): Promise<number> {
  return page.evaluate(
    async ({ streamId, workspaceId, documentIds, question }) => {
      const globals = globalThis as unknown as HarnessGlobal
      globals.evidenceLifecycle ??= {}
      const conversation = await globals.api.conversations.create(workspaceId, streamId)
      const state: TurnSnapshot & { off: () => void } = {
        events: [],
        settled: false,
        off: () => undefined,
      }
      globals.evidenceLifecycle[streamId] = state
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
    { streamId, workspaceId, documentIds, question: QUESTION },
  )
}

function snapshot(page: Page, streamId: string): Promise<TurnSnapshot> {
  return page.evaluate((id) => {
    const { events, settled, reply, rejection } = (globalThis as unknown as HarnessGlobal)
      .evidenceLifecycle[id]!
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

test('native evidence comparison cancels cleanly, releases FIFO, and retires on vault lock', async () => {
  test.skip(
    process.env['LOKLM_NATIVE_EVIDENCE_LIFECYCLE'] !== '1',
    'Requires installed models, an experimental assessment build, and exclusive GPU access',
  )
  test.setTimeout(660_000)
  expect(process.env['LOKLM_EVIDENCE_ASSESSMENT']).toBe('1')
  expect(process.env['LOKLM_TIER']).toBe('standard')
  const requestedContext = Number(process.env['LOKLM_LLM_CONTEXT_SIZE'])
  expect(requestedContext).toBe(8192)
  const output = process.env['LOKLM_NATIVE_EVIDENCE_LIFECYCLE_OUTPUT']
    ? resolve(process.env['LOKLM_NATIVE_EVIDENCE_LIFECYCLE_OUTPUT'])
    : test.info().outputPath('evidence-lifecycle')
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output) // Never overwrite an earlier native run.
  const compiledHashes = await fingerprintCompiledBuild()
  const report: {
    startedAt: string
    requestedContext: number
    configuration: { tier: 'standard'; selectedProfile: 'full'; purpose: string }
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
      purpose:
        'Separate lifecycle coverage of Full at an actual 8K context; not a matched quality comparison.',
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
    await registerAndUnlock(page, 'Evidence lifecycle test')
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

    const rawStarts = () => (logs.match(/llm\.generateRaw start: task=utility /g) ?? []).length
    const beginAssessment = async (streamId: string): Promise<number> => {
      const starts = rawStarts()
      const id = await startTurn(page, streamId, workspaceId, documentIds)
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
      await expect.poll(rawStarts, { timeout: 30_000, intervals: [50, 100] }).toBe(starts + 1)
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
      const id = await startTurn(page, streamId, workspaceId, [documentIds[0]!])
      const result = await waitForTerminal(page, streamId, 180_000)
      expect(result.reply).toMatchObject({ type: 'done', outcome: 'completed' })
      expect(result.reply && 'full_text' in result.reply ? result.reply.full_text : '').toMatch(
        /\b(?:0?9[:.]00|9\s*a\.?m\.?|nine)\b/i,
      )
      // One source does not invoke the experimental comparison again: this
      // checks the normal native FIFO/session remains usable after teardown.
      expect(
        result.events.some((event) => event.type === 'stage' && event.stage === 'evidence'),
      ).toBe(false)
      const persisted = await savedTurn(id)
      expect(persisted.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(persisted.messages[1]!.content).toBe(result.reply?.full_text)
      report.phases.push({
        phase: streamId,
        result,
        persisted,
        info: await residentChat(page, modelPath),
      })
      await flush()
    }

    const cancelConversation = await beginAssessment('evidence-cancel')
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
      .poll(() => logs)
      .toMatch(/llm\.generateRaw finished: task=utility elapsedMs=\d+ cancelled=true/)
    report.phases.push({
      phase: 'cancel',
      elapsedMs: Date.now() - cancelAt,
      result: cancelled,
      persisted: persistedCancel,
    })
    await assertReuse('reuse-after-cancel')
    // Keep old listeners alive through another native turn, detecting late
    // content or duplicate terminals instead of merely sleeping for a deadline.
    expect(await snapshot(page, 'evidence-cancel')).toEqual(cancelled)

    const lockedConversation = await beginAssessment('evidence-lock')
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
            const state = (globalThis as unknown as Partial<HarnessGlobal>).evidenceLifecycle
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
