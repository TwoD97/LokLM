import { describe, it, expect } from 'vitest'
import {
  validateLicenses,
  type RegistryEntry,
  type PackRef,
} from '../evals/license/validate-model-licenses'

const reg: RegistryEntry[] = [
  {
    label: 'qwen3-8b',
    role: 'answer-llm',
    licenseClass: 'osi-permissive',
    allowedInDefaultMatrix: true,
  },
  {
    label: 'bge-m3',
    role: 'embedder',
    licenseClass: 'osi-permissive',
    allowedInDefaultMatrix: true,
  },
  {
    label: 'llama-3.2-3b',
    role: 'answer-llm',
    licenseClass: 'open-weight-non-osi',
    allowedInDefaultMatrix: false,
  },
  {
    label: 'jina-reranker-v2',
    role: 'reranker',
    licenseClass: 'non-commercial',
    allowedInDefaultMatrix: false,
  },
  {
    label: 'mistral-small-3.2-24b',
    role: 'judge',
    licenseClass: 'osi-permissive',
    allowedInDefaultMatrix: true,
  },
]

describe('validateLicenses', () => {
  it('passes when all pack refs are osi-permissive + allowed', () => {
    const refs: PackRef[] = [
      { label: 'qwen3-8b', role: 'answer-llm' },
      { label: 'bge-m3', role: 'embedder' },
      { label: 'mistral-small-3.2-24b', role: 'judge' },
    ]
    const r = validateLicenses(reg, refs)
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })
  it('fails on a non-osi (open-weight) model', () => {
    const r = validateLicenses(reg, [{ label: 'llama-3.2-3b', role: 'answer-llm' }])
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toContain('not osi-permissive')
  })
  it('fails on a non-commercial model', () => {
    const r = validateLicenses(reg, [{ label: 'jina-reranker-v2', role: 'reranker' }])
    expect(r.ok).toBe(false)
  })
  it('fails on a model missing from the registry', () => {
    const r = validateLicenses(reg, [{ label: 'mystery-model', role: 'embedder' }])
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toContain('registry')
  })
  it('fails on a role mismatch', () => {
    const r = validateLicenses(reg, [{ label: 'qwen3-8b', role: 'embedder' }])
    expect(r.ok).toBe(false)
  })
  it('fails on duplicate labels', () => {
    const r = validateLicenses(reg, [
      { label: 'qwen3-8b', role: 'answer-llm' },
      { label: 'qwen3-8b', role: 'answer-llm' },
    ])
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes('duplicate'))).toBe(true)
  })
})
