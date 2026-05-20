import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isWindows = process.platform === 'win32'
const REPO_ROOT = path.resolve(__dirname, '../..')
const TEST_INSTALL_DIR = 'C:\\test-loklm-install'

describe.skipIf(!isWindows)('installer E2E (Windows only)', () => {
  it(
    'silent install + uninstall round-trip',
    () => {
      const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
      const exePath = path.join(REPO_ROOT, 'release', `LokLM-Setup-${pkg.version}-win-x64.exe`)

      expect(
        existsSync(exePath),
        `Built installer not found: ${exePath}. Run \`pnpm package:win\` first.`,
      ).toBe(true)

      if (existsSync(TEST_INSTALL_DIR)) {
        rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
      }

      // Silent install
      const installResult = spawnSync(exePath, ['/S', `/D=${TEST_INSTALL_DIR}`], {
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
      })
      expect(installResult.status, `Installer exited ${installResult.status}`).toBe(0)

      // Verify installed
      const installedExe = path.join(TEST_INSTALL_DIR, 'LokLM.exe')
      expect(existsSync(installedExe)).toBe(true)

      // Silent uninstall
      const uninstallerExe = path.join(TEST_INSTALL_DIR, 'Uninstall LokLM.exe')
      expect(existsSync(uninstallerExe), 'Uninstaller missing').toBe(true)

      const uninstallResult = spawnSync(uninstallerExe, ['/S'], {
        stdio: 'inherit',
        timeout: 2 * 60 * 1000,
      })
      expect(uninstallResult.status).toBe(0)

      // Uninstaller schedules removal of its own folder; give it a moment.
      // Worst case the cleanup below handles it.
      if (existsSync(TEST_INSTALL_DIR)) {
        try {
          rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
        } catch {
          // NSIS uninstaller deletes itself via a batch script — best-effort cleanup
        }
      }
    },
    10 * 60 * 1000,
  )
})
