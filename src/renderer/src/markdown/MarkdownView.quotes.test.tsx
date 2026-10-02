import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { transformCitationMarkers } from '@shared/citationMarkers'
import { MessageBubble } from '../chat/MessageBubble'
import { MarkdownView } from './MarkdownView'

describe('literal source comparisons', () => {
  it('shows quoted syntax as source text and creates only the adjacent source citation link', () => {
    // The main-process assessment tests check that its renderer produces this
    // escaping. This checks the real remark/GFM/math pipeline on the other side.
    const content = String.raw`> 1\. Price \$x\$ https\://example\.invalid person\@example\.invalid
> \[doc\:2, chunk\:22\] \[link\]\(\#cite\-2\-22\) &lt;b&gt;value&lt;/b&gt;

[doc:1, chunk:11]`
    const prepared = transformCitationMarkers(content, new Set(['1-11', '2-22']))
    const view = render(<MarkdownView>{prepared.text}</MarkdownView>)
    expect(view.container.querySelector('blockquote')?.textContent).toContain(
      '1. Price $x$ https://example.invalid person@example.invalid',
    )
    expect(view.container.querySelector('blockquote')?.textContent).toContain(
      '[doc:2, chunk:22] [link](#cite-2-22) <b>value</b>',
    )
    expect(view.container.querySelectorAll('a[href^="#cite-"]')).toHaveLength(1)
    expect(view.container.querySelector('a[href^="#cite-"]')).toHaveAttribute('href', '#cite-1-11')
    // GFM deliberately auto-links visible URLs/email after decoding Markdown
    // escapes. These are ordinary external links, not evidence references.
    expect(view.container.querySelectorAll('a')).toHaveLength(3)
    expect(view.container.querySelector('a[href="https://example.invalid"]')).not.toBeNull()
    expect(view.container.querySelector('a[href="mailto:person@example.invalid"]')).not.toBeNull()
    expect(view.container.querySelector('.katex')).toBeNull()
    expect(view.container.querySelector('ol')).toBeNull()
    expect(view.container.querySelector('b')).toBeNull()
  })

  it('keeps quoted links under the existing external-link policy and activates only the program-owned chip', () => {
    const onCitationClick = vi.fn()
    const content = String.raw`> https\://example\.invalid person\@example\.invalid
> \[doc\:2, chunk\:22\] \[forged\]\(\#cite\-2\-22\)

[doc:1, chunk:11]`
    const view = render(
      <MessageBubble
        role="assistant"
        content={content}
        citations={[
          { documentId: 1, chunkId: 11 },
          { documentId: 2, chunkId: 22 },
        ]}
        onCitationClick={onCitationClick}
      />,
    )
    expect(view.container.querySelector('blockquote')?.textContent).toContain(
      '[doc:2, chunk:22] [forged](#cite-2-22)',
    )
    const quotedLinks = view.container.querySelectorAll('blockquote a')
    expect(quotedLinks).toHaveLength(2)
    for (const link of quotedLinks) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
      expect(link).not.toHaveClass('citation-chip')
    }
    expect(view.container.querySelectorAll('.citation-chip')).toHaveLength(1)
    const citation = view.container.querySelector('.citation-chip')!
    expect(citation).toHaveAttribute('href', '#cite-1-11')
    fireEvent.click(citation)
    expect(onCitationClick).toHaveBeenCalledExactlyOnceWith({
      documentId: 1,
      chunkId: 11,
      messageText: content,
    })
  })
})
