import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildPayloadArchive } from '../../../scripts/build-payload-archive.mjs'

let work
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'loklm-payload-test-'))
  // Fixture: minimal win-unpacked layout (2 files, 1 nested dir)
  const src = join(work, 'win-unpacked')
  await mkdir(join(src, 'resources/app.asar.unpacked'), { recursive: true })
  await writeFile(join(src, 'LokLM.exe'), 'fake-exe')
  await writeFile(join(src, 'resources/app.asar.unpacked/hello.txt'), 'hello')
})
afterAll(() => rm(work, { recursive: true, force: true }))

it('produces a .tar.zst + .sha256 sidecar with matching hash', async () => {
  const out = join(work, 'payload-win-x64.tar.zst')
  await buildPayloadArchive({
    sourceDir: join(work, 'win-unpacked'),
    tarRoot: 'win-unpacked',
    outFile: out,
  })

  const archive = await readFile(out)
  const expected = createHash('sha256').update(archive).digest('hex')

  const sidecar = await readFile(out + '.sha256', 'utf8')
  expect(sidecar.trim()).toBe(expected)

  const size = (await stat(out)).size
  expect(size).toBeGreaterThan(0)
})

it('tar root matches the requested prefix', async () => {
  const out = join(work, 'payload-test-2.tar.zst')
  await buildPayloadArchive({
    sourceDir: join(work, 'win-unpacked'),
    tarRoot: 'win-unpacked',
    outFile: out,
  })
  // List entries via tar-stream to confirm root prefix
  const tar = await import('tar-stream')
  const zstd = await import('@mongodb-js/zstd')
  const compressed = await readFile(out)
  const raw = await zstd.decompress(compressed)
  const extract = tar.extract()
  const entries = []
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      entries.push(header.name)
      stream.on('end', next).resume()
    })
    extract.on('finish', resolve).on('error', reject)
    extract.end(raw)
  })
  expect(entries.every((e) => e.startsWith('win-unpacked/'))).toBe(true)
  expect(entries).toContain('win-unpacked/LokLM.exe')
})
