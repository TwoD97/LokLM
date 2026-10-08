import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
function callerRequire(chain) {
  let resolved = require
  for (const name of chain) resolved = createRequire(resolved.resolve(name))
  return resolved
}
const consumers = [
  ['Mammoth CLI', callerRequire(['mammoth', 'argparse']), '1.0.3'],
  [
    'Electron download logger',
    callerRequire([
      'electron-builder',
      'app-builder-lib',
      '@electron/get',
      'global-agent',
      'roarr',
    ]),
    '1.1.3',
  ],
]

describe.each(consumers)('%s precision protection', (_name, consumer, version) => {
  const entry = consumer.resolve('sprintf-js')
  const root = dirname(dirname(entry))
  const entries = [
    ['package entry', entry],
    ['browser distribution', join(root, 'dist/sprintf.min.js')],
  ]
  describe.each(entries)('%s', (_kind, file) => {
    const { sprintf, vsprintf } = require(file)
    const expected = (value, precision, type) => {
      if (type === 'e') return value.toExponential(precision)
      if (type === 'f') return value.toFixed(precision)
      const formatted = value.toPrecision(precision)
      return version === '1.1.3' ? String(Number(formatted)) : formatted
    }

    it.each(['e', 'f', 'g'])(
      'bounds oversized %s precision, including numeric overflow',
      (type) => {
        for (const digits of ['101', '999999', '9'.repeat(400), '0000101']) {
          const format = `%.${digits}${type}`
          const output = expected(1.25, 100, type)
          expect(sprintf(format, 1.25)).toBe(output)
          expect(vsprintf(format, [1.25])).toBe(output)
          // A cached parse tree must retain the protection on subsequent calls.
          expect(sprintf(format, -1.25)).toBe(expected(-1.25, 100, type))
        }
      },
    )

    it('handles zero significant precision without a RangeError', () => {
      expect(sprintf('%.0g', 12.5)).toBe(expected(12.5, 1, 'g'))
      expect(sprintf('%.000g', -12.5)).toBe(expected(-12.5, 1, 'g'))
    })

    it('retains every valid numeric precision and ordinary format behavior', () => {
      for (const type of ['e', 'f', 'g']) {
        for (let precision = type === 'g' ? 1 : 0; precision <= 100; precision++) {
          for (const value of [0, 1.25, -12.5]) {
            expect(sprintf(`%.${precision}${type}`, value)).toBe(expected(value, precision, type))
          }
        }
      }
      expect(sprintf('%2$s: %1$+08.2f / %%', 1.25, 'value')).toBe('value: +0001.25 / %')
      expect(sprintf('%(value).2f', { value: 1.25 })).toBe('1.25')
      expect(sprintf('%.120s', 'x'.repeat(150))).toBe('x'.repeat(120))
      expect(sprintf('%e %f %g', 1.25, 1.25, 1.25)).toBe('1.25e+0 1.25 1.25')
    })

    it('survives the advisory payload in an uncaught asynchronous caller', () => {
      const code = `const { sprintf } = require(${JSON.stringify(file)}); setImmediate(() => { for (const fmt of ['%.101e','%.101f','%.101g','%.0g']) sprintf(fmt, 1.25); process.stdout.write('completed'); });`
      expect(
        execFileSync(process.execPath, ['-e', code], {
          encoding: 'utf8',
          timeout: 5_000,
          windowsHide: true,
          env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
        }),
      ).toBe('completed')
    })
  })
})

it('keeps the real Mammoth CLI help usable', () => {
  const mammothRoot = dirname(dirname(require.resolve('mammoth')))
  expect(
    execFileSync(process.execPath, [join(mammothRoot, 'bin/mammoth'), '--help'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    }),
  ).toContain('Path to the .docx file to convert.')
})
