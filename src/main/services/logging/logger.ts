import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'

const FILE_SIZE_CAP_BYTES = 5_000_000
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const FILE_LEVEL = 'warn' as const

let initialised = false

export function initLogger(): void {
  if (initialised) return
  initialised = true

  // electron-log v5: enables the renderer-side bridge so `import 'electron-log/renderer'`
  // forwards log calls + window 'error'/'unhandledrejection' to this main-process file.
  log.initialize()

  log.transports.file.level = FILE_LEVEL
  log.transports.file.maxSize = FILE_SIZE_CAP_BYTES
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.file.resolvePathFn = (variables) =>
    join(app.getPath('logs'), variables.fileName ?? 'main.log')

  // Console stays at default level in dev, off in production — file is the source of truth.
  log.transports.console.level = app.isPackaged ? false : 'info'

  // Intercept the existing ~21 ad-hoc console.error/warn call sites without touching them.
  Object.assign(console, log.functions)

  // uncaughtException + unhandledRejection in the main process.
  log.errorHandler.startCatching({ showDialog: false })

  void purgeOldLogs().catch((err) => {
    log.warn('log purge sweep failed', err)
  })
}

export async function purgeOldLogs(now: number = Date.now()): Promise<number> {
  const dir = app.getPath('logs')
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  await Promise.all(
    entries.map(async (name) => {
      if (!name.endsWith('.log')) return
      const full = join(dir, name)
      try {
        const stat = await fs.stat(full)
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          await fs.unlink(full)
          removed++
        }
      } catch {
        // racing rotation or transient FS error — leave the file.
      }
    }),
  )
  return removed
}

export function getLogDir(): string {
  return app.getPath('logs')
}
