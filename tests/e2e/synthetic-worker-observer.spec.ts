import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { launchApp } from './helpers/launch'
import {
  installSyntheticWorkerObserver,
  sanitizeSyntheticEvidence,
} from '../evals/native-calibration/syntheticWorkerCapture'

test('passive synthetic observer preserves real utility-process IPC without a model', async () => {
  test.skip(process.env.LOKLM_NATIVE_CAPTURE_PROBE !== '1', 'Explicit no-model Electron probe')
  test.setTimeout(60_000)
  const launched = await launchApp()
  try {
    const result = await launched.app.evaluate(
      async ({ utilityProcess }, args) => {
        const sanitize = (0, eval)(`(${args.sanitize})`) as typeof sanitizeSyntheticEvidence
        const install = (0, eval)(`(${args.install})`) as typeof installSyntheticWorkerObserver
        const schema = { type: 'object', properties: { check: {}, result: {} } }
        const originalFork = utilityProcess.fork
        const observer = install(utilityProcess as never, sanitize, {
          workerPath: args.fixture,
          expectedSchemaJson: JSON.stringify(schema),
        })
        let child: ReturnType<typeof utilityProcess.fork> | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          child = utilityProcess.fork(args.fixture, [], {
            serviceName: 'loklm-models',
            stdio: 'ignore',
          })
          await new Promise<void>((done, reject) => {
            child!.once('spawn', done)
            child!.once('exit', () => reject(new Error('Fixture exited before spawn')))
          })
          const seen: Array<{ id: number; forwarded: boolean }> = []
          const reply = new Promise<void>((done, reject) => {
            timer = setTimeout(() => reject(new Error('Fixture reply timeout')), 5000)
            child!.on('message', (message: unknown) => {
              const m = (message as { data?: unknown }).data ?? message
              const r = m as { id: number; result: { forwarded: boolean } }
              seen.push({ id: r.id, forwarded: r.result.forwarded })
              if (seen.length === 2) done()
            })
          })
          observer.arm('synthetic-probe')
          child.postMessage({ id: 1, op: 'embedder.embed', payload: { probe: 'preserve-me' } })
          child.postMessage({
            id: 2,
            op: 'llm.generateRaw',
            payload: {
              probe: 'preserve-me',
              jsonSchema: schema,
              noThink: true,
              prompt: 'PRIVATE_PROMPT',
              systemPrompt: 'PRIVATE_SYSTEM',
            },
          })
          await reply
          const rows = observer.drain()
          const status = observer.status()
          observer.dispose()
          return {
            seen,
            rows,
            status,
            restored: utilityProcess.fork === originalFork,
            after: observer.status(),
          }
        } finally {
          clearTimeout(timer)
          observer.dispose()
          if (child && child.pid !== undefined) {
            const exited = new Promise<void>((done) => child!.once('exit', () => done()))
            child.kill()
            await exited
          }
        }
      },
      {
        fixture: resolve('tests/e2e/fixtures/synthetic-model-reply.cjs'),
        sanitize: sanitizeSyntheticEvidence.toString(),
        install: installSyntheticWorkerObserver.toString(),
      },
    )
    expect(result.seen).toEqual([
      { id: 1, forwarded: true },
      { id: 2, forwarded: true },
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      requestId: 2,
      status: 'completed',
      capture: { evidence: [{ quote: 'Synthetic fixture evidence.' }] },
    })
    expect(result.status).toMatchObject({ workers: 1, pending: 0, observerErrors: 0, dropped: 0 })
    expect(result.restored).toBe(true)
    expect(result.after.disposed).toBe(true)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    const files = [
      'tests/evals/native-calibration/syntheticWorkerCapture.ts',
      'tests/e2e/synthetic-worker-observer.spec.ts',
      'tests/e2e/fixtures/synthetic-model-reply.cjs',
    ]
    const hashes = Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ]),
      ),
    )
    await mkdir('out/optimization-20261005', { recursive: true })
    await writeFile(
      'out/optimization-20261005/synthetic-worker-observer-probe.json',
      JSON.stringify(
        { at: new Date().toISOString(), modelLoaded: false, result, hashes },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    )
  } finally {
    await launched.cleanup()
  }
})
