import { describe, it, expect } from 'vitest'
import { parseAndValidate } from '../../src/main/services/quiz/generation'

const allowed = new Set([10, 11, 12])

describe('parseAndValidate', () => {
  const validJson = JSON.stringify({
    stem: 'What is 2+2?',
    options: ['3', '4', '5', '6'],
    correct_index: 1,
    explanation: 'Basic arithmetic.',
    source_chunk_ids: [10],
  })

  it('accepts a well-formed JSON object', () => {
    const result = parseAndValidate(validJson, allowed)
    expect(result).not.toBeNull()
    expect(result?.stem).toBe('What is 2+2?')
    expect(result?.correctIndex).toBe(1)
    expect(result?.sourceChunkIds).toEqual([10])
  })

  it('tolerates code-fenced output', () => {
    const wrapped = '```json\n' + validJson + '\n```'
    expect(parseAndValidate(wrapped, allowed)).not.toBeNull()
  })

  it('tolerates surrounding prose', () => {
    const padded = 'Here is your question: ' + validJson + ' Hope that helps.'
    expect(parseAndValidate(padded, allowed)).not.toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseAndValidate('{ stem: "x" }', allowed)).toBeNull()
    expect(parseAndValidate('not json at all', allowed)).toBeNull()
  })

  it('rejects when options is not length 4', () => {
    const bad = JSON.stringify({
      stem: 's',
      options: ['a', 'b', 'c'],
      correct_index: 0,
      explanation: 'x',
      source_chunk_ids: [10],
    })
    expect(parseAndValidate(bad, allowed)).toBeNull()
  })

  it('rejects when options contain duplicates', () => {
    const bad = JSON.stringify({
      stem: 's',
      options: ['a', 'b', 'b', 'c'],
      correct_index: 0,
      explanation: 'x',
      source_chunk_ids: [10],
    })
    expect(parseAndValidate(bad, allowed)).toBeNull()
  })

  it('rejects when correct_index out of range', () => {
    const bad = JSON.stringify({
      stem: 's',
      options: ['a', 'b', 'c', 'd'],
      correct_index: 4,
      explanation: 'x',
      source_chunk_ids: [10],
    })
    expect(parseAndValidate(bad, allowed)).toBeNull()
  })

  it('rejects when stem or explanation is empty', () => {
    const bad1 = JSON.stringify({
      stem: '',
      options: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'x',
      source_chunk_ids: [10],
    })
    const bad2 = JSON.stringify({
      stem: 's',
      options: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: '   ',
      source_chunk_ids: [10],
    })
    expect(parseAndValidate(bad1, allowed)).toBeNull()
    expect(parseAndValidate(bad2, allowed)).toBeNull()
  })

  it('filters source_chunk_ids to the allowed set, falling back to the first allowed id', () => {
    const obj = {
      stem: 's',
      options: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'x',
      source_chunk_ids: [99, 12], // 99 not allowed, 12 is
    }
    const result = parseAndValidate(JSON.stringify(obj), allowed)
    expect(result?.sourceChunkIds).toEqual([12])
  })

  it('falls back to the first allowed id when no source_chunk_ids overlap', () => {
    const obj = {
      stem: 's',
      options: ['a', 'b', 'c', 'd'],
      correct_index: 0,
      explanation: 'x',
      source_chunk_ids: [999],
    }
    const result = parseAndValidate(JSON.stringify(obj), allowed)
    // Set iteration order = insertion order. We passed [10, 11, 12].
    expect(result?.sourceChunkIds).toEqual([10])
  })
})
