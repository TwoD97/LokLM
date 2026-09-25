import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CalibrationManifest, CalibrationSplit, LoadedCalibrationManifest } from './schema'

export const CALIBRATION_ROOT = dirname(fileURLToPath(import.meta.url))

export async function loadCalibrationSplit(
  split: CalibrationSplit,
): Promise<LoadedCalibrationManifest> {
  if (split !== 'dev' && split !== 'heldout' && split !== 'conflict-regression') {
    throw new Error('Invalid calibration split')
  }
  const raw = await readFile(resolve(CALIBRATION_ROOT, `${split}.json`), 'utf8')
  const manifest = JSON.parse(raw) as CalibrationManifest
  if (manifest.schemaVersion !== 1 || manifest.split !== split) {
    throw new Error('Unsupported calibration manifest')
  }
  const sources = manifest.sources.map((source) => {
    const absolutePath = resolve(CALIBRATION_ROOT, source.file)
    const fromRoot = relative(CALIBRATION_ROOT, absolutePath)
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(`Fixture path escapes the calibration directory: ${source.key}`)
    }
    return { ...source, absolutePath }
  })
  if (split === 'heldout') {
    const lock = JSON.parse(
      await readFile(resolve(CALIBRATION_ROOT, 'heldout.sha256.json'), 'utf8'),
    ) as { schemaVersion: number; files: Record<string, string> }
    const expected = ['heldout.json', ...manifest.sources.map((source) => source.file)]
    if (
      lock.schemaVersion !== 1 ||
      Object.keys(lock.files).length !== expected.length ||
      expected.some((file) => !lock.files[file])
    ) {
      throw new Error('Held-out lock does not describe exactly this corpus and manifest')
    }
    for (const file of expected) {
      const bytes = await readFile(resolve(CALIBRATION_ROOT, file))
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (lock.files[file] !== digest) throw new Error(`Frozen held-out fixture changed: ${file}`)
    }
  }
  return { ...manifest, sources }
}
