import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  LANCEDB_SOURCE,
  needsLancedbBuild,
  normalizeWorkspaceVersions,
  normalizeLancedbLock,
  lancedbBuildEnvironment,
  lancedbCargoArguments,
  checkLancedbPrerequisites,
  verifyLancedbCache,
  promoteLancedbDirectory,
  createLancedbStage,
} from '../../../scripts/build-lancedb-native.mjs'
import { copyLancedbForRelocation } from '../../../scripts/verify-lancedb-native.mjs'

const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'loklm-lancedb-build-test-'))
  dirs.push(dir)
  return dir
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const workspaceLock = [
  '[[package]]\nname = "lancedb"\nversion = "0.30.0-beta.1"\ndependencies = ["serde"]\n',
  '[[package]]\nname = "lancedb-nodejs"\nversion = "0.30.0-beta.1"\ndependencies = ["lancedb"]\n',
  '[[package]]\nname = "lancedb-python"\nversion = "0.33.0-beta.1"\ndependencies = ["lancedb"]\n',
  '[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "unchanged"\n',
].join('\n')

describe('pinned Intel LanceDB source build', () => {
  it.each([
    ['darwin', 'x64', true],
    ['darwin', 'arm64', false],
    ['linux', 'x64', false],
    ['win32', 'x64', false],
    ['darwin', 'ia32', false],
  ])('builds only the missing native tuple %s/%s', (platform, arch, expected) => {
    expect(needsLancedbBuild(platform, arch)).toBe(expected)
  })

  it('changes only the three exact workspace versions and preserves registry graph bytes', () => {
    expect(normalizeWorkspaceVersions(workspaceLock)).toBe(
      workspaceLock
        .replaceAll('version = "0.30.0-beta.1"', 'version = "0.30.0"')
        .replace('version = "0.33.0-beta.1"', 'version = "0.33.0"'),
    )
  })

  it.each([
    workspaceLock.replace('0.33.0-beta.1', '0.33.0-beta.2'),
    workspaceLock + '\n[[package]]\nname = "lancedb"\nversion = "0.30.0-beta.1"\n',
    workspaceLock.replace('name = "lancedb-nodejs"', 'name = "other"'),
  ])('rejects missing, changed or duplicate workspace entries', (lock) => {
    expect(() => normalizeWorkspaceVersions(lock)).toThrow('Unexpected workspace lock entry')
  })

  it('rejects arbitrary or altered lock bytes before doing any version repair', () => {
    expect(() => normalizeLancedbLock(Buffer.from(workspaceLock))).toThrow('source lock SHA256')
    expect(() => normalizeLancedbLock(Buffer.from(''))).toThrow('source lock SHA256')
  })

  it('uses the explicit Rust/toolchain/target and locked default features for a spaced source path', () => {
    const args = lancedbCargoArguments('/source with spaces', '/cache target')
    expect(args).toEqual([
      '+1.94.0',
      'build',
      '--locked',
      '--release',
      '--jobs',
      '2',
      '--manifest-path',
      join('/source with spaces', 'nodejs/Cargo.toml'),
      '--target',
      'x86_64-apple-darwin',
      '--target-dir',
      '/cache target',
    ])
    expect(args).not.toContain('--no-default-features')
  })

  it('rejects injected compiler/loader flags while preserving tool discovery and registry cache', () => {
    const env = lancedbBuildEnvironment({
      PATH: '/tools',
      CARGO_HOME: '/registry',
      RUSTFLAGS: '-Ctarget-cpu=native',
      CARGO_ENCODED_RUSTFLAGS: 'bad',
      RUSTC_WRAPPER: 'other',
      MACOSX_DEPLOYMENT_TARGET: '15.0',
      DYLD_LIBRARY_PATH: '/build',
      NAPI_RS_NATIVE_LIBRARY_PATH: '/other.node',
      NODE_OPTIONS: '--require other',
      GIT_CONFIG_COUNT: '5',
      CMAKE_PREFIX_PATH: '/unexpected',
    })
    expect(env).toMatchObject({
      PATH: '/tools',
      CARGO_HOME: '/registry',
      MACOSX_DEPLOYMENT_TARGET: '12.0',
      CARGO_BUILD_JOBS: '2',
      GIT_CONFIG_COUNT: '0',
    })
    for (const key of [
      'RUSTFLAGS',
      'CARGO_ENCODED_RUSTFLAGS',
      'RUSTC_WRAPPER',
      'DYLD_LIBRARY_PATH',
      'NAPI_RS_NATIVE_LIBRARY_PATH',
      'NODE_OPTIONS',
      'CMAKE_PREFIX_PATH',
    ])
      expect(env).not.toHaveProperty(key)
  })

  it('requires the exact Rust compiler and all build prerequisites before fetching', () => {
    const run = vi.fn((name) => (name === 'rustc' ? 'rustc 1.94.0 (fixed)' : `${name} version`))
    expect(checkLancedbPrerequisites(run).rustc).toBe('rustc 1.94.0 (fixed)')
    expect(run.mock.calls.map(([name]) => name)).toContain('protoc')
    expect(() => checkLancedbPrerequisites(() => 'rustc 1.95.0 (other)')).toThrow('requires Rust')
    expect(() =>
      checkLancedbPrerequisites((name) => {
        if (name === 'protoc') throw new Error('missing')
        return name === 'rustc' ? 'rustc 1.94.0 (fixed)' : name
      }),
    ).toThrow('protoc')
  })
})

