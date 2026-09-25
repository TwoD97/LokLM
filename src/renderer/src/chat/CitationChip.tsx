import type { ComponentProps } from 'react'
import { parseCiteHref } from '@shared/citationMarkers'

type Props = ComponentProps<'a'> & {
  allowedKeys: ReadonlySet<string>
  onCitationClick: (m: { documentId: number; chunkId: number }) => void
}

export function CitationChip({
  href,
  children,
  allowedKeys,
  onCitationClick,
  ...rest
}: Props): JSX.Element {
  const marker = parseCiteHref(href)
  // Raw Markdown can contain #cite links too. The final anchor renderer must
  // enforce membership even when a link bypasses marker transformation.
  if (
    href?.startsWith('#cite-') &&
    (!marker || !allowedKeys.has(`${marker.documentId}-${marker.chunkId}`))
  ) {
    return <span>{children}</span>
  }
  if (!marker) {
    return (
      <a href={href} {...rest} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  return (
    <a
      href={href}
      className="citation-chip"
      onClick={(e) => {
        e.preventDefault()
        onCitationClick(marker)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}
