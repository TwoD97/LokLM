import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { WorkspaceDb } from '../../src/main/db/sqlite/WorkspaceDb'

describe('WorkspaceDb quiz + sync folders', () => {
  let dir: string
  let db: WorkspaceDb

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'loklm-wsq-'))
    db = await WorkspaceDb.open(join(dir, 'meta.db'), randomBytes(32).toString('hex'), 1)
  })
  afterEach(async () => {
    db.close()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('runs the full quiz lifecycle', async () => {
    const deck = await db.createDeck({
      name: 'Bio',
      documentIds: [1, 2],
      questionCount: 2,
      language: 'en',
    })
    expect(deck.workspaceId).toBe(1)
    expect(deck.status).toBe('generating')

    await db.insertQuestions(deck.id, [
      {
        ordinal: 0,
        stem: 'Q1?',
        options: ['a', 'b'],
        correctIndex: 1,
        explanation: 'because',
        sourceChunkIds: [10],
        themeTitle: 'T',
      },
      {
        ordinal: 1,
        stem: 'Q2?',
        options: ['c', 'd'],
        correctIndex: 0,
        explanation: 'reason',
        sourceChunkIds: [11],
        themeTitle: 'T',
      },
    ])
    await db.setDeckStatus(deck.id, 'ready', null)

    const full = await db.getDeckWithQuestions(deck.id)
    expect(full!.questions).toHaveLength(2)
    expect(full!.questions[0]!.options).toEqual(['a', 'b'])

    const attempt = await db.startAttempt(deck.id)
    await db.finishAttempt(
      attempt.id,
      [
        { questionId: full!.questions[0]!.id, selectedIndex: 1, correct: true },
        { questionId: full!.questions[1]!.id, selectedIndex: 1, correct: false },
      ],
      1,
    )
    const decks = await db.listDecks()
    expect(decks[0]!.attemptCount).toBe(1)
    expect(decks[0]!.lastScore).toBe(1)
    const attempts = await db.listAttempts(deck.id)
    expect(attempts[0]!.answers).toHaveLength(2)
    expect(attempts[0]!.score).toBe(1)
  })

  it('resets stuck decks and persists sync folders', async () => {
    const d = await db.createDeck({ name: 'X', documentIds: [], questionCount: 1, language: 'de' })
    expect(await db.resetStuckDecks()).toBe(1)
    expect((await db.getDeck(d.id))!.status).toBe('failed')

    await db.setSyncFolders(['/a', '/b', '/a'])
    expect(await db.getSyncFolders()).toEqual(['/a', '/b'])
    await db.setSyncFolders(['/c'])
    expect(await db.getSyncFolders()).toEqual(['/c'])
  })
})
