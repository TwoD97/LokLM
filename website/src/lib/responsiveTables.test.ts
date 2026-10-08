import { beforeAll, describe, expect, it } from 'vitest'
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri'
import { responsiveTables } from './responsiveTables'

let renderer: Awaited<ReturnType<typeof createSatteriMarkdownProcessor>>
const table =
  '| Column A | Column B | Column C |\n| --- | --- | --- |\n| Alpha | **Beta** | [Gamma](/blog) |'

beforeAll(async () => {
  renderer = await createSatteriMarkdownProcessor({
    syntaxHighlight: false,
    hastPlugins: [responsiveTables],
  })
})

describe('server-rendered responsive Markdown tables', () => {
  it.each([
    ['de', 'Tabelle: bei Bedarf horizontal scrollen'],
    ['en', 'Table: scroll horizontally if needed'],
  ])('names the keyboard region in %s and retains exact table structure', async (lang, label) => {
    const baseline = await createSatteriMarkdownProcessor({ syntaxHighlight: false })
    const original = await baseline.render(table)
    const { code } = await renderer.render(table, { frontmatter: { lang } })
    const region = code.match(/<div ([^>]*)>([\s\S]*)<\/div>/)
    expect(region).not.toBeNull()
    expect(region![1]).toContain('class="responsive-table"')
    expect(region![1]).toContain('role="region"')
    expect(region![1]).toContain('tabindex="0"')
    expect(region![1]).toContain(`aria-label="${label}"`)
    expect(region![2].trim()).toBe(original.code.trim())
    expect(code).toContain('<thead>')
    expect(code.match(/<th>/g)).toHaveLength(3)
    expect(code).toContain('<strong>Beta</strong>')
    expect(code).toContain('<a href="/blog">Gamma</a>')
  })

  it('leaves prose and code examples untouched, without empty scroll regions', async () => {
    const markdown =
      '## Heading\n\nParagraph with **emphasis**.\n\n```html\n<table><tr><td>Code only</td></tr></table>\n```'
    const baseline = await createSatteriMarkdownProcessor({ syntaxHighlight: false })
    const original = await baseline.render(markdown)
    const rendered = await renderer.render(markdown)
    expect(rendered).toEqual(original)
    expect(rendered.code).not.toContain('responsive-table')
  })

  it('wraps every table independently, including a table inside a blockquote', async () => {
    const markdown = `${table}\n\nMiddle paragraph.\n\n${table
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`
    const { code } = await renderer.render(markdown, { frontmatter: { lang: 'en' } })
    expect(code.match(/class="responsive-table"/g)).toHaveLength(2)
    expect(code.match(/<table>/g)).toHaveLength(2)
    expect(code.match(/<thead>/g)).toHaveLength(2)
    expect(code).toMatch(/<blockquote>\s*<div class="responsive-table"/)
    expect(code).toContain('<p>Middle paragraph.</p>')
  })

  it('does not add nested regions when the plugin is registered twice', async () => {
    const repeated = await createSatteriMarkdownProcessor({
      syntaxHighlight: false,
      hastPlugins: [responsiveTables, responsiveTables],
    })
    const { code } = await repeated.render(table, { frontmatter: { lang: 'de' } })
    expect(code.match(/class="responsive-table"/g)).toHaveLength(1)
    expect(code.match(/<table>/g)).toHaveLength(1)
  })
})
