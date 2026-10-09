import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import {
  installerEntryScript,
  makeselfArguments,
} from '../../../scripts/build-installer-stub-linux.mjs'

const makeself =
  process.platform === 'linux'
    ? ['makeself', 'makeself.sh'].find(
        (command) => spawnSync(command, ['--version'], { timeout: 5_000 }).status === 0,
      )
    : undefined
const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe.skipIf(!makeself)('real Linux makeself installer wrapper', () => {
  it.each([0, 17])(
    'extracts temporarily, cleans up, and preserves wizard exit %i',
    async (exitCode) => {
      const root = await mkdtemp(join(tmpdir(), 'loklm-makeself-'))
      dirs.push(root)
      const stage = join(root, '.installer fixture stage')
      const output = join(root, 'fixture installer.run')
      const workingDirectory = join(root, 'caller')
      const temporaryDirectory = join(root, 'temporary')
      const receipt = join(root, 'wizard-location.txt')
      await Promise.all([
        mkdir(join(stage, 'installer'), { recursive: true }),
        mkdir(join(stage, 'linux-unpacked'), { recursive: true }),
        mkdir(workingDirectory),
        mkdir(temporaryDirectory),
      ])
      await writeFile(join(stage, 'linux-unpacked', 'payload.txt'), 'synthetic payload')
      await writeFile(join(stage, 'run-install.sh'), installerEntryScript)
      const wizard = join(stage, 'installer', 'loklm')
      await writeFile(
        wizard,
        '#!/usr/bin/env bash\nset -e\n' +
          'test -f "$(dirname "$0")/../linux-unpacked/payload.txt"\n' +
          'pwd -P > "$LOKLM_FIXTURE_RECEIPT"\n' +
          'exit "$LOKLM_FIXTURE_EXIT"\n',
      )
      await Promise.all([chmod(wizard, 0o755), chmod(join(stage, 'run-install.sh'), 0o755)])

      const packed = spawnSync(makeself, makeselfArguments(stage, output), {
        encoding: 'utf8',
        timeout: 20_000,
      })
      expect(packed.error).toBeUndefined()
      expect(packed.status, packed.stderr).toBe(0)

      const launched = spawnSync('sh', [output], {
        cwd: workingDirectory,
        env: {
          ...process.env,
          TMPDIR: temporaryDirectory,
          LOKLM_FIXTURE_RECEIPT: receipt,
          LOKLM_FIXTURE_EXIT: String(exitCode),
        },
        encoding: 'utf8',
        timeout: 20_000,
      })
      expect(launched.error).toBeUndefined()
      expect(launched.status, launched.stderr).toBe(exitCode)
      expect(launched.signal).toBeNull()
      const extracted = (await readFile(receipt, 'utf8')).trim()
      const relativeExtracted = relative(temporaryDirectory, extracted)
      expect(relativeExtracted).not.toBe('')
      expect(isAbsolute(relativeExtracted)).toBe(false)
      expect(relativeExtracted.split(/[\\/]/)).not.toContain('..')
      await expect(access(extracted)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(temporaryDirectory)).toEqual([])
      expect(await readdir(workingDirectory)).toEqual([])
    },
    45_000,
  )
})
