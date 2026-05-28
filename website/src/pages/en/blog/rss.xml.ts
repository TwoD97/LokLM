import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import { postsForLang, slugOf } from '~/data/blog'
import type { APIRoute } from 'astro'

export const GET: APIRoute = async (context) => {
  const posts = postsForLang(await getCollection('blog'), 'en')
  return rss({
    title: 'LokLM Blog',
    description: 'Posts on local AI, privacy, and retrieval.',
    site: context.site!.toString(),
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `/en/blog/${slugOf(p)}`,
    })),
  })
}
