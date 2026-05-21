import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { quoteForPowerShellSingle, parseRegQueryValue } = require('../lib.cjs') as {
  quoteForPowerShellSingle: (value: unknown) => string
  parseRegQueryValue: (stdout: string, name: string) => string | null
}

describe('quoteForPowerShellSingle', () => {
  it('leaves plain ASCII paths untouched', () => {
    expect(quoteForPowerShellSingle('C:\\Users\\Alice\\Programs\\LokLM')).toBe(
      'C:\\Users\\Alice\\Programs\\LokLM',
    )
  })

  it('doubles a single embedded apostrophe (PowerShell escape)', () => {
    expect(quoteForPowerShellSingle("C:\\Users\\O'Brien\\LokLM")).toBe("C:\\Users\\O''Brien\\LokLM")
  })

  it('doubles every apostrophe when multiple are present', () => {
    expect(quoteForPowerShellSingle("a'b'c'd")).toBe("a''b''c''d")
  })

  it('strips CR/LF so injected newlines cannot break out of the string', () => {
    const dangerous = "C:\\tmp\r\n'; Remove-Item C:\\ -Recurse -Force; '"
    const safe = quoteForPowerShellSingle(dangerous)
    expect(safe).not.toContain('\n')
    expect(safe).not.toContain('\r')
    // The injected apostrophes still get doubled, so even after CR/LF strip
    // the payload remains data, not code.
    expect(safe).toBe("C:\\tmp''; Remove-Item C:\\ -Recurse -Force; ''")
  })

  it('handles an empty string', () => {
    expect(quoteForPowerShellSingle('')).toBe('')
  })

  it('coerces non-string input via String()', () => {
    expect(quoteForPowerShellSingle(42 as unknown as string)).toBe('42')
    expect(quoteForPowerShellSingle(null as unknown as string)).toBe('null')
    expect(quoteForPowerShellSingle(undefined as unknown as string)).toBe('undefined')
  })

  it('does not modify backslashes (Windows paths must survive)', () => {
    const path = 'C:\\Program Files\\LokLM\\bin\\LokLM.exe'
    expect(quoteForPowerShellSingle(path)).toBe(path)
  })
})

describe('parseRegQueryValue', () => {
  it('extracts a REG_SZ value from typical reg.exe output', () => {
    const stdout = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LokLM',
      '    InstallLocation    REG_SZ    C:\\Users\\Alice\\AppData\\Local\\Programs\\LokLM',
      '',
    ].join('\r\n')

    expect(parseRegQueryValue(stdout, 'InstallLocation')).toBe(
      'C:\\Users\\Alice\\AppData\\Local\\Programs\\LokLM',
    )
  })

  it('preserves single spaces inside values like "Program Files"', () => {
    const stdout =
      'HKEY_CURRENT_USER\\Software\\LokLM\r\n    Path    REG_SZ    C:\\Program Files\\LokLM\r\n'
    expect(parseRegQueryValue(stdout, 'Path')).toBe('C:\\Program Files\\LokLM')
  })

  it('returns null when the named value is not in the output', () => {
    const stdout = 'HKEY_CURRENT_USER\\Software\\LokLM\r\n    Other    REG_SZ    something\r\n'
    expect(parseRegQueryValue(stdout, 'Missing')).toBeNull()
  })

  it('returns null on empty stdout', () => {
    expect(parseRegQueryValue('', 'Anything')).toBeNull()
  })

  it('returns null when the value line has fewer than three columns', () => {
    // Malformed line: no type column. Defensive — reg.exe should never emit
    // this, but we don't want to misinterpret the type as the value.
    const stdout = 'HKEY_CURRENT_USER\\Software\\LokLM\r\n    Broken\r\n'
    expect(parseRegQueryValue(stdout, 'Broken')).toBeNull()
  })

  it('handles LF-only line endings as well as CRLF', () => {
    const stdout = 'HKEY_CURRENT_USER\\Software\\LokLM\n    Foo    REG_SZ    bar\n'
    expect(parseRegQueryValue(stdout, 'Foo')).toBe('bar')
  })

  it('handles a REG_DWORD value (hex prefix in data column)', () => {
    const stdout = 'HKEY_CURRENT_USER\\Software\\LokLM\r\n    NoModify    REG_DWORD    0x1\r\n'
    expect(parseRegQueryValue(stdout, 'NoModify')).toBe('0x1')
  })
})
