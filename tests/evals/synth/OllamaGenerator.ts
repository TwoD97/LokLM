import type { GeneratedQuestion, QuestionGenerator, SourceChunk } from './QuestionGenerator'

// ollama-provider , spricht die /api/generate http-route an.
// default-modell ist llama3 , kann per ctor überschrieben werden.
// kein streaming , wir brauchen den vollen text einmal am ende.

interface OllamaOptions {
  baseUrl?: string
  model?: string
}

interface OllamaResponse {
  response: string
  done: boolean
}

export class OllamaGenerator implements QuestionGenerator {
  readonly name: string
  private readonly baseUrl: string
  private readonly model: string

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'http://127.0.0.1:11434'
    this.model = opts.model ?? 'llama3'
    this.name = `ollama:${this.model}`
  }

  async generate(chunk: SourceChunk, n: number): Promise<GeneratedQuestion[]> {
    const prompt = buildPrompt(chunk.text, n)
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
    })
    if (!res.ok) {
      throw new Error(`ollama generate failed: ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as OllamaResponse
    return parseQuestions(data.response, chunk.id).slice(0, n)
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
