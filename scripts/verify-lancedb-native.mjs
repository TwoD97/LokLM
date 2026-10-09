// Exercise the native SDK with synthetic local vectors, never a user vault or model.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  nativeLoadEnvironment,
  parseMacDependencies,
  parseMacRpaths,
} from './verify-whisper-native.mjs'

const require = createRequire(import.meta.url)
const VERSION = '0.30.0'

function within(root, path) {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function canonicalDestination(path) {
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = dirname(absolute)
    if (parent === absolute) throw error
    return join(await canonicalDestination(parent), relative(parent, absolute))
  }
}

export function lancedbTarget(platform = process.platform, arch = process.arch) {
  const target = {
    'darwin/x64': 'darwin-x64',
    'darwin/arm64': 'darwin-arm64',
    'linux/x64': 'linux-x64-gnu',
    'win32/x64': 'win32-x64-msvc',
  }[`${platform}/${arch}`]
  if (!target) throw new Error('Unsupported LanceDB release platform')
  return target
}

export function lancedbLoadEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(nativeLoadEnvironment(env)).filter(
      ([key]) =>
        !key.startsWith('LD_') &&
        !key.startsWith('NAPI_RS_') &&
        !key.startsWith('LANCEDB_') &&
        !['RUST_LOG', 'RUST_BACKTRACE'].includes(key),
    ),
  )
}

async function packageIdentity(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (pkg.name !== '@lancedb/lancedb' || pkg.version !== VERSION || pkg.main !== 'dist/index.js')
    throw new Error('Unexpected LanceDB package identity')
  return pkg
}

