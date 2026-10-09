import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  copyWhisperForRelocation,
  nativeLoadEnvironment,
  parseMacDependencies,
  parseMacRpaths,
  verifyWhisperBinaryMetadata,
  verifyWhisperPackageLoad,
} from '../../../scripts/verify-whisper-native.mjs'

const temporary = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'loklm-whisper-test-'))
  temporary.push(dir)
  const binary = join(dir, 'whisper.node')
  await writeFile(binary, 'fixture')
  return { dir, binary }
}
function metadata({
  arch = 'arm64',
  dependencies = ['/usr/lib/libSystem.B.dylib'],
  rpaths = [],
} = {}) {
  return vi.fn((command, args) => {
    if (command === 'lipo') return `${arch}\n`
    if (command === 'otool' && args[0] === '-L')
      return `${args[1]}:\n${dependencies.map((path) => `\t${path} (compatibility version 1.0.0, current version 1.0.0)`).join('\n')}\n`
    if (command === 'otool' && args[0] === '-l')
      return rpaths
        .map(
          (path, i) => `Load command ${i}\n cmd LC_RPATH\n cmdsize 48\n path ${path} (offset 12)`,
        )
        .join('\n')
    throw new Error(`Unexpected command ${command}`)
  })
}

describe('Mac transcription binary validation', () => {
  it.each([
    ['arm64', 'arm64'],
    ['x64', 'x86_64'],
  ])('accepts native static Apple-only %s binding', async (arch, lipo) => {
    const { dir, binary } = await fixture()
    const run = metadata({
      arch: lipo,
      dependencies: [
        '/usr/lib/libSystem.B.dylib',
        '/System/Library/Frameworks/Metal.framework/Versions/A/Metal',
      ],
    })
    await expect(verifyWhisperBinaryMetadata(binary, dir, arch, { run })).resolves.toMatchObject({
      architectures: [lipo],
    })
    expect(run).toHaveBeenCalledWith('lipo', ['-archs', await realpath(binary)], expect.any(Object))
  })

  it('rejects the upstream ARM binary falsely placed in the Intel directory', async () => {
    const { dir, binary } = await fixture()
    await expect(
      verifyWhisperBinaryMetadata(binary, dir, 'x64', { run: metadata() }),
    ).rejects.toThrow('x86_64')
  })

  it('rejects unresolved upstream rpath even when its library is adjacent', async () => {
    const { dir, binary } = await fixture()
    await writeFile(join(dir, 'libwhisper.1.dylib'), 'fixture')
    const run = metadata({
      dependencies: ['@rpath/libwhisper.1.dylib'],
      rpaths: ['/Users/runner/work/whisper/deps/build/Release'],
    })
    await expect(verifyWhisperBinaryMetadata(binary, dir, 'arm64', { run })).rejects.toThrow(
      'Nonportable native search path',
    )
  })

  it.each(['@loader_path/libwhisper.1.dylib', '@rpath/libwhisper.1.dylib'])(
    'checks packaged loader-relative dependency %s',
    async (dependency) => {
      const { dir, binary } = await fixture()
      await writeFile(join(dir, 'libwhisper.1.dylib'), 'fixture')
      const run = metadata({ dependencies: [dependency], rpaths: ['@loader_path'] })
      await expect(
        verifyWhisperBinaryMetadata(binary, dir, 'arm64', { run }),
      ).resolves.toBeDefined()
      await rm(join(dir, 'libwhisper.1.dylib'))
      await expect(verifyWhisperBinaryMetadata(binary, dir, 'arm64', { run })).rejects.toThrow(
        'not packaged',
      )
    },
  )

  it.each([
    '/opt/homebrew/lib/libomp.dylib',
    '/usr/local/lib/libwhisper.dylib',
    '@executable_path/libwhisper.dylib',
    '/System/Library/../../outside.dylib',
    '@loader_path/../outside.dylib',
    '@rpath/../../outside.dylib',
  ])('rejects dependency outside portable package/system contract: %s', async (dependency) => {
    const { dir, binary } = await fixture()
    const run = metadata({ dependencies: [dependency], rpaths: ['@loader_path'] })
    await expect(verifyWhisperBinaryMetadata(binary, dir, 'arm64', { run })).rejects.toThrow()
  })

  it('does not let an inherited rpath supply an absent per-binary search path', async () => {
    const { dir, binary } = await fixture()
    await writeFile(join(dir, 'libwhisper.1.dylib'), 'fixture')
    const run = metadata({ dependencies: ['@rpath/libwhisper.1.dylib'] })
    await expect(verifyWhisperBinaryMetadata(binary, dir, 'arm64', { run })).rejects.toThrow(
      'not packaged',
    )
  })

  it('fails closed for malformed otool metadata', () => {
    expect(() => parseMacDependencies('addon:\n malformed library line')).toThrow()
    expect(() => parseMacRpaths('Load command 0\n cmd LC_RPATH\n path missing offset')).toThrow()
  })

  it('propagates failed native inspection commands', async () => {
    const { dir, binary } = await fixture()
    await expect(
      verifyWhisperBinaryMetadata(binary, dir, 'arm64', {
        run: () => {
          throw new Error('lipo failed')
        },
      }),
    ).rejects.toThrow('lipo failed')
  })
})

