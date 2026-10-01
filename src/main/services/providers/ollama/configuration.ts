import type { UserSettings } from '../../../../shared/settings'
import { isLoopbackBaseUrl } from '../../../../shared/networkHelpers'

/** The connector and remote-host consent apply to the connection. Model
 * selection is independent for chat, embeddings and optional reranking. */
export function ollamaProviderAvailability(
  config: UserSettings['advanced']['ollama'],
  connectorEnabled: boolean,
): { llm: boolean; embedder: boolean; reranker: boolean } {
  const permitted =
    connectorEnabled &&
    Boolean(config.baseUrl.trim()) &&
    (isLoopbackBaseUrl(config.baseUrl) || config.allowRemoteOllama)
  return {
    llm: permitted && Boolean(config.llmModel?.trim()),
    embedder: permitted && Boolean(config.embedderModel?.trim()),
    reranker: permitted && Boolean(config.rerankerModel?.trim()),
  }
}
