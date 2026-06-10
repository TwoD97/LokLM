import { createWriteStream, mkdirSync, rmSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

/**
 * Accumulates renderer-streamed PCM chunks into a single temp `.f32` file, with
 * write backpressure so a long recording doesn't buffer entirely in memory.
 *
 * Kept electron-free (node:fs only) so it is unit-testable without the electron
 * runtime — the rest of TranscriptionService pulls in electron + the workers.
 */
export class AudioStager {
  private streams = new Map<string, { ws: WriteStream; path: string }>()
  private seq = 0
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }
  begin(): string {
    const id = `aud-${++this.seq}`
    const path = join(this.dir, `${id}.f32`)
    this.streams.set(id, { ws: createWriteStream(path), path })
    return id
  }
  async chunk(id: string, bytes: Uint8Array): Promise<void> {
    const s = this.streams.get(id)
    if (!s) throw new Error(`unknown audioId ${id}`)
    if (!s.ws.write(Buffer.from(bytes))) {
      await new Promise<void>((res) => s.ws.once('drain', res))
    }
  }
  /** Flush + close the stream so the file is complete before a worker reads it. */
  async commit(id: string, _durationSec: number): Promise<{ tempPath: string }> {
    const s = this.streams.get(id)
    if (!s) throw new Error(`unknown audioId ${id}`)
    await new Promise<void>((res, rej) => {
      s.ws.on('error', rej)
      s.ws.end(() => res())
    })
    return { tempPath: s.path }
  }
  cleanup(id: string): void {
    const s = this.streams.get(id)
    if (!s) return
    try {
      s.ws.destroy()
    } catch {
      /* ignore */
    }
    rmSync(s.path, { force: true })
    this.streams.delete(id)
  }
  pathFor(id: string): string {
    const s = this.streams.get(id)
    if (!s) throw new Error(`unknown audioId ${id}`)
    return s.path
  }
}
