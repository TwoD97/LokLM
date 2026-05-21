import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthService } from '@main/services/auth/AuthService'
import { WorkspaceService } from '@main/services/documents/WorkspaceService'
import { scoreAnswers } from '@main/services/quiz/scoring'

// Exercises QuizzesRepo end-to-end against a real PGlite — the same surface
// the `quiz:*` IPC handlers use. This is the smoke test that the new 0004
// migration applied cleanly + that the JOIN-heavy listDecks SQL behaves under
// real Postgres semantics, not just type checks.
//
// We deliberately do not run QuizService.generate() here (would need a fake
// LLM scaffold) — questions are inserted directly via repo.insertQuestions.

describe('quiz repo (integration)', () => {
  let dir: string
  let auth: AuthService

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'loklm-quiz-'))
    auth = new AuthService(dir)
    await auth.register({ displayName: 'Tst', password: 'Test12345!', recoveryLang: 'en' })
  })
  afterEach(async () => {
    await auth.lock().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })

  it('createDeck → getDeck round-trip preserves the documentIds snapshot, status, language', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const quizzes = auth.requireDatabase().quizzes()
    const deck = await quizzes.createDeck({
      workspaceId: ws.id,
      name: 'My Quiz',
      documentIds: [1, 2, 5],
      questionCount: 10,
      language: 'en',
    })
    expect(deck.status).toBe('generating')
    expect(deck.documentIds).toEqual([1, 2, 5])
    expect(deck.language).toBe('en')
    expect(deck.createdAt).toBeGreaterThan(0)

    const fetched = await quizzes.getDeck(deck.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.name).toBe('My Quiz')
    expect(fetched!.documentIds).toEqual([1, 2, 5])
  })

  it('insertQuestions persists in ordinal order and getDeckWithQuestions returns the combined shape', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const quizzes = auth.requireDatabase().quizzes()
    const deck = await quizzes.createDeck({
      workspaceId: ws.id,
      name: 'Q',
      documentIds: [1],
      questionCount: 2,
      language: 'en',
    })
    await quizzes.insertQuestions(deck.id, [
      {
        ordinal: 0,
        stem: 'First?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 1,
        explanation: 'Because.',
        sourceChunkIds: [100, 101],
        themeTitle: 'Theme',
      },
      {
        ordinal: 1,
        stem: 'Second?',
        options: ['W', 'X', 'Y', 'Z'],
        correctIndex: 3,
        explanation: 'So.',
        sourceChunkIds: [102],
        themeTitle: 'Theme',
      },
    ])
    await quizzes.setDeckStatus(deck.id, 'ready', null)

    const combined = await quizzes.getDeckWithQuestions(deck.id)
    expect(combined).not.toBeNull()
    expect(combined!.deck.status).toBe('ready')
    expect(combined!.questions).toHaveLength(2)
    expect(combined!.questions[0]!.stem).toBe('First?')
    expect(combined!.questions[0]!.options).toEqual(['A', 'B', 'C', 'D'])
    expect(combined!.questions[0]!.sourceChunkIds).toEqual([100, 101])
    expect(combined!.questions[1]!.correctIndex).toBe(3)
  })

  it('listDecks aggregates attemptCount + lastScore + lastFinishedAt across attempts', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const quizzes = auth.requireDatabase().quizzes()
    const deck = await quizzes.createDeck({
      workspaceId: ws.id,
      name: 'D',
      documentIds: [1],
      questionCount: 4,
      language: 'en',
    })
    await quizzes.insertQuestions(deck.id, [
      {
        ordinal: 0,
        stem: 'q',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: '.',
        sourceChunkIds: [1],
        themeTitle: 't',
      },
    ])
    await quizzes.setDeckStatus(deck.id, 'ready', null)

    // Two finished attempts (score 2, 3) and one in-flight that doesn't count.
    const a1 = await quizzes.startAttempt(deck.id)
    await quizzes.finishAttempt(a1.id, [], 2)
    const a2 = await quizzes.startAttempt(deck.id)
    await quizzes.finishAttempt(a2.id, [], 3)
    await quizzes.startAttempt(deck.id) // unfinished — must not be counted

    const decks = await quizzes.listDecks(ws.id)
    expect(decks).toHaveLength(1)
    expect(decks[0]!.attemptCount).toBe(2)
    // lastScore tracks the chronologically latest *finished* attempt.
    expect(decks[0]!.lastScore).toBe(3)
    expect(decks[0]!.lastFinishedAt).not.toBeNull()
  })

  it('listDecks orders multiple decks by createdAt DESC and isolates per-workspace', async () => {
    const wsA = await new WorkspaceService(auth).create('A')
    const wsB = await new WorkspaceService(auth).create('B')
    const quizzes = auth.requireDatabase().quizzes()
    const deck1 = await quizzes.createDeck({
      workspaceId: wsA.id,
      name: 'older',
      documentIds: [1],
      questionCount: 5,
      language: 'en',
    })
    // Force a difference in created_at — pglite's clock has 1-sec granularity
    // for EXTRACT(EPOCH FROM NOW()), so a brief sleep is enough.
    await new Promise((r) => setTimeout(r, 1100))
    await quizzes.createDeck({
      workspaceId: wsA.id,
      name: 'newer',
      documentIds: [1],
      questionCount: 5,
      language: 'en',
    })
    await quizzes.createDeck({
      workspaceId: wsB.id,
      name: 'other-workspace',
      documentIds: [1],
      questionCount: 5,
      language: 'en',
    })

    const decksA = await quizzes.listDecks(wsA.id)
    expect(decksA.map((d) => d.name)).toEqual(['newer', 'older'])
    const decksB = await quizzes.listDecks(wsB.id)
    expect(decksB.map((d) => d.name)).toEqual(['other-workspace'])
    expect(deck1).toBeTruthy() // sanity
  })

  it('clearQuestions wipes deck questions but leaves attempts intact', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const quizzes = auth.requireDatabase().quizzes()
    const deck = await quizzes.createDeck({
      workspaceId: ws.id,
      name: 'D',
      documentIds: [1],
      questionCount: 1,
      language: 'en',
    })
    await quizzes.insertQuestions(deck.id, [
      {
        ordinal: 0,
        stem: 'q',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: '.',
        sourceChunkIds: [1],
        themeTitle: 't',
      },
    ])
    const attempt = await quizzes.startAttempt(deck.id)
    await quizzes.finishAttempt(attempt.id, [], 0)
    await quizzes.clearQuestions(deck.id)
    expect(await quizzes.listQuestions(deck.id)).toEqual([])
    // Attempts survive — regenerate is a deliberate user action, prior
    // attempt rows are stale-by-design but kept for audit visibility.
    expect(await quizzes.listAttempts(deck.id)).toHaveLength(1)
  })

  it('deleting the workspace cascades through decks → questions → attempts', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const wsRepo = new WorkspaceService(auth)
    const quizzes = auth.requireDatabase().quizzes()
    const deck = await quizzes.createDeck({
      workspaceId: ws.id,
      name: 'D',
      documentIds: [1],
      questionCount: 1,
      language: 'en',
    })
    await quizzes.insertQuestions(deck.id, [
      {
        ordinal: 0,
        stem: 'q',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: '.',
        sourceChunkIds: [1],
        themeTitle: 't',
      },
    ])
    const attempt = await quizzes.startAttempt(deck.id)
    await wsRepo.delete(ws.id)
    expect(await quizzes.getDeck(deck.id)).toBeNull()
    expect(await quizzes.listQuestions(deck.id)).toEqual([])
    expect(await quizzes.getAttempt(attempt.id)).toBeNull()
  })

  it('finishAttempt writes score + answers + finished_at and listAttempts returns most-recent first', async () => {
    const ws = await new WorkspaceService(auth).create('WS')
    const quizzes = auth.requireDatabase().quizzes()
    const deck = await quizzes.createDeck({
      workspaceId: ws.id,
      name: 'D',
      documentIds: [1],
      questionCount: 2,
      language: 'en',
    })
    await quizzes.insertQuestions(deck.id, [
      {
        ordinal: 0,
        stem: 'q1',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: '.',
        sourceChunkIds: [1],
        themeTitle: 't',
      },
      {
        ordinal: 1,
        stem: 'q2',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanation: '.',
        sourceChunkIds: [1],
        themeTitle: 't',
      },
    ])
    // Score the submission via the same helper the IPC handler uses, so the
    // integration test exercises the exact persisted shape end users see.
    const questions = await quizzes.listQuestions(deck.id)
    const q1 = questions.find((q) => q.stem === 'q1')!
    const q2 = questions.find((q) => q.stem === 'q2')!
    const a1 = await quizzes.startAttempt(deck.id)
    const { scored: s1, score: score1 } = scoreAnswers(questions, [
      { questionId: q1.id, selectedIndex: 0 }, // correct
      { questionId: q2.id, selectedIndex: 0 }, // wrong
    ])
    await new Promise((r) => setTimeout(r, 1100))
    const finished1 = await quizzes.finishAttempt(a1.id, s1, score1)
    expect(finished1.score).toBe(1)
    expect(finished1.finishedAt).not.toBeNull()
    expect(finished1.answers).toHaveLength(2)
    expect(finished1.answers.find((a) => a.questionId === q1.id)?.correct).toBe(true)

    const a2 = await quizzes.startAttempt(deck.id)
    const { scored: s2, score: score2 } = scoreAnswers(questions, [
      { questionId: q1.id, selectedIndex: 0 },
      { questionId: q2.id, selectedIndex: 1 }, // both correct now
    ])
    const finished2 = await quizzes.finishAttempt(a2.id, s2, score2)
    expect(finished2.score).toBe(2)

    const all = await quizzes.listAttempts(deck.id)
    // DESC by started_at; the second attempt started later, so it's first.
    expect(all.map((a) => a.score)).toEqual([2, 1])
  })
})
