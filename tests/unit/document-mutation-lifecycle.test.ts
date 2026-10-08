import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DocumentService } from '@main/services/documents/DocumentService'
import { deferred } from './fixtures/retrievalHarness'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'loklm-document-mutation-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const sourcePath = join(directory, 'source.txt')
  await writeFile(sourcePath, 'Original source')
  const makeRepo = (workspaceId: number) => {
    let doc = {
      id: 1,
      workspaceId,
      sourcePath,
      title: `Source ${workspaceId}`,
      status: 'pending',
      contentHash: null as string | null,
      byteSize: 0,
      sourceMtime: null as number | null,
      missingAt: null,
    }
    let exists = true
    let ids: number[] = []
    let nextId = 1
    return {
      findByWorkspaceAndPath: vi.fn(async () => null as typeof doc | null),
      addDocument: vi.fn(async () => ({ ...doc })),
      getDocument: vi.fn(async () => (exists ? { ...doc } : null)),
      setDocumentStatus: vi.fn(async (_id: number, status: string) => {
        doc.status = status
      }),
      setSourceMetadata: vi.fn(async (_id: number, fields: Partial<typeof doc>) => {
        doc = { ...doc, ...fields }
      }),
      clearMissing: vi.fn(async () => {}),
      reindexDocument: vi.fn(async () => {
        ids = []
        doc.status = 'pending'
      }),
      chunkIdsForDocument: vi.fn(async () => [...ids]),
      persistChunks: vi.fn(async (_id: number, chunks: unknown[]) => {
        ids = chunks.map(() => nextId++)
        return [...ids]
      }),
      markChunksEmbedded: vi.fn(async () => {}),
      deleteDocument: vi.fn(async () => {
        exists = false
        ids = []
      }),
    }
  }
  const original = makeRepo(3)
  const other = makeRepo(8)
  let active = original
  const auth = {
    isUnlocked: () => true,
    requireDatabase: () => ({
      documents: () => active,
      documentsFor: async (id: number) => (id === 3 ? original : other),
    }),
  }
  const lease = { update: vi.fn(), release: vi.fn() }
  const embedder = {
    beginIndexing: vi.fn(async () => lease),
    ensureReady: vi.fn(async () => {}),
    isReady: () => true,
    preferredBatchSize: () => 4,
    identity: () => 'fixture',
    embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0]))),
  }
  let parsed = 0
  const worker = {
    registerOcrProgress: () => () => {},
    parseAndChunk: vi.fn(async () => ({
      chunks: [
        {
          ordinal: 0,
          text: `Revision ${++parsed}`,
          pageFrom: 1,
          pageTo: 1,
          headingPath: null,
          language: null,
        },
      ],
    })),
  }
  const sink = vi.fn(async () => {})
  const remove = vi.fn(async () => {})
  const service = new DocumentService(
    auth as never,
    { embedder: () => embedder } as never,
    worker as never,
    undefined,
    sink,
    remove,
  )
  return {
    service,
    sourcePath,
    original,
    other,
    embedder,
    worker,
    sink,
    remove,
    lease,
    switchWorkspace: () => {
      active = other
    },
  }
}

