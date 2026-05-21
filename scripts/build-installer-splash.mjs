// Renders installer-ui/splash.html in headless chromium , captures N frames
// across one animation cycle , and writes :
//   - resources/installer-splash.png  ( single still , for previewing )
//   - resources/installer-splash.bmp  ( 24-bit BMP for electron-builder
//                                       portable.splashImage during the
//                                       7zSD self-extract phase )
//   - resources/installer-splash.gif  ( animated , higher fidelity ,
//                                       reusable for marketing , squirrel-
//                                       style installers , or future
//                                       loading-screen contexts )
//
// Chained from package.json before package:win:installer so the assets are
// always fresh when the wrapper-build picks them up.

import { chromium } from '@playwright/test'
import sharp from 'sharp'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

const SPLASH_HTML = join(ROOT, 'installer-ui', 'splash.html')
const OUT_DIR = join(ROOT, 'resources')
const OUT_PNG = join(OUT_DIR, 'installer-splash.png')
const OUT_BMP = join(OUT_DIR, 'installer-splash.bmp')
const OUT_GIF = join(OUT_DIR, 'installer-splash.gif')

// Splash dimensions — 720×400 is the sweet spot : crisp on 4K displays
// (Windows DPI-scales the 7zSD dialog so a higher source resolution looks
// sharp on hidpi) , still reasonable on 1080p (covers ~37% screen width).
// 7zSD adds its progress bar below the image at runtime.
const WIDTH = 720
const HEIGHT = 400

// Animation cycle of .dots pulse + .logo glow is 1.2-2.4s ; sampling 24
// frames at ~30 FPS captures one full cycle of the dots and roughly half
// the logo glow — a good balance between smoothness and final GIF size.
const FRAME_COUNT = 24
const FRAME_INTERVAL_MS = 50 // 20 FPS playback

// 24-bit BMP encoder. The 7zSD splash dialog accepts BMP (standard Windows
// bitmap , bottom-up , BGR triplets). RGBA input is converted to BGR and
// flipped vertically here ; no external BMP dep needed.
function encodeBmp24(rgba, width, height) {
  const rowSize = width * 3
  // BMP rows are padded to a multiple of 4 bytes. For width 320 → 960 ;
  // already aligned. The padding term keeps this generic for other widths.
  const padding = (4 - (rowSize % 4)) % 4
  const stride = rowSize + padding
  const pixelData = Buffer.alloc(stride * height)

  // Bottom-up : BMP stores rows in reverse vertical order ( origin at
  // bottom-left ) , so we walk the source from last row to first.
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4
    const dstRow = y * stride
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4
      const d = dstRow + x * 3
      pixelData[d] = rgba[s + 2] // B
      pixelData[d + 1] = rgba[s + 1] // G
      pixelData[d + 2] = rgba[s] // R
    }
  }

  const fileHeaderSize = 14
  const dibHeaderSize = 40
  const fileSize = fileHeaderSize + dibHeaderSize + pixelData.length
  const header = Buffer.alloc(fileHeaderSize + dibHeaderSize)

  // BITMAPFILEHEADER
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(fileSize, 2)
  header.writeUInt16LE(0, 6) // reserved
  header.writeUInt16LE(0, 8) // reserved
  header.writeUInt32LE(fileHeaderSize + dibHeaderSize, 10) // pixel data offset

  // BITMAPINFOHEADER (40 bytes , v3)
  header.writeUInt32LE(dibHeaderSize, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22) // positive = bottom-up
  header.writeUInt16LE(1, 26) // planes
  header.writeUInt16LE(24, 28) // bits per pixel
  header.writeUInt32LE(0, 30) // BI_RGB ( no compression )
  header.writeUInt32LE(pixelData.length, 34)
  header.writeInt32LE(2835, 38) // X pels/meter ( ~72 DPI )
  header.writeInt32LE(2835, 42) // Y pels/meter
  header.writeUInt32LE(0, 46) // colors used
  header.writeUInt32LE(0, 50) // important colors

  return Buffer.concat([header, pixelData])
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  console.log(`launching headless chromium , loading ${SPLASH_HTML}`)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  await page.goto(pathToFileURL(SPLASH_HTML).href)
  // Wait for fonts + first paint before sampling so the very first frame
  // isn't a flash of unstyled text.
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts?.ready)

  const frames = []
  console.log(`capturing ${FRAME_COUNT} frames at ${FRAME_INTERVAL_MS}ms intervals`)
  for (let i = 0; i < FRAME_COUNT; i++) {
    const buf = await page.screenshot({ type: 'png', omitBackground: false })
    frames.push(buf)
    if (i < FRAME_COUNT - 1) {
      await page.waitForTimeout(FRAME_INTERVAL_MS)
    }
  }

  await browser.close()

  // Decode every frame once via sharp → raw RGBA. Used for both BMP ( first
  // frame ) and GIF ( all frames ).
  const rawFrames = []
  for (const buf of frames) {
    const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    rawFrames.push(data)
  }

  console.log(`writing ${OUT_PNG}`)
  await writeFile(OUT_PNG, frames[0])

  console.log(`writing ${OUT_BMP}`)
  await writeFile(OUT_BMP, encodeBmp24(rawFrames[0], WIDTH, HEIGHT))

  // GIF : quantize the first frame to build a shared 256-color palette ,
  // then apply it to every frame so the output is small ( shared palette )
  // and free of palette-flicker between frames. The animation is subtle
  // enough that a single palette is plenty.
  console.log(`writing ${OUT_GIF}`)
  const gif = GIFEncoder()
  const palette = quantize(rawFrames[0], 256, { format: 'rgba4444' })
  for (const raw of rawFrames) {
    const indexed = applyPalette(raw, palette, 'rgba4444')
    gif.writeFrame(indexed, WIDTH, HEIGHT, {
      palette,
      delay: FRAME_INTERVAL_MS,
      repeat: 0, // loop forever
    })
  }
  gif.finish()
  await writeFile(OUT_GIF, Buffer.from(gif.bytes()))

  console.log('done')
}

main().catch((err) => {
  console.error(err.stack || err.message)
  process.exit(1)
})
