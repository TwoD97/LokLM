import { test, expect } from '@playwright/test'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api } from '../../src/preload'
import type { StreamEvent } from '../../src/shared/documents'
import type { ModelActivity } from '../../src/shared/modelActivity'
import { launchApp } from './helpers/launch'
import { registerAndUnlock, createWorkspace } from './helpers/seed'

// Registration uses IPC and discards recovery words inside the renderer.
// Keep failure traces/screenshots disabled as well; only explicit synthetic
// post-unlock evidence may be captured by these opt-in tests.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const LIBRARY_SOURCE =
  'Library opening hours\nThe Riverside Library opens at 09:00 every Monday. It closes at 17:00.\n'

// Real GPU regression, isolated from the user's vault. Opt in after building:
// LOKLM_NATIVE_CHAT=1 pnpm exec playwright test --config tests/e2e/playwright.config.ts chat-gpu-handoff
test('chat loads on demand after indexing and indexing preempts automatic titles', async () => {
  test.skip(process.env['LOKLM_NATIVE_CHAT'] !== '1', 'Requires installed models and a free GPU')
  test.setTimeout(600_000)
  const launched = await launchApp()
  const { page, app, userDataDir } = launched
  let logs = ''
  app.process().stdout?.on('data', (data) => {
    logs += String(data)
    console.log(String(data).trim())
  })
  try {
    await registerAndUnlock(page, 'GPU chat test')
    const workspaceId = await createWorkspace(page, 'GPU chat test')
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as { api: Api }).api
            return (
              (await api.models.activity()).phase === 'idle' &&
              (await api.llm.status()).resident === true
            )
          }),
        { timeout: 180_000 },
      )
      .toBe(true)
    const constrainedGpu = await page.evaluate(async () => {
      const resources = (await (globalThis as unknown as { api: Api }).api.llm.info())
        .resources as { hasGpu?: boolean; totalVramGB?: number } | null
      const vram = resources?.totalVramGB
      return !!(
        resources?.hasGpu &&
        typeof vram === 'number' &&
        Number.isFinite(vram) &&
        vram > 0 &&
        vram <= 6
      )
    })

    const source = join(userDataDir, 'Library.txt')
    await writeFile(source, LIBRARY_SOURCE)
    const document = await page.evaluate(
      ({ workspaceId, source }) =>
        (globalThis as unknown as { api: Api }).api.documents.import(workspaceId, source),
      { workspaceId, source },
    )
    const indexingFinished = () =>
      page.evaluate(async (id) => {
        const api = (globalThis as unknown as { api: Api }).api
        const documents = await api.documents.list(id)
        return (
          documents.length === 1 &&
          documents.every((d) => d.status === 'ready') &&
          (await api.models.activity()).phase === 'idle'
        )
      }, workspaceId)
    const expectIdleResidency = async () => {
      await expect.poll(indexingFinished, { timeout: 120_000 }).toBe(true)
      const statuses = await page.evaluate(async () => {
        const api = (globalThis as unknown as { api: Api }).api
        return { chat: await api.llm.status(), search: await api.embedder.status() }
      })
      expect(statuses.chat).toMatchObject({ state: 'ready', resident: !constrainedGpu })
      if (constrainedGpu) expect(statuses.search).toMatchObject({ state: 'ready', resident: true })
    }
    await expectIdleResidency()

    const conversation = await page.evaluate(
      (id) => (globalThis as unknown as { api: Api }).api.conversations.create(id),
      workspaceId,
    )
    const askQuestion = (streamId: string, question: string) =>
      page.evaluate(
        async ({ workspaceId, conversationId, streamId, question }) => {
          const api = (globalThis as unknown as { api: Api }).api
          const events: StreamEvent[] = []
          const activities: ModelActivity[] = []
          let terminalReceived = false
          let timedOut = false
          let resolveTerminal!: () => void
          const terminal = new Promise<void>((resolve) => {
            resolveTerminal = resolve
          })
          const offActivity = api.models.onActivity((activity) => activities.push(activity))
          const off = api.chat.onEvent(streamId, (ev) => {
            events.push(ev)
            if (ev.type === 'done' || ev.type === 'error') {
              terminalReceived = true
              resolveTerminal()
            }
          })
          let terminalTimer: ReturnType<typeof setTimeout> | undefined
          const timer = setTimeout(() => {
            timedOut = true
            void api.chat.cancel(streamId)
          }, 180_000)
          try {
            const reply = await api.chat.stream(streamId, workspaceId, question, {
              conversationId,
              language: 'en',
              topK: 1,
              rerank: true,
              multiQuery: false,
              routing: false,
              wholeDocFallback: false,
            })
            // Invoke responses and stream events use separate IPC channels.
            // Keep listeners alive until the terminal event actually arrives.
            await Promise.race([
              terminal,
              new Promise<void>((resolve) => {
                terminalTimer = setTimeout(resolve, 5000)
              }),
            ])
            return {
              events,
              activities,
              terminalReceived,
              timedOut,
              reply,
              persisted: await api.conversations.getWithMessages(conversationId),
            }
          } finally {
            clearTimeout(timer)
            if (terminalTimer) clearTimeout(terminalTimer)
            off()
            offActivity()
          }
        },
        { workspaceId, conversationId: conversation.id, streamId, question },
      )
    const first = await askQuestion(
      'native-question',
      'What time does Riverside Library open on Monday? Answer with the time only.',
    )
    const { events } = first
    const assertSavedAnswer = (result: Awaited<ReturnType<typeof askQuestion>>): void => {
      const terminals = result.events.filter((event) => event.type === 'done')
      expect(terminals).toHaveLength(1)
      const terminal = terminals[0]!
      expect(result.reply).toEqual(terminal)
      expect(terminal.outcome).toBe('completed')
      const saved = result.persisted?.messages
        .filter((message) => message.role === 'assistant')
        .at(-1)
      expect(saved?.content).toBe(terminal.full_text)
      expect(
        saved?.citations.map((citation) => `${citation.documentId}:${citation.chunkId}`),
      ).toEqual(terminal.citations.map((citation) => `${citation.doc_id}:${citation.chunk_id}`))
    }
    expect(first.timedOut).toBe(false)
    expect(first.terminalReceived).toBe(true)
    expect(events.filter((ev) => ev.type === 'error')).toEqual([])
    assertSavedAnswer(first)
    expect(events.some((ev) => ev.type === 'done' && /09:00|9:00|nine/i.test(ev.full_text))).toBe(
      true,
    )
    if (constrainedGpu)
      expect(
        first.activities.some((event) => event.phase === 'switching' && event.target === 'llm'),
      ).toBe(true)
    await expect.poll(() => logs).toContain('[qa] checked result:')

    await page.evaluate((id) => {
      const state = globalThis as unknown as { api: Api; titleFinished?: boolean }
      state.titleFinished = false
      void state.api.conversations.generateTitle(id).finally(() => {
        state.titleFinished = true
      })
    }, conversation.id)
    await expect
      .poll(() => logs.includes('llm.generateRaw start: task=title maxTokens=48 noThink=true'))
      .toBe(true)
    await page.evaluate(
      (id) => (globalThis as unknown as { api: Api }).api.documents.reindex(id),
      document.id,
    )
    await expect
      .poll(
        () =>
          page.evaluate(() => (globalThis as unknown as { titleFinished: boolean }).titleFinished),
        { timeout: 15_000 },
      )
      .toBe(true)
    await expect
      .poll(() => logs)
      .toMatch(/llm.generateRaw finished: task=title elapsedMs=\d+ cancelled=true/)
    await expectIdleResidency()
    const second = await askQuestion(
      'native-question-after-reindex',
      'What time does Riverside Library close on Monday? Answer with the time only.',
    )
    expect(second.timedOut).toBe(false)
    expect(second.terminalReceived).toBe(true)
    expect(second.events.filter((event) => event.type === 'error')).toEqual([])
    assertSavedAnswer(second)
    expect(
      second.events.some(
        (event) => event.type === 'done' && /17:00|5:00|five/i.test(event.full_text),
      ),
    ).toBe(true)
    if (constrainedGpu)
      expect(
        second.activities.some((event) => event.phase === 'switching' && event.target === 'llm'),
      ).toBe(true)
    expect(
      await page.evaluate(() => (globalThis as unknown as { api: Api }).api.llm.status()),
    ).toMatchObject({ state: 'ready', resident: true })

    // Lock during a real native request. It must retire private generation and
    // release model residency before another login can start fresh work.
    const logsBeforeLock = logs.length
    await page.evaluate(
      ({ workspaceId, conversationId }) => {
        const state = globalThis as unknown as {
          api: Api
          lockedStreamEvents: StreamEvent[]
          lockedStreamFinished: boolean
          lockedStreamOff?: () => void
        }
        state.lockedStreamEvents = []
        state.lockedStreamFinished = false
        state.lockedStreamOff = state.api.chat.onEvent('native-lock', (event) =>
          state.lockedStreamEvents.push(event),
        )
        void state.api.chat
          .stream(
            'native-lock',
            workspaceId,
            'Explain the Riverside Library Monday opening and closing schedule in detail.',
            {
              conversationId,
              language: 'en',
              multiQuery: false,
              routing: false,
              wholeDocFallback: false,
            },
          )
          .catch(() => undefined)
          .finally(() => {
            state.lockedStreamFinished = true
            // Keep the independent pushed-terminal listener through successful
            // reuse. Invoke settlement does not imply its event has arrived.
          })
      },
      { workspaceId, conversationId: conversation.id },
    )
    await expect
      .poll(
        () => {
          // This API caller deliberately has no opts.history. Persisted prior
          // messages alone do not change the standalone checked-answer route.
          const current = logs.slice(logsBeforeLock)
          const checked = current.lastIndexOf('[qa] checked answer:')
          return (
            checked >= 0 &&
            current.indexOf('llm.generateRaw start: task=utility', checked) > checked
          )
        },
        { timeout: 120_000 },
      )
      .toBe(true)
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    await expect
      .poll(() =>
        page.evaluate(
          () => (globalThis as unknown as { lockedStreamFinished: boolean }).lockedStreamFinished,
        ),
      )
      .toBe(true)
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            globalThis as unknown as { lockedStreamEvents: StreamEvent[] }
          ).lockedStreamEvents.filter((event) => event.type === 'done' || event.type === 'error'),
        ),
      )
      .toEqual([{ type: 'done', full_text: '', citations: [], outcome: 'cancelled' }])
    expect(
      await page.evaluate(async () => {
        const api = (globalThis as unknown as { api: Api }).api
        return { chat: await api.llm.status(), embedder: await api.embedder.status() }
      }),
    ).toMatchObject({
      chat: { resident: false },
      embedder: { resident: false },
    })
    const workersBeforeUnlock = (logs.match(/modelsWorker ready/g) ?? []).length
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { api: Api }).api.auth.login('Demo-Vault-2026!'),
      ),
    ).toEqual({ ok: true })
    await page.evaluate(
      (id) => (globalThis as unknown as { api: Api }).api.workspaces.activate(id),
      workspaceId,
    )
    const afterUnlock = await askQuestion(
      'native-question-after-unlock',
      'What time does Riverside Library open on Monday? Answer with the time only.',
    )
    expect(afterUnlock.timedOut).toBe(false)
    expect(afterUnlock.events.filter((event) => event.type === 'error')).toEqual([])
    assertSavedAnswer(afterUnlock)
    expect(
      afterUnlock.events.some(
        (event) => event.type === 'done' && /09:00|9:00|nine/i.test(event.full_text),
      ),
    ).toBe(true)
    expect((logs.match(/modelsWorker ready/g) ?? []).length).toBeGreaterThan(workersBeforeUnlock)
    const lockedEventsAfterReuse = await page.evaluate(
      () => (globalThis as unknown as { lockedStreamEvents: StreamEvent[] }).lockedStreamEvents,
    )
    expect(lockedEventsAfterReuse.filter((event) => event.type === 'token')).toEqual([])
    expect(
      lockedEventsAfterReuse.filter((event) => event.type === 'done' || event.type === 'error'),
    ).toEqual([{ type: 'done', full_text: '', citations: [], outcome: 'cancelled' }])
    await page.screenshot({ path: test.info().outputPath('chat-handoff-complete.png') })
  } finally {
    await page
      .evaluate(() => {
        const state = globalThis as unknown as { lockedStreamOff?: () => void }
        state.lockedStreamOff?.()
        delete state.lockedStreamOff
      })
      .catch(() => undefined)
    await launched.cleanup()
  }
})