async function resolveDependencyRoot(from, name) {
  const resolver = createRequire(join(from, 'package.json'))
  let entry
  try {
    entry = resolver.resolve(`${name}/package.json`)
  } catch {
    entry = resolver.resolve(name)
  }
  let directory = dirname(await realpath(entry))
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      if (pkg.name === name) return directory
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Cannot resolve dependency package: ${name}`)
    directory = parent
  }
}

// Copy real package bytes, not pnpm symlinks back into the original build tree.
// The builder also uses this before inserting its staged Intel native binary.
export async function copyLancedbForRelocation(sourceRoot, targetRoot, { nativeBinary } = {}) {
  const source = await realpath(sourceRoot)
  // Resolve the existing ancestor too: Windows short names and parent
  // directory symlinks must not disguise a destination inside the source.
  const target = await canonicalDestination(targetRoot)
  if (within(source, target) || within(target, source))
    throw new Error('Relocation overlaps source')
  const pkg = await packageIdentity(source)
  await mkdir(target, { recursive: true })
  await cp(join(source, 'package.json'), join(target, 'package.json'))
  await cp(join(source, 'dist'), join(target, 'dist'), { recursive: true, dereference: true })
  let packageCount = 0
  async function copyDependency(from, name, parentTarget, ancestors = new Set()) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
      throw new Error('Invalid relocation dependency name')
    const dependency = await resolveDependencyRoot(from, name)
    if (ancestors.has(dependency)) throw new Error('Cyclic relocation dependency')
    if (++packageCount > 128) throw new Error('Relocation dependency limit exceeded')
    const destination = join(parentTarget, 'node_modules', name)
    await cp(dependency, destination, {
      recursive: true,
      dereference: true,
      filter: (path) => relative(dependency, path).split(sep)[0] !== 'node_modules',
    })
    const metadata = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'))
    const nextAncestors = new Set([...ancestors, dependency])
    for (const child of Object.keys(metadata.dependencies ?? {}).sort())
      await copyDependency(dependency, child, destination, nextAncestors)
  }
  const dependencies = new Set([...Object.keys(pkg.dependencies ?? {}), 'apache-arrow'])
  for (const name of [...dependencies].sort()) await copyDependency(source, name, target)
  if (nativeBinary) {
    await cp(nativeBinary, join(target, 'dist', `lancedb.${lancedbTarget()}.node`))
  }
  return target
}

export async function verifyIntelLancedbMetadata(binary, { run = execFileSync } = {}) {
  if (!(await lstat(binary)).isFile())
    throw new Error('Intel LanceDB binding is not a regular file')
  const architectures = run('lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/)
  if (!architectures.includes('x86_64')) throw new Error('Intel LanceDB binding lacks x86_64')
  const listed = parseMacDependencies(run('otool', ['-L', binary], { encoding: 'utf8' }))
  const commands = run('otool', ['-l', binary], { encoding: 'utf8' })
  const dependencies = []
  const identities = []
  const loadKinds = new Set([
    'LC_LOAD_DYLIB',
    'LC_LOAD_WEAK_DYLIB',
    'LC_REEXPORT_DYLIB',
    'LC_LOAD_UPWARD_DYLIB',
  ])
  for (const block of commands.split(/^Load command \d+\s*$/m).slice(1)) {
    const kind = block.match(/^\s*cmd (LC_\w+)\s*$/m)?.[1]
    if (!kind?.endsWith('DYLIB')) continue
    const name = block.match(/^\s*name (.+) \(offset \d+\)\s*$/m)?.[1]
    if (!name || (!loadKinds.has(kind) && kind !== 'LC_ID_DYLIB'))
      throw new Error('Unsupported LanceDB dylib load metadata')
    if (kind === 'LC_ID_DYLIB') identities.push(name)
    else dependencies.push(name)
  }
  // Cargo emits a cdylib: its own install name also appears in otool -L,
  // but LC_ID_DYLIB is not a dependency dyld needs to resolve.
  if (
    identities.length > 1 ||
    dependencies.length === 0 ||
    JSON.stringify([...listed].sort()) !== JSON.stringify([...dependencies, ...identities].sort())
  )
    throw new Error('Inconsistent LanceDB native dependency metadata')
  for (const dependency of dependencies) {
    if (
      !(dependency.startsWith('/System/Library/') || dependency.startsWith('/usr/lib/')) ||
      dependency.split('/').includes('..')
    )
      throw new Error(`Non-system LanceDB native dependency: ${dependency}`)
  }
  if (parseMacRpaths(commands).length !== 0) throw new Error('LanceDB binding contains LC_RPATH')
  const minimum =
    commands.match(/^\s*minos (\d+)\.(\d+)(?:\.(\d+))?\s*$/m) ??
    commands.match(/cmd LC_VERSION_MIN_MACOSX[\s\S]*?^\s*version (\d+)\.(\d+)(?:\.(\d+))?\s*$/m)
  if (
    !minimum ||
    Number(minimum[1]) > 12 ||
    (Number(minimum[1]) === 12 && (Number(minimum[2]) > 0 || Number(minimum[3] ?? 0) > 0))
  )
    throw new Error('LanceDB binding does not declare a compatible macOS 12 deployment floor')
  return { architectures, dependencies, minimumMacOS: minimum.slice(1).filter(Boolean).join('.') }
}

// Serialized into a fresh Node process so require caches and open connections
// cannot make the reopen probe pass without durable on-disk data.
export async function lancedbProbe(packageRoot, dataset, phase, expectedBinary) {
  const assert = require('node:assert/strict')
  const fs = require('node:fs')
  const sdk = require(packageRoot)
  const nativeFiles = Object.keys(require.cache).filter((path) => path.endsWith('.node'))
  assert.deepEqual(
    nativeFiles.map((path) => fs.realpathSync(path)),
    [fs.realpathSync(expectedBinary)],
  )
  assert.equal(typeof sdk.Index.ivfFlat, 'function')
  assert.equal(typeof sdk.Index.ivfPq, 'function')
  const connection = await sdk.connect(dataset)
  try {
    if (phase === 'write') {
      assert.deepEqual(await connection.tableNames(), [])
      const table = await connection.createTable('vectors', [
        { chunkId: 1, documentId: 10, vector: [1, 0, 0, 0] },
        { chunkId: 2, documentId: 20, vector: [0, 1, 0, 0] },
        { chunkId: 3, documentId: 10, vector: [0, 0, 1, 0] },
      ])
      assert.equal(
        (await table.schema()).fields.find((field) => field.name === 'vector').type.listSize,
        4,
      )
      await table
        .mergeInsert('chunkId')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute([
          { chunkId: 1, documentId: 10, vector: [0, 1, 0, 0] },
          { chunkId: 4, documentId: 30, vector: [1, 0, 0, 0] },
        ])
      assert.equal(await table.countRows(), 4)
      const filtered = await table
        .search([1, 0, 0, 0])
        .distanceType('cosine')
        .where('documentId IN (10)')
        .select(['chunkId', 'documentId', '_distance'])
        .limit(8)
        .toArray()
      assert.deepEqual(filtered.map((row) => Number(row.chunkId)).sort(), [1, 3])
      assert.ok(
        filtered.every((row) => Number(row.documentId) === 10 && Number.isFinite(row._distance)),
      )
      assert.ok(Math.abs(filtered.find((row) => Number(row.chunkId) === 1)._distance - 1) < 1e-5)
      await table.delete('chunkId IN (3)')
      await table.optimize({ cleanupOlderThan: new Date() })
      assert.equal(await table.countRows(), 3)
    } else if (phase === 'reopen') {
      assert.deepEqual(await connection.tableNames(), ['vectors'])
      const table = await connection.openTable('vectors')
      assert.equal(await table.countRows(), 3)
      const nearest = await table
        .search([1, 0, 0, 0])
        .distanceType('cosine')
        .select(['chunkId', 'documentId', '_distance'])
        .limit(1)
        .toArray()
      assert.equal(Number(nearest[0].chunkId), 4)
      assert.equal(Number(nearest[0].documentId), 30)
      assert.ok(Math.abs(nearest[0]._distance) < 1e-5)
      const updated = await table
        .search([1, 0, 0, 0])
        .distanceType('cosine')
        .where('chunkId IN (1)')
        .select(['chunkId', 'documentId', '_distance'])
        .limit(1)
        .toArray()
      assert.equal(updated.length, 1)
      assert.ok(Math.abs(updated[0]._distance - 1) < 1e-5)
      const removed = await table
        .search([0, 0, 1, 0])
        .distanceType('cosine')
        .where('chunkId IN (3)')
        .select(['chunkId', 'documentId', '_distance'])
        .limit(1)
        .toArray()
      assert.deepEqual(removed, [])
      await table.createIndex('vector', {
        config: sdk.Index.ivfFlat({ distanceType: 'cosine', numPartitions: 1 }),
        replace: true,
      })
      await connection.dropTable('vectors')
      const rebuilt = await connection.createTable('vectors', [
        {
          chunkId: 5,
          documentId: 40,
          vector: [1, 0, 0, 0, 0, 0, 0, 0],
        },
      ])
      assert.equal(
        (await rebuilt.schema()).fields.find((field) => field.name === 'vector').type.listSize,
        8,
      )
      assert.equal(await rebuilt.countRows(), 1)
    } else throw new Error('Unknown native probe phase')
  } finally {
    connection.close()
  }
  console.log(JSON.stringify({ kind: 'lancedb-native-probe', phase, ok: true }))
}

async function selectedBinding(root, target) {
  const local = join(root, 'dist', `lancedb.${target}.node`)
  try {
    const info = await lstat(local)
    if (!info.isFile()) throw new Error('Local LanceDB native binding is not a regular file')
    const resolved = await realpath(local)
    if (!within(root, resolved)) throw new Error('Local LanceDB native binding escapes package')
    return resolved
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (target === 'darwin-x64') throw new Error('Locally built Intel LanceDB binding is missing')
  }
  const name = `@lancedb/lancedb-${target}`
  const dependency = await resolveDependencyRoot(root, name)
  const pkg = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'))
  if (pkg.version !== VERSION) throw new Error('LanceDB native package version mismatch')
  const binary = await realpath(createRequire(join(root, 'package.json')).resolve(name))
  if (!within(dependency, binary) || !binary.endsWith('.node') || !(await lstat(binary)).isFile())
    throw new Error('Invalid LanceDB native package entry')
  return binary
}

export async function verifyLancedbNative(packageRoot, { relocate = true } = {}) {
  const target = lancedbTarget()
  const root = await realpath(packageRoot)
  await packageIdentity(root)
  const binary = await selectedBinding(root, target)
  if (target === 'darwin-x64') await verifyIntelLancedbMetadata(binary)
  const scratch = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'loklm-lancedb-probe-'))
  try {
    for (const phase of ['write', 'reopen']) {
      const output = execFileSync(
        process.execPath,
        [
          '-e',
          `(${lancedbProbe.toString()})(...process.argv.slice(1)).catch(error => { console.error(error); process.exitCode = 1 })`,
          root,
          join(scratch, 'dataset'),
          phase,
          binary,
        ],
        {
          cwd: scratch,
          env: lancedbLoadEnvironment(),
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 1_048_576,
        },
      )
      const receipt = JSON.parse(output.trim().split(/\r?\n/).at(-1))
      if (receipt.kind !== 'lancedb-native-probe' || receipt.phase !== phase || receipt.ok !== true)
        throw new Error('Native LanceDB probe did not complete')
    }
    if (relocate) {
      const relocated = join(scratch, 'relocated-sdk')
      await copyLancedbForRelocation(root, relocated, { nativeBinary: binary })
      await verifyLancedbNative(relocated, { relocate: false })
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  console.log(`Verified native LanceDB ${VERSION} on ${target}; relocated=${relocate}`)
  return { version: VERSION, target, relocated: relocate }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--package-root')) {
    console.error('Usage: node scripts/verify-lancedb-native.mjs [--package-root <directory>]')
    process.exitCode = 1
  } else {
    const root = args[1] || dirname(dirname(require.resolve('@lancedb/lancedb')))
    verifyLancedbNative(root).catch((error) => {
      console.error(error.stack || error.message)
      process.exitCode = 1
    })
  }
}
