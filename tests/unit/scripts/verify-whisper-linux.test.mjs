import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertLinuxX64Elf,
  copyWhisperLinuxForRelocation,
  isSystemLinuxLibraryPath,
  linuxLoadEnvironment,
  parseLinuxNeeded,
  parseLinuxResolvedLibraries,
  verifyLinuxAbiVersions,
  verifyLinuxPackageLoad,
  verifyLinuxResolvedLibraries,
  verifyNoBundledSharedLibraries,
} from '../../../scripts/verify-whisper-linux.mjs'

const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'loklm-linux-validator-'))
  dirs.push(root)
  return root
}
function elf() {
  const bytes = Buffer.alloc(64)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  bytes.writeUInt16LE(3, 16)
  bytes.writeUInt16LE(62, 18)
  bytes.writeUInt32LE(1, 20)
  return bytes
}
const dynamic = (names = ['libvulkan.so.1', 'libstdc++.so.6', 'libc.so.6']) =>
  `Dynamic section at offset 0x120 contains 24 entries:\n${names.map((name) => `0x0000000000000001 (NEEDED) Shared library: [${name}]`).join('\n')}`
const versions = (names = ['GLIBC_2.35', 'GLIBCXX_3.4.30', 'CXXABI_1.3.13', 'GCC_3.0']) =>
  `Version needs section '.gnu.version_r' contains 4 entries:\n${names.map((name) => `0x00010: Name: ${name} Flags: none Version: 2`).join('\n')}`
const resolved = `linux-vdso.so.1 (0x00007ffc00)
libvulkan.so.1 => /lib/x86_64-linux-gnu/libvulkan.so.1 (0x00007ab100)
libstdc++.so.6 => /lib/x86_64-linux-gnu/libstdc++.so.6 (0x00007ab200)
libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007ab300)
/lib64/ld-linux-x86-64.so.2 (0x00007ab400)
`

