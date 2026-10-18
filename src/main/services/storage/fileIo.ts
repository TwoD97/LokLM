import type { FileHandle } from 'node:fs/promises'

/** Positional filesystem reads/writes may complete only part of a buffer. */
export async function readUpTo(
  file: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<number> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, position + offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return offset
}

export async function writeAll(file: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    )
    if (bytesWritten === 0) throw new Error('Workspace file write made no progress.')
    offset += bytesWritten
  }
}
