// Packs a payload directory ( win-unpacked , linux-unpacked , LokLM.app )
// into a single .tar.zst on disk and writes a sidecar .sha256 of the
// compressed bytes. Designed to be called from package.json scripts and
// from vitest.
//
// Implementation note : @mongodb-js/zstd is buffer-oriented , not streaming.
// For ~1.2 GB payloads the peak RAM is acceptable on a build box ; if it
// ever becomes a problem , swap to the `zstd` system cli via execFile and
// pipe stdin -> stdout.

import { readdir, lstat, readlink, realpath, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, dirname, isAbsolute, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar-stream'
import * as zstd from '@mongodb-js/zstd'
import { signWindows } from './sign-windows.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// electron-builder writes payloads per-(platform,arch) :
//   --win dir   → release/win-unpacked
//   --linux dir → release/linux-unpacked
//   --mac dir   → release/mac-arm64 + release/mac-x64 ( one folder per arch
//                  when build.mac.target.arch = ["arm64", "x64"] ; a "universal"
//                  arch would produce release/mac/ instead , but we want
//                  separate archives so users on each arch only download
//                  what they can actually run ).
const PLATFORM_DEFAULTS = {
  'win-x64': { sourceDir: 'release/win-unpacked', tarRoot: 'win-unpacked' },
  'linux-x64': { sourceDir: 'release/linux-unpacked', tarRoot: 'linux-unpacked' },
  'mac-arm64': { sourceDir: 'release/mac-arm64/LokLM.app', tarRoot: 'LokLM.app' },
  'mac-x64': { sourceDir: 'release/mac-x64/LokLM.app', tarRoot: 'LokLM.app' },
}

export function portableArchivePath(value, platform = process.platform) {
  // Backslashes on POSIX are literal filename characters, not separators.
  // Match the installer's portable extraction policy without renaming files.
  if (value.includes(':') || (platform !== 'win32' && value.includes('\\'))) {
    throw new Error('Nonportable payload path')
  }
  return platform === 'win32' ? value.replace(/\\/g, '/') : value
}

async function walk(dir, baseDir, entries = []) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    const st = await lstat(full)
    const rel = portableArchivePath(relative(baseDir, full))
    if (st.isSymbolicLink()) {
      const linkname = portableArchivePath(await readlink(full))
      // Electron frameworks rely on relative internal links. Following them
      // changes a signed bundle and duplicates its contents. Reject absolute,
      // escaping, dangling and cyclic links instead of copying outside data.
      if (isAbsolute(linkname) || win32.isAbsolute(linkname))
        throw new Error(`Absolute payload link: ${rel}`)
      const target = relative(baseDir, await realpath(full))
      const lexical = relative(baseDir, resolve(dirname(full), linkname))
      for (const path of [target, lexical]) {
        if (
          path === '..' ||
          path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(path)
        ) {
          throw new Error(`Payload link escapes source: ${rel}`)
        }
      }
      entries.push({
        full,
        rel,
        size: 0,
        mtime: st.mtime,
        mode: st.mode,
        type: 'symlink',
        linkname,
      })
    } else if (st.isDirectory()) {
      entries.push({ full, rel, size: 0, mtime: st.mtime, mode: st.mode, type: 'directory' })
      await walk(full, baseDir, entries)
    } else if (st.isFile()) {
      entries.push({ full, rel, size: st.size, mtime: st.mtime, mode: st.mode, type: 'file' })
    } else {
      throw new Error(`Unsupported payload entry: ${rel}`)
    }
  }
  return entries
}

export async function buildPayloadArchive({ sourceDir, tarRoot, outFile }) {
  if (!/^[A-Za-z0-9_.-]+$/.test(tarRoot) || tarRoot === '.' || tarRoot === '..') {
    throw new Error('Invalid payload archive root')
  }
  const src = await realpath(resolve(sourceDir))
  const out = resolve(outFile)
  const entries = await walk(src, src)
  entries.sort((a, b) => a.rel.localeCompare(b.rel))

  const pack = tar.pack()
  const chunks = []
  pack.on('data', (c) => chunks.push(c))
  const done = new Promise((res, rej) => {
    pack.on('end', res).on('error', rej)
  })

  for (const e of entries) {
    const buf = e.type === 'file' ? await readFile(e.full) : undefined
    const name = `${tarRoot}/${e.rel}`
    pack.entry(
      {
        name,
        size: e.size,
        mode: e.mode & 0o777,
        mtime: e.mtime,
        type: e.type,
        linkname: e.linkname,
      },
      buf,
    )
  }
  pack.finalize()
  await done

  const tarBuf = Buffer.concat(chunks)
  const compressed = await zstd.compress(tarBuf, 19)
  await writeFile(out, compressed)

  const sha = createHash('sha256').update(compressed).digest('hex')
  await writeFile(`${out}.sha256`, `${sha}\n`)

  return { outFile: out, sha256: sha, sizeBytes: compressed.length, entryCount: entries.length }
}

async function main() {
  const [, , platform] = process.argv
  if (!platform || !PLATFORM_DEFAULTS[platform]) {
    console.error(
      `usage : build-payload-archive.mjs <${Object.keys(PLATFORM_DEFAULTS).join(' | ')}>`,
    )
    process.exit(2)
  }
  const cfg = PLATFORM_DEFAULTS[platform]
  const ROOT = join(__dirname, '..')

  // Sign the app launcher before it's packed into the Bunny payload, so the
  // exe users actually run is signed. No-op unless LOKLM_SIGN=1.
  if (platform === 'win-x64') {
    await signWindows([join(ROOT, cfg.sourceDir, 'LokLM.exe')], { label: 'app exe' })
  }

  const result = await buildPayloadArchive({
    sourceDir: join(ROOT, cfg.sourceDir),
    tarRoot: cfg.tarRoot,
    outFile: join(ROOT, 'release', `payload-${platform}.tar.zst`),
  })
  console.log(
    `payload-${platform}.tar.zst : ${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB , ` +
      `${result.entryCount} files , sha256 ${result.sha256.slice(0, 12)}…`,
  )
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invoked) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exit(1)
  })
}
