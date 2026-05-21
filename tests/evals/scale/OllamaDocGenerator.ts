import type { DocumentGenerator, TopicSeed } from './DocumentGenerator'

// env-fallback wie in synth/OllamaGenerator:
//   OLLAMA_BASE_URL , OLLAMA_BEARER_TOKEN , OLLAMA_LLM_MODEL

interface OllamaOptions {
  baseUrl?: string
  model?: string
  bearerToken?: string | null
}

interface OllamaResponse {
  response: string
  done: boolean
}

export class OllamaDocGenerator implements DocumentGenerator {
  readonly name: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly bearerToken: string | null

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = opts.baseUrl || process.env['OLLAMA_BASE_URL'] || 'http://127.0.0.1:11434'
    this.model = opts.model || process.env['OLLAMA_LLM_MODEL'] || 'llama3'
    this.bearerToken = opts.bearerToken ?? process.env['OLLAMA_BEARER_TOKEN'] ?? null
    if (this.bearerToken === '') this.bearerToken = null
    this.name = `ollama:${this.model}`
  }

  async generate(seed: TopicSeed): Promise<string> {
    const prompt = buildPrompt(seed)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.bearerToken) headers['authorization'] = `Bearer ${this.bearerToken}`
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers,
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
