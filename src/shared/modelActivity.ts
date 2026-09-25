export type ModelTask = 'llm' | 'embedder' | 'reranker'

export interface ModelTransition {
  phase: 'idle' | 'switching' | 'error'
  target: ModelTask | null
  stage: 'releasing' | 'loading' | null
  progress: number | null
  error: string | null
}

export interface IndexingJob {
  workspaceId: number
  title: string
  done: number
  total: number
}

export interface ModelActivity extends Omit<ModelTransition, 'phase'> {
  phase: ModelTransition['phase'] | 'indexing' | 'restoring'
  jobs: IndexingJob[]
}

export interface IndexingLease {
  update(done: number, total: number): void
  release(): void
}

export const IDLE_MODEL_TRANSITION: ModelTransition = {
  phase: 'idle',
  target: null,
  stage: null,
  progress: null,
  error: null,
}
