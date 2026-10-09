import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  copyLancedbForRelocation,
  lancedbLoadEnvironment,
  lancedbTarget,
  verifyIntelLancedbMetadata,
} from '../../../scripts/verify-lancedb-native.mjs'

const dirs = []
async function temp() {
  const path = await mkdtemp(join(tmpdir(), 'loklm-lance-check-'))
  dirs.push(path)
  return path
}
afterEach(async () => {
  for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('native LanceDB release verification', () => {
  it.each([
    ['darwin', 'x64', 'darwin-x64'],
    ['darwin', 'arm64', 'darwin-arm64'],
    ['linux', 'x64', 'linux-x64-gnu'],
    ['win32', 'x64', 'win32-x64-msvc'],
  ])('selects %s/%s native binding', (platform, arch, expected) => {
    expect(lancedbTarget(platform, arch)).toBe(expected)
  })
  it.each([
    ['darwin', 'ia32'],
    ['linux', 'mips'],
    ['freebsd', 'x64'],
  ])('rejects unsupported %s/%s', (platform, arch) =>
    expect(() => lancedbTarget(platform, arch)).toThrow(/Unsupported/),
  )
  it('removes native injection and database logging overrides without changing the parent environment', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/fixture',
      DYLD_LIBRARY_PATH: '/build-machine',
      LD_PRELOAD: '/external.so',
      NODE_PATH: '/external',
      NODE_OPTIONS: '--require /external',
      ELECTRON_RUN_AS_NODE: '1',
      NAPI_RS_NATIVE_LIBRARY_PATH: '/wrong.node',
      NAPI_RS_FORCE_WASI: '1',
      LANCEDB_API_KEY: 'fixture-secret',
      LANCEDB_LOG: 'debug',
      RUST_LOG: 'trace',
      RUST_BACKTRACE: 'full',
    }
    expect(lancedbLoadEnvironment(env)).toEqual({ PATH: '/usr/bin', HOME: '/fixture' })
    expect(env.NAPI_RS_FORCE_WASI).toBe('1')
  })

  const dependencies = (binary, names = ['/usr/lib/libSystem.B.dylib']) =>
    `${binary}:\n${names.map((name) => `\t${name} (compatibility version 1.0.0, current version 1.0.0)`).join('\n')}\n`
  const commands =
    'Load command 1\n cmd LC_BUILD_VERSION\n cmdsize 32\n platform 1\n minos 12.0\n sdk 15.0\n' +
    'Load command 2\n cmd LC_LOAD_DYLIB\n name /usr/lib/libSystem.B.dylib (offset 24)\n'
  async function metadata({ arch = 'x86_64', links, loads = commands } = {}) {
    const binary = join(await temp(), 'lancedb.darwin-x64.node')
    await writeFile(binary, 'synthetic Mach-O inspected by mocked system tools')
    const run = vi.fn((command, args) => {
      if (command === 'lipo') return arch
      if (args[0] === '-L') return dependencies(binary, links)
      return loads
    })
    return { binary, run }
  }
  it('requires x86_64, system-only linkage, no RPATH and a compatible deployment floor', async () => {
    const { binary, run } = await metadata()
    await expect(verifyIntelLancedbMetadata(binary, { run })).resolves.toMatchObject({
      architectures: ['x86_64'],
      minimumMacOS: '12.0',
    })
  })
  it('distinguishes Cargo cdylib identity from an external dylib dependency', async () => {
    const { binary, run } = await metadata({
      links: ['@rpath/liblancedb_nodejs.dylib', '/usr/lib/libSystem.B.dylib'],
      loads:
        commands +
        'Load command 3\n cmd LC_ID_DYLIB\n name @rpath/liblancedb_nodejs.dylib (offset 24)\n',
    })
    await expect(verifyIntelLancedbMetadata(binary, { run })).resolves.toMatchObject({
      dependencies: ['/usr/lib/libSystem.B.dylib'],
    })
  })
  it.each([
    { arch: 'arm64' },
    { links: ['/usr/local/lib/liblance.dylib'] },
    { links: ['@rpath/liblance.dylib'] },
    { links: ['@loader_path/liblance.dylib'] },
    { links: ['/usr/lib/../../tmp/liblance.dylib'] },
    {
      links: ['@rpath/liblance.dylib'],
      loads: commands.replace('/usr/lib/libSystem.B.dylib', '@rpath/liblance.dylib'),
    },
    { loads: commands.replace('LC_LOAD_DYLIB', 'LC_LAZY_LOAD_DYLIB') },
    { loads: commands.replace('name /usr/lib/libSystem.B.dylib (offset 24)', 'name malformed') },
    { links: [] },
    { loads: commands + 'Load command 2\n cmd LC_RPATH\n path /build/lib (offset 12)\n' },
    { loads: commands.replace('12.0', '13.0') },
    { loads: commands.replace('12.0', '12.1') },
    { loads: commands.replace('12.0', '12.0.1') },
    { loads: commands.replace('minos 12.0', 'minos unknown') },
  ])('rejects incompatible native metadata %j', async (input) => {
    const { binary, run } = await metadata(input)
    await expect(verifyIntelLancedbMetadata(binary, { run })).rejects.toThrow()
  })

  async function fixturePackage(root, name, content, dependencies = {}) {
    await mkdir(root, { recursive: true })
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', main: 'index.js', dependencies }),
    )
    await writeFile(join(root, 'index.js'), content)
  }
  async function sdkFixture() {
    const base = await temp()
    const sdk = join(base, 'source', 'node_modules', '@lancedb', 'lancedb')
    await mkdir(join(sdk, 'dist'), { recursive: true })
    await writeFile(
      join(sdk, 'package.json'),
      JSON.stringify({
        name: '@lancedb/lancedb',
        version: '0.30.0',
        main: 'dist/index.js',
        dependencies: { 'reflect-metadata': '^0.2.2' },
      }),
    )
    await writeFile(
      join(sdk, 'dist', 'index.js'),
      "module.exports = [require('apache-arrow'), require('reflect-metadata')]\n",
    )
    const modules = join(base, 'source', 'node_modules')
    await fixturePackage(
      join(modules, 'apache-arrow'),
      'apache-arrow',
      "module.exports = require('fixture-child')",
      { 'fixture-child': '1.0.0' },
    )
    await fixturePackage(
      join(modules, 'fixture-child'),
      'fixture-child',
      "module.exports = 'relocated arrow dependency'",
    )
    await fixturePackage(
      join(modules, 'reflect-metadata'),
      'reflect-metadata',
      "module.exports = 'relocated reflection dependency'",
    )
    return { base, sdk }
  }
  it('relocates the actual JS dependency closure without source-tree resolution', async () => {
    const { base, sdk } = await sdkFixture()
    const relocated = join(base, 'relocated')
    await copyLancedbForRelocation(sdk, relocated)
    await rm(join(base, 'source'), { recursive: true, force: true })
    const loader = createRequire(join(relocated, 'package.json'))
    expect(loader(relocated)).toEqual([
      'relocated arrow dependency',
      'relocated reflection dependency',
    ])
    expect(await readFile(join(relocated, 'package.json'), 'utf8')).toContain('0.30.0')
  })
  it('rejects source overlap before copying any package bytes', async () => {
    const { sdk } = await sdkFixture()
    await expect(copyLancedbForRelocation(sdk, join(sdk, 'relocation'))).rejects.toThrow(/overlaps/)
    await expect(copyLancedbForRelocation(sdk, dirname(sdk))).rejects.toThrow(/overlaps/)
  })
  it('rejects a different SDK version instead of validating a mixed package', async () => {
    const { sdk, base } = await sdkFixture()
    const pkg = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'))
    await writeFile(join(sdk, 'package.json'), JSON.stringify({ ...pkg, version: '0.29.0' }))
    await expect(copyLancedbForRelocation(sdk, join(base, 'relocated'))).rejects.toThrow(/identity/)
  })
})
