import type { MarkdownSection } from './types'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const SETEXT_UNDERLINE_H1 = /^=+\s*$/
const SETEXT_UNDERLINE_H2 = /^-+\s*$/
const FENCE = /^(\s{0,3})(`{3,}|~{3,})/

/** Strip an optional leading YAML / TOML frontmatter block. Returns the text
 *  without the frontmatter; the frontmatter content itself is discarded since
 *  the indexer doesn't yet use any of it. */
export function stripFrontmatter(text: string): string {
  // Strip BOM first — it would otherwise break the leading-anchor.
  const noBom = text.startsWith('﻿') ? text.slice(1) : text
  const m = FRONTMATTER.exec(noBom)
  return m ? noBom.slice(m[0].length) : noBom
}

/** Parse a markdown string into heading-bounded sections.
 *
 *  Rules:
 *   - YAML frontmatter (`---\\n…\\n---`) is stripped.
 *   - ATX headings (`# Title` … `###### Title`) are honored.
 *   - Setext headings (`Title\\n===`, `Title\\n---`) are honored.
 *   - Headings inside fenced code blocks are ignored — that's where # is most
 *     likely to be a shell prompt or a Python comment.
 *   - Each section's `headingPath` is the breadcrumb from the document root
 *     down to its own heading, e.g. `["1. Intro", "Why MD"]`.
 *   - Content above the first heading is emitted as a preamble section with
 *     `headingPath: []`.
 *   - Sections with empty bodies are NOT emitted (a heading with no content
 *     under it is dead weight for retrieval).
 */
export function parseMarkdownSections(rawText: string): MarkdownSection[] {
  const text = stripFrontmatter(rawText)
  const lines = text.split(/\r?\n/)
  const sections: MarkdownSection[] = []
  /** Stack of {level, heading} pairs that defines the current breadcrumb. */
  const stack: Array<{ level: number; heading: string }> = []
  let body: string[] = []
  let inFence = false
  let fenceMarker = ''

  const flush = (): void => {
    const text = body.join('\n').trim()
    if (text.length === 0) {
      body = []
      return
    }
    sections.push({ headingPath: stack.map((s) => s.heading), text })
    body = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // Fence toggling — track open/close so we don't treat `#` inside code as headings.
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[2]!.slice(0, 3)
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      body.push(line)
      continue
    }
    if (inFence) {
      body.push(line)
      continue
    }

    const atx = ATX_HEADING.exec(line)
    if (atx) {
      flush()
      const level = atx[1]!.length
      const heading = atx[2]!.trim()
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, heading })
      continue
    }

    // Setext: a non-empty line followed by ==== (h1) or ---- (h2).
    const next = lines[i + 1]
    if (next != null && line.trim().length > 0) {
      if (SETEXT_UNDERLINE_H1.test(next)) {
        flush()
        const heading = line.trim()
        while (stack.length > 0 && stack[stack.length - 1]!.level >= 1) stack.pop()
        stack.push({ level: 1, heading })
        i++
        continue
      }
      if (SETEXT_UNDERLINE_H2.test(next) && next.length >= 3) {
        flush()
        const heading = line.trim()
        while (stack.length > 0 && stack[stack.length - 1]!.level >= 2) stack.pop()
        stack.push({ level: 2, heading })
        i++
        continue
      }
    }

    body.push(line)
  }
  flush()
  return sections
}
