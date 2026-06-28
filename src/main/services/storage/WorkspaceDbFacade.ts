import type { AuthService } from '../auth/AuthService'
import type {
  WorkspaceDb,
  WsDocument,
  WsFolder,
  ConversationRow,
  MessageRow,
  MessageWithCitations,
  NewChunk,
  NewQuizQuestion,
} from '../../db/sqlite/WorkspaceDb'
import type { SearchHit, ChunkSearchOptions, ChunkRow, LibrarySearchRow } from '../../db/types'
import type { LibrarySearchOptions, Workspace } from '../../../shared/documents'
import { workspaceTypeOf, type WorkspaceType } from '../../../shared/workspaceStorage'
import type {
  QuizDeck,
  QuizDeckStatus,
  QuizDeckSummary,
  QuizDeckWithQuestions,
  QuizLanguage,
  QuizQuestion,
  QuizAttempt,
  QuizAttemptAnswer,
} from '../../../shared/quiz'

// ADR-0005: the Database-shaped facade that replaces in-memory PGlite. It keeps
// the OLD repo signatures (workspaceId-first) so the IPC layer + services are
// unchanged, and routes each call to the per-workspace encrypted SQLite store:
//   - workspaceId-keyed methods → that workspace's meta.db (cheap openMetaDb)
//   - id-keyed methods (by document/chunk/conversation/quiz id) → the ACTIVE
//     workspace (the renderer calls workspaces:activate on switch, so the active
//     workspace is the one the id belongs to). Throws if none is active.
// Vectors are NOT here — they live in LanceDB; searchChunksByVector returns []
// (retrieval injects the LanceDB-backed vector search separately).

export class WorkspaceDbFacade {
  constructor(private readonly auth: AuthService) {}

  /** The active workspace's relational store; the id-keyed ops operate on it. */
  private active(): WorkspaceDb {
    const db = this.auth.getWorkspaceStore().currentDb()
    if (!db) throw new Error('no active workspace — call workspaces:activate first')
    return db
  }

  documents(): DocumentsApi {
    return new DocumentsApi(this.auth, () => this.active())
  }
  conversations(): ConversationsApi {
    return new ConversationsApi(this.auth, () => this.active())
  }

  /** Like documents()/conversations() but PINNED to a specific workspace's store
   *  instead of the active one. Background work (folder-sync indexing, backfill,
   *  chat append) operates on a known workspace id regardless of which workspace
   *  the user has on screen — routing its id-keyed WRITES through active() lands
   *  chunks/messages in the wrong store and trips the FK ("FOREIGN KEY constraint
   *  failed"). These pre-open the workspace's meta.db and pin every op to it. */
  async documentsFor(workspaceId: number): Promise<DocumentsApi> {
    const db = await this.auth.getWorkspaceStore().openMetaDb(workspaceId)
    return new DocumentsApi(this.auth, () => db)
  }
  async conversationsFor(workspaceId: number): Promise<ConversationsApi> {
    const db = await this.auth.getWorkspaceStore().openMetaDb(workspaceId)
    return new ConversationsApi(this.auth, () => db)
  }
  folders(): FoldersApi {
    return new FoldersApi(this.auth)
  }
  quizzes(): QuizzesApi {
    return new QuizzesApi(this.auth, () => this.active())
  }
  workspaces(): WorkspacesApi {
    return new WorkspacesApi(this.auth)
  }
}

class DocumentsApi {
  constructor(
    private readonly auth: AuthService,
    private readonly active: () => WorkspaceDb,
  ) {}
  private meta(id: number): Promise<WorkspaceDb> {
    return this.auth.getWorkspaceStore().openMetaDb(id)
  }

