import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { satteri } from '@astrojs/markdown-satteri'
import { responsiveTables } from './src/lib/responsiveTables'

export default defineConfig({
  site: 'https://loklm.com',
  trailingSlash: 'never',
  // Keep spaces between inline elements when upgrading the Astro compiler.
  compressHTML: true,
  markdown: {
    processor: satteri({ hastPlugins: [responsiveTables] }),
  },
  build: {
    assets: 'assets',
    inlineStylesheets: 'always',
  },
  i18n: {
    defaultLocale: 'de',
    locales: ['de', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      // Blog tag pages are filtered, noindex views — keep them out of the
      // sitemap so they never compete with the canonical post URLs.
      filter: (page) => !/\/blog\/tag\//.test(page),
      i18n: {
        defaultLocale: 'de',
        locales: {
          de: 'de-DE',
          en: 'en-US',
        },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
