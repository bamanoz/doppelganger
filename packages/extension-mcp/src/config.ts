import { isAbsolute, normalize } from 'node:path'

export interface McpEnvironmentReference {
  readonly env: string
}

export interface McpStdioTransportConfig {
  readonly type: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly environment?: Readonly<Record<string, McpEnvironmentReference>>
}

export interface McpStreamableHttpTransportConfig {
  readonly type: 'streamable-http'
  readonly url: string
  readonly headers?: Readonly<Record<string, McpEnvironmentReference>>
}

export type McpTransportConfig = McpStdioTransportConfig | McpStreamableHttpTransportConfig

export interface McpToolPolicy {
  readonly enabled?: boolean
  readonly alias?: string
  readonly approval?: {
    readonly policy: 'required'
    readonly reason?: string
  }
}

export interface McpServerConfig {
  readonly enabled?: boolean
  readonly startupTimeoutMs?: number
  readonly transport: McpTransportConfig
  readonly tools?: Readonly<Record<string, McpToolPolicy>>
}

export interface McpPluginConfig {
  readonly servers: Readonly<Record<string, McpServerConfig>>
}

export interface NormalizedMcpEnvironmentReference {
  readonly env: string
}

export interface NormalizedMcpStdioTransportConfig {
  readonly type: 'stdio'
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly environment: Readonly<Record<string, NormalizedMcpEnvironmentReference>>
}

export interface NormalizedMcpStreamableHttpTransportConfig {
  readonly type: 'streamable-http'
  readonly url: string
  readonly headers: Readonly<Record<string, NormalizedMcpEnvironmentReference>>
}

export type NormalizedMcpTransportConfig = NormalizedMcpStdioTransportConfig | NormalizedMcpStreamableHttpTransportConfig

export interface NormalizedMcpToolPolicy {
  readonly enabled: boolean
  readonly alias?: string
  readonly approval?: {
    readonly policy: 'required'
    readonly reason?: string
  }
}

export interface NormalizedMcpServerConfig {
  readonly id: string
  readonly enabled: boolean
  readonly startupTimeoutMs: number
  readonly transport: NormalizedMcpTransportConfig
  readonly tools: Readonly<Record<string, NormalizedMcpToolPolicy>>
}

export interface NormalizedMcpPluginConfig {
  readonly servers: readonly NormalizedMcpServerConfig[]
}

const SERVER_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const LOCAL_ALIAS = SERVER_ID
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const MAXIMUM_TEXT_LENGTH = 4_096
const MAXIMUM_ARGUMENTS = 256
const MAXIMUM_ENVIRONMENT_ENTRIES = 256
const MAXIMUM_TOOL_POLICIES = 2_048
const MAXIMUM_SERVERS = 128
const MAXIMUM_APPROVAL_REASON_LENGTH = 1_024
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const MAXIMUM_STARTUP_TIMEOUT_MS = 600_000

function record(value: unknown, label: string, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${label} must be an object`)
  const input = value as Readonly<Record<string, unknown>>
  const unsupported = Object.keys(input).filter(key => !allowed.includes(key)).sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  return input
}

function nonEmpty(value: unknown, label: string, maximum = MAXIMUM_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must contain 1-${maximum} characters`)
  }
  return value.trim()
}

function enabled(value: unknown, label: string): boolean {
  if (value === undefined) return true
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

function startupTimeout(value: unknown, label: string): number {
  if (value === undefined) return DEFAULT_STARTUP_TIMEOUT_MS
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAXIMUM_STARTUP_TIMEOUT_MS) {
    throw new TypeError(`${label} must be an integer between 1 and ${MAXIMUM_STARTUP_TIMEOUT_MS}`)
  }
  return value as number
}

function environmentReference(value: unknown, label: string): NormalizedMcpEnvironmentReference {
  const input = record(value, label, ['env'])
  const env = nonEmpty(input.env, `${label}.env`, 256)
  if (!ENVIRONMENT_NAME.test(env)) throw new TypeError(`${label}.env must be a valid environment variable name`)
  return Object.freeze({ env })
}

function referenceMap(
  value: unknown,
  label: string,
  keyPattern: RegExp,
): Readonly<Record<string, NormalizedMcpEnvironmentReference>> {
  if (value === undefined) return Object.freeze({})
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new TypeError(`${label} must be an object`)
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
  if (entries.length > MAXIMUM_ENVIRONMENT_ENTRIES) throw new RangeError(`${label} may contain at most ${MAXIMUM_ENVIRONMENT_ENTRIES} entries`)
  const normalized: Record<string, NormalizedMcpEnvironmentReference> = {}
  for (const [key, reference] of entries) {
    if (!keyPattern.test(key)) throw new TypeError(`${label} contains invalid key ${JSON.stringify(key)}`)
    normalized[key] = environmentReference(reference, `${label}.${key}`)
  }
  return Object.freeze(normalized)
}

