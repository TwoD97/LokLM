import { test, expect, chromium, type Browser, type Page } from '@playwright/test'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Api } from '../../src/preload'

const execFileAsync = promisify(execFile)

// The release binary disables Node inspection and ELECTRON_RUN_AS_NODE. Attach
// to Chromium only, leaving the shipped fuses and sandbox unchanged. This smoke
// test needs no models, downloads, real account or main-process test backdoors.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

// Keep the established filename for existing local commands; release CI runs
// this same packaged-app contract on Windows, Linux and both native Mac archs.
test('packaged app preserves encrypted organizer and generated sources across restart', async () => {
  const configuredExe = process.env['LOKLM_PACKAGED_EXE']
  test.skip(!configuredExe, 'Set LOKLM_PACKAGED_EXE to the packaged app executable')
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
  let shutdownFailed = false
  let testFailed = false
  let testFailure: unknown
  const diagnostics: {
    launch: number
    startedAt: number
    elapsedMs: number | null
    pid: number | null
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    spawnError: string | null
    startupComplete: boolean
    quitObserved: boolean
    cdpError: string | null
    stdout: string
    stderr: string
    sampleStatus: 'not-requested' | 'completed' | 'timeout' | 'output-limit' | 'failed'
    sampleFrames: string
  }[] = []
  const logTailLimit = 8_192
  const safeLog = (text: string) =>
    text
      .replaceAll(password, '[redacted]')
      .replace(/^.*(?:recovery[ -]?phrase|mnemonic|password).*$/gim, '[sensitive log line omitted]')

  const start = async () => {
    shutdownFailed = false
    const diagnostic: (typeof diagnostics)[number] = {
      launch: diagnostics.length + 1,
      startedAt: Date.now(),
      elapsedMs: null,
      pid: null,
      exitCode: null,
      signalCode: null,
      spawnError: null,
      startupComplete: false,
      quitObserved: false,
      cdpError: null,
      stdout: '',
      stderr: '',
      sampleStatus: 'not-requested',
      sampleFrames: '',
    }
    diagnostics.push(diagnostic)
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
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    diagnostic.pid = processHandle.pid ?? null
    processHandle.on('exit', (code, signal) => {
      diagnostic.exitCode = code
      diagnostic.signalCode = signal
      diagnostic.elapsedMs = Date.now() - diagnostic.startedAt
    })
    // Only this test's fresh synthetic profile is captured, and only bounded
    // tails are published on failure. No renderer return values are recorded.
    for (const stream of ['stdout', 'stderr'] as const) {
      processHandle[stream]?.setEncoding('utf8')
      processHandle[stream]?.on('data', (chunk: string) => {
        diagnostic[stream] = (diagnostic[stream] + chunk).slice(-logTailLimit)
      })
    }
    processHandle.on('error', (error) => {
      diagnostic.spawnError = safeLog(error.message).slice(-2_048)
      failures.push(error.message)
    })
    let port = ''
    await expect
      .poll(
        async () => {
          if (
            processHandle &&
            (processHandle.exitCode !== null || processHandle.signalCode !== null)
          )
            throw new Error(
              `Packaged app exited: ${processHandle.exitCode}/${processHandle.signalCode}`,
            )
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
    await page.exposeFunction('__loklmPackagedQuitObserved', () => {
      diagnostic.quitObserved = true
    })
    await page.evaluate(() => {
      const scope = globalThis as unknown as {
        api: Api
        __loklmPackagedQuitObserved: () => Promise<void>
      }
      scope.api.window.onQuitting(() => {
        // A fast successful exit can tear down this renderer before its receipt
        // reaches the test. The actual process exit remains authoritative.
        void scope.__loklmPackagedQuitObserved().catch(() => undefined)
      })
    })
    await page.evaluate(() => (globalThis as unknown as { api: Api }).api.window.minimize())
    diagnostic.startupComplete = true
  }
  const stop = async () => {
    try {
      const child = processHandle
      if (child?.pid != null && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        if (process.platform === 'darwin') {
          // Closing the last window intentionally keeps a Mac app running.
          // Electron's Browser.close CDP handler calls Browser::Quit, preserving
          // before-quit/drain without enabling Node inspection or adding IPC.
          const session = await browser?.newBrowserCDPSession()
          if (!session) throw new Error('No browser session is available for the quit request')
          const diagnostic = diagnostics.at(-1)!
          // Electron deliberately never replies to Browser.close. A rejected
          // request must be retained for diagnosis, but a transport disconnect
          // during successful shutdown is not itself a failure.
          void session.send('Browser.close').catch((error: unknown) => {
            diagnostic.cdpError = safeLog(String(error)).slice(-2_048)
          })
        } else {
          await page
            ?.evaluate(() => (globalThis as unknown as { api: Api }).api.window.close())
            .catch(() => undefined)
        }
        const [code, signal] = await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Packaged app did not finish its shutdown drain')),
              45_000,
            )
            timer.unref()
            void exited.then(
              () => clearTimeout(timer),
              () => clearTimeout(timer),
            )
          }),
        ])
        expect(code).toBe(0)
        expect(signal).toBeNull()
      } else if (child?.pid != null) {
        // A crash before stop() is still a failing shutdown, not a successful
        // no-op. signalCode also distinguishes an already-fired signal exit.
        expect(child.exitCode).toBe(0)
        expect(child.signalCode).toBeNull()
      }
      await browser?.close().catch(() => undefined)
      browser = undefined
      processHandle = undefined
    } catch (error) {
      shutdownFailed = true
      const diagnostic = diagnostics.at(-1)
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ` +
          `quit request observed=${diagnostic?.quitObserved ?? false}; ` +
          `CDP error=${diagnostic?.cdpError ?? 'none observed'}`,
        { cause: error },
      )
    }
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
        platform: process.platform,
        architecture: process.arch,
        persistedNotes: 1,
        persistedTasks: 1,
        generatedSourceRestored: true,
        locked: true,
      }),
      contentType: 'application/json',
    })
  } catch (error) {
    testFailed = true
    testFailure = error
  } finally {
    try {
      // A failed stop has already consumed its deadline. Preserve that failure
      // and proceed to owned-process cleanup instead of repeating the wait.
      if (!shutdownFailed) await stop()
    } catch (error) {
      if (!testFailed) testFailure = error
      testFailed = true
    } finally {
      try {
        if (testFailed || shutdownFailed) {
          const diagnostic = diagnostics.at(-1)
          const child = processHandle
          if (
            process.platform === 'darwin' &&
            diagnostic &&
            !diagnostic.startupComplete &&
            child?.pid != null &&
            child.exitCode === null &&
            child.signalCode === null
          ) {
            // Sample only this freshly spawned, pre-authentication child before
            // cleanup. Never enumerate unrelated processes or capture memory.
            // Keep call frames only, excluding process headers and binary paths.
            let sampleOutput = ''
            try {
              const sample = await execFileAsync(
                '/usr/bin/sample',
                [String(child.pid), '2', '10', '-file', '/dev/stdout'],
                {
                  encoding: 'utf8',
                  timeout: 8_000,
                  maxBuffer: 65_536,
                },
              )
              diagnostic.sampleStatus = 'completed'
              sampleOutput = sample.stdout
            } catch (error) {
              const failure = error as NodeJS.ErrnoException & {
                killed?: boolean
                stdout?: string
              }
              diagnostic.sampleStatus =
                failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                  ? 'output-limit'
                  : failure.killed
                    ? 'timeout'
                    : 'failed'
              sampleOutput = typeof failure.stdout === 'string' ? failure.stdout : ''
            }
            const frames = sampleOutput.slice(0, 65_536).split('Call graph:')[1]
            diagnostic.sampleFrames = frames
              ? safeLog(
                  frames.split(
                    /\n(?:Total number in stack|Sort by top of stack|Binary Images):?/,
                  )[0]!,
                )
                  .trim()
                  .slice(0, 65_536)
              : ''
          }
          const report = JSON.stringify(
            diagnostics.map((diagnostic) => ({
              ...diagnostic,
              elapsedMs: diagnostic.elapsedMs ?? Date.now() - diagnostic.startedAt,
              stdout: safeLog(diagnostic.stdout),
              stderr: safeLog(diagnostic.stderr),
            })),
            null,
            2,
          )
          console.error(`Packaged app failure diagnostics:\n${report}`)
          await test.info().attach('packaged-failure-diagnostics.json', {
            body: report,
            contentType: 'application/json',
          })
        }
      } finally {
        // Only terminate the exact child this test started if graceful close failed.
        if (
          processHandle?.pid != null &&
          processHandle.exitCode === null &&
          processHandle.signalCode === null
        ) {
          const exited = once(processHandle, 'exit')
          processHandle.kill()
          await exited
        }
        await browser?.close().catch(() => undefined)
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    }
  }
  if (testFailed) throw testFailure
})
