import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintCompiledBuild } from '../e2e/helpers/buildFingerprint'

describe('native calibration compiled-build fingerprint', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'loklm-build-fingerprint-'))
    await mkdir(join(root, 'out/main/chunks'), { recursive: true })
    await mkdir(join(root, 'out/preload'), { recursive: true })
    await writeFile(join(root, 'out/main/index.js'), 'import "./chunks/parser.js"')
    await writeFile(join(root, 'out/main/chunks/parser.js'), 'export const version = 1')
    await writeFile(join(root, 'out/main/documentsWorker.mjs'), 'import "./chunks/parser.js"')
    await writeFile(join(root, 'out/preload/index.cjs'), 'module.exports = {}')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('includes shared chunks, utility workers and preload, excluding source maps and logs', async () => {
    await writeFile(join(root, 'out/main/index.js.map'), '{"ignored":true}')
    await writeFile(join(root, 'out/main/app.log'), 'ignored log')
    const hashes = await fingerprintCompiledBuild(root)
    expect(Object.keys(hashes)).toEqual([
      'out/main/chunks/parser.js',
      'out/main/documentsWorker.mjs',
      'out/main/index.js',
      'out/preload/index.cjs',
    ])
    expect(Object.values(hashes).every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true)
    expect(await fingerprintCompiledBuild(root)).toEqual(hashes)
  })

  it('detects a changed shared dependency even when entrypoint bytes remain identical', async () => {
    const before = await fingerprintCompiledBuild(root)
    await writeFile(join(root, 'out/main/chunks/parser.js'), 'export const version = 2')
    const after = await fingerprintCompiledBuild(root)
    expect(after['out/main/index.js']).toBe(before['out/main/index.js'])
    expect(after).not.toEqual(before)
    expect(after['out/main/chunks/parser.js']).not.toBe(before['out/main/chunks/parser.js'])
  })

  it('detects replacement chunk names and rejects a missing output directory', async () => {
    const before = await fingerprintCompiledBuild(root)
    await rm(join(root, 'out/main/chunks/parser.js'))
    await writeFile(join(root, 'out/main/chunks/parser-new.js'), 'export const version = 1')
    expect(await fingerprintCompiledBuild(root)).not.toEqual(before)
    await rm(join(root, 'out/preload'), { recursive: true, force: true })
    await expect(fingerprintCompiledBuild(root)).rejects.toThrow()
  })
})
