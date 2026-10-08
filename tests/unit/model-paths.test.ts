import { describe, it, expect } from 'vitest'
import { getWizardModelsDir } from '../../src/main/services/models/paths'

describe('getWizardModelsDir', () => {
  it('windows: wizard installs models next to the executable', () => {
    expect(
      getWizardModelsDir(
        'win32',
        'C:\\Users\\x\\AppData\\Local\\Programs\\LokLM\\LokLM.exe',
        'C:\\Users\\x\\AppData\\Roaming\\LokLM',
      ),
    ).toBe('C:\\Users\\x\\AppData\\Local\\Programs\\LokLM\\models')
  })

  it('linux: wizard installs models next to the executable', () => {
    expect(getWizardModelsDir('linux', '/opt/loklm/loklm', '/home/x/.config/LokLM')).toBe(
      '/opt/loklm/models',
    )
  })

  it('darwin: wizard installs models under userData (Application Support), not into the .app bundle', () => {
    expect(
      getWizardModelsDir(
        'darwin',
        '/Applications/LokLM.app/Contents/MacOS/LokLM',
        '/Users/x/Library/Application Support/LokLM',
      ),
    ).toBe('/Users/x/Library/Application Support/LokLM/models')
  })

  it('darwin without a userData dir falls back to the exec-sibling layout', () => {
    expect(getWizardModelsDir('darwin', '/Applications/LokLM.app/Contents/MacOS/LokLM', null)).toBe(
      '/Applications/LokLM.app/Contents/MacOS/models',
    )
  })

  it('windows: preserves a UNC install root', () => {
    expect(getWizardModelsDir('win32', '\\\\server\\share\\LokLM\\LokLM.exe', null)).toBe(
      '\\\\server\\share\\LokLM\\models',
    )
  })
})
