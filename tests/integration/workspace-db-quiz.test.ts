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

  it('merges ready decks into one ready deck with the union of document ids', async () => {
    const mkDeck = async (name: string, docIds: number[], stems: string[]): Promise<number> => {
      const d = await db.createDeck({
        name,
        documentIds: docIds,
        questionCount: stems.length,
        language: 'en',
      })
      await db.insertQuestions(
        d.id,
        stems.map((stem, i) => ({
          ordinal: i,
          stem,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'because',
          sourceChunkIds: [i + 1],
          themeTitle: 'T',
        })),
      )
      await db.setDeckStatus(d.id, 'ready', null)
      return d.id
    }
    const a = await mkDeck('A', [1, 2], ['A-Q1', 'A-Q2'])
    const b = await mkDeck('B', [2, 3], ['B-Q1'])

    const merged = await db.mergeDecks({ name: 'Combined', deckIds: [a, b], shuffle: false })
    expect(merged.status).toBe('ready')
    expect(merged.questionCount).toBe(3)
    expect([...merged.documentIds].sort()).toEqual([1, 2, 3])

    const full = await db.getDeckWithQuestions(merged.id)
    // shuffle:false keeps source order; ordinals are re-sequenced from 0.
    expect(full!.questions.map((q) => q.stem)).toEqual(['A-Q1', 'A-Q2', 'B-Q1'])
    expect(full!.questions.map((q) => q.ordinal)).toEqual([0, 1, 2])
    // Sources are untouched.
    expect((await db.getDeckWithQuestions(a))!.questions).toHaveLength(2)
  })

  it('rejects a merge of fewer than two decks or a non-ready source', async () => {
    const ready = await db.createDeck({
      name: 'R',
      documentIds: [1],
      questionCount: 0,
      language: 'en',
    })
    await db.setDeckStatus(ready.id, 'ready', null)
    await db.insertQuestions(ready.id, [
      {
        ordinal: 0,
        stem: 'Q',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'x',
        sourceChunkIds: [1],
        themeTitle: 'T',
      },
    ])
    const generating = await db.createDeck({
      name: 'G',
      documentIds: [2],
      questionCount: 0,
      language: 'en',
    })

    await expect(db.mergeDecks({ name: 'X', deckIds: [ready.id], shuffle: true })).rejects.toThrow(
      /at least two/i,
    )
    await expect(
      db.mergeDecks({ name: 'X', deckIds: [ready.id, generating.id], shuffle: true }),
    ).rejects.toThrow(/not ready/i)
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

  it('sweeps abandoned (un-scored) attempts but keeps finished history', async () => {
    const deck = await db.createDeck({
      name: 'D',
      documentIds: [],
      questionCount: 1,
      language: 'en',
    })
    const deck2 = await db.createDeck({
      name: 'E',
      documentIds: [],
      questionCount: 1,
      language: 'en',
    })
    const finished = await db.startAttempt(deck.id)
    await db.finishAttempt(finished.id, [], 0)
    await db.startAttempt(deck.id) // abandoned on deck
    await db.startAttempt(deck2.id) // abandoned on deck2

    expect(await db.deleteAbandonedAttempts()).toBe(2)
    const remaining = await db.listAttempts(deck.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe(finished.id)
    expect(await db.listAttempts(deck2.id)).toHaveLength(0)
  })

  it('startAttempt drops a prior un-scored attempt but keeps finished ones', async () => {
    const deck = await db.createDeck({
      name: 'D',
      documentIds: [],
      questionCount: 1,
      language: 'en',
    })
    const first = await db.startAttempt(deck.id)
    await db.finishAttempt(first.id, [], 0) // finished — must survive
    const abandoned = await db.startAttempt(deck.id) // un-scored
    const fresh = await db.startAttempt(deck.id) // must drop `abandoned`

    const ids = (await db.listAttempts(deck.id)).map((a) => a.id).sort((a, b) => a - b)
    expect(ids).toEqual([first.id, fresh.id].sort((a, b) => a - b))
    expect(ids).not.toContain(abandoned.id)
  })
})
