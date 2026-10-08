import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Exercise the packaging dependency actually used by this repository, not a
// separately installed direct dependency or a copied implementation.
let dependencyRequire = createRequire(import.meta.url)
for (const name of [
  'electron-builder',
  'app-builder-lib',
  '@electron/get',
  'got',
  'cacheable-request',
]) {
  dependencyRequire = createRequire(dependencyRequire.resolve(name))
}
const CachePolicy = dependencyRequire('http-cache-semantics')
const request = (cacheControl) => ({
  method: 'GET',
  url: 'https://cache-regression.invalid/resource',
  headers: {
    host: 'cache-regression.invalid',
    ...(cacheControl ? { 'cache-control': cacheControl } : {}),
  },
})
const NOW = Date.UTC(2026, 9, 5, 10)
function policy(headers, { shared = true, age = 60 } = {}) {
  vi.spyOn(CachePolicy.prototype, 'now').mockReturnValue(NOW)
  return new CachePolicy(
    request(),
    {
      status: 200,
      headers: {
        date: new Date(NOW).toUTCString(),
        age: String(age),
        etag: '"test-etag"',
        ...headers,
      },
    },
    { shared },
  )
}
afterEach(() => vi.restoreAllMocks())

const prohibited = [
  ['shared Set-Cookie', { 'cache-control': 'max-age=3600', 'set-cookie': 'fake=synthetic' }],
  ['shared proxy-revalidate', { 'cache-control': 'max-age=3600, proxy-revalidate' }],
  ['response no-cache', { 'cache-control': 'max-age=3600, no-cache' }],
  ['response no-store', { 'cache-control': 'max-age=3600, no-store' }],
  ['shared private', { 'cache-control': 'max-age=3600, private' }],
  ['Vary: *', { 'cache-control': 'public, max-age=3600', vary: '*' }],
]

describe('http-cache-semantics local security patch', () => {
  it.each(prohibited)('never lets max-stale override %s', (_name, headers) => {
    const cached = policy(headers)
    expect(cached.maxAge()).toBe(0)
    for (const directive of ['max-stale', 'max-stale=999999']) {
      const incoming = request(directive)
      expect(cached.satisfiesWithoutRevalidation(incoming)).toBe(false)
      expect(cached.evaluateRequest(incoming)).toMatchObject({
        response: undefined,
        revalidation: { synchronous: true },
      })
    }
  })

  it.each(prohibited)(
    'retains %s restrictions after serialized-cache loading',
    (_name, headers) => {
      const original = policy(headers)
      const saved = JSON.parse(JSON.stringify(original.toObject()))
      expect(saved.v).toBe(1)
      const restored = CachePolicy.fromObject(saved)
      expect(restored.toObject()).toEqual(saved)
      expect(restored.satisfiesWithoutRevalidation(request('max-stale'))).toBe(false)
    },
  )

  it.each(prohibited)(
    'does not reuse %s through stale extensions or a failed revalidation',
    (_name, headers) => {
      const cached = policy({
        ...headers,
        'cache-control': `${headers['cache-control']}, stale-while-revalidate=3600, stale-if-error=3600`,
      })
      expect(cached.useStaleWhileRevalidate()).toBe(false)
      expect(cached.evaluateRequest(request()).response).toBeUndefined()
      const revalidated = cached.revalidatedPolicy(request(), { status: 503, headers: {} })
      expect(revalidated.modified).toBe(true)
      expect(revalidated.matches).toBe(false)
      expect(revalidated.policy).not.toBe(cached)
    },
  )

  it.each(prohibited.slice(0, 3))(
    'preserves %s after a successful304 without a policy change',
    (_name, headers) => {
      const cached = policy(headers)
      expect(cached.revalidationHeaders(request('max-stale'))['if-none-match']).toBe('"test-etag"')
      const revalidated = cached.revalidatedPolicy(request(), {
        status: 304,
        headers: { etag: '"test-etag"', date: new Date(NOW).toUTCString(), age: '0' },
      })
      expect(revalidated).toMatchObject({ modified: false, matches: true })
      // Validation authorizes the current response. It does not allow a future
      // unrelated request to bypass the stored restrictions with max-stale.
      expect(revalidated.policy.satisfiesWithoutRevalidation(request('max-stale'))).toBe(false)
    },
  )

  it.each([
    ['ordinary expired public response', { 'cache-control': 'public, max-age=10' }, true],
    [
      'explicit public cookie opt-in',
      { 'cache-control': 'public, max-age=10', 'set-cookie': 'fake=synthetic' },
      true,
    ],
    [
      'existing immutable cookie opt-in',
      { 'cache-control': 'immutable, max-age=10', 'set-cookie': 'fake=synthetic' },
      true,
    ],
    [
      'private cookie cache',
      { 'cache-control': 'max-age=10', 'set-cookie': 'fake=synthetic' },
      false,
    ],
    [
      'proxy-revalidate in a private cache',
      { 'cache-control': 'max-age=10, proxy-revalidate' },
      false,
    ],
  ])('preserves normal max-stale behavior for %s', (_name, headers, shared) => {
    const cached = policy(headers, { shared })
    expect(cached.satisfiesWithoutRevalidation(request())).toBe(false)
    expect(cached.satisfiesWithoutRevalidation(request('max-stale=20'))).toBe(false)
    expect(cached.satisfiesWithoutRevalidation(request('max-stale=100'))).toBe(true)
    expect(cached.satisfiesWithoutRevalidation(request('max-stale'))).toBe(true)
  })

  it('preserves fresh responses and ordinary stale extension controls', () => {
    expect(
      policy({ 'cache-control': 'public, max-age=3600' }).satisfiesWithoutRevalidation(request()),
    ).toBe(true)
    const cached = policy({
      'cache-control': 'public, max-age=10, stale-while-revalidate=100, stale-if-error=100',
    })
    expect(cached.evaluateRequest(request())).toMatchObject({
      revalidation: { synchronous: false },
    })
    expect(cached.evaluateRequest(request()).response).toBeDefined()
    expect(cached.useStaleWhileRevalidate()).toBe(true)
    expect(cached.revalidatedPolicy(request(), { status: 503, headers: {} })).toMatchObject({
      policy: cached,
      modified: false,
      matches: true,
    })
  })

  it('honors a successful server response that explicitly changes the cache policy', () => {
    const cached = policy({ 'cache-control': 'no-cache' })
    for (const status of [200, 304]) {
      const refreshed = cached.revalidatedPolicy(request(), {
        status,
        headers: {
          'cache-control': 'public, max-age=3600',
          etag: '"test-etag"',
          age: '0',
          date: new Date(NOW).toUTCString(),
        },
      })
      expect(refreshed.modified).toBe(status === 200)
      expect(refreshed.policy.satisfiesWithoutRevalidation(request())).toBe(true)
    }
  })

  it('keeps must-revalidate and request no-cache as explicit refusals', () => {
    expect(
      policy({
        'cache-control': 'public, max-age=10, must-revalidate',
      }).satisfiesWithoutRevalidation(request('max-stale')),
    ).toBe(false)
    expect(
      policy({ 'cache-control': 'public, max-age=3600' }).satisfiesWithoutRevalidation(
        request('no-cache, max-stale'),
      ),
    ).toBe(false)
  })

  it('does not let stale extensions override must-revalidate', () => {
    const cached = policy({
      'cache-control':
        'public, max-age=10, must-revalidate, stale-while-revalidate=3600, stale-if-error=3600',
    })
    expect(cached.useStaleWhileRevalidate()).toBe(false)
    expect(cached.revalidatedPolicy(request(), { status: 503, headers: {} }).modified).toBe(true)
  })
})
