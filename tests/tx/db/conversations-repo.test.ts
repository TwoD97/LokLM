import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupDb, teardownDb, withTransaction } from './helpers/withTransaction'
import { workspaces, documents, chunks } from '@main/db/schema'
import { ConversationsRepo } from '@main/db/database'

describe('ConversationsRepo (tx)', () => {
  beforeAll(setupDb, 30_000)
  afterAll(teardownDb)

  it('create + list returns the new conversation ordered by lastActivityAt desc', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const repo = new ConversationsRepo(tx as never)
      const a = await repo.create(ws!.id)
      const b = await repo.create(ws!.id, 'Named')
      const list = await repo.list(ws!.id)
      expect(list).toHaveLength(2)
      const titles = list.map((c) => c.title)
      expect(titles).toContain('Named')
      expect(titles).toContain(null)
      expect(list.find((c) => c.id === a.id)?.messageCount).toBe(0)
      expect(list.find((c) => c.id === b.id)?.messageCount).toBe(0)
    })
  })

  it('appendMessage writes a row and bumps message_count', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const repo = new ConversationsRepo(tx as never)
      const conv = await repo.create(ws!.id)
      const m1 = await repo.appendMessage(conv.id, 'user', 'hello')
      const m2 = await repo.appendMessage(conv.id, 'assistant', 'hi back')
      expect(m1.role).toBe('user')
      expect(m1.content).toBe('hello')
      expect(m2.role).toBe('assistant')
      const list = await repo.list(ws!.id)
      expect(list[0]!.messageCount).toBe(2)
    })
  })

  it('appendMessage rejects invalid role', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const repo = new ConversationsRepo(tx as never)
      const conv = await repo.create(ws!.id)
      await expect(repo.appendMessage(conv.id, 'banana' as 'user', 'x')).rejects.toThrow(/role/i)
    })
  })

  it('getWithMessages returns conversation + messages + citations grouped per message', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      const [chunk] = await tx
        .insert(chunks)
        .values({ documentId: doc!.id, ordinal: 0, text: 'snippet', tokenCount: 1 })
        .returning()
      const repo = new ConversationsRepo(tx as never)
      const conv = await repo.create(ws!.id, 'T')
      const user = await repo.appendMessage(conv.id, 'user', 'q?')
      const asst = await repo.appendMessage(conv.id, 'assistant', 'a.')
      await repo.persistCitations(asst.id, [{ doc_id: doc!.id, chunk_id: chunk!.id, score: 0.9 }])
      const out = await repo.getWithMessages(conv.id)
      expect(out.conversation.title).toBe('T')
      expect(out.messages).toHaveLength(2)
      expect(out.messages[0]!.id).toBe(user.id)
      expect(out.messages[0]!.citations).toHaveLength(0)
      expect(out.messages[1]!.id).toBe(asst.id)
      expect(out.messages[1]!.citations).toHaveLength(1)
      expect(out.messages[1]!.citations[0]!.chunkId).toBe(chunk!.id)
      expect(out.messages[1]!.citations[0]!.score).toBeCloseTo(0.9)
    })
  })

  it('delete cascades to messages and citations', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const [doc] = await tx
        .insert(documents)
        .values({ workspaceId: ws!.id, title: 'd', sourcePath: '/d', status: 'ready' })
        .returning()
      const [chunk] = await tx
        .insert(chunks)
        .values({ documentId: doc!.id, ordinal: 0, text: 'x', tokenCount: 1 })
        .returning()
      const repo = new ConversationsRepo(tx as never)
      const conv = await repo.create(ws!.id)
      const m = await repo.appendMessage(conv.id, 'assistant', 'a')
      await repo.persistCitations(m.id, [{ doc_id: doc!.id, chunk_id: chunk!.id, score: 1.0 }])
      await repo.delete(conv.id)
      const remaining = await tx.execute(
        sql`SELECT count(*)::int AS n FROM conversations WHERE id = ${conv.id}`,
      )
      expect((remaining.rows as { n: number }[])[0]!.n).toBe(0)
      const msgs = await tx.execute(
        sql`SELECT count(*)::int AS n FROM messages WHERE conversation_id = ${conv.id}`,
      )
      expect((msgs.rows as { n: number }[])[0]!.n).toBe(0)
      const cits = await tx.execute(
        sql`SELECT count(*)::int AS n FROM citations WHERE message_id = ${m.id}`,
      )
      expect((cits.rows as { n: number }[])[0]!.n).toBe(0)
    })
  })

  it('persistCitations is a no-op on empty list', async () => {
    await withTransaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'ws' }).returning()
      const repo = new ConversationsRepo(tx as never)
      const conv = await repo.create(ws!.id)
      const m = await repo.appendMessage(conv.id, 'assistant', 'a')
      await repo.persistCitations(m.id, [])
      const out = await repo.getWithMessages(conv.id)
      expect(out.messages[0]!.citations).toEqual([])
    })
  })

  it('list returns only conversations from the given workspace', async () => {
    await withTransaction(async (tx) => {
      const [a] = await tx.insert(workspaces).values({ name: 'a' }).returning()
      const [b] = await tx.insert(workspaces).values({ name: 'b' }).returning()
      const repo = new ConversationsRepo(tx as never)
      await repo.create(a!.id, 'in-a-1')
      await repo.create(a!.id, 'in-a-2')
      await repo.create(b!.id, 'in-b')
      const listA = await repo.list(a!.id)
      expect(listA.map((c) => c.title).sort()).toEqual(['in-a-1', 'in-a-2'])
      const listB = await repo.list(b!.id)
      expect(listB.map((c) => c.title)).toEqual(['in-b'])
    })
  })
})
