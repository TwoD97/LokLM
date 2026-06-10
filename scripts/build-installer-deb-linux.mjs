// Renames Tauri's deb-bundle output to the stable filename users expect
// at the public URL.
//
// Tauri's deb bundler writes to :
//   installer-wizard/src-tauri/target/release/bundle/deb/*.deb
// where the filename encodes productName + version + arch ( e.g.
// LokLM_0.3.1_amd64.deb ). Our public download URL is version-agnostic ;
// we copy the .deb to release/LokLM-Setup-linux-x64.deb so the website
// and CI uploader can reference a stable name.
//
// This script runs AFTER `package:linux:wizard` ( which on Linux invokes
// `cargo tauri build --bundles deb` and produces the .deb ).

import { readdir, mkdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const BUNDLE_DIR = join(
  ROOT,
  'installer-wizard',
  'src-tauri',
  'target',
  'release',
  'bundle',
  'deb',
)
const OUTPUT = join(ROOT, 'release', 'LokLM-Setup-linux-x64.deb')

async function findDeb() {
  if (!existsSync(BUNDLE_DIR)) {
    throw new Error(
      `tauri deb bundle dir missing : ${BUNDLE_DIR} ` +
        '( did package:linux:wizard run on Linux ? )',
    )
  }
  const entries = await readdir(BUNDLE_DIR)
  const debs = entries.filter((e) => e.endsWith('.deb'))
  if (debs.length === 0) {
    throw new Error(`no .deb found in ${BUNDLE_DIR}`)
  }
  if (debs.length > 1) {
    // Multiple debs in target/ means a stale one survived a version bump.
    // Pick the most recently modified to avoid shipping the old one.
    const withMtime = await Promise.all(
      debs.map(async (name) => {
        const full = join(BUNDLE_DIR, name)
        const s = await stat(full)
        return { full, mtime: s.mtimeMs }
      }),
    )
    withMtime.sort((a, b) => b.mtime - a.mtime)
    console.warn(
      `multiple .deb files found in ${BUNDLE_DIR} ; picking newest : ${withMtime[0].full}`,
    )
    return withMtime[0].full
  }
  return join(BUNDLE_DIR, debs[0])
}

async function main() {
  const src = await findDeb()
  await mkdir(dirname(OUTPUT), { recursive: true })
  await copyFile(src, OUTPUT)
  const size = (await stat(OUTPUT)).size
  console.log(`copied ${src}`)
  console.log(`     → ${OUTPUT} ( ${(size / 1024 / 1024).toFixed(1)} MB )`)
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
