// Read/parse/render fixtures with the repository's existing PDF dependency.
// This does not load inference models or contact external services.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const root = dirname(fileURLToPath(import.meta.url))
const output = resolve(root, '../../../out/native-calibration/fixtures')
await mkdir(output, { recursive: true })
for (const [split, filename, markers] of [
  [
    'dev',
    'mica-field-survey.pdf',
    ['2026-04-12', 'Neral', 'Bexin', '18.4', '22.7', 'Accepted trays', 'Sample mass (kg)'],
  ],
  [
    'heldout',
    'veldrin-field-survey.pdf',
    ['2027-02-23', 'Teral', 'Luvon', '31.6', '26.9', 'Accepted trays', 'Sample mass (kg)'],
  ],
]) {
  const data = await readFile(resolve(root, 'fixtures', split, filename))
  const parser = new PDFParse({ data })
  try {
    const extracted = await parser.getText()
    if (extracted.pages.length !== 1) throw new Error(`${split}: expected one genuine PDF page`)
    for (const marker of markers) {
      if (!extracted.text.includes(marker)) throw new Error(`${split}: PDF lost ${marker}`)
    }
    const rendered = await parser.getScreenshot({ scale: 1.4, imageDataUrl: false })
    await writeFile(resolve(output, `${split}.png`), rendered.pages[0].data)
    await writeFile(resolve(output, `${split}.txt`), extracted.text)
    console.log(`${split}: extracted and rendered one PDF page`)
  } finally {
    await parser.destroy()
  }
}
