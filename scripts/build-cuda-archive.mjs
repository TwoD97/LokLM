// Packs the @node-llama-cpp/<plat>-cuda + <plat>-cuda-ext binaries into
// a .tar.zst whose entry layout mirrors what build-payload-archive would
// have produced if the build hadn't stripped CUDA. Loaded by the wizard
// on top of a stripped base payload to reconstruct a CUDA-augmented
// install tree.
//
// Load-bearing invariant ( verified in vitest ) :
//   stripped-payload + extracted-cuda-archive = unstripped-payload
// bit-for-bit ( file paths and contents ; mtimes are not compared ).

import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar-stream'
import * as zstd from '@mongodb-js/zstd'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PLATFORM_VARIANTS = {
  'win-x64': ['win-x64-cuda', 'win-x64-cuda-ext'],
  'linux-x64': ['linux-x64-cuda', 'linux-x64-cuda-ext'],
}

async function walk(dir, base, entries = []) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    const st = await stat(full)
    if (st.isDirectory()) await walk(full, base, entries)
    else if (st.isFile()) {
      entries.push({
        full,
        rel: relative(base, full).replace(/\\/g, '/'),
        size: st.size,
        mtime: st.mtime,
      })
    }
  }
  return entries
}

export async function buildCudaArchive({ platform, cudaSourceRoot, payloadRoot, outFile }) {
  const variants = PLATFORM_VARIANTS[platform]
  if (!variants)
    throw new Error(`no cuda build target on ${platform.startsWith('mac') ? 'mac' : platform}`)

  const pack = tar.pack()
  const chunks = []
  pack.on('data', (c) => chunks.push(c))
  const done = new Promise((res, rej) => pack.on('end', res).on('error', rej))

  const allEntries = []
  for (const variant of variants) {
    const src = resolve(cudaSourceRoot, variant)
    const variantEntries = await walk(src, src)
    for (const e of variantEntries) {
      allEntries.push({ ...e, tarPath: `${payloadRoot}/${variant}/${e.rel}` })
    }
  }
  allEntries.sort((a, b) => a.tarPath.localeCompare(b.tarPath))

  for (const e of allEntries) {
    const buf = await readFile(e.full)
    pack.entry(
      { name: e.tarPath, size: e.size, mode: 0o644, mtime: e.mtime, type: 'file' },
      buf,
    )
  }
  pack.finalize()
  await done

  const tarBuf = Buffer.concat(chunks)
  const compressed = await zstd.compress(tarBuf, 19)
  await writeFile(outFile, compressed)
  const sha = createHash('sha256').update(compressed).digest('hex')
  await writeFile(`${outFile}.sha256`, `${sha}\n`)
  return { outFile, sha256: sha, sizeBytes: compressed.length, entryCount: allEntries.length }
}

async function main() {
  const [, , platform] = process.argv
  if (!platform) {
    console.error('usage : build-cuda-archive.mjs <win-x64 | linux-x64>')
    process.exit(2)
  }
  const ROOT = join(__dirname, '..')
  // pnpm does NOT hoist these optional-binary packages into node_modules/@node-llama-cpp/
  // because the main `node-llama-cpp` entry only soft-requires them. They live
  // under .pnpm/@node-llama-cpp+<variant>@<ver>/node_modules/@node-llama-cpp/<variant>/.
  // We materialize a temporary @node-llama-cpp/ root with the two variant dirs
  // present so buildCudaArchive's walk() can use a single sourceRoot.
  const variants = PLATFORM_VARIANTS[platform]
  if (!variants) {
    console.error(`unsupported platform : ${platform}`)
    process.exit(2)
  }
  const pnpmRoot = join(ROOT, 'node_modules', '.pnpm')
  const variantPaths = {}
  for (const variant of variants) {
    const entries = await readdir(pnpmRoot)
    const match = entries.find((e) => e.startsWith(`@node-llama-cpp+${variant}@`))
    if (!match) throw new Error(`@node-llama-cpp/${variant} not installed under .pnpm/`)
    variantPaths[variant] = join(pnpmRoot, match, 'node_modules', '@node-llama-cpp', variant)
  }
  // Stage : sym/hard links into a single root , so the existing walk() works.
  const { mkdtemp, symlink } = await import('node:fs/promises')
  const stage = await mkdtemp(join(ROOT, 'release', '.cuda-stage-'))
  try {
    for (const [variant, src] of Object.entries(variantPaths)) {
      await symlink(src, join(stage, variant), 'junction')
    }
    const cudaSrc = stage

    const platformUnpackedDir = platform === 'win-x64' ? 'win-unpacked' : 'linux-unpacked'
    const payloadRoot = `${platformUnpackedDir}/resources/app.asar.unpacked/node_modules/@node-llama-cpp`

    const result = await buildCudaArchive({
      platform,
      cudaSourceRoot: cudaSrc,
      payloadRoot,
      outFile: join(ROOT, 'release', `cuda-${platform}.tar.zst`),
    })
    console.log(
      `cuda-${platform}.tar.zst : ${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB , ` +
        `${result.entryCount} files , sha256 ${result.sha256.slice(0, 12)}…`,
    )
  } finally {
    const { rm } = await import('node:fs/promises')
    await rm(stage, { recursive: true, force: true })
  }
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invoked) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exit(1)
  })
}
