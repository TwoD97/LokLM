import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  isCodeEmbedderFile,
  prefersCodeEmbedder,
  CODE_EMBEDDER_IDENTITY,
  CODE_EMBEDDING_DIM,
} from '@main/services/codebase/codeEmbedder'
import {
  EmbeddingService,
  BUNDLED_EMBEDDER_IDENTITY,
} from '@main/services/embeddings/EmbeddingService'
import { BundledEmbedderProvider } from '@main/services/providers/bundled/BundledEmbedderProvider'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('@main/services/models/paths', () => ({
  getModelSearchDirs: () => [],
  resolveModelFile: (name: string) => files.get(name) ?? null,
}))
vi.mock('@main/services/tier/TierMarker', () => ({ isCodebaseIndexingEnabled: () => true }))
beforeEach(() => files.clear())

describe('code embedder selection (ADR-0006)', () => {
  it('reports actual local residency separately from ready-but-parked status', () => {
    let ready = true
    let resident = false
    const provider = new BundledEmbedderProvider({
      isReady: () => ready,
      getStatus: () => ({ resident }),
    } as never)
    expect(provider.isReady()).toBe(true)
    expect(provider.isResident()).toBe(false)
    resident = true
    expect(provider.isResident()).toBe(true)
    ready = false
    expect(provider.isResident()).toBe(false)
  })
  it('recognises code-embedder GGUF filenames', () => {
    expect(isCodeEmbedderFile('Qwen3-Embedding-0.6B-Q8_0.gguf')).toBe(true)
    expect(isCodeEmbedderFile('qwen3_embedding_0.6b.gguf')).toBe(true)
    expect(isCodeEmbedderFile('bge-m3-Q4_K_M.gguf')).toBe(false)
    // jina-code is no longer the code embedder (crashes on iGPU Vulkan).
    expect(isCodeEmbedderFile('jina-code-embeddings-0.5b-Q4_K_M.gguf')).toBe(false)
    expect(isCodeEmbedderFile('Qwen3-Embedding-0.6B.txt')).toBe(false)
  })

  it('prefers the code embedder only for codebase workspaces', () => {
    expect(prefersCodeEmbedder('codebase')).toBe(true)
    expect(prefersCodeEmbedder('library')).toBe(false)
  })

  it('uses the BGE fallback identity when no model is installed or loaded', () => {
    // Avoid coupling this unit test to the developer's real models directory.
    const svc = new EmbeddingService() // no client, no model resident
    expect(svc.activeIdentity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
  })

  it('reports the configured Qwen target before load so backfill does not misclassify existing vectors', () => {
    files.set('Qwen3-Embedding-0.6B-Q8_0.gguf', '/models/Qwen3-Embedding-0.6B-Q8_0.gguf')
    const svc = new EmbeddingService()
    expect(svc.activeIdentity()).toBe(CODE_EMBEDDER_IDENTITY)
    expect(new BundledEmbedderProvider(svc).dimension()).toBe(CODE_EMBEDDING_DIM)
    // A resident model still wins over the prospective tier target.
    ;(svc as unknown as { loadedPath: string }).loadedPath = '/models/bge-m3-Q4_K_M.gguf'
    expect(svc.activeIdentity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
  })

  it('provider identity/dimension track the resident model', () => {
    const svc = new EmbeddingService()
    const provider = new BundledEmbedderProvider(svc)
    // no model loaded → doc defaults
    expect(provider.identity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
    expect(provider.dimension()).toBe(1024)
    // simulate a resident code model
    ;(svc as unknown as { loadedPath: string }).loadedPath =
      '/models/Qwen3-Embedding-0.6B-Q8_0.gguf'
    expect(svc.activeIdentity()).toBe(CODE_EMBEDDER_IDENTITY)
    expect(provider.identity()).toBe(CODE_EMBEDDER_IDENTITY)
    expect(provider.dimension()).toBe(CODE_EMBEDDING_DIM)
  })
})
