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
    const pages: PageText[] = result.pages.map((p) => ({ num: p.num, text: p.text }))
    const fullText = pages.map((p) => p.text).join('\n\n')
    return { kind: 'pdf', pages, fullText }
  } finally {
    await parser.destroy()
  }
}
