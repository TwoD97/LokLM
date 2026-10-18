/** Bounded JSON Schema subset for tool arguments. Supports local JSON Pointer
 * refs, type unions, object fields, array items, combinators, enum/const, lengths
 * and numeric bounds. Remote refs are rejected. Annotations and unsupported
 * keywords (including pattern, format, patternProperties, unevaluatedProperties,
 * dependentSchemas, contains and conditional schemas) are not evaluated. This
 * is an argument-shape check, never an authorization or server-side validator.
 * In particular, untrusted schemas never compile regexes or fetch resources. */
type Schema = Record<string, unknown> | boolean
const MAX_DEPTH = 32
const MAX_VISITS = 20_000
const MAX_BYTES = 64_000
class Mismatch extends Error {}
class InvalidSchema extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function schema(value: unknown): Schema {
  if (typeof value !== 'boolean' && !object(value))
    throw new InvalidSchema('Unsupported tool schema structure.')
  return value
}

/** Reject cycles, non-JSON values and excessive trees before stringifying. */
function checkJson(value: unknown): void {
  let visits = 0
  let bytes = 0
  const parents = new Set<object>()
  const visit = (next: unknown, depth: number): void => {
    if (++visits > MAX_VISITS || depth > MAX_DEPTH)
      throw new InvalidSchema('Tool arguments or schema exceed the complexity limit.')
    if (typeof next === 'string') bytes += Buffer.byteLength(next)
    else if (typeof next === 'number') {
      if (!Number.isFinite(next))
        throw new InvalidSchema('Tool arguments must contain finite JSON values.')
    } else if (next !== null && typeof next !== 'boolean') {
      if (typeof next !== 'object')
        throw new InvalidSchema('Tool arguments must contain JSON values.')
      if (parents.has(next)) throw new InvalidSchema('Tool arguments or schema contain a cycle.')
      if (
        Object.getPrototypeOf(next) !== Object.prototype &&
        Object.getPrototypeOf(next) !== null &&
        !Array.isArray(next)
      )
        throw new InvalidSchema('Tool arguments must contain plain JSON objects.')
      parents.add(next)
      if (Array.isArray(next)) {
        if (next.length > MAX_VISITS)
          throw new InvalidSchema('Tool arguments or schema exceed the complexity limit.')
        for (const item of next) visit(item, depth + 1)
      } else {
        for (const key in next) {
          if (!Object.hasOwn(next, key)) continue
          bytes += Buffer.byteLength(key)
          visit((next as Record<string, unknown>)[key], depth + 1)
        }
      }
      parents.delete(next)
    }
    if (bytes > MAX_BYTES)
      throw new InvalidSchema('Tool arguments or schema exceed the size limit.')
  }
  visit(value, 0)
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES)
    throw new InvalidSchema('Tool arguments or schema exceed the size limit.')
}

