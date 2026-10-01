import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { WorkspaceDb } from '@main/db/sqlite/WorkspaceDb'
import type { DeleteConversationTurnInput } from '@shared/documents'

describe('atomic regeneration of the latest encrypted conversation turn', () => {
  let directory: string
  let path: string
  let key: string
  let db: WorkspaceDb
  let input: DeleteConversationTurnInput
  let prefixIds: number[]
  let citedChunkId: number

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'loklm-regenerate-'))
    path = join(directory, 'meta.db')
    key = randomBytes(32).toString('hex')
    db = await WorkspaceDb.open(path, key, 3)
    const conversation = await db.createConversation('Synthetic conversation')
    const firstUser = await db.appendMessage(conversation.id, 'user', 'First question')
    const firstAssistant = await db.appendMessage(conversation.id, 'assistant', 'First answer')
    const user = await db.appendMessage(conversation.id, 'user', 'Retry this question')
    const assistant = await db.appendMessage(conversation.id, 'assistant', 'Original answer')
    prefixIds = [firstUser.id, firstAssistant.id]
    input = {
      workspaceId: 3,
      conversationId: conversation.id,
      userMessageId: user.id,
      assistantMessageId: assistant.id,
    }
    const source = await db.addDocument({ title: 'Synthetic source', sourcePath: '/fixture.md' })
    const [chunk] = await db.persistChunks(source.id, [
      { ordinal: 0, text: 'The total is 42.', tokenCount: 5, pageFrom: null, pageTo: null },
    ])
    citedChunkId = chunk!
    await db.persistCitations(assistant.id, [{ chunk_id: citedChunkId, score: 0.9 }])
  })

  afterEach(async () => {
    db?.close()
    await rm(directory, { recursive: true, force: true })
  })

  async function ids(): Promise<number[]> {
    return (await db.getConversationWithMessages(input.conversationId))!.messages.map(
      (message) => message.id,
    )
  }

  it('deletes both messages and their citations together, preserving the preceding history on reopen', async () => {
    await db.deleteLatestTurn(input)
    db.close()
    db = await WorkspaceDb.open(path, key, 3)
    expect(await ids()).toEqual(prefixIds)
    const raw = (db as unknown as { db: Database.Database }).db
    expect(raw.prepare('SELECT COUNT(*) AS count FROM citations').get()).toEqual({ count: 0 })
    expect(await db.getChunkWithContext(citedChunkId, 0, 0)).toHaveLength(1)
  })

  it('rejects non-latest, mismatched, wrong-role, missing-conversation and wrong-workspace pairs without changing history', async () => {
    const original = await ids()
    const other = await db.createConversation('Another conversation')
    const otherUser = await db.appendMessage(other.id, 'user', 'Unrelated question')
    const otherAssistant = await db.appendMessage(other.id, 'assistant', 'Unrelated answer')
    const invalid = [
      { ...input, userMessageId: prefixIds[0]!, assistantMessageId: prefixIds[1]! },
      { ...input, userMessageId: prefixIds[0]! },
      {
        ...input,
        userMessageId: input.assistantMessageId,
        assistantMessageId: input.userMessageId,
      },
      { ...input, userMessageId: otherUser.id, assistantMessageId: otherAssistant.id },
      { ...input, conversationId: other.id },
      { ...input, conversationId: 99999 },
      { ...input, workspaceId: 4 },
    ]
    for (const stale of invalid) {
      await expect(db.deleteLatestTurn(stale)).rejects.toThrow()
      expect(await ids()).toEqual(original)
    }
    expect((await db.getConversationWithMessages(other.id))!.messages).toHaveLength(2)
  })

  it('rejects a previously read pair after a newer question is appended', async () => {
    const newer = await db.appendMessage(input.conversationId, 'user', 'Newer question')
    await expect(db.deleteLatestTurn(input)).rejects.toThrow('Conversation changed')
    expect(await ids()).toEqual([
      ...prefixIds,
      input.userMessageId,
      input.assistantMessageId,
      newer.id,
    ])
  })

  it('allows only one of two simultaneous stale requests to delete the exchange', async () => {
    const results = await Promise.allSettled([
      db.deleteLatestTurn(input),
      db.deleteLatestTurn(input),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await ids()).toEqual(prefixIds)
  })

  it('rolls back the first delete and cascading citations when SQLite aborts the second delete', async () => {
    const raw = (db as unknown as { db: Database.Database }).db
    raw.exec(`CREATE TRIGGER fail_regenerate_user BEFORE DELETE ON messages
      WHEN OLD.id = ${input.userMessageId}
      BEGIN SELECT RAISE(ABORT, 'Synthetic second-delete failure'); END`)
    await expect(db.deleteLatestTurn(input)).rejects.toThrow('Synthetic second-delete failure')
    db.close()
    db = await WorkspaceDb.open(path, key, 3)
    expect(await ids()).toEqual([...prefixIds, input.userMessageId, input.assistantMessageId])
    const restored = (await db.getConversationWithMessages(input.conversationId))!.messages.at(-1)!
    expect(restored.content).toBe('Original answer')
    expect(restored.citations.map((citation) => citation.chunkId)).toEqual([citedChunkId])
  })
})
