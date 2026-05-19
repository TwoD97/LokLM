// perf-helpers für scale-evals. latency tracker sammelt timings pro query
// und liefert p50/p95/max. memory snapshot liest rss + heap aus process.

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
    if (this.samples.length === 0) {
      return { n: 0, p50: 0, p95: 0, max: 0, mean: 0 }
    }
    const sorted = [...this.samples].sort((a, b) => a - b)
    return {
      n: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1]!,
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    }
  }
}

export interface LatencySummary {
  n: number
  p50: number
  p95: number
  max: number
  mean: number
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
