/** Preserve source characters while keeping source-authored Markdown/HTML and
 * citation syntax inert. Bare HTTP/mailto text retains ordinary GFM link policy. */
export function escapeSourceMarkdown(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/[\\`*_[\]{}()#!|~+\-.$:@]/g, '\\$&')
      // Decode indentation after block parsing so blank-line + four spaces/tab
      // cannot make escaped source text an indented code block with visible slashes.
      .split(/\r\n|\r|\n/u)
      .map((line) =>
        line.replace(/^[ \t]+/u, (indent) =>
          [...indent].map((character) => (character === '\t' ? '&#9;' : '&#32;')).join(''),
        ),
      )
      .join('\n')
  )
}

/** Caller attaches validated citation markers outside this literal quotation. */
export function sourceQuoteMarkdown(text: string): string {
  return escapeSourceMarkdown(text)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
