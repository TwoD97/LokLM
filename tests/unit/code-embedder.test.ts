import { describe, it, expect } from 'vitest'
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

describe('code embedder selection (ADR-0006)', () => {
  it('recognises code-embedder GGUF filenames', () => {
    expect(isCodeEmbedderFile('jina-code-embeddings-0.5b-Q4_K_M.gguf')).toBe(true)
    expect(isCodeEmbedderFile('jina_code_0.5b.gguf')).toBe(true)
    expect(isCodeEmbedderFile('bge-m3-Q4_K_M.gguf')).toBe(false)
    expect(isCodeEmbedderFile('jina-code-embeddings.txt')).toBe(false)
  })

  it('prefers the code embedder only for codebase workspaces', () => {
    expect(prefersCodeEmbedder('codebase')).toBe(true)
    expect(prefersCodeEmbedder('library')).toBe(false)
  })

  it('defaults to the doc identity and never throws when switching preference (no worker)', async () => {
    const svc = new EmbeddingService() // no client
    expect(svc.activeIdentity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
    await svc.setPreferredKind('code') // no code model on disk → stays doc, no throw
    expect(svc.activeIdentity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
    await svc.setPreferredKind('doc')
    expect(svc.activeIdentity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
  })

  it('provider identity/dimension track the resident model', () => {
    const svc = new EmbeddingService()
    const provider = new BundledEmbedderProvider(svc)
    // no model loaded → doc defaults
    expect(provider.identity()).toBe(BUNDLED_EMBEDDER_IDENTITY)
    expect(provider.dimension()).toBe(1024)
    // simulate a resident code model
    ;(svc as unknown as { loadedPath: string }).loadedPath = '/models/jina-code-0.5b.gguf'
    expect(svc.activeIdentity()).toBe(CODE_EMBEDDER_IDENTITY)
    expect(provider.identity()).toBe(CODE_EMBEDDER_IDENTITY)
    expect(provider.dimension()).toBe(CODE_EMBEDDING_DIM)
  })
})
