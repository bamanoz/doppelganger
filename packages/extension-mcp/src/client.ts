import { Ajv, type AnySchema } from 'ajv'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CompatibilityCallToolResultSchema, ErrorCode, McpError, ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JsonValue, ToolDefinition, ToolInvocationContext } from '@doppelganger/doppelganger-protocols'
import { z } from 'zod/v4'
import type { NormalizedMcpServerConfig, NormalizedMcpToolPolicy } from './config.ts'
import { McpImportError, toToolInvocationError } from './errors.ts'
import type { McpServerSnapshot } from './service.ts'

const MAXIMUM_PORTABLE_NAME_LENGTH = 128
const MAXIMUM_RESULT_BYTES = 1024 * 1024
const MAXIMUM_ERROR_BYTES = 64 * 1024
const MAXIMUM_PAGES = 1_000
const schemaValidator = new Ajv({ strict: false, allErrors: true, validateFormats: false })

function validateJsonSchema(schema: unknown, label: string): void {
  if (!schemaValidator.validateSchema(schema as AnySchema)) {
    throw new McpImportError('MCP_TOOL_SCHEMA_INVALID', `${label} is not a valid JSON Schema: ${schemaValidator.errorsText()}`)
  }
}

const McpCallResultEnvelopeSchema = z.object({
  resultType: z.string().optional(),
  toolResult: z.unknown().optional(),
}).loose()

export interface McpClientOwner {
  isCurrent(generation: McpClientGeneration): boolean
  commitRefresh(generation: McpClientGeneration, definitions: readonly ToolDefinition[]): void
  failGeneration(generation: McpClientGeneration, code: string, message: string): void
  recordDiagnostic(serverId: string, level: 'warning' | 'error', code: string, message: string): void
}

type McpStartupStage = 'initialize' | 'discover' | 'commit'

class McpStartupTimeoutError extends Error {
  readonly stage: McpStartupStage

  constructor(stage: McpStartupStage) {
    super(`MCP startup timed out during ${stage}`)
    this.name = 'McpStartupTimeoutError'
    this.stage = stage
  }
}

function errorCode(cause: unknown): string | undefined {
  return cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined
}

function resolvedReferences(
  references: Readonly<Record<string, { readonly env: string }>>,
  label: string,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [target, reference] of Object.entries(references)) {
    const value = process.env[reference.env]
    if (value === undefined) throw new McpImportError('MCP_CREDENTIAL_MISSING', `${label} requires environment variable ${reference.env}`)
    values[target] = value
  }
  return values
}

function strictJson(
  value: unknown,
  label: string,
  code = 'MCP_RESULT_SCHEMA_INVALID',
  maximumBytes = MAXIMUM_RESULT_BYTES,
): JsonValue {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(value)
  } catch (cause) {
    throw new McpImportError(code, `${label} is not JSON-compatible`)
  }
  if (encoded === undefined) throw new McpImportError(code, `${label} is not JSON-compatible`)
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    throw new McpImportError(code === 'MCP_RESULT_SCHEMA_INVALID' ? 'MCP_RESULT_TOO_LARGE' : code, `${label} exceeds ${maximumBytes} UTF-8 bytes`)
  }
  return JSON.parse(encoded) as JsonValue
}

function argumentsRecord(input: JsonValue, tool: Tool, validator: AjvJsonSchemaValidator): Record<string, unknown> {
  const validation = validator.getValidator(tool.inputSchema as unknown as JsonSchemaType)(input)
  if (!validation.valid) {
    throw new McpImportError('MCP_ARGUMENT_SCHEMA_INVALID', `arguments for MCP tool ${tool.name} do not satisfy its input schema: ${validation.errorMessage}`)
  }
  const cloned = strictJson(input, `MCP tool ${tool.name} input`, 'MCP_ARGUMENT_SCHEMA_INVALID')
  if (cloned === null || Array.isArray(cloned) || typeof cloned !== 'object') {
    throw new McpImportError('MCP_ARGUMENT_SCHEMA_INVALID', `arguments for MCP tool ${tool.name} must be an object`)
  }
  return cloned as Record<string, unknown>
}

function defaultLocalId(name: string): string | undefined {
  if (name.length === 0 || name.length > 4_096 || name.trim() !== name || !/^[\x20-\x7e]+$/.test(name)) return
  const normalized = name.toLowerCase().replace(/[_.]/g, '-').replace(/-+/g, '-')
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : undefined
}

function policy(config: NormalizedMcpServerConfig, name: string): NormalizedMcpToolPolicy | undefined {
  return config.tools[name]
}