  // workspaceId-keyed
  async listDocumentsByWorkspace(workspaceId: number): Promise<WsDocument[]> {
    return (await this.meta(workspaceId)).listDocuments()
  }
  async listDocumentTitles(workspaceId: number): Promise<Array<{ id: number; title: string }>> {
    return (await this.meta(workspaceId)).listDocumentTitles()
  }
  async listMissingUnacknowledged(workspaceId: number): Promise<WsDocument[]> {
    return (await this.meta(workspaceId)).listMissingUnacknowledged()
  }
  async listPinned(workspaceId: number): Promise<WsDocument[]> {
    return (await this.meta(workspaceId)).listPinned()
  }
  async findByWorkspaceAndPath(workspaceId: number, path: string): Promise<WsDocument | null> {
    return (await this.meta(workspaceId)).findByWorkspaceAndPath(path)
  }
  async addDocument(
    input: { workspaceId: number } & Parameters<WorkspaceDb['addDocument']>[0],
  ): Promise<WsDocument> {
    return (await this.meta(input.workspaceId)).addDocument(input)
  }
  async searchChunks(
    workspaceId: number,
    query: string,
    topK: number,
    opts?: ChunkSearchOptions,
  ): Promise<SearchHit[]> {
    return (await this.meta(workspaceId)).searchChunks(query, topK, opts)
  }
  async searchChunksByVector(
    _workspaceId?: number,
    _embedding?: number[],
    _topK?: number,
    _opts?: ChunkSearchOptions,
  ): Promise<SearchHit[]> {
    return [] // vectors live in LanceDB; retrieval injects the vector search
  }
  async searchLibrary(
    workspaceId: number,
    query: string,
    opts?: LibrarySearchOptions,
  ): Promise<LibrarySearchRow[]> {
    return (await this.meta(workspaceId)).searchLibrary(query, opts)
  }
  async searchDocumentsByTheme(
    workspaceId: number,
    themeTokens: string[],
    opts?: Parameters<WorkspaceDb['searchDocumentsByTheme']>[1],
  ): Promise<Array<{ id: number; title: string; chunkHits: number; firstChunkId: number | null }>> {
    return (await this.meta(workspaceId)).searchDocumentsByTheme(themeTokens, opts)
  }
  async topDocumentsBySummarySimilarity(
    workspaceId: number,
    queryVec: number[],
    k: number,
    opts?: Parameters<WorkspaceDb['topDocumentsBySummarySimilarity']>[2],
  ): Promise<Array<{ id: number; score: number }>> {
    return (await this.meta(workspaceId)).topDocumentsBySummarySimilarity(queryVec, k, opts)
  }
  async countChunksMissingEmbedding(workspaceId: number): Promise<number> {
    return (await this.meta(workspaceId)).countChunksMissingEmbedding()
  }
  async listChunksMissingEmbedding(
    workspaceId: number,
    limit: number,
  ): Promise<Array<{ id: number; text: string; document_id: number }>> {
    return (await this.meta(workspaceId)).listChunksMissingEmbedding(limit)
  }
  async documentIdsMissingEmbedding(workspaceId: number): Promise<number[]> {
    return (await this.meta(workspaceId)).documentIdsMissingEmbedding()
  }
  async distinctEmbedderIdentities(workspaceId: number): Promise<string[]> {
    return (await this.meta(workspaceId)).distinctEmbedderIdentities()
  }
  async purgeEmbeddingsByIdentity(workspaceId: number, identity: string): Promise<number[]> {
    return (await this.meta(workspaceId)).purgeEmbeddingsByIdentity(identity)
  }
  async resetEmbeddedMarkers(workspaceId: number): Promise<number> {
    return (await this.meta(workspaceId)).resetEmbeddedMarkers()
  }
  async listDocsMissingSummaryEmbedding(
    workspaceId: number,
    limit: number,
  ): Promise<Array<{ id: number; summary: string }>> {
    return (await this.meta(workspaceId)).listDocsMissingSummaryEmbedding(limit)
  }
  async countDocsMissingSummaryEmbedding(workspaceId: number): Promise<number> {
    return (await this.meta(workspaceId)).countDocsMissingSummaryEmbedding()
  }
  async distinctSummaryEmbedderIdentities(workspaceId: number): Promise<string[]> {
    return (await this.meta(workspaceId)).distinctSummaryEmbedderIdentities()
  }
  async purgeSummaryEmbeddingsByIdentity(workspaceId: number, identity: string): Promise<number> {
    return (await this.meta(workspaceId)).purgeSummaryEmbeddingsByIdentity(identity)
  }

  // cold-boot sweeps across all workspaces
  async resetStuckIndexing(): Promise<number> {
    let n = 0
    for (const w of this.auth.getWorkspaceStore().list())
      n += await (await this.meta(w.id)).resetStuckIndexing()
    return n
  }

