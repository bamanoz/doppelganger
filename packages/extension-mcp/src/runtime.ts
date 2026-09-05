import type { Context, Logger } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRegistry, ToolSetRegistration } from '@doppelganger/doppelganger-protocols'
import { McpClientGeneration, type McpClientOwner } from './client.ts'
import type { NormalizedMcpPluginConfig, NormalizedMcpServerConfig } from './config.ts'
import { McpImportError } from './errors.ts'
import type { McpDiagnostic, McpImportRuntimeView, McpImportSnapshot } from './service.ts'

const MAXIMUM_DIAGNOSTICS = 1_000

interface ServerSlot {
  config: NormalizedMcpServerConfig
  generation: McpClientGeneration
  readonly registration: ToolSetRegistration
  definitions: readonly ToolDefinition[]
  startup: Promise<void>
}

function sameConfig(left: NormalizedMcpServerConfig, right: NormalizedMcpServerConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class McpImportRuntime implements McpClientOwner, McpImportRuntimeView {
  readonly #tools: ToolRegistry
  readonly #logger: Logger
  readonly #servers = new Map<string, ServerSlot>()
  readonly #diagnostics: McpDiagnostic[] = []
  readonly #background = new Set<Promise<void>>()
  readonly #cleanupFailures: unknown[] = []
  #config: NormalizedMcpPluginConfig
  #diagnosticSequence = 0
  #started = false
  #disposed = false

  constructor(ctx: Context, config: NormalizedMcpPluginConfig) {
    this.#logger = ctx.logger('doppelganger-mcp')
    this.#tools = ctx.doppelgangerTools
    this.#config = config
  }

  snapshot(): McpImportSnapshot {
    return Object.freeze({
      servers: Object.freeze([...this.#servers.values()]
        .map(server => server.generation.snapshot())
        .sort((left, right) => left.id.localeCompare(right.id))),
      diagnostics: Object.freeze(this.#diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))),
    })
  }

  recordDiagnostic(serverId: string, level: 'warning' | 'error', code: string, message: string): void {
    this.#logger[level === 'error' ? 'warn' : 'debug']('mcp.diagnostic level=%s code=%s server=%s', level, code, serverId)
    this.#diagnostics.push(Object.freeze({
      sequence: ++this.#diagnosticSequence,
      timestamp: Date.now(),
      level,
      code,
      serverId,
      message,
    }))
    if (this.#diagnostics.length > MAXIMUM_DIAGNOSTICS) {
      this.#diagnostics.splice(0, this.#diagnostics.length - MAXIMUM_DIAGNOSTICS)
    }
  }

  isCurrent(generation: McpClientGeneration): boolean {
    return !this.#disposed && this.#servers.get(generation.id)?.generation === generation
  }

  commitRefresh(generation: McpClientGeneration, definitions: readonly ToolDefinition[]): void {
    const slot = this.#servers.get(generation.id)
    if (this.#disposed || slot?.generation !== generation) {
      throw new McpImportError('MCP_GENERATION_STALE', `MCP server generation ${generation.id} is not current`)
    }
    slot.registration.replace(definitions)
    slot.definitions = definitions
    generation.markCommitted(definitions.length)
    this.#logger.info('mcp.server.refresh.completed server=%s tools=%d', generation.id, definitions.length)
  }

  failGeneration(generation: McpClientGeneration, code: string, message: string): void {
    const slot = this.#servers.get(generation.id)
    if (this.#disposed || slot?.generation !== generation) return
    this.#logger.warn('mcp.server.failed server=%s code=%s', generation.id, code)
    if (slot.definitions.length > 0) {
      try {
        slot.registration.replace([])
        slot.definitions = Object.freeze([])
      } catch {
        this.recordDiagnostic(generation.id, 'error', 'MCP_REGISTRY_WITHDRAW_FAILED', `MCP server ${generation.id} failed to withdraw its tools`)
      }
    }
    this.recordDiagnostic(generation.id, 'error', code, message)
  }

  start(): void {
    this.#logger.info('component.activation.started servers=%d', this.#config.servers.filter(server => server.enabled).length)
    if (this.#disposed) throw new Error('MCP runtime is disposed')
    if (this.#started) return
    this.#started = true
    const installed: ServerSlot[] = []
    try {
      for (const config of this.#config.servers) {
        if (!config.enabled) continue
        const slot = this.#installSlot(config)
        installed.push(slot)
      }
    } catch (cause) {
      for (const slot of installed) {
        this.#servers.delete(slot.config.id)
        this.#trackCleanup(slot.registration.dispose(), slot.config.id)
        this.#trackCleanup(slot.generation.dispose(), slot.config.id)
      }
      throw cause
    }
    for (const slot of installed) this.#launch(slot)
    this.#logger.info('component.active servers=%d', installed.length)
  }

  update(config: NormalizedMcpPluginConfig): void {
    this.#logger.info('mcp.configuration.update.started servers=%d', config.servers.filter(server => server.enabled).length)
    if (this.#disposed) throw new Error('MCP runtime is disposed')
    if (!this.#started) throw new Error('MCP runtime is not started')

    const next = new Map(config.servers.filter(server => server.enabled).map(server => [server.id, server]))
    const added = [...next.values()].filter(server => !this.#servers.has(server.id))
    const additionRegistrations = new Map<string, ToolSetRegistration>()
    try {
      for (const server of added) {
        additionRegistrations.set(server.id, this.#tools.registerSet(this.#ownerId(server.id), []))
      }
    } catch (cause) {
      for (const [serverId, registration] of additionRegistrations) {
        this.#trackCleanup(registration.dispose(), serverId)
      }
      throw cause
    }

    const launch: ServerSlot[] = []
    for (const [id, current] of [...this.#servers]) {
      const replacement = next.get(id)
      if (replacement !== undefined && sameConfig(current.config, replacement)) continue

      this.#servers.delete(id)
      current.registration.replace([])
      current.definitions = Object.freeze([])

      if (replacement === undefined) {
        this.#trackCleanup(current.registration.dispose(), id)
      } else {
        const generation = new McpClientGeneration(this, replacement)
        const slot: ServerSlot = {
          config: replacement,
          generation,
          registration: current.registration,
          definitions: Object.freeze([]),
          startup: Promise.resolve(),
        }
        this.#servers.set(id, slot)
        launch.push(slot)
      }
      this.#trackCleanup(current.generation.dispose(), id)
    }

    for (const server of added) {
      const registration = additionRegistrations.get(server.id)!
      const generation = new McpClientGeneration(this, server)
      const slot: ServerSlot = {
        config: server,
        generation,
        registration,
        definitions: Object.freeze([]),
        startup: Promise.resolve(),
      }
      this.#servers.set(server.id, slot)
      launch.push(slot)
    }

    this.#config = config
    for (const slot of launch) this.#launch(slot)
    this.#logger.info('mcp.configuration.update.completed activeServers=%d refreshedServers=%d', this.#servers.size, launch.length)
  }

  async dispose(): Promise<void> {
    this.#logger.info('component.disposal.started servers=%d', this.#servers.size)
    if (this.#disposed) return
    this.#disposed = true
    const slots = [...this.#servers.values()]
    this.#servers.clear()

    const disposal = slots.flatMap(slot => [
      slot.registration.dispose(),
      slot.generation.dispose(),
    ])
    const settlements = await Promise.allSettled([...disposal, ...this.#background])
    const failures = [...this.#cleanupFailures]
    for (const settlement of settlements) {
      if (settlement.status === 'rejected') failures.push(settlement.reason)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'MCP runtime cleanup failed')
    this.#logger.info('component.disposal.completed')
  }

  #installSlot(config: NormalizedMcpServerConfig): ServerSlot {
    const generation = new McpClientGeneration(this, config)
    const slot: ServerSlot = {
      config,
      generation,
      registration: this.#tools.registerSet(this.#ownerId(config.id), []),
      definitions: Object.freeze([]),
      startup: Promise.resolve(),
    }
    this.#servers.set(config.id, slot)
    return slot
  }

  #launch(slot: ServerSlot): void {
    this.#logger.debug('mcp.server.start.started server=%s transport=%s', slot.config.id, slot.config.transport.type)
    const startup = slot.generation.start()
    slot.startup = startup
    this.#track(startup, slot.config.id, 'MCP_STARTUP_UNHANDLED')
  }

  #track(settlement: Promise<void>, serverId: string, code: string): void {
    let tracked!: Promise<void>
    tracked = settlement.catch(() => {
      this.recordDiagnostic(serverId, 'error', code, `MCP server ${serverId} background work failed`)
    }).finally(() => {
      this.#background.delete(tracked)
    })
    this.#background.add(tracked)
  }

  #trackCleanup(settlement: Promise<void>, serverId: string): void {
    let tracked!: Promise<void>
    tracked = settlement.catch(cause => {
      this.#cleanupFailures.push(cause)
      this.recordDiagnostic(serverId, 'error', 'MCP_CLEANUP_FAILED', `MCP server ${serverId} cleanup failed`)
    }).finally(() => {
      this.#background.delete(tracked)
    })
    this.#background.add(tracked)
  }

  #ownerId(serverId: string): string {
    return `doppelganger-extension-mcp:${serverId}`
  }
}
