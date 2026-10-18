import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillAction } from '../../src/shared/connections'

// Exercise actual SQLite SQL/migrations without requiring Electron's SQLCipher
// binary in unit tests. Encryption itself is covered by the native vault suites.
vi.mock('better-sqlite3-multiple-ciphers', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  return {
    default: class {
      private db: InstanceType<typeof DatabaseSync>
      constructor(path: string) {
        this.db = new DatabaseSync(path)
      }
      pragma(sql: string) {
        return this.db.prepare(`PRAGMA ${sql}`).all()
      }
      exec(sql: string) {
        this.db.exec(sql)
      }
      prepare(sql: string) {
        return this.db.prepare(sql)
      }
      close() {
        this.db.close()
      }
      transaction<T>(work: () => T): () => T {
        return () => {
          this.db.exec('BEGIN')
          try {
            const result = work()
            this.db.exec('COMMIT')
            return result
          } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
          }
        }
      }
    },
  }
})

import { WorkspaceDb } from '../../src/main/db/sqlite/WorkspaceDb'
import { WORKSPACE_SCHEMA_SQL } from '../../src/main/db/sqlite/schema.sql'

const action: SkillAction = {
  id: 'proposal-1',
  toolId: 'organizer.saveNote',
  title: 'Save note',
  effect: 'write',
  status: 'pending',
  arguments: { title: 'A note', body: 'Full body' },
}
const opened: WorkspaceDb[] = []
const directories: string[] = []
afterEach(async () => {
  for (const db of opened.splice(0)) {
    try {
      db.close()
    } catch {
      /* closed before reopening */
    }
  }
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('SQLite skill receipt persistence', () => {
  it('round-trips arguments and receipts, atomically claims actions, and prevents regeneration', async () => {
    const db = await WorkspaceDb.open(':memory:', 'a'.repeat(64), 1)
    opened.push(db)
    const conversation = await db.createConversation('Skills')
    const user = await db.appendMessage(conversation.id, 'user', 'Save a note')
    const assistant = await db.appendMessage(
      conversation.id,
      'assistant',
      'Review',
      undefined,
      null,
      [action],
    )
    expect(
      (await db.getConversationWithMessages(conversation.id))!.messages[1]!.skillActions,
    ).toEqual([action])
    await expect(
      db.replaceSkillAction(
        conversation.id + 1,
        assistant.id,
        { ...action, status: 'running' },
        'pending',
      ),
    ).rejects.toThrow('no longer exists')
    await db.replaceSkillAction(
      conversation.id,
      assistant.id,
      { ...action, status: 'running' },
      'pending',
    )
    await expect(
      db.replaceSkillAction(
        conversation.id,
        assistant.id,
        { ...action, status: 'running' },
        'pending',
      ),
    ).rejects.toThrow('changed')
    expect(
      (await db.getConversationWithMessages(conversation.id))!.messages[1]!.skillActions![0]!
        .status,
    ).toBe('running')
    await expect(
      db.deleteLatestTurn({
        workspaceId: 1,
        conversationId: conversation.id,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
      }),
    ).rejects.toThrow('cannot be regenerated')
    expect((await db.getConversationWithMessages(conversation.id))!.messages).toHaveLength(2)
  })

  it('adds the column to existing workspaces idempotently and preserves interrupted markers after reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loklm-skill-migration-'))
    directories.push(dir)
    const path = join(dir, 'workspace.db')
    const { DatabaseSync } = await import('node:sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(WORKSPACE_SCHEMA_SQL.replace('  skill_actions   TEXT,\n', ''))
    legacy.close()
    const db = await WorkspaceDb.open(path, 'a'.repeat(64), 2)
    opened.push(db)
    const conversation = await db.createConversation('Legacy')
    const message = await db.appendMessage(
      conversation.id,
      'assistant',
      'Started',
      undefined,
      null,
      [{ ...action, status: 'running' }],
    )
    db.close()
    const reopened = await WorkspaceDb.open(path, 'a'.repeat(64), 2)
    opened.push(reopened)
    const saved = (await reopened.getConversationWithMessages(conversation.id))!.messages[0]!
    expect(saved.id).toBe(message.id)
    expect(saved.skillActions![0]!.status).toBe('running')
    await expect(
      reopened.replaceSkillAction(conversation.id, message.id, action, 'pending'),
    ).rejects.toThrow('changed')
  })
})
