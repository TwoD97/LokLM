import 'dotenv/config'

// runpod pod-lifecycle CLI:
//   tsx tests/evals/runpod/pod.ts <start|stop|status> [--pod <id>]
//
// Liest RUNPOD_API_KEY und RUNPOD_POD_ID aus env (.env). Pod-ID per
// `--pod` ueberschreibbar.
//
// `start` ruft die RunPod-REST-API , gibt eine zusammenfassung mit
// Ollama-proxy-URL + SSH-endpoint aus , wartet (falls erreichbar) bis
// Ollama antwortet und laedt anschliessend bis zu drei modelle vor
// (keep_alive: -1):
//   OLLAMA_LLM_MODEL       via POST /api/generate
//   OLLAMA_EMBEDDER_MODEL  via POST /api/embed
//   OLLAMA_RERANKER_MODEL  via POST /api/generate
// Nicht-gesetzte vars werden uebersprungen. Einzelne fehler brechen den
// gesamtlauf nicht ab.
//
// `status` zeigt den pod-state plus probt Ollama.
// `stop`   faehrt den pod herunter.
//
// Manuell aufrufen: pnpm pod:start , pnpm pod:stop , pnpm pod:status.
// REST-endpoints: https://rest.runpod.io/v1 (bearer-token).

const BASE_URL = 'https://rest.runpod.io/v1'
const OLLAMA_PROXY_PORT = 11434
const PROBE_TIMEOUT_MS = 5000
const READY_POLL_INTERVAL_MS = 3000
const READY_TIMEOUT_MS = 5 * 60 * 1000
const WARMUP_TIMEOUT_MS = 5 * 60 * 1000
const PULL_TIMEOUT_MS = 30 * 60 * 1000
const LABEL_WIDTH = 12

interface PodDetails {
  id: string
  name?: string
  desiredStatus: string
  publicIp?: string
  portMappings?: Record<string, number>
  gpuCount?: number
  vcpuCount?: number
  memoryInGb?: number
  volumeMountPath?: string
  networkVolumeId?: string
}

interface OllamaTags {
  models?: Array<{ name: string }>
}

async function main(): Promise<void> {
  const { cmd, podOverride } = parseArgs(process.argv.slice(2))
  if (!cmd) usage('kein befehl angegeben')

  const apiKey = process.env['RUNPOD_API_KEY']
  if (!apiKey) fail('RUNPOD_API_KEY ist nicht gesetzt (siehe .env.example)')

  const podId = podOverride ?? process.env['RUNPOD_POD_ID']
  if (!podId) fail('RUNPOD_POD_ID ist nicht gesetzt (siehe .env.example)')

  switch (cmd) {
    case 'start':
      await startPod(apiKey, podId)
      return
    case 'stop':
      await stopPod(apiKey, podId)
      return
    case 'status':
      await showStatus(apiKey, podId)
      return
    default:
      usage(`unbekannter befehl: ${cmd}`)
  }
}

// --- pod-lifecycle --------------------------------------------------------

async function startPod(apiKey: string, podId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/pods/${podId}/start`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
  })
  const pod = await parsePodResponse(res, 'start')
  const ollamaUrl = resolveOllamaUrl(pod)

  console.log('pod gestartet')
  printPodSummary(pod, ollamaUrl)
  console.log('')

  await waitForOllama(ollamaUrl)

  const hasAny =
    !!process.env['OLLAMA_LLM_MODEL']?.trim() ||
    !!process.env['OLLAMA_EMBEDDER_MODEL']?.trim() ||
    !!process.env['OLLAMA_RERANKER_MODEL']?.trim()
  if (!hasAny) {
    console.log('warmup uebersprungen (keine OLLAMA_*_MODEL env-vars gesetzt)')
    return
  }
  console.log('')
  console.log('warmup:')
  await warmUpModels(ollamaUrl)
}

async function stopPod(apiKey: string, podId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/pods/${podId}/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const body = (await res.text()).trim()
    fail(`stop fehlgeschlagen: ${res.status} ${body}`)
  }
  await res.text() // body verwerfen ; nur das ok interessiert uns
  // Fuer eine huebsche zeile holen wir den pod-namen via GET nach.
  const detail = await fetchPodDetails(apiKey, podId).catch(() => null)
  const label = detail ? `${detail.name ?? '(unbenannt)'} (${detail.id})` : podId
  console.log(`pod gestoppt: ${label}`)
}

async function showStatus(apiKey: string, podId: string): Promise<void> {
  const pod = await fetchPodDetails(apiKey, podId)
  const ollamaUrl = resolveOllamaUrl(pod)
  const ollamaStatus = await probeOllama(ollamaUrl)
  console.log('pod')
  printPodSummary(pod, ollamaUrl, ollamaStatus)
}

async function fetchPodDetails(apiKey: string, podId: string): Promise<PodDetails> {
  const res = await fetch(`${BASE_URL}/pods/${podId}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
  return parsePodResponse(res, 'status')
}

