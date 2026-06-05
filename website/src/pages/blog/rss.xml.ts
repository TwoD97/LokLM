import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import { postsForLang, slugOf } from '~/data/blog'
import type { APIRoute } from 'astro'

export const GET: APIRoute = async (context) => {
  const posts = postsForLang(await getCollection('blog'), 'de')
  return rss({
    title: 'LokLM Blog',
    description: 'Beiträge zu lokaler KI, Datenschutz und Retrieval.',
    site: context.site!.toString(),
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `/blog/${slugOf(p)}`,
    })),
  })
}
