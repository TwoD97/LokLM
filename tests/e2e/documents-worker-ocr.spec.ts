import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Api } from '../../src/preload'
import type {
  DocWorkerMessage,
  ParseAndChunkResult,
} from '../../src/main/services/workers/documentsProtocol'
import { createMixedPdf } from '../fixtures/mixed-pdf'
import { launchApp } from './helpers/launch'
import { fingerprintCompiledBuild } from './helpers/buildFingerprint'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

// The app stays locked: this exercises the compiled documents utility process
// and real offline OCR without registering a vault or loading any GPU model.
test('documents utility process OCR preserves pages and concurrent request identity', async () => {
  test.skip(process.env['LOKLM_NATIVE_DOCUMENTS_OCR'] !== '1', 'Explicit native offline OCR opt-in')
  test.setTimeout(150_000)
  const output = test.info().outputPath('documents-worker-ocr')
  await mkdir(output, { recursive: true })
  const compiledHashes = await fingerprintCompiledBuild()
  const startedAt = new Date().toISOString()
  const launched = await launchApp()
  try {
    const sourcePath = join(launched.userDataDir, 'mixed.pdf')
    await writeFile(sourcePath, createMixedPdf())
    expect(
      await launched.page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.status()),
    ).toMatchObject({ locked: true })
    const result = await launched.app.evaluate(
      async ({ utilityProcess }, options) => {
        return new Promise<{
          replies: Array<{ id: number; result: ParseAndChunkResult }>
          progress: Array<{ requestId: number; done: number; total: number }>
          logs: string[]
          shutdownAcknowledged: boolean
          exitCode: number
          elapsedMs: number
        }>((resolveResult, reject) => {
          const started = Date.now()
          const replies: Array<{ id: number; result: ParseAndChunkResult }> = []
          const progress: Array<{ requestId: number; done: number; total: number }> = []
          const logs: string[] = []
          let shutdownAcknowledged = false
          let failure: Error | null = null
          let killTimer: ReturnType<typeof setTimeout> | undefined
          const child = utilityProcess.fork(options.workerPath, [], {
            stdio: 'pipe',
            serviceName: 'loklm-documents-ocr-test',
            env: { ...process.env, LOKLM_TESSDATA_DIR: options.tessdata },
          })
          const stop = (error: Error): void => {
            if (failure) return
            failure = error
            child.kill()
            killTimer = setTimeout(
              () => reject(new Error('OCR utility did not exit after forced stop')),
              3000,
            )
          }
          const timeout = setTimeout(
            () => stop(new Error('OCR utility exceeded 90 seconds')),
            90_000,
          )
          child.stdout?.on('data', (data) => logs.push(String(data)))
          child.stderr?.on('data', (data) => logs.push(String(data)))
          child.on('message', (message: DocWorkerMessage) => {
            if ('ev' in message) {
              if (message.ev === 'ocr')
                progress.push({
                  requestId: message.requestId,
                  done: message.done,
                  total: message.total,
                })
              else logs.push(message.message)
              return
            }
            if (!message.ok) {
              stop(new Error(message.error))
              return
            }
            if (message.id === 3) {
              shutdownAcknowledged = true
              return
            }
            replies.push({ id: message.id, result: message.result as ParseAndChunkResult })
            if (replies.length === 2) child.postMessage({ id: 3, op: 'shutdown' })
          })
          child.once('spawn', () => {
            for (const id of [1, 2])
              child.postMessage({
                id,
                op: 'documents.parseAndChunk',
                payload: {
                  sourcePath: options.sourcePath,
                  documentId: 1,
                  chunkSize: 2000,
                  chunkOverlap: 0,
                },
              })
          })
          child.once('exit', (exitCode) => {
            clearTimeout(timeout)
            if (killTimer) clearTimeout(killTimer)
            if (failure) {
              reject(failure)
              return
            }
            resolveResult({
              replies,
              progress,
              logs,
              shutdownAcknowledged,
              exitCode,
              elapsedMs: Date.now() - started,
            })
          })
        })
      },
      {
        sourcePath,
        workerPath: resolve('out/main/documentsWorker.js'),
        tessdata: resolve(process.env['LOKLM_TESSDATA_DIR'] ?? 'tessdata'),
      },
    )
    await writeFile(
      join(output, 'ocr.json'),
      JSON.stringify(
        {
          kind: 'native-documents-utility-ocr',
          startedAt,
          completedAt: new Date().toISOString(),
          compiledHashes,
          ...result,
        },
        null,
        2,
      ) + '\n',
    )
    expect(result.exitCode).toBe(0)
    expect(result.shutdownAcknowledged).toBe(true)
    expect(result.replies.map((reply) => reply.id).sort()).toEqual([1, 2])
    for (const { id, result: parsed } of result.replies) {
      expect(parsed.chunks.map((chunk) => [chunk.ordinal, chunk.pageFrom, chunk.pageTo])).toEqual([
        [0, 1, 1],
        [1, 2, 2],
      ])
      expect(parsed.chunks[0]?.text).toContain('ALPHA-TEXT-731')
      expect(parsed.chunks[0]?.text).not.toMatch(/BRAVO/i)
      expect(parsed.chunks[1]?.text).toMatch(/BRAVO\s+SCAN/i)
      expect(parsed.chunks[1]?.text).toContain('09:45')
      expect(parsed.chunks[1]?.text).toMatch(/Teilnehmerzahl\s+27/i)
      expect(parsed.chunks[1]?.text).toContain('B-14')
      expect(result.progress.filter((event) => event.requestId === id)).toEqual([
        { requestId: id, done: 1, total: 1 },
      ])
    }
    expect(result.logs.join('\n')).not.toMatch(/OCR failed|modelsWorker ready/i)
    expect(await fingerprintCompiledBuild()).toEqual(compiledHashes)
    expect(
      await launched.page.evaluate(() => (globalThis as unknown as { api: Api }).api.auth.status()),
    ).toMatchObject({ locked: true })
  } finally {
    await launched.cleanup()
  }
})
