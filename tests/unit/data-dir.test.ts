import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveDataDir, type DataDirEnv, type DataDirProbes } from '@main/services/storage/dataDir'

// Portable-data policy (2026-06-27): vault + workspaces live next to the
// executable on a fresh packaged Windows/Linux install; userData otherwise.
// The fs facts are injected so the policy is exercised without touching disk.

const USERDATA = '/home/u/.config/loklm'
const EXE_WIN = 'D:\\Apps\\LokLM\\LokLM.exe'

function env(over: Partial<DataDirEnv> = {}): DataDirEnv {
  return {
    override: undefined,
    isPackaged: true,
    platform: 'win32',
    execPath: EXE_WIN,
    userDataDir: USERDATA,
    ...over,
  }
}

const probes = (over: Partial<DataDirProbes> = {}): DataDirProbes => ({
  isWritableDir: () => true,
  vaultExists: () => false,
  ...over,
})

describe('resolveDataDir', () => {
  it('LOKLM_DATA_DIR override wins over everything', () => {
    expect(resolveDataDir(env({ override: 'Z:\\loklm-data' }), probes())).toBe('Z:\\loklm-data')
    // even when a userData vault exists + dir not writable
    expect(
      resolveDataDir(
        env({ override: '  Z:\\d  ' }),
        probes({ vaultExists: () => true, isWritableDir: () => false }),
      ),
    ).toBe('Z:\\d')
  })

  it('fresh packaged Windows install → data next to the executable', () => {
    expect(resolveDataDir(env(), probes())).toBe(join('D:\\Apps\\LokLM', 'data'))
  })

  it('dev (not packaged) → userData, never the repo/node_modules electron', () => {
    expect(resolveDataDir(env({ isPackaged: false }), probes())).toBe(USERDATA)
  })

  it('macOS → userData (signed, read-only .app bundle)', () => {
    expect(
      resolveDataDir(
        env({ platform: 'darwin', execPath: '/Applications/LokLM.app/Contents/MacOS/LokLM' }),
        probes(),
      ),
    ).toBe(USERDATA)
  })

  it('existing vault in userData keeps using userData (no stranding on upgrade)', () => {
    expect(resolveDataDir(env(), probes({ vaultExists: () => true }))).toBe(USERDATA)
  })

  it('install dir not writable (e.g. Program Files) → userData', () => {
    expect(resolveDataDir(env(), probes({ isWritableDir: () => false }))).toBe(USERDATA)
  })

  it('an empty/whitespace override does not win', () => {
    expect(resolveDataDir(env({ override: '   ' }), probes())).toBe(join('D:\\Apps\\LokLM', 'data'))
  })
})
