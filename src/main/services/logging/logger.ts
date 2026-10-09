import { app } from 'electron'
import { promises as fs, writeSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'

const FILE_SIZE_CAP_BYTES = 5_000_000
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const FILE_LEVEL = 'warn' as const

let initialised = false

const SHUTDOWN_STAGES = Object.freeze({
  'private-writes': 'private-writes',
  indexing: 'indexing',
  'vault-lock': 'vault-lock',
  exit: 'exit',
} as const)

/** Fixed, content-free lifecycle receipts remain available when packaged
 * console logging is disabled. Never accepts a path, error or vault content. */
export function logShutdownStage(stage: keyof typeof SHUTDOWN_STAGES): void {
  if (typeof stage !== 'string' || !Object.hasOwn(SHUTDOWN_STAGES, stage)) return
  try {
    // One tiny write, with no pending callback/promise to extend shutdown.
    // A detached app may have no stderr; diagnostics must not block cleanup.
    writeSync(2, `[app] shutdown stage=${SHUTDOWN_STAGES[stage]} at=${Date.now()}\n`)
  } catch {
    // Closed/missing stderr is normal for some desktop launchers.
  }
}

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
