// Pure helpers extracted from main.cjs so they can be unit-tested without
// pulling in the Electron runtime. Anything in this file must stay free of
// side effects (no fs, no execFile, no app.* calls) so the test project
// `installer-ui` can run on any platform without spinning up Electron.

/**
 * Quote a value for use inside a PowerShell single-quoted string literal.
 *
 * PowerShell's single-quoted strings treat the only escape sequence as `''`
 * (two single quotes) which inserts a literal single quote. Everything else
 * is taken verbatim. We also strip CR/LF so a path with embedded newlines
 * (shouldn't happen via showOpenDialog, but the install path is ultimately
 * user-controlled) can't break out of the string and inject script lines.
 *
 * Anything non-string is coerced via String() so the caller doesn't need to
 * remember to coerce upstream.
 */
function quoteForPowerShellSingle(value) {
  return String(value).replace(/[\r\n]/g, '').replace(/'/g, "''")
}

/**
 * Parse `reg.exe query KEY /v NAME` stdout and return the value, or null if
 * the named value isn't in the output.
 *
 * reg.exe stdout layout (Windows 10/11):
 *
 *   HKEY_CURRENT_USER\Software\Foo
 *       ValueName    REG_SZ    Some Value
 *
 * Columns are separated by 4+ spaces. We split on /\s{2,}/ to be tolerant of
 * different reg.exe builds that pad with tabs vs spaces. Values can contain
 * single spaces (e.g. "C:\\Program Files\\App") so we re-join everything
 * past column[1] (the type).
 *
 * Returns null when the value name isn't found or the line doesn't have at
 * least three columns (name, type, data).
 */
function parseRegQueryValue(stdout, name) {
  const line = String(stdout)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
  if (!line) return null

  const parts = line.split(/\s{2,}/)
  return parts.length >= 3 ? parts.slice(2).join('  ').trim() : null
}

module.exports = {
  quoteForPowerShellSingle,
  parseRegQueryValue,
}
