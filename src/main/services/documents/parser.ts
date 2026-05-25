import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { ImportError, type ParsedDocument, type PageText, type PdfSection } from './types'
import { parseMarkdownSections, stripFrontmatter } from './markdownParser'

// extension whitelist — verbatim from MVP (Notebook-LoLM). .docx is handled
// separately (mammoth → markdown). Legacy .doc (binary OOXML predecessor) is
// intentionally NOT supported: mammoth doesn't read it and we don't want to
// pretend by silently producing empty text.
const TEXT_EXTS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.rst',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.sh',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.xml',
])

export { ImportError }

export function isSupported(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ext === '.pdf' || ext === '.docx' || TEXT_EXTS.has(ext)
}

export async function parseFile(filePath: string): Promise<ParsedDocument> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.pdf') return parsePdf(filePath)
  if (ext === '.docx') return parseDocx(filePath)
  if (ext === '.md' || ext === '.markdown') return parseMarkdown(filePath)
  if (TEXT_EXTS.has(ext)) return parsePlainText(filePath)
  throw new ImportError(`Unsupported file type: ${basename(filePath)}`, 'unsupported', filePath)
}

async function parsePlainText(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, 'utf-8')
  // Strip UTF-8 BOM — keeping it makes the first chunk start with ﻿,
  // which then bleeds into embeddings and preview text. parseMarkdown already
  // does this via stripFrontmatter; .txt files went without.
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw
  return {
    kind: 'text',
    pages: [{ num: 1, text }],
    fullText: text,
  }
}

async function parseMarkdown(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, 'utf-8')
  const sections = parseMarkdownSections(raw)
  // fullText / pages remain populated (with frontmatter stripped) so callers
  // that don't care about structure (e.g. full-text export) still work.
  const fullText = stripFrontmatter(raw)
  return {
    kind: 'markdown',
    sections,
    pages: [{ num: 1, text: fullText }],
    fullText,
  }
}

async function parseDocx(filePath: string): Promise<ParsedDocument> {
  // mammoth converts .docx (OOXML) → markdown with Heading 1/2/3 styles
  // mapped to #/##/###. We then feed the markdown through the same
  // section-aware pipeline markdown files use, so DOCX chunks inherit
  // heading-breadcrumb citations and the existing markdown preview branch.
  const mammoth = (await import('mammoth')) as unknown as {
    convertToMarkdown: (
      input: { buffer: Buffer } | { path: string },
    ) => Promise<{ value: string; messages: { type: string; message: string }[] }>
  }
  // Pass {path} so mammoth streams the zip itself — saves the full-buffer copy
  // we used to make with readFile() before handing it back over.
  const { value: rawMarkdown, messages } = await mammoth.convertToMarkdown({ path: filePath })
  if (messages.length > 0) {
    // mammoth warns about unsupported styles, dropped elements, etc. Log
    // them so they're discoverable without surfacing them to the user.
    // eslint-disable-next-line no-console
    console.warn(
      `[documents] mammoth produced ${messages.length} message(s) for ${basename(filePath)}`,
    )
  }
  // Strip image refs + collapse 3+ newlines in a single pass — was two
  // sequential .replace calls each re-scanning the whole markdown buffer.
  const markdown = rawMarkdown.replace(/!\[[^\]]*\]\([^)]*\)|\n{3,}/g, (m) =>
    m.startsWith('!') ? '' : '\n\n',
  )
  const sections = parseMarkdownSections(markdown)
  const fullText = stripFrontmatter(markdown)
  return {
    kind: 'markdown',
    sections,
    pages: [{ num: 1, text: fullText }],
    fullText,
  }
}

/** Minimal slice of pdf-parse's static surface we touch for worker config. */
interface PdfParseStatic {
  new (opts: { data: Uint8Array }): {
    load(): Promise<PdfDoc>
    getText(): Promise<{ pages: { num: number; text: string }[] }>
    destroy(): Promise<void>
  }
  /** false inside Electron's utilityProcess/renderer (process.type set) , true
   *  in plain Node — drives whether pdfjs needs an explicit worker. */
  readonly isNodeJS: boolean
  /** Sets GlobalWorkerOptions.workerSrc ; no-arg returns the current value. */
  setWorker(src?: string): string
}

let pdfWorkerConfigured = false

