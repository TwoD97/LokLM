import type { AuthService } from '@main/services/auth/AuthService'
import type { ProviderRegistry } from '@main/services/providers/Registry'
import { DocumentService } from '@main/services/documents/DocumentService'
import { RetrievalService } from '@main/services/retrieval/RetrievalService'
import { WorkspaceVectorService } from '@main/services/storage/WorkspaceVectorService'

/** Match the application's index wiring. Without this sink/search pair the
 * legacy GPU tests computed embeddings but exercised lexical-only retrieval. */
export function retrievalServices(auth: AuthService, registry: ProviderRegistry) {
  const vectors = new WorkspaceVectorService(auth)
  const documents = new DocumentService(
    auth,
    registry,
    undefined,
    undefined,
    (workspaceId, records) => vectors.upsert(workspaceId, records),
    (workspaceId, ids) => vectors.remove(workspaceId, ids),
  )
  const retrieval = new RetrievalService(
    auth.requireDatabase(),
    registry,
    (workspaceId, query, limit, opts) => vectors.search(workspaceId, query, limit, opts),
    (workspaceId) => auth.getWorkspaceDb(workspaceId),
  )
  return { documents, retrieval }
}
