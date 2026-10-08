import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const astroRequire = createRequire(require.resolve('astro'))
const CachePolicy = astroRequire('http-cache-semantics')
const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8'))
const magicastRequire = createRequire(coverageRequire.resolve('magicast'))
const { SourceMapConsumer, SourceMapGenerator } = magicastRequire('source-map-js')
const now = Date.UTC(2026, 9, 8)
const request = (control = '') => ({
  method: 'GET',
  url: 'https://dependency-test.invalid/resource',
  headers: { host: 'dependency-test.invalid', 'cache-control': control },
})
function cached(headers: Record<string, string>, shared = true) {
  vi.spyOn(CachePolicy.prototype, 'now').mockReturnValue(now)
  return new CachePolicy(
    request(),
    { status: 200, headers: { date: new Date(now).toUTCString(), age: '60', ...headers } },
    { shared },
  )
}
afterEach(() => vi.restoreAllMocks())

describe('Astro resolved cache policy security', () => {
  it.each([
    ['private', { 'cache-control': 'private, max-age=3600' }],
    ['no-cache', { 'cache-control': 'no-cache, max-age=3600' }],
    ['no-store', { 'cache-control': 'no-store, max-age=3600' }],
    ['proxy-revalidate', { 'cache-control': 'proxy-revalidate, max-age=3600' }],
    ['cookie', { 'cache-control': 'max-age=3600', 'set-cookie': 'synthetic=only' }],
    ['vary', { 'cache-control': 'max-age=3600', vary: '*' }],
  ] as const)('does not let stale options bypass %s', (_label, headers) => {
    const policy = cached(headers)
    for (const original of [
      policy,
      CachePolicy.fromObject(JSON.parse(JSON.stringify(policy.toObject()))),
    ]) {
      for (const control of ['max-stale', 'max-stale=999999']) {
        expect(original.satisfiesWithoutRevalidation(request(control))).toBe(false)
        expect(original.evaluateRequest(request(control))).toMatchObject({
          response: undefined,
          revalidation: { synchronous: true },
        })
      }
    }
    const extensions = cached({
      ...headers,
      'cache-control': `${headers['cache-control']}, stale-while-revalidate=1000, stale-if-error=1000`,
    })
    expect(extensions.useStaleWhileRevalidate()).toBe(false)
    expect(extensions.revalidatedPolicy(request(), { status: 503, headers: {} }).modified).toBe(
      true,
    )
  })

  it('preserves fresh public responses and ordinary stale/private-cache permissions', () => {
    expect(
      cached({ 'cache-control': 'public, max-age=3600' }).satisfiesWithoutRevalidation(request()),
    ).toBe(true)
    expect(
      cached({ 'cache-control': 'public, max-age=10' }).satisfiesWithoutRevalidation(
        request('max-stale=100'),
      ),
    ).toBe(true)
    expect(
      cached(
        { 'cache-control': 'private, max-age=10', 'set-cookie': 'synthetic=only' },
        false,
      ).satisfiesWithoutRevalidation(request('max-stale=100')),
    ).toBe(true)
  })
})

describe('coverage resolved source map validation', () => {
  const flat = { version: 3, sources: ['fixture.ts'], names: [], mappings: 'AAAA' }
  const indexed = (line: unknown) => ({
    version: 3,
    sections: [{ offset: { line, column: 0 }, map: flat }],
  })
  it.each([-1, 0.5, '2', Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid section offset %s',
    (line) => {
      expect(() => new SourceMapConsumer(indexed(line))).toThrow(/non-negative integers/)
    },
  )
  it('rejects excessive expansion and retains a normal source-map round trip', () => {
    expect(() => new SourceMapConsumer(indexed(100_000_000))).toThrow(/must not exceed/)
    const roundTrip = new SourceMapConsumer(
      SourceMapGenerator.fromSourceMap(new SourceMapConsumer(flat)).toJSON(),
    )
    expect(roundTrip.originalPositionFor({ line: 1, column: 0 })).toMatchObject({
      source: 'fixture.ts',
      line: 1,
    })
  })
})