describe('document mutation lifecycle', () => {
  it('refreshes changed-length content even when a sync tool preserves the indexed mtime', async () => {
    const f = await fixture()
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    const before = await stat(f.sourcePath)
    await f.original.setSourceMetadata(1, {
      sourceMtime: Math.round(before.mtimeMs),
      byteSize: before.size,
      contentHash: createHash('sha256').update('Original source').digest('hex'),
    })
    const replacement = 'Replacement source has substantially different content and length.'
    await writeFile(f.sourcePath, replacement)
    await utimes(f.sourcePath, before.atime, before.mtime)

    expect(await f.service.refreshDocument(1)).toBe('reindexed')
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.worker.parseAndChunk).toHaveBeenCalledTimes(2)
    expect(await f.original.getDocument()).toEqual(
      expect.objectContaining({
        byteSize: Buffer.byteLength(replacement),
        contentHash: createHash('sha256').update(replacement).digest('hex'),
      }),
    )
  })
  it.each(['reindex', 'refresh', 'replace', 'delete'] as const)(
    'retires SQLite chunk IDs before vector cleanup during %s',
    async (action) => {
      const f = await fixture()
      await f.original.persistChunks(1, [{}])
      f.remove.mockImplementationOnce(async () => {
        expect(await f.original.chunkIdsForDocument()).toEqual([])
        if (action === 'delete') expect(await f.original.getDocument()).toBeNull()
        // New indexing must wait until the old vector purge has finished.
        expect(f.worker.parseAndChunk).not.toHaveBeenCalled()
      })
      if (action === 'delete') await f.service.deleteDocuments([1])
      else if (action === 'refresh') await f.service.refreshDocument(1)
      else if (action === 'replace') await f.service.replaceSource(1, f.sourcePath)
      else await f.service.reindex(1)
      await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
      expect(f.remove).toHaveBeenCalledWith(3, [1])
    },
  )

  it.each(['reindex', 'delete'] as const)(
    'preserves source metadata and vectors when the SQLite %s fails',
    async (action) => {
      const f = await fixture()
      await f.original.persistChunks(1, [{}])
      const before = await f.original.getDocument()
      const mutation = action === 'delete' ? f.original.deleteDocument : f.original.reindexDocument
      mutation.mockRejectedValueOnce(new Error('SQLite write failed'))
      await expect(
        action === 'delete' ? f.service.deleteDocuments([1]) : f.service.reindex(1),
      ).rejects.toThrow('SQLite write failed')
      expect(f.remove).not.toHaveBeenCalled()
      expect(await f.original.chunkIdsForDocument()).toEqual([1])
      expect(await f.original.getDocument()).toEqual(before)
      expect(f.original.setSourceMetadata).not.toHaveBeenCalled()
      expect(f.service.isIndexing()).toBe(false)
    },
  )

  it.each(['reindex', 'delete'] as const)(
    'finishes retired-vector cleanup if session invalidation follows the SQLite %s',
    async (action) => {
      const f = await fixture()
      await f.original.persistChunks(1, [{}])
      const mutation = action === 'delete' ? f.original.deleteDocument : f.original.reindexDocument
      const original = mutation.getMockImplementation()!
      mutation.mockImplementationOnce(async () => {
        await original()
        f.service.invalidateSession()
      })
      await expect(
        action === 'delete' ? f.service.deleteDocuments([1]) : f.service.reindex(1),
      ).rejects.toThrow('session is closed')
      expect(f.remove).toHaveBeenCalledWith(3, [1])
      expect(await f.original.chunkIdsForDocument()).toEqual([])
      expect(f.worker.parseAndChunk).not.toHaveBeenCalled()
      expect(f.service.isIndexing()).toBe(false)
    },
  )

  it.each(['reindex', 'delete'] as const)(
    'drains the pending %s cleanup before allowing the captured store to close',
    async (action) => {
      const f = await fixture()
      await f.original.persistChunks(1, [{}])
      const cleanup = deferred<void>()
      f.remove.mockReturnValueOnce(cleanup.promise)
      const mutation = action === 'delete' ? f.service.deleteDocuments([1]) : f.service.reindex(1)
      const failedAfterInvalidation = expect(mutation).rejects.toThrow('session is closed')
      await vi.waitFor(() => expect(f.remove).toHaveBeenCalledOnce())
      f.service.invalidateSession()
      let drained = false
      const drain = f.service.drainMutations().then(() => {
        drained = true
      })
      await Promise.resolve()
      expect(drained).toBe(false)
      await expect(f.service.reindex(1)).rejects.toThrow('session is closed')
      cleanup.resolve()
      await Promise.all([failedAfterInvalidation, drain])
      expect(drained).toBe(true)
      expect(f.worker.parseAndChunk).not.toHaveBeenCalled()
    },
  )

  it('drains a canceled import before reindexing and only persists the replacement revision', async () => {
    const f = await fixture()
    const firstBatch = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.embed.mockReturnValueOnce(firstBatch.promise)
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    const reindex = f.service.reindex(1)
    // Wait until the asynchronous source hash has finished and Stop reached
    // the batch boundary, without completing the native call on its behalf.
    await vi.waitFor(() =>
      expect(
        (
          f.service as unknown as {
            activeJobs: Map<string, { cancelled: boolean }>
          }
        ).activeJobs.get('3:1')?.cancelled,
      ).toBe(true),
    )
    expect(f.original.reindexDocument).not.toHaveBeenCalled()
    expect(f.worker.parseAndChunk).toHaveBeenCalledOnce()
    firstBatch.resolve([new Float32Array([1, 0])])
    await reindex
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.original.deleteDocument).not.toHaveBeenCalled()
    expect(f.original.persistChunks).toHaveBeenCalledOnce()
    expect(f.original.persistChunks).toHaveBeenCalledWith(1, [
      expect.objectContaining({ text: 'Revision 2' }),
    ])
    expect(f.lease.release).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent reindex requests without overlapping same-document embedding writes', async () => {
    const f = await fixture()
    let active = 0
    let peak = 0
    f.embedder.embed.mockImplementation(async (texts: string[]) => {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      active--
      return texts.map(() => new Float32Array([1, 0]))
    })
    await Promise.all([f.service.reindex(1), f.service.reindex(1), f.service.reindex(1)])
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(peak).toBe(1)
    expect(f.original.reindexDocument).toHaveBeenCalledTimes(3)
    expect(f.original.setDocumentStatus).toHaveBeenLastCalledWith(1, 'ready')
  })

  it('waits for an in-flight vector write before deleting its newly persisted chunk ids', async () => {
    const f = await fixture()
    const write = deferred<void>()
    f.sink.mockReturnValueOnce(write.promise)
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.sink).toHaveBeenCalledOnce())
    const deletion = f.service.deleteDocuments([1])
    await vi.waitFor(() => expect(f.original.getDocument).toHaveBeenCalled())
    expect(f.original.deleteDocument).not.toHaveBeenCalled()
    expect(f.remove).not.toHaveBeenCalled()
    write.resolve()
    await deletion
    expect(f.remove).toHaveBeenCalledWith(3, [1])
    expect(f.original.deleteDocument).toHaveBeenCalledOnce()
    expect(f.service.isIndexing()).toBe(false)
  })

  it('keeps a reindex in its original workspace when navigation changes during file validation', async () => {
    const f = await fixture()
    const operation = f.service.reindex(1)
    f.switchWorkspace()
    await operation
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.original.reindexDocument).toHaveBeenCalledWith(1)
    expect(f.other.reindexDocument).not.toHaveBeenCalled()
    expect(f.other.setSourceMetadata).not.toHaveBeenCalled()
    expect(f.sink).toHaveBeenCalledWith(3, expect.anything())
  })

  it('lets background refresh and deletion select an inactive workspace explicitly', async () => {
    const f = await fixture()
    f.switchWorkspace()
    expect(await f.service.refreshDocument(1, undefined, 3)).toBe('reindexed')
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    await f.service.deleteDocuments([1], 3)
    expect(f.original.reindexDocument).toHaveBeenCalledOnce()
    expect(f.original.deleteDocument).toHaveBeenCalledOnce()
    expect(f.other.getDocument).not.toHaveBeenCalled()
    expect(f.other.deleteDocument).not.toHaveBeenCalled()
  })

  it('rejects an already imported replacement source before wiping existing evidence', async () => {
    const f = await fixture()
    const replacement = join(directory, 'already-imported.txt')
    await writeFile(replacement, 'Different existing source')
    f.original.findByWorkspaceAndPath.mockResolvedValueOnce({
      ...(await f.original.getDocument())!,
      id: 2,
      sourcePath: replacement,
    })
    await expect(f.service.replaceSource(1, replacement)).rejects.toMatchObject({
      code: 'already_imported',
    })
    expect(f.original.reindexDocument).not.toHaveBeenCalled()
    expect(f.remove).not.toHaveBeenCalled()
    expect(f.original.setSourceMetadata).not.toHaveBeenCalled()
  })

  it('replaces the explicitly captured document when a picker finishes after workspace navigation', async () => {
    const f = await fixture()
    const originalWorkspaceId = (await f.original.getDocument())!.workspaceId
    const replacement = join(directory, 'replacement.txt')
    await writeFile(replacement, 'Replacement source from the original picker')
    // Both workspaces contain document 1. The picker began in workspace 3,
    // but the user activated workspace 8 before selecting the new file.
    f.switchWorkspace()
    const doc = await f.service.replaceSource(1, replacement, undefined, originalWorkspaceId)
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(doc).toMatchObject({ id: 1, workspaceId: 3, sourcePath: replacement })
    expect(f.original.setSourceMetadata).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ sourcePath: replacement }),
    )
    expect(f.original.reindexDocument).toHaveBeenCalledWith(1)
    expect(f.sink).toHaveBeenCalledWith(3, expect.anything())
    expect(f.other.getDocument).not.toHaveBeenCalled()
    expect(f.other.reindexDocument).not.toHaveBeenCalled()
    expect(f.other.setSourceMetadata).not.toHaveBeenCalled()
  })

  it('drops late parser results and progress after session invalidation', async () => {
    const f = await fixture()
    const parsing = deferred<Awaited<ReturnType<typeof f.worker.parseAndChunk>>>()
    f.worker.parseAndChunk.mockReturnValueOnce(parsing.promise)
    const send = vi.fn()
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath, sender: { send } })
    await vi.waitFor(() => expect(f.worker.parseAndChunk).toHaveBeenCalledOnce())
    f.service.invalidateSession()
    f.switchWorkspace()
    const eventCount = send.mock.calls.length
    parsing.resolve({
      chunks: [
        {
          ordinal: 0,
          text: 'Old secret',
          pageFrom: 1,
          pageTo: 1,
          headingPath: null,
          language: null,
        },
      ],
    })
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.embedder.embed).not.toHaveBeenCalled()
    expect(f.original.persistChunks).not.toHaveBeenCalled()
    expect(f.other.persistChunks).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(eventCount)
    expect(f.embedder.beginIndexing).not.toHaveBeenCalled()
    expect(f.lease.release).not.toHaveBeenCalled()
    await expect(
      f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath }),
    ).rejects.toThrow('session is closed')
    await expect(
      f.service.importGeneratedText({
        workspaceId: 3,
        title: 'Old source',
        text: 'Old secret',
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow('session is closed')
  })

  it('never persists a native embedding batch completed after the vault session ends', async () => {
    const f = await fixture()
    const native = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.embed.mockReturnValueOnce(native.promise)
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    f.service.invalidateSession()
    f.switchWorkspace()
    native.resolve([new Float32Array([1, 0])])
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.original.persistChunks).not.toHaveBeenCalled()
    expect(f.sink).not.toHaveBeenCalled()
    expect(f.other.setDocumentStatus).not.toHaveBeenCalled()
    expect(f.original.setDocumentStatus).toHaveBeenCalledTimes(1)
    expect(f.lease.release).toHaveBeenCalledOnce()
  })

  it('rejects a pending destructive mutation once its session is invalidated', async () => {
    const f = await fixture()
    const native = deferred<Float32Array<ArrayBuffer>[]>()
    f.embedder.embed.mockReturnValueOnce(native.promise)
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.embedder.embed).toHaveBeenCalledOnce())
    const deletion = f.service.deleteDocuments([1])
    const assertion = expect(deletion).rejects.toThrow('session is closed')
    await vi.waitFor(() => expect(f.original.getDocument).toHaveBeenCalled())
    f.service.invalidateSession()
    native.resolve([new Float32Array([1, 0])])
    await assertion
    expect(f.remove).not.toHaveBeenCalled()
    expect(f.original.deleteDocument).not.toHaveBeenCalled()
    expect(f.other.deleteDocument).not.toHaveBeenCalled()
  })

  it('does not publish ready status or embedding markers after a late vector write', async () => {
    const f = await fixture()
    const write = deferred<void>()
    f.sink.mockReturnValueOnce(write.promise)
    await f.service.importFile({ workspaceId: 3, sourcePath: f.sourcePath })
    await vi.waitFor(() => expect(f.sink).toHaveBeenCalledOnce())
    f.service.invalidateSession()
    write.resolve()
    await vi.waitFor(() => expect(f.service.isIndexing()).toBe(false))
    expect(f.original.markChunksEmbedded).not.toHaveBeenCalled()
    expect(f.original.setDocumentStatus).toHaveBeenCalledTimes(1)
  })
})
