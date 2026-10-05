import type { RerankerProvider, ProviderRequestOptions } from '../types'
import type { OllamaClient } from './OllamaClient'

const SCORE_REGEX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

export class OllamaRerankerProvider implements RerankerProvider {
  constructor(
    private readonly client: OllamaClient,
    private readonly model: string,
  ) {}

  async rerank(
    query: string,
    passages: string[],
    opts?: ProviderRequestOptions,
  ): Promise<number[]> {
    opts?.abortSignal?.throwIfAborted()
    const scores: number[] = []
    for (const passage of passages) {
      opts?.abortSignal?.throwIfAborted()
      const data = await this.client.postJson<{
        message?: { content?: string }
        done?: boolean
        done_reason?: string
        error?: string
      }>(
        '/api/chat',
        {
          model: this.model,
          stream: false,
          options: { temperature: 0 },
          messages: [
            {
              role: 'system',
              content:
                'You rate how relevant a passage is to a query. ' +
                'Respond with ONLY a single number between 0 (irrelevant) and 1 (perfectly relevant). No words.',
            },
            { role: 'user', content: `Query: ${query}\n\nPassage: ${passage}\n\nScore:` },
          ],
        },
        opts?.abortSignal,
      )
      opts?.abortSignal?.throwIfAborted()
      // A malformed/incomplete generation is not a relevance score. Let
      // retrieval keep its hybrid order instead of silently replacing it with
      // zeros or a number copied from the passage/error message.
      if (data.error || data.done !== true || data.done_reason === 'length')
        throw new Error('Ollama reranker returned an incomplete score.')
      scores.push(parseScore(data.message?.content ?? ''))
    }
    return scores
  }

  isReady(): boolean {
    return true
  }

  async ensureReady(): Promise<void> {
    /* HTTP */
  }
}

function parseScore(s: string): number {
  const value = s.trim()
  const n = Number(value)
  if (!SCORE_REGEX.test(value) || !Number.isFinite(n) || n < 0 || n > 1)
    throw new Error('Ollama reranker returned an invalid score; expected one number from 0 to 1.')
  return n
}
