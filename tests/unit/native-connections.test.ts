import { describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { ConnectionsService } from '@main/services/connections/ConnectionsService'
import { LiveSyncReader } from '@main/services/connections/LiveSyncReader'
import { NativeHttp } from '@main/services/connections/nativeHttp'
import { CONNECTIONS_KEY, redact, validateConfig } from '@main/services/connections/validation'
import type { McpConnectionConfig } from '@shared/connections'

type Json = Record<string, unknown>
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const CORE = 'urn:ietf:params:jmap:core',
  MAIL = 'urn:ietf:params:jmap:mail',
  SUBMIT = 'urn:ietf:params:jmap:submission'
const fm: McpConnectionConfig = {
  id: 'fastmail',
  name: 'Fastmail',
  transport: 'fastmail',
  enabled: true,
  env: { API_TOKEN: 'private-fixture-token' },
}
const couch: McpConnectionConfig = {
  id: 'obsidian',
  name: 'Obsidian',
  transport: 'couchdb',
  enabled: true,
  url: 'https://notes.example/vault',
  env: {
    COUCHDB_USERNAME: 'fixture-user',
    COUCHDB_PASSWORD: 'fixture-password',
    LIVESYNC_PASSPHRASE: 'fixture-passphrase',
  },
}
const signal = () => new AbortController().signal
function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const kv = new Map<string, string>()
  const fetcher = vi.fn<typeof fetch>(async (url, init = {}) => handler(String(url), init))
  const service = new ConnectionsService(
    {
      getKv: (key) => kv.get(key) ?? null,
      setKvDurably: async (key, value) => {
        kv.set(key, value)
      },
    },
    () => true,
    { fetch: fetcher },
  )
  const call = async (name: string, args: Json = {}) => {
    const tools = await service.tools()
    const tool = tools.find((tool) => tool.name === name)!
    return JSON.parse(await service.call(tool.id, args)) as Json
  }
  return { service, fetcher, kv, call }
}
function session(submission = true) {
  const caps = { [CORE]: {}, [MAIL]: {}, ...(submission ? { [SUBMIT]: {} } : {}) }
  return {
    capabilities: caps,
    primaryAccounts: { [MAIL]: 'account' },
    accounts: { account: { accountCapabilities: caps } },
    apiUrl: 'https://api.fastmail.com/jmap/api/',
  }
}
function mailFixture(submission = true, override?: (calls: unknown[][]) => Response | undefined) {
  return setup((_url, init) => {
    if (init.method === 'GET') return json(session(submission))
    const calls = JSON.parse(String(init.body)).methodCalls as unknown[][]
    const custom = override?.(calls)
    if (custom) return custom
    return json({
      methodResponses: calls.map(([method, , id]) => [
        method,
        method === 'Identity/get'
          ? { list: [{ id: 'identity', email: 'me@example.com' }] }
          : method === 'Mailbox/get'
            ? {
                list: [
                  { id: 'draft/folder', role: 'drafts' },
                  { id: 'sent', role: 'sent' },
                ],
              }
            : method === 'Email/set'
              ? { created: { draft: { id: 'email' } } }
              : method === 'EmailSubmission/set'
                ? { created: { submit: { id: 'submission' } } }
                : method === 'Email/query'
                  ? { total: 2, position: 1, ids: ['email'] }
                  : { list: [{ id: 'email', subject: 'Hello' }], notFound: [] },
        id,
      ]),
    })
  })
}

