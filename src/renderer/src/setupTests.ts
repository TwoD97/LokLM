import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { Api } from '@preload/index'
import { DEFAULT_SETTINGS } from '../../shared/settings'

// pdfjs-dist touches DOMMatrix at module-load time, which jsdom doesn't provide.
// Stub the module so any test that transitively imports MultiPagePdfPreview
// doesn't blow up — no test currently exercises an actual PDF render path.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: Promise.reject(new Error('pdfjs-dist mocked in tests')),
  }),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

// jsdom doesn't implement URL.createObjectURL/revokeObjectURL — stub them so
// components that produce blob URLs (e.g. Avatar) can render in tests.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = (): string => 'blob:stub'
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = (): void => undefined
}

afterEach(() => {
  cleanup()
})

const stub: Api = {
  auth: {
    status: () =>
      Promise.resolve({
        registered: false,
        locked: true,
        displayName: null,
        remainingRecoveryCodes: 0,
        recoveryLang: null,
      }),
    register: () => Promise.resolve({ passphrase: Array(18).fill('test') as string[] }),
    login: () => Promise.resolve({ ok: true as const }),
    logout: () => Promise.resolve(),
    lock: () => Promise.resolve(),
    reset: () =>
      Promise.resolve({ ok: true as const, passphrase: Array(18).fill('test') as string[] }),
    verifyPassword: () => Promise.resolve({ ok: true as const }),
    onState: () => () => undefined,
    onLoginProgress: () => () => undefined,
  },
  window: {
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    onMaximizedChange: () => () => undefined,
  },
  workspaces: {
    list: () => Promise.resolve([]),
    create: (name: string) =>
      Promise.resolve({ id: 1, name, createdAt: Math.floor(Date.now() / 1000) }),
    rename: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    listSyncFolders: () => Promise.resolve([] as string[]),
    addSyncFolder: () => Promise.resolve(null),
    removeSyncFolder: () => Promise.resolve([] as string[]),
    syncNow: () =>
      Promise.resolve({
        imported: 0,
        reindexed: 0,
        markedMissing: 0,
        unchanged: 0,
        stillMissing: 0,
      }),
    onSyncProgress: () => () => undefined,
  },
  documents: {
    list: () => Promise.resolve([]),
    getPathForFile: () => '',
    pickFiles: () => Promise.resolve([] as string[]),
    import: (workspaceId: number, sourcePath: string) =>
      Promise.resolve({
        id: 1,
        workspaceId,
        title: sourcePath,
        sourcePath,
        mimeType: null,
        byteSize: null,
        status: 'pending' as const,
        chunkCount: 0,
        tokenCount: 0,
        addedAt: Math.floor(Date.now() / 1000),
      }),
    delete: () => Promise.resolve(),
    reindex: (id: number) =>
      Promise.resolve({
        id,
        workspaceId: 1,
        title: 'stub',
        sourcePath: '/stub',
        mimeType: null,
        byteSize: null,
        status: 'pending' as const,
        chunkCount: 0,
        tokenCount: 0,
        addedAt: Math.floor(Date.now() / 1000),
      }),
    listChunksForDocument: () => Promise.resolve([] as Array<never>),
    getSourceForChunk: () => Promise.resolve(null),
    readDocumentBytes: () => Promise.resolve(null),
    revealSource: () => Promise.resolve({ ok: true as const, sourcePath: '/stub' }),
    openExternal: () => Promise.resolve({ ok: true as const }),
    replaceSource: () => Promise.resolve(null),
    refresh: () => Promise.resolve({ ok: true as const, outcome: 'unchanged' as const }),
    listMissing: () => Promise.resolve([]),
    keepMissing: () => Promise.resolve(),
    onIndexProgress: () => () => undefined,
  },
  conversations: {
    list: () => Promise.resolve([]),
    create: (workspaceId: number, title?: string, activeDocumentIds?: number[]) =>
      Promise.resolve({
        id: 1,
        workspaceId,
        title: title ?? null,
        activeDocumentIds: activeDocumentIds ?? ([] as number[]),
        createdAt: Math.floor(Date.now() / 1000),
        lastActivityAt: Math.floor(Date.now() / 1000),
        messageCount: 0,
      }),
    delete: () => Promise.resolve(),
    getWithMessages: (id: number) =>
      Promise.resolve({
        conversation: {
          id,
          workspaceId: 1,
          title: null,
          activeDocumentIds: [] as number[],
          createdAt: Math.floor(Date.now() / 1000),
          lastActivityAt: Math.floor(Date.now() / 1000),
          messageCount: 0,
        },
        messages: [],
      }),
    generateTitle: () => Promise.resolve(null),
    setActiveDocumentIds: () => Promise.resolve(),
  },
  models: {
    status: () =>
      Promise.resolve({
        downloadDir: '/tmp/models',
        models: [] as Array<never>,
        allRequiredReady: true,
      }),
    download: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    checkSpace: (requiredBytes: number) =>
      Promise.resolve({
        unknown: false as const,
        ok: true,
        availableBytes: requiredBytes * 4,
        requiredBytes,
      }),
    onProgress: () => Promise.resolve(() => undefined),
  },
  embedder: {
    status: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        source: 'bundled' as const,
      }),
    info: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        source: 'bundled' as const,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    reload: () =>
      Promise.resolve({
        kind: 'embedder' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        source: 'bundled' as const,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    setPlacement: () => Promise.resolve(),
    backfillStatus: (workspaceId: number) =>
      Promise.resolve({
        workspaceId,
        state: 'idle' as const,
        done: 0,
        total: 0,
        message: null,
      }),
    runBackfill: () => Promise.resolve(),
    onStatus: () => () => undefined,
    onBackfillStatus: () => () => undefined,
    trySwitchSource: () => Promise.resolve({ ok: true as const, identity: 'stub' }),
  },
  search: {
    hybrid: () => Promise.resolve([]),
  },
  reranker: {
    status: () =>
      Promise.resolve({
        kind: 'reranker' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        source: 'bundled' as const,
      }),
    info: () =>
      Promise.resolve({
        kind: 'reranker' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        source: 'bundled' as const,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    reload: () =>
      Promise.resolve({
        kind: 'reranker' as const,
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        loadProgress: null,
        message: null,
        source: 'bundled' as const,
        bundledModelPath: '',
        bundledModelExists: false,
        resolvedPlacement: null,
        placementChoice: 'auto' as const,
        placementReason: null,
      }),
    warmup: () => Promise.resolve(),
    setPlacement: () => Promise.resolve(),
    onStatus: () => () => undefined,
  },
  llm: {
    status: () =>
      Promise.resolve({
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        gpu: null,
        loadProgress: null,
        message: null,
        profile: null,
        source: 'bundled' as const,
        fallback: { active: false, reason: null },
      }),
    info: () =>
      Promise.resolve({
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        gpu: null,
        loadProgress: null,
        message: null,
        profile: null,
        source: 'bundled' as const,
        fallback: { active: false, reason: null },
        bundledModelPath: '',
        bundledModelExists: false,
        totalMemGB: 0,
        recommendedProfile: 'lite' as const,
        selectedProfile: 'auto' as const,
        profiles: [],
        resources: null,
        lastLlmPlan: null,
        selectedContext: 'auto' as const,
      }),
    reload: () =>
      Promise.resolve({
        state: 'idle' as const,
        modelPath: null,
        modelName: null,
        gpu: null,
        loadProgress: null,
        message: null,
        profile: null,
        source: 'bundled' as const,
        fallback: { active: false, reason: null },
        bundledModelPath: '',
        bundledModelExists: false,
        totalMemGB: 0,
        recommendedProfile: 'lite' as const,
        selectedProfile: 'auto' as const,
        profiles: [],
        resources: null,
        lastLlmPlan: null,
        selectedContext: 'auto' as const,
      }),
    setProfile: () => Promise.resolve(),
    onStatus: () => () => undefined,
  },
  chat: {
    stream: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    onEvent: () => () => undefined,
  },
  settings: {
    get: () => Promise.resolve(DEFAULT_SETTINGS),
    update: () => Promise.resolve(DEFAULT_SETTINGS),
    getAvatar: () => Promise.resolve(null),
    setAvatar: () => Promise.resolve(),
    setDisplayName: () => Promise.resolve(),
  },
  ollama: {
    probe: () => Promise.resolve({ ok: true as const, version: '0.0.0', models: [] as string[] }),
  },
  providers: {
    onFallback: () => () => undefined,
  },
  quiz: {
    listDecks: () => Promise.resolve([]),
    getDeck: (deckId: number) =>
      Promise.resolve({
        deck: {
          id: deckId,
          workspaceId: 1,
          name: 'stub',
          documentIds: [],
          questionCount: 0,
          status: 'ready' as const,
          error: null,
          language: 'en' as const,
          createdAt: Math.floor(Date.now() / 1000),
        },
        questions: [],
      }),
    createDeck: (input) =>
      Promise.resolve({
        id: 1,
        workspaceId: input.workspaceId,
        name: input.name,
        documentIds: input.documentIds,
        questionCount: input.questionCount,
        status: 'generating' as const,
        error: null,
        language: 'en' as const,
        createdAt: Math.floor(Date.now() / 1000),
      }),
    deleteDeck: () => Promise.resolve(),
    regenerateDeck: () => Promise.resolve(),
    generate: () => Promise.resolve(),
    cancelGenerate: () => Promise.resolve(),
    onGenerateEvent: () => () => undefined,
    startAttempt: (deckId: number) =>
      Promise.resolve({
        id: 1,
        deckId,
        startedAt: Math.floor(Date.now() / 1000),
        finishedAt: null,
        score: null,
        answers: [],
      }),
    finishAttempt: (attemptId: number) =>
      Promise.resolve({
        id: attemptId,
        deckId: 1,
        startedAt: Math.floor(Date.now() / 1000) - 10,
        finishedAt: Math.floor(Date.now() / 1000),
        score: 0,
        answers: [],
      }),
    listAttempts: () => Promise.resolve([]),
  },
}

window.api = stub
