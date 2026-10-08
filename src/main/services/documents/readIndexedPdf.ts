import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { DocumentBytesResult } from '../../../shared/documents'

interface PdfSource {
  sourcePath: string
  mimeType: string | null
  contentHash: string | null
}

/** Hash the same buffer returned to PDF.js; a separate pre-read hash check has
 * a file-replacement race. Managed and external PDFs follow the same rule. */
export async function readIndexedPdf(
  source: PdfSource | null,
  expectedHash?: unknown,
  signal?: AbortSignal,
): Promise<DocumentBytesResult> {
  signal?.throwIfAborted()
  if (!source || (source.mimeType !== 'application/pdf' && !/\.pdf$/i.test(source.sourcePath)))
    return { status: 'unavailable' }
  const hash = source.contentHash
  if (
    !hash ||
    !/^[a-f0-9]{64}$/i.test(hash) ||
    (expectedHash !== undefined &&
      (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)))
  )
    return { status: 'unverified' }
  if (typeof expectedHash === 'string' && expectedHash.toLowerCase() !== hash.toLowerCase())
    return { status: 'changed' }
  let bytes: Buffer
  try {
    bytes = await readFile(source.sourcePath, { ...(signal ? { signal } : {}) })
  } catch (error) {
    signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code) return { status: 'unavailable' }
    throw error
  }
  signal?.throwIfAborted()
  if (createHash('sha256').update(bytes).digest('hex') !== hash.toLowerCase())
    return { status: 'changed' }
  return { status: 'verified', bytes: new Uint8Array(bytes) }
}
