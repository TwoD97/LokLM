import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { getWizardModelsDir } from '../../src/main/services/models/paths'

describe('getWizardModelsDir', () => {
  it('windows: wizard installs models next to the executable', () => {
    expect(
      getWizardModelsDir(
        'win32',
        'C:\\Users\\x\\AppData\\Local\\Programs\\LokLM\\LokLM.exe',
        'C:\\Users\\x\\AppData\\Roaming\\LokLM',
      ),
    ).toBe(join('C:\\Users\\x\\AppData\\Local\\Programs\\LokLM', 'models'))
  })

  it('linux: wizard installs models next to the executable', () => {
    expect(getWizardModelsDir('linux', '/opt/loklm/loklm', '/home/x/.config/LokLM')).toBe(
      join('/opt/loklm', 'models'),
    )
  })

  it('darwin: wizard installs models under userData (Application Support), not into the .app bundle', () => {
    expect(
      getWizardModelsDir(
        'darwin',
        '/Applications/LokLM.app/Contents/MacOS/LokLM',
        '/Users/x/Library/Application Support/LokLM',
      ),
    ).toBe(join('/Users/x/Library/Application Support/LokLM', 'models'))
  })

  it('darwin without a userData dir falls back to the exec-sibling layout', () => {
    expect(getWizardModelsDir('darwin', '/Applications/LokLM.app/Contents/MacOS/LokLM', null)).toBe(
      join('/Applications/LokLM.app/Contents/MacOS', 'models'),
    )
  })
})
