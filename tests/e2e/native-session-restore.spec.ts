import { test, expect, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Api } from '../../src/preload'
import type { SystemInfo } from '../../src/shared/documents'
import { launchApp } from './helpers/launch'
import { registerAndUnlock } from './helpers/seed'
import { fingerprintCompiledBuild } from './helpers/buildFingerprint'

// Root owns exclusive native/GPU execution. Run the same built app twice with
// LOKLM_REUSE_GPU_LAYER_PLAN=0 / 1 and an explicit LOKLM_LLM_CONTEXT_SIZE=4096.
// The shared launch helper supplies a disposable vault and Chromium profile.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

type Phase = {
  name: 'cold' | 'sequential-unlock' | 'concurrent-lock-login'
  elapsedMs: number
  authenticationMs?: number
  lockMs?: number
  loginMs?: number
  completionOrder?: string[]
  info: SystemInfo
  workerStarts: number
  qualifiedSeeds: number
  cacheHits: number
  cacheFallbacks: number
}

async function waitForResidentChat(page: Page): Promise<SystemInfo> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const api = (globalThis as unknown as { api: Api }).api
          const [auth, activity, llm] = await Promise.all([
            api.auth.status(),
            api.models.activity(),
            api.llm.status(),
          ])
          return (
            !auth.locked &&
            activity.phase === 'idle' &&
            llm.state === 'ready' &&
            llm.resident === true
          )
        }),
      { timeout: 180_000, intervals: [250, 500, 1000] },
    )
    .toBe(true)
  return page.evaluate(() => (globalThis as unknown as { api: Api }).api.llm.info())
}

function logCounts(log: string) {
  return {
    workerStarts: (log.match(/modelsWorker ready/g) ?? []).length,
    qualifiedSeeds: (log.match(/Restored \d+ qualified GPU allocation hint\(s\)/g) ?? []).length,
    cacheHits: (log.match(/GPU layer plan cache hit:/g) ?? []).length,
    cacheFallbacks: (log.match(/GPU layer plan cache fallback:/g) ?? []).length,
  }
}

