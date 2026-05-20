import type { RerankerProvider } from '../types'
import type { OllamaClient } from './OllamaClient'

const SCORE_REGEX = /-?\d+(?:\.\d+)?/

export class OllamaRerankerProvider implements RerankerProvider {
  constructor(
    private readonly client: OllamaClient,
    private readonly model: string,
  ) {}

  async rerank(query: string, passages: string[]): Promise<number[]> {
    const scores: number[] = []
    for (const passage of passages) {
      const data = await this.client.postJson<{ message?: { content?: string } }>('/api/chat', {
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
      })
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
  const m = s.match(SCORE_REGEX)
  if (!m) return 0
  const n = Number(m[0])
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