async function parsePodResponse(res: Response, op: string): Promise<PodDetails> {
  if (!res.ok) {
    const body = (await res.text()).trim()
    fail(`${op} fehlgeschlagen: ${res.status} ${body}`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as PodDetails
  } catch {
    fail(`${op} antwort kein JSON: ${text.slice(0, 200)}`)
  }
}

// --- formatting -----------------------------------------------------------

function printPodSummary(pod: PodDetails, ollamaUrl: string, ollamaStatus?: string): void {
  console.log(row('name', `${pod.name ?? '(unbenannt)'} (${pod.id})`))
  console.log(row('status', pod.desiredStatus))
  const hw: string[] = []
  if (pod.gpuCount) hw.push(`${pod.gpuCount}x GPU`)
  if (pod.vcpuCount) hw.push(`${pod.vcpuCount} vCPU`)
  if (pod.memoryInGb) hw.push(`${pod.memoryInGb} GB RAM`)
  if (hw.length) console.log(row('hardware', hw.join(' , ')))
  if (pod.volumeMountPath) {
    const vol = pod.networkVolumeId
      ? `${pod.volumeMountPath} (${pod.networkVolumeId})`
      : pod.volumeMountPath
    console.log(row('volume', vol))
  }
  console.log(row('ollama', ollamaStatus ? `${ollamaUrl}  (${ollamaStatus})` : ollamaUrl))
  const sshPort = pod.portMappings?.['22']
  if (pod.publicIp && sshPort) {
    console.log(row('ssh', `root@${pod.publicIp} -p ${sshPort}`))
  }
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`
}

function resolveOllamaUrl(pod: PodDetails): string {
  const fromEnv = process.env['OLLAMA_BASE_URL']?.trim()
  if (fromEnv) return stripSlash(fromEnv)
  return `https://${pod.id}-${OLLAMA_PROXY_PORT}.proxy.runpod.net`
}

// --- ollama probes --------------------------------------------------------

async function probeOllama(baseUrl: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      headers: buildOllamaHeaders(),
      signal: ctrl.signal,
    })
    if (!res.ok) return `unreachable (${res.status})`
    const data = (await res.json()) as OllamaTags
    const n = data.models?.length ?? 0
    return `bereit , ${n} modell${n === 1 ? '' : 'e'}`
  } catch (err) {
    return `unreachable (${(err as Error).message})`
  } finally {
    clearTimeout(timer)
  }
}

async function waitForOllama(baseUrl: string): Promise<void> {
  const url = `${baseUrl}/api/tags`
  console.log(`warte auf Ollama: ${url}`)
  const headers = buildOllamaHeaders()
  const t0 = Date.now()
  const deadline = t0 + READY_TIMEOUT_MS
  let lastTick = t0
  while (Date.now() < deadline) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal })
      if (res.ok) {
        const data = (await res.json()) as OllamaTags
        const n = data.models?.length ?? 0
        const dt = ((Date.now() - t0) / 1000).toFixed(0)
        console.log(`ollama bereit (${n} modell${n === 1 ? '' : 'e'} , ${dt}s)`)
        return
      }
    } catch {
      /* erwartet waehrend boot ; weiter pollen */
    } finally {
      clearTimeout(timer)
    }
    const now = Date.now()
    if (now - lastTick >= 15_000) {
      console.log(row('', `...noch nicht bereit (${((now - t0) / 1000).toFixed(0)}s)`))
      lastTick = now
    }
    await sleep(READY_POLL_INTERVAL_MS)
  }
  fail(`ollama wurde nicht innerhalb von ${READY_TIMEOUT_MS / 1000}s erreichbar`)
}

