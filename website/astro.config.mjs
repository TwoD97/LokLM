import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  site: 'https://loklm.com',
  trailingSlash: 'never',
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