describe('Linux x64 native metadata', () => {
  it('accepts the actual shared ELF64 x64 header shape', () => {
    expect(() => assertLinuxX64Elf(elf())).not.toThrow()
  })
  it.each([
    [0, 0],
    [4, 1],
    [5, 2],
    [6, 0],
    [16, 2],
    [18, 183],
    [20, 0],
  ])('rejects wrong ELF marker/type/architecture at byte %s', (offset, value) => {
    const bytes = elf()
    bytes[offset] = value
    expect(() => assertLinuxX64Elf(bytes)).toThrow('ELF64')
  })
  it('rejects a truncated native header', () => {
    expect(() => assertLinuxX64Elf(elf().subarray(0, 63))).toThrow('ELF64')
  })
  it('admits static internal libraries plus system Vulkan/runtime dependencies', () => {
    expect(parseLinuxNeeded(dynamic())).toEqual(['libvulkan.so.1', 'libstdc++.so.6', 'libc.so.6'])
  })
  it.each([
    'libggml.so',
    'libwhisper.so.1',
    '/tmp/libvulkan.so.1',
    'libgomp.so.1',
    'libOpenBLAS.so',
  ])('rejects external/internal runtime dependency %s', (name) => {
    expect(() => parseLinuxNeeded(dynamic(['libvulkan.so.1', name]))).toThrow('dependency')
  })
  it.each(['RPATH', 'RUNPATH', 'FILTER', 'AUXILIARY'])(
    'rejects ELF loader override %s even if origin-relative',
    (tag) => {
      expect(() =>
        parseLinuxNeeded(`${dynamic()}\n0x00 (${tag}) Library runpath: [$ORIGIN]`),
      ).toThrow('search path')
    },
  )
  it('requires Vulkan and well-formed dynamic metadata', () => {
    expect(() => parseLinuxNeeded(dynamic(['libc.so.6']))).toThrow('Vulkan')
    expect(() => parseLinuxNeeded('')).toThrow('dynamic section')
    expect(() => parseLinuxNeeded(`${dynamic()}\n0x00 (NEEDED) invalid`)).toThrow('malformed')
  })
  it('accepts the Ubuntu22 ABI ceilings and older numeric versions', () => {
    expect(verifyLinuxAbiVersions(versions())).toContain('GLIBC_2.35')
    expect(verifyLinuxAbiVersions(versions(['GLIBC_2.2.5', 'GLIBCXX_3.4.9']))).toHaveLength(2)
  })
  it.each([
    'GLIBC_2.38',
    'GLIBCXX_3.4.32',
    'CXXABI_1.3.14',
    'GCC_13.0',
    'GLIBC_PRIVATE',
    'GLIBC_ABI_DT_RELR',
  ])('rejects unavailable or private runtime ABI %s', (name) => {
    expect(() => verifyLinuxAbiVersions(versions([name]))).toThrow('Ubuntu 22.04')
  })
  it('reads needed versions only, and refuses absent requirements', () => {
    expect(
      verifyLinuxAbiVersions(
        `${versions(['GLIBC_2.35'])}\nVersion definition section '.gnu.version_d' contains 1 entry:\nName: GLIBC_99.0`,
      ),
    ).toEqual(['GLIBC_2.35'])
    expect(() => verifyLinuxAbiVersions('No version information found.')).toThrow('Missing')
    expect(() => verifyLinuxAbiVersions(versions([]))).toThrow('Empty')
  })

  it('admits newer numeric host ABIs only through an explicit non-release policy', () => {
    const hostRequirements = versions(['GLIBC_2.38', 'GLIBCXX_3.4.32', 'CXXABI_1.3.14', 'GCC_13.0'])
    expect(() => verifyLinuxAbiVersions(hostRequirements)).toThrow('Ubuntu 22.04')
    expect(() => verifyLinuxAbiVersions(hostRequirements, { requireUbuntu2204: true })).toThrow(
      'Ubuntu 22.04',
    )
    expect(verifyLinuxAbiVersions(hostRequirements, { requireUbuntu2204: false })).toEqual([
      'GLIBC_2.38',
      'GLIBCXX_3.4.32',
      'CXXABI_1.3.14',
      'GCC_13.0',
    ])
  })

  it.each(['GLIBC_PRIVATE', 'GLIBC_ABI_DT_RELR', 'GLIBC_bad', 'UNKNOWN_2.0'])(
    'still rejects unrecognized ABI %s in local-host mode',
    (name) => {
      expect(() => verifyLinuxAbiVersions(versions([name]), { requireUbuntu2204: false })).toThrow()
    },
  )

  it('does not let malformed options accidentally disable release ABI validation', () => {
    for (const requireUbuntu2204 of [null, 0, '', 'false', undefined]) {
      const check = () => verifyLinuxAbiVersions(versions(['GLIBC_2.38']), { requireUbuntu2204 })
      expect(check).toThrow()
    }
    expect(() => verifyLinuxAbiVersions('', { requireUbuntu2204: false })).toThrow('Missing')
    expect(() => verifyLinuxAbiVersions(versions([]), { requireUbuntu2204: false })).toThrow(
      'Empty',
    )
  })
})

