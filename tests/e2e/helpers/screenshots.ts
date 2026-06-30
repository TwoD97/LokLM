import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { Locator, Page } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Where the Astro site consumes the captures (public/, served verbatim). The
 *  harness writes the SAME filenames the landing page already references plus the
 *  new per-feature ones (see screenshots-checklist.md). */
export const SCREENSHOTS_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'website',
  'public',
  'screenshots',
)

const WEBP_QUALITY = 80

export interface CaptureOptions {
  /** Crop to a single element instead of the whole window (the checklist asks
   *  for tight crops on citation pills etc.). */
  locator?: Locator
  /** Pad a locator crop by N device pixels so shadows/popovers aren't clipped. */
  pad?: number
}

/**
 * Capture `name.webp` (2× — the window runs at device-scale-factor 2) plus
 * `name@1x.webp` (half size) into the website's screenshots dir. Playwright only
 * emits PNG/JPEG, so we pipe the PNG buffer through sharp → WebP at the
 * checklist's ~80 quality.
 */
export async function capture(page: Page, name: string, opts: CaptureOptions = {}): Promise<void> {
  await mkdir(SCREENSHOTS_DIR, { recursive: true })

  let png: Buffer
  if (opts.locator) {
    const box = await opts.locator.boundingBox()
    if (box && opts.pad) {
      const pad = opts.pad
      png = await page.screenshot({
        clip: {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: box.width + pad * 2,
          height: box.height + pad * 2,
        },
      })
    } else {
      png = await opts.locator.screenshot()
    }
  } else {
    png = await page.screenshot()
  }

  const twoX = join(SCREENSHOTS_DIR, `${name}.webp`)
  const oneX = join(SCREENSHOTS_DIR, `${name}@1x.webp`)
  await sharp(png).webp({ quality: WEBP_QUALITY }).toFile(twoX)

  const meta = await sharp(png).metadata()
  const halfWidth = Math.max(1, Math.round((meta.width ?? 2) / 2))
  await sharp(png).resize({ width: halfWidth }).webp({ quality: WEBP_QUALITY }).toFile(oneX)
}
