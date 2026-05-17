import type { DocumentGenerator, TopicSeed } from './DocumentGenerator'

interface OllamaOptions {
  baseUrl?: string
  model?: string
}

interface OllamaResponse {
  response: string
  done: boolean
}

export class OllamaDocGenerator implements DocumentGenerator {
  readonly name: string
  private readonly baseUrl: string
  private readonly model: string

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'http://127.0.0.1:11434'
    this.model = opts.model ?? 'llama3'
    this.name = `ollama:${this.model}`
  }

  async generate(seed: TopicSeed): Promise<string> {
    const prompt = buildPrompt(seed)
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0.9 },
      }),
    })
    if (!res.ok) {
      throw new Error(`ollama doc generate failed: ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as OllamaResponse
    return data.response.trim()
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
