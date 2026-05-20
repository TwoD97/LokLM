// perf-helpers für scale-evals und sweep-runs.
//
// LatencyTracker — einfache p50/p95-aggregation für eine einzelne metrik.
// PhasedTimer    — pro query: zerlegt die TTFT in die 6 RAG-phasen.
// PhasedSummary  — aggregiert phasen-timings über alle queries einer config.
// ResourceSampler — sampler im hintergrund , schreibt rss / vram-free / cpu%
//                   alle ~250ms in eine flat-jsonl. wird beim sweep mitgespeichert.

export class LatencyTracker {
  private samples: number[] = []

  /** wrap callback , misst dauer in ms und legt sie als sample ab */
  async time<T>(fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    const result = await fn()
    this.samples.push(performance.now() - start)
    return result
  }

  add(ms: number): void {
    this.samples.push(ms)
  }

  summary(): LatencySummary {
    return summarizeSamples(this.samples)
  }
}

export interface LatencySummary {
  n: number
  p50: number
  p95: number
  max: number
  mean: number
}

function summarizeSamples(samples: number[]): LatencySummary {
  if (samples.length === 0) return { n: 0, p50: 0, p95: 0, max: 0, mean: 0 }
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  }
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[idx]!
}

export interface MemorySnapshot {
  rssMiB: number
  heapUsedMiB: number
  heapTotalMiB: number
}

export function memorySnapshot(): MemorySnapshot {
  const m = process.memoryUsage()
  return {
    rssMiB: m.rss / 1024 / 1024,
    heapUsedMiB: m.heapUsed / 1024 / 1024,
    heapTotalMiB: m.heapTotal / 1024 / 1024,
  }
}

/** ein vollständig gesamter perf-record pro (library × config) */
export interface PerfReport {
  buildMs: number
  query: LatencySummary
  memoryAfterBuildMiB: number
  memoryAfterRunMiB: number
}

// ---------------------------------------------------------------------------
// PhasedTimer — zerlegt eine einzelne ask-pipeline in die 6 phasen die für
// fine-tuning interessant sind. start() / stop(phase) pro abschnitt; am ende
// gibt es ein Snapshot.
//
// Phasen-konvention (einheitlich für alle bridges):
//   queryEmbed    — embedder forward pass auf der frage
//   retrieve      — BM25 + dense + RRF , also alles bis zur top-K liste
//   rerank        — cross-encoder pass , 0ms wenn rerank disabled
//   promptAssemble — buildPrompt etc , trivial aber gemessen für vollständigkeit
//   prefill       — LLM verarbeitet prompt-tokens. zeit zwischen request und
//                   erstem ausgehenden token
//   firstDecode   — erster on-text-chunk callback. zeit von prefill-ende bis
//                   tatsächlich erstem token. zusammen mit prefill = TTFT
//   fullResponse  — gesamte generation bis return. nicht teil von TTFT , aber
//                   nützlich zum vergleichen.
export type Phase =
  | 'queryEmbed'
  | 'retrieve'
  | 'rerank'
  | 'promptAssemble'
  | 'prefill'
  | 'firstDecode'
  | 'fullResponse'

export const TTFT_PHASES: ReadonlyArray<Exclude<Phase, 'fullResponse'>> = [
  'queryEmbed',
  'retrieve',
  'rerank',
  'promptAssemble',
  'prefill',
  'firstDecode',
]

export interface PhasedSnapshot {
  /** millisekunden pro phase. 0 wenn phase nicht gelaufen ist (z.B. rerank skipped). */
  phases: Record<Phase, number>
  /** summe der TTFT-phasen (alle außer fullResponse). */
  ttftMs: number
  /** fullResponse falls gemessen , sonst null. */
  fullResponseMs: number | null
}

export class PhasedTimer {
  private timings: Partial<Record<Phase, number>> = {}
  private active: { phase: Phase; start: number } | null = null

  /** misst die dauer von fn() und legt sie unter `phase` ab. */
  async measure<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await fn()
    } finally {
      this.timings[phase] = (this.timings[phase] ?? 0) + (performance.now() - start)
    }
  }

  /** manueller start/stop für phasen die in einem callback enden (z.B. firstDecode). */
  start(phase: Phase): void {
    if (this.active) this.stop()
    this.active = { phase, start: performance.now() }
  }

  /** stoppt die aktive phase. ohne aktive phase ist es ein no-op. */
  stop(): void {
    if (!this.active) return
    const dur = performance.now() - this.active.start
    this.timings[this.active.phase] = (this.timings[this.active.phase] ?? 0) + dur
    this.active = null
  }

  /** roh-millis für eine phase setzen. nützlich wenn ein bridge die zeit selbst misst. */
  set(phase: Phase, ms: number): void {
    this.timings[phase] = ms
  }

  snapshot(): PhasedSnapshot {
    const phases = {
      queryEmbed: this.timings.queryEmbed ?? 0,
      retrieve: this.timings.retrieve ?? 0,
      rerank: this.timings.rerank ?? 0,
      promptAssemble: this.timings.promptAssemble ?? 0,
      prefill: this.timings.prefill ?? 0,
      firstDecode: this.timings.firstDecode ?? 0,
      fullResponse: this.timings.fullResponse ?? 0,
    } satisfies Record<Phase, number>
    const ttftMs = TTFT_PHASES.reduce((s, p) => s + phases[p], 0)
    return {
      phases,
      ttftMs,
      fullResponseMs: phases.fullResponse > 0 ? phases.fullResponse : null,
    }
  }
}

