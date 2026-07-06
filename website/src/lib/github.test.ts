import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchGitHubData, type GitHubData } from './github'

const REPO = 'TwoD97/LokLM'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const rawContributor = (login: string, contributions: number) => ({
  login,
  avatar_url: `https://avatars/${login}`,
  html_url: `https://github.com/${login}`,
  contributions,
})

/**
 * Replaces global fetch with a mock that plays back the given outcomes in
 * order (first call = /repos, second call = /contributors). A Response
 * resolves, an Error rejects.
 */
function playbackFetch(...outcomes: Array<Response | Error>) {
  let mock = vi.fn()
  for (const outcome of outcomes) {
    mock =
      outcome instanceof Error
        ? mock.mockRejectedValueOnce(outcome)
        : mock.mockResolvedValueOnce(outcome)
  }
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('fetchGitHubData (no cache)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('maps repo stars and contributor fields on a fully successful run', async () => {
    playbackFetch(
      json({ stargazers_count: 142 }),
      json([rawContributor('alice', 50), rawContributor('bob', 20)]),
    )

    const result: GitHubData = await fetchGitHubData(REPO, { useCache: false })

    expect(result.stars).toBe(142)
    expect(result.contributors).toHaveLength(2)
    expect(result.contributors[0]).toEqual({
      login: 'alice',
      avatarUrl: 'https://avatars/alice',
      profileUrl: 'https://github.com/alice',
    })
  })

  it('caps the contributor list at 8 and counts the overflow', async () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => rawContributor(`user${i}`, 15 - i))
    playbackFetch(json({ stargazers_count: 10 }), json(fifteen))

    const result = await fetchGitHubData(REPO, { useCache: false })
    expect(result.contributors).toHaveLength(8)
    expect(result.extraContributors).toBe(7)
  })

  it('degrades to null stars and no contributors when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')))

    const result = await fetchGitHubData(REPO, { useCache: false })

    expect(result.stars).toBeNull()
    expect(result.contributors).toEqual([])
    expect(result.extraContributors).toBe(0)
  })

  it('keeps the stars when only the contributors request throws', async () => {
    playbackFetch(json({ stargazers_count: 7 }), new Error('rate limit'))

    const result = await fetchGitHubData(REPO, { useCache: false })

    expect(result.stars).toBe(7)
    expect(result.contributors).toEqual([])
  })

  it('yields null stars on a non-ok /repos response', async () => {
    playbackFetch(new Response('not found', { status: 404 }), json([]))

    const result = await fetchGitHubData(REPO, { useCache: false })
    expect(result.stars).toBeNull()
  })

  it('yields no contributors on a non-ok /contributors response', async () => {
    playbackFetch(json({ stargazers_count: 3 }), new Response('rate limited', { status: 403 }))

    const result = await fetchGitHubData(REPO, { useCache: false })
    expect(result.stars).toBe(3)
    expect(result.contributors).toEqual([])
    expect(result.extraContributors).toBe(0)
  })

  it('rejects a non-numeric stargazers_count as null', async () => {
    playbackFetch(json({ stargazers_count: 'oops' }), json([]))

    const result = await fetchGitHubData(REPO, { useCache: false })
    expect(result.stars).toBeNull()
  })
})

describe('fetchGitHubData disk cache', () => {
  const cachePath = '.cache/github.json'
  let sandbox: string
  let previousCwd: string

  beforeEach(() => {
    vi.restoreAllMocks()
    sandbox = mkdtempSync(join(tmpdir(), 'loklm-gh-cache-'))
    previousCwd = process.cwd()
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(previousCwd)
    rmSync(sandbox, { recursive: true, force: true })
  })

  const seedCache = (fetchedAt: number, data: GitHubData) => {
    mkdirSync('.cache', { recursive: true })
    writeFileSync(cachePath, JSON.stringify({ fetchedAt, data }))
  }

  it('persists successful results to the cache file', async () => {
    playbackFetch(
      json({ stargazers_count: 9 }),
      json([{ login: 'alice', avatar_url: 'a', html_url: 'a', contributions: 1 }]),
    )

    await fetchGitHubData(REPO, { useCache: true, cachePath })

    const stored = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
      fetchedAt: number
      data: GitHubData
    }
    expect(stored.data.stars).toBe(9)
    expect(stored.data.contributors[0]?.login).toBe('alice')
    expect(stored.fetchedAt).toBeGreaterThan(0)
  })

  it('serves a fresh cache entry without touching the network', async () => {
    const cached: GitHubData = {
      stars: 42,
      contributors: [{ login: 'cached', avatarUrl: 'x', profileUrl: 'y' }],
      extraContributors: 0,
    }
    seedCache(Date.now(), cached)

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchGitHubData(REPO, {
      useCache: true,
      cachePath,
      cacheTtlMs: 1000 * 60,
    })

    expect(result).toEqual(cached)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('discards an expired entry and hits the network again', async () => {
    // entry written an hour ago, but ttl is 60ms => stale
    seedCache(Date.now() - 1000 * 60 * 60, { stars: 1, contributors: [], extraContributors: 0 })

    playbackFetch(json({ stargazers_count: 99 }), json([]))

    const result = await fetchGitHubData(REPO, {
      useCache: true,
      cachePath,
      cacheTtlMs: 60,
    })

    expect(result.stars).toBe(99)
  })

  it('falls back to fetching when the cache file is not valid JSON', async () => {
    mkdirSync('.cache', { recursive: true })
    writeFileSync(cachePath, 'this is not json {')

    playbackFetch(json({ stargazers_count: 7 }), json([]))

    const result = await fetchGitHubData(REPO, { useCache: true, cachePath })
    expect(result.stars).toBe(7)
  })

  it('leaves no cache file behind when every request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await fetchGitHubData(REPO, { useCache: true, cachePath })

    // an all-error result carries no data worth persisting
    expect(() => readFileSync(cachePath, 'utf-8')).toThrow()
  })
})
