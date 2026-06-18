export interface BlogLike {
  id: string
  data: {
    lang: 'de' | 'en'
    translationKey: string
    pubDate: Date
    tags: string[]
    draft: boolean
  }
}

export function slugOf(post: { id: string }): string {
  return post.id.split('/').slice(1).join('/')
}

export function postsForLang<T extends BlogLike>(all: T[], lang: 'de' | 'en'): T[] {
  return all
    .filter((p) => p.data.lang === lang && !p.data.draft)
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
}

export function tagsForLang(all: BlogLike[], lang: 'de' | 'en'): string[] {
  const set = new Set<string>()
  for (const p of postsForLang(all, lang)) for (const t of p.data.tags) set.add(t)
  return [...set].sort()
}

export function translationSlug(
  all: BlogLike[],
  post: BlogLike,
  otherLang: 'de' | 'en',
): string | undefined {
  const match = all.find(
    (p) => p.data.lang === otherLang && p.data.translationKey === post.data.translationKey,
  )
  return match ? slugOf(match) : undefined
}

// Rough reading time. Strips markdown syntax to a word count and divides by an
// average reading speed; always at least one minute so the label is never "0".
export function readingTimeMinutes(markdown: string, wordsPerMinute = 220): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images -> their label
    .replace(/[#>*_~`|-]/g, ' ') // residual markdown punctuation
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / wordsPerMinute))
}

// Walks the date-sorted (newest-first) list and returns the neighbours of a
// post for prev/next navigation. `newer` is the more recent post, `older` the
// next one back in time.
export function adjacentPosts<T extends BlogLike>(
  sorted: T[],
  post: { id: string },
): { newer?: T; older?: T } {
  const i = sorted.findIndex((p) => p.id === post.id)
  if (i === -1) return {}
  return { newer: i > 0 ? sorted[i - 1] : undefined, older: sorted[i + 1] }
}
