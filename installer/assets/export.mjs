// SVG → BMP3 exporter for the LokLM NSIS installer.
//
// NSIS MUI2 requires the sidebar (164x314) and header (150x57) bitmaps to be
// 24-bit BMP3 (BITMAPINFOHEADER, BI_RGB, no alpha). BMP4/5 silently fail to
// render. sharp's .raw() output + a hand-written BMP3 header avoids any
// libvips-version-dependent BMP encoder behavior.

import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO_ROOT = path.resolve(__dirname, '../..')

/**
 * Render an SVG to a 24-bit BMP3 file.
 *
 * @param {object} args
 * @param {string} args.svgPath - Absolute path to source SVG
 * @param {string} args.outPath - Absolute path to BMP3 output
 * @param {number} args.width  - Target width in pixels
 * @param {number} args.height - Target height in pixels
 * @param {string} [args.versionToken] - If set, replaces __VERSION__ in the SVG before rendering
 */
export async function exportSvgToBmp({ svgPath, outPath, width, height, versionToken }) {
  let svg = await readFile(svgPath, 'utf-8')
  if (versionToken !== undefined) {
    svg = svg.replaceAll('__VERSION__', versionToken)
  }
  // libvips/glib XML parser rejects `--` inside XML comments (strict XML rule).
  // Strip all comments before handing the SVG buffer to sharp.
  svg = svg.replace(/<!--[\s\S]*?-->/g, '')

  // Render SVG → raw BGR pixels at exact dimensions.
  // sharp emits RGB; BMP wants BGR with rows bottom-to-top, padded to 4-byte alignment.
  const { data: rgb } = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rowSize = Math.floor((24 * width + 31) / 32) * 4 // 4-byte aligned row stride
  const pixelArraySize = rowSize * height
  const fileSize = 54 + pixelArraySize // 14 bytes file header + 40 bytes DIB header

  const buf = Buffer.alloc(fileSize)

  // BITMAPFILEHEADER (14 bytes)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt16LE(0, 6) // reserved
  buf.writeUInt16LE(0, 8) // reserved
  buf.writeUInt32LE(54, 10) // pixel data offset

  // BITMAPINFOHEADER (40 bytes) — this is what makes it BMP3
  buf.writeUInt32LE(40, 14) // header size
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26) // planes
  buf.writeUInt16LE(24, 28) // bits per pixel
  buf.writeUInt32LE(0, 30) // BI_RGB (no compression)
  buf.writeUInt32LE(pixelArraySize, 34)
  buf.writeInt32LE(2835, 38) // x ppm (~72 DPI)
  buf.writeInt32LE(2835, 42) // y ppm
  buf.writeUInt32LE(0, 46) // colors used
  buf.writeUInt32LE(0, 50) // important colors

  // Pixel array: BMP is bottom-up; sharp RGB is top-down.
  // Convert each row: RGB → BGR, write rows in reverse order with padding.
  const pad = rowSize - width * 3
  let cursor = 54
  for (let y = height - 1; y >= 0; y--) {
    const srcRow = y * width * 3
    for (let x = 0; x < width; x++) {
      const i = srcRow + x * 3
      buf[cursor++] = rgb[i + 2] // B
      buf[cursor++] = rgb[i + 1] // G
      buf[cursor++] = rgb[i + 0] // R
    }
    cursor += pad
  }

  await writeFile(outPath, buf)
}

/** CLI entry: regenerates all three BMPs from `installer/assets/*.svg`. */
export async function exportAll() {
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
  const version = pkg.version

  const installerDir = path.join(REPO_ROOT, 'installer')
  const assetsDir = path.join(installerDir, 'assets')

  await exportSvgToBmp({
    svgPath: path.join(assetsDir, 'sidebar.svg'),
    outPath: path.join(installerDir, 'installer-sidebar.bmp'),
    width: 164,
    height: 314,
    versionToken: version,
  })
  console.log(`✓ installer-sidebar.bmp (164x314, v${version})`)

  await exportSvgToBmp({
    svgPath: path.join(assetsDir, 'sidebar-uninstall.svg'),
    outPath: path.join(installerDir, 'uninstaller-sidebar.bmp'),
    width: 164,
    height: 314,
    versionToken: version,
  })
  console.log(`✓ uninstaller-sidebar.bmp (164x314, v${version})`)

  await exportSvgToBmp({
    svgPath: path.join(assetsDir, 'header.svg'),
    outPath: path.join(installerDir, 'installer-header.bmp'),
    width: 150,
    height: 57,
  })
  console.log(`✓ installer-header.bmp (150x57)`)
}

// CLI entry guard
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  exportAll().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
