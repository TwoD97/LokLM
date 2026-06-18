import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { buildLlmsFullTxt, type LlmsFullPost } from '~/data/llms'
import { postsForLang, slugOf } from '~/data/blog'

export const GET: APIRoute = async ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, '') ?? 'https://loklm.com'
  const all = await getCollection('blog')

  const posts: LlmsFullPost[] = (['de', 'en'] as const).flatMap((lang) => {
    const base = lang === 'de' ? '/blog' : '/en/blog'
    return postsForLang(all, lang).map((p) => ({
      title: p.data.title,
      description: p.data.description,
      url: `${siteUrl}${base}/${slugOf(p)}`,
      lang,
      date: p.data.pubDate.toISOString().slice(0, 10),
      body: p.body ?? '',
    }))
  })

  return new Response(buildLlmsFullTxt(siteUrl, posts), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