test('chat UI sends, opens a source and atomically regenerates saved history', async () => {
  test.skip(process.env['LOKLM_NATIVE_CHAT'] !== '1', 'Requires installed models and a free GPU')
  test.setTimeout(480_000)
  const launched = await launchApp({ contentSize: { width: 1280, height: 900 } })
  const { page, app, userDataDir } = launched
  const rendererErrors: string[] = []
  let logs = ''
  app.process().stdout?.on('data', (data) => {
    logs += String(data)
  })
  page.on('pageerror', (error) => rendererErrors.push(error.message))
  try {
    await registerAndUnlock(page, 'Synthetic UI chat')
    const workspaceId = await createWorkspace(page, 'UI chat workspace')
    const source = join(userDataDir, 'Library.txt')
    await writeFile(source, LIBRARY_SOURCE)
    const document = await page.evaluate(
      ({ workspaceId, source }) =>
        (globalThis as unknown as { api: Api }).api.documents.import(workspaceId, source),
      { workspaceId, source },
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ workspaceId, documentId }) => {
              const api = (globalThis as unknown as { api: Api }).api
              return (await api.documents.list(workspaceId)).find((doc) => doc.id === documentId)
                ?.status
            },
            { workspaceId, documentId: document.id },
          ),
        { timeout: 120_000, intervals: [1000, 2000] },
      )
      .toBe('ready')
    const { conversation, stoppedConversation } = await page.evaluate(async (workspaceId) => {
      const api = (globalThis as unknown as { api: Api }).api
      await api.settings.update({
        basic: { language: 'en', answerLanguage: 'en', startView: 'chat' },
      })
      await api.workspaces.setDefault(workspaceId)
      // Only empty conversations are seeded. Send, Stop and Regenerate must go
      // through the actual composer and the production streaming lifecycle.
      return {
        conversation: await api.conversations.create(workspaceId, 'UI history'),
        stoppedConversation: await api.conversations.create(workspaceId, 'UI Stop'),
      }
    }, workspaceId)
    await page.reload()
    await expect
      .poll(
        async () => {
          if (await page.locator('.app-shell').isVisible()) return true
          const openWorkspace = page.getByRole('button', { name: 'Open workspace', exact: true })
          if (await openWorkspace.isVisible()) await openWorkspace.click()
          return page.locator('.app-shell').isVisible()
        },
        { timeout: 120_000 },
      )
      .toBe(true)
    const nav = page.locator('.sidebar__rail')
    await expect(nav.getByRole('button', { name: 'Chat', exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await nav.getByRole('button', { name: 'Chat', exact: true }).click()
    const composer = page.locator('textarea[name="chat-message"]')
    await page
      .locator('.chat-history')
      .getByRole('button', { name: /^UI Stop/ })
      .click()
    await expect(page.getByRole('heading', { name: 'UI Stop', exact: true })).toBeVisible()
    // Observe the exact push channel generated by the real composer. Forward
    // every event unchanged; retain this channel through later reuse to catch
    // duplicate terminals or late answer text from the stopped generation.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents
      const original = contents.send.bind(contents)
      const capture = {
        channel: null as string | null,
        events: [] as StreamEvent[],
        restore: () => {
          contents.send = original
        },
      }
      ;(globalThis as unknown as { uiStopCapture: typeof capture }).uiStopCapture = capture
      contents.send = (channel: string, ...args: unknown[]) => {
        if (
          channel.startsWith('chat:stream-event:') &&
          (capture.channel === null || capture.channel === channel)
        ) {
          capture.channel = channel
          capture.events.push(args[0] as StreamEvent)
        }
        original(channel, ...args)
      }
    })
    const stopEvents = () =>
      app.evaluate(
        () =>
          (globalThis as unknown as { uiStopCapture: { events: StreamEvent[] } }).uiStopCapture
            .events,
      )
    const stopQuestion = 'What are the Riverside Library Monday opening and closing times?'
    await composer.fill(stopQuestion)
    const logsBeforeStop = logs.length
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect
      .poll(
        () => {
          const current = logs.slice(logsBeforeStop)
          const checked = current.lastIndexOf('[qa] checked answer:')
          return (
            checked >= 0 &&
            current.indexOf('llm.generateRaw start: task=utility', checked) > checked
          )
        },
        { timeout: 120_000 },
      )
      .toBe(true)
    expect((await stopEvents()).filter((event) => event.type === 'token')).toEqual([])
    const stopStarted = Date.now()
    await page.getByRole('button', { name: 'Cancel streaming', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(async () =>
        (await stopEvents()).filter((event) => event.type === 'done' || event.type === 'error'),
      )
      .toHaveLength(1)
    const checkedStopMs = Date.now() - stopStarted
    const stoppedTerminal = (await stopEvents()).find((event) => event.type === 'done')!
    expect(stoppedTerminal).toMatchObject({
      type: 'done',
      outcome: 'cancelled',
      full_text: '_[Answer interrupted.]_',
    })
    const readStopped = () =>
      page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.conversations.getWithMessages(id),
        stoppedConversation.id,
      )
    const stoppedSaved = await readStopped()
    expect(stoppedSaved.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', stopQuestion],
      ['assistant', '_[Answer interrupted.]_'],
    ])
    expect(
      stoppedSaved.messages[1]!.citations.map(
        (citation) => `${citation.documentId}:${citation.chunkId}`,
      ),
    ).toEqual(
      stoppedTerminal.citations.map((citation) => `${citation.doc_id}:${citation.chunk_id}`),
    )

    const historyButton = page.locator('.chat-history').getByRole('button', { name: /^UI history/ })
    await historyButton.click()
    await expect(page.getByRole('heading', { name: 'UI history', exact: true })).toBeVisible()
    const question =
      'What time does Riverside Library open on Monday? Answer in one short sentence with a source citation.'
    await composer.fill(question)
    const started = Date.now()
    await page.getByRole('button', { name: 'Send message', exact: true }).click()

    const readSaved = () =>
      page.evaluate(
        (id) => (globalThis as unknown as { api: Api }).api.conversations.getWithMessages(id),
        conversation.id,
      )
    const waitForSavedAnswer = async (previousAssistantId = 0) => {
      await expect
        .poll(
          async () => {
            const saved = await readSaved()
            const assistant = saved.messages.at(-1)
            return (
              saved.messages.length === 2 &&
              assistant?.role === 'assistant' &&
              assistant.id > previousAssistantId &&
              assistant.content.trim().length > 0
            )
          },
          { timeout: 150_000, intervals: [1000, 2000] },
        )
        .toBe(true)
      // Completion includes UI rehydration, not merely a DB append while the
      // renderer still owns a stream or a preflight operation.
      await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.locator('.chat__error')).toHaveCount(0)
      const saved = await readSaved()
      expect(saved.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
      expect(saved.messages[0]!.content).toBe(question)
      const assistant = saved.messages[1]!
      expect(assistant.content).toMatch(/09:00|9:00|nine/i)
      expect(assistant.citations.length).toBeGreaterThan(0)
      expect(assistant.citations.every((citation) => citation.documentId === document.id)).toBe(
        true,
      )
      await expect(page.locator('.bubble--assistant')).toContainText(/09:00|9:00|nine/i)
      return saved
    }
    const first = await waitForSavedAnswer()
    const firstFinishedMs = Date.now() - started

    // Prefer an actual inline citation; a small model may instead provide the
    // supplied-source footer. Both navigation paths must open the indexed text.
    const inlineCitation = page.locator('.bubble--assistant .citation-chip').first()
    const sourceNavigation = (await inlineCitation.count()) > 0 ? 'inline' : 'provided-footer'
    if (sourceNavigation === 'inline') {
      await inlineCitation.click()
    } else {
      await page.locator('.chat__grounding').click()
      await page.getByRole('menuitem', { name: /Library\.txt/ }).click()
    }
    const reader = page.getByRole('dialog', { name: 'Source viewer', exact: true })
    await expect(reader).toBeVisible()
    await expect(reader.locator('.source-viewer__body')).toContainText(
      'The Riverside Library opens at 09:00 every Monday.',
    )
    await reader.getByRole('button', { name: 'Close source viewer', exact: true }).click()
    await expect(reader).toBeHidden()

    const regenerateStarted = Date.now()
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
    const replacement = await waitForSavedAnswer(first.messages[1]!.id)
    const regenerateMs = Date.now() - regenerateStarted
    const oldIds = new Set(first.messages.map((message) => message.id))
    expect(replacement.messages.every((message) => !oldIds.has(message.id))).toBe(true)
    expect(replacement.messages[0]!.id).toBeGreaterThan(first.messages[1]!.id)
    await expect(page.locator('.bubble--user')).toHaveCount(1)
    await expect(page.locator('.bubble--assistant')).toHaveCount(1)

    await nav.getByRole('button', { name: 'Library', exact: true }).click()
    await expect(page.locator('.library')).toBeVisible()
    await nav.getByRole('button', { name: 'Chat', exact: true }).click()
    await page.getByRole('button', { name: '+ New chat', exact: true }).click()
    await expect(page.locator('.chat__messages-empty')).toBeVisible()
    await historyButton.click()
    await expect(page.locator('.bubble--user')).toHaveText(question)
    await expect(page.locator('.bubble--assistant')).toContainText(/09:00|9:00|nine/i)
    expect((await readSaved()).messages).toEqual(replacement.messages)

    // Import this tiny, synthetic DEV fixture only after all chat assertions,
    // so it cannot change retrieval for the question above. Exercise the real
    // lazy PDF.js chunk/worker and canvas lifecycle on the shipped renderer.
    await nav.getByRole('button', { name: 'Library', exact: true }).click()
    await expect(page.locator('.library')).toBeVisible()
    // Own the mutable source inside this disposable profile. Never overwrite
    // either checked-in fixture when simulating a changed original document.
    const pdfSource = join(userDataDir, 'mica-field-survey.pdf')
    await copyFile(
      join(process.cwd(), 'tests/evals/native-calibration/fixtures/dev/mica-field-survey.pdf'),
      pdfSource,
    )
    const pdfDocument = await page.evaluate(
      ({ workspaceId, source }) =>
        (globalThis as unknown as { api: Api }).api.documents.import(workspaceId, source),
      {
        workspaceId,
        source: pdfSource,
      },
    )
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ workspaceId, documentId }) => {
              const api = (globalThis as unknown as { api: Api }).api
              const docs = await api.documents.list(workspaceId)
              return (
                docs.find((doc) => doc.id === documentId)?.status === 'ready' &&
                (await api.models.activity()).phase === 'idle'
              )
            },
            { workspaceId, documentId: pdfDocument.id },
          ),
        { timeout: 90_000, intervals: [1000, 2000] },
      )
      .toBe(true)
    const indexedPdfTexts = await page.evaluate(async (documentId) => {
      const chunks = await (
        globalThis as unknown as { api: Api }
      ).api.documents.listChunksForDocument(documentId)
      return chunks.map((chunk) => chunk.text)
    }, pdfDocument.id)
    expect(indexedPdfTexts.join('\n')).toContain('Mica Harbor field survey')
    const pdfRow = page.getByRole('row').filter({ hasText: pdfDocument.title })
    for (let pass = 0; pass < 2; pass++) {
      await pdfRow.dblclick()
      const pdfReader = page.getByRole('dialog').filter({ has: page.locator('.pdf-doc') })
      await expect(pdfReader).toBeVisible()
      const canvas = pdfReader.locator('canvas.pdf-doc__page-canvas:not(.is-hidden)').first()
      await expect(canvas).toBeVisible({ timeout: 30_000 })
      // Dimensions alone precede PDF.js rendering. Wait for actual glyph ink,
      // so a mounted but blank/unfinished canvas cannot pass this regression.
      await expect
        .poll(
          () =>
            canvas.evaluate((element) => {
              const canvas = element as unknown as {
                width: number
                height: number
                getContext(type: '2d'): {
                  getImageData(
                    x: number,
                    y: number,
                    width: number,
                    height: number,
                  ): {
                    data: Uint8ClampedArray
                  }
                } | null
              }
              if (canvas.width <= 0 || canvas.height <= 0) return false
              const context = canvas.getContext('2d')
              if (!context) return false
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
              let inkPixels = 0
              for (let offset = 0; offset < pixels.length; offset += 4) {
                if (
                  pixels[offset + 3]! > 0 &&
                  Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) < 240 &&
                  ++inkPixels > 20
                )
                  return true
              }
              return false
            }),
          { timeout: 30_000 },
        )
        .toBe(true)
      await expect(pdfReader.locator('.pdf-doc__error')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(pdfReader).toHaveCount(0)
    }
    // A different valid PDF at the same external path must not be presented as
    // the indexed evidence. Keep the stored original text available instead.
    await copyFile(
      join(
        process.cwd(),
        'tests/evals/native-calibration/fixtures/heldout/veldrin-field-survey.pdf',
      ),
      pdfSource,
    )
    await pdfRow.dblclick()
    const changedPdfReader = page.getByRole('dialog', {
      name: `Preview: ${pdfDocument.title}`,
      exact: true,
    })
    await expect(changedPdfReader).toBeVisible()
    await expect(changedPdfReader.getByRole('status')).toHaveText(
      'The PDF has changed since indexing. Showing the available indexed text.',
    )
    await expect(changedPdfReader.locator('.pdf-doc')).toHaveCount(0)
    await expect(changedPdfReader.locator('canvas')).toHaveCount(0)
    expect(await changedPdfReader.locator('.source-viewer__chunk-pre').allTextContents()).toEqual(
      indexedPdfTexts,
    )
    await expect(changedPdfReader.locator('.source-viewer__body')).not.toContainText(
      'Veldrin Yard field survey',
    )
    await page.keyboard.press('Escape')
    await expect(changedPdfReader).toHaveCount(0)
    // Successful later UI work must not let the stopped request publish a late
    // checked answer or overwrite its durable interruption record.
    expect((await readStopped()).messages).toEqual(stoppedSaved.messages)
    expect((await stopEvents()).filter((event) => event.type === 'token')).toEqual([])
    expect(
      (await stopEvents()).filter((event) => event.type === 'done' || event.type === 'error'),
    ).toEqual([stoppedTerminal])
    expect(rendererErrors).toEqual([])
    // Persist explicitly: list-only Playwright reports do not retain body-only
    // attachments after a passing test, unlike path attachments.
    const resultPath = test.info().outputPath('synthetic-ui-chat-result.json')
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          kind: 'native-chat-ui-workflow',
          checkedStopMs,
          checkedStopTerminalCount: 1,
          checkedStopPersistedNoteOnly: true,
          firstFinishedMs,
          regenerateMs,
          sourceNavigation,
          originalIds: first.messages.map((message) => message.id),
          replacementIds: replacement.messages.map((message) => message.id),
          sourceDocumentId: document.id,
          persistedPairCount: replacement.messages.length,
          pdfCanvasOpenClosePasses: 2,
          changedPdfIndexedTextFallback: true,
        },
        null,
        2,
      ),
    )
    await test.info().attach('synthetic-ui-chat-result', {
      path: resultPath,
      contentType: 'application/json',
    })
  } finally {
    await app
      .evaluate(() => {
        const state = globalThis as unknown as { uiStopCapture?: { restore(): void } }
        state.uiStopCapture?.restore()
        delete state.uiStopCapture
      })
      .catch(() => undefined)
    await launched.cleanup()
  }
})
