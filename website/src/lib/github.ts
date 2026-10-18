// build-time github fetcher — wird im astro-template aufgerufen.
// caching gegen `.cache/github.json` damit dev nicht ständig die api hämmert.
// graceful fallback , falls fetch fehlschlägt , liefern wir null/empty.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
  requestTimeoutMs?: number
}

const DEFAULT_CACHE_PATH = '.cache/github.json'
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6
const TOP_CONTRIBUTORS = 8
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

export async function fetchGitHubData(
  repo: string,
  options: FetchOptions = {},
): Promise<GitHubData> {
  const {
    useCache = true,
    cachePath = DEFAULT_CACHE_PATH,
    cacheTtlMs = DEFAULT_TTL_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = options

  if (useCache) {
    const cached = readCache(cachePath, cacheTtlMs, repo)
    if (cached) return cached
  }

  const data = await fetchFresh(repo, requestTimeoutMs)

  if (useCache && (data.stars !== null || data.contributors.length > 0)) {
    writeCache(cachePath, repo, data)
  }

  return data
}

async function fetchFresh(repo: string, timeoutMs: number): Promise<GitHubData> {
  const [stars, { contributors, extraContributors }] = await Promise.all([
    fetchStars(repo, timeoutMs),
    fetchContributors(repo, timeoutMs),
  ])
  return { stars, contributors, extraContributors }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      return null
    }
    // Keep the deadline active while reading the body, not just its headers.
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchStars(repo: string, timeoutMs: number): Promise<number | null> {
  try {
    const body = await fetchJson(`https://api.github.com/repos/${repo}`, timeoutMs)
    if (!isRecord(body)) return null
    return isCount(body.stargazers_count) ? body.stargazers_count : null
  } catch {
    return null
  }
}

async function fetchContributors(
  repo: string,
  timeoutMs: number,
): Promise<{ contributors: Contributor[]; extraContributors: number }> {
  try {
    const body = await fetchJson(
      `https://api.github.com/repos/${repo}/contributors?per_page=100`,
      timeoutMs,
    )
    if (!Array.isArray(body)) return { contributors: [], extraContributors: 0 }
    const raw = body.filter(
      (value): value is RawContributor =>
        isRecord(value) &&
        typeof value.login === 'string' &&
        typeof value.avatar_url === 'string' &&
        typeof value.html_url === 'string',
    )
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isGitHubData(value: unknown): value is GitHubData {
  return (
    isRecord(value) &&
    (value.stars === null || isCount(value.stars)) &&
    isCount(value.extraContributors) &&
    Array.isArray(value.contributors) &&
    value.contributors.every(
      (person: unknown) =>
        isRecord(person) &&
        typeof person.login === 'string' &&
        typeof person.avatarUrl === 'string' &&
        typeof person.profileUrl === 'string',
    )
  )
}

function readCache(path: string, ttlMs: number, repo: string): GitHubData | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.repo !== repo || !isCount(parsed.fetchedAt)) return null
    const age = Date.now() - parsed.fetchedAt
    if (age < 0 || age > ttlMs || !isGitHubData(parsed.data)) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(path: string, repo: string, data: GitHubData): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ repo, fetchedAt: Date.now(), data }, null, 2))
  } catch {
    /* swallow — caching is best-effort */
  }
}
