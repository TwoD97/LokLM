import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WHISPER_MAC_SOURCES,
  WHISPER_MAC_CMAKE,
  nativeMacArchitecture,
  macCmakeArguments,
  verifyWhisperGitlink,
  downloadVerifiedHeaders,
  verifyHeaderArchiveEntries,
  verifyBuildCache,
  promoteWhisperDirectory,
} from '../../../scripts/build-whisper-mac.mjs'

const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'loklm-whisper-builder-test-'))
  dirs.push(dir)
  return dir
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

describe('Whisper native build input boundaries', () => {
  it('uses explicit real native Mac architectures and skips other operating systems', () => {
    expect(nativeMacArchitecture('darwin', 'arm64')).toBe('arm64')
    expect(nativeMacArchitecture('darwin', 'x64')).toBe('x86_64')
    expect(nativeMacArchitecture('linux', 'x64')).toBeNull()
    expect(nativeMacArchitecture('win32', 'x64')).toBeNull()
    expect(() => nativeMacArchitecture('darwin', 'ia32')).toThrow('Unsupported')
  })

  it('does not infer architecture from an output directory name', () => {
    const args = macCmakeArguments({
      wrapper: '/tmp/source with spaces',
      build: '/tmp/build',
      source: '/tmp/whisper',
      output: '/tmp/output/mac-arm64',
      headers: '/tmp/headers',
      addonApi: '/tmp/api',
      arch: 'x64',
      clang: '/usr/bin/clang',
      clangxx: '/usr/bin/clang++',
    })
    expect(args).toContain('-DCMAKE_OSX_ARCHITECTURES=x86_64')
    expect(args).toContain('/tmp/source with spaces')
    expect(args).toContain('-DWHISPER_OUTPUT=/tmp/output/mac-arm64')
  })

  it('rejects a moved or wrong Whisper submodule pin', () => {
    expect(() =>
      verifyWhisperGitlink(
        `160000 commit ${WHISPER_MAC_SOURCES.whisperCommit}\tdeps/whisper.cpp\n`,
      ),
    ).not.toThrow()
    expect(() => verifyWhisperGitlink(`160000 commit ${'a'.repeat(40)}\tdeps/whisper.cpp`)).toThrow(
      'submodule',
    )
    expect(() =>
      verifyWhisperGitlink(`100644 blob ${WHISPER_MAC_SOURCES.whisperCommit}\tdeps/whisper.cpp`),
    ).toThrow('submodule')
  })

  it('rejects tampered headers before writing or replacing any destination', async () => {
    const dir = await temp()
    const destination = join(dir, 'headers.tar.gz')
    await writeFile(destination, 'keep-existing')
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: [Buffer.from('wrong pinned source bytes')],
    }))
    await expect(downloadVerifiedHeaders(destination, { fetchImpl })).rejects.toThrow(
      'SHA256 mismatch',
    )
    expect(await readFile(destination, 'utf8')).toBe('keep-existing')
    expect(fetchImpl.mock.calls[0][0]).toBe(WHISPER_MAC_SOURCES.nodeHeadersUrl)
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error')
  })

  it('rejects oversized responses before collecting their body', async () => {
    const destination = join(await temp(), 'headers.tar.gz')
    await expect(
      downloadVerifiedHeaders(destination, {
        fetchImpl: async () => ({
          ok: true,
          headers: new Headers({ 'content-length': String(65 * 1024 * 1024) }),
          body: [],
        }),
      }),
    ).rejects.toThrow('size limit')
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('permits only contained regular files/directories in the verified header archive', () => {
    const prefix = WHISPER_MAC_SOURCES.nodeHeadersRoot
    expect(() =>
      verifyHeaderArchiveEntries(
        `${prefix}/\n${prefix}/include/node/node_api.h\n`,
        'drwxr-xr-x root\n-rw-r--r-- header\n',
      ),
    ).not.toThrow()
    for (const bad of [
      '/tmp/escape',
      `${prefix}/../escape`,
      `${prefix}/include\\escape`,
      `${prefix}/C:/escape`,
    ])
      expect(() => verifyHeaderArchiveEntries(bad, '-rw-r--r-- entry')).toThrow('archive path')
    expect(() => verifyHeaderArchiveEntries(`${prefix}/link`, 'lrwxrwxrwx link -> /tmp')).toThrow(
      'links',
    )
  })

  it('does not depend on upstream build-host dylib paths or external Metal files', () => {
    expect(WHISPER_MAC_CMAKE).toContain('set(BUILD_SHARED_LIBS OFF')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_BACKEND_DL OFF')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_METAL ON')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_METAL_EMBED_LIBRARY ON')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_BLAS OFF')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_ACCELERATE OFF')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_OPENMP OFF')
    expect(WHISPER_MAC_CMAKE).toContain('set(GGML_NATIVE OFF')
    expect(WHISPER_MAC_CMAKE).toContain('set(CMAKE_SKIP_RPATH ON)')
  })
})

