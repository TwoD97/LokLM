// Local aggregation requires the other architecture's archive from its native
// build runner. Release CI performs these steps on two separate native runners.
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyMacArchives } from './release-artifacts.mjs'

async function main() {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Mac archives require a native Mac build runner')
  }
  execFileSync(process.execPath, ['scripts/build-payload-archive.mjs', `mac-${process.arch}`], {
    stdio: 'inherit',
  })
  try {
    await verifyMacArchives('release')
  } catch (error) {
    throw new Error(
      `Both verified native Mac archives are required; collect the other architecture archive and its SHA256 sidecar from the release workflow. ${error.message}`,
    )
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  if (!pkg.version) throw new Error('Missing package version')
  execFileSync(process.execPath, ['scripts/write-payload-manifest.mjs'], { stdio: 'inherit' })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
