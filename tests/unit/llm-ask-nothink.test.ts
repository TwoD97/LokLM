import { describe, it, expect, vi } from 'vitest'
import { LlamaService } from '@main/services/llm/LlamaService'
import type { ModelsWorkerClient } from '@main/services/workers/ModelsWorkerClient'
import type { LlmAskPayload } from '@main/services/workers/protocol'
import type { ModelStatus } from '@shared/documents'
import type { RetrievalHit } from '@shared/documents'

// Build a ready LlamaService whose worker returns a fixed `raw` string from
// llm.ask, with a no-op stream (the mock never feeds chunks, so `accumulated`
// stays empty — exactly the case where the renderer received nothing).
function makeService(raw: string): {
  svc: LlamaService
  captured: () => LlmAskPayload | undefined
} {
  let statusListener: ((patch: Partial<ModelStatus>) => void) | undefined
  let captured: LlmAskPayload | undefined
  const client = {
    setStatusListener: vi.fn((_kind: string, cb: (patch: Partial<ModelStatus>) => void) => {
      statusListener = cb
    }),
    registerStream: vi.fn(() => () => undefined),
    llmAsk: vi.fn(async (p: LlmAskPayload) => {
      captured = p
      return { raw }
    }),
    llmAbort: vi.fn().mockResolvedValue(undefined),
  } as unknown as ModelsWorkerClient
  const svc = new LlamaService({ client })
  statusListener!({ state: 'ready' })
  return { svc, captured: () => captured }
}

function hit(text: string): RetrievalHit {
  return {
    chunk_id: 1,
    document_id: 2,
    document_title: 'Skript',
    ordinal: 0,
    page_from: null,
    page_to: null,
    heading_path: null,
    text,
    score: 0.9,
    language: 'de',
  }
}

describe('LlamaService.askWithModel noThink', () => {
  it('passes noThink to the worker llm.ask payload', async () => {
    const { svc, captured } = makeService('answer')
    const out = await svc.ask('how?', [])
    expect(out).toBe('answer')
    expect(captured()?.noThink).toBe(true)
  })
})

// Recovery (ADR-0008 follow-up / 0.6.2): the lite 2B GGUF sometimes ignores
// /no_think and emits a pure or UNCLOSED <think> block. The streaming ThinkFilter
// swallows every chunk (renderer sees nothing) and stripThink — which only
// matches CLOSED <think>…</think> — returns '' or the literal tag. Left alone
// that is an invisible blank answer. askWithModel must recover into a non-blank
// turn and re-emit it so it both renders and persists.
describe('LlamaService.askWithModel empty/think-only recovery', () => {
  it('recovers an UNCLOSED <think> block into its content (not a blank, no tag)', async () => {
    const chunks: string[] = []
    const { svc } = makeService('<think>Ein Interpreter führt Befehle direkt aus')
    const out = await svc.ask('Was ist ein Interpreter?', [], { onChunk: (t) => chunks.push(t) })
    expect(out).toBe('Ein Interpreter führt Befehle direkt aus')
    expect(out).not.toContain('<think')
    // nothing streamed during generation → the recovered text is re-emitted so
    // the renderer shows it AND the main process persists it (it only persists
    // when at least one token streamed).
    expect(chunks.join('')).toContain('Ein Interpreter führt Befehle direkt aus')
  })

  it('falls back to the retrieved Context when the model emits only a closed think block', async () => {
    const { svc } = makeService('<think>just reasoning, no answer</think>')
    const out = await svc.ask('Was ist ein Interpreter?', [
      hit('Interpreter sind langsamer als Compiler.'),
    ])
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('Interpreter sind langsamer als Compiler.')
  })

  it('still returns a normal answer unchanged (no recovery when output is clean)', async () => {
    const { svc } = makeService('<think>reason</think>Ein Interpreter ist ein Programm.')
    const out = await svc.ask('Was ist ein Interpreter?', [])
    expect(out).toBe('Ein Interpreter ist ein Programm.')
  })
})
