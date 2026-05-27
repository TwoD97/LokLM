import type { APIRoute } from 'astro'
import { buildLlmsTxt } from '~/data/llms'

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString() ?? 'https://loklm.com'
  return new Response(buildLlmsTxt(siteUrl), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
