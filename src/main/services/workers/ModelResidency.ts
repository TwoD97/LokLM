import {
  IDLE_MODEL_TRANSITION,
  type ModelTask,
  type ModelTransition,
} from '../../../shared/modelActivity'
import { isMemoryError } from './modelMemory'

/** Called only inside the native backend serializer. Configured models can be
 * parked without forgetting their selection; inference reloads them on demand. */
export class ModelResidency {
  constructor(
    private readonly deps: {
      loaded: (task: ModelTask) => boolean
      unload: (task: ModelTask) => Promise<void>
      resources: () => Promise<{ hasGpu: boolean; totalVramGB: number; freeVramGB: number }>
      activity: (state: ModelTransition) => void
    },
  ) {}

  async load<T>(task: ModelTask, weightsBytes: number, load: () => Promise<T>): Promise<T> {
    const activity = (stage: ModelTransition['stage']): void =>
      this.deps.activity({
        ...IDLE_MODEL_TRANSITION,
        phase: 'switching',
        target: task,
        stage,
      })
    const releaseOthers = async (): Promise<void> => {
      activity('releasing')
      for (const other of ['llm', 'embedder', 'reranker'] as const)
        if (other !== task && this.deps.loaded(other)) await this.deps.unload(other)
    }
    try {
      const resources = await this.deps.resources()
      if (!resources.hasGpu)
        throw new Error(
          'A working GPU is required. Check your graphics driver and selected device.',
        )
      // Small cards get one task's model at a time. Roomy GPUs retain models
      // when both weights and working memory fit, avoiding needless reloads.
      if (resources.totalVramGB <= 6 || resources.freeVramGB < weightsBytes / 1024 ** 3 + 1.5)
        await releaseOthers()
      activity('loading')
      let result: T
      try {
        result = await load()
      } catch (error) {
        const others = (['llm', 'embedder', 'reranker'] as const).some(
          (other) => other !== task && this.deps.loaded(other),
        )
        if (!isMemoryError(error) || !others) throw error
        await releaseOthers()
        activity('loading')
        result = await load()
      }
      this.deps.activity(IDLE_MODEL_TRANSITION)
      return result
    } catch (error) {
      this.deps.activity({
        ...IDLE_MODEL_TRANSITION,
        phase: 'error',
        target: task,
        error: String(error),
      })
      throw error
    }
  }
}
