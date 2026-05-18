// build-time github fetcher — wird im astro-template aufgerufen.
// caching gegen `.cache/github.json` damit dev nicht ständig die api hämmert.
// graceful fallback , falls fetch fehlschlägt , liefern wir null/empty.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface Contributor {
  login: string
  avatarUrl: string
  profileUrl: string
}

export interface GitHubData {
  stars: number | null
  contributors: Contributor[]
  extraContributors: number
}

interface RawContributor {
  login: string
  avatar_url: string
  html_url: string
  contributions: number
}

interface FetchOptions {
  useCache?: boolean
  cachePath?: string
  cacheTtlMs?: number
}

const DEFAULT_CACHE_PATH = '.cache/github.json'
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6
const TOP_CONTRIBUTORS = 8

export async function fetchGitHubData(
  repo: string,
  options: FetchOptions = {},
): Promise<GitHubData> {
  const { useCache = true, cachePath = DEFAULT_CACHE_PATH, cacheTtlMs = DEFAULT_TTL_MS } = options

  if (useCache) {
    const cached = readCache(cachePath, cacheTtlMs)
    if (cached) return cached
  }

  const data = await fetchFresh(repo)

  if (useCache && (data.stars !== null || data.contributors.length > 0)) {
    writeCache(cachePath, data)
  }

  return data
}

async function fetchFresh(repo: string): Promise<GitHubData> {
  const stars = await fetchStars(repo)
  const { contributors, extraContributors } = await fetchContributors(repo)
  return { stars, contributors, extraContributors }
}

async function fetchStars(repo: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { stargazers_count?: number }
    return typeof body.stargazers_count === 'number' ? body.stargazers_count : null
  } catch {
    return null
  }
}

async function fetchContributors(
  repo: string,
): Promise<{ contributors: Contributor[]; extraContributors: number }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contributors?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return { contributors: [], extraContributors: 0 }
    const raw = (await res.json()) as RawContributor[]
    const top = raw.slice(0, TOP_CONTRIBUTORS).map((c) => ({
      login: c.login,
      avatarUrl: c.avatar_url,
      profileUrl: c.html_url,
    }))
    return {
      contributors: top,
      extraContributors: Math.max(0, raw.length - TOP_CONTRIBUTORS),
    }
  } catch {
    return { contributors: [], extraContributors: 0 }
  }
}

interface CacheFile {
  fetchedAt: number
  data: GitHubData
}

function readCache(path: string, ttlMs: number): GitHubData | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as CacheFile
    if (Date.now() - parsed.fetchedAt > ttlMs) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(path: string, data: GitHubData): void {
  try {
    mkdirSync(dirname(join(process.cwd(), path)), { recursive: true })
    writeFileSync(path, JSON.stringify({ fetchedAt: Date.now(), data }, null, 2))
  } catch {
    /* swallow — caching is best-effort */
  }
}
