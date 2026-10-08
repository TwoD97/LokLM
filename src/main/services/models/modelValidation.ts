import { randomUUID } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs'

type EntryIdentity = { id: string; sizeBytes: number; sha256?: string }
type InvalidRecord = {
  version: 1
  id: string
  expectedSize: number
  expectedSha: string | null
  file: { size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number }
}
const invalidInSession = new Map<string, InvalidRecord>()
const recordPath = (target: string): string => `${target}.loklm-invalid.json`
function fileIdentity(stats: Stats): InvalidRecord['file'] {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    ino: stats.ino,
    dev: stats.dev,
  }
}

export function sameModelFile(before: Stats, after: Stats): boolean {
  const identity = fileIdentity(before)
  return (
    after.isFile() &&
    (Object.keys(identity) as (keyof typeof identity)[]).every(
      (key) => identity[key] === after[key],
    )
  )
}

function isInvalidRecord(value: unknown): value is InvalidRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<InvalidRecord>
  return (
    record.version === 1 &&
    typeof record.id === 'string' &&
    typeof record.expectedSize === 'number' &&
    Number.isFinite(record.expectedSize) &&
    (record.expectedSha === null ||
      (typeof record.expectedSha === 'string' && /^[a-f0-9]{64}$/.test(record.expectedSha))) &&
    !!record.file &&
    typeof record.file === 'object' &&
    ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].every((key) => {
      const value = record.file![key as keyof InvalidRecord['file']]
      return typeof value === 'number' && Number.isFinite(value)
    })
  )
}

/** Preserve original bytes, but do not declare a known corrupt file ready if
 * its replacement fails or is cancelled. Persist only model/file metadata. */
export function markModelInvalid(target: string, entry: EntryIdentity, stats: Stats): void {
  const record: InvalidRecord = {
    version: 1,
    id: entry.id,
    expectedSize: entry.sizeBytes,
    expectedSha: entry.sha256?.toLowerCase() ?? null,
    file: fileIdentity(stats),
  }
  invalidInSession.set(target, record)
  if (invalidInSession.size > 64) invalidInSession.delete(invalidInSession.keys().next().value!)
  const destination = recordPath(target)
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(record), { flag: 'wx' })
    renameSync(temporary, destination)
  } catch (error) {
    throw new Error(
      `Cannot record model repair at ${destination}. Check directory write permissions and retry.`,
      { cause: error },
    )
  } finally {
    try {
      rmSync(temporary, { force: true })
    } catch {
      /* preserve the original error */
    }
  }
}

export function isKnownInvalidModel(target: string, entry: EntryIdentity, stats: Stats): boolean {
  let record: InvalidRecord | undefined = invalidInSession.get(target)
  if (!record && existsSync(recordPath(target))) {
    try {
      if (statSync(recordPath(target)).size > 4096) return true
      const parsed: unknown = JSON.parse(readFileSync(recordPath(target), 'utf8'))
      if (!isInvalidRecord(parsed)) return true
      record = parsed
    } catch {
      return true
    }
  }
  if (!record) return false
  if (
    record.id !== entry.id ||
    record.expectedSize !== entry.sizeBytes ||
    record.expectedSha !== (entry.sha256?.toLowerCase() ?? null)
  )
    return false
  const current = fileIdentity(stats)
  return (Object.keys(current) as (keyof typeof current)[]).every(
    (key) => current[key] === record.file[key],
  )
}

export function clearModelInvalid(target: string): void {
  try {
    rmSync(recordPath(target), { force: true })
  } catch (error) {
    throw new Error(
      `Cannot clear model repair status at ${recordPath(target)}. Check directory write permissions and retry.`,
      { cause: error },
    )
  }
  invalidInSession.delete(target)
}
