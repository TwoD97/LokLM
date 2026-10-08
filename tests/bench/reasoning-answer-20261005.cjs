// Previously-observed full-context DEV diagnostic; model and compiled worker hashes are frozen per plan.
// LOKLM_NATIVE_REASONING_ANSWER=1 node tests/bench/reasoning-answer-20261005.cjs --plans=<file> --out=<new-dir>
const { createHash } = require('node:crypto')
const {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  statSync,
} = require('node:fs')
const { resolve, join, dirname, basename, relative, isAbsolute, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const root = resolve(__dirname, '../..')
const flag = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const inside = (parent, child) => {
  const rel = relative(parent, child)
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
function removeOwnedProfile(userData, tempParent) {
  const target = resolve(userData)
  if (dirname(target) !== tempParent || !basename(target).startsWith('loklm-reasoning-20261005-'))
    throw new Error('Unsafe temporary profile cleanup')
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function compiledHashes() {
  const paths = []
  const walk = (path) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && /\.(?:js|cjs|mjs)$/i.test(entry.name)) paths.push(child)
    }
  }
  walk('out/main')
  walk('out/preload')
  return Object.fromEntries(
    await Promise.all(paths.sort().map(async (path) => [path, await hashFile(join(root, path))])),
  )
}
function assertPlans(prepared) {
  if (
    prepared.kind !== 'native-reasoning-answer-20261005' ||
    prepared.schemaVersion !== 1 ||
    prepared.requestedContext !== 8192 ||
    prepared.cases?.length !== 6
  )
    throw new Error('Expected the fixed six-case reasoning experiment')
  const counts = new Map()
  const arms = ['A', 'B']
  for (const entry of prepared.cases) {
    const key = `${entry.caseId}/${entry.arm}`
    if (
      !arms.includes(entry.arm) ||
      counts.has(key) ||
      !entry.plan?.prompt ||
      !entry.plan?.systemPrompt ||
      entry.plan.maxTokens !== 512
    )
      throw new Error('Invalid or duplicate matched cell')
    counts.set(key, true)
  }
  const ids = [...new Set(prepared.cases.map((entry) => entry.caseId))]
  if (ids.length !== 6 || new Set(prepared.cases.map((entry) => entry.arm)).size !== 1)
    throw new Error('Every selected case must occur exactly once')
}

if (process.env.LOKLM_NATIVE_REASONING_ANSWER !== '1')
  throw new Error('Set LOKLM_NATIVE_REASONING_ANSWER=1 only with an exclusive native/GPU slot')
