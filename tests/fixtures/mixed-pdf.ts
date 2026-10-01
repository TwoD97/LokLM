import { createCanvas } from '@napi-rs/canvas'

/** A genuine two-page PDF: selectable text first, a raster-only scan second.
 * Synthetic content, assembled locally without another document dependency. */
export function createMixedPdf(): Buffer {
  const canvas = createCanvas(1200, 700)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'black'
  context.font = '48px sans-serif'
  for (const [index, line] of [
    'BRAVO SCAN',
    'Workshop begins at 09:45.',
    'Teilnehmerzahl 27.',
    'Room B-14.',
  ].entries()) {
    context.fillText(line, 65, 115 + index * 100)
  }
  const image = canvas.toBuffer('image/jpeg')
  const stream = (data: Buffer, attributes = '') =>
    Buffer.concat([
      Buffer.from(`<< ${attributes} /Length ${data.length} >>\nstream\n`),
      data,
      Buffer.from('\nendstream'),
    ])
  const text = Buffer.from(
    'BT /F1 16 Tf 48 760 Td (ALPHA-TEXT-731: This page has selectable source text.) Tj ET\n',
  )
  const imageCommands = Buffer.from('q 500 0 0 291.67 48 450 cm /Scan Do Q\n')
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 8 0 R >> >> /Contents 4 0 R >>',
    ),
    stream(text),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Scan 7 0 R >> >> /Contents 6 0 R >>',
    ),
    stream(imageCommands),
    stream(
      image,
      '/Type /XObject /Subtype /Image /Width 1200 /Height 700 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  const parts = [Buffer.from('%PDF-1.4\n')]
  const offsets: number[] = []
  let length = parts[0]!.length
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const bytes = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ])
    parts.push(bytes)
    length += bytes.length
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  )
  return Buffer.concat(parts)
}
