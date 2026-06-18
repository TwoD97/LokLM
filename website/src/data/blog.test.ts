import { describe, it, expect } from 'vitest'
import {
  postsForLang,
  slugOf,
  tagsForLang,
  translationSlug,
  readingTimeMinutes,
  adjacentPosts,
  type BlogLike,
} from './blog'

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

describe('readingTimeMinutes', () => {
  it('returns at least one minute for short text', () => {
    expect(readingTimeMinutes('a few words only')).toBe(1)
  })

  it('scales with word count at the given speed', () => {
    const text = Array.from({ length: 440 }, () => 'word').join(' ')
    expect(readingTimeMinutes(text, 220)).toBe(2)
  })

  it('ignores fenced code and markdown punctuation', () => {
    const withCode = '# Heading\n\n```\nconst x = 1\nconst y = 2\n```\n\nreal words here'
    const plain = 'Heading real words here'
    expect(readingTimeMinutes(withCode)).toBe(readingTimeMinutes(plain))
  })
})

describe('adjacentPosts', () => {
  const sorted = postsForLang(posts, 'de') // ['de/neuer', 'de/willkommen']

  it('returns the newer and older neighbours', () => {
    const { newer, older } = adjacentPosts(sorted, { id: 'de/neuer' })
    expect(newer).toBeUndefined()
    expect(older?.id).toBe('de/willkommen')
  })

  it('returns the newer neighbour for the oldest post', () => {
    const { newer, older } = adjacentPosts(sorted, { id: 'de/willkommen' })
    expect(newer?.id).toBe('de/neuer')
    expect(older).toBeUndefined()
  })

  it('returns empty for an unknown post', () => {
    expect(adjacentPosts(sorted, { id: 'nope' })).toEqual({})
  })
})