  // id-keyed (active workspace)
  async getDocument(id: number): Promise<WsDocument | null> {
    return this.active().getDocument(id)
  }
  async deleteDocument(id: number): Promise<void> {
    return this.active().deleteDocument(id)
  }
  async reindexDocument(id: number): Promise<void> {
    return this.active().reindexDocument(id)
  }
  async setDocumentStatus(id: number, status: string): Promise<void> {
    return this.active().setDocumentStatus(id, status)
  }
  async setSourceMetadata(
    id: number,
    fields: Parameters<WorkspaceDb['setSourceMetadata']>[1],
  ): Promise<void> {
    return this.active().setSourceMetadata(id, fields)
  }
  async markMissing(id: number): Promise<void> {
    return this.active().markMissing(id)
  }
  async clearMissing(id: number): Promise<void> {
    return this.active().clearMissing(id)
  }
  async dismissMissing(id: number): Promise<void> {
    return this.active().dismissMissing(id)
  }
  async setPinned(id: number, pinned: boolean): Promise<void> {
    return this.active().setPinned(id, pinned)
  }
  async setSummary(id: number, summary: string | null): Promise<void> {
    return this.active().setSummary(id, summary)
  }
  async setSummaryEmbedding(id: number, vector: number[], identity: string): Promise<void> {
    return this.active().setSummaryEmbedding(id, vector, identity)
  }
  async persistChunks(documentId: number, items: NewChunk[]): Promise<number[]> {
    return this.active().persistChunks(documentId, items)
  }
  /** Legacy ingest path marker (no pgvector): mark chunks embedded by id. */
  async setChunkEmbeddingsBatch(
    rows: Array<{ id: number; vector: number[] | Float32Array }>,
    identity: string,
  ): Promise<void> {
    return this.active().markChunksEmbedded(
      rows.map((r) => r.id),
      identity,
    )
  }
  async markChunksEmbedded(chunkIds: number[], identity: string): Promise<void> {
    return this.active().markChunksEmbedded(chunkIds, identity)
  }
  async chunkIdsForDocument(documentId: number): Promise<number[]> {
    return this.active().chunkIdsForDocument(documentId)
  }
  async listChunksForDocument(documentId: number): Promise<ChunkRow[]> {
    return this.active().listChunksForDocument(documentId)
  }
  async getCitedChunkSource(
    chunkId: number,
  ): Promise<Awaited<ReturnType<WorkspaceDb['getCitedChunkSource']>>> {
    return this.active().getCitedChunkSource(chunkId)
  }
  async getChunkCounts(documentIds: number[]): Promise<Map<number, number>> {
    return this.active().getChunkCounts(documentIds)
  }
  async getNeighbourChunks(
    seeds: Array<{ documentId: number; ordinal: number }>,
    radius: number,
  ): Promise<ChunkRow[]> {
    return this.active().getNeighbourChunks(seeds, radius)
  }
  async getChunkWithContext(
    chunkId: number,
    before: number,
    after: number,
  ): Promise<Awaited<ReturnType<WorkspaceDb['getChunkWithContext']>>> {
    return this.active().getChunkWithContext(chunkId, before, after)
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async ensureVectorIndex(): Promise<void> {}
}

class ConversationsApi {
  constructor(
    private readonly auth: AuthService,
    private readonly active: () => WorkspaceDb,
  ) {}
  async create(
    workspaceId: number,
    title?: string | null,
    activeDocumentIds?: number[],
  ): Promise<ConversationRow> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).createConversation(
      title,
      activeDocumentIds,
    )
  }
  async list(workspaceId: number): Promise<ConversationRow[]> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).listConversations()
  }
  async setTitle(id: number, title: string | null): Promise<void> {
    return this.active().setConversationTitle(id, title)
  }
  async setActiveDocumentIds(conversationId: number, ids: number[]): Promise<void> {
    return this.active().setActiveDocumentIds(conversationId, ids)
  }
  async delete(id: number): Promise<void> {
    return this.active().deleteConversation(id)
  }
  async deleteMessage(messageId: number): Promise<void> {
    return this.active().deleteMessage(messageId)
  }
  async appendMessage(
    conversationId: number,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metrics?: { ttftMs: number | null; tokensPerSec: number | null; tokenCount: number | null },
  ): Promise<MessageRow> {
    return this.active().appendMessage(conversationId, role, content, metrics)
  }
  async persistCitations(
    messageId: number,
    items: Array<{ chunk_id: number; score?: number | null }>,
  ): Promise<void> {
    return this.active().persistCitations(messageId, items)
  }
  async getWithMessages(
    conversationId: number,
  ): Promise<{ conversation: ConversationRow; messages: MessageWithCitations[] } | null> {
    return this.active().getConversationWithMessages(conversationId)
  }
}

class FoldersApi {
  constructor(private readonly auth: AuthService) {}
  private meta(id: number): Promise<WorkspaceDb> {
    return this.auth.getWorkspaceStore().openMetaDb(id)
  }
  async list(workspaceId: number): Promise<WsFolder[]> {
    return (await this.meta(workspaceId)).listFolders()
  }
  async listAssignments(
    workspaceId: number,
  ): Promise<Array<{ documentId: number; folderId: number }>> {
    return (await this.meta(workspaceId)).listFolderAssignments()
  }
  async create(workspaceId: number, name: string, parentId: number | null): Promise<WsFolder> {
    return (await this.meta(workspaceId)).createFolder(name, parentId)
  }
  async rename(workspaceId: number, id: number, name: string): Promise<void> {
    return (await this.meta(workspaceId)).renameFolder(id, name)
  }
  async delete(workspaceId: number, id: number): Promise<void> {
    return (await this.meta(workspaceId)).deleteFolder(id)
  }
  async setDocumentFolder(
    workspaceId: number,
    documentId: number,
    folderId: number | null,
  ): Promise<void> {
    return (await this.meta(workspaceId)).setDocumentFolder(documentId, folderId)
  }
}