function createTransport(config: NormalizedMcpServerConfig): Transport {
  if (config.transport.type === 'stdio') {
    return new StdioClientTransport({
      command: config.transport.command,
      args: [...config.transport.args],
      env: { ...getDefaultEnvironment(), ...resolvedReferences(config.transport.environment, `MCP stdio server ${config.id}`) },
      ...(config.transport.cwd === undefined ? {} : { cwd: config.transport.cwd }),
      stderr: 'pipe',
    })
  }
  const headers = resolvedReferences(config.transport.headers, `MCP HTTP server ${config.id}`)
  return new StreamableHTTPClientTransport(new URL(config.transport.url), {
    requestInit: Object.keys(headers).length === 0 ? {} : { headers },
  }) as Transport
}

export class McpClientGeneration {
  readonly #owner: McpClientOwner
  readonly #config: NormalizedMcpServerConfig
  readonly #validator = new AjvJsonSchemaValidator()
  readonly #client: Client
  readonly #activeCalls = new Set<AbortController>()
  readonly #settlements = new Set<Promise<void>>()
  readonly #startupController = new AbortController()
  #transport: Transport | undefined
  #state: McpServerSnapshot['state'] = 'connecting'
  #toolCount = 0
  #protocolVersion: string | undefined
  #serverName: string | undefined
  #serverVersion: string | undefined
  #refreshQueue = Promise.resolve()
  #startupStage: McpStartupStage = 'initialize'
  #startupExpired = false
  #disposing = false

  constructor(owner: McpClientOwner, config: NormalizedMcpServerConfig) {
    this.#owner = owner
    this.#config = config
    this.#client = new Client({ name: `doppelganger-mcp-${config.id}`, version: '0.0.0' }, { capabilities: {} })
    this.#client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.#queueRefresh())
    this.#client.onclose = () => {
      if (this.#disposing || this.#state !== 'active' || !this.#owner.isCurrent(this)) return
      this.#fail('MCP_TRANSPORT_CLOSED', `MCP server ${config.id} transport closed unexpectedly`)
    }
    this.#client.onerror = () => {
      if (this.#disposing || this.#state === 'disposed') return
      this.#owner.recordDiagnostic(config.id, 'error', 'MCP_TRANSPORT_ERROR', `MCP server ${config.id} transport reported an error`)
    }
  }

  get id(): string {
    return this.#config.id
  }

  get config(): NormalizedMcpServerConfig {
    return this.#config
  }

