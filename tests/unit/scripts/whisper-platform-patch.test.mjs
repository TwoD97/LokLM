import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const entry = require.resolve('@kutalia/whisper-node-addon')
const source = readFileSync(entry, 'utf8')

// Execute the installed package entrypoint itself. Only the OS identity and
// native binding are replaced; path construction and import-time loading are
// the real dependency code. No model, native addon or GPU is loaded.
function loadFor(platform, arch, { nativeError, requests = [] } = {}) {
  const module = { exports: {} }
  const calls = []
  const result = [{ text: 'synthetic transcript' }]
  function mockedRequire(name) {
    if (name === 'os') return { platform: () => platform, arch: () => arch }
    if (name === 'path') return path
    if (name === 'util') return { promisify }
    if (!path.isAbsolute(name) || path.basename(name) !== 'whisper.node') {
      throw new Error(`Unexpected dependency: ${name}`)
    }
    requests.push(name)
    if (!existsSync(name)) throw new Error('Requested native addon does not exist')
    if (nativeError) throw nativeError
    return {
      whisper(options, callback) {
        calls.push(options)
        callback(null, result)
      },
    }
  }
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: mockedRequire,
    __dirname: path.dirname(entry),
  })
  return { addon: module.exports, requests, calls, result }
}

describe('installed Whisper platform loader', () => {
  it.each([
    ['darwin', 'arm64', 'mac-arm64'],
    ['darwin', 'x64', 'mac-x64'],
    ['linux', 'x64', 'linux-x64'],
    ['win32', 'x64', 'win32-x64'],
  ])(
    'loads the shipped %s/%s binding and preserves transcription options',
    async (os, arch, dir) => {
      const loaded = loadFor(os, arch)
      expect(loaded.requests).toEqual([path.join(path.dirname(entry), '..', dir, 'whisper.node')])
      const result = await loaded.addon.transcribe({
        model: 'synthetic-model.bin',
        fname_inp: 'synthetic-audio.wav',
        language: 'de',
        translate: false,
      })
      expect(result).toBe(loaded.result)
      expect(loaded.calls).toHaveLength(1)
      expect(loaded.calls[0]).toMatchObject({
        model: 'synthetic-model.bin',
        fname_inp: 'synthetic-audio.wav',
        language: 'de',
        translate: false,
        use_gpu: true,
      })
    },
  )

  it('rejects an unsupported platform before trying a native binding', () => {
    const requests = []
    expect(() => loadFor('freebsd', 'x64', { requests })).toThrow('Unsupported platform: freebsd')
    expect(requests).toEqual([])
  })

  it('retains native-load failure reporting without trying another architecture', () => {
    const requests = []
    expect(() =>
      loadFor('darwin', 'arm64', {
        requests,
        nativeError: new Error('synthetic native load failure'),
      }),
    ).toThrow('Failed to load native addon: Error: synthetic native load failure')
    expect(requests).toEqual([path.join(path.dirname(entry), '..', 'mac-arm64', 'whisper.node')])
  })
})
