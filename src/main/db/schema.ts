import { sql } from 'drizzle-orm'
import {
  pgTable,
  serial,
  text,
  integer,
  real,
  bigint,
  customType,
  uniqueIndex,
  index,
  jsonb,
} from 'drizzle-orm/pg-core'

// pgvector is loaded as a pglite extension at boot. drizzle has no native
// `vector(N)` type so we declare a customType. nullable on chunks until Spec 2
// (RAG Pipeline) wires the BGE-M3 EmbeddingService.
const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1024})`
  },
  toDriver(value) {
    return `[${value.join(',')}]`
  },
})

export const workspaces = pgTable('workspaces', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: bigint('created_at', { mode: 'number' })
    .notNull()
    .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
})

// 3NF refactor (mig 0006) , watched folder paths live in their own table.
// Composite PK (workspace_id , path) enforces uniqueness ; the prior
// jsonb<string[]> column on workspaces is dropped.
export const workspaceSyncFolders = pgTable(
  'workspace_sync_folders',
  {
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
  },
  (t) => ({
    pk: uniqueIndex('workspace_sync_folders_pk').on(t.workspaceId, t.path),
  }),
)

export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sourcePath: text('source_path').notNull(),
    mimeType: text('mime_type'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    status: text('status').notNull().default('pending'),
    chunkCount: integer('chunk_count').notNull().default(0),
    tokenCount: bigint('token_count', { mode: 'number' }).notNull().default(0),
    addedAt: bigint('added_at', { mode: 'number' })
      .notNull()
      .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
    // sha256 of the source file bytes at last import/reindex. Null on pre-0004
    // rows; filled the next time the doc gets refreshed/reindexed. Drives the
    // hash-aware short-circuit in DocumentService.refreshDocument so an
    // unchanged file doesn't trigger a re-parse + re-embed.
    contentHash: text('content_hash'),
    // statSync().mtimeMs at last import, rounded to ms. Cheap pre-check before
    // the more expensive hash compare in the folder-sync loop.
    sourceMtime: bigint('source_mtime', { mode: 'number' }),
    // Soft-missing marker: set by FolderSyncService when the source path
    // vanishes, cleared when sync rediscovers the file. Drives the LibraryView
    // "vanished files" banner. Status stays 'ready' so retrieval keeps working
    // on the still-indexed chunks until the user decides Keep vs. Remove.
    missingAt: bigint('missing_at', { mode: 'number' }),
    // When the user clicks "Behalten" on the banner. Sync still re-detects the
    // file as missing on every pass but skips notifying as long as
    // missing_dismissed_at >= missing_at. Reset to null when the file
    // reappears so a future disappearance re-notifies.
    missingDismissedAt: bigint('missing_dismissed_at', { mode: 'number' }),
  },
  (t) => ({
    idxWorkspace: index('idx_documents_workspace').on(t.workspaceId),
  }),
)

export const chunks = pgTable(
  'chunks',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    contextPrefix: text('context_prefix'),
    tokenCount: integer('token_count'),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    // For markdown-indexed documents we store the hierarchical heading path
    // (["1. Introduction", "Why Markdown"]) so citations can render section
    // breadcrumbs instead of falling back to page numbers (which don't exist
    // for plain markdown). Null for PDFs and unstructured text.
    headingPath: jsonb('heading_path').$type<string[]>(),
    embedding: vector('embedding', { dimensions: 1024 }),
    embedderIdentity: text('embedder_identity').notNull().default('bundled:bge-m3'),
    // Per-chunk detected language from eld (mig 0007). Values: 'de' | 'en' |
    // 'other'. Nullable for legacy rows ingested before detection was wired —
    // the prompt formatter treats NULL as "unknown" and omits the cross-language
    // header tag rather than guessing. text_search column removed in mig 0006 ;
    // the GIN index now keys off the expression directly.
    language: text('language').$type<'de' | 'en' | 'other'>(),
  },
  (t) => ({
    idxDocument: index('idx_chunks_document').on(t.documentId),
    idxDocOrdinal: uniqueIndex('idx_chunks_doc_ordinal').on(t.documentId, t.ordinal),
  }),
)

export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title'),
  activeDocumentIds: jsonb('active_document_ids').notNull().default([]),
  createdAt: bigint('created_at', { mode: 'number' })
    .notNull()
    .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
})

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    // Stream metrics captured from the renderer's view of the assistant turn:
    // ttftMs = time-to-first-token (ms) from user submit to first token event,
    // tokensPerSec = average rate over the streaming window,
    // tokenCount = number of token events delivered. Null for user/system rows
    // and for assistant rows that never streamed (e.g. legacy refusals).
    ttftMs: integer('ttft_ms'),
    tokensPerSec: real('tokens_per_sec'),
    tokenCount: integer('token_count'),
    createdAt: bigint('created_at', { mode: 'number' })
      .notNull()
      .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
  },
  (t) => ({
    idxConv: index('idx_messages_conv').on(t.conversationId),
  }),
)

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const citations = pgTable(
  'citations',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    chunkId: integer('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    // document_id removed in mig 0006 , transitively derivable from
    // chunks.document_id (chunks are immutable post-insert , CASCADE on both
    // FKs would have masked any drift). Lookups now JOIN chunks.
    score: real('score'),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    createdAt: bigint('created_at', { mode: 'number' })
      .notNull()
      .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
  },
  (t) => ({
    idxMessage: index('idx_citations_message').on(t.messageId),
    idxChunk: index('idx_citations_chunk').on(t.chunkId),
  }),
)

// Quiz feature — see docs/superpowers/specs/2026-05-21-quiz-feature-design.md.
// A deck is a workspace-scoped MCQ set generated once from a chosen subset of
// documents; question rows are its persisted contents; attempt rows hold one
// run-through per retake. document_ids is a snapshot — chunks (and the docs
// themselves) can be deleted without breaking the deck, the citation chip just
// degrades to "Source no longer available" at click time.
export const quizDecks = pgTable(
  'quiz_decks',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    documentIds: jsonb('document_ids').$type<number[]>().notNull(),
    questionCount: integer('question_count').notNull(),
    // 'generating' | 'ready' | 'failed' — text rather than enum to mirror the
    // documents/conversations style and stay diffable in plain SQL.
    status: text('status').notNull().default('generating'),
    error: text('error'),
    language: text('language').notNull(),
    createdAt: bigint('created_at', { mode: 'number' })
      .notNull()
      .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
  },
  (t) => ({
    idxWorkspace: index('idx_quiz_decks_workspace').on(t.workspaceId),
  }),
)

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: serial('id').primaryKey(),
    deckId: integer('deck_id')
      .notNull()
      .references(() => quizDecks.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    stem: text('stem').notNull(),
    options: jsonb('options').$type<string[]>().notNull(),
    correctIndex: integer('correct_index').notNull(),
    explanation: text('explanation').notNull(),
    // jsonb int[] rather than a chunk FK: deletion of the source chunk leaves
    // the question intact (it still has stem/answer/explanation). Citation chip
    // checks existence on click and degrades gracefully.
    sourceChunkIds: jsonb('source_chunk_ids').$type<number[]>().notNull(),
    themeTitle: text('theme_title').notNull(),
  },
  (t) => ({
    idxDeck: index('idx_quiz_questions_deck').on(t.deckId),
    uniqDeckOrdinal: uniqueIndex('uniq_quiz_questions_deck_ordinal').on(t.deckId, t.ordinal),
  }),
)

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: serial('id').primaryKey(),
    deckId: integer('deck_id')
      .notNull()
      .references(() => quizDecks.id, { onDelete: 'cascade' }),
    startedAt: bigint('started_at', { mode: 'number' })
      .notNull()
      .default(sql`(EXTRACT(EPOCH FROM NOW())::BIGINT)`),
    finishedAt: bigint('finished_at', { mode: 'number' }),
    score: integer('score'),
    // Array of { questionId, selectedIndex, correct } — written once on finish.
    // No per-click IPC; an abandoned attempt stays with finished_at=null and [].
    answers: jsonb('answers')
      .$type<Array<{ questionId: number; selectedIndex: number; correct: boolean }>>()
      .notNull()
      .default([]),
  },
  (t) => ({
    idxDeck: index('idx_quiz_attempts_deck').on(t.deckId),
  }),
)

export const documentTags = pgTable(
  'document_tags',
  {
    id: serial('id').primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => ({
    idxDoc: index('idx_document_tags_doc').on(t.documentId),
    idxTag: index('idx_document_tags_tag').on(t.tag),
    uniqDocTag: uniqueIndex('uniq_document_tags_doc_tag').on(t.documentId, t.tag),
  }),
)

// re-export everything as default-shaped namespace for drizzle(client, { schema })
export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type WorkspaceSyncFolder = typeof workspaceSyncFolders.$inferSelect
export type NewWorkspaceSyncFolder = typeof workspaceSyncFolders.$inferInsert
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type Citation = typeof citations.$inferSelect
export type NewCitation = typeof citations.$inferInsert
export type Settings = typeof settings.$inferSelect
export type NewSettings = typeof settings.$inferInsert
export type DocumentTag = typeof documentTags.$inferSelect
export type NewDocumentTag = typeof documentTags.$inferInsert
export type QuizDeckRow = typeof quizDecks.$inferSelect
export type NewQuizDeckRow = typeof quizDecks.$inferInsert
export type QuizQuestionRow = typeof quizQuestions.$inferSelect
export type NewQuizQuestionRow = typeof quizQuestions.$inferInsert
export type QuizAttemptRow = typeof quizAttempts.$inferSelect
export type NewQuizAttemptRow = typeof quizAttempts.$inferInsert