  snapshot(): McpServerSnapshot {
    return Object.freeze({
      id: this.#config.id,
      state: this.#state,
      transport: this.#config.transport.type,
      ...(this.#protocolVersion === undefined ? {} : { protocolVersion: this.#protocolVersion }),
      ...(this.#serverName === undefined ? {} : { serverName: this.#serverName }),
      ...(this.#serverVersion === undefined ? {} : { serverVersion: this.#serverVersion }),
      toolCount: this.#toolCount,
    })
  }
  markCommitted(toolCount: number): void {
    if (this.#disposing || (this.#state !== 'connecting' && this.#state !== 'active')) {
      throw new McpImportError('MCP_GENERATION_STALE', `MCP server generation ${this.#config.id} is not current`)
    }
    this.#toolCount = toolCount
    this.#state = 'active'
  }

  #fail(code: string, message: string): void {
    if (this.#disposing || this.#state === 'failed' || this.#state === 'disposed' || !this.#owner.isCurrent(this)) return
    this.#state = 'failed'
    this.#toolCount = 0
    this.#owner.failGeneration(this, code, message)
  }

  async start(): Promise<void> {
    if (this.#disposing || this.#state !== 'connecting') return
    const deadline = Date.now() + this.#config.startupTimeoutMs
    let timeout: ReturnType<typeof setTimeout> | undefined
    const operation = this.#runStartup(deadline)
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        this.#startupExpired = true
        this.#startupController.abort(new McpStartupTimeoutError(this.#startupStage))
        reject(new McpStartupTimeoutError(this.#startupStage))
      }, this.#config.startupTimeoutMs)
    })
    try {
      await Promise.race([operation, timedOut])
    } catch (cause) {
      if (!this.#disposing && this.#owner.isCurrent(this)) {
        const diagnostic = this.#startupDiagnostic(cause)
        this.#fail(diagnostic.code, diagnostic.message)
      }
      const cleanup = await Promise.allSettled([operation, this.#client.close()])
      const close = cleanup[1]
      if (close?.status === 'rejected') {
        this.#owner.recordDiagnostic(this.#config.id, 'error', 'MCP_CLEANUP_FAILED', `MCP server ${this.#config.id} startup cleanup failed`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async #runStartup(deadline: number): Promise<void> {
    this.#transport = createTransport(this.#config)
    this.#startupStage = 'initialize'
    await this.#client.connect(this.#transport, this.#requestOptions(deadline))
    if (this.#disposing || this.#startupExpired || !this.#owner.isCurrent(this)) {
      throw new McpImportError('MCP_GENERATION_STALE', `MCP server generation ${this.#config.id} is not current`)
    }
    const capabilities = this.#client.getServerCapabilities()
    if (capabilities?.tools === undefined) throw new McpImportError('MCP_TOOLS_UNSUPPORTED', 'MCP server does not advertise tools capability')
    const version = this.#client.getServerVersion()
    this.#serverName = version?.name
    this.#serverVersion = version?.version
    this.#protocolVersion = (this.#transport as { readonly protocolVersion?: string }).protocolVersion
    this.#startupStage = 'discover'
    const definitions = this.#definitions(await this.#discover(deadline))
    this.#startupStage = 'commit'
    this.#requestOptions(deadline)
    if (this.#disposing || this.#startupExpired || !this.#owner.isCurrent(this)) {
      throw new McpImportError('MCP_GENERATION_STALE', `MCP server generation ${this.#config.id} is not current`)
    }
    this.#owner.commitRefresh(this, definitions)
  }

  #requestOptions(deadline: number): { readonly signal: AbortSignal; readonly timeout: number; readonly maxTotalTimeout: number } {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new McpStartupTimeoutError(this.#startupStage)
    return { signal: this.#startupController.signal, timeout: remaining, maxTotalTimeout: remaining }
  }

  #startupDiagnostic(cause: unknown): { readonly code: string; readonly message: string } {
    const timedOut = cause instanceof McpStartupTimeoutError
      || this.#startupExpired
      || (cause instanceof McpError && cause.code === ErrorCode.RequestTimeout)
    if (timedOut) {
      const stage = cause instanceof McpStartupTimeoutError ? cause.stage : this.#startupStage
      const code = stage === 'discover' ? 'MCP_DISCOVERY_TIMEOUT' : stage === 'commit' ? 'MCP_COMMIT_TIMEOUT' : 'MCP_INITIALIZE_TIMEOUT'
      return { code, message: `MCP server ${this.#config.id} timed out during ${stage}` }
    }
    if (cause instanceof McpImportError) return { code: cause.code, message: cause.message }
    if (this.#startupStage === 'initialize') {
      const spawnFailed = this.#config.transport.type === 'stdio'
        && (this.#transport === undefined || (this.#transport instanceof StdioClientTransport && this.#transport.pid === null))
      return spawnFailed
        ? { code: 'MCP_SPAWN_FAILED', message: `MCP stdio server ${this.#config.id} could not start the configured command` }
        : { code: 'MCP_INITIALIZE_FAILED', message: `MCP server ${this.#config.id} failed during initialization` }
    }
    if (this.#startupStage === 'discover') {
      return { code: 'MCP_DISCOVERY_FAILED', message: `MCP server ${this.#config.id} failed during initial tool discovery` }
    }
    return { code: errorCode(cause) ?? 'MCP_REGISTRY_COMMIT_FAILED', message: `MCP server ${this.#config.id} failed while publishing discovered tools` }
  }

  #queueRefresh(): void {
    this.#refreshQueue = this.#refreshQueue.then(
      () => this.#refresh(),
      () => this.#refresh(),
    ).catch(cause => {
      const code = cause instanceof McpImportError
        ? cause.code
        : cause instanceof McpError ? 'MCP_PROTOCOL_ERROR' : 'MCP_DISCOVERY_FAILED'
      this.#owner.recordDiagnostic(this.#config.id, 'error', code, `MCP server ${this.#config.id} failed to refresh its tool list`)
    })
  }

  async #discover(deadline?: number): Promise<readonly Tool[]> {
    const discovered: Tool[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
      const params = cursor === undefined ? undefined : { cursor }
      const result = deadline === undefined
        ? await this.#client.listTools(params)
        : await this.#client.listTools(params, this.#requestOptions(deadline))
      discovered.push(...result.tools)
      cursor = result.nextCursor
      if (cursor === undefined) return Object.freeze(discovered)
      if (cursors.has(cursor)) throw new McpImportError('MCP_PAGINATION_INVALID', `MCP server repeated tools/list cursor ${JSON.stringify(cursor)}`)
      cursors.add(cursor)
    }
    throw new McpImportError('MCP_PAGINATION_LIMIT', `MCP tools/list exceeded ${MAXIMUM_PAGES} pages`)
  }

  #definitions(discovered: readonly Tool[]): readonly ToolDefinition[] {
    const exactNames = new Set<string>()
    for (const tool of discovered) {
      if (exactNames.has(tool.name)) throw new McpImportError('MCP_TOOL_DUPLICATE', `MCP server repeated exact tool name ${JSON.stringify(tool.name)}`)
      exactNames.add(tool.name)
    }

    const candidates: Array<{ readonly originalName: string; readonly localId: string; readonly definition: ToolDefinition }> = []
    for (const tool of discovered) {
      const configured = policy(this.#config, tool.name)
      if (configured?.enabled === false) continue
      const localId = configured?.alias ?? defaultLocalId(tool.name)
      if (localId === undefined) {
        this.#owner.recordDiagnostic(this.#config.id, 'warning', 'MCP_TOOL_NAME_INVALID', `MCP tool ${JSON.stringify(tool.name)} has no portable name; configure an alias`)
        continue
      }
      const portableName = `mcp-${this.#config.id}.${localId}`
      if (portableName.length > MAXIMUM_PORTABLE_NAME_LENGTH) {
        this.#owner.recordDiagnostic(this.#config.id, 'warning', 'MCP_TOOL_NAME_TOO_LONG', `portable MCP tool name ${JSON.stringify(portableName)} exceeds ${MAXIMUM_PORTABLE_NAME_LENGTH} characters`)
        continue
      }
      try {
        validateJsonSchema(tool.inputSchema, `MCP tool ${JSON.stringify(tool.name)} input schema`)
        this.#validator.getValidator(tool.inputSchema as unknown as JsonSchemaType)
        if (tool.outputSchema !== undefined) {
          validateJsonSchema(tool.outputSchema, `MCP tool ${JSON.stringify(tool.name)} output schema`)
          this.#validator.getValidator(tool.outputSchema as unknown as JsonSchemaType)
        }
      } catch (cause) {
        throw new McpImportError('MCP_TOOL_SCHEMA_INVALID', `MCP tool ${JSON.stringify(tool.name)} has an invalid JSON Schema: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      const inputSchema = strictJson(tool.inputSchema, `MCP tool ${tool.name} input schema`, 'MCP_TOOL_SCHEMA_INVALID')
      if (inputSchema === null || Array.isArray(inputSchema) || typeof inputSchema !== 'object') {
        throw new McpImportError('MCP_TOOL_SCHEMA_INVALID', `MCP tool ${JSON.stringify(tool.name)} input schema must be an object`)
      }
      const definition: ToolDefinition = Object.freeze({
        name: portableName,
        label: tool.title ?? tool.annotations?.title ?? tool.name,
        description: tool.description?.trim() || `MCP tool ${tool.name} from ${this.#config.id}`,
        inputSchema: inputSchema as Readonly<Record<string, JsonValue>>,
        ...(configured?.approval === undefined ? {} : { approval: configured.approval }),
        invoke: (input: JsonValue, context: ToolInvocationContext) => this.#invoke(tool, input, context),
      })
      candidates.push({ originalName: tool.name, localId, definition })
    }

    const collisions = new Set<string>()
    const byLocalId = new Map<string, string[]>()
    for (const candidate of candidates) {
      const names = byLocalId.get(candidate.localId) ?? []
      names.push(candidate.originalName)
      byLocalId.set(candidate.localId, names)
    }
    for (const [candidateId, names] of byLocalId) {
      if (names.length < 2) continue
      collisions.add(candidateId)
      this.#owner.recordDiagnostic(this.#config.id, 'warning', 'MCP_TOOL_NAME_COLLISION', `MCP tools ${names.map(name => JSON.stringify(name)).join(' and ')} collide at local ID ${JSON.stringify(candidateId)}; configure distinct aliases`)
    }
    for (const name of Object.keys(this.#config.tools)) {
      if (!exactNames.has(name)) this.#owner.recordDiagnostic(this.#config.id, 'warning', 'MCP_TOOL_POLICY_UNUSED', `tool policy for ${JSON.stringify(name)} matched no discovered MCP tool`)
    }
    return Object.freeze(candidates.filter(candidate => !collisions.has(candidate.localId)).map(candidate => candidate.definition))
  }

  async #refresh(): Promise<void> {
    if (this.#disposing || !this.#owner.isCurrent(this)) return
    const definitions = this.#definitions(await this.#discover())
    if (this.#disposing || !this.#owner.isCurrent(this)) return
    this.#owner.commitRefresh(this, definitions)
  }

  async #invoke(tool: Tool, input: JsonValue, context: ToolInvocationContext): Promise<JsonValue> {
    if (this.#disposing || !this.#owner.isCurrent(this)) {
      throw new McpImportError('MCP_GENERATION_STALE', `MCP server generation ${this.#config.id} is not current`)
    }
    if (this.#state === 'failed') throw new McpImportError('MCP_SERVER_UNAVAILABLE', `MCP server ${this.#config.id} is unavailable`)
    if (this.#state !== 'active') throw new McpImportError('MCP_GENERATION_STALE', `MCP server generation ${this.#config.id} is not active`)

    const controller = new AbortController()
    const abort = () => controller.abort(context.signal.reason)
    context.signal.addEventListener('abort', abort, { once: true })
    this.#activeCalls.add(controller)
    let settle!: () => void
    const settled = new Promise<void>(resolve => { settle = resolve })
    this.#settlements.add(settled)
    try {
      const raw = await this.#client.request(
        { method: 'tools/call', params: { name: tool.name, arguments: argumentsRecord(input, tool, this.#validator) } },
        McpCallResultEnvelopeSchema,
        { signal: controller.signal },
      )
      if (raw.resultType === 'input_required') {
        throw new McpImportError(
          'MCP_INPUT_REQUIRED',
          `MCP tool ${tool.name} requires unsupported additional input`,
          strictJson(raw, `MCP tool ${tool.name} input-required result`, 'MCP_INPUT_REQUIRED', MAXIMUM_ERROR_BYTES),
        )
      }
      if (raw.resultType !== undefined && raw.resultType !== 'complete') {
        throw new McpImportError('MCP_RESULT_UNSUPPORTED', `MCP tool ${tool.name} returned unsupported result type ${JSON.stringify(raw.resultType)}`)
      }
      const parsed = CompatibilityCallToolResultSchema.safeParse(raw)
      if (!parsed.success) throw new McpImportError('MCP_RESULT_SCHEMA_INVALID', `MCP tool ${tool.name} returned an invalid result: ${parsed.error.message}`)
      const result = parsed.data
      if ('toolResult' in result) return strictJson({ toolResult: result.toolResult }, `MCP tool ${tool.name} compatibility result`)
      if (tool.outputSchema !== undefined && result.structuredContent !== undefined) {
        const validation = this.#validator.getValidator(tool.outputSchema as unknown as JsonSchemaType)(result.structuredContent)
        if (!validation.valid) {
          throw new McpImportError('MCP_OUTPUT_SCHEMA_INVALID', `MCP tool ${tool.name} structured content does not satisfy its output schema: ${validation.errorMessage}`)
        }
      }
      const value = strictJson({
        content: result.content,
        ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
      }, `MCP tool ${tool.name} result`)
      if (result.isError === true) throw new McpImportError('MCP_TOOL_ERROR', `MCP tool ${tool.name} reported an error`, value)
      return value
    } catch (cause) {
      if (cause instanceof McpImportError) throw toToolInvocationError(cause, cause.code, cause.message)
      if (controller.signal.aborted || context.signal.aborted) {
        throw toToolInvocationError(cause, 'MCP_CANCELLED', `MCP tool ${tool.name} was cancelled`)
      }
      if (this.snapshot().state === 'failed') throw toToolInvocationError(cause, 'MCP_SERVER_UNAVAILABLE', `MCP server ${this.#config.id} is unavailable`)
      if (cause instanceof McpError) throw toToolInvocationError(cause, 'MCP_PROTOCOL_ERROR', `MCP tool ${tool.name} failed at the protocol boundary`)
      throw toToolInvocationError(cause, 'MCP_TRANSPORT_ERROR', `MCP tool ${tool.name} transport failed`)
    } finally {
      context.signal.removeEventListener('abort', abort)
      this.#activeCalls.delete(controller)
      this.#settlements.delete(settled)
      settle()
    }
  }

  async dispose(): Promise<void> {
    if (this.#state === 'disposed') return
    this.#disposing = true
    this.#state = 'disposed'
    this.#toolCount = 0
    this.#startupController.abort('MCP server generation disposed')
    for (const controller of this.#activeCalls) controller.abort('MCP server generation disposed')
    const failures: unknown[] = []
    await this.#client.close().catch(cause => failures.push(cause))
    const results = await Promise.allSettled([...this.#settlements, this.#refreshQueue])
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
    if (failures.length > 0) throw new AggregateError(failures, `MCP server ${this.#config.id} cleanup failed`)
  }
}