test('native chat restoration preserves context quality across sequential and concurrent lock/login', async () => {
  test.skip(
    process.env['LOKLM_NATIVE_RESTORE'] !== '1',
    'Requires installed models and exclusive GPU access',
  )
  test.setTimeout(600_000)
  const target = Number(process.env['LOKLM_LLM_CONTEXT_SIZE'])
  expect(
    Number.isSafeInteger(target) && target >= 4096,
    'Set LOKLM_LLM_CONTEXT_SIZE explicitly to the common control/candidate target',
  ).toBe(true)
  const reuse = process.env['LOKLM_REUSE_GPU_LAYER_PLAN'] !== '0'
  const output = process.env['LOKLM_NATIVE_RESTORE_OUTPUT']
    ? resolve(process.env['LOKLM_NATIVE_RESTORE_OUTPUT'])
    : test.info().outputPath('native-session-restore')
  await mkdir(dirname(output), { recursive: true })
  // Fail if this report directory already exists: control/candidate evidence
  // must never silently overwrite a previous run.
  await mkdir(output)
  const compiledHashes = await fingerprintCompiledBuild()
  const report: {
    startedAt: string
    requestedContext: number
    reuseGpuLayerPlan: boolean
    compiledHashes: Record<string, string>
    phases: Phase[]
    failure?: string
    completedAt?: string
  } = {
    startedAt: new Date().toISOString(),
    requestedContext: target,
    reuseGpuLayerPlan: reuse,
    compiledHashes,
    phases: [],
  }
  let logs = ''
  const flush = async () => {
    await Promise.all([
      writeFile(join(output, 'restore.json'), JSON.stringify(report, null, 2) + '\n'),
      writeFile(join(output, 'app.log'), logs),
    ])
  }
  await flush()
  const launched = await launchApp()
  const { app, page } = launched
  const child = app.process()
  const recordLog = (data: unknown): void => {
    const text = String(data)
    logs += text
    // Full stdout/stderr is retained in app.log; print only useful resource and
    // lifecycle evidence. Never print registration results or recovery words.
    for (const line of text.split(/\r?\n/)) {
      if (
        /qualified GPU|GPU layer plan|LLM ready:|modelsWorker ready|context plan|failed|error/i.test(
          line,
        )
      )
        console.log(line)
    }
  }
  child.stdout?.on('data', recordLog)
  child.stderr?.on('data', recordLog)
  const record = async (phase: Phase): Promise<void> => {
    report.phases.push(phase)
    await flush()
    console.log(`SESSION_RESTORE ${JSON.stringify(phase)}`)
    expect(phase.info).toMatchObject({ state: 'ready', resident: true, resolvedPlacement: 'gpu' })
    expect(phase.info.gpu).not.toBe('cpu')
    expect(phase.info.modelCapacity?.gpuLayers).toBeGreaterThan(0)
    expect(phase.info.modelCapacity?.contextSize).toBeGreaterThanOrEqual(target)
    expect(
      (phase.info.lastLlmPlan as { contextSize?: number } | null)?.contextSize,
    ).toBeGreaterThanOrEqual(target)
    // The explicit target keeps each matched arm's capacity comparable. A
    // candidate must not trade a smaller context for a faster reload.
    const cold = report.phases[0]!
    expect(phase.info.modelCapacity?.contextSize).toBeGreaterThanOrEqual(
      cold.info.modelCapacity?.contextSize ?? target,
    )
    expect(phase.info.modelName).toBe(cold.info.modelName)
    expect(phase.info.gpuName).toBe(cold.info.gpuName)
    expect(phase.workerStarts).toBe(1)
    if (phase.name === 'cold' || !reuse) {
      expect(phase.qualifiedSeeds).toBe(0)
      if (!reuse) expect(phase.cacheHits).toBe(0)
    } else {
      expect(
        phase.qualifiedSeeds,
        'A successful full-target load must seed the fresh worker',
      ).toBeGreaterThan(0)
      expect(
        phase.cacheHits,
        'The full allocation identity must match after vault unlock',
      ).toBeGreaterThan(0)
    }
  }
  try {
    const coldStart = Date.now()
    await registerAndUnlock(page, 'Native session restoration')
    const coldInfo = await waitForResidentChat(page)
    // Push logs and llm.info travel independently. Await the worker's final load
    // line before slicing phase logs, rather than relying on an arbitrary sleep.
    await expect.poll(() => logs).toMatch(/LLM ready:/)
    await record({
      name: 'cold',
      elapsedMs: Date.now() - coldStart,
      info: coldInfo,
      ...logCounts(logs),
    })

    for (const concurrent of [false, true]) {
      const startOffset = logs.length
      const startedAt = Date.now()
      const auth = await page.evaluate(async (isConcurrent) => {
        const api = (globalThis as unknown as { api: Api }).api
        const started = Date.now()
        const completionOrder: string[] = []
        let lockMs = 0
        let loginMs = 0
        const locking = api.auth.lock().then(async () => {
          lockMs = Date.now() - started
          completionOrder.push('lock')
          if (!isConcurrent) {
            const status = await api.auth.status()
            const model = await api.llm.status()
            if (!status.locked || model.resident === true)
              throw new Error('Explicit lock left the vault or native model session open')
          }
        })
        if (!isConcurrent) await locking
        const loginStarted = Date.now()
        // With concurrent=true both invokes are sent in order from the same
        // renderer, without waiting for the close operation to resolve.
        const loggingIn = api.auth.login('Demo-Vault-2026!').then((result) => {
          loginMs = Date.now() - loginStarted
          completionOrder.push('login')
          return result
        })
        const [, result] = await Promise.all([locking, loggingIn])
        return { result, lockMs, loginMs, completionOrder, authenticationMs: Date.now() - started }
      }, concurrent)
      expect(auth.result).toEqual({ ok: true })
      expect(auth.completionOrder).toEqual(['lock', 'login'])
      const info = await waitForResidentChat(page)
      await expect.poll(() => logs.slice(startOffset)).toMatch(/LLM ready:/)
      await record({
        name: concurrent ? 'concurrent-lock-login' : 'sequential-unlock',
        elapsedMs: Date.now() - startedAt,
        authenticationMs: auth.authenticationMs,
        lockMs: auth.lockMs,
        loginMs: auth.loginMs,
        completionOrder: auth.completionOrder,
        info,
        ...logCounts(logs.slice(startOffset)),
      })
      // Confirm initialized private IPC remains usable after model restoration;
      // a late close callback must not retire the newly opened session.
      const stable = await page.evaluate(async () => {
        const api = (globalThis as unknown as { api: Api }).api
        await api.settings.get()
        return { auth: await api.auth.status(), llm: await api.llm.status() }
      })
      expect(stable).toMatchObject({
        auth: { locked: false },
        llm: { state: 'ready', resident: true },
      })
    }
    expect(
      await fingerprintCompiledBuild(),
      'The built app changed during native measurement',
    ).toEqual(compiledHashes)
    report.completedAt = new Date().toISOString()
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    try {
      await flush()
    } finally {
      // Evidence failures must never leave the private native session running.
      try {
        await launched.cleanup()
      } finally {
        child.stdout?.removeListener('data', recordLog)
        child.stderr?.removeListener('data', recordLog)
        await flush()
      }
    }
  }
})
