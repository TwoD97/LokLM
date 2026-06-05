import { describe, it, expect } from 'vitest'
import { postsForLang, slugOf, tagsForLang, translationSlug, type BlogLike } from './blog'

const posts: BlogLike[] = [
  {
    id: 'de/willkommen',
    data: {
      lang: 'de',
      translationKey: 'welcome',
      pubDate: new Date('2026-05-01'),
      tags: ['lokale-ki'],
      draft: false,
    },
  },
  {
    id: 'en/welcome',
    data: {
      lang: 'en',
      translationKey: 'welcome',
      pubDate: new Date('2026-05-01'),
      tags: ['local-ai'],
      draft: false,
    },
  },
  {
    id: 'de/neuer',
    data: {
      lang: 'de',
      translationKey: 'newer',
      pubDate: new Date('2026-06-01'),
      tags: ['lokale-ki'],
      draft: false,
    },
  },
  {
    id: 'de/entwurf',
    data: {
      lang: 'de',
      translationKey: 'draft',
      pubDate: new Date('2026-07-01'),
      tags: [],
      draft: true,
    },
  },
]

describe('blog helpers', () => {
  it('slugOf strips the lang prefix', () => {
    expect(slugOf(posts[0])).toBe('willkommen')
    expect(slugOf(posts[1])).toBe('welcome')
  })

  it('postsForLang filters by lang, drops drafts, sorts newest first', () => {
    expect(postsForLang(posts, 'de').map((p) => p.id)).toEqual(['de/neuer', 'de/willkommen'])
  })

  it('tagsForLang returns unique tags for the locale', () => {
    expect(tagsForLang(posts, 'de')).toEqual(['lokale-ki'])
    expect(tagsForLang(posts, 'en')).toEqual(['local-ai'])
  })

  it('translationSlug finds the paired slug in the other locale', () => {
    expect(translationSlug(posts, posts[0], 'en')).toBe('welcome')
    expect(translationSlug(posts, posts[2], 'en')).toBeUndefined()
  })
})