// --- warm-up --------------------------------------------------------------

async function warmUpModels(baseUrl: string): Promise<void> {
  const llm = process.env['OLLAMA_LLM_MODEL']?.trim()
  const emb = process.env['OLLAMA_EMBEDDER_MODEL']?.trim()
  const rerank = process.env['OLLAMA_RERANKER_MODEL']?.trim()
  if (llm) await warmGenerate(baseUrl, llm, 'llm')
  if (emb) await warmEmbed(baseUrl, emb, 'embedder')
  if (rerank) await warmGenerate(baseUrl, rerank, 'reranker')
}

async function warmGenerate(baseUrl: string, model: string, label: string): Promise<void> {
  const pulled = await ensurePulled(baseUrl, model, label)
  if (!pulled) return
  const body = JSON.stringify({ model, prompt: 'hi', stream: false, keep_alive: -1 })
  await warmCall(`${baseUrl}/api/generate`, body, label, pulled)
}

async function warmEmbed(baseUrl: string, model: string, label: string): Promise<void> {
  const pulled = await ensurePulled(baseUrl, model, label)
  if (!pulled) return
  const body = JSON.stringify({ model, input: 'hi', keep_alive: -1 })
  await warmCall(`${baseUrl}/api/embed`, body, label, pulled)
}

/**
 * Pull idempotent. Wenn das modell schon lokal ist , kehrt der call sofort
 * zurueck ; sonst laedt Ollama es ins persistent-volume (so es ueber
 * OLLAMA_MODELS dorthin gemappt ist , siehe .env.example).
 * Gibt die pull-dauer in sekunden zurueck , oder null bei fehler.
 */
async function ensurePulled(
  baseUrl: string,
  model: string,
  label: string,
): Promise<{ pullSec: string } | null> {
  console.log(row(label, `pulling ${model}`))
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...buildOllamaHeaders(),
  }
  const body = JSON.stringify({ name: model, stream: false })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PULL_TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers,
      body,
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200)
      console.log(row(label, `pull-fehler: ${res.status} ${text}`))
      return null
    }
    await res.json()
    return { pullSec: ((Date.now() - t0) / 1000).toFixed(1) }
  } catch (err) {
    console.log(row(label, `pull-fehler: ${(err as Error).message}`))
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function warmCall(
  url: string,
  body: string,
  label: string,
  pulled: { pullSec: string },
): Promise<void> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...buildOllamaHeaders(),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), WARMUP_TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200)
      console.log(row(label, `load-fehler: ${res.status} ${text}`))
      return
    }
    await res.json()
    const loadSec = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(row(label, `ready (pull ${pulled.pullSec}s , load ${loadSec}s)`))
  } catch (err) {
    console.log(row(label, `load-fehler: ${(err as Error).message}`))
  } finally {
    clearTimeout(timer)
  }
}

// --- utils ----------------------------------------------------------------

function buildOllamaHeaders(): Record<string, string> {
  const bearer = process.env['OLLAMA_BEARER_TOKEN']
  return bearer ? { authorization: `Bearer ${bearer}` } : {}
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv: string[]): { cmd?: string; podOverride?: string } {
  const out: { cmd?: string; podOverride?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--pod' && next !== undefined) {
      out.podOverride = next
      i++
    } else if (a && !a.startsWith('--') && !out.cmd) {
      out.cmd = a
    }
  }
  return out
}

function usage(msg: string): never {
  console.error(`fehler: ${msg}`)
  console.error('usage: tsx tests/evals/runpod/pod.ts <start|stop|status> [--pod <id>]')
  process.exit(1)
}

function fail(msg: string): never {
  console.error(`fehler: ${msg}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
