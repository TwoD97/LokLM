/**
 * TranslatorSidecar protocol/lifecycle tests against a fake sidecar — a Node
 * one-liner standing in for the C++ exe , exercising the NDJSON framing ,
 * the ready/fatal handshake , request multiplexing , and crash rejection
 * without needing the 2.75 GB model. The real exe's protocol is the same by
 * construction (sidecars/translator/src/main.cpp).
 */

import { describe, it, expect } from 'vitest'

import { TranslatorSidecar } from '../../src/main/services/translation/TranslatorSidecar'

/** Fake sidecar: ready handshake , uppercase "translations" , error op ,
 *  shutdown , and a hard crash trigger for the rejection test. */
const FAKE_SIDECAR = `
const rl = require('node:readline').createInterface({ input: process.stdin });
console.log(JSON.stringify({ ev: 'ready', model: 'fake' }));
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.op === 'ping') return console.log(JSON.stringify({ id: m.id, ok: true }));
  if (m.op === 'shutdown') { console.log(JSON.stringify({ id: m.id, ok: true })); process.exit(0); }
  if (m.op === 'translate') {
    if (m.target === 'boom') return console.log(JSON.stringify({ id: m.id, ok: false, error: 'unsupported target language' }));
    if (m.target === 'crash') process.exit(7);
    return console.log(JSON.stringify({ id: m.id, ok: true, results: m.texts.map((t) => m.target + ':' + t.toUpperCase()) }));
  }
  console.log(JSON.stringify({ id: m.id, ok: false, error: 'unknown op' }));
});
`

const FATAL_SIDECAR = `
console.log(JSON.stringify({ ev: 'fatal', error: 'failed to load model: no such dir' }));
process.exit(1);
`

const SILENT_SIDECAR = `setTimeout(() => {}, 60000);`

function fake(script: string, opts?: { startTimeoutMs?: number }): TranslatorSidecar {
  return new TranslatorSidecar({
    binPath: process.execPath,
    args: ['-e', script],
    startTimeoutMs: opts?.startTimeoutMs,
  })
}

describe('TranslatorSidecar', () => {
  it('start() resolves on the ready handshake and ping round-trips', async () => {
    const s = fake(FAKE_SIDECAR)
    await s.start()
    expect(s.isRunning()).toBe(true)
    await expect(s.ping()).resolves.toBeUndefined()
    await s.dispose()
    expect(s.isRunning()).toBe(false)
  })

  it('translate() returns results in request order', async () => {
    const s = fake(FAKE_SIDECAR)
    await s.start()
    const out = await s.translate(['hallo', 'welt'], 'en', 1)
    expect(out).toEqual(['en:HALLO', 'en:WELT'])
    await s.dispose()
  })

  it('multiplexes concurrent requests by id', async () => {
    const s = fake(FAKE_SIDECAR)
    await s.start()
    const [a, b, c] = await Promise.all([
      s.translate(['eins'], 'en', 1),
      s.translate(['zwei'], 'fr', 1),
      s.translate(['drei'], 'uk', 1),
    ])
    expect(a).toEqual(['en:EINS'])
    expect(b).toEqual(['fr:ZWEI'])
    expect(c).toEqual(['uk:DREI'])
    await s.dispose()
  })

  it('rejects a single failed request without killing the session', async () => {
    const s = fake(FAKE_SIDECAR)
    await s.start()
    await expect(s.translate(['x'], 'boom', 1)).rejects.toThrow(/unsupported target/)
    // Session still healthy afterwards.
    await expect(s.translate(['ok'], 'en', 1)).resolves.toEqual(['en:OK'])
    await s.dispose()
  })

  it('start() rejects on a fatal handshake', async () => {
    const s = fake(FATAL_SIDECAR)
    await expect(s.start()).rejects.toThrow(/failed to load model/)
  })

  it('start() rejects when the sidecar never becomes ready', async () => {
    const s = fake(SILENT_SIDECAR, { startTimeoutMs: 300 })
    await expect(s.start()).rejects.toThrow(/not ready within/)
  })

  it('rejects in-flight requests when the sidecar dies and reports not running', async () => {
    const events: string[] = []
    const s = new TranslatorSidecar({
      binPath: process.execPath,
      args: ['-e', FAKE_SIDECAR],
      events: { onStateChange: (st) => events.push(st) },
    })
    await s.start()
    await expect(s.translate(['x'], 'crash', 1)).rejects.toThrow(/exited/)
    expect(s.isRunning()).toBe(false)
    expect(events).toEqual(['starting', 'ready', 'exited'])
    // Sends after death fail fast instead of hanging.
    await expect(s.ping()).rejects.toThrow(/not running/)
  })
})
