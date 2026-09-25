// Synthetic native-indexing fixture. Node built-ins only; no models, network,
// private documents, timestamps or randomness. Defaults to an ignored output.
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { log } from 'node:console'
import process from 'node:process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDirectory = dirname(fileURLToPath(import.meta.url))
const output = resolve(
  process.argv[2] ??
    resolve(fixtureDirectory, '../../../out/native-indexing/indexing-workflow.pdf'),
)
const locations = [
  'Amber Quay',
  'Birch Station',
  'Cedar Yard',
  'Dune Workshop',
  'Elm Depot',
  'Flint Harbor',
  'Grove Annex',
  'Heath Laboratory',
  'Iris Terminal',
  'Juniper Field',
  'Kestrel Hall',
  'Linden Basin',
  'Maple Ridge',
  'North Orchard',
  'Olive Pier',
  'Pine Court',
  'Quartz Shed',
  'Reed Tower',
  'Spruce Dock',
  'Willow Gate',
]
const activities = [
  'water sampling',
  'pump inspection',
  'packaging review',
  'sensor calibration',
  'filter cleaning',
  'inventory counting',
  'valve testing',
  'battery measurement',
  'soil weighing',
  'seal replacement',
]

function escapePdf(text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('Fixture text must be ASCII')
  return text.replace(/[\\()]/g, (character) => `\\${character}`)
}

function wrap(text, width = 86) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else line += (line ? ' ' : '') + word
  }
  if (line) lines.push(line)
  return lines
}

function paragraphs(index, location) {
  const record = String(index + 1).padStart(2, '0')
  const activity = activities[index % activities.length]
  const quantity = 41 + index * 7
  return [
    `Record SYN-${record}-A describes ${activity} at ${location} on 2026-05-${record}. The team received ${quantity} labeled units before the morning inspection. Each unit carried a location code, a collection date and a separate handling note. The receiving clerk compared these fields against the delivery ledger before accepting the batch. Two sealed reference units were stored separately and were not included in the inspected quantity.`,
    `Record SYN-${record}-B documents the measurement setup for ${location}. The balance was checked with a ${120 + index * 3} gram reference weight before the first reading. Staff recorded the reference value, the observed value and the room identifier in separate columns. A second operator reviewed every tenth reading. Measurements were written in grams with one decimal place; counts remained whole numbers. No value was converted into a percentage in the original record.`,
    `Record SYN-${record}-C reports the workflow observations for ${activity}. The first station completed ${18 + index} checks in the morning and ${23 + index * 2} checks in the afternoon. A check was complete only after its label and condition had both been recorded. Items requiring a replacement label moved to a holding shelf. The afternoon total excludes held items, so the two station totals can be added without counting an unfinished check twice.`,
    `Record SYN-${record}-D records maintenance at ${location}. The technician replaced ${2 + (index % 4)} worn seals and cleaned the accessible filter housing. The inspection did not include concealed wiring or the storage-room roof. After maintenance, a ten-minute observation period confirmed that the visible connections remained dry. The technician signed the local work sheet, while a different staff member reviewed the inventory adjustment later that day.`,
    `Record SYN-${record}-E describes the transport handoff. The carrier collected the labeled containers at ${String(9 + (index % 8)).padStart(2, '0')}:30 and delivered them to the next station in ${24 + index * 2} minutes. The dispatch entry records container count and departure time, whereas the receiving entry records arrival time and condition. Neither entry records vehicle fuel use. A missing fuel figure therefore cannot be inferred from this transport record.`,
    `Record SYN-${record}-F closes the synthetic report for ${location}. The supervisor reconciled accepted units, held units and the separate reference stock before archiving the records. The archive retains the measurement sheet and the signed handoff form under the same location code. This page contains invented operational facts solely for software testing. It is not evidence about a real business, person or facility and must not be mixed with calibration benchmark sources.`,
  ]
}

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
]
const pageIds = []
const sourceText = []
for (const [index, location] of locations.entries()) {
  const pageId = objects.length + 1
  const streamId = pageId + 1
  pageIds.push(pageId)
  const commands = []
  const text = (value, y, size = 9, font = 'F1') => {
    commands.push(`BT /${font} ${size} Tf 1 0 0 1 48 ${y} Tm (${escapePdf(value)}) Tj ET`)
  }
  text(`Synthetic operations report: ${location}`, 791, 15, 'F2')
  text('LOCAL TEST FIXTURE - invented records for indexing and cancellation', 768, 9)
  commands.push('0.4 w 48 755 m 547 755 l S')
  let y = 732
  const body = paragraphs(index, location)
  sourceText.push(body.join('\n\n'))
  for (const paragraph of body) {
    for (const line of wrap(paragraph)) {
      text(line, y)
      y -= 13
    }
    y -= 9
  }
  if (y < 78) throw new Error(`Page ${index + 1} exceeds its body area`)
  commands.push('0.4 w 48 66 m 547 66 l S')
  text(
    `Fixture page ${index + 1} of ${locations.length} | SYN-${String(index + 1).padStart(2, '0')}`,
    48,
    9,
  )
  const stream = commands.join('\n') + '\n'
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
  )
}
objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${locations.length} >>`
const infoId = objects.length + 1
objects.push(
  '<< /Title (LokLM synthetic indexing workflow) /Creator (LokLM deterministic test fixture) >>',
)
let document = '%PDF-1.4\n'
const offsets = [0]
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(document, 'ascii'))
  document += `${index + 1} 0 obj\n${object}\nendobj\n`
}
const xrefOffset = Buffer.byteLength(document, 'ascii')
document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
document += offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('')
document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
const bytes = Buffer.from(document, 'ascii')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, bytes)
log(
  JSON.stringify({
    output,
    pages: locations.length,
    bytes: bytes.length,
    sourceCharacters: sourceText.join('\n\n').length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }),
)
