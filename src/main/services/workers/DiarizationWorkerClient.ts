import type {
  DiarWorkerPush,
  DiarLoadPayload,
  DiarRunPayload,
  DiarTurnDto,
} from './diarizationProtocol'
import { AudioWorkerClient } from './AudioWorkerClient'

/** Lazily loads the diarization models once per worker. Session reset releases
 * them and clears selection state before another account may use this process. */
export class DiarizationWorkerClient extends AudioWorkerClient<DiarWorkerPush> {
  private progress = new Map<string, (done: number, total: number) => void>()
  private loaded: DiarLoadPayload | null = null

  constructor() {
    super('diarization', 'diarizationWorker.js')
  }

  registerProgress(streamId: string, cb: (done: number, total: number) => void): () => void {
    this.progress.set(streamId, cb)
    return () => {
      if (this.progress.get(streamId) === cb) this.progress.delete(streamId)
    }
  }

  protected handlePush(event: DiarWorkerPush): void {
    if (event.ev === 'progress') this.progress.get(event.streamId)?.(event.done, event.total)
    else if (event.ev === 'log')
      console[event.level === 'error' ? 'error' : 'log'](`[diarizationWorker] ${event.message}`)
  }

  protected workerStopped(): void {
    this.progress.clear()
    this.loaded = null
  }

  async ensureLoaded(payload: DiarLoadPayload, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (
      this.loaded &&
      this.loaded.segmentationPath === payload.segmentationPath &&
      this.loaded.embeddingPath === payload.embeddingPath &&
      this.loaded.threads === payload.threads
    )
      return
    await this.send('diar.load', payload, signal)
    this.loaded = payload
  }

  diarize(payload: DiarRunPayload, signal?: AbortSignal): Promise<{ turns: DiarTurnDto[] }> {
    return this.send('diar.run', payload, signal)
  }
}
