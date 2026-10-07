import type { SatteriProcessorOptions } from '@astrojs/markdown-satteri'

type HastPlugin = Extract<
  NonNullable<SatteriProcessorOptions['hastPlugins']>[number],
  { name: string }
>

// Keep the table/headers/cells intact; only the surrounding region scrolls.
// This runs during Markdown rendering, so keyboard access does not need JS.
export const responsiveTables: HastPlugin = {
  name: 'responsive-tables',
  element: {
    filter: ['table'],
    visit(node, context) {
      const parent = context.parent(node)
      const classes = parent.type === 'element' ? parent.properties.className : undefined
      if (Array.isArray(classes) && classes.includes('responsive-table')) return

      context.wrapNode(node, {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['responsive-table'],
          role: 'region',
          tabIndex: 0,
          ariaLabel:
            context.data.astro?.frontmatter.lang === 'en'
              ? 'Table: scroll horizontally if needed'
              : 'Tabelle: bei Bedarf horizontal scrollen',
        },
        children: [],
      })
    },
  },
}
