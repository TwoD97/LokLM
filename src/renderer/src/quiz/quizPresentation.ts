// Trailing file extensions worth stripping from an auto-filled quiz name. Kept
// to a known document allowlist (mirrors the importer's accepted types, plus a
// few common variants) so titles like "Biology Ch.3" or "v1.2" aren't mangled
// by treating their suffix as an extension.
const STRIPPABLE_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'doc',
  'md',
  'markdown',
  'txt',
  'text',
  'json',
  'html',
  'htm',
  'rtf',
  'odt',
  'epub',
  'pptx',
  'ppt',
  'csv',
  'xlsx',
  'xls',
])

/** Default quiz name from a document title: the title with a known file
 *  extension removed (`lecture.pdf` → `lecture`), left untouched otherwise. */
export function defaultQuizName(title: string): string {
  const dot = title.lastIndexOf('.')
  if (dot > 0 && STRIPPABLE_EXTENSIONS.has(title.slice(dot + 1).toLowerCase())) {
    return title.slice(0, dot)
  }
  return title
}

export function scoreTone(pct: number): 'good' | 'mid' | 'low' {
  if (pct >= 80) return 'good'
  if (pct >= 50) return 'mid'
  return 'low'
}
