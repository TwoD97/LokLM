// Re-renders resources/icon.{ico,png} for Windows + Linux from an inline
// SVG template. We don't reuse resources/brand/app-dark.svg directly
// because that's a macOS-convention layout ( logo at ~50% of canvas with
// generous padding ) — Windows icons are denser ( logo fills ~75% of the
// rounded-tile ) , and we want the wizard's taskbar / explorer icon to
// look polished , not padded.
//
// Brand colors + glyph composition mirror app-dark.svg ; the only delta
// is the inner transform scale + translate to grow the card-stack inside
// the tile.
//
// ICO encoding : PNG-based ( supported by Windows Vista+ ) , one entry
// per size , transparent background preserved via the SVG's alpha.

import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const ICO_OUT = join(ROOT, 'resources', 'icon.ico')
const PNG_OUT = join(ROOT, 'resources', 'icon.png')
const PNG_256 = join(ROOT, 'resources', 'icon@256.png')
const PNG_512 = join(ROOT, 'resources', 'icon@512.png')

// Inline SVG ; mirrors resources/brand/app-dark.svg but with the inner
// group scaled 18x ( vs 9.5x in the macOS variant ) and re-centered so
// the card-stack fills ~75% of the 1024 tile.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <rect width="1024" height="1024" rx="229" fill="#0B1B2B"/>
  <g transform="translate(-10 -60) scale(18)">
    <rect x="14" y="22" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="2.4" opacity="0.4"/>
    <rect x="11" y="17" width="36" height="30" rx="2" stroke="#F6F4EF" stroke-width="2.4" opacity="0.7"/>
    <rect x="8"  y="12" width="36" height="30" rx="2" fill="#0B1B2B" stroke="#F6F4EF" stroke-width="2.4"/>
    <circle cx="38" cy="20" r="2.6" fill="#7DD3FC"/>
    <path d="M14 22 H32 M14 28 H30 M14 34 H26" stroke="#F6F4EF" stroke-width="1.6" stroke-linecap="round" opacity="0.55"/>
  </g>
</svg>`

// Canonical sizes : 16/32/48 for taskbar+explorer , 24 for Win11 jump list ,
// 64/128 for high-DPI taskbar , 256 for explorer extra-large + jump list at
// 200% scaling.
const SIZES = [16, 24, 32, 48, 64, 128, 256]

function encodeIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type : 1 = icon
  header.writeUInt16LE(count, 4)

  const entries = Buffer.alloc(16 * count)
  let dataOffset = 6 + 16 * count

  for (let i = 0; i < count; i++) {
    const { size, png } = images[i]
    const e = i * 16
    // Width / height : 0 means 256 in ICO format , otherwise 1-255.
    entries.writeUInt8(size >= 256 ? 0 : size, e + 0)
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1)
    entries.writeUInt8(0, e + 2) // palette colors ( 0 = no palette )
    entries.writeUInt8(0, e + 3) // reserved
    entries.writeUInt16LE(1, e + 4) // color planes
    entries.writeUInt16LE(32, e + 6) // bits per pixel
    entries.writeUInt32LE(png.length, e + 8) // image data size
    entries.writeUInt32LE(dataOffset, e + 12) // image data offset
    dataOffset += png.length
  }

  return Buffer.concat([header, entries, ...images.map((i) => i.png)])
}

async function main() {
  const svg = Buffer.from(ICON_SVG, 'utf8')

  // sharp renders SVG with full alpha ; corners outside rx=229 are
  // transparent automatically — no manual mask needed.
  const images = []
  for (const size of SIZES) {
    const png = await sharp(svg).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
    images.push({ size, png })
  }

  await writeFile(ICO_OUT, encodeIco(images))
  console.log(`built ${ICO_OUT} ( ${SIZES.join('+')} px )`)

  // Linux / macOS use the PNG outputs directly. icon.png is the canonical
  // 256-square ; icon@256.png + icon@512.png are kept for compat with
  // anything that reads explicit-resolution variants.
  const png256 = images.find((i) => i.size === 256).png
  await writeFile(PNG_OUT, png256)
  await writeFile(PNG_256, png256)
  const png512 = await sharp(svg)
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(PNG_512, png512)
  console.log('built icon.png , icon@256.png , icon@512.png')
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
