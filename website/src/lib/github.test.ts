import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchGitHubData, type GitHubData } from './github'

describe('fetchGitHubData', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns stars and contributors when both fetches succeed', async () => {
    const repoResponse = { stargazers_count: 142 }
    const contributorsResponse = [
      {
        login: 'alice',
        avatar_url: 'https://avatars/alice',
        html_url: 'https://github.com/alice',
        contributions: 50,
      },
      {
        login: 'bob',
        avatar_url: 'https://avatars/bob',
        html_url: 'https://github.com/bob',
        contributions: 20,
      },
    ]

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(contributorsResponse), { status: 200 })),
    )

    const result: GitHubData = await fetchGitHubData('TwoD97/LokLM', { useCache: false })

    expect(result.stars).toBe(142)
    expect(result.contributors).toHaveLength(2)
    expect(result.contributors[0]).toEqual({
      login: 'alice',
      avatarUrl: 'https://avatars/alice',
      profileUrl: 'https://github.com/alice',
    })
  })

  it('limits contributors to top 8', async () => {
    const repoResponse = { stargazers_count: 10 }
    const many = Array.from({ length: 15 }, (_, i) => ({
      login: `user${i}`,
      avatar_url: `https://avatars/u${i}`,
      html_url: `https://github.com/user${i}`,
      contributions: 15 - i,
    }))

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(repoResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(many), { status: 200 })),
    )

    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: false })
    expect(result.contributors).toHaveLength(8)
    expect(result.extraContributors).toBe(7)
  })

  it('returns empty contributors and null stars on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')))

    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: false })

    expect(result.stars).toBeNull()
    expect(result.contributors).toEqual([])
    expect(result.extraContributors).toBe(0)
  })

  it('returns empty contributors when contributors fetch fails but stars succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ stargazers_count: 7 }), { status: 200 }),
        )
        .mockRejectedValueOnce(new Error('rate limit')),
    )

    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: false })

    expect(result.stars).toBe(7)
    expect(result.contributors).toEqual([])
  })

  it('returns null stars when /repos endpoint responds with non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(new Response('[]', { status: 200 })),
    )
    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: false })
    expect(result.stars).toBeNull()
  })

  it('returns empty contributors when /contributors endpoint responds with non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ stargazers_count: 3 }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('rate limited', { status: 403 })),
    )
    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: false })
    expect(result.stars).toBe(3)
    expect(result.contributors).toEqual([])
    expect(result.extraContributors).toBe(0)
  })

  it('treats stargazers_count of wrong type as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ stargazers_count: 'oops' }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('[]', { status: 200 })),
    )
    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: false })
    expect(result.stars).toBeNull()
  })
})

describe('fetchGitHubData cache', () => {
  let workDir: string
  let originalCwd: string
  let cachePath: string

  beforeEach(() => {
    vi.restoreAllMocks()
    workDir = mkdtempSync(join(tmpdir(), 'loklm-gh-cache-'))
    originalCwd = process.cwd()
    process.chdir(workDir)
    cachePath = '.cache/github.json'
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(workDir, { recursive: true, force: true })
  })

  it('writes a fresh cache file when useCache is on and fetch succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ stargazers_count: 9 }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                login: 'alice',
                avatar_url: 'a',
                html_url: 'a',
                contributions: 1,
              },
            ]),
            { status: 200 },
          ),
        ),
    )

    await fetchGitHubData('TwoD97/LokLM', { useCache: true, cachePath })

    const raw = readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw) as { fetchedAt: number; data: GitHubData }
    expect(parsed.data.stars).toBe(9)
    expect(parsed.data.contributors[0]?.login).toBe('alice')
    expect(parsed.fetchedAt).toBeGreaterThan(0)
  })

  it('reads from cache and skips fetch when within TTL', async () => {
    const cached: GitHubData = {
      stars: 42,
      contributors: [{ login: 'cached', avatarUrl: 'x', profileUrl: 'y' }],
      extraContributors: 0,
    }
    mkdirSync('.cache', { recursive: true })
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), data: cached }))

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchGitHubData('TwoD97/LokLM', {
      useCache: true,
      cachePath,
      cacheTtlMs: 1000 * 60,
    })

    expect(result).toEqual(cached)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('ignores stale cache (older than ttl) and re-fetches', async () => {
    const stale: GitHubData = {
      stars: 1,
      contributors: [],
      extraContributors: 0,
    }
    mkdirSync('.cache', { recursive: true })
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: Date.now() - 1000 * 60 * 60, data: stale }),
    )

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ stargazers_count: 99 }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('[]', { status: 200 })),
    )

    const result = await fetchGitHubData('TwoD97/LokLM', {
      useCache: true,
      cachePath,
      cacheTtlMs: 60, // 60ms — older entry is stale
    })

    expect(result.stars).toBe(99)
  })

  it('treats a corrupted cache file as no-cache and re-fetches', async () => {
    mkdirSync('.cache', { recursive: true })
    writeFileSync(cachePath, 'this is not json {')

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ stargazers_count: 7 }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('[]', { status: 200 })),
    )

    const result = await fetchGitHubData('TwoD97/LokLM', { useCache: true, cachePath })
    expect(result.stars).toBe(7)
  })

  it('does not write cache when both fetches fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await fetchGitHubData('TwoD97/LokLM', { useCache: true, cachePath })

    // cache path should not exist since nothing was worth saving
    expect(() => readFileSync(cachePath, 'utf-8')).toThrow()
  })
})
