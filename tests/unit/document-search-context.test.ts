import { describe, expect, it } from 'vitest'
import { documentEmbeddingInput } from '@main/services/documents/searchContext'

describe('document embedding input compatibility', () => {
  it('preserves legacy prose exactly, including whitespace and German punctuation', () => {
    const source = '  Übernachtungen: 12.345; Auslastung: 64,2 %.\n'
    for (const prefix of [undefined, null, '']) {
      expect(documentEmbeddingInput(source, prefix)).toBe(source)
    }
  })

  it('keeps persisted code metadata separate without normalizing either input', () => {
    const source = '\nfunction readPDF() { return 1 }\n'
    expect(documentEmbeddingInput(source, 'src/readPDF.ts read PDF')).toBe(
      'src/readPDF.ts read PDF\n\nfunction readPDF() { return 1 }\n',
    )
  })
})
