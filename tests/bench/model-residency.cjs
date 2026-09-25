// Real-model Electron regression test. Run from the repo with:
// pnpm test:models                         (both startup orders)
// pnpm test:models --order=chat-first      (one order)
// Requires the Standard models in models/. No user vault is opened.
const electron = require('electron')
const { spawn } = require('node:child_process')
const { resolve, join } = require('node:path')
const { mkdtempSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { once } = require('node:events')
const root = resolve(__dirname, '../..')

if (typeof electron === 'string') {
  // Launch Electron without inheriting Codex/IDE's run-as-Node setting.
  const requested = process.argv.find((arg) => arg.startsWith('--order='))?.split('=')[1]
  const orders = requested ? [requested] : ['embedder-first', 'chat-first']
  if (orders.some((order) => !['embedder-first', 'chat-first'].includes(order))) {
    throw new Error('Use --order=embedder-first or --order=chat-first')
  }
  ;(async () => {
    for (const order of orders) {
      const userData = mkdtempSync(join(tmpdir(), 'loklm-residency-'))
      try {
        const env = { ...process.env, LOKLM_SMOKE_ORDER: order, LOKLM_SMOKE_USER_DATA: userData }
        delete env.ELECTRON_RUN_AS_NODE
        const child = spawn(electron, [__filename], {
          cwd: root,
          env,
          stdio: 'inherit',
          windowsHide: true,
        })
        const [code] = await once(child, 'exit')
        if (code !== 0) throw new Error(`Model residency smoke failed: ${order}, exit ${code}`)
      } finally {
        rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, utilityProcess } = electron
  app.setPath('userData', process.env.LOKLM_SMOKE_USER_DATA)
  let worker
  let seq = 0
  const pending = new Map()
  const results = []
  function request(op, payload) {
    return new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      worker.postMessage(payload ? { id, op, payload } : { id, op })
    })
  }
  const fixture = (filename, contextSize) => {
    const modelPath = join(root, 'models', filename)
    return { modelPath, weightsBytes: statSync(modelPath).size, contextSize, placement: 'auto' }
  }
  async function run(label, operation) {
    const started = Date.now()
    const result = await operation()
    if (result?.resolvedPlacement === 'cpu') throw new Error(`${label} used CPU-only inference`)
    const entry = { label, ms: Date.now() - started, result }
    results.push(entry)
    console.log(JSON.stringify(entry))
    return result
  }
  app
    .whenReady()
    .then(async () => {
      const env = { ...process.env, LOKLM_PRIMARY_BACKEND: 'auto' }
      delete env.LLAMA_GPU
      worker = utilityProcess.fork(join(root, 'out/main/modelsWorker.js'), [], {
        stdio: 'inherit',
        env,
      })
      worker.on('message', (response) => {
        const msg = response.data ?? response
        if (msg.ev === 'log') console.log('WORKER', msg.message)
        if (msg.id == null) return
        const caller = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.ok) caller?.resolve(msg.result)
        else caller?.reject(new Error(msg.error))
      })
      const exited = once(worker, 'exit')
      worker.on('exit', (code) => {
        for (const caller of pending.values()) caller.reject(new Error(`Worker exited ${code}`))
        pending.clear()
      })
      const timer = setTimeout(() => {
        console.error('Model residency smoke timed out')
        worker.kill()
        app.exit(1)
      }, 240000)
      let exitCode = 0
      try {
        await Promise.race([
          once(worker, 'spawn'),
          exited.then(([code]) => {
            throw new Error(`Worker exited before spawn: ${code}`)
          }),
        ])
        const embed = fixture('Qwen3-Embedding-0.6B-Q8_0.gguf', 2048)
        const rank = fixture('bge-reranker-v2-m3-Q4_K_M.gguf', 1024)
        const chat = {
          ...fixture('Qwen3.5-4B-Q4_K_M.gguf', 8192),
          profileName: 'full',
          profileDefaultContext: 32768,
          userContextChoice: 'auto',
          envContextOverride: null,
          language: 'en',
          systemPrompt: 'Answer briefly.',
          device: { expectedName: null, expectedKind: null },
        }
        const order = process.env.LOKLM_SMOKE_ORDER
        if (order === 'chat-first') {
          await run('chat load', () => request('llm.load', chat))
          await run('embedder load', () => request('embedder.load', embed))
        } else {
          await run('embedder load', () => request('embedder.load', embed))
          await run('chat load', () => request('llm.load', chat))
        }
        const resources = await run('GPU resources', () => request('planner.refresh'))
        // Vulkan reports the 4 GB GTX 1050 Ti as ~4.1 GiB. Mirror the policy's
        // device-class tolerance, not a strict decimal 4.0 cutoff.
        const useReranker = resources.hasGpu && resources.totalVramGB > 4.5
        if (useReranker) {
          await run('reranker load', () => request('reranker.load', rank))
        } else {
          await run('reranker skipped by Auto', async () => {
            try {
              await request('reranker.load', rank)
            } catch (error) {
              if (!String(error).includes('Reranking is skipped in Auto')) throw error
              return { skipped: true, totalVramGB: resources.totalVramGB }
            }
            throw new Error('Auto loaded a reranker on a constrained GPU')
          })
        }
        const embedded = await run('embedding', () =>
          request('embedder.embed', {
            texts: ['The library opens at nine.'],
          }).then((vectors) => ({ count: vectors.length, dimension: vectors[0]?.length })),
        )
        if (embedded.count !== 1 || !embedded.dimension) throw new Error('Invalid embedding')
        if (useReranker) {
          const scores = await run('ranking', () =>
            request('reranker.rank', {
              query: 'library opening time',
              documents: ['The library opens at nine.', 'Cats like to sleep.'],
            }),
          )
          if (
            !scores ||
            scores.length !== 2 ||
            !scores.every(Number.isFinite) ||
            scores[0] <= scores[1]
          ) {
            throw new Error('Invalid ranking')
          }
        }
        const translate = (prompt, streamId) =>
          request('llm.generateRaw', {
            streamId,
            prompt,
            systemPrompt: 'Translate the source text into German. Return only the translation.',
            maxTokens: 128,
            temperature: 0,
            noThink: true,
            requireComplete: true,
          })
        await run('restore chat after retrieval', () => request('gpu.restoreChat'))
        const translated = await run('translation', () =>
          translate('Where is the library?', 'smoke'),
        )
        if (!translated.raw.trim()) throw new Error('Blank translation')
        await run('chat reload', () => request('llm.load', chat))
        const retranslated = await run('translation after reload', () =>
          translate('Good morning.', 'smoke-again'),
        )
        if (!retranslated.raw.trim()) throw new Error('Blank translation after reload')
        await run('chat unload', () => request('llm.unload'))
        await run('embedder unload', () => request('embedder.unload'))
        await run('reranker unload', () => request('reranker.unload'))
        writeFileSync(
          join(root, `out/model-residency-${order}.json`),
          JSON.stringify(results, null, 2),
        )
        console.log('SMOKE PASSED', order)
      } catch (error) {
        console.error(error)
        exitCode = 1
      } finally {
        worker.kill()
        await exited
        clearTimeout(timer)
        app.exit(exitCode)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
