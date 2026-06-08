import { describe, it, expect } from 'vitest'
import { parseArgs, buildSweepArgs } from '../evals/run-datasets'

describe('parseArgs', () => {
  it('splittet --datasets in eine getrimmte liste', () => {
    const a = parseArgs(['--datasets', 'a.json, b.json ,c.json'])
    expect(a.datasets).toEqual(['a.json', 'b.json', 'c.json'])
  })

  it('default: leere datensatz-liste (-> default-set in main) , kein judge', () => {
    const a = parseArgs([])
    expect(a.datasets).toEqual([])
    expect(a.judge).toBe(false)
    expect(a.limit).toBeUndefined()
  })

  it('liest --limit , --judge , --judge-path', () => {
    const a = parseArgs(['--judge', '--judge-path', 'models/j.gguf', '--limit', '20'])
    expect(a.judge).toBe(true)
    expect(a.judgePath).toBe('models/j.gguf')
    expect(a.limit).toBe(20)
  })
})

describe('buildSweepArgs', () => {
  it('startet immer mit --configs matrix --dataset <pfad>', () => {
    const out = buildSweepArgs('d.json', { datasets: [], judge: false })
    expect(out.slice(0, 5)).toEqual([
      'tests/evals/sweep.ts',
      '--configs',
      'matrix',
      '--dataset',
      'd.json',
    ])
  })

  it('default-modus: --no-llm , KEIN --judge (retrieval-only)', () => {
    const out = buildSweepArgs('d.json', { datasets: [], judge: false })
    expect(out).toContain('--no-llm')
    expect(out).not.toContain('--judge')
  })

  it('judge-modus: --judge + --judge-path , NIE zusammen mit --no-llm', () => {
    const out = buildSweepArgs('d.json', { datasets: [], judge: true, judgePath: 'j.gguf' })
    expect(out).toContain('--judge')
    expect(out).toContain('--judge-path')
    expect(out).toContain('j.gguf')
    // die kern-invariante: sweep wirft bei --judge + --no-llm
    expect(out).not.toContain('--no-llm')
  })

  it('reicht --limit durch', () => {
    const out = buildSweepArgs('d.json', { datasets: [], judge: false, limit: 5 })
    expect(out[out.indexOf('--limit') + 1]).toBe('5')
  })
})
