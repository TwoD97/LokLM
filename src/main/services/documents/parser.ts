import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { ImportError, type ParsedDocument, type PageText } from './types'

// extension whitelist — verbatim from MVP (Notebook-LoLM). docx is intentionally
// out so isSupported returns false; parseFile throws ImportError('unsupported')
// for any other unknown extension.
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
  return ext === '.pdf' || TEXT_EXTS.has(ext)
}

export async function parseFile(filePath: string): Promise<ParsedDocument> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.pdf') return parsePdf(filePath)
  if (TEXT_EXTS.has(ext)) return parsePlainText(filePath)
  throw new ImportError(`Unsupported file type: ${basename(filePath)}`, 'unsupported', filePath)
}

async function parsePlainText(filePath: string): Promise<ParsedDocument> {
  const text = await readFile(filePath, 'utf-8')
  return {
    kind: 'text',
    pages: [{ num: 1, text }],
    fullText: text,
  }
}

async function parsePdf(filePath: string): Promise<ParsedDocument> {
  // pdf-parse v2 ESM/CJS interop: dynamic import sidesteps potential typings issues.
  const { PDFParse } = (await import('pdf-parse')) as unknown as {
    PDFParse: new (opts: { data: Uint8Array }) => {
      getText(): Promise<{ pages: { num: number; text: string }[] }>
      destroy(): Promise<void>
    }
  }
  const buf = await readFile(filePath)
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    const result = await parser.getText()
    const pages: PageText[] = result.pages.map((p) => ({
      num: p.num,
      text: normalizePdfPageText(p.text),
    }))
    const fullText = pages.map((p) => p.text).join('\n\n')
    return { kind: 'pdf', pages, fullText }
  } finally {
    await parser.destroy()
  }
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
