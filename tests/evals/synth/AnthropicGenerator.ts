import type { GeneratedQuestion, QuestionGenerator, SourceChunk } from './QuestionGenerator'

// anthropic-provider , spricht die messages-api an.
// braucht ANTHROPIC_API_KEY in env , sonst wirft der ctor.
// kein anthropic-sdk import , reines fetch damit der scaffold ohne extra dep läuft.

interface AnthropicOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>
}

export class AnthropicGenerator implements QuestionGenerator {
  readonly name: string
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(opts: AnthropicOptions = {}) {
    const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      throw new Error('AnthropicGenerator: ANTHROPIC_API_KEY ist nicht gesetzt.')
    }
    this.apiKey = apiKey
    this.model = opts.model ?? 'claude-haiku-4-5-20251001'
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com'
    this.name = `anthropic:${this.model}`
  }

  async generate(chunk: SourceChunk, n: number): Promise<GeneratedQuestion[]> {
    const prompt = buildPrompt(chunk.text, n)
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`anthropic generate failed: ${res.status} ${body}`)
    }
    const data = (await res.json()) as AnthropicResponse
    const text = data.content.map((c) => c.text).join('\n')
    return parseQuestions(text, chunk.id).slice(0, n)
  }
}

function buildPrompt(text: string, n: number): string {
  return [
    `Du bekommst einen Textauszug. Erzeuge genau ${n} faktische Fragen,`,
    `deren Antwort eindeutig in diesem Auszug steht. Eine Frage pro Zeile,`,
    `ohne Nummerierung und ohne Anführungszeichen. Keine Antworten ausgeben.`,
    ``,
    `Text:`,
    text,
  ].join('\n')
}

function parseQuestions(raw: string, chunkId: string): GeneratedQuestion[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith('?'))
    .map((question) => ({ chunkId, question }))
}
