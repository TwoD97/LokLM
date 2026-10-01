import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Include generated shared chunks and all utility workers, not only entries.
 * Source hashes identify edited inputs; these hashes identify executed output. */
export async function fingerprintCompiledBuild(
  projectRoot = process.cwd(),
): Promise<Record<string, string>> {
  const paths: string[] = []
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(join(projectRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && /\.(?:js|cjs|mjs)$/i.test(entry.name)) paths.push(path)
    }
  }
  await walk('out/main')
  await walk('out/preload')
  if (!paths.length) throw new Error('No compiled application JavaScript found.')
  return Object.fromEntries(
    await Promise.all(
      paths.sort().map(async (path) => {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(join(projectRoot, path))) hash.update(chunk)
        return [path, hash.digest('hex')]
      }),
    ),
  )
}