/** Aggregiert PhasedSnapshots aus vielen queries einer config. */
export interface PhasedSummary {
  perPhase: Record<Phase, LatencySummary>
  ttft: LatencySummary
  fullResponse: LatencySummary
}

export function summarizePhases(snapshots: PhasedSnapshot[]): PhasedSummary {
  const allPhases: Phase[] = [
    'queryEmbed',
    'retrieve',
    'rerank',
    'promptAssemble',
    'prefill',
    'firstDecode',
    'fullResponse',
  ]
  const perPhase = {} as Record<Phase, LatencySummary>
  for (const p of allPhases) {
    perPhase[p] = summarizeSamples(snapshots.map((s) => s.phases[p]))
  }
  return {
    perPhase,
    ttft: summarizeSamples(snapshots.map((s) => s.ttftMs)),
    fullResponse: summarizeSamples(
      snapshots.map((s) => s.fullResponseMs).filter((m): m is number => m !== null),
    ),
  }
}

// ---------------------------------------------------------------------------
// ResourceSampler — pollt rss + vram-free + cpu% in einem festen interval.
// vramProbe wird vom aufrufer injiziert (typischerweise eine closure die
// ResourcePlanner.refresh() aufruft und freeVramGB zurückgibt) , damit der
// sampler keine direkte abhängigkeit zur node-llama-cpp init hat.

export interface ResourceSample {
  /** sekunden seit start() , gerundet auf 0.01s */
  t: number
  rssMiB: number
  heapUsedMiB: number
  /** durchschnittliche cpu-auslastung über das letzte interval , 0..1. */
  cpuLoad: number
  /** freie vram in gb , oder null wenn keine probe verfügbar. */
  freeVramGB: number | null
}

export interface ResourceSamplerOpts {
  /** sample-interval in ms. 250 ms ist ein guter kompromiss zwischen auflösung
   *  und sampler-overhead. */
  intervalMs?: number
  /** optionale closure die freie vram in gb liefert. fehler werden geschluckt
   *  und als null geloggt. */
  vramProbe?: () => Promise<number | null>
}

export class ResourceSampler {
  private samples: ResourceSample[] = []
  private timer: NodeJS.Timeout | null = null
  private t0 = 0
  private lastCpu: { user: number; system: number; wallMs: number } | null = null
  // probe-aufrufe sind async , wir wollen aber nicht in jedem tick eine neue
  // probe queue-en wenn die alte noch läuft. inFlight gate verhindert backlog.
  private probeInFlight = false
  private lastVram: number | null = null

  constructor(private readonly opts: ResourceSamplerOpts = {}) {}

  start(): void {
    if (this.timer) return
    this.t0 = performance.now()
    this.lastCpu = readCpu()
    this.samples = []
    const interval = this.opts.intervalMs ?? 250
    this.timer = setInterval(() => this.tick(), interval)
    // first sample sofort , damit jeder run mindestens einen datenpunkt hat.
    this.tick()
  }

  stop(): ResourceSample[] {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    return [...this.samples]
  }

  /** label-marker , wird vom run-writer optional verwendet um phasen-grenzen
   *  einzuzeichnen. wir packen labels nicht ins sample selbst , um die jsonl
   *  schmal zu halten — der writer kann marker separat schreiben falls nötig. */
  markedAt(label: string): { t: number; label: string } {
    return { t: (performance.now() - this.t0) / 1000, label }
  }

  private tick(): void {
    const wallMs = performance.now()
    const t = (wallMs - this.t0) / 1000
    const mem = process.memoryUsage()
    const cpu = readCpu()
    let cpuLoad = 0
    if (this.lastCpu) {
      const dWall = wallMs - this.lastCpu.wallMs
      const dCpu = cpu.user + cpu.system - this.lastCpu.user - this.lastCpu.system
      // microseconds → ms , dann anteil der wandzeit
      cpuLoad = dWall > 0 ? Math.min(1, dCpu / 1000 / dWall) : 0
    }
    this.lastCpu = cpu
    // vram-probe asynchron starten , mit gate gegen backlog.
    if (this.opts.vramProbe && !this.probeInFlight) {
      this.probeInFlight = true
      this.opts
        .vramProbe()
        .then((v) => {
          this.lastVram = v
        })
        .catch(() => {
          this.lastVram = null
        })
        .finally(() => {
          this.probeInFlight = false
        })
    }
    this.samples.push({
      t: Math.round(t * 100) / 100,
      rssMiB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMiB: Math.round(mem.heapUsed / 1024 / 1024),
      cpuLoad: Math.round(cpuLoad * 1000) / 1000,
      freeVramGB: this.lastVram,
    })
  }
}

function readCpu(): { user: number; system: number; wallMs: number } {
  const c = process.cpuUsage()
  return { user: c.user, system: c.system, wallMs: performance.now() }
}