describe('real system resolution admission', () => {
  const validFiles = {
    resolvePath: async (path) => path.replace(/^\/lib\//, '/usr/lib/'),
    stat: async () => ({ isFile: () => true }),
  }
  it('requires all direct dependencies and all resolved targets to be system files', async () => {
    const libraries = await verifyLinuxResolvedLibraries(
      resolved,
      parseLinuxNeeded(dynamic()),
      validFiles,
    )
    expect(libraries).toHaveLength(4)
  })
  it.each([
    'libwhisper.so.1 => not found',
    'libc.so.6 => /tmp/libc.so.6 (0x0123)',
    'libevil.so.1 => /lib/libevil.so.1 (0x0123)',
  ])('rejects missing/non-system resolution %s', async (line) => {
    await expect(
      verifyLinuxResolvedLibraries(`${resolved}${line}`, [], validFiles),
    ).rejects.toThrow()
  })
  it('rejects a system-looking symlink whose actual target escapes', async () => {
    await expect(
      verifyLinuxResolvedLibraries(resolved, [], {
        ...validFiles,
        resolvePath: async () => '/tmp/override.so',
      }),
    ).rejects.toThrow('not a system file')
  })
  it('rejects a missing needed entry and non-file result', async () => {
    await expect(verifyLinuxResolvedLibraries(resolved, ['libm.so.6'], validFiles)).rejects.toThrow(
      'not resolved',
    )
    await expect(
      verifyLinuxResolvedLibraries(resolved, [], {
        ...validFiles,
        stat: async () => ({ isFile: () => false }),
      }),
    ).rejects.toThrow('not a system file')
  })
  it.each(['/usr/local/lib/foo.so', '/lib/../tmp/foo.so', '/usr/lib64evil/foo.so', 'lib/foo.so'])(
    'does not admit misleading system prefix %s',
    (path) => {
      expect(isSystemLinuxLibraryPath(path)).toBe(false)
    },
  )
  it('fails for ldd error text or an empty result', () => {
    expect(() => parseLinuxResolvedLibraries('not a dynamic executable')).toThrow()
    expect(() => parseLinuxResolvedLibraries('')).toThrow()
  })
})

describe('isolated package load and relocation', () => {
  it('strips Linux/Mac/Node loader injection without modifying the original environment', () => {
    const env = {
      PATH: '/bin',
      LD_LIBRARY_PATH: '/tmp',
      LD_PRELOAD: 'bad',
      LD_AUDIT: 'audit',
      GLIBC_TUNABLES: 'override',
      DYLD_LIBRARY_PATH: '/tmp',
      NODE_PATH: '/tmp',
      NODE_OPTIONS: '--require=evil',
      LANG: 'de_DE',
    }
    expect(linuxLoadEnvironment(env)).toEqual({ PATH: '/bin', LC_ALL: 'C', LANG: 'C' })
    expect(env.LD_PRELOAD).toBe('bad')
  })
  it('loads the exact package and propagates subprocess rejection', () => {
    const execute = vi.fn(() => {
      throw new Error('glibc version not found')
    })
    expect(() => verifyLinuxPackageLoad('/tmp/package', { execute })).toThrow(
      'glibc version not found',
    )
    expect(execute.mock.calls[0][1][2]).toBe('/tmp/package')
    expect(execute.mock.calls[0][1][1]).toContain("typeof addon.transcribe !== 'function'")
    expect(execute.mock.calls[0][2]).toEqual({ cwd: '/tmp/package', capture: false })
  })
  it('retains the package shape with only the active Linux runtime, independent of the source', async () => {
    const root = await temp()
    const source = join(root, 'source')
    const destination = join(root, 'relocated')
    await mkdir(join(source, 'dist', 'js'), { recursive: true })
    await writeFile(join(source, 'package.json'), '{"name":"@kutalia/whisper-node-addon"}')
    await writeFile(join(source, 'dist', 'js', 'index.js'), 'entry')
    for (const platform of ['linux-x64', 'mac-x64', 'win32-x64']) {
      await mkdir(join(source, 'dist', platform))
      await writeFile(join(source, 'dist', platform, 'whisper.node'), elf())
    }
    await copyWhisperLinuxForRelocation(source, destination)
    await rm(source, { recursive: true })
    expect((await readdir(join(destination, 'dist'))).sort()).toEqual(['js', 'linux-x64'])
    expect(await readFile(join(destination, 'dist', 'js', 'index.js'), 'utf8')).toBe('entry')
    const relocatedBinary = await readFile(join(destination, 'dist', 'linux-x64', 'whisper.node'))
    expect(relocatedBinary).toEqual(elf())
    expect(() => assertLinuxX64Elf(relocatedBinary)).not.toThrow()
  })
  it('rejects shared-library residue and nested bindings from a previous build', async () => {
    const root = await temp()
    await writeFile(join(root, 'whisper.node'), elf())
    await mkdir(join(root, 'licenses'))
    await writeFile(join(root, 'licenses', 'LICENSE'), 'license')
    await expect(verifyNoBundledSharedLibraries(root)).resolves.toBeUndefined()
    await writeFile(join(root, 'libggml.so.1'), 'old binary')
    await expect(verifyNoBundledSharedLibraries(root)).rejects.toThrow('bundled native')
    await rm(join(root, 'libggml.so.1'))
    await mkdir(join(root, 'nested', 'linux-x64'), { recursive: true })
    await writeFile(join(root, 'nested', 'linux-x64', 'whisper.node'), elf())
    await expect(verifyNoBundledSharedLibraries(root)).rejects.toThrow('bundled native')
  })
})
