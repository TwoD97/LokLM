import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { runChatTurn, persistChatTurn } from '@main/services/qa/chatTurn'
import type { StreamEvent } from '@shared/documents'

describe('real chat turn persistence', () => {
  let dir: string
  let auth: AuthService
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-chat-turn-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Test', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('saves final-only text and final sources, then preserves an explicit failed partial on reload', async () => {
    const workspace = await new WorkspaceService(auth).create('Chat test')
    await auth.activate(workspace.id)
    const db = auth.requireDatabase()
    const store = await db.conversationsFor(workspace.id)
    const conversation = await store.create(workspace.id, 'Turn results')
    const docs = db.documents()
    const doc = await docs.addDocument({
      workspaceId: workspace.id,
      title: 'facts.md',
      sourcePath: '/facts.md',
      mimeType: 'text/markdown',
      byteSize: 40,
    })
    await docs.persistChunks(doc.id, [
      { ordinal: 0, text: 'Revenue is 42 EUR.', tokenCount: 5, pageFrom: null, pageTo: null },
    ])
    const [chunk] = await docs.listChunksForDocument(doc.id)
    const citation = { doc_id: doc.id, chunk_id: chunk!.id, score: 0.8 }
    const answer = `42 EUR. [doc:${doc.id}, chunk:${chunk!.id}]`
    const emitted: StreamEvent[] = []
    await runChatTurn({
      stream: async function* () {
        yield { type: 'done', full_text: answer, citations: [citation] }
      },
      signal: new AbortController().signal,
      language: 'en',
      emit: (event) => emitted.push(event),
      persist: (turn) => persistChatTurn(store, conversation.id, turn),
    })
    await runChatTurn({
      stream: async function* () {
        yield { type: 'citation', ...citation }
        yield { type: 'token', text: answer }
        yield { type: 'error', message: 'Inference failed' }
      },
      signal: new AbortController().signal,
      language: 'en',
      emit: (event) => emitted.push(event),
      persist: (turn) => persistChatTurn(store, conversation.id, turn),
    })
    const restored = (await store.getWithMessages(conversation.id))!
    expect(restored.messages.map((message) => message.content)).toEqual([
      answer,
      `${answer}\n\n_[The answer could not be completed.]_`,
    ])
    expect(
      restored.messages.map((message) => message.citations.map((source) => source.chunkId)),
    ).toEqual([[chunk!.id], [chunk!.id]])
    expect(
      emitted
        .filter((event) => event.type === 'done' || event.type === 'error')
        .map((event) => event.type),
    ).toEqual(['done', 'error'])
  })

  it('removes the assistant row after a real citation foreign-key failure', async () => {
    const workspace = await new WorkspaceService(auth).create('Chat test')
    await auth.activate(workspace.id)
    const store = await auth.requireDatabase().conversationsFor(workspace.id)
    const conversation = await store.create(workspace.id, 'Failed write')
    const result = await runChatTurn({
      stream: async function* () {
        yield {
          type: 'done',
          full_text: 'Claim [doc:999, chunk:999]',
          citations: [{ doc_id: 999, chunk_id: 999, score: 1 }],
        }
      },
      signal: new AbortController().signal,
      language: 'en',
      emit: () => {},
      persist: (turn) => persistChatTurn(store, conversation.id, turn),
    })
    expect(result.outcome).toBe('failed')
    expect(result.content).toContain('could not be saved')
    expect((await store.getWithMessages(conversation.id))!.messages).toEqual([])
  })
})
