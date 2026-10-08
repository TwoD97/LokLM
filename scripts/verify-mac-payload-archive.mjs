// Verify the delivered bundle after the exact compression/archive round trip.
// Source-bundle codesign alone cannot detect symlink loss during archiving.
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as zstd from '@mongodb-js/zstd'
import { verifyMacApp } from './verify-mac-architecture.mjs'

const arch = process.argv[2]
if (process.platform !== 'darwin' || arch !== process.arch)
  throw new Error('Verify on the native target Mac runner')
const scratch = await mkdtemp(join(tmpdir(), 'loklm-delivered-mac-'))
try {
  const archive = await readFile(`release/payload-mac-${arch}.tar.zst`)
  const tar = join(scratch, 'payload.tar')
  await writeFile(tar, await zstd.decompress(archive))
  execFileSync('tar', ['-xf', tar, '-C', scratch], { stdio: 'inherit' })
  const app = join(scratch, 'LokLM.app')
  await verifyMacApp(app, arch)
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`Delivered Mac ${arch} bundle signature and native architecture verified`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
