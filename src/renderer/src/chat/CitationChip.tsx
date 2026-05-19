import type { ComponentProps } from 'react'
import { parseCiteHref } from '@shared/citationMarkers'

type Props = ComponentProps<'a'> & {
  onCitationClick: (m: { documentId: number; chunkId: number }) => void
}

export function CitationChip({ href, children, onCitationClick, ...rest }: Props): JSX.Element {
  const marker = parseCiteHref(href)
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