async function cachedBinding() {
  const cache = await temp()
  const binary = join(cache, 'lancedb.darwin-x64.node')
  const marker = {
    schemaVersion: 1,
    inputFingerprint: 'inputs',
    target: LANCEDB_SOURCE.target,
    binarySha256: sha256('synthetic binding'),
  }
  await writeFile(binary, 'synthetic binding')
  await writeFile(join(cache, 'loklm-lancedb-build.json'), JSON.stringify(marker))
  return { cache, binary, marker }
}

describe('LanceDB build cache and rollback', () => {
  it('stages outside the source package and copies the real dependency closure without overlap', async () => {
    const root = await temp()
    const source = join(root, 'sdk')
    await mkdir(join(source, 'dist'), { recursive: true })
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({
        name: '@lancedb/lancedb',
        version: '0.30.0',
        main: 'dist/index.js',
        dependencies: { 'reflect-metadata': '1.0.0' },
      }),
    )
    await writeFile(join(source, 'dist/index.js'), 'published JavaScript')
    for (const name of ['reflect-metadata', 'apache-arrow']) {
      const dependency = join(source, 'node_modules', name)
      await mkdir(dependency, { recursive: true })
      await writeFile(
        join(dependency, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
      )
      await writeFile(join(dependency, 'index.js'), name)
    }
    const stage = await createLancedbStage(source)
    expect(dirname(stage)).toBe(dirname(source))
    const candidate = join(stage, 'package')
    await copyLancedbForRelocation(source, candidate)
    expect(await readFile(join(candidate, 'dist/index.js'), 'utf8')).toBe('published JavaScript')
    for (const name of ['reflect-metadata', 'apache-arrow'])
      expect(await readFile(join(candidate, 'node_modules', name, 'index.js'), 'utf8')).toBe(name)
    await expect(copyLancedbForRelocation(source, join(source, 'nested'))).rejects.toThrow(
      'Relocation overlaps source',
    )
  })

  it('requires real native/relocation verification even with matching marker and binary hashes', async () => {
    const { cache, binary } = await cachedBinding()
    const verify = vi.fn(async () => {})
    expect(await verifyLancedbCache(cache, 'inputs', verify)).toBe(true)
    expect(verify).toHaveBeenCalledWith(binary)
    expect(
      await verifyLancedbCache(cache, 'inputs', async () => {
        throw new Error('wrong arch')
      }),
    ).toBe(false)
  })

  it('rejects stale inputs and modified cached bytes before execution', async () => {
    const { cache, binary } = await cachedBinding()
    const verify = vi.fn()
    expect(await verifyLancedbCache(cache, 'new inputs', verify)).toBe(false)
    await writeFile(binary, 'tampered')
    expect(await verifyLancedbCache(cache, 'inputs', verify)).toBe(false)
    expect(verify).not.toHaveBeenCalled()
  })

  it.each([{ schemaVersion: 2 }, { target: 'aarch64-apple-darwin' }])(
    'rejects incompatible cache metadata',
    async (changed) => {
      const { cache, marker } = await cachedBinding()
      await writeFile(
        join(cache, 'loklm-lancedb-build.json'),
        JSON.stringify({ ...marker, ...changed }),
      )
      const verify = vi.fn()
      expect(await verifyLancedbCache(cache, 'inputs', verify)).toBe(false)
      expect(verify).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    'restores prior JS/native files when installed verification fails (previous=%s)',
    async (previous) => {
      const root = await temp()
      const candidate = join(root, 'candidate'),
        target = join(root, 'dist'),
        backup = join(root, 'backup')
      await mkdir(candidate)
      await writeFile(join(candidate, 'native.node'), 'new')
      if (previous) {
        await mkdir(target)
        await writeFile(join(target, 'native.node'), 'old')
      }
      await expect(
        promoteLancedbDirectory(candidate, target, backup, async () => {
          expect(await readFile(join(target, 'native.node'), 'utf8')).toBe('new')
          throw new Error('load failed')
        }),
      ).rejects.toThrow('load failed')
      expect(await readFile(join(candidate, 'native.node'), 'utf8')).toBe('new')
      if (previous) expect(await readFile(join(target, 'native.node'), 'utf8')).toBe('old')
      else
        await expect(readFile(join(target, 'native.node'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
    },
  )

  it('keeps the old directory until successful installed verification finishes', async () => {
    const root = await temp()
    const candidate = join(root, 'candidate'),
      target = join(root, 'dist'),
      backup = join(root, 'backup')
    await mkdir(candidate)
    await mkdir(target)
    await writeFile(join(candidate, 'native.node'), 'new')
    await writeFile(join(target, 'native.node'), 'old')
    await promoteLancedbDirectory(candidate, target, backup, async () => {
      expect(await readFile(join(backup, 'native.node'), 'utf8')).toBe('old')
    })
    expect(await readFile(join(target, 'native.node'), 'utf8')).toBe('new')
  })
})
