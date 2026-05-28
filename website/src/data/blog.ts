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
