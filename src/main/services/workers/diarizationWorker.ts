// Dedicated speaker-diarization worker: sherpa-onnx-node OfflineSpeakerDiarization
// over a staged 16 kHz mono Float32 PCM file. Lazily spawned only when the user
// enables diarization (see DiarizationWorkerClient). Fully offline, CPU.
//
// process() is synchronous and runs at ~6x realtime on CPU; we emit a coarse
// start/end progress tick around it.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type {
  DiarWorkerRequest,
  DiarWorkerResponse,
  DiarWorkerPush,
  DiarLoadPayload,
  DiarRunPayload,
  DiarTurnDto,
} from './diarizationProtocol'

declare const process: NodeJS.Process & {
  parentPort: {
    postMessage: (msg: unknown) => void
    on: (ev: 'message', cb: (msg: DiarWorkerRequest) => void) => void
  }
}

interface SpeakerDiarizer {
  sampleRate: number
  process: (samples: Float32Array) => DiarTurnDto[]
  setConfig: (config: { clustering: { numClusters?: number; threshold?: number } }) => void
}

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node') as {
  OfflineSpeakerDiarization: new (config: unknown) => SpeakerDiarizer
}

function send(msg: DiarWorkerResponse | DiarWorkerPush): void {
  process.parentPort.postMessage(msg)
}
function reply<T>(id: number, result: T): void {
  send({ id, ok: true, result } as DiarWorkerResponse<T>)
}
function fail(id: number, err: unknown): void {
  send({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
}

let sd: SpeakerDiarizer | null = null
let currentClusters = -1

function load(p: DiarLoadPayload): void {
  sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: p.segmentationPath }, numThreads: p.threads },
    embedding: { model: p.embeddingPath, numThreads: p.threads },
    clustering: { numClusters: -1, threshold: 0.5 },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  })
  currentClusters = -1
}

function readPcm(path: string): Float32Array {
  const buf = readFileSync(path)
  const view = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  return buf.byteOffset % 4 === 0 ? view : new Float32Array(view)
}

function run(p: DiarRunPayload): { turns: DiarTurnDto[] } {
  if (!sd) throw new Error('diarization models not loaded')
  const want = p.speakers && p.speakers > 0 ? p.speakers : -1
  if (want !== currentClusters) {
    sd.setConfig({ clustering: { numClusters: want, threshold: 0.5 } })
    currentClusters = want
  }
  const pcm = readPcm(p.audioPath)
  send({ ev: 'progress', streamId: p.streamId, done: 0, total: 1 })
  const turns = sd.process(pcm)
  send({ ev: 'progress', streamId: p.streamId, done: 1, total: 1 })
  return { turns }
}

process.parentPort.on('message', (raw: DiarWorkerRequest) => {
  const msg = (raw as unknown as { data?: DiarWorkerRequest }).data ?? raw
  try {
    switch (msg.op) {
      case 'diar.load':
        load(msg.payload)
        reply(msg.id, { loaded: true })
        break
      case 'diar.run':
        reply(msg.id, run(msg.payload))
        break
      case 'shutdown':
        sd = null
        reply(msg.id, null)
        break
    }
  } catch (err) {
    if ('id' in msg) fail(msg.id, err)
  }
})
