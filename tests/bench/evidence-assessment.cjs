// Opt-in native model assessment probe. No application main, user vault or BrowserWindow.
// Prepare plans with evidenceOrderPlans.ts AFTER building the candidate worker.
// LOKLM_NATIVE_EVIDENCE=1 node tests/bench/evidence-assessment.cjs --plans=<file> --out=<new-dir>
const { createHash } = require('node:crypto')
const {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} = require('node:fs')
const { resolve, join, dirname, basename, relative, isAbsolute, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { assertPreparedPlans, selectEvidenceCases } = require('./evidence-selection.cjs')
const root = resolve(__dirname, '../..')
const flag = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const inside = (parent, child) => {
  const rel = relative(parent, child)
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
function removeOwnedProfile(userData, tempParent) {
  const target = resolve(userData)
  if (dirname(target) !== tempParent || !basename(target).startsWith('loklm-evidence-order-'))
    throw new Error('Refusing cleanup outside the owned temporary profile')
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

if (process.env.LOKLM_NATIVE_EVIDENCE !== '1') {
  throw new Error('Set LOKLM_NATIVE_EVIDENCE=1 only with an exclusive native/GPU slot')
}
const electron = require('electron')
if (typeof electron === 'string') {
  ;(async () => {
    const plansArg = flag('plans')
    const outArg = flag('out')
    if (!plansArg || !outArg)
      throw new Error('Both --plans=<file> and --out=<new-dir> are required')
    const plansPath = resolve(plansArg)
    const output = resolve(outArg)
    if (!inside(join(root, 'out'), output))
      throw new Error('Output must be a new directory inside repo out/')
    const prepared = JSON.parse(readFileSync(plansPath, 'utf8'))
    assertPreparedPlans(prepared)
    const selection = selectEvidenceCases(prepared.cases, flag('cases'))
    for (const [path, expected] of Object.entries(prepared.sourceHashes)) {
      const target = resolve(root, path)
      if (!inside(root, target) || (await hashFile(target)) !== expected)
        throw new Error(`Prepared source/worker fingerprint changed: ${path}`)
    }
    const modelPath = resolve(root, prepared.modelFile)
    if (!inside(join(root, 'models'), modelPath))
      throw new Error('Model must be inside repo models/')
    mkdirSync(output, { recursive: false })
    const metadata = {
      kind:
        prepared.kind === 'native-literal-json-plans'
          ? 'native-literal-json-control'
          : 'native-evidence-order',
      startedAt: new Date().toISOString(),
      prepared,
      model: {
        path: prepared.modelFile,
        bytes: statSync(modelPath).size,
        sha256: await hashFile(modelPath),
      },
      configuration: {
        temperature: 0,
        noThink: true,
        requireComplete: true,
        questionTimeoutMs: 240000,
        selectedCases: selection.selectedCases,
        unrequestedCases: selection.unrequestedCases,
      },
      observations: [],
    }
    writeFileSync(join(output, 'raw.json'), JSON.stringify(metadata, null, 2) + '\n')
    const tempParent = resolve(tmpdir())
    const userData = mkdtempSync(join(tempParent, 'loklm-evidence-order-'))
    try {
      const env = {
        ...process.env,
        LOKLM_EVIDENCE_PROBE_OUTPUT: output,
        LOKLM_EVIDENCE_PROBE_TEMP: userData,
        LOKLM_DATA_DIR: join(userData, 'vault'),
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
      if (code !== 0) throw new Error(`Assessment probe exited ${code}; inspect partial raw.json`)
    } finally {
      removeOwnedProfile(userData, tempParent)
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, utilityProcess } = electron
  const userData = process.env.LOKLM_EVIDENCE_PROBE_TEMP
  const output = process.env.LOKLM_EVIDENCE_PROBE_OUTPUT
  if (!userData || !output || !inside(join(root, 'out'), resolve(output)))
    throw new Error('Missing isolated launch metadata')
  app.setPath('userData', userData)
  const rawPath = join(output, 'raw.json')
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  const flush = () => writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n')
  let worker
  let seq = 0
  const pending = new Map()
  const logs = []
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
      const env = { ...process.env, LOKLM_PRIMARY_BACKEND: 'auto' }
      delete env.LLAMA_GPU
      worker = utilityProcess.fork(join(root, 'out/main/modelsWorker.js'), [], {
        stdio: 'inherit',
        env,
      })
      worker.on('message', (response) => {
        const message = response.data ?? response
        if (message.ev === 'log')
          logs.push({ at: new Date().toISOString(), message: message.message })
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
          modelPath: resolve(root, raw.prepared.modelFile),
          weightsBytes: raw.model.bytes,
          profileName: 'full',
          profileDefaultContext: 32768,
          userContextChoice: raw.prepared.requestedContext,
          envContextOverride: raw.prepared.requestedContext,
          language: 'en',
          systemPrompt: 'Assess only supplied evidence.',
          device: { expectedName: null, expectedKind: null },
        })
        raw.loadMs = Date.now() - started
        raw.resources = await request('planner.refresh')
        if (!raw.resources.hasGpu || !(raw.loadResult.modelCapacity?.gpuLayers > 0))
          throw new Error('Probe requires native GPU inference; CPU-only is not accepted')
        if (raw.loadResult.plan?.contextSize !== raw.prepared.requestedContext)
          throw new Error('Actual context differs from prepared assessment context')
        flush()
        const selection = selectEvidenceCases(
          raw.prepared.cases,
          raw.configuration.selectedCases?.join(','),
        )
        for (const entry of selection.cases) {
          const startedAt = Date.now()
          const logStart = logs.length
          const observation = {
            caseId: entry.caseId,
            order: entry.order,
            startedAt: new Date(startedAt).toISOString(),
          }
          try {
            const result = await request(
              'llm.generateRaw',
              {
                streamId: `assessment-${entry.caseId}-${entry.order}`,
                ...entry.plan,
                temperature: 0,
                noThink: true,
                requireComplete: true,
                plannedContextTokens: raw.prepared.requestedContext,
              },
              raw.configuration.questionTimeoutMs,
            )
            observation.raw = result.raw
            if (raw.prepared.kind === 'native-literal-json-plans') {
              const decoded = JSON.parse(result.raw)
              observation.literalMatchesExpected =
                decoded !== null &&
                typeof decoded === 'object' &&
                !Array.isArray(decoded) &&
                Object.keys(decoded).length === 1 &&
                decoded.quote === entry.expectedLiteral
              if (!observation.literalMatchesExpected)
                throw new Error('Structured output did not preserve the exact synthetic literal')
            }
          } catch (error) {
            observation.error = error instanceof Error ? error.message : String(error)
            code = 1
          }
          observation.totalMs = Date.now() - startedAt
          observation.logs = logs.slice(logStart)
          raw.observations.push(observation)
          flush()
          console.log(
            JSON.stringify({
              caseId: entry.caseId,
              order: entry.order,
              totalMs: observation.totalMs,
              error: observation.error ?? null,
            }),
          )
          // A token-limit/parser failure may leave a healthy worker. A timeout kills it.
          if (observation.error?.includes('did not settle')) break
        }
        raw.completedAt = new Date().toISOString()
      } catch (error) {
        raw.failure = error instanceof Error ? error.message : String(error)
        code = 1
      } finally {
        raw.logs = logs
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