async function cachedPackage() {
  const root = await temp()
  const active = join(root, 'dist/mac-arm64')
  await mkdir(active, { recursive: true })
  await writeFile(join(active, 'whisper.node'), 'synthetic verified binary')
  await writeFile(
    join(active, 'loklm-native-build.json'),
    JSON.stringify({
      arch: 'arm64',
      inputFingerprint: 'current-inputs',
      binarySha256: sha256('synthetic verified binary'),
    }),
  )
  return { root, active }
}

describe('Whisper cache admission', () => {
  it('requires actual native/relocated validation even when hashes match', async () => {
    const { root } = await cachedPackage()
    const verify = vi.fn(async () => {})
    expect(await verifyBuildCache(root, 'current-inputs', 'arm64', { verify })).toBe(true)
    expect(verify).toHaveBeenCalledWith(root)
    const failedNative = vi.fn(async () => {
      throw new Error('wrong native architecture')
    })
    expect(await verifyBuildCache(root, 'current-inputs', 'arm64', { verify: failedNative })).toBe(
      false,
    )
  })

  it('rejects changed inputs or tampered cached binary before executing it', async () => {
    const { root, active } = await cachedPackage()
    const verify = vi.fn(async () => {})
    expect(await verifyBuildCache(root, 'old-inputs', 'arm64', { verify })).toBe(false)
    await writeFile(join(active, 'whisper.node'), 'tampered')
    expect(await verifyBuildCache(root, 'current-inputs', 'arm64', { verify })).toBe(false)
    expect(verify).not.toHaveBeenCalled()
  })

  it('does not accept old shared-library residue or another architecture', async () => {
    const { root, active } = await cachedPackage()
    const verify = vi.fn(async () => {})
    expect(await verifyBuildCache(root, 'current-inputs', 'x64', { verify })).toBe(false)
    await writeFile(join(active, 'libggml.dylib'), 'old shared binary')
    expect(await verifyBuildCache(root, 'current-inputs', 'arm64', { verify })).toBe(false)
    expect(verify).not.toHaveBeenCalled()
  })
})

async function promotionFixture({ previous = true } = {}) {
  const root = await temp()
  const candidate = join(root, 'candidate')
  const target = join(root, 'target')
  const backup = join(root, 'backup')
  await mkdir(candidate)
  await writeFile(join(candidate, 'whisper.node'), 'new')
  if (previous) {
    await mkdir(target)
    await writeFile(join(target, 'whisper.node'), 'old')
  }
  return { root, candidate, target, backup }
}

describe('Whisper native directory promotion', () => {
  it('retains old bytes until installed validation succeeds', async () => {
    const f = await promotionFixture()
    await promoteWhisperDirectory(f.candidate, f.target, f.backup, async () => {
      expect(await readFile(join(f.target, 'whisper.node'), 'utf8')).toBe('new')
      expect(await readFile(join(f.backup, 'whisper.node'), 'utf8')).toBe('old')
    })
    expect(await readFile(join(f.target, 'whisper.node'), 'utf8')).toBe('new')
  })

  it('restores the complete previous directory after native validation fails', async () => {
    const f = await promotionFixture()
    await writeFile(join(f.target, 'preserve.txt'), 'keep')
    await expect(
      promoteWhisperDirectory(f.candidate, f.target, f.backup, async () => {
        throw new Error('native load failed')
      }),
    ).rejects.toThrow('native load failed')
    expect(await readFile(join(f.target, 'whisper.node'), 'utf8')).toBe('old')
    expect(await readFile(join(f.target, 'preserve.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(f.candidate, 'whisper.node'), 'utf8')).toBe('new')
  })

  it('restores the previous directory if candidate promotion itself fails', async () => {
    const f = await promotionFixture()
    await rm(f.candidate, { recursive: true })
    const verify = vi.fn()
    await expect(
      promoteWhisperDirectory(f.candidate, f.target, f.backup, verify),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.target, 'whisper.node'), 'utf8')).toBe('old')
    expect(verify).not.toHaveBeenCalled()
  })

  it('removes a failed first-install payload from the active path for retry', async () => {
    const f = await promotionFixture({ previous: false })
    await expect(
      promoteWhisperDirectory(f.candidate, f.target, f.backup, async () => {
        throw new Error('native load failed')
      }),
    ).rejects.toThrow('native load failed')
    await expect(readdir(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.candidate, 'whisper.node'), 'utf8')).toBe('new')
  })
})
