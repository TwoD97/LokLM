import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Api } from '../../src/preload'
import type { StreamEvent } from '../../src/shared/documents'
import { launchApp } from './helpers/launch'
import { createWorkspace, registerAndUnlock } from './helpers/seed'
import { fingerprintCompiledBuild } from './helpers/buildFingerprint'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

// A post-calibration lifecycle regression, not another held-out quality arm.
// Requires a rebuilt app and exclusive GPU access. Only the HTTP peer is fake;
// provider selection, retrieval, fallback, native inference and persistence are real.
test('LLM-only loopback Ollama HTTP 503 falls back to a fitting native 4K answer', async () => {
  test.skip(process.env['LOKLM_NATIVE_OLLAMA_FALLBACK'] !== '1', 'Explicit native/GPU opt-in')
  test.setTimeout(480_000)
  expect(
    Number(process.env['LOKLM_LLM_CONTEXT_SIZE']),
    'Set the native context target to 4096',
  ).toBe(4096)
  const output = process.env['LOKLM_NATIVE_OLLAMA_FALLBACK_OUTPUT']
    ? resolve(process.env['LOKLM_NATIVE_OLLAMA_FALLBACK_OUTPUT'])
    : test.info().outputPath('native-ollama-fallback')
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  const compiledHashes = await fingerprintCompiledBuild()
  const sourcePaths = [
    'src/main/services/workers/modelsWorker.ts',
    'src/main/services/workers/contextBudget.ts',
    'src/main/services/llm/LlamaService.ts',
    'src/main/services/providers/Registry.ts',
    'src/main/services/providers/ollama/OllamaLlmProvider.ts',
    'src/main/index.ts',
  ]
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ]),
    ),
  )
  const requests: Array<{
    method: string | undefined
    path: string | undefined
    authenticated: boolean
    context?: number
    outputLimit?: number
  }> = []
  const server = createServer(async (request, response) => {
    // Retain numeric budgeting metadata only, never source text or credentials.
    let body = ''
    for await (const chunk of request) {
      body += String(chunk)
      if (body.length > 512_000) {
        response.writeHead(413).end()
        return
      }
    }
    let options: { num_ctx?: number; num_predict?: number } | undefined
    try {
      options = (JSON.parse(body) as { options?: typeof options }).options
    } catch {
      // Any unexpected probe still receives the same deterministic server error.
    }
    requests.push({
      method: request.method,
      path: request.url,
      authenticated: request.headers.authorization !== undefined,
      ...(options?.num_ctx !== undefined ? { context: options.num_ctx } : {}),
      ...(options?.num_predict !== undefined ? { outputLimit: options.num_predict } : {}),
    })
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Synthetic local server unavailable' }))
  })
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolveListening()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No loopback HTTP port assigned')
  const baseUrl = `http://127.0.0.1:${address.port}`
  let logs = ''
  const report: Record<string, unknown> = {
    kind: 'post-calibration-native-fallback-regression',
    startedAt: new Date().toISOString(),
    requestedContext: 4096,
    compiledHashes,
    sourceHashes,
    requests,
  }
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    launched = await launchApp()
    const { app, page, userDataDir } = launched
    app.process().stdout?.on('data', (data) => (logs += String(data)))
    app.process().stderr?.on('data', (data) => (logs += String(data)))
    await registerAndUnlock(page, 'Local fallback regression')
    const workspaceId = await createWorkspace(page, 'Local fallback library')
    await page.evaluate(async (url) => {
      const api = (globalThis as unknown as { api: Api }).api
      await api.settings.update({
        basic: { language: 'en', answerLanguage: 'en' },
        advanced: {
          llm: { source: 'ollama' },
          embedder: { source: 'bundled' },
          reranker: { enabled: false, source: 'bundled' },
          ollama: {
            baseUrl: url,
            bearerToken: null,
            llmModel: 'synthetic-unavailable-chat',
            embedderModel: null,
            rerankerModel: null,
            allowRemoteOllama: false,
            requestTimeoutMs: 5000,
          },
        },
      })
    }, baseUrl)
    expect(
      await page.evaluate(() => (globalThis as unknown as { api: Api }).api.llm.status()),
    ).toMatchObject({ source: 'ollama', fallback: { active: false } })

    const source = join(userDataDir, 'Library.txt')
    await writeFile(
      source,
      'Library opening hours\nThe Riverside Library opens at 09:00 every Monday. It closes at 17:00.\n',
    )
    const document = await page.evaluate(
      ({ id, path }) => (globalThis as unknown as { api: Api }).api.documents.import(id, path),
      { id: workspaceId, path: source },
    )
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const api = (globalThis as unknown as { api: Api }).api
            const docs = await api.documents.list(id)
            return (
              docs.length === 1 &&
              docs[0]?.status === 'ready' &&
              (await api.models.activity()).phase === 'idle'
            )
          }, workspaceId),
        { timeout: 180_000 },
      )
      .toBe(true)
    report.before = await page.evaluate(() =>
      (globalThis as unknown as { api: Api }).api.llm.info(),
    )
    const started = Date.now()
    const answer = await page.evaluate(
      async ({ workspaceId, documentId }) => {
        const api = (globalThis as unknown as { api: Api }).api
        const conversation = await api.conversations.create(workspaceId)
        const events: StreamEvent[] = []
        const fallbacks: Array<{ kind: 'llm' | 'reranker'; reason: string }> = []
        const offFallback = api.providers.onFallback((event) => fallbacks.push(event))
        let finish!: () => void
        const terminal = new Promise<void>((resolveTerminal) => {
          finish = resolveTerminal
        })
        const streamId = 'native-ollama-http503'
        const off = api.chat.onEvent(streamId, (event) => {
          events.push(event)
          if (event.type === 'done' || event.type === 'error') finish()
        })
        let terminalTimer: ReturnType<typeof setTimeout> | undefined
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          void api.chat.cancel(streamId)
        }, 180_000)
        try {
          const reply = await api.chat.stream(
            streamId,
            workspaceId,
            'What time does Riverside Library open on Monday? Answer in one short sentence and cite the source.',
            {
              conversationId: conversation.id,
              activeDocumentIds: [documentId],
              language: 'en',
              topK: 1,
              rerank: false,
              multiQuery: false,
              routing: false,
              wholeDocFallback: false,
            },
          )
          await Promise.race([
            terminal,
            new Promise<void>((resolveTerminal) => {
              terminalTimer = setTimeout(resolveTerminal, 5000)
            }),
          ])
          return {
            reply,
            events,
            fallbacks,
            timedOut,
            saved: await api.conversations.getWithMessages(conversation.id),
            info: await api.llm.info(),
            status: await api.llm.status(),
          }
        } finally {
          clearTimeout(timer)
          if (terminalTimer) clearTimeout(terminalTimer)
          off()
          offFallback()
        }
      },
      { workspaceId, documentId: document.id },
    )
    report.elapsedMs = Date.now() - started
    report.answer = answer
    expect(requests.filter((request) => request.path === '/api/chat')).toContainEqual({
      method: 'POST',
      path: '/api/chat',
      authenticated: false,
      context: 8192,
      outputLimit: 2048,
    })
    expect(requests.some((request) => /embed|rerank/.test(request.path ?? ''))).toBe(false)
    expect(answer.timedOut).toBe(false)
    expect(answer.events.filter((event) => event.type === 'error')).toEqual([])
    const terminal = answer.events.filter((event) => event.type === 'done')
    expect(terminal).toHaveLength(1)
    expect(answer.reply).toEqual(terminal[0])
    expect(terminal[0]?.outcome).toBe('completed')
    expect(terminal[0]?.full_text).toMatch(/09:00|9:00|nine/i)
    expect(terminal[0]?.citations.some((citation) => citation.doc_id === document.id)).toBe(true)
    expect(answer.saved.messages.at(-1)?.content).toBe(terminal[0]?.full_text)
    expect(answer.fallbacks).toContainEqual({ kind: 'llm', reason: 'HTTP 503' })
    expect(answer.status).toMatchObject({
      source: 'ollama',
      fallback: { active: true, reason: 'HTTP 503' },
      resident: true,
    })
    expect(answer.info).toMatchObject({ state: 'ready', resident: true, resolvedPlacement: 'gpu' })
    expect(answer.info.modelCapacity).toMatchObject({ contextSize: 4096 })
    expect(answer.info.modelCapacity?.gpuLayers).toBeGreaterThan(0)
    await expect.poll(() => logs).toMatch(/llm\.ask start:.*maxTokens=1024/)
    expect(logs).not.toMatch(/context became smaller|context shift/i)
    expect(await fingerprintCompiledBuild()).toEqual(compiledHashes)
    report.completedAt = new Date().toISOString()
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    await launched?.cleanup()
    server.closeAllConnections()
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
    await Promise.all([
      writeFile(join(output, 'fallback.json'), JSON.stringify(report, null, 2) + '\n'),
      writeFile(join(output, 'app.log'), logs),
    ])
  }
})