class QuizzesApi {
  constructor(
    private readonly auth: AuthService,
    private readonly active: () => WorkspaceDb,
  ) {}
  private meta(id: number): Promise<WorkspaceDb> {
    return this.auth.getWorkspaceStore().openMetaDb(id)
  }
  async createDeck(input: {
    workspaceId: number
    name: string
    documentIds: number[]
    questionCount: number
    language: QuizLanguage
  }): Promise<QuizDeck> {
    return (await this.meta(input.workspaceId)).createDeck(input)
  }
  async listDecks(workspaceId: number): Promise<QuizDeckSummary[]> {
    return (await this.meta(workspaceId)).listDecks()
  }
  async setDeckStatus(deckId: number, status: QuizDeckStatus, error: string | null): Promise<void> {
    return this.active().setDeckStatus(deckId, status, error)
  }
  async updateDeckQuestionCount(deckId: number, questionCount: number): Promise<void> {
    return this.active().updateDeckQuestionCount(deckId, questionCount)
  }
  async resetStuckDecks(): Promise<number> {
    let n = 0
    for (const w of this.auth.getWorkspaceStore().list())
      n += await (await this.meta(w.id)).resetStuckDecks()
    return n
  }
  async getDeck(deckId: number): Promise<QuizDeck | null> {
    return this.active().getDeck(deckId)
  }
  async getDeckWithQuestions(deckId: number): Promise<QuizDeckWithQuestions | null> {
    return this.active().getDeckWithQuestions(deckId)
  }
  async listQuestions(deckId: number): Promise<QuizQuestion[]> {
    return this.active().listQuestions(deckId)
  }
  async insertQuestions(deckId: number, items: NewQuizQuestion[]): Promise<void> {
    return this.active().insertQuestions(deckId, items)
  }
  async clearQuestions(deckId: number): Promise<void> {
    return this.active().clearQuestions(deckId)
  }
  async deleteDeck(deckId: number): Promise<void> {
    return this.active().deleteDeck(deckId)
  }
  async deleteAttempts(deckId: number): Promise<void> {
    return this.active().deleteAttempts(deckId)
  }
  async startAttempt(deckId: number): Promise<QuizAttempt> {
    return this.active().startAttempt(deckId)
  }
  async finishAttempt(
    attemptId: number,
    answers: QuizAttemptAnswer[],
    score: number,
  ): Promise<QuizAttempt> {
    return this.active().finishAttempt(attemptId, answers, score)
  }
  async listAttempts(deckId: number): Promise<QuizAttempt[]> {
    return this.active().listAttempts(deckId)
  }
  async getAttempt(attemptId: number): Promise<QuizAttempt | null> {
    return this.active().getAttempt(attemptId)
  }
}

class WorkspacesApi {
  constructor(private readonly auth: AuthService) {}
  async list(): Promise<Workspace[]> {
    return this.auth
      .getWorkspaceStore()
      .list()
      .map((e) => ({
        id: e.id,
        name: e.name,
        createdAt: e.createdAt,
        type: workspaceTypeOf(e),
        encryptionLevel: e.encryptionLevel,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  async create(name: string, opts?: { encrypted?: boolean }): Promise<Workspace> {
    const e = await this.auth.getWorkspaceStore().create(name, opts)
    return {
      id: e.id,
      name: e.name,
      createdAt: e.createdAt,
      type: workspaceTypeOf(e),
      encryptionLevel: e.encryptionLevel,
    }
  }
  async rename(id: number, name: string): Promise<void> {
    return this.auth.getWorkspaceStore().rename(id, name)
  }
  async setType(id: number, type: WorkspaceType): Promise<void> {
    return this.auth.getWorkspaceStore().setType(id, type)
  }
  async delete(id: number): Promise<void> {
    return this.auth.getWorkspaceStore().delete(id)
  }
  async getSyncFolders(workspaceId: number): Promise<string[]> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).getSyncFolders()
  }
  async setSyncFolders(workspaceId: number, folders: string[]): Promise<void> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).setSyncFolders(folders)
  }
  // ADR-0006: per-folder top-level-dir include-set (no-gitignore selection).
  async getIndexDirs(workspaceId: number, folderPath: string): Promise<string[]> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).getIndexDirs(folderPath)
  }
  async setIndexDirs(workspaceId: number, folderPath: string, dirs: string[]): Promise<void> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).setIndexDirs(
      folderPath,
      dirs,
    )
  }
  async clearIndexDirs(workspaceId: number, folderPath: string): Promise<void> {
    return (await this.auth.getWorkspaceStore().openMetaDb(workspaceId)).clearIndexDirs(folderPath)
  }
}
