import { constants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Stage a user-requested plaintext export beside its destination, then replace
 * it atomically. Cancellation or a failed write leaves any prior file intact. */
export async function exportDocument(
  destination: string,
  source: { text: string } | { path: string },
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const staging = join(dirname(destination), `.loklm-export-${randomUUID()}.tmp`)
  let committed = false
  try {
    if ('text' in source) {
      await fs.writeFile(staging, source.text, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
        signal,
      })
    } else {
      await fs.copyFile(source.path, staging, constants.COPYFILE_EXCL)
      // A read-only original must still be exportable. The new plaintext copy
      // belongs to this user and needs a writable handle for the durable flush.
      await fs.chmod(staging, 0o600)
    }
    signal.throwIfAborted()
    // Windows FlushFileBuffers requires a writable handle.
    const file = await fs.open(staging, 'r+')
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    signal.throwIfAborted()
    await fs.rename(staging, destination)
    committed = true
  } finally {
    if (!committed) await fs.rm(staging, { force: true })
  }
}
