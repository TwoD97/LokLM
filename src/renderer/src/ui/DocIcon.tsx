import {
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import './docIcon.css'

/** Colour tone per file-type bucket — drives the icon tint (see docIcon.css). */
type DocTone = 'pdf' | 'doc' | 'md' | 'code' | 'sheet' | 'image' | 'txt'

// Mirrors the CODE_EXT bucket in src/main/db/sqlite/WorkspaceDb.ts (docTypeOf),
// the single source of truth for the 'code' library type. Kept in sync by hand;
// a drift only changes an icon, never behaviour.
const CODE_EXT = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'swift',
  'sh',
  'sql',
  'html',
  'css',
  'scss',
  'xml',
  'vue',
  'toml',
  'yaml',
  'yml',
])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])
const SHEET_EXT = new Set(['csv', 'tsv', 'xlsx', 'xls'])

/** Maps a filename / source path to a file-type icon + colour tone. A superset
 *  of the main-process docTypeOf bucketing (adds json / image / spreadsheet
 *  visuals), used to give the file tree per-type icons like a code editor. */
function classify(pathOrName: string): { Icon: LucideIcon; tone: DocTone } {
  const ext = pathOrName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') return { Icon: FileText, tone: 'pdf' }
  if (ext === 'docx' || ext === 'doc') return { Icon: FileText, tone: 'doc' }
  if (ext === 'md' || ext === 'markdown') return { Icon: FileText, tone: 'md' }
  if (ext === 'json') return { Icon: FileJson, tone: 'code' }
  if (CODE_EXT.has(ext)) return { Icon: FileCode, tone: 'code' }
  if (IMAGE_EXT.has(ext)) return { Icon: FileImage, tone: 'image' }
  if (SHEET_EXT.has(ext)) return { Icon: FileSpreadsheet, tone: 'sheet' }
  return { Icon: FileText, tone: 'txt' }
}

/** File-type icon for a document. `source` is the document's sourcePath (or any
 *  filename) — the extension is read off the end. Decorative: aria-hidden. */
export function DocIcon({
  source,
  size = 14,
  className,
}: {
  source: string
  size?: number
  className?: string
}): JSX.Element {
  const { Icon, tone } = classify(source)
  return (
    <Icon
      size={size}
      aria-hidden="true"
      className={`doc-icon doc-icon--${tone}${className ? ` ${className}` : ''}`}
    />
  )
}
