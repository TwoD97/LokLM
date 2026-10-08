import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { verifyReleaseArtifacts } from './release-artifacts.mjs'

const previous = JSON.parse(await readFile('release/release-index.json', 'utf8'))
const index = await verifyReleaseArtifacts('release', {
  version: process.env.RELEASE_VERSION,
  baseUrl: process.env.LOKLM_PAYLOAD_BASE_URL,
  sourceSha: process.env.GITHUB_SHA,
})
if (JSON.stringify(previous) !== JSON.stringify(index)) throw new Error('Release index changed')
for (const [platform, filename] of [
  ['windows', 'LokLM-x64.exe'],
  ['linux', 'LokLM-Setup-linux-x64.run'],
  ['linux', 'LokLM-Setup-linux-x64.deb'],
  ['macos', 'LokLM-mac.dmg'],
]) {
  const artifact = index.artifacts.find((entry) => entry.filename === filename)
  execFileSync(
    process.execPath,
    [
      'scripts/bump-release.mjs',
      index.version,
      platform,
      artifact.sha256,
      String(artifact.sizeBytes),
      filename,
    ],
    { stdio: 'inherit' },
  )
}
