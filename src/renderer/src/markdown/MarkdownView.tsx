import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'

// Shared remark + rehype config so chat answers, the source viewer and the
// document preview all render markdown the same way. KaTeX/highlight.js
// stylesheets are loaded once globally in main.tsx; the plugin list lives here
// as a single module-level constant so we don't re-allocate the arrays on
// every render and React-Markdown can short-circuit identity checks.
//
// `components` lets MessageBubble override the `a` element with CitationChip
// without forking the renderer.
const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [
  rehypeKatex,
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
] as const

export function MarkdownView({
  children,
  components,
}: {
  children: string
  components?: Components
}): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      // The const-tuple isn't structurally assignable to the mutable array
      // ReactMarkdown declares; a single cast keeps the runtime value frozen.
      rehypePlugins={
        REHYPE_PLUGINS as unknown as React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']
      }
      components={components}
    >
      {children}
    </ReactMarkdown>
  )
}
