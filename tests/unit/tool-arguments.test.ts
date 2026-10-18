import { describe, expect, it } from 'vitest'
import { validateToolArguments } from '@main/services/skills/validateToolArguments'

const email = {
  type: 'object',
  required: ['recipients', 'body'],
  additionalProperties: false,
  properties: {
    recipients: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string', minLength: 3, maxLength: 100 },
    },
    body: { type: 'string', minLength: 1, maxLength: 200 },
    priority: { type: 'integer', minimum: 1, maximum: 3 },
  },
}

describe('bounded tool argument validation', () => {
  it('accepts declared email arguments without mutating schema or data', () => {
    const args = Object.freeze({
      recipients: Object.freeze(['a@example.org']),
      body: 'Hello',
      priority: 2,
    })
    expect(() => validateToolArguments(email, args)).not.toThrow()
  })
  it.each([
    {},
    { recipients: 'a@example.org', body: 'Hello' },
    { recipients: [42], body: 'Hello' },
    { recipients: [], body: 'Hello' },
    { recipients: ['a@example.org'], body: '' },
    { recipients: ['a@example.org'], body: 'Hello', hiddenRecipient: 'evil@example.org' },
    { recipients: ['a@example.org'], body: 'Hello', priority: 1.5 },
    { recipients: ['a@example.org'], body: 'Hello', priority: 4 },
  ])('rejects malformed email arguments %# without disclosing values', (args) => {
    expect(() => validateToolArguments(email, args)).toThrow('TOOL_ARGUMENTS_INVALID')
    try {
      validateToolArguments(email, args)
    } catch (error) {
      expect(String(error)).not.toContain('example.org')
    }
  })
  it('checks additional properties against their declared schema', () => {
    const schema = {
      type: 'object',
      additionalProperties: { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 },
    }
    expect(() => validateToolArguments(schema, { a: 1, b: 9 })).not.toThrow()
    for (const value of [0, 10, '1'])
      expect(() => validateToolArguments(schema, { a: value })).toThrow()
  })
  it('supports nullable types, Unicode lengths, enum and deep object const', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { type: ['string', 'null'], enum: [null, '😀'], maxLength: 1 },
        fixed: { const: { a: 1, b: [2] } },
      },
    }
    expect(() =>
      validateToolArguments(schema, { value: '😀', fixed: { b: [2], a: 1 } }),
    ).not.toThrow()
    expect(() => validateToolArguments(schema, { value: null })).not.toThrow()
    expect(() => validateToolArguments(schema, { value: 'x' })).toThrow()
    expect(() => validateToolArguments(schema, { fixed: { a: 1, b: [3] } })).toThrow()
  })
  it('checks allOf, anyOf and exactly one matching oneOf branch', () => {
    const schema = {
      type: 'object',
      properties: {
        value: {
          allOf: [{ type: 'number' }, { minimum: 0 }],
          anyOf: [{ maximum: 2 }, { minimum: 8 }],
          oneOf: [{ maximum: 10 }, { minimum: 10 }],
        },
      },
    }
    expect(() => validateToolArguments(schema, { value: 1 })).not.toThrow()
    expect(() => validateToolArguments(schema, { value: 9 })).not.toThrow()
    for (const value of [-1, 5, 10])
      expect(() => validateToolArguments(schema, { value })).toThrow()
  })
  it('resolves escaped and URI-encoded local pointers with sibling constraints', () => {
    const schema = {
      $defs: { 'a/b~c': { type: 'integer', minimum: 1 } },
      type: 'object',
      properties: { value: { $ref: '#/%24defs/a~1b~0c', maximum: 3 } },
    }
    expect(() => validateToolArguments(schema, { value: 2 })).not.toThrow()
    expect(() => validateToolArguments(schema, { value: 4 })).toThrow()
    expect(() => validateToolArguments(schema, { value: '2' })).toThrow()
  })
  it.each(['https://example.org/schema', '#/missing', '#anchor', '#/~3'])(
    'rejects unresolved or unsupported reference %s without network access',
    ($ref) => {
      expect(() =>
        validateToolArguments({ type: 'object', properties: { value: { $ref } } }, { value: 1 }),
      ).toThrow('schema reference')
    },
  )
  it('allows finite recursive data but bounds schemas that recurse without progress', () => {
    const schema = {
      type: 'object',
      properties: { child: { $ref: '#' }, value: { type: 'string' } },
    }
    expect(() =>
      validateToolArguments(schema, { child: { child: { value: 'leaf' } } }),
    ).not.toThrow()
    expect(() => validateToolArguments({ $ref: '#' }, {})).toThrow('complexity limit')
  })
  it('validates tuple items and disallows extra values', () => {
    const schema = {
      type: 'object',
      properties: {
        values: {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'number' }],
          items: false,
        },
      },
    }
    expect(() => validateToolArguments(schema, { values: ['a', 1] })).not.toThrow()
    expect(() => validateToolArguments(schema, { values: ['a', 'wrong'] })).toThrow()
    expect(() => validateToolArguments(schema, { values: ['a', 1, 2] })).toThrow()
  })
  it('never compiles untrusted patterns and documents unsupported validation keywords', () => {
    expect(() =>
      validateToolArguments(
        {
          type: 'object',
          properties: { value: { type: 'string', pattern: '(', format: 'untrusted-format' } },
        },
        { value: 'text' },
      ),
    ).not.toThrow()
  })
  it('rejects cyclic, oversized, deeply nested and non-JSON inputs', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => validateToolArguments({}, cyclic)).toThrow('cycle')
    expect(() => validateToolArguments({}, { value: 'x'.repeat(64_001) })).toThrow('size limit')
    let deep: Record<string, unknown> = {}
    for (let i = 0; i < 40; i++) deep = { child: deep }
    expect(() => validateToolArguments({}, deep)).toThrow('complexity limit')
    for (const value of [NaN, Infinity, undefined, 1n, new Date(), () => 1])
      expect(() => validateToolArguments({}, { value })).toThrow('JSON')
  })
  it('bounds combinatorial alternative validation', () => {
    const branch = { anyOf: Array.from({ length: 64 }, () => ({ type: 'number' })) }
    const schema = {
      type: 'object',
      properties: {
        values: { type: 'array', items: { anyOf: Array.from({ length: 64 }, () => branch) } },
      },
    }
    expect(() => validateToolArguments(schema, { values: ['not a number'] })).toThrow()
    // The limit also applies before validation to oversized untrusted schemas.
    expect(() => validateToolArguments({ description: 'x'.repeat(64_001) }, {})).toThrow(
      'size limit',
    )
  })
})
