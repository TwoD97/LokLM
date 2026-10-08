import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { APIContext, APIRoute } from 'astro'
import { GET as llms } from '../src/pages/llms.txt'
import { GET as llmsFull } from '../src/pages/llms-full.txt'
import { GET as rssDe } from '../src/pages/blog/rss.xml'
import { GET as rssEn } from '../src/pages/en/blog/rss.xml'
import { GET as markdownDe, getStaticPaths as pathsDe } from '../src/pages/blog/[slug].md'
import { GET as markdownEn, getStaticPaths as pathsEn } from '../src/pages/en/blog/[slug].md'

const content = vi.hoisted(() => ({ getCollection: vi.fn() }))
vi.mock('astro:content', () => content)

function post(id: string, title: string, date: string, draft = false, body?: string) {
  return {
    id,
    data: {
      lang: id.startsWith('de/') ? 'de' : 'en',
      title,
      description: `Description: ${title}`,
      pubDate: new Date(date),
      draft,
      tags: [],
      translationKey: id,
    },
    ...(body === undefined ? {} : { body }),
  }
}

const posts = [
  post('de/older', 'Älterer Beitrag', '2026-01-01', false, 'Original **Inhalt**.'),
  post('en/newer', 'New English post', '2026-03-01', false, 'Original English body.'),
  post('de/draft', 'PRIVATE DRAFT', '2026-04-01', true, 'Unpublished text'),
  post('de/newer', 'Neuer Beitrag', '2026-02-01'),
  post('en/draft', 'PRIVATE EN DRAFT', '2026-05-01', true),
]

function request(route: APIRoute, options: Partial<APIContext> = {}) {
  return route({ site: new URL('https://preview.example/'), ...options } as APIContext)
}

beforeEach(() => content.getCollection.mockResolvedValue(posts))

describe('public discovery endpoints', () => {
  it.each([
    ['concise', llms],
    ['full', llmsFull],
  ] as const)(
    '%s discovery includes both locales and excludes unpublished drafts',
    async (_name, route) => {
      const response = await request(route)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      const body = await response.text()
      expect(body).toContain('https://preview.example/blog/older')
      expect(body).toContain('https://preview.example/en/blog/newer')
      expect(body).not.toContain('PRIVATE')
      expect(body).not.toContain('undefined')
      expect(content.getCollection).toHaveBeenCalledWith('blog')
    },
  )

  it('full discovery preserves original Unicode/Markdown bodies and tolerates absent bodies', async () => {
    const body = await (await request(llmsFull)).text()
    expect(body).toContain('Älterer Beitrag')
    expect(body).toContain('Original **Inhalt**.')
    expect(body).toContain('Original English body.')
    expect(body).toContain('Neuer Beitrag')
    expect(body).not.toContain('Unpublished text')
  })

  it.each([llms, llmsFull])(
    'uses the public site fallback when Astro supplies no site',
    async (route) => {
      const body = await (await route({} as APIContext)).text()
      expect(body).toContain('Site: https://loklm.com')
      expect(body).toContain('https://loklm.com/en/blog/newer')
    },
  )
})

describe('localized RSS and Markdown feeds', () => {
  it.each([
    ['de', rssDe],
    ['en', rssEn],
  ] as const)('RSS %s publishes only that locale and no drafts', async (lang, route) => {
    const response = await request(route)
    const xml = await response.text()
    expect(response.headers.get('content-type')).toContain('xml')
    expect(xml).not.toContain('PRIVATE')
    if (lang === 'de') {
      expect(xml).toContain('<link>https://preview.example/blog/older</link>')
      expect(xml.indexOf('Neuer Beitrag')).toBeLessThan(xml.indexOf('Älterer Beitrag'))
      expect(xml).not.toContain('New English post')
    } else {
      expect(xml).toContain('<link>https://preview.example/en/blog/newer</link>')
      expect(xml).not.toContain('Älterer Beitrag')
    }
  })

  it.each([
    ['de', pathsDe, markdownDe],
    ['en', pathsEn, markdownEn],
  ] as const)(
    'Markdown %s routes exclude drafts and return the original body',
    async (lang, getPaths, route) => {
      const paths = await getPaths({ paginate: vi.fn(), routePattern: '/blog/[slug].md' })
      expect(paths.map((path) => path.params.slug)).toEqual(
        lang === 'de' ? ['newer', 'older'] : ['newer'],
      )
      for (const path of paths) {
        const fixture = path.props!.post as ReturnType<typeof post>
        const response = await request(route, { props: path.props ?? {} })
        expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
        const body = await response.text()
        expect(body).toContain(`# ${fixture.data.title}`)
        expect(body).not.toContain('undefined')
        if (fixture.body) expect(body).toContain(fixture.body)
      }
    },
  )
})
