import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdf,
  pbkdf2,
  randomBytes,
} from 'node:crypto'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'
import { McpError, record } from './validation'

const derive = promisify(pbkdf2)
const expand = promisify(hkdf)
const inflate = promisify(inflateRaw)
const META = '/\\:'
const EDEN = ['h:++encrypted', 'h:++encrypted-hkdf']
const MAX = 1_000_000

function base64(value: string): Buffer {
  if (
    value.length > 2_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('Invalid encoding')
  return Buffer.from(value, 'base64')
}
function open(key: Buffer, iv: Buffer, payload: Buffer): string {
  if (payload.length < 16) throw new Error('Missing authentication tag')
  const cipher = createDecipheriv('aes-256-gcm', key, iv)
  cipher.setAuthTag(payload.subarray(-16))
  return Buffer.concat([cipher.update(payload.subarray(0, -16)), cipher.final()]).toString('utf8')
}

/** Wire compatibility. See docs/assistant-connections.md for upstream format references.
 * No replication, migrations or salt generation; crypto state belongs to one connection.
 */
export class LiveSyncReader {
  private master: Promise<Buffer> | undefined
  private legacy = new Map<string, Promise<Buffer>>()
  private closed = false
  constructor(
    private passphrase: string,
    private readonly salt: (signal: AbortSignal) => Promise<string>,
  ) {}
  close(): void {
    this.closed = true
    this.passphrase = ''
    void this.master?.then(
      (key) => key.fill(0),
      () => undefined,
    )
    for (const key of this.legacy.values())
      void key.then(
        (value) => value.fill(0),
        () => undefined,
      )
    this.master = undefined
    this.legacy.clear()
  }
  private check(signal: AbortSignal): void {
    signal.throwIfAborted()
    if (this.closed) throw new McpError('Obsidian connection is closed.')
  }
  async encrypt(text: string, sample: string, signal: AbortSignal): Promise<string> {
    // Authenticate an existing envelope before allowing any write with this passphrase.
    await this.decrypt(sample, signal)
    this.check(signal)
    let key: Buffer, iv: Buffer
    if (sample.startsWith('%=')) {
      const salt = randomBytes(32)
      iv = randomBytes(12)
      key = Buffer.from(await expand('sha256', await this.master!, salt, Buffer.alloc(0), 32))
      // The complete binary envelope must be encoded together (not concatenated base64).
      try {
        this.check(signal)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        return (
          '%=' +
          Buffer.concat([
            iv,
            salt,
            cipher.update(text, 'utf8'),
            cipher.final(),
            cipher.getAuthTag(),
          ]).toString('base64')
        )
      } finally {
        key.fill(0)
      }
    }
    const salt = randomBytes(16)
    iv = randomBytes(16)
    key = await derive(
      createHash('sha256').update(this.passphrase).digest(),
      salt,
      100000,
      32,
      'sha256',
    )
    const prefix = `%${iv.toString('hex')}${salt.toString('hex')}`
    try {
      this.check(signal)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      return (
        prefix +
        Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString(
          'base64',
        )
      )
    } finally {
      key.fill(0)
    }
  }
  async decrypt(value: string, signal: AbortSignal): Promise<string> {
    this.check(signal)
    if (!this.passphrase)
      throw new McpError(
        'Enter the LiveSync encryption passphrase in connection settings to read this vault.',
      )
    try {
      if (value.length > 2_000_000) throw new Error('Encrypted value too large')
      let text: string
      if (value.startsWith('%=')) {
        const payload = base64(value.slice(2))
        if (payload.length < 60) throw new Error('Invalid encrypted chunk')
        this.master ??= this.salt(signal)
          .then(async (encoded) => {
            const salt = base64(encoded)
            if (salt.length !== 32) throw new Error('Invalid replication salt')
            return derive(this.passphrase, salt, 310000, 32, 'sha256')
          })
          .catch((error: unknown) => {
            // A cancelled/read-failed salt request must not poison future reviewed reads.
            this.master = undefined
            throw error
          })
        const master = await this.master
        this.check(signal)
        const key = Buffer.from(
          await expand('sha256', master, payload.subarray(12, 44), Buffer.alloc(0), 32),
        )
        try {
          text = open(key, payload.subarray(0, 12), payload.subarray(44))
        } finally {
          key.fill(0)
        }
      } else {
        let iv: string, salt: string, ciphertext: string
        const oldJson = value.startsWith('[')
        if (oldJson) {
          const parts: unknown = JSON.parse(value)
          if (
            !Array.isArray(parts) ||
            parts.length !== 3 ||
            parts.some((part) => typeof part !== 'string')
          )
            throw new Error('Invalid legacy envelope')
          ;[ciphertext, iv, salt] = parts as [string, string, string]
        } else {
          if (!/^%[0-9a-f]{64}/i.test(value)) throw new Error('Unsupported encryption version')
          iv = value.slice(1, 33)
          salt = value.slice(33, 65)
          ciphertext = value.slice(65)
        }
        if (!/^[0-9a-f]{32}$/i.test(iv) || !/^[0-9a-f]{32}$/i.test(salt))
          throw new Error('Invalid legacy envelope')
        const digest = createHash('sha256').update(this.passphrase).digest()
        const distance = 15 - this.passphrase.length
        const iterations = [100000, Math.max(distance, 0) * 1000 + 121 - distance]
        let decrypted: string | undefined
        for (const count of iterations) {
          this.check(signal)
          const cacheId = `${salt}:${count}`
          let key = this.legacy.get(cacheId)
          if (!key) {
            if (this.legacy.size >= 32) {
              const first = this.legacy.keys().next().value!
              void this.legacy.get(first)!.then(
                (value) => value.fill(0),
                () => undefined,
              )
              this.legacy.delete(first)
            }
            key = derive(digest, Buffer.from(salt, 'hex'), count, 32, 'sha256')
            this.legacy.set(cacheId, key)
          }
          try {
            decrypted = open(await key, Buffer.from(iv, 'hex'), base64(ciphertext))
            break
          } catch {
            /* Try the upstream dynamic-iteration variant. */
          }
        }
        if (decrypted === undefined) throw new Error('Authentication failed')
        const decoded: unknown = oldJson ? JSON.parse(decrypted) : decrypted
        if (typeof decoded !== 'string') throw new Error('Invalid legacy text')
        text = decoded
      }
      this.check(signal)
      if (text.length > MAX) throw new Error('Decrypted value too large')
      return text
    } catch (error) {
      this.check(signal)
      if (error instanceof McpError) throw error
      throw new McpError(
        'LiveSync decryption failed. Check the passphrase and encryption format; no vault data was changed.',
      )
    }
  }
  async unpack(data: string): Promise<string> {
    if (!data.startsWith('\u000eLZ\u001d')) return data
    const compressed = data.slice(4)
    try {
      const binary = compressed.startsWith('~')
      const raw = await inflate(base64(binary ? compressed.slice(1) : compressed), {
        maxOutputLength: MAX,
      })
      return raw.toString(binary ? 'base64' : 'utf8')
    } catch {
      throw new McpError('Invalid or oversized compressed LiveSync chunk.')
    }
  }
  async decode(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    this.check(signal)
    const doc = { ...input }
    if (typeof doc.data === 'string') doc.data = await this.unpack(doc.data)
    if (
      doc.e_ === true ||
      (String(doc._id).startsWith('h:+') &&
        typeof doc.data === 'string' &&
        (doc.data.startsWith('%') || doc.data.startsWith('["')))
    ) {
      if (typeof doc.data !== 'string') throw new McpError('Invalid encrypted LiveSync chunk.')
      doc.data = await this.unpack(await this.decrypt(doc.data, signal))
      delete doc.e_
    }
    if (typeof doc.path === 'string') {
      if (doc.path.startsWith(META)) {
        const meta = record(JSON.parse(await this.decrypt(doc.path.slice(META.length), signal)))
        for (const field of ['path', 'mtime', 'ctime', 'size', 'children'])
          if (field in meta) doc[field] = meta[field]
        if (typeof doc.path !== 'string') throw new McpError('Invalid encrypted note metadata.')
      } else if (
        String(doc._id).startsWith('f:') &&
        (doc.path.startsWith('%') || doc.path.startsWith('['))
      ) {
        doc.path = await this.decrypt(doc.path, signal)
      }
    }
    if (doc.eden) {
      let eden = { ...record(doc.eden) }
      for (const key of EDEN) {
        if (!(key in eden)) continue
        const data = record(eden[key]).data
        if (typeof data !== 'string')
          throw new McpError('Invalid encrypted LiveSync inline chunks.')
        const decoded = record(JSON.parse(await this.decrypt(data, signal)))
        delete eden[key]
        eden = { ...eden, ...decoded }
      }
      doc.eden = eden
    }
    this.check(signal)
    return doc
  }
}
