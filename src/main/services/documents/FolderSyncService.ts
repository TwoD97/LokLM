import { readdir, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import type { WebContents } from 'electron'
import type { AuthService } from '../auth/AuthService'
import type { DocumentService } from './DocumentService'
import type { WorkspaceDbFacade } from '../storage/WorkspaceDbFacade'
import type { WorkspaceStore } from '../storage/WorkspaceStore'
import { isSupported } from './parser'
import { classifyCodebase, type CodebaseClassification } from '../codebase/classify'
import { IGNORED_DIRS, isPathIgnored, isDirIncluded, fileTrack } from '../codebase/ignore'
import {
  loadGitignore,
  loadDirIgnore,
  isGitignored,
  type GitignoreLayer,
} from '../codebase/gitignore'
import { isCodebaseIndexingEnabled } from '../tier/TierMarker'

const DEBOUNCE_MS = 800

/** Cap on files inspected for codebase classification — keeps the classify walk
 *  cheap on huge monorepos; the marker-file + ratio signal saturates well before
 *  this. */
const CLASSIFY_FILE_CAP = 5000

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
  private readonly database: WorkspaceDbFacade
  private readonly workspaceStore: WorkspaceStore
  private invalidated = false
  // workspaceId -> watchers (one per registered folder)
  private readonly watchers = new Map<number, FSWatcher[]>()
  // workspaceId -> pending debounce timer
  private readonly timers = new Map<number, NodeJS.Timeout>()
  // A stop/restart owns the watcher set even if an earlier start is still
  // awaiting its folder snapshot.
  private readonly pendingStarts = new Map<number, symbol>()
  // Scans and root-list mutations share one workspace queue. Otherwise a scan
  // can import new rows after removeFolder deleted that root's indexed copies,
  // and concurrent add/remove read-modify-writes can lose each other's roots.
  private readonly syncTails = new Map<number, Promise<unknown>>()
  private senderFactory: (() => Sender | undefined) | null = null

  constructor(
    auth: AuthService,
    private readonly documents: DocumentService,
  ) {
    this.database = auth.requireDatabase()
    this.workspaceStore = auth.getWorkspaceStore()
  }

  invalidateSession(): void {
    this.invalidated = true
    this.stopAll()
  }

  private assertSession(): void {
    if (this.invalidated) throw new Error('Folder sync session is closed.')
  }

  /** Allow main/index.ts to plug in a "broadcast to all renderer windows" sender
   *  so sync progress shows up in the UI without each caller passing one in. */
  setSenderFactory(fn: () => Sender | undefined): void {
    this.senderFactory = fn
  }

  async getFolders(workspaceId: number): Promise<string[]> {
    this.assertSession()
    return this.database.workspaces().getSyncFolders(workspaceId)
  }

  async addFolder(workspaceId: number, folderPath: string): Promise<string[]> {
    return this.withWorkspaceOperation(workspaceId, () =>
      this.addFolderInternal(workspaceId, folderPath),
    )
  }

  private async addFolderInternal(workspaceId: number, folderPath: string): Promise<string[]> {
    const abs = resolve(folderPath)
    const folders = await this.getFolders(workspaceId)
    this.assertSession()
    if (!folders.includes(abs)) folders.push(abs)
    await this.database.workspaces().setSyncFolders(workspaceId, folders)
    this.restartWatchers(workspaceId, folders)
    // ADR-0006: auto-classify so syncing a project folder flips the workspace to
    // 'codebase'. Best-effort + fire-and-forget — never block adding the folder.
    void this.classifyFolders(workspaceId).catch(() => undefined)
    return folders
  }

  /**
   * Walks the workspace's synced folders (honouring the default ignore rules) and
   * classifies them (ADR-0006). When the folder looks like a source project the
   * workspace type is flipped to 'codebase'. Returns the classification so the
   * renderer can show the detected language / offer an override. Never downgrades
   * a 'codebase' back to 'library' automatically — that's a user decision.
   */
  async classifyFolders(workspaceId: number): Promise<CodebaseClassification> {
    const folders = await this.getFolders(workspaceId)
    const rels: string[] = []
    for (const folder of folders) {
      this.assertSession()
      if (rels.length >= CLASSIFY_FILE_CAP) break
      await walkForClassification(resolve(folder), rels, CLASSIFY_FILE_CAP)
    }
    const classification = classifyCodebase(rels)
    this.assertSession()
    // Codebase indexing is a Standard+Pro feature (chosen 2026-06-26). On the
    // Lite tier the folder still syncs, but the workspace stays 'library' and is
    // embedded with BGE-M3 — never flipped to 'codebase' / the Qwen code model.
    // The classification is still returned so the renderer can surface an
    // "upgrade to index as code" hint. No-marker (dev/legacy) keeps full access.
    if (classification.isCodebase && isCodebaseIndexingEnabled()) {
      await this.database.workspaces().setType(workspaceId, 'codebase')
    }
    return classification
  }

  async removeFolder(workspaceId: number, folderPath: string): Promise<string[]> {
    return this.withWorkspaceOperation(workspaceId, () =>
      this.removeFolderInternal(workspaceId, folderPath),
    )
  }

  private async removeFolderInternal(workspaceId: number, folderPath: string): Promise<string[]> {
    const abs = resolve(folderPath)
    const folders = (await this.getFolders(workspaceId)).filter((p) => p !== abs)
    this.assertSession()
    // Removing a folder also removes its indexed copies: docs whose source
    // lives under the removed root (and not under a folder that is still
    // synced) are deleted outright — chunks cascade, and the Lance vectors are
    // dropped via DocumentService.deleteDocuments. Without this the docs
    // stayed behind as permanent orphans: still searchable, their chunks and
    // embeddings parked in the workspace vault, and no later sync pass would
    // ever mark them missing (the marker scope is watched folders only).
    // Keep the root connected until cleanup succeeds. A failure must reach the
    // caller and leave a retryable root instead of silently orphaning its rows.
    const docs = await this.database.documents().listDocumentsByWorkspace(workspaceId)
    this.assertSession()
    const doomed = docs.filter(
      (d) => isUnderAny(d.sourcePath, [abs]) && !isUnderAny(d.sourcePath, folders),
    )
    if (doomed.length > 0) {
      await this.documents.deleteDocuments(
        doomed.map((d) => d.id),
        workspaceId,
      )
    }
    this.assertSession()
    // ADR-0006: drop the folder's index-dir selection so a later re-add starts clean.
    await this.database.workspaces().clearIndexDirs(workspaceId, abs)
    this.assertSession()
    await this.database.workspaces().setSyncFolders(workspaceId, folders)
    this.restartWatchers(workspaceId, folders)
    return folders
  }

  /** One-shot reconciliation. Concurrent calls for the same workspace are
   *  serialised via syncTails so a watcher-debounce + manual "Sync now"
   *  combo can't double-import the same files. Different workspaces still
   *  run in parallel — the DB-level unique index on (workspace_id,
   *  source_path) is the belt-and-suspenders against accidental duplicates. */
  async sync(workspaceId: number): Promise<SyncResult> {
    return this.withWorkspaceOperation(workspaceId, () => this.syncInternal(workspaceId))
  }

  private withWorkspaceOperation<T>(workspaceId: number, operation: () => Promise<T>): Promise<T> {
    this.assertSession()
    const prev = this.syncTails.get(workspaceId) ?? Promise.resolve()
    const run = prev
      .catch(() => undefined)
      .then(() => {
        this.assertSession()
        return operation()
      })
    // The stored tail swallows rejections: a failed sync surfaces to the caller
    // via the returned `run`, but the tail kept in the map has no consumer, so an
    // unhandled error there would crash out as an unhandled rejection. The
    // cleanup clears the entry only if a newer sync hasn't replaced it — compared
    // against `tail` (what we actually store), not `run`.
    const tail: Promise<unknown> = run
      .catch(() => undefined)
      .finally(() => {
        if (this.syncTails.get(workspaceId) === tail) this.syncTails.delete(workspaceId)
      })
    this.syncTails.set(workspaceId, tail)
    return run
  }

  private async syncInternal(workspaceId: number): Promise<SyncResult> {
    this.assertSession()
    const empty = (): SyncResult => ({
      imported: 0,
      reindexed: 0,
      markedMissing: 0,
      unchanged: 0,
      stillMissing: 0,
    })

    // Keep the existing active-workspace scheduling policy: don't start an
    // inactive library's scan/model work merely because its watcher fired.
    // workspaces:activate starts a fresh reconciliation later. Once a scan
    // starts, all its reads/writes remain pinned even if navigation changes.
    // getWorkspaceStore() throws when the session is locked, which is itself a
    // "don't sync now" signal — treat it the same way.
    let activeId: number | null
    try {
      activeId = this.workspaceStore.activeWorkspaceId()
    } catch {
      return empty()
    }
    if (activeId !== workspaceId) return empty()

    const send = (ev: Partial<SyncEvent> & Pick<SyncEvent, 'phase'>): void => {
      if (this.invalidated) return
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
    this.assertSession()
    const result: SyncResult = empty()
    if (folders.length === 0) {
      send({ phase: 'done', ...result })
      return result
    }

    try {
      // Snapshot indexed docs for this workspace once — the diff is computed
      // against this map and folder walks won't double-process.
      const docRepo = await this.database.documentsFor(workspaceId)
      const docs = await docRepo.listDocumentsByWorkspace(workspaceId)
      const docByPath = new Map(docs.map((d) => [d.sourcePath, d]))
      const seenPaths = new Set<string>()
      const watchedRoots = folders.map((f) => resolve(f))

      // ADR-0006: codebase workspaces ingest source + prose files (the code/doc
      // tracks); library workspaces ingest only the supported document types.
      const wss = await this.database.workspaces().list()
      const isCodebase = wss.find((w) => w.id === workspaceId)?.type === 'codebase'

      for (const folder of watchedRoots) {
        this.assertSession()
        let files: string[]
        if (isCodebase) {
          // ADR-0006: honor the folder's .gitignore(s) — loaded per-directory inside
          // the walk (nested-aware). When the folder has no root .gitignore, apply the
          // user's top-level-dir selection instead (empty set = index all).
          const hasRootGitignore = (await loadGitignore(folder)) !== null
          const includeDirs = hasRootGitignore
            ? new Set<string>()
            : new Set(await this.database.workspaces().getIndexDirs(workspaceId, folder))
          files = await walkIndexable(folder, includeDirs)
        } else {
          files = await walkSupported(folder)
        }
        for (const file of files) {
          this.assertSession()
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
          this.assertSession()
          const sender = this.senderFactory?.()
          const outcome = await this.documents
            .refreshDocument(existing.id, sender ?? undefined, workspaceId)
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
        this.assertSession()
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
    if (this.invalidated) return
    const pending = Symbol()
    this.pendingStarts.set(workspaceId, pending)
    // Fire-and-forget: getFolders hits requireDatabase(), which throws if a lock
    // races in between login and this call. .catch keeps that from becoming an
    // unhandled rejection (matches scheduleSync's fire-and-forget handling).
    void this.getFolders(workspaceId)
      .then((folders) => {
        if (this.pendingStarts.get(workspaceId) !== pending) return
        this.pendingStarts.delete(workspaceId)
        this.restartWatchers(workspaceId, folders)
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.pendingStarts.get(workspaceId) === pending) this.pendingStarts.delete(workspaceId)
      })
  }

  stop(workspaceId: number): void {
    this.pendingStarts.delete(workspaceId)
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
    this.pendingStarts.clear()
    for (const id of this.watchers.keys()) this.stop(id)
    for (const id of this.timers.keys()) this.stop(id)
  }

  private restartWatchers(workspaceId: number, folders: string[]): void {
    this.stop(workspaceId)
    if (this.invalidated) return
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
    if (this.invalidated) return
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

/** Collects file paths (relative to `root`) for codebase classification, pruning
 *  ignored directories so vendored/build trees don't skew the ratio and the walk
 *  stays cheap. Caps total files at `cap`. Unlike walkSupported this sees ALL
 *  files (code + docs), since classification keys off code extensions. */
async function walkForClassification(root: string, out: string[], cap: number): Promise<void> {
  const rootIg = await loadDirIgnore(root, true)
  const base: GitignoreLayer[] = rootIg ? [{ base: '', ig: rootIg }] : []
  await classifyDir(root, root, base, out, cap)
}

async function classifyDir(
  absDir: string,
  root: string,
  layers: GitignoreLayer[],
  out: string[],
  cap: number,
): Promise<void> {
  if (out.length >= cap) return
  let entries
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  const dirLayers = await extendLayers(layers, absDir, root)
  for (const e of entries) {
    if (out.length >= cap) break
    if (e.isSymbolicLink()) continue
    const full = join(absDir, e.name)
    const rel = relative(root, full)
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue
      if (isGitignored(dirLayers, rel, true)) continue
      await classifyDir(full, root, dirLayers, out, cap)
    } else if (e.isFile()) {
      if (isPathIgnored(rel)) continue
      if (isGitignored(dirLayers, rel, false)) continue
      out.push(rel)
    }
  }
}

/** Codebase walk (ADR-0006): collects code + doc track files under `root`,
 *  pruning ignored directories (node_modules, .git, dist, …) and skipped files
 *  (binaries, lockfiles, oversized) via the default ignore rules + nested
 *  .gitignore(s) + the user's top-level-dir selection (when there's no root
 *  .gitignore). Recursive so each directory's .gitignore scopes its subtree.
 *  Symlinks are skipped for the same shell-surface reason as walkSupported. */
async function walkIndexable(root: string, includeDirs: ReadonlySet<string>): Promise<string[]> {
  const out: string[] = []
  const rootIg = await loadDirIgnore(root, true)
  const base: GitignoreLayer[] = rootIg ? [{ base: '', ig: rootIg }] : []
  await indexDir(root, root, base, includeDirs, out)
  return out
}

async function indexDir(
  absDir: string,
  root: string,
  layers: GitignoreLayer[],
  includeDirs: ReadonlySet<string>,
  out: string[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  const dirLayers = await extendLayers(layers, absDir, root)
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const full = join(absDir, e.name)
    const rel = relative(root, full)
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue
      // Pruning an ignored dir skips its whole subtree (and matches git: you can't
      // re-include a file under an excluded dir).
      if (isGitignored(dirLayers, rel, true)) continue
      if (!isDirIncluded(rel, includeDirs)) continue
      await indexDir(full, root, dirLayers, includeDirs, out)
    } else if (e.isFile()) {
      if (isGitignored(dirLayers, rel, false)) continue
      if (!isDirIncluded(rel, includeDirs)) continue
      let size: number
      try {
        size = (await stat(full)).size
      } catch {
        continue
      }
      if (fileTrack(rel, size) === 'skip') continue
      out.push(full)
    }
  }
}

/** Appends a directory's own .gitignore (if any) to the layer stack, scoped to
 *  that directory. The root's .gitignore is already in `layers`, so it's skipped. */
async function extendLayers(
  layers: GitignoreLayer[],
  absDir: string,
  root: string,
): Promise<GitignoreLayer[]> {
  if (absDir === root) return layers
  const ig = await loadDirIgnore(absDir, false)
  if (!ig) return layers
  return [...layers, { base: relative(root, absDir).replace(/\\/g, '/'), ig }]
}

function isUnderAny(path: string, roots: string[]): boolean {
  const abs = resolve(path)
  return roots.some((root) => {
    // Follow the platform's path rules: case-folding POSIX paths can delete
    // a distinct sibling's indexed documents. Windows relative() handles case
    // variants, while absolute results keep different drives outside the root.
    const rel = relative(resolve(root), abs)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  })
}
