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
