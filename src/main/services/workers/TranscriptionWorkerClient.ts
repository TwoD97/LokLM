import type {
  TxWorkerPush,
  WhisperTranscribePayload,
  WhisperTranscribeResult,
} from './transcriptionProtocol'
import { AudioWorkerClient } from './AudioWorkerClient'

/** Isolates Whisper from model inference and document parsing. The native
 * binding cannot abort a single call; a session reset terminates its process. */
export class TranscriptionWorkerClient extends AudioWorkerClient<TxWorkerPush> {
  private progress = new Map<string, (done: number, total: number) => void>()

  constructor() {
    super('transcription', 'transcriptionWorker.js')
  }

  registerProgress(streamId: string, cb: (done: number, total: number) => void): () => void {
    this.progress.set(streamId, cb)
    return () => {
      if (this.progress.get(streamId) === cb) this.progress.delete(streamId)
    }
  }

  protected handlePush(event: TxWorkerPush): void {
    if (event.ev === 'progress') this.progress.get(event.streamId)?.(event.done, event.total)
    else if (event.ev === 'log')
      console[event.level === 'error' ? 'error' : 'log'](`[transcriptionWorker] ${event.message}`)
  }

  protected workerStopped(): void {
    this.progress.clear()
  }

  transcribe(
    payload: WhisperTranscribePayload,
    signal?: AbortSignal,
  ): Promise<WhisperTranscribeResult> {
    return this.send('whisper.transcribe', payload, signal)
  }
}