export function validateToolArguments(
  root: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  try {
    if (!object(root) || !object(args))
      throw new Mismatch('Tool arguments and schema must be objects.')
    checkJson(root)
    checkJson(args)
    let visits = 0
    const budget = (depth: number): void => {
      if (++visits > MAX_VISITS || depth > MAX_DEPTH)
        throw new InvalidSchema('Tool schema validation exceeds the complexity limit.')
    }
    const equal = (left: unknown, right: unknown, depth = 0): boolean => {
      budget(depth)
      if (left === right) return true
      if (Array.isArray(left) && Array.isArray(right))
        return (
          left.length === right.length &&
          left.every((item, index) => equal(item, right[index], depth + 1))
        )
      if (object(left) && object(right)) {
        const keys = Object.keys(left)
        return (
          keys.length === Object.keys(right).length &&
          keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key], depth + 1))
        )
      }
      return false
    }
    const resolve = (reference: unknown): Schema => {
      if (typeof reference !== 'string' || !reference.startsWith('#'))
        throw new InvalidSchema('Remote tool schema references are not supported.')
      let pointer: string
      try {
        pointer = decodeURIComponent(reference.slice(1))
      } catch {
        throw new InvalidSchema('Invalid local tool schema reference.')
      }
      if (pointer === '') return root
      if (!pointer.startsWith('/'))
        throw new InvalidSchema('Only local JSON Pointer schema references are supported.')
      let current: unknown = root
      for (const segment of pointer.slice(1).split('/')) {
        if (/~(?:[^01]|$)/.test(segment))
          throw new InvalidSchema('Invalid local tool schema reference.')
        const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
        if ((!object(current) && !Array.isArray(current)) || !Object.hasOwn(current, key))
          throw new InvalidSchema('Local tool schema reference was not found.')
        current = (current as Record<string, unknown>)[key]
      }
      return schema(current)
    }
    const numeric = (
      definition: Record<string, unknown>,
      key: string,
      integer = false,
    ): number | undefined => {
      const value = definition[key]
      if (value === undefined) return undefined
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (integer && (!Number.isSafeInteger(value) || value < 0))
      )
        throw new InvalidSchema('Invalid numeric tool schema constraint.')
      return value
    }
    const hasType = (value: unknown, type: unknown): boolean => {
      switch (type) {
        case 'null':
          return value === null
        case 'object':
          return object(value)
        case 'array':
          return Array.isArray(value)
        case 'string':
          return typeof value === 'string'
        case 'boolean':
          return typeof value === 'boolean'
        case 'number':
          return typeof value === 'number' && Number.isFinite(value)
        case 'integer':
          return typeof value === 'number' && Number.isInteger(value)
        default:
          throw new InvalidSchema('Unknown declared tool argument type.')
      }
    }
    const validate = (definition: Schema, value: unknown, depth: number): void => {
      budget(depth)
      if (definition === true) return
      if (definition === false) throw new Mismatch('Tool arguments contain a forbidden value.')
      if (definition.$ref !== undefined) validate(resolve(definition.$ref), value, depth + 1)
      if (definition.type !== undefined) {
        const types = Array.isArray(definition.type) ? definition.type : [definition.type]
        if (!types.length || types.length > 7)
          throw new InvalidSchema('Invalid declared tool argument type.')
        // Evaluate every declared type so malformed unions cannot hide behind a match.
        if (!types.map((type) => hasType(value, type)).some(Boolean))
          throw new Mismatch('Tool argument has the wrong type.')
      }
      if (Object.hasOwn(definition, 'const') && !equal(value, definition.const))
        throw new Mismatch('Tool argument does not match its required constant.')
      if (definition.enum !== undefined) {
        if (!Array.isArray(definition.enum) || !definition.enum.length)
          throw new InvalidSchema('Invalid tool argument enum.')
        if (!definition.enum.some((entry) => equal(value, entry)))
          throw new Mismatch('Tool argument is outside its allowed values.')
      }
      for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
        const choices = definition[key]
        if (choices === undefined) continue
        if (!Array.isArray(choices) || !choices.length || choices.length > 64)
          throw new InvalidSchema('Invalid tool schema alternatives.')
        let matched = 0
        for (const choice of choices) {
          try {
            validate(schema(choice), value, depth + 1)
            matched++
          } catch (error) {
            if (!(error instanceof Mismatch) || key === 'allOf') throw error
          }
          if (key === 'anyOf' && matched > 0) break
        }
        if (matched === 0 || (key === 'oneOf' && matched !== 1))
          throw new Mismatch('Tool arguments do not match the declared alternatives.')
      }
      if (typeof value === 'string') {
        const length = [...value].length
        const min = numeric(definition, 'minLength', true)
        const max = numeric(definition, 'maxLength', true)
        if ((min !== undefined && length < min) || (max !== undefined && length > max))
          throw new Mismatch('Tool argument text length is outside the allowed range.')
      }
      if (typeof value === 'number') {
        for (const [key, accepts] of [
          ['minimum', (bound: number) => value >= bound],
          ['maximum', (bound: number) => value <= bound],
          ['exclusiveMinimum', (bound: number) => value > bound],
          ['exclusiveMaximum', (bound: number) => value < bound],
        ] as const) {
          const bound = numeric(definition, key)
          if (bound !== undefined && !accepts(bound))
            throw new Mismatch('Tool argument number is outside the allowed range.')
        }
      }
      if (Array.isArray(value)) {
        const min = numeric(definition, 'minItems', true)
        const max = numeric(definition, 'maxItems', true)
        if ((min !== undefined && value.length < min) || (max !== undefined && value.length > max))
          throw new Mismatch('Tool argument array length is outside the allowed range.')
        const prefix =
          definition.prefixItems ?? (Array.isArray(definition.items) ? definition.items : [])
        if (!Array.isArray(prefix)) throw new InvalidSchema('Invalid tool tuple schema.')
        const items = Array.isArray(definition.items)
          ? definition.additionalItems
          : definition.items
        for (let index = 0; index < value.length; index++) {
          const itemSchema = index < prefix.length ? prefix[index] : items
          if (itemSchema !== undefined) validate(schema(itemSchema), value[index], depth + 1)
        }
      }
      if (object(value)) {
        const required = definition.required ?? []
        if (!Array.isArray(required) || required.some((key) => typeof key !== 'string'))
          throw new InvalidSchema('Invalid required tool argument fields.')
        for (const key of required as string[])
          if (!Object.hasOwn(value, key)) throw new Mismatch('A required tool argument is missing.')
        const properties = definition.properties ?? {}
        if (!object(properties)) throw new InvalidSchema('Invalid tool argument properties.')
        const min = numeric(definition, 'minProperties', true)
        const max = numeric(definition, 'maxProperties', true)
        const keys = Object.keys(value)
        if ((min !== undefined && keys.length < min) || (max !== undefined && keys.length > max))
          throw new Mismatch('Tool argument object has the wrong number of fields.')
        for (const key of keys) {
          if (Object.hasOwn(properties, key))
            validate(schema(properties[key]), value[key], depth + 1)
          else if (definition.additionalProperties !== undefined)
            validate(schema(definition.additionalProperties), value[key], depth + 1)
        }
      }
    }
    validate(root, args, 0)
  } catch (error) {
    const message =
      error instanceof Mismatch || error instanceof InvalidSchema
        ? error.message
        : 'Tool arguments or schema could not be validated.'
    throw new Error(`TOOL_ARGUMENTS_INVALID: ${message}`)
  }
}
