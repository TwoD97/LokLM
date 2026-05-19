// renderer-visible shape of a document. mirrors src/main/db/schema.ts Document
// type but lives in src/shared so it's safe to import from the renderer , which
// can't reach into src/main.
export interface Document {
  id: number
  workspaceId: number
  title: string
  sourcePath: string
  mimeType: string | null
  byteSize: number | null
  status: 'pending' | 'indexing' | 'ready' | 'failed'
  chunkCount: number
  tokenCount: number
  addedAt: number
}

export interface Workspace {
  id: number
  name: string
  createdAt: number
}

export interface IndexProgress {
  documentId: number
  title: string
  phase: 'parsing' | 'chunking' | 'embedding' | 'persisting' | 'done' | 'failed'
  step: number
  total: number
  error?: string
}

export type EmbedderState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface EmbedderStatus {
  kind: 'embedder'
  state: EmbedderState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
}

export interface EmbedderInfo extends EmbedderStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementChoice: 'auto' | 'cpu' | 'gpu'
  placementReason: string | null
}

export interface BackfillStatus {
  workspaceId: number
  state: 'idle' | 'running' | 'done' | 'failed'
  done: number
  total: number
  message: string | null
}

export type RerankerState = 'idle' | 'loading' | 'ready' | 'failed' | 'unloaded'

export interface RerankerStatus {
  kind: 'reranker'
  state: RerankerState
  modelPath: string | null
  modelName: string | null
  loadProgress: number | null
  message: string | null
}

export interface RerankerInfo extends RerankerStatus {
  bundledModelPath: string
  bundledModelExists: boolean
  resolvedPlacement: 'cpu' | 'gpu' | null
  placementChoice: 'auto' | 'cpu' | 'gpu'
  placementReason: string | null
}

export interface RetrievalHit {
  chunk_id: number
  document_id: number
  document_title: string
  ordinal: number
  page_from: number | null
  page_to: number | null
  text: string
  score: number
  origin?: 'primary' | 'neighbour' | 'whole_doc'
}

export interface RetrievalOptions {
  multiQuery?: boolean
  rerank?: boolean
  documentDiversity?: boolean
  wholeDocFallback?: boolean
  wholeDocThreshold?: number
  neighbourRadius?: number
  activeDocumentIds?: number[] | null
  perDocCandidateCap?: number
  titleBoostFactor?: number
  shortChunkPenalty?: number
  shortChunkMinChars?: number
  recencyBoostFactor?: number
  recencyBoostWindowMs?: number
}
