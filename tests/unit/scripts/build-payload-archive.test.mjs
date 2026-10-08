import { it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  buildPayloadArchive,
  portableArchivePath,
} from '../../../scripts/build-payload-archive.mjs'

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

it('normalizes only host separators and rejects paths the portable extractor refuses', () => {
  expect(portableArchivePath('Versions\\Current', 'win32')).toBe('Versions/Current')
  expect(portableArchivePath('Versions/Current', 'darwin')).toBe('Versions/Current')
  expect(() => portableArchivePath('literal\\name', 'darwin')).toThrow(/Nonportable/)
  expect(() => portableArchivePath('literal:name', 'darwin')).toThrow(/Nonportable/)
})

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

async function archiveHeaders(sourceDir, outFile) {
  await buildPayloadArchive({ sourceDir, tarRoot: 'LokLM.app', outFile })
  const tar = await import('tar-stream')
  const zstd = await import('@mongodb-js/zstd')
  const extract = tar.extract()
  const headers = []
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      headers.push(header)
      stream.on('end', next).resume()
    })
    extract.on('finish', resolve).on('error', reject)
    void readFile(outFile)
      .then(zstd.decompress)
      .then((raw) => extract.end(raw))
      .catch(reject)
  })
  return headers
}

// Native Mac CI runs these with real POSIX links. Windows requires a privileged
// symlink capability that the local development/test account does not have.
it.skipIf(process.platform === 'win32')(
  'preserves framework symlinks and empty directories without duplicating signed files',
  async () => {
    const sourceDir = join(work, 'framework-app')
    await mkdir(join(sourceDir, 'Versions', 'A', 'Resources'), { recursive: true })
    await writeFile(join(sourceDir, 'Versions', 'A', 'Electron Framework'), 'signed binary')
    await symlink('A', join(sourceDir, 'Versions', 'Current'), 'dir')
    await symlink(
      'Versions/Current/Electron Framework',
      join(sourceDir, 'Electron Framework'),
      'file',
    )
    await symlink('Versions/Current/Resources', join(sourceDir, 'Resources'), 'dir')
    const headers = await archiveHeaders(sourceDir, join(work, 'framework.tar.zst'))
    expect(headers.find((h) => h.name === 'LokLM.app/Versions/Current')).toMatchObject({
      type: 'symlink',
      linkname: 'A',
      size: 0,
    })
    expect(headers.find((h) => h.name === 'LokLM.app/Electron Framework')).toMatchObject({
      type: 'symlink',
      linkname: 'Versions/Current/Electron Framework',
    })
    expect(headers.find((h) => h.name === 'LokLM.app/Versions/A/Resources')).toMatchObject({
      type: 'directory',
    })
    expect(headers.filter((h) => h.type === 'file')).toHaveLength(1)
  },
)

it.skipIf(process.platform === 'win32')(
  'rejects links escaping the payload instead of archiving outside bytes',
  async () => {
    const sourceDir = join(work, 'unsafe-app')
    await mkdir(sourceDir)
    await writeFile(join(work, 'outside.txt'), 'outside payload')
    await symlink('../outside.txt', join(sourceDir, 'escape'), 'file')
    await expect(
      buildPayloadArchive({
        sourceDir,
        tarRoot: 'LokLM.app',
        outFile: join(work, 'unsafe.tar.zst'),
      }),
    ).rejects.toThrow(/escapes/)
  },
)

it('rejects invalid archive root paths', async () => {
  await expect(
    buildPayloadArchive({
      sourceDir: join(work, 'win-unpacked'),
      tarRoot: '../escape',
      outFile: join(work, 'root.tar.zst'),
    }),
  ).rejects.toThrow(/root/)
})
