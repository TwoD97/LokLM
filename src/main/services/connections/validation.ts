import { isIP } from 'node:net'
import type { McpConnectionConfig } from '../../../shared/connections'

export const CONNECTIONS_KEY = 'connections.mcp.v1'
export const LIMITS = {
  connections: 32,
  configBytes: 256_000,
  messageBytes: 2_000_000,
  tools: 256,
  pages: 16,
  argumentsBytes: 64_000,
  resultChars: 64_000,
} as const

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP_INVALID: Expected an object.')
  return value as Record<string, unknown>
}

function string(value: unknown, max: number, label: string, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (!empty && !value.trim())
  )
    throw new Error(`MCP_INVALID: Invalid ${label}.`)
  return value
}

export function connectionId(value: unknown): string {
  const id = string(value, 80, 'connection ID')
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('MCP_INVALID: Invalid connection ID.')
  return id
}

function secrets(value: unknown, headers: boolean): Record<string, string> {
  const entries = Object.entries(record(value))
  if (entries.length > 64) throw new Error('MCP_INVALID: Too many configuration fields.')
  const out: Record<string, string> = Object.create(null)
  const seen = new Set<string>()
  for (const [key, raw] of entries) {
    if (
      !/^[a-zA-Z_][a-zA-Z0-9_-]{0,99}$/.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      throw new Error('MCP_INVALID: Invalid configuration field name.')
    const text = string(raw, 8192, 'configuration value', true)
    if (headers) {
      const normalized = key.toLowerCase()
      if (
        /[\r\n]/.test(text) ||
        seen.has(normalized) ||
        /^(host|connection|content-length|transfer-encoding|accept|content-type|mcp-session-id|mcp-protocol-version)$/.test(
          normalized,
        )
      )
        throw new Error('MCP_INVALID: Reserved or invalid HTTP header.')
      seen.add(normalized)
    }
    out[key] = text
  }
  return out
}

export function validateConfig(
  input: unknown,
  previous?: McpConnectionConfig,
): McpConnectionConfig {
  const value = record(input)
  const id = connectionId(value.id)
  const name = string(value.name, 100, 'connection name').trim()
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new Error('MCP_INVALID: Enabled must be boolean.')
  const enabled = value.enabled ?? previous?.enabled ?? false
  if (value.transport !== 'stdio' && value.transport !== 'http')
    throw new Error('MCP_INVALID: Unsupported transport.')
  const config: McpConnectionConfig = { id, name, enabled, transport: value.transport }
  if (value.transport === 'stdio') {
    config.command = string(value.command, 4096, 'server command')
    const args = value.args ?? []
    if (!Array.isArray(args) || args.length > 64)
      throw new Error('MCP_INVALID: Invalid command arguments.')
    config.args = args.map((arg) => string(arg, 8192, 'command argument', true))
    config.env = value.env === undefined ? { ...previous?.env } : secrets(value.env, false)
  } else {
    const raw = string(value.url, 8192, 'server URL')
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error('MCP_INVALID: Invalid server URL.')
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const loopback = host === '::1' || (isIP(host) === 4 && host.startsWith('127.'))
    if (
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    )
      throw new Error(
        'MCP_INVALID: Use HTTPS, or HTTP with a literal loopback address; credentials belong in headers.',
      )
    config.url = url.toString()
    config.headers =
      value.headers === undefined ? { ...previous?.headers } : secrets(value.headers, true)
  }
  if (Buffer.byteLength(JSON.stringify(config)) > LIMITS.configBytes)
    throw new Error('MCP_INVALID: Connection configuration is too large.')
  return config
}

/** Never surface subprocess stderr, response error data, or secret-bearing URLs. */
export class McpError extends Error {}

export function safeError(error: unknown): string {
  return error instanceof McpError
    ? error.message
    : 'MCP connection failed. Check the server configuration and credentials.'
}

export function redact(text: string, config: McpConnectionConfig): string {
  const authorizationTokens = Object.entries(config.headers ?? {}).flatMap(([key, value]) =>
    /^(?:proxy-)?authorization$/i.test(key) ? [value.replace(/^\S+\s+/, '')] : [],
  )
  const values = [
    ...Object.values(config.env ?? {}),
    ...Object.values(config.headers ?? {}),
    ...authorizationTokens,
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const value of values) text = text.split(value).join('[redacted]')
  return text
}
