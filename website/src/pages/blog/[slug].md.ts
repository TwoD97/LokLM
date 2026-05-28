import { getCollection } from 'astro:content'
import { postsForLang, slugOf } from '~/data/blog'
import type { APIRoute, GetStaticPaths } from 'astro'

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = postsForLang(await getCollection('blog'), 'de')
  return posts.map((post) => ({ params: { slug: slugOf(post) }, props: { post } }))
}

export const GET: APIRoute = ({ props }) => {
  const { post } = props as {
    post: { body?: string; data: { title: string; description: string } }
  }
  const md = `# ${post.data.title}\n\n> ${post.data.description}\n\n${post.body ?? ''}\n`
  return new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