function normalizeTransport(value: unknown, label: string): NormalizedMcpTransportConfig {
  const discriminator = record(value, label, ['type', 'command', 'args', 'cwd', 'environment', 'url', 'headers'])
  if (discriminator.type === 'stdio') {
    const input = record(value, label, ['type', 'command', 'args', 'cwd', 'environment'])
    const args = input.args === undefined ? [] : input.args
    if (!Array.isArray(args) || args.length > MAXIMUM_ARGUMENTS || args.some(argument => typeof argument !== 'string' || argument.length > MAXIMUM_TEXT_LENGTH)) {
      throw new TypeError(`${label}.args must contain at most ${MAXIMUM_ARGUMENTS} bounded strings`)
    }
    let cwd: string | undefined
    if (input.cwd !== undefined) {
      cwd = normalize(nonEmpty(input.cwd, `${label}.cwd`))
      if (!isAbsolute(cwd)) throw new TypeError(`${label}.cwd must be an absolute path`)
    }
    return Object.freeze({
      type: 'stdio',
      command: nonEmpty(input.command, `${label}.command`),
      args: Object.freeze([...args] as string[]),
      ...(cwd === undefined ? {} : { cwd }),
      environment: referenceMap(input.environment, `${label}.environment`, ENVIRONMENT_NAME),
    })
  }
  if (discriminator.type === 'streamable-http') {
    const input = record(value, label, ['type', 'url', 'headers'])
    const encoded = nonEmpty(input.url, `${label}.url`)
    let url: URL
    try {
      url = new URL(encoded)
    } catch (cause) {
      throw new TypeError(`${label}.url must be an absolute HTTP or HTTPS URL`, { cause })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`${label}.url must use HTTP or HTTPS`)
    if (url.username.length > 0 || url.password.length > 0 || url.hash.length > 0) {
      throw new TypeError(`${label}.url must not contain credentials or a fragment`)
    }
    return Object.freeze({
      type: 'streamable-http',
      url: url.href,
      headers: referenceMap(input.headers, `${label}.headers`, HEADER_NAME),
    })
  }
  throw new TypeError(`${label}.type must be "stdio" or "streamable-http"`)
}

function normalizeToolPolicy(value: unknown, label: string): NormalizedMcpToolPolicy {
  const input = record(value, label, ['enabled', 'alias', 'approval'])
  let alias: string | undefined
  if (input.alias !== undefined) {
    alias = nonEmpty(input.alias, `${label}.alias`, 128)
    if (!LOCAL_ALIAS.test(alias)) throw new TypeError(`${label}.alias must be lowercase kebab-case`)
  }
  let approval: NormalizedMcpToolPolicy['approval']
  if (input.approval !== undefined) {
    const configured = record(input.approval, `${label}.approval`, ['policy', 'reason'])
    if (configured.policy !== 'required') throw new TypeError(`${label}.approval.policy must be "required"`)
    const reason = configured.reason === undefined
      ? undefined
      : nonEmpty(configured.reason, `${label}.approval.reason`, MAXIMUM_APPROVAL_REASON_LENGTH)
    approval = Object.freeze({
      policy: 'required',
      ...(reason === undefined ? {} : { reason }),
    })
  }

  return Object.freeze({
    enabled: enabled(input.enabled, `${label}.enabled`),
    ...(alias === undefined ? {} : { alias }),
    ...(approval === undefined ? {} : { approval }),
  })
}

function normalizeServer(id: string, value: unknown): NormalizedMcpServerConfig {
  if (!SERVER_ID.test(id)) throw new TypeError(`MCP server ID ${JSON.stringify(id)} must be lowercase kebab-case`)
  const label = `MCP server ${JSON.stringify(id)}`
  const input = record(value, label, ['enabled', 'startupTimeoutMs', 'transport', 'tools'])
  if (input.transport === undefined) throw new TypeError(`${label}.transport is required`)
  const toolEntries = input.tools === undefined ? [] : Object.entries(record(input.tools, `${label}.tools`, Object.keys(input.tools as object)))
  if (toolEntries.length > MAXIMUM_TOOL_POLICIES) throw new RangeError(`${label}.tools may contain at most ${MAXIMUM_TOOL_POLICIES} entries`)
  const tools: Record<string, NormalizedMcpToolPolicy> = {}
  for (const [name, policy] of toolEntries) {
    if (name.length === 0 || name.length > MAXIMUM_TEXT_LENGTH) throw new TypeError(`${label}.tools contains an invalid exact MCP tool name`)
    tools[name] = normalizeToolPolicy(policy, `${label}.tools[${JSON.stringify(name)}]`)
  }
  return Object.freeze({
    id,
    enabled: enabled(input.enabled, `${label}.enabled`),
    startupTimeoutMs: startupTimeout(input.startupTimeoutMs, `${label}.startupTimeoutMs`),
    transport: normalizeTransport(input.transport, `${label}.transport`),
    tools: Object.freeze(tools),
  })
}

export function normalizeMcpPluginConfig(value: McpPluginConfig | unknown): NormalizedMcpPluginConfig {
  const input = record(value, 'MCP configuration', ['servers'])
  if (input.servers === undefined) throw new TypeError('MCP configuration.servers is required')
  if (input.servers === null || Array.isArray(input.servers) || typeof input.servers !== 'object') {
    throw new TypeError('MCP configuration.servers must be an object')
  }
  const entries = Object.entries(input.servers as Readonly<Record<string, unknown>>).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length > MAXIMUM_SERVERS) throw new RangeError(`MCP configuration supports at most ${MAXIMUM_SERVERS} servers`)
  return Object.freeze({
    servers: Object.freeze(entries.map(([id, server]) => normalizeServer(id, server))),
  })
}

export const McpPluginConfigSchema = Object.freeze({
  '~standard': Object.freeze({
    version: 1 as const,
    vendor: 'doppelganger',
    validate(value: unknown) {
      try {
        normalizeMcpPluginConfig(value)
        return { value }
      } catch (cause) {
        return { issues: [{ message: cause instanceof Error ? cause.message : String(cause) }] }
      }
    },
  }),
})