// Independent WebCrypto fixtures implement the documented upstream envelopes; production uses Node crypto.
const utf8 = (text: string) => new TextEncoder().encode(text)
const dbSalt = new Uint8Array(32).fill(7)
async function seal(
  text: string,
  mode: 'hkdf' | 'legacy' | 'dynamic' | 'json' = 'hkdf',
): Promise<string> {
  const passphrase = couch.env!.LIVESYNC_PASSPHRASE!
  const subtle = webcrypto.subtle
  const iv = new Uint8Array(mode === 'hkdf' ? 12 : 16).fill(4)
  const salt = new Uint8Array(mode === 'hkdf' ? 32 : 16).fill(9)
  let key: webcrypto.CryptoKey
  if (mode === 'hkdf') {
    const material = await subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, [
      'deriveBits',
    ])
    const master = await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: dbSalt, iterations: 310000 },
      material,
      256,
    )
    const hkdf = await subtle.importKey('raw', master, 'HKDF', false, ['deriveKey'])
    key = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new Uint8Array() },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
  } else {
    const digest = await subtle.digest('SHA-256', utf8(passphrase))
    const material = await subtle.importKey('raw', digest, 'PBKDF2', false, ['deriveKey'])
    const distance = 15 - passphrase.length
    key = await subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: mode === 'dynamic' ? Math.max(distance, 0) * 1000 + 121 - distance : 100000,
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
  }
  const ciphertext = Buffer.from(
    await subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      utf8(mode === 'json' ? JSON.stringify(text) : text),
    ),
  )
  if (mode === 'hkdf') return '%=' + Buffer.concat([iv, salt, ciphertext]).toString('base64')
  if (mode === 'json')
    return JSON.stringify([
      ciphertext.toString('base64'),
      Buffer.from(iv).toString('hex'),
      Buffer.from(salt).toString('hex'),
    ])
  return (
    '%' +
    Buffer.from(iv).toString('hex') +
    Buffer.from(salt).toString('hex') +
    ciphertext.toString('base64')
  )
}