const electron = require('electron')
if (typeof electron === 'string') {
  ;(async () => {
    if (!flag('plans') || !flag('out')) throw new Error('--plans and --out are required')
    const output = resolve(flag('out'))
    if (!inside(join(root, 'out'), output))
      throw new Error('Output must be a new directory inside out/')
    const prepared = JSON.parse(readFileSync(resolve(flag('plans')), 'utf8'))
    assertPlans(prepared)
    if (JSON.stringify(await compiledHashes()) !== JSON.stringify(prepared.compiledBuildHashes))
      throw new Error('Compiled worker changed after planning')
    // Rendered prompts are frozen in the plan. Later production edits are not executed.
    for (const [path, expected] of Object.entries(prepared.sourceHashes).filter(([path]) =>
      path.startsWith('tests/'),
    ))
      if (!inside(root, resolve(root, path)) || (await hashFile(join(root, path))) !== expected)
        throw new Error(`Evaluation helper changed: ${path}`)
    for (const entry of prepared.recordedInputs)
      if (
        !inside(root, resolve(root, entry.path)) ||
        (await hashFile(join(root, entry.path))) !== entry.sha256
      )
        throw new Error(`Recorded evidence changed: ${entry.path}`)
    const modelPath = resolve(root, prepared.model.path)
    if (!inside(join(root, 'models'), modelPath)) throw new Error('Model must be inside models/')
    if (
      statSync(modelPath).size !== prepared.model.bytes ||
      (await hashFile(modelPath)) !== prepared.model.sha256
    )
      throw new Error('Model bytes differ from recorded E')
    mkdirSync(output, { recursive: false })
    writeFileSync(
      join(output, 'raw.json'),
      JSON.stringify(
        {
          kind: 'native-reasoning-answer-20261005',
          startedAt: new Date().toISOString(),
          prepared,
          configuration: {
            ...prepared.configuration,
            temperatureSource:
              'Installed node-llama-cpp prompt default (0), unchanged compiled llm.ask path',
            transport:
              'A: llm.setLanguage then llm.ask; B: llm.generateRaw with schema. Both reset history and use the compiled repeat penalty (window256, penalty1.1, frequency0.15).',
            retrieval: 'replayed recorded packed hits; no retrieval/model handoffs',
          },
          observations: [],
        },
        null,
        2,
      ) + '\n',
    )
    const tempParent = resolve(tmpdir())
    const userData = mkdtempSync(join(tempParent, 'loklm-reasoning-20261005-'))
    try {
      const env = {
        ...process.env,
        LOKLM_REASONING_PROBE_OUTPUT: output,
        LOKLM_REASONING_PROBE_TEMP: userData,
        LOKLM_DATA_DIR: join(userData, 'vault'),
        LOKLM_RETRIEVAL_TRACE: '1',
      }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const child = spawn(electron, [__filename], {
        cwd: root,
        env,
        stdio: 'inherit',
        windowsHide: true,
      })
      const [code] = await once(child, 'exit')
      if (code !== 0)
        throw new Error(`Reasoning diagnostic exited ${code}; partial results are retained`)
    } finally {
      removeOwnedProfile(userData, tempParent)
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, utilityProcess } = electron
  const output = process.env.LOKLM_REASONING_PROBE_OUTPUT
  const userData = process.env.LOKLM_REASONING_PROBE_TEMP
  if (!output || !userData || !inside(join(root, 'out'), resolve(output)))
    throw new Error('Missing isolated metadata')
  app.setPath('userData', userData)
  const rawPath = join(output, 'raw.json')
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  const flush = () => writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n')
  const logs = []
  const pending = new Map()
  let worker
  let seq = 0
  let activeObservation
  const request = (op, payload, timeoutMs = 180000) =>
    new Promise((resolveRequest, reject) => {
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${op} did not settle within ${timeoutMs} ms`))
        worker.kill()
      }, timeoutMs)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolveRequest(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      worker.postMessage(payload ? { id, op, payload } : { id, op })
    })
  app
    .whenReady()
    .then(async () => {
      worker = utilityProcess.fork(join(root, 'out/main/modelsWorker.js'), [], {
        stdio: 'inherit',
        env: { ...process.env, LOKLM_PRIMARY_BACKEND: 'auto' },
      })
      worker.on('message', (response) => {
        const message = response.data ?? response
        if (message.ev === 'log')
          logs.push({ at: new Date().toISOString(), message: message.message })
        if (message.ev === 'token' && activeObservation) {
          activeObservation.streamedText += message.text ?? ''
          if (activeObservation.firstVisibleTextMs === null && (message.text ?? '').trim())
            activeObservation.firstVisibleTextMs = Date.now() - activeObservation.startedAtMs
        }
        if (message.id == null) return
        const caller = pending.get(message.id)
        pending.delete(message.id)
        if (message.ok) caller?.resolve(message.result)
        else caller?.reject(new Error(message.error))
      })
      const exited = once(worker, 'exit')
      worker.on('exit', (code) => {
        for (const caller of pending.values()) caller.reject(new Error(`Worker exited ${code}`))
        pending.clear()
      })
      let code = 0
      try {
        await Promise.race([
          once(worker, 'spawn'),
          exited.then(() => {
            throw new Error('Worker exited before spawn')
          }),
        ])
        const started = Date.now()
        raw.loadResult = await request('llm.load', {
          modelPath: resolve(root, raw.prepared.model.path),
          weightsBytes: raw.prepared.model.bytes,
          profileName: 'full',
          profileDefaultContext: 32768,
          userContextChoice: 8192,
          envContextOverride: 8192,
          language: 'en',
          systemPrompt: raw.prepared.cases[0].plan.systemPrompt,
          device: { expectedName: null, expectedKind: null },
        })
        raw.loadMs = Date.now() - started
        raw.resources = await request('planner.refresh')
        if (
          !raw.resources.hasGpu ||
          !(raw.loadResult.modelCapacity?.gpuLayers > 0) ||
          raw.loadResult.plan?.contextSize !== 8192
        )
          throw new Error('Matched probe requires actual 8K GPU inference')
        flush()
        for (const entry of raw.prepared.cases) {
          const logStart = logs.length
          const observation = {
            caseId: entry.caseId,
            arm: entry.arm,
            startedAt: new Date().toISOString(),
            startedAtMs: Date.now(),
            firstVisibleTextMs: null,
            streamedText: '',
          }
          activeObservation = observation
          try {
            await request('llm.setLanguage', {
              lang: entry.language,
              systemPrompt: entry.plan.systemPrompt,
            })
            const structured = entry.arm === 'B'
            const result = await request(
              structured ? 'llm.generateRaw' : 'llm.ask',
              {
                streamId: `reasoning-${entry.caseId}-${entry.arm}`,
                question: entry.question,
                prompt: entry.plan.prompt,
                maxTokens: 512,
                plannedContextTokens: 8192,
                noThink: true,
                ...(structured
                  ? {
                      jsonSchema: entry.plan.jsonSchema,
                      systemPrompt: entry.plan.systemPrompt,
                      temperature: 0,
                      requireComplete: true,
                    }
                  : {}),
              },
              180000,
            )
            observation.raw = result.raw
          } catch (error) {
            observation.error = error instanceof Error ? error.message : String(error)
            code = 1
          }
          observation.totalMs = Date.now() - observation.startedAtMs
          delete observation.startedAtMs
          observation.logs = logs.slice(logStart)
          raw.observations.push(observation)
          activeObservation = undefined
          flush()
          console.log(
            JSON.stringify({
              caseId: entry.caseId,
              arm: entry.arm,
              totalMs: observation.totalMs,
              error: observation.error ?? null,
            }),
          )
          if (
            observation.error?.includes('did not settle') ||
            observation.error?.includes('Worker exited')
          )
            break
        }
        raw.completedAt = new Date().toISOString()
      } catch (error) {
        raw.failure = error instanceof Error ? error.message : String(error)
        code = 1
      } finally {
        raw.logs = logs
        raw.compiledBuildHashesAfter = await compiledHashes()
        raw.compiledBuildUnchanged =
          JSON.stringify(raw.compiledBuildHashesAfter) ===
          JSON.stringify(raw.prepared.compiledBuildHashes)
        if (!raw.compiledBuildUnchanged) {
          raw.failure = 'Compiled worker changed during the diagnostic'
          code = 1
        }
        flush()
        worker.kill()
        await exited
        app.exit(code)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
