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

function entry(
  id: string,
  translationKey: string,
  pubDate: string,
  tags: string[],
  draft = false,
): BlogLike {
  const lang = id.startsWith('en/') ? 'en' : 'de'
  return { id, data: { lang, translationKey, pubDate: new Date(pubDate), tags, draft } }
}

// Small fixture library: a DE/EN translation pair, a newer DE-only post,
// and one draft that must never surface anywhere.
const library: BlogLike[] = [
  entry('de/willkommen', 'welcome', '2026-05-01', ['lokale-ki']),
  entry('en/welcome', 'welcome', '2026-05-01', ['local-ai']),
  entry('de/neuer', 'newer', '2026-06-01', ['lokale-ki']),
  entry('de/entwurf', 'draft', '2026-07-01', [], true),
]

describe('collection helpers', () => {
  it('slugOf drops the locale folder from the entry id', () => {
    expect(slugOf(library[0])).toBe('willkommen')
    expect(slugOf(library[1])).toBe('welcome')
  })

  it('postsForLang keeps only the locale, excludes drafts, orders newest-first', () => {
    expect(postsForLang(library, 'de').map((p) => p.id)).toEqual(['de/neuer', 'de/willkommen'])
  })

  it('tagsForLang deduplicates tags per locale', () => {
    expect(tagsForLang(library, 'de')).toEqual(['lokale-ki'])
    expect(tagsForLang(library, 'en')).toEqual(['local-ai'])
  })

  it('translationSlug resolves the counterpart slug, or undefined without a pair', () => {
    expect(translationSlug(library, library[0], 'en')).toBe('welcome')
    expect(translationSlug(library, library[2], 'en')).toBeUndefined()
  })
})

describe('readingTimeMinutes', () => {
  it('never reports less than one minute', () => {
    expect(readingTimeMinutes('a few words only')).toBe(1)
  })

  it('grows linearly with the word count at the requested wpm', () => {
    const twoMinutes = Array.from({ length: 440 }, () => 'word').join(' ')
    expect(readingTimeMinutes(twoMinutes, 220)).toBe(2)
  })

  it('does not count fenced code blocks or markdown syntax as words', () => {
    const markdown = '# Heading\n\n```\nconst x = 1\nconst y = 2\n```\n\nreal words here'
    const stripped = 'Heading real words here'
    expect(readingTimeMinutes(markdown)).toBe(readingTimeMinutes(stripped))
  })
})

describe('adjacentPosts', () => {
  // newest-first: ['de/neuer', 'de/willkommen']
  const timeline = postsForLang(library, 'de')

  it('the newest post has only an older neighbour', () => {
    const { newer, older } = adjacentPosts(timeline, { id: 'de/neuer' })
    expect(newer).toBeUndefined()
    expect(older?.id).toBe('de/willkommen')
  })

  it('the oldest post has only a newer neighbour', () => {
    const { newer, older } = adjacentPosts(timeline, { id: 'de/willkommen' })
    expect(newer?.id).toBe('de/neuer')
    expect(older).toBeUndefined()
  })

  it('an id outside the list yields no neighbours at all', () => {
    expect(adjacentPosts(timeline, { id: 'nope' })).toEqual({})
  })
})
