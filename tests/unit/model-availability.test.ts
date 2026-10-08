import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as availability from '../../src/main/services/models/availability'
import * as paths from '../../src/main/services/models/paths'
import * as tier from '../../src/main/services/tier/TierMarker'

vi.mock('../../installer-wizard/model-manifest.json', () => ({
  default: {
    tiers: {
      lite: {
        models: [
          {
            id: 'current-llm',
            role: 'llm',
            filename: 'Qwen3.5-4B-Q4_K_M.gguf',
            sizeBytes: 16,
            url: 'https://example.invalid/current-llm',
            sha256: null,
          },
          {
            id: 'current-embedder',
            role: 'embedder',
            filename: 'embedder.gguf',
            sizeBytes: 8,
            url: 'https://example.invalid/embedder',
            sha256: null,
          },
          {
            id: 'current-reranker',
            role: 'reranker',
            filename: 'reranker.gguf',
            sizeBytes: 8,
            url: 'https://example.invalid/reranker',
            sha256: null,
          },
        ],
      },
    },
  },
}))

let directory: string
let wizard: string
let user: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loklm-model-status-'))
  wizard = join(directory, 'installed')
  user = join(directory, 'user')
  mkdirSync(wizard)
  mkdirSync(user)
  vi.spyOn(paths, 'getDownloadTargetDir').mockReturnValue(user)
  vi.spyOn(paths, 'resolveWizardModelsDir').mockReturnValue(wizard)
  vi.spyOn(paths, 'resolveModelFile').mockImplementation(
    (filename) => [wizard, user].map((dir) => join(dir, filename)).find(existsSync) ?? null,
  )
  vi.spyOn(tier, 'readTierMarker').mockReturnValue({
    tier: 'lite',
    installedAt: '',
    installerVersion: '0.7.0',
    models: [],
    ollamaConnector: false,
  })
  writeFileSync(join(wizard, 'embedder.gguf'), Buffer.alloc(8))
  writeFileSync(join(wizard, 'reranker.gguf'), Buffer.alloc(8))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

describe('installed model readiness', () => {
  it('does not declare a marker-only install ready when its LLM is missing', () => {
    const status = availability.checkAll()
    expect(status.allRequiredReady).toBe(false)
    expect(status.models.find((model) => model.kind === 'llm')).toMatchObject({
      id: 'current-llm',
      required: true,
      present: false,
      resolvedPath: null,
    })
  })

  it('preserves legitimate legacy and custom GGUFs during startup model checks', () => {
    const legacy = join(user, 'Qwen3.5-4B-Q4_K_M.gguf')
    const custom = join(user, 'my-custom-model.gguf')
    writeFileSync(legacy, Buffer.alloc(16, 7))
    writeFileSync(custom, 'user-owned model')
    const status = availability.checkAll()
    expect(readFileSync(legacy)).toEqual(Buffer.alloc(16, 7))
    expect(readFileSync(custom, 'utf8')).toBe('user-owned model')
    expect(status.allRequiredReady).toBe(true)
    expect(status.models.find((model) => model.kind === 'llm')?.resolvedPath).toBe(legacy)
  })

  it('requires a regular complete LLM file, not a partial file or directory', () => {
    writeFileSync(join(user, 'Qwen3.5-4B-Q4_K_M.gguf.partial'), Buffer.alloc(16))
    expect(availability.checkAll().allRequiredReady).toBe(false)
    mkdirSync(join(wizard, 'Qwen3.5-4B-Q4_K_M.gguf'))
    expect(availability.checkAll().models.find((model) => model.kind === 'llm')?.present).toBe(
      false,
    )
  })
})
