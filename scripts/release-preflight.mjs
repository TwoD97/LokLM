import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Releases use stable SemVer only. Reject shell metacharacters, path segments,
// prereleases and mismatched tags before any build or remote write occurs.
export function releaseVersion({ eventName, ref, requestedVersion, packageVersion, platforms }) {
  if (platforms && platforms !== 'all') throw new Error('Partial releases are not supported')
  const version =
    eventName === 'push'
      ? ref?.startsWith('refs/tags/v')
        ? ref.slice('refs/tags/v'.length)
        : ''
      : eventName === 'workflow_dispatch'
        ? requestedVersion
        : ''
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
    throw new Error('Release requires a stable X.Y.Z version/tag')
  }
  if (version !== packageVersion) throw new Error('Release version must equal package.json version')
  return version
}

export function publicReleaseBase(base, version) {
  const url = new URL(base)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Public installer base must be an HTTPS URL without credentials, query or fragment',
    )
  }
  return `${url.href.replace(/\/$/, '')}/v${version}`
}

async function main() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const version = releaseVersion({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    requestedVersion: process.env.RELEASE_VERSION,
    platforms: process.env.RELEASE_PLATFORMS,
    packageVersion: pkg.version,
  })
  const base = publicReleaseBase(process.env.PUBLIC_INSTALLER_BASE_URL, version)
  const config = JSON.parse(await readFile('installer-wizard/src-tauri/tauri.conf.json', 'utf8'))
  if (config.version !== '../../package.json')
    throw new Error('Wizard must inherit the app version')
  if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GITHUB_OUTPUT')
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`)
  if (process.env.GITHUB_ENV)
    await appendFile(process.env.GITHUB_ENV, `LOKLM_PAYLOAD_BASE_URL=${base}\n`)
  console.log(`Validated full release v${version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