describe('native connection credentials and transport', () => {
  it('redacts encoded CouchDB authorization as well as the raw password and encryption passphrase', () => {
    const authorization = Buffer.from(
      `${couch.env!.COUCHDB_USERNAME}:${couch.env!.COUCHDB_PASSWORD}`,
    ).toString('base64')
    expect(
      redact(
        `Basic ${authorization} ${couch.env!.COUCHDB_PASSWORD} ${couch.env!.LIVESYNC_PASSPHRASE}`,
        couch,
      ),
    ).toBe('Basic [redacted] [redacted] [redacted]')
  })
  it('does not transfer native credentials to a local MCP process when changing connection type', () => {
    const changed = validateConfig(
      { id: couch.id, name: couch.name, transport: 'stdio', command: 'server' },
      couch,
    )
    expect(changed.env).toEqual({})
    expect(validateConfig(fm, couch).env).toEqual(fm.env)
  })
  it('cancels an in-flight native request when the vault locks, without retrying', async () => {
    let requestSignal: AbortSignal | undefined
    const fixture = setup((_url, init) => {
      if (init.method === 'GET') return json(session())
      requestSignal = init.signal as AbortSignal
      return new Promise((_resolve, reject) =>
        requestSignal!.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        }),
      )
    })
    await fixture.service.save(fm)
    await fixture.service.connect(fm.id)
    const pending = fixture.call('fastmail_search_email')
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(requestSignal).toBeDefined())
    fixture.service.invalidate()
    await fixture.service.drain()
    await rejected
    expect(requestSignal!.aborted).toBe(true)
    expect(fixture.fetcher).toHaveBeenCalledTimes(2)
    expect(await fixture.service.tools()).toEqual([])
  })
  it('preserves omitted credentials, merges partial edits, redacts summaries and never connects on save', async () => {
    const { service, kv, fetcher } = setup(() => json({}))
    const saved = await service.save(couch)
    expect(JSON.stringify(saved)).not.toContain('fixture-passphrase')
    await service.save({ ...couch, env: { COUCHDB_PASSWORD: 'replacement' } })
    expect(JSON.parse(kv.get(CONNECTIONS_KEY)!).connections[0].env).toEqual({
      ...couch.env,
      COUCHDB_PASSWORD: 'replacement',
    })
    await service.save({ ...couch, env: {} })
    expect((await service.list())[0]!.secretKeys).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('restricts endpoints and native credential fields', () => {
    expect(() => validateConfig({ ...fm, url: 'https://other.example' })).toThrow()
    expect(() => validateConfig({ ...fm, env: { OTHER: 'secret' } })).toThrow()
    for (const url of [
      'http://remote.example/db',
      'https://notes.example/',
      'https://user:password@notes.example/db',
      'https://notes.example/db?q=x',
    ])
      expect(() => validateConfig({ ...couch, url })).toThrow()
    expect(validateConfig({ ...couch, url: 'http://127.0.0.1:5984/vault/' }).url).toBe(
      'http://127.0.0.1:5984/vault',
    )
  })
  it('bounds HTTP response size and rejects redirect following', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('x'.repeat(2_000_001)))
    const http = new NativeHttp({ fetch: fetcher })
    await expect(http.json('https://example.com', {}, signal())).rejects.toThrow('too large')
    expect(fetcher.mock.calls[0]![1]!.redirect).toBe('error')
    await http.close()
    await expect(http.json('https://example.com', {}, signal())).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('Fastmail JMAP', () => {
  it('hides writing tools when Fastmail reports the account is read-only', async () => {
    const fixture = setup(() => {
      const data = session()
      return json({
        ...data,
        accounts: { account: { ...data.accounts.account, isReadOnly: true } },
      })
    })
    await fixture.service.save(fm)
    await fixture.service.connect(fm.id)
    expect((await fixture.service.tools()).map((tool) => tool.name)).not.toContain(
      'fastmail_send_email',
    )
  })
  it('discovers read tools for mail-only tokens without writing or forwarding the token to another origin', async () => {
    const { service, fetcher } = mailFixture(false)
    await service.save(fm)
    await service.connect(fm.id)
    expect((await service.tools()).map((tool) => tool.name)).toEqual([
      'fastmail_list_mailboxes',
      'fastmail_search_email',
      'fastmail_read_email',
    ])
    expect((await service.tools())[0]).toMatchObject({ source: 'connection', effect: 'external' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({
      Authorization: 'Bearer private-fixture-token',
    })
    const bad = setup(() => json({ ...session(), apiUrl: 'https://attacker.example/jmap' }))
    await bad.service.save(fm)
    await expect(bad.service.connect(fm.id)).rejects.toThrow('unexpected API endpoint')
    expect(bad.fetcher).toHaveBeenCalledTimes(1)
  })
  it('searches with result references and preserves server pagination', async () => {
    const fixture = mailFixture()
    await fixture.service.save(fm)
    await fixture.service.connect(fm.id)
    expect(
      await fixture.call('fastmail_search_email', { text: 'invoice', unread: true, position: 1 }),
    ).toMatchObject({ position: 1, total: 2 })
    const request = JSON.parse(String(fixture.fetcher.mock.calls.at(-1)![1]!.body))
    expect(request.methodCalls[0][1]).toMatchObject({
      filter: { text: 'invoice', notKeyword: '$seen' },
      position: 1,
    })
    expect(request.methodCalls[1][1]['#ids']).toEqual({
      resultOf: 'query',
      name: 'Email/query',
      path: '/ids',
    })
  })
  it('caps multipart email body output and retains truncation markers', async () => {
    const fixture = mailFixture(true, (calls) =>
      calls[0]?.[0] === 'Email/get'
        ? json({
            methodResponses: [
              [
                'Email/get',
                {
                  list: [
                    {
                      id: 'mail',
                      bodyValues: {
                        a: { value: 'x'.repeat(20000), isTruncated: false },
                        b: { value: 'y'.repeat(10000) },
                      },
                    },
                  ],
                },
                'read',
              ],
            ],
          })
        : undefined,
    )
    await fixture.service.save(fm)
    await fixture.service.connect(fm.id)
    const result = await fixture.call('fastmail_read_email', { ids: ['mail'] })
    expect(result).toMatchObject({
      emails: [{ bodyValues: { b: { value: 'y'.repeat(4000), isTruncated: true } } }],
      attachmentContentIncluded: false,
    })
    await expect(fixture.call('fastmail_read_email', { ids: ['a', 'b'] })).rejects.toThrow()
  })
  it.each(['fastmail_create_draft', 'fastmail_send_email'])(
    '%s uses a verified identity and submits only for the send tool',
    async (name) => {
      const fixture = mailFixture()
      await fixture.service.save(fm)
      await fixture.service.connect(fm.id)
      const result = await fixture.call(name, {
        from: 'me@example.com',
        to: ['you@example.com'],
        subject: 'Hello',
        body: 'Message',
      })
      expect(result.status).toBe(name === 'fastmail_send_email' ? 'submitted' : 'draft_created')
      const request = JSON.parse(String(fixture.fetcher.mock.calls.at(-1)![1]!.body))
      expect(request.methodCalls.map((call: unknown[]) => call[0])).toEqual(
        name === 'fastmail_send_email' ? ['Email/set', 'EmailSubmission/set'] : ['Email/set'],
      )
      expect(request.methodCalls[0][1].create.draft.bodyValues.body.value).toBe('Message')
      if (name === 'fastmail_send_email')
        expect(request.methodCalls[1][1]).toMatchObject({
          create: { submit: { emailId: '#draft', identityId: 'identity' } },
          onSuccessUpdateEmail: {
            '#submit': { 'mailboxIds/draft~1folder': null, 'mailboxIds/sent': true },
          },
        })
    },
  )
  it('refuses an unverified From address before creating a message', async () => {
    const fixture = mailFixture()
    await fixture.service.save(fm)
    await fixture.service.connect(fm.id)
    await expect(
      fixture.call('fastmail_send_email', {
        from: 'someone@example.com',
        to: ['you@example.com'],
        subject: '',
        body: '',
      }),
    ).rejects.toThrow('not a verified')
    expect(fixture.fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not retry when submission is unconfirmed', async () => {
    const fixture = mailFixture(true, (calls) =>
      calls[0]?.[0] === 'Email/set'
        ? json({
            methodResponses: [
              ['Email/set', { created: { draft: { id: 'draft' } } }, 'create'],
              ['EmailSubmission/set', { notCreated: { submit: { type: 'forbidden' } } }, 'send'],
            ],
          })
        : undefined,
    )
    await fixture.service.save(fm)
    await fixture.service.connect(fm.id)
    await expect(
      fixture.call('fastmail_send_email', {
        from: 'me@example.com',
        to: ['you@example.com'],
        subject: '',
        body: '',
      }),
    ).rejects.toThrow('check Drafts and Sent')
    expect(fixture.fetcher).toHaveBeenCalledTimes(4)
  })
})

describe('LiveSync encryption interoperability', () => {
  it('can read again after a failed salt request and never starts one for malformed ciphertext', async () => {
    const salt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(Buffer.from(dbSalt).toString('base64'))
    const reader = new LiveSyncReader(couch.env!.LIVESYNC_PASSPHRASE!, salt)
    await expect(reader.decrypt('%=invalid', signal())).rejects.toThrow('decryption failed')
    expect(salt).not.toHaveBeenCalled()
    const encoded = await seal('Recovered')
    await expect(reader.decrypt(encoded, signal())).rejects.toThrow('decryption failed')
    expect(await reader.decrypt(encoded, signal())).toBe('Recovered')
    expect(salt).toHaveBeenCalledTimes(2)
    reader.close()
  })
  it.each(['hkdf', 'legacy', 'dynamic', 'json'] as const)(
    'authenticates and decrypts %s Unicode envelopes',
    async (mode) => {
      const encoded = await seal('Notiz 📝 日本語\nSecond line', mode)
      const salt = vi.fn(async () => Buffer.from(dbSalt).toString('base64'))
      const reader = new LiveSyncReader(couch.env!.LIVESYNC_PASSPHRASE!, salt)
      expect(await reader.decrypt(encoded, signal())).toBe('Notiz 📝 日本語\nSecond line')
      expect(
        await reader.decrypt(await reader.encrypt('Edited 📝', encoded, signal()), signal()),
      ).toBe('Edited 📝')
      expect(salt).toHaveBeenCalledTimes(mode === 'hkdf' ? 1 : 0)
      const wrong = new LiveSyncReader('wrong-passphrase', salt)
      await expect(wrong.decrypt(encoded, signal())).rejects.toThrow('decryption failed')
      reader.close()
      await expect(reader.decrypt(encoded, signal())).rejects.toThrow('closed')
      wrong.close()
    },
  )
  it('rejects changed authentication tags and unsupported versions', async () => {
    const reader = new LiveSyncReader(couch.env!.LIVESYNC_PASSPHRASE!, async () =>
      Buffer.from(dbSalt).toString('base64'),
    )
    const encoded = await seal('Secret')
    const payload = Buffer.from(encoded.slice(2), 'base64')
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 1
    await expect(reader.decrypt('%=' + payload.toString('base64'), signal())).rejects.toThrow(
      'decryption failed',
    )
    await expect(reader.decrypt('%~unknown', signal())).rejects.toThrow('decryption failed')
    reader.close()
  })
  it('decompresses before decrypting transport-compressed chunks', async () => {
    const reader = new LiveSyncReader(couch.env!.LIVESYNC_PASSPHRASE!, async () =>
      Buffer.from(dbSalt).toString('base64'),
    )
    const encoded = await seal('Compressed note')
    const decoded = await reader.decode(
      {
        type: 'leaf',
        e_: true,
        data: '\u000eLZ\u001d' + deflateRawSync(encoded).toString('base64'),
      },
      signal(),
    )
    expect(decoded.data).toBe('Compressed note')
    const compressedPlaintext =
      '\u000eLZ\u001d' + deflateRawSync('Compression inside encryption').toString('base64')
    expect(
      (
        await reader.decode(
          { type: 'leaf', e_: true, data: await seal(compressedPlaintext) },
          signal(),
        )
      ).data,
    ).toBe('Compression inside encryption')
    reader.close()
  })
})

const plain = {
  _id: 'note.md',
  _rev: '1-old',
  path: 'note.md',
  type: 'plain',
  children: ['h:a', 'h:b'],
  eden: { 'h:a': { data: 'Hello ', epoch: 1 } },
  ctime: 1,
  mtime: 2,
  size: 11,
}
function notesFixture(docs: Json[], options: { conflict?: boolean; page?: Json[] } = {}) {
  const documents = new Map(docs.map((doc) => [String(doc._id), doc]))
  const writes: Json[] = []
  const fixture = setup((url, init) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/vault') return json({ db_name: 'vault' })
    if (parsed.pathname.endsWith('/_local/obsidian_livesync_sync_parameters'))
      return json({ pbkdf2salt: Buffer.from(dbSalt).toString('base64') })
    if (parsed.pathname.endsWith('/_all_docs')) {
      if (init.method === 'POST') {
        const keys = JSON.parse(String(init.body)).keys as string[]
        return json({
          rows: keys.map((id) =>
            documents.has(id) ? { id, doc: documents.get(id) } : { id, error: 'not_found' },
          ),
        })
      }
      return json({ rows: (options.page ?? docs).map((doc) => ({ id: doc._id, doc })) })
    }
    const id = decodeURIComponent(parsed.pathname.slice('/vault/'.length))
    if (init.method === 'PUT') {
      const doc = JSON.parse(String(init.body)) as Json
      if (options.conflict && doc.type !== 'leaf') return new Response('{}', { status: 409 })
      writes.push(doc)
      documents.set(id, { ...doc, _rev: '2-new' })
      return json({ ok: true, id, rev: '2-new' })
    }
    return documents.has(id) ? json(documents.get(id)) : new Response('{}', { status: 404 })
  })
  return { ...fixture, writes, documents }
}

describe('CouchDB notes', () => {
  it.each(['invalid Unicode', 'invalid metadata'])(
    'refuses %s before writing any chunks',
    async (reason) => {
      const note = { ...plain, ...(reason === 'invalid metadata' ? { ctime: 'not-a-time' } : {}) }
      const fixture = notesFixture([note, { _id: 'h:b', type: 'leaf', data: 'world' }])
      await fixture.service.save(couch)
      await fixture.service.connect(couch.id)
      await expect(
        fixture.call('couchdb_update_note', {
          id: plain._id,
          path: plain.path,
          expectedRevision: plain._rev,
          content: reason === 'invalid Unicode' ? '\ud800' : 'replacement',
        }),
      ).rejects.toThrow(/invalid Unicode|Invalid LiveSync note metadata/)
      expect(fixture.writes).toHaveLength(0)
    },
  )
  it('reads encrypted filenames and legacy chunks without the newer e_ marker', async () => {
    const note = {
      ...plain,
      _id: 'f:legacy',
      path: await seal('secret/path.md', 'legacy'),
      children: ['h:+legacy'],
      eden: {},
    }
    const fixture = notesFixture([
      note,
      { _id: 'h:+legacy', type: 'leaf', data: await seal('Private legacy note', 'dynamic') },
    ])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    expect(await fixture.call('couchdb_read_note', { id: note._id })).toMatchObject({
      path: 'secret/path.md',
      content: 'Private legacy note',
    })
  })
  it('preserves legacy filename encryption and creates encrypted leaves when editing', async () => {
    const note = {
      ...plain,
      _id: 'f:legacy',
      path: await seal('secret/path.md', 'legacy'),
      children: ['h:+legacy'],
      eden: {},
    }
    const fixture = notesFixture([
      note,
      { _id: 'h:+legacy', type: 'leaf', e_: true, data: await seal('Original', 'legacy') },
      { _id: 'syncinfo', type: 'syncinfo', e_: true, data: await seal('verification', 'legacy') },
    ])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    await fixture.call('couchdb_update_note', {
      id: note._id,
      path: 'secret/path.md',
      expectedRevision: note._rev,
      content: 'New private content',
    })
    expect(fixture.writes[1]!.path).toBe(note.path)
    expect(fixture.writes[0]!.e_).toBe(true)
    expect(JSON.stringify(fixture.writes)).not.toContain('New private content')
    expect(await fixture.call('couchdb_read_note', { id: note._id })).toMatchObject({
      content: 'New private content',
    })
  })
  it('refuses to overwrite the metadata if storing a new chunk fails', async () => {
    const fixture = notesFixture([plain, { _id: 'h:b', type: 'leaf', data: 'world' }])
    await fixture.service.save({
      ...couch,
      env: { COUCHDB_USERNAME: 'fixture-user', COUCHDB_PASSWORD: 'fixture-password' },
    })
    await fixture.service.connect(couch.id)
    const normal = fixture.fetcher.getMockImplementation()!
    fixture.fetcher.mockImplementation(async (url, init) =>
      init?.method === 'PUT' ? new Response('{}', { status: 503 }) : normal(url, init),
    )
    await expect(
      fixture.call('couchdb_update_note', {
        id: plain._id,
        path: plain.path,
        expectedRevision: plain._rev,
        content: 'New',
      }),
    ).rejects.toThrow('503')
    const writes = fixture.fetcher.mock.calls.filter(([, init]) => init!.method === 'PUT')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0]![1]!.body)).type).toBe('leaf')
    expect(fixture.documents.get(plain._id)).toEqual(plain)
  })
  it('clears an encrypted note without changing its encryption or writing an empty chunk', async () => {
    const note = {
      ...plain,
      _id: 'f:empty',
      path:
        '/\\:' +
        (await seal(
          JSON.stringify({ path: 'empty.md', children: [], ctime: 1, mtime: 2, size: 0 }),
        )),
      children: [],
      eden: {},
    }
    const fixture = notesFixture([note])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    await fixture.call('couchdb_update_note', {
      id: note._id,
      path: 'empty.md',
      expectedRevision: note._rev,
      content: '',
    })
    expect(fixture.writes).toHaveLength(1)
    expect(String(fixture.writes[0]!.path)).toMatch(/^\/\\:%=/)
    expect(await fixture.call('couchdb_read_note', { id: note._id })).toMatchObject({ content: '' })
  })
  it('returns the first unscanned ID as a cursor even when filename filtering produces an empty page', async () => {
    const fixture = notesFixture([{ _id: 'h:chunk', type: 'leaf' }, plain])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    expect(await fixture.call('couchdb_list_notes', { query: 'absent', limit: 1 })).toMatchObject({
      notes: [],
      hasMore: true,
      nextCursor: 'note.md',
      scanned: 1,
    })
    await fixture.call('couchdb_list_notes', { cursor: 'note.md' })
    expect(
      new URL(String(fixture.fetcher.mock.calls.at(-1)![0])).searchParams.get('startkey'),
    ).toBe('"note.md"')
    expect(fixture.writes).toEqual([])
  })
  it('reassembles inline and remote chunks in order with explicit text paging', async () => {
    const fixture = notesFixture([plain, { _id: 'h:b', type: 'leaf', data: 'world' }])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    expect(await fixture.call('couchdb_read_note', { id: plain._id, length: 6 })).toMatchObject({
      content: 'Hello ',
      revision: '1-old',
      hasMore: true,
      nextOffset: 6,
      totalCharacters: 11,
    })
    expect(await fixture.call('couchdb_read_note', { id: plain._id, offset: 6 })).toMatchObject({
      content: 'world',
      hasMore: false,
    })
    expect(fixture.writes).toEqual([])
  })
  it.each(['missing', 'conflict', 'binary', 'internal'])(
    'rejects %s data without presenting partial content',
    async (mode) => {
      const note = {
        ...plain,
        ...(mode === 'conflict' ? { _conflicts: ['other'] } : {}),
        ...(mode === 'binary' ? { type: 'newnote' } : {}),
      }
      const fixture = notesFixture([note])
      await fixture.service.save(couch)
      await fixture.service.connect(couch.id)
      await expect(
        fixture.call('couchdb_read_note', {
          id: mode === 'internal' ? '_design/system' : note._id,
        }),
      ).rejects.toThrow()
      expect(fixture.writes).toEqual([])
    },
  )
  it('reads encrypted metadata, Eden and leaves, then writes ciphertext with a revision precondition', async () => {
    const meta = {
      path: 'private/note.md',
      mtime: 2,
      ctime: 1,
      size: 11,
      children: ['h:+inline', 'h:+remote'],
    }
    const note = {
      _id: 'f:opaque',
      _rev: '1-old',
      type: 'plain',
      path: '/\\:' + (await seal(JSON.stringify(meta))),
      mtime: 0,
      ctime: 0,
      size: 0,
      children: [],
      eden: {
        'h:++encrypted-hkdf': {
          data: await seal(JSON.stringify({ 'h:+inline': { data: 'Hello ', epoch: 1 } })),
          epoch: 999999,
        },
      },
    }
    const fixture = notesFixture([
      note,
      { _id: 'h:+remote', type: 'leaf', e_: true, data: await seal('world') },
    ])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    expect(await fixture.call('couchdb_read_note', { id: note._id })).toMatchObject({
      content: 'Hello world',
      path: meta.path,
    })
    expect(
      await fixture.call('couchdb_update_note', {
        id: note._id,
        path: meta.path,
        expectedRevision: '1-old',
        content: 'Updated private text 📝',
      }),
    ).toMatchObject({ status: 'updated', revision: '2-new' })
    expect(fixture.writes).toHaveLength(2)
    const serialized = JSON.stringify(fixture.writes)
    expect(serialized).not.toContain('Updated private text')
    expect(serialized).not.toContain('private/note.md')
    expect(fixture.writes[1]).toMatchObject({
      _id: note._id,
      _rev: '1-old',
      children: [],
      size: 0,
      mtime: 0,
    })
    expect(fixture.writes[0]).toMatchObject({ type: 'leaf', e_: true })
    expect(await fixture.call('couchdb_read_note', { id: note._id })).toMatchObject({
      content: 'Updated private text 📝',
      path: meta.path,
    })
    // The passphrase never goes over the wire, including authentication requests.
    expect(JSON.stringify(fixture.fetcher.mock.calls)).not.toContain(couch.env!.LIVESYNC_PASSPHRASE)
  })
  it('edits a plain JSON note, preserves other fields and refuses stale revisions or path mismatches', async () => {
    const fixture = notesFixture([{ _id: 'plain', _rev: '1-old', content: 'old', tags: ['keep'] }])
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    await expect(
      fixture.call('couchdb_update_note', {
        id: 'plain',
        path: 'plain',
        expectedRevision: '0-stale',
        content: 'new',
      }),
    ).rejects.toThrow('changed since review')
    await expect(
      fixture.call('couchdb_update_note', {
        id: 'plain',
        path: 'different',
        expectedRevision: '1-old',
        content: 'new',
      }),
    ).rejects.toThrow('path')
    expect(fixture.writes).toHaveLength(0)
    await fixture.call('couchdb_update_note', {
      id: 'plain',
      path: 'plain',
      expectedRevision: '1-old',
      content: 'new',
    })
    expect(fixture.writes).toEqual([
      expect.objectContaining({ _rev: '1-old', content: 'new', tags: ['keep'] }),
    ])
  })
  it('does not retry a server revision conflict', async () => {
    const fixture = notesFixture([{ _id: 'plain', _rev: '1-old', content: 'old' }], {
      conflict: true,
    })
    await fixture.service.save(couch)
    await fixture.service.connect(couch.id)
    await expect(
      fixture.call('couchdb_update_note', {
        id: 'plain',
        path: 'plain',
        expectedRevision: '1-old',
        content: 'new',
      }),
    ).rejects.toThrow('Nothing was overwritten')
    expect(fixture.fetcher.mock.calls.filter(([, init]) => init!.method === 'PUT')).toHaveLength(1)
  })
  it('never writes when decryption fails', async () => {
    const fixture = notesFixture([
      { ...plain, children: ['h:+b'], eden: {} },
      { _id: 'h:+b', type: 'leaf', e_: true, data: await seal('secret') },
    ])
    await fixture.service.save({
      ...couch,
      env: { ...couch.env, LIVESYNC_PASSPHRASE: 'incorrect' },
    })
    await fixture.service.connect(couch.id)
    await expect(
      fixture.call('couchdb_update_note', {
        id: plain._id,
        path: plain.path,
        expectedRevision: plain._rev,
        content: '',
      }),
    ).rejects.toThrow('decryption failed')
    expect(fixture.writes).toEqual([])
  })
})
