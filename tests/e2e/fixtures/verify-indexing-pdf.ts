// Offline verification through the same PDF parser and chunker as ingestion.
// No model loading, vault access or network requests.
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'
import { parseFile } from '../../../src/main/services/documents/parser'
import { chunkPages } from '../../../src/main/services/documents/chunker'

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const inputPath = process.argv.slice(2).find((argument) => argument !== '--render')
const path = resolve(
  inputPath ?? resolve(fixtureDirectory, '../../../out/native-indexing/indexing-workflow.pdf'),
)
const parsed = await parseFile(path)
if (parsed.kind !== 'pdf' || parsed.pages.length !== 20) throw new Error('Expected 20 PDF pages')
for (const [index, page] of parsed.pages.entries()) {
  const code = String(index + 1).padStart(2, '0')
  if (!page.text.includes(`SYN-${code}-A`) || !page.text.includes(`SYN-${code}-F`)) {
    throw new Error(`Page ${index + 1} lost a boundary paragraph during extraction`)
  }
}
const chunks = chunkPages(parsed.pages, { maxChars: 2000, overlap: 200 })
if (chunks.length < 40 || chunks.length > 60)
  throw new Error(`Unexpected chunk count: ${chunks.length}`)
if (new Set(chunks.map((chunk) => chunk.pageFrom)).size !== 20)
  throw new Error('Some pages have no chunks')
const bytes = await readFile(path)
const report = {
  path,
  pages: parsed.pages.length,
  chunks: chunks.length,
  chunkCharacters: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
  extractedCharacters: parsed.fullText.length,
  estimatedTokens: Math.ceil(chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / 3.5),
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  pageChunkCounts: parsed.pages.map(
    (page) => chunks.filter((chunk) => chunk.pageFrom === page.num).length,
  ),
}
await writeFile(
  resolve(dirname(path), 'indexing-workflow-verification.json'),
  JSON.stringify(report, null, 2) + '\n',
)
if (process.argv.includes('--render')) {
  const parser = new PDFParse({ data: bytes })
  try {
    const rendered = await parser.getScreenshot({
      partial: [1, 10, 20],
      scale: 1,
      imageDataUrl: false,
    })
    const output = resolve(dirname(path), 'preview')
    await mkdir(output, { recursive: true })
    for (const page of rendered.pages)
      await writeFile(resolve(output, `page-${page.pageNumber}.png`), page.data)
  } finally {
    await parser.destroy()
  }
}
console.log(JSON.stringify(report))
