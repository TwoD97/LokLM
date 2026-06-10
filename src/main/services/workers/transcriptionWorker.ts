// Dedicated whisper worker: read a staged 16 kHz mono Float32 PCM file and
// transcribe it via @kutalia/whisper-node-addon (prebuilt whisper.cpp). Spawned
// via utilityProcess.fork from main (see TranscriptionWorkerClient). Isolated
// from the models + documents workers per the worker-isolation convention.
//
// The binding loads the model per call and returns the whole transcript at once
// (timestamps as "HH:MM:SS.mmm" strings); it reports coarse progress (0..100)
// via progress_callback. There is no mid-run abort, so cancellation is handled
// on the main side by ignoring a job's result.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseClock } from '@shared/subtitles'
import type {
  TxWorkerRequest,
  TxWorkerResponse,
  TxWorkerPush,
  WhisperTranscribePayload,
  WhisperTranscribeResult,
} from './transcriptionProtocol'
import type { TranscriptSegment } from '@shared/transcription'

// utilityProcess provides process.parentPort with postMessage / on('message').
declare const process: NodeJS.Process & {
  parentPort: {
    postMessage: (msg: unknown) => void
    on: (ev: 'message', cb: (msg: TxWorkerRequest) => void) => void
  }
}

const require = createRequire(import.meta.url)
const addon = require('@kutalia/whisper-node-addon') as {
  transcribe: (opts: Record<string, unknown>) => Promise<{ transcription: string[][] | string[] }>
}

function send(msg: TxWorkerResponse | TxWorkerPush): void {
  process.parentPort.postMessage(msg)
}
function reply<T>(id: number, result: T): void {
  send({ id, ok: true, result } as TxWorkerResponse<T>)
}
function fail(id: number, err: unknown): void {
  send({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
}

function readPcm(path: string): Float32Array {
  const buf = readFileSync(path)
  const view = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  // Native addon needs a 4-byte-aligned buffer; copy only if the file's Buffer
  // view isn't aligned (rare — dedicated allocations start at offset 0).
  return buf.byteOffset % 4 === 0 ? view : new Float32Array(view)
}

async function onTranscribe(p: WhisperTranscribePayload): Promise<WhisperTranscribeResult> {
  const pcm = readPcm(p.audioPath)
  const { transcription } = await addon.transcribe({
    pcmf32: pcm,
    model: p.modelPath,
    language: p.language === 'auto' ? 'auto' : p.language,
    translate: p.task === 'translate',
    use_gpu: p.gpu,
    n_threads: p.threads,
    no_prints: true,
    comma_in_time: false,
    progress_callback: (prog: unknown) =>
      send({ ev: 'progress', streamId: p.streamId, done: Number(prog) || 0, total: 100 }),
  })
  const segments: TranscriptSegment[] = []
  for (const row of transcription as string[][]) {
    if (Array.isArray(row) && row.length >= 3) {
      const text = String(row[2]).trim()
      if (text.length > 0)
        segments.push({ start: parseClock(row[0]!), end: parseClock(row[1]!), text })
    }
  }
  return { segments }
}

process.parentPort.on('message', (raw: TxWorkerRequest) => {
  const msg = (raw as unknown as { data?: TxWorkerRequest }).data ?? raw
  void (async () => {
    try {
      switch (msg.op) {
        case 'whisper.transcribe':
          reply(msg.id, await onTranscribe(msg.payload))
          break
        case 'shutdown':
          reply(msg.id, null)
          break
      }
    } catch (err) {
      if ('id' in msg) fail(msg.id, err)
    }
  })()
})
