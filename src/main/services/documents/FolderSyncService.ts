import { readdir, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import type { WebContents } from 'electron'
import type { AuthService } from '../auth/AuthService'
import type { DocumentService } from './DocumentService'
import { isSupported } from './parser'

const DEBOUNCE_MS = 800

type Sender = WebContents | { send: (channel: string, payload: unknown) => void }

export interface SyncEvent {
  workspaceId: number
  phase: 'start' | 'progress' | 'done' | 'failed'
  /** Per-phase counters; populated incrementally. */
  imported: number
  reindexed: number
  /** Docs whose source vanished and just got the soft-missing marker on this
   *  pass. The renderer fans this out into the missing-banner ; sync itself
   *  never auto-deletes. */
  markedMissing: number
  unchanged: number
  /** Human-readable detail (the current file, or an error message on 'failed'). */
  detail?: string
}

export interface SyncResult {
  imported: number
  reindexed: number
  markedMissing: number
  unchanged: number
  /** Docs that were already marked missing in a prior pass and are still gone. */
  stillMissing: number
}

/**
 * Walks each watched folder for a workspace and reconciles it with the indexed
 * documents (matched by sourcePath). New supported files are imported, changed
 * files are reindexed via [[DocumentService.refreshDocument]], and indexed docs
 * whose source path now lives under a watched folder but no longer exists on
 * disk get a soft "missing" marker so the LibraryView banner can surface a
 * Keep / Remove choice. Sync itself is non-destructive ; the user owns delete.
 *
 * The marker scope is deliberately limited to *watched* folders so a user who
 * imported one-off files from their Desktop doesn't get a stale banner for
 * those rows the first time their Desktop changes. Docs imported from outside
 * any watch-folder are treated as user-owned and left alone.
 *
 * Watching uses node:fs.watch with recursive:true (works on Windows + macOS).
 * Events are debounced into a single sync run so a `git pull` that touches 200
 * files doesn't trigger 200 syncs.
 */
export class FolderSyncService {
  // workspaceId -> watchers (one per registered folder)
  private readonly watchers = new Map<number, FSWatcher[]>()
  // workspaceId -> pending debounce timer
  private readonly timers = new Map<number, NodeJS.Timeout>()
  // workspaceId -> tail of the in-flight sync chain. A user clicking "Sync now"
  // while the watcher debounce fires used to walk the same tree twice and
  // race on importFile, creating duplicate doc rows for the same path. We
  // serialize per-workspace via this promise chain instead.
  private readonly syncTails = new Map<number, Promise<unknown>>()
  private senderFactory: (() => Sender | undefined) | null = null

  constructor(
    private readonly auth: AuthService,
    private readonly documents: DocumentService,
  ) {}

  /** Allow main/index.ts to plug in a "broadcast to all renderer windows" sender
   *  so sync progress shows up in the UI without each caller passing one in. */
  setSenderFactory(fn: () => Sender | undefined): void {
    this.senderFactory = fn
  }

  async getFolders(workspaceId: number): Promise<string[]> {
    return this.auth.requireDatabase().workspaces().getSyncFolders(workspaceId)
  }

  async addFolder(workspaceId: number, folderPath: string): Promise<string[]> {
    const abs = resolve(folderPath)
    const folders = await this.getFolders(workspaceId)
    if (!folders.includes(abs)) folders.push(abs)
    await this.auth.requireDatabase().workspaces().setSyncFolders(workspaceId, folders)
    this.restartWatchers(workspaceId, folders)
    return folders
  }

  async removeFolder(workspaceId: number, folderPath: string): Promise<string[]> {
    const abs = resolve(folderPath)
    const folders = (await this.getFolders(workspaceId)).filter((p) => p !== abs)
    await this.auth.requireDatabase().workspaces().setSyncFolders(workspaceId, folders)
    this.restartWatchers(workspaceId, folders)
    return folders
  }

  /** One-shot reconciliation. Concurrent calls for the same workspace are
   *  serialised via syncTails so a watcher-debounce + manual "Sync now"
   *  combo can't double-import the same files. Different workspaces still
   *  run in parallel — the DB-level unique index on (workspace_id,
   *  source_path) is the belt-and-suspenders against accidental duplicates. */
  async sync(workspaceId: number): Promise<SyncResult> {
    const prev = this.syncTails.get(workspaceId) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(() => this.syncInternal(workspaceId))
    this.syncTails.set(
      workspaceId,
      run.finally(() => {
        // Only clear if we're still the tail — a queued sync that started
        // after `run` will have replaced this entry.
        if (this.syncTails.get(workspaceId) === run) this.syncTails.delete(workspaceId)
      }),
    )
    return run
  }

  private async syncInternal(workspaceId: number): Promise<SyncResult> {
    const send = (ev: Partial<SyncEvent> & Pick<SyncEvent, 'phase'>): void => {
      const sender = this.senderFactory?.()
      if (!sender) return
      try {
        sender.send('sync:progress', {
          workspaceId,
          imported: 0,
          reindexed: 0,
          markedMissing: 0,
          unchanged: 0,
          ...ev,
        })
      } catch {
        // renderer torn down
      }
    }
    send({ phase: 'start' })

    const folders = await this.getFolders(workspaceId)
    const result: SyncResult = {
      imported: 0,
      reindexed: 0,
      markedMissing: 0,
      unchanged: 0,
      stillMissing: 0,
    }
    if (folders.length === 0) {
      send({ phase: 'done', ...result })
      return result
    }

    try {
      // Snapshot indexed docs for this workspace once — the diff is computed
      // against this map and folder walks won't double-process.
      const docRepo = this.auth.requireDatabase().documents()
      const docs = await docRepo.listDocumentsByWorkspace(workspaceId)
      const docByPath = new Map(docs.map((d) => [d.sourcePath, d]))
      const seenPaths = new Set<string>()
      const watchedRoots = folders.map((f) => resolve(f))

      for (const folder of watchedRoots) {
        const files = await walkSupported(folder)
        for (const file of files) {
          seenPaths.add(file)
          const existing = docByPath.get(file)
          if (existing == null) {
            try {
              const sender = this.senderFactory?.()
              await this.documents.importFile({
                workspaceId,
                sourcePath: file,
                ...(sender ? { sender } : {}),
              })
              result.imported += 1
              send({
                phase: 'progress',
                detail: file,
                imported: result.imported,
                reindexed: result.reindexed,
                markedMissing: result.markedMissing,
                unchanged: result.unchanged,
              })
            } catch {
              // skip unsupported / too-large / unreadable — the sync run shouldn't
              // abort on a single bad file. Per-file errors surface via index
              // events on actual import attempts.
            }
            continue
          }
          // File found again — if the doc was previously marked missing, lift
          // the marker before/after the refresh so the banner removes it.
          if (existing.missingAt != null) {
            await docRepo.clearMissing(existing.id)
          }
          const sender = this.senderFactory?.()
          const outcome = await this.documents
            .refreshDocument(existing.id, sender ?? undefined)
            .catch(() => 'missing' as const)
          if (outcome === 'reindexed') {
            result.reindexed += 1
            send({
              phase: 'progress',
              detail: file,
              imported: result.imported,
              reindexed: result.reindexed,
              markedMissing: result.markedMissing,
              unchanged: result.unchanged,
            })
          } else if (outcome === 'unchanged') {
            result.unchanged += 1
          }
          // 'missing' here would be a TOCTOU race (walk saw the file, refresh
          // didn't) — treat as marked-missing on the next sync rather than now.
        }
      }

      // Anything indexed *under one of the watched roots* that we didn't see
      // during the walk has vanished. We don't auto-delete — instead the doc
      // gets a soft-missing marker so the renderer can surface a Keep/Remove
      // banner. The user owns the decision ; sync stays non-destructive.
      // Outside-of-root docs aren't touched (a one-off Desktop import that
      // got moved should stay until the user removes it manually).
      for (const doc of docs) {
        if (seenPaths.has(doc.sourcePath)) continue
        if (!isUnderAny(doc.sourcePath, watchedRoots)) continue
        if (doc.missingAt != null) {
          result.stillMissing += 1
          continue
        }
        await docRepo.markMissing(doc.id)
        result.markedMissing += 1
        send({
          phase: 'progress',
          detail: doc.sourcePath,
          imported: result.imported,
          reindexed: result.reindexed,
          markedMissing: result.markedMissing,
          unchanged: result.unchanged,
        })
      }
      send({ phase: 'done', ...result })
      return result
    } catch (err) {
      send({ phase: 'failed', detail: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /** Attach fs.watch on each folder for a workspace. Replaces any existing
   *  watcher set for that workspace. Call after login (per workspace) or
   *  whenever the folder list changes. */
  start(workspaceId: number): void {
    // Fire-and-forget: getFolders hits requireDatabase(), which throws if a lock
    // races in between login and this call. .catch keeps that from becoming an
    // unhandled rejection (matches scheduleSync's fire-and-forget handling).
    void this.getFolders(workspaceId)
      .then((folders) => {
        this.restartWatchers(workspaceId, folders)
      })
      .catch(() => undefined)
  }

  stop(workspaceId: number): void {
    const list = this.watchers.get(workspaceId)
    if (list) {
      for (const w of list) {
        try {
          w.close()
        } catch {
          // already closed
        }
      }
    }
    this.watchers.delete(workspaceId)
    const t = this.timers.get(workspaceId)
    if (t) clearTimeout(t)
    this.timers.delete(workspaceId)
  }

  stopAll(): void {
    for (const id of this.watchers.keys()) this.stop(id)
  }

  private restartWatchers(workspaceId: number, folders: string[]): void {
    this.stop(workspaceId)
    if (folders.length === 0) return
    const list: FSWatcher[] = []
    for (const folder of folders) {
      try {
        // Recursive watch is supported on Windows and macOS, which covers our
        // target platforms ; Linux falls back to non-recursive (so nested-dir
        // changes don't fire) but the user-visible "Sync now" button still
        // works. Errors thrown inside the listener kill the watcher silently —
        // wrap in try/catch so a single bad event doesn't take the whole
        // watch down.
        const w = watch(folder, { recursive: true }, () => {
          this.scheduleSync(workspaceId)
        })
        w.on('error', () => undefined)
        list.push(w)
      } catch {
        // folder doesn't exist (user deleted it post-add) — skip, the next
        // manual sync will surface zero matches.
      }
    }
    this.watchers.set(workspaceId, list)
  }

  private scheduleSync(workspaceId: number): void {
    const existing = this.timers.get(workspaceId)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      this.timers.delete(workspaceId)
      void this.sync(workspaceId).catch(() => undefined)
    }, DEBOUNCE_MS)
    if (typeof t.unref === 'function') t.unref()
    this.timers.set(workspaceId, t)
  }
}

async function walkSupported(root: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      // skip dotfiles + node_modules-shaped junk so a watch over a project root
      // doesn't try to import every .git/objects blob.
      if (e.name.startsWith('.')) continue
      if (e.name === 'node_modules') continue
      // Skip symlinks entirely. e.isFile() / e.isDirectory() follow symlinks ,
      // which lets a malicious symlink under a synced folder pull arbitrary
      // files outside the watched root into the index (and , via the
      // documents:openExternal path , into shell.openPath when the user
      // clicks "open in default app"). The `isSupported` extension filter
      // alone isn't enough: a .pdf symlink to a .lnk or .url is still a
      // shell-executable surface.
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile()) {
        if (!isSupported(full)) continue
        // double-check via stat — some Windows network shares lie about
        // size in readdir, and we'd rather skip than crash mid-sync.
        try {
          await stat(full)
        } catch {
          continue
        }
        out.push(full)
      }
    }
  }
  return out
}

function isUnderAny(path: string, roots: string[]): boolean {
  const abs = resolve(path)
  for (const root of roots) {
    const r =
      root.endsWith('/') || root.endsWith('\\')
        ? root
        : root + (process.platform === 'win32' ? '\\' : '/')
    if (abs === root) return true
    if (abs.toLowerCase().startsWith(r.toLowerCase())) return true
  }
  return false
}
