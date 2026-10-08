import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function verifyDownload(url, artifact, fetcher = fetch) {
  const response = await fetcher(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15 * 60_000),
  })
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel()
    throw new Error(`Artifact HTTP failure: ${artifact.filename}`)
  }
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > artifact.sizeBytes)
      throw new Error(`Artifact larger than manifest: ${artifact.filename}`)
    hash.update(chunk)
  }
  if (size !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256) {
    throw new Error(`Public artifact digest/size mismatch: ${artifact.filename}`)
  }
}

async function main() {
  const index = JSON.parse(await readFile('release/release-index.json', 'utf8'))
  for (const artifact of index.artifacts) {
    await verifyDownload(`${index.baseUrl}/${artifact.filename}`, artifact)
    console.log(`Verified public bytes: ${artifact.filename}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