// pdf-parse's isNodeJS is false in Electron's utilityProcess (process.type ===
// 'utility'), so pdfjs refuses to run without an explicit worker and throws
// `No "GlobalWorkerOptions.workerSrc" specified`. In plain Node (isNodeJS true ,
// e.g. vitest) pdfjs uses its in-process fake worker and needs no workerSrc , so
// we leave that path alone. The worker file ships beside pdf-parse's entry ;
// pdf-parse is externalized (electron.vite externalizeDepsPlugin) so resolving
// it as a sibling of the package main works in dev and packaged builds alike.
function configurePdfWorker(PDFParse: PdfParseStatic): void {
  if (pdfWorkerConfigured) return
  pdfWorkerConfigured = true
  if (PDFParse.isNodeJS) return
  if (PDFParse.setWorker()) return // workerSrc already set elsewhere
  const require = createRequire(import.meta.url)
  const workerPath = join(dirname(require.resolve('pdf-parse')), 'pdf.worker.mjs')
  PDFParse.setWorker(pathToFileURL(workerPath).href)
}

async function parsePdf(filePath: string): Promise<ParsedDocument> {
  // pdf-parse v2 ESM/CJS interop: dynamic import sidesteps potential typings issues.
  const { PDFParse } = (await import('pdf-parse')) as unknown as { PDFParse: PdfParseStatic }
  configurePdfWorker(PDFParse)
  const buf = await readFile(filePath)
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    // Load the pdfjs doc explicitly so we can extract the bookmark outline
    // alongside the text. pdf-parse caches the doc, so this isn't a re-parse.
    const doc = await parser.load()
    const [result, sections] = await Promise.all([parser.getText(), extractPdfOutline(doc)])
    const pages: PageText[] = result.pages.map((p) => ({
      num: p.num,
      text: normalizePdfPageText(p.text),
    }))
    const fullText = pages.map((p) => p.text).join('\n\n')
    return { kind: 'pdf', pages, fullText, sections }
  } finally {
    await parser.destroy()
  }
}

/** Minimal slice of pdfjs's PDFDocumentProxy that we actually use here.
 *  Avoids importing pdfjs-dist's full types in the main process. */
interface PdfDoc {
  numPages: number
  getOutline(): Promise<PdfOutlineItem[] | null>
  getPageIndex(ref: { num: number; gen: number }): Promise<number>
}

interface PdfOutlineItem {
  title: string
  /** pdfjs destination — first element is the page ref when the destination
   *  is explicit; named destinations (strings) need an extra lookup and are
   *  intentionally skipped for now. */
  dest: unknown
  items?: PdfOutlineItem[]
}

/** Flatten the bookmark tree into a page-sorted list of (headingPath, pageStart)
 *  records. Named destinations and unresolvable refs are silently dropped — a
 *  partial outline is strictly better than no outline at all. */
async function extractPdfOutline(doc: PdfDoc): Promise<PdfSection[]> {
  let outline: PdfOutlineItem[] | null = null
  try {
    outline = await doc.getOutline()
  } catch {
    return []
  }
  if (!outline || outline.length === 0) return []

  const sections: PdfSection[] = []

  const walk = async (items: PdfOutlineItem[], path: string[]): Promise<void> => {
    for (const item of items) {
      const title = (item.title ?? '').trim()
      if (title.length === 0) continue
      const headingPath = [...path, title]
      const ref = Array.isArray(item.dest) ? (item.dest[0] as unknown) : null
      if (ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref) {
        try {
          const pageIndex = await doc.getPageIndex(ref as { num: number; gen: number })
          sections.push({ headingPath, pageStart: pageIndex + 1 })
        } catch {
          // unresolvable destination, skip but still recurse into children
        }
      }
      if (item.items && item.items.length > 0) await walk(item.items, headingPath)
    }
  }

  await walk(outline, [])
  // Sort by pageStart so the chunk tagger can scan linearly. Stable order
  // matters: when two bookmarks land on the same page, the deeper one (added
  // later by the recursive walk) wins for chunks on that page.
  sections.sort((a, b) => a.pageStart - b.pageStart || a.headingPath.length - b.headingPath.length)
  return sections
}

// PDFs often render dot/underscore/dash "leaders" between TOC entries and page
// numbers. They carry no information but blow up chunk size, harm embeddings,
// and make chunk previews unreadable. We also clean up other repeated-glyph
// runs that the extractor preserves verbatim.
function normalizePdfPageText(text: string): string {
  let out = text
  // Dot leaders: 4+ dots optionally separated by spaces/tabs (keeps real ellipses "...").
  out = out.replace(/(?:[ \t]*\.){4,}[ \t]*/g, ' ')
  // Underscore / dash leaders: 4+ in a row (often used for form fields).
  out = out.replace(/_{4,}/g, ' ')
  out = out.replace(/-{4,}/g, ' ')
  // Collapse runs of horizontal whitespace, but keep newlines intact.
  out = out.replace(/[ \t]{2,}/g, ' ')
  // Trim trailing spaces on each line so the cleanup is visible in previews.
  out = out.replace(/[ \t]+\n/g, '\n')
  return out
}
