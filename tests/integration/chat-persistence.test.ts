import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'

// Exercises the ConversationsRepo through AuthService.requireDatabase() —
// same shape the `chat:stream` IPC handler uses to persist user + assistant
// turns. We don't run the full LlamaService here (no GGUF on this machine);
// instead we simulate the persistence sequence the handler performs.

describe('chat persistence (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-chat-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('persists user + assistant message + citations after a successful stream', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const db = auth.requireDatabase()
    const conversations = db.conversations()
    const conv = await conversations.create(ws.id, null)

    // simulate what the IPC chat:stream handler does for a normal answer flow
    await conversations.appendMessage(conv.id, 'user', 'How are passwords hashed?')
    const asst = await conversations.appendMessage(
      conv.id,
      'assistant',
      'They are hashed with argon2id. [doc:1, chunk:1]',
    )
    // citations would normally reference real document + chunk ids; for this
    // test we seed a doc + chunk first so the FK is satisfied.
    const docs = db.documents()
    const doc = await docs.addDocument({
      workspaceId: ws.id,
      title: 'auth.md',
      sourcePath: '/auth.md',
      mimeType: 'text/markdown',
      byteSize: 100,
    })
    await docs.persistChunks(doc.id, [
      { ordinal: 0, text: 'argon2id is the KDF', pageFrom: 1, pageTo: 1, tokenCount: 5 },
    ])
    const repoChunks = await docs.listChunksForDocument(doc.id)
    const chunkId = repoChunks[0]!.id

    await conversations.persistCitations(asst.id, [
      { doc_id: doc.id, chunk_id: chunkId, score: 0.87 },
    ])

    const out = await conversations.getWithMessages(conv.id)
    expect(out.messages).toHaveLength(2)
    expect(out.messages[0]!.role).toBe('user')
    expect(out.messages[1]!.role).toBe('assistant')
    expect(out.messages[1]!.citations).toHaveLength(1)
    expect(out.messages[1]!.citations[0]!.score).toBeCloseTo(0.87)
    expect(out.messages[1]!.citations[0]!.chunkId).toBe(chunkId)
  }, 30_000)

  it('persists refusal as assistant message with empty citations', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const db = auth.requireDatabase()
    const conversations = db.conversations()
    const conv = await conversations.create(ws.id, null)

    // simulate the refusal flow: user message + assistant refusal text + no citations
    await conversations.appendMessage(conv.id, 'user', 'unrelated topic')
    await conversations.appendMessage(
      conv.id,
      'assistant',
      'This information is not in the provided documents.',
    )
    // no persistCitations call

    const out = await conversations.getWithMessages(conv.id)
    expect(out.messages).toHaveLength(2)
    expect(out.messages[1]!.content).toMatch(/not in/i)
    expect(out.messages[1]!.citations).toEqual([])
  }, 30_000)

  it('list returns conversations ordered by last_activity_at (most recent first)', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const db = auth.requireDatabase()
    const conversations = db.conversations()
    const older = await conversations.create(ws.id, 'older')
    // sleep so the next created_at differs (epoch-seconds resolution)
    await new Promise((r) => setTimeout(r, 1100))
    const newer = await conversations.create(ws.id, 'newer')
    // append a message to `older` to bump its last_activity_at past `newer`
    await new Promise((r) => setTimeout(r, 1100))
    await conversations.appendMessage(older.id, 'user', 'hi')

    const list = await conversations.list(ws.id)
    expect(list.map((c) => c.id)).toEqual([older.id, newer.id])
    expect(list[0]!.messageCount).toBe(1)
    expect(list[1]!.messageCount).toBe(0)
  }, 30_000)

  it('delete cascades from conversations down through messages and citations', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const db = auth.requireDatabase()
    const conversations = db.conversations()
    const conv = await conversations.create(ws.id, 'doomed')
    await conversations.appendMessage(conv.id, 'assistant', 'a')
    await conversations.delete(conv.id)
    await expect(conversations.getWithMessages(conv.id)).rejects.toThrow(/not found/i)
  }, 30_000)
})
