import { randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

type StagedStream = {
  ws: WriteStream
  path: string
  closed: Promise<void>
  error: Error | null
  state: 'open' | 'committing' | 'committed' | 'cleaning'
  commit: Promise<{ tempPath: string }> | null
  cleanup: Promise<void> | null
}

/** Accumulates renderer PCM chunks on disk, keeping at most the awaited chunk
 * in the write buffer. A committed file is closed before a worker can read it. */
export class AudioStager {
  private streams = new Map<string, StagedStream>()

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  begin(): string {
    // Multiple app instances share the temp directory. Never overwrite another
    // instance's in-flight recording or a file left by an interrupted session.
    const id = `aud-${randomUUID()}`
    const path = join(this.dir, `${id}.f32`)
    const ws = createWriteStream(path, { flags: 'wx' })
    const stream: StagedStream = {
      ws,
      path,
      error: null,
      state: 'open',
      commit: null,
      cleanup: null,
      closed: new Promise<void>((resolve) => ws.once('close', resolve)),
    }
    // Errors can arrive between IPC calls, including the asynchronous file
    // open. Keep a listener for the entire stream lifetime, not just commit.
    ws.on('error', (error) => {
      stream.error ??= error
    })
    this.streams.set(id, stream)
    return id
  }

  async chunk(id: string, bytes: Uint8Array): Promise<void> {
    const stream = this.get(id)
    try {
      if (stream.error) throw stream.error
      if (stream.state !== 'open') throw new Error('Audio staging is already closed for writes.')
      if (stream.ws.destroyed) throw new Error('Audio staging closed before the chunk was written.')
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error | null): void => {
          stream.ws.removeListener('error', onError)
          stream.ws.removeListener('close', onClose)
          if (error) reject(error)
          else resolve()
        }
        const onError = (error: Error): void => finish(error)
        const onClose = (): void =>
          finish(stream.error ?? new Error('Audio staging closed before the chunk was written.'))
        stream.ws.once('error', onError)
        stream.ws.once('close', onClose)
        try {
          // Await the write callback instead of drain alone: failed streams
          // may never drain. This also bounds memory for sequential IPC chunks.
          stream.ws.write(Buffer.from(bytes), finish)
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      })
    } catch (error) {
      // No transcription run follows a failed upload, so it cannot own cleanup.
      if (stream.state === 'open') await this.cleanup(id)
      throw error
    }
  }

  async commit(id: string): Promise<{ tempPath: string }> {
    const stream = this.get(id)
    if (stream.commit) return stream.commit
    if (stream.state !== 'open') throw new Error('Audio staging is already closed.')
    stream.state = 'committing'
    stream.commit = (async () => {
      try {
        if (stream.error) throw stream.error
        stream.ws.end()
        await stream.closed
        if (stream.error) throw stream.error
        if (!stream.ws.writableFinished || stream.state === 'cleaning')
          throw new Error('Audio staging closed before it was committed.')
        stream.state = 'committed'
        return { tempPath: stream.path }
      } catch (error) {
        await this.cleanup(id)
        throw error
      }
    })()
    return stream.commit
  }

  async cleanup(id: string): Promise<void> {
    const stream = this.streams.get(id)
    if (!stream) return
    if (stream.cleanup) return stream.cleanup
    stream.state = 'cleaning'
    stream.cleanup = (async () => {
      stream.ws.destroy()
      // Windows cannot reliably unlink an open handle. Destroy is asynchronous,
      // so wait for close even when cleanup races the initial open or a write.
      await stream.closed
      await rm(stream.path, { force: true, maxRetries: 3, retryDelay: 50 })
      if (this.streams.get(id) === stream) this.streams.delete(id)
    })()
    try {
      await stream.cleanup
    } catch (error) {
      stream.cleanup = null
      throw error
    }
  }

  pathFor(id: string): string {
    const stream = this.get(id)
    if (stream.error) throw stream.error
    if (stream.state !== 'committed') throw new Error('Audio staging has not been committed.')
    return stream.path
  }

  async cleanupAll(): Promise<void> {
    const results = await Promise.allSettled([...this.streams.keys()].map((id) => this.cleanup(id)))
    const failed = results.filter((result) => result.status === 'rejected')
    if (failed.length)
      throw new AggregateError(
        failed.map((result) => result.reason),
        'Audio staging cleanup failed.',
      )
  }

  private get(id: string): StagedStream {
    const stream = this.streams.get(id)
    if (!stream) throw new Error(`unknown audioId ${id}`)
    return stream
  }
}
