// Deterministic one-page PDF fixtures. Uses only built-in Node modules.
// Existing files must match; this script never silently rewrites held-out data.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

const specifications = [
  {
    file: 'fixtures/dev/mica-field-survey.pdf',
    title: 'Mica Harbor field survey',
    date: '2026-04-12',
    rows: [
      ['Neral', '27', '2', '18.4'],
      ['Bexin', '35', '3', '22.7'],
    ],
  },
  {
    file: 'fixtures/heldout/veldrin-field-survey.pdf',
    title: 'Veldrin Yard field survey',
    date: '2027-02-23',
    rows: [
      ['Teral', '18', '0', '31.6'],
      ['Luvon', '29', '3', '26.9'],
    ],
  },
]

function escapePdf(text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('PDF fixture text must be ASCII')
  return text.replace(/[\\()]/g, (character) => `\\${character}`)
}

function createPdf({ title, date, rows }) {
  const commands = []
  const text = (value, y, size = 11, font = 'F1') => {
    commands.push(`BT /${font} ${size} Tf 1 0 0 1 48 ${y} Tm (${escapePdf(value)}) Tj ET`)
  }
  text(title, 788, 18, 'F2')
  text(`Survey date: ${date}`, 750)
  text('Synthetic calibration data - one recorded survey.', 726)
  text('Each row describes one site. Tray counts are whole trays.', 702)
  text('The sample mass is measured in kilograms (kg).', 678)
  const tableRow = ([site, accepted, rejected, mass]) =>
    `${site.padEnd(10)} | ${accepted.padStart(14)} | ${rejected.padStart(14)} | ${mass.padStart(16)}`
  text(tableRow(['Site', 'Accepted trays', 'Rejected trays', 'Sample mass (kg)']), 630)
  commands.push('0.4 w 48 621 m 548 621 l S')
  rows.forEach((row, index) => text(tableRow(row), 600 - index * 28))
  commands.push('0.4 w 48 560 m 548 560 l S')
  text('Accepted and rejected trays are separate counts.', 520)
  text('Sample mass is independent of the number of trays.', 496)
  text('The report contains no outdoor temperature measurements.', 472)
  text('Page 1 of 1', 54, 10)

  const stream = commands.join('\n') + '\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    `<< /Title (${escapePdf(title)}) /Creator (LokLM synthetic calibration fixture) >>`,
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(document, 'ascii'))
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  document +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(document, 'ascii')
}

async function writeOnceOrVerify(file, bytes) {
  const path = resolve(root, file)
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, bytes, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const current = await readFile(path)
    if (!current.equals(bytes))
      throw new Error(`Refusing to overwrite an existing fixture: ${file}`)
  }
}

for (const specification of specifications) {
  await writeOnceOrVerify(specification.file, createPdf(specification))
}

if (process.argv.includes('--freeze-heldout')) {
  const manifest = JSON.parse(await readFile(resolve(root, 'heldout.json'), 'utf8'))
  const files = {}
  for (const file of ['heldout.json', ...manifest.sources.map((source) => source.file)]) {
    files[file] = createHash('sha256')
      .update(await readFile(resolve(root, file)))
      .digest('hex')
  }
  await writeOnceOrVerify(
    'heldout.sha256.json',
    Buffer.from(JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n'),
  )
}

console.log('Verified 2 deterministic PDF fixtures. No models loaded.')