describe('isolated native package import', () => {
  it('removes loader/Node injections without modifying the parent environment', () => {
    const input = {
      PATH: '/bin',
      DYLD_LIBRARY_PATH: '/elsewhere',
      DYLD_INSERT_LIBRARIES: 'override',
      NODE_PATH: 'modules',
      NODE_OPTIONS: '--require=preload',
      ELECTRON_RUN_AS_NODE: '1',
      KEEP: 'yes',
    }
    expect(nativeLoadEnvironment(input)).toEqual({ PATH: '/bin', KEEP: 'yes' })
    expect(input.DYLD_LIBRARY_PATH).toBe('/elsewhere')
  })

  it('requires the exact package path in a bounded child and propagates load failure', async () => {
    const { dir } = await fixture()
    vi.stubEnv('DYLD_LIBRARY_PATH', '/not-a-real-library-path')
    const run = vi.fn(() => {
      throw new Error('native load failed')
    })
    expect(() => verifyWhisperPackageLoad(dir, { run })).toThrow('native load failed')
    const [executable, args, options] = run.mock.calls[0]
    expect(executable).toBe(process.execPath)
    expect(args[0]).toBe('-e')
    expect(args[1]).toContain("typeof addon.transcribe !== 'function'")
    expect(args[2]).toBe(dir)
    expect(options).toMatchObject({ cwd: dir, timeout: 30_000, stdio: 'inherit' })
    expect(options.env).not.toHaveProperty('DYLD_LIBRARY_PATH')
  })

  it.each(['arm64', 'x64'])(
    'relocates only the package entry and selected %s runtime',
    async (arch) => {
      const { dir } = await fixture()
      const source = join(dir, 'source')
      const target = join(dir, 'relocated')
      await mkdir(join(source, 'dist', 'js'), { recursive: true })
      await writeFile(join(source, 'package.json'), '{"name":"@kutalia/whisper-node-addon"}')
      await writeFile(join(source, 'dist', 'js', 'index.js'), 'entry')
      for (const tuple of ['mac-arm64', 'mac-x64', 'linux-x64', 'win32-x64']) {
        await mkdir(join(source, 'dist', tuple))
        await writeFile(join(source, 'dist', tuple, 'whisper.node'), tuple)
      }
      await copyWhisperForRelocation(source, target, arch)
      expect((await readdir(join(target, 'dist'))).sort()).toEqual(['js', `mac-${arch}`])
      expect(await readFile(join(target, 'dist', `mac-${arch}`, 'whisper.node'), 'utf8')).toBe(
        `mac-${arch}`,
      )
      await rm(source, { recursive: true, force: true })
      expect(await readFile(join(target, 'dist', 'js', 'index.js'), 'utf8')).toBe('entry')
    },
  )
})
