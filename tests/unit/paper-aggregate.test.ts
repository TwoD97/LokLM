import { describe, it, expect } from 'vitest'
import {
  COLUMNS,
  isSweepSummary,
  baseName,
  toRow,
  toCsv,
  toLatex,
  escapeLatex,
  type ConfigResult,
  type DatasetInfo,
  type EnvSnapshot,
} from '../evals/aggregate-paper'

// fixtures — gebaut nach der echten summary.json/env.json-form (siehe
// tests/evals/report/runs/<...>/). Bewusst minimal: nur die felder die der
// aggregator liest.
const dataset: DatasetInfo = {
  path: 'C:\\Users\\x\\LokLM\\tests\\evals\\data\\datasets\\xquad-de-300q.json',
  sha256: '8f9cd55cc28abd88',
}
const env: EnvSnapshot = {
  git: { shortSha: '004896e', dirty: true },
  hardware: { cpuModel: '12th Gen Intel(R) Core(TM) i5-12500H', totalRamGB: 31.7 },
}
const baseResult: ConfigResult = {
  config: 'matrix_norr',
  numQueries: 5,
  recallAt5: 0.8,
  recallAt10: 0.8,
  recallRequiredAt5: 0.8,
  recallRequiredAt12: 0.8,
  mrr: 0.6666666666666666,
  ndcgAt10: 0.7,
  phased: { ttft: { p50: 266.4891 } },
  judgeAvg: null,
  composite: 0.6667,
}

describe('isSweepSummary', () => {
  it('unterscheidet sweep- von pack-summary am dataset-feld', () => {
    // sweep: hat dataset + results
    expect(isSweepSummary({ results: [], dataset: { path: 'x', sha256: 'y' } })).toBe(true)
    // pack: pack/results/failures/skipped , KEIN dataset → wird übersprungen
    expect(isSweepSummary({ pack: 'p.json', results: [], failures: [], skipped: [] })).toBe(false)
    expect(isSweepSummary(null)).toBe(false)
  })
})

describe('baseName', () => {
  it('zieht den dateinamen aus Windows- UND POSIX-pfaden', () => {
    expect(baseName('C:\\a\\b\\xquad.json')).toBe('xquad.json')
    expect(baseName('/home/u/loklm/data/focused.json')).toBe('focused.json')
  })
})

describe('toRow', () => {
  it('mappt die metriken + zieht provenienz aus env', () => {
    const row = toRow(baseResult, dataset, env)
    expect(row.dataset).toBe('xquad-de-300q.json') // basename eines Windows-pfads
    expect(row.config).toBe('matrix_norr')
    expect(row.n).toBe('5')
    expect(row['recall@5']).toBe('0.800')
    expect(row.MRR).toBe('0.667')
    expect(row['TTFT-p50']).toBe('266') // auf ganze ms gerundet
    expect(row['git-sha']).toBe('004896e')
    expect(row.dirty).toBe('true')
    expect(row.CPU).toContain('i5-12500H')
    expect(row.RAM).toBe('31.7')
    expect(row['dataset-sha256']).toBe('8f9cd55cc28abd88')
  })

  it('schreibt "-" für alle judge-spalten wenn judgeAvg null ist (--no-llm-lauf)', () => {
    const row = toRow(baseResult, dataset, env)
    expect(row.judge).toBe('-')
    expect(row.correctness).toBe('-')
    expect(row.groundedness).toBe('-')
    expect(row.helpfulness).toBe('-')
  })

  it('füllt die judge-spalten wenn judgeAvg vorhanden ist', () => {
    const withJudge: ConfigResult = {
      ...baseResult,
      judgeAvg: { score: 0.82, correctness: 0.9, groundedness: 0.8, helpfulness: 0.75 },
    }
    const row = toRow(withJudge, dataset, env)
    expect(row.judge).toBe('0.820')
    expect(row.correctness).toBe('0.900')
  })
})

describe('toCsv', () => {
  it('header ist exakt COLUMNS (eine quelle der wahrheit)', () => {
    const csv = toCsv([toRow(baseResult, dataset, env)])
    expect(csv.split('\n')[0]).toBe(COLUMNS.join(','))
  })

  it('quotet zellen mit komma (CPU-modelle können kommas tragen)', () => {
    const weird: EnvSnapshot = {
      ...env,
      hardware: { cpuModel: 'CPU, mit komma', totalRamGB: 16 },
    }
    const csv = toCsv([toRow(baseResult, dataset, weird)])
    expect(csv).toContain('"CPU, mit komma"')
  })
})

describe('toLatex / escapeLatex', () => {
  it('escapet underscores in config- und spalten-namen', () => {
    expect(escapeLatex('matrix_norr')).toBe('matrix\\_norr')
    expect(escapeLatex('recall_req@5')).toBe('recall\\_req@5')
  })

  it('baut eine booktabs-longtable mit escapeten zellen', () => {
    const tex = toLatex([toRow(baseResult, dataset, env)])
    expect(tex).toContain('\\begin{longtable}')
    expect(tex).toContain('\\toprule')
    expect(tex).toContain('\\bottomrule')
    expect(tex).toContain('matrix\\_norr') // config-name escaped
  })
})
