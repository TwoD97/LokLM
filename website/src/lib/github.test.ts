import { describe, it, expect, vi, beforeEach } from 'vitest'
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
})
