import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api } from '../../src/preload'
import type { StreamEvent } from '../../src/shared/documents'
import type { ModelActivity } from '../../src/shared/modelActivity'
import { launchApp } from './helpers/launch'
import { registerAndUnlock, createWorkspace } from './helpers/seed'

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
    await writeFile(
      source,
      'Library opening hours\nThe Riverside Library opens at 09:00 every Monday. It closes at 17:00.\n',
    )
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
    await expect.poll(() => logs).toContain('llm.ask done:')

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
    await page.screenshot({ path: test.info().outputPath('chat-handoff-complete.png') })
  } finally {
    await launched.cleanup()
  }
})
