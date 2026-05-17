import type { DocumentGenerator, TopicSeed } from './DocumentGenerator'

interface AnthropicOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>
}

export class AnthropicDocGenerator implements DocumentGenerator {
  readonly name: string
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(opts: AnthropicOptions = {}) {
    const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      throw new Error('AnthropicDocGenerator: ANTHROPIC_API_KEY ist nicht gesetzt.')
    }
    this.apiKey = apiKey
    this.model = opts.model ?? 'claude-haiku-4-5-20251001'
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com'
    this.name = `anthropic:${this.model}`
  }

  async generate(seed: TopicSeed): Promise<string> {
    const prompt = buildPrompt(seed)
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`anthropic doc generate failed: ${res.status} ${body}`)
    }
    const data = (await res.json()) as AnthropicResponse
    return data.content
      .map((c) => c.text)
      .join('\n')
      .trim()
  }
}

function buildPrompt(seed: TopicSeed): string {
  const style = seed.style ?? 'fachartikel'
  return [
    `Schreibe einen ${style} auf deutsch zum Thema:`,
    seed.topic,
    ``,
    `Länge: 600 bis 1500 Wörter. Sachlicher Ton , keine Werbung , keine Listen ,`,
    `keine Überschriften. Reine Fließtext-Absätze. Schreibe inhaltlich`,
    `eigenständig und vermeide es , offensichtliche Fragen wörtlich aus dem`,
    `Topic zu wiederholen. Liefere nur den Text , keine Erklärung darum.`,
  ].join('\n')
}
