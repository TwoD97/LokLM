import { test, expect, chromium, type Browser, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Api } from '../../src/preload'

// The release binary disables Node inspection and ELECTRON_RUN_AS_NODE. Attach
// to Chromium only, leaving the shipped fuses and sandbox unchanged. This smoke
// test needs no models, downloads, real account or main-process test backdoors.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('packaged Windows app preserves encrypted organizer and generated sources across restart', async () => {
  const configuredExe = process.env['LOKLM_PACKAGED_EXE']
  test.skip(
    process.platform !== 'win32' || !configuredExe,
    'Set LOKLM_PACKAGED_EXE to the packaged LokLM.exe',
  )
  test.setTimeout(240_000)
  const executable = resolve(configuredExe!)
  await access(executable)
  const profile = await mkdtemp(test.info().outputPath('packaged-profile-'))
  const password = 'Packaged-Smoke-2026!'
  const source = '# Durable source\n\nThe violet archive opens at 08:35.\n'
  const failures: string[] = []
  let processHandle: ChildProcess | undefined
  let browser: Browser | undefined
  let page: Page | undefined

  const start = async () => {
    await rm(join(profile, 'DevToolsActivePort'), { force: true })
    const env = Object.fromEntries(
      Object.entries({ ...process.env, LOKLM_DATA_DIR: join(profile, 'vault') }).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' &&
          !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS'].includes(entry[0]),
      ),
    )
    processHandle = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], {
      env,
      windowsHide: true,
      stdio: 'ignore',
    })
    processHandle.on('error', (error) => failures.push(error.message))
    let port = ''
    await expect
      .poll(
        async () => {
          if (processHandle?.exitCode != null)
            throw new Error(`Packaged app exited: ${processHandle.exitCode}`)
          try {
            port =
              (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0] ?? ''
            return /^\d+$/.test(port)
          } catch {
            return false
          }
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    await expect.poll(() => browser!.contexts()[0]?.pages().length ?? 0).toBeGreaterThan(0)
    page = browser.contexts()[0]!.pages()[0]!
    page.on('pageerror', (error) => failures.push(error.message))
    await page.waitForFunction(() => !!(globalThis as unknown as { api?: Api }).api)
    expect(page.url()).toMatch(/app\.asar\/out\/renderer\/index\.html/)
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.window.minimize())
  }
  const stop = async () => {
    const child = processHandle
    if (child?.pid != null && child.exitCode === null) {
      const exited = once(child, 'exit')
      await page
        ?.evaluate(() => (globalThis as unknown as { api: Api }).api.window.close())
        .catch(() => undefined)
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Packaged app did not finish its shutdown drain')),
            45_000,
          )
          timer.unref()
          void exited.finally(() => clearTimeout(timer))
        }),
      ])
    }
    await browser?.close().catch(() => undefined)
    browser = undefined
    processHandle = undefined
  }

  try {
    await start()
    await page!.evaluate(
      async ({ password }) => {
        // Discard the recovery phrase inside the renderer; never capture it.
        await (globalThis as unknown as { api: Api }).api.auth.register(
          'Packaged regression',
          password,
          'en',
        )
      },
      { password },
    )
    const ids = await page!.evaluate(
      async ({ source }) => {
        const api = (globalThis as unknown as { api: Api }).api
        const workspace = await api.workspaces.create('Packaged library', true)
        await api.workspaces.activate(workspace.id)
        const note = await api.organizer.saveNote({
          title: 'Packaged note',
          body: 'A persisted note.',
        })
        const task = await api.organizer.saveTask({
          title: 'Verify packaged restart',
          completed: false,
          dueDate: '2026-10-02',
        })
        const document = await api.translation.saveDocument(
          workspace.id,
          'Durable source',
          source,
          'en',
        )
        return {
          workspaceId: workspace.id,
          documentId: document.id,
          noteId: note.id,
          taskId: task.id,
        }
      },
      { source },
    )
    await stop()
    await start()
    expect(
      await page!.evaluate(
        (password) => (globalThis as unknown as { api: Api }).api.auth.login(password),
        password,
      ),
    ).toEqual({ ok: true })
    const restored = await page!.evaluate(async (ids) => {
      const api = (globalThis as unknown as { api: Api }).api
      await api.workspaces.activate(ids.workspaceId)
      return {
        organizer: await api.organizer.list(),
        source: await api.documents.readGeneratedText(ids.documentId),
      }
    }, ids)
    expect(restored.source).toBe(source)
    expect(restored.organizer.notes).toContainEqual(
      expect.objectContaining({
        id: ids.noteId,
        title: 'Packaged note',
        body: 'A persisted note.',
      }),
    )
    expect(restored.organizer.tasks).toContainEqual(
      expect.objectContaining({
        id: ids.taskId,
        title: 'Verify packaged restart',
        completed: false,
      }),
    )
    await page!
      .getByRole('button', { name: /Open workspace|Arbeitsbereich.*ffnen|trotzdem|continue/i })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined)
    await page!.getByRole('button', { name: /^(Notes|Notizen)$/ }).click({ timeout: 30_000 })
    await expect(page!.getByText('Packaged note', { exact: true }).first()).toBeVisible()
    await page!.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.lock())
    expect(
      await page!.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.status()),
    ).toMatchObject({ locked: true })
    expect(failures).toEqual([])
    await test.info().attach('packaged-smoke.json', {
      body: JSON.stringify({
        executable,
        persistedNotes: 1,
        persistedTasks: 1,
        generatedSourceRestored: true,
        locked: true,
      }),
      contentType: 'application/json',
    })
  } finally {
    try {
      await stop()
    } finally {
      // Only terminate the exact child this test started if graceful close failed.
      if (processHandle?.pid != null && processHandle.exitCode === null) {
        const exited = once(processHandle, 'exit')
        processHandle.kill()
        await exited
      }
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }
})
