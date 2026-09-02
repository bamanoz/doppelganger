import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import { formatApprovalPrompt, resolveApproval } from '@oh-my-pi/pi-coding-agent/tools/approval'
import { OMP_RPC_PROTOCOL_VERSION } from '../src/contracts.ts'
import {
  createDoppelgangerOmpExtension,
  ompToolParametersFromJsonSchema,
} from '../src/extension.ts'
import type {
  OmpChildConnection,
  OmpChildDisposal,
  OmpChildFactory,
} from '../src/adapter.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function runtimeTool(
  name: string,
  description = name,
  inputSchema: Record<string, unknown> = { type: 'object', properties: {}, additionalProperties: false },
) {
  return { name, description, inputSchema, available: true }
}

function deferred() {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}


class ExtensionConnection implements OmpChildConnection {
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly notifications = new Map<string, (params: unknown) => void>()
  contextContent = 'Persona context.'
  disposed = false
  hangSessionDisposal = false
  hangDisposal = false
  activationError: Error | undefined
  contextError: Error | undefined
  activationGate: Promise<void> | undefined
  contextGate: Promise<void> | undefined
  lifecycleGate: Promise<void> | undefined
  disposal: OmpChildDisposal = { outcome: 'graceful', sessionDisposeAcknowledged: true }
  private readonly events: string[]
  private readonly index: number

  constructor(events: string[] = [], index = 0) {
    this.events = events
    this.index = index
  }
  activationTools: unknown[] = [{
    name: 'memory.search',
    description: 'Search memory',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    available: true,
  }]

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    this.events.push(`${method}:${this.index}`)
    if (method === 'session.activate') {
      await this.activationGate
      if (this.activationError !== undefined) throw this.activationError
      return {
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        diagnostics: { compositionRevision: 'effective-one' },
        runtimeRevision: 'effective-one',
        tools: this.activationTools,
      }
    }
    if (method === 'context.resolve') {
      await this.contextGate
      if (this.contextError !== undefined) throw this.contextError
      return { content: this.contextContent, contributions: [], omittedSources: [], tokenCount: 4 }
    }
    if (method === 'tools.invoke') return { ok: true, value: { found: 1 } }
    if (method === 'event.publish') await this.lifecycleGate
    if (method === 'event.publish' && this.hangSessionDisposal) {
      const event = params as { type?: string }
      if (event.type === 'session-disposed') return new Promise(() => undefined)
    }
    return null
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    this.notifications.set(method, handler)
    return () => this.notifications.delete(method)
  }

  async dispose(): Promise<OmpChildDisposal> {
    this.disposed = true
    this.events.push(`dispose:${this.index}`)
    if (this.hangDisposal) return new Promise(() => undefined)
    return this.disposal
  }
}

class ExtensionFactory implements OmpChildFactory {
  readonly connections: ExtensionConnection[] = []
  readonly events: string[] = []
  private startCount = 0

  get connection(): ExtensionConnection { return this.connectionAt(0) }
  get latestConnection(): ExtensionConnection { return this.connectionAt(Math.max(0, this.startCount - 1)) }

  connectionAt(index: number): ExtensionConnection {
    while (this.connections.length <= index) {
      this.connections.push(new ExtensionConnection(this.events, this.connections.length))
    }
    return this.connections[index]!
  }

  async start(): Promise<OmpChildConnection> {
    const connection = this.connectionAt(this.startCount)
    this.startCount += 1
    return connection
  }
}

interface RegisteredTool {
  name: string
  description: string
  defaultInactive?: boolean
  loadMode?: 'essential' | 'discoverable'
  parameters: unknown
  approval?: unknown
  formatApprovalDetails?: (args: unknown) => string | string[] | undefined
  execute(...args: unknown[]): Promise<{ content: Array<{ text: string }>; details?: unknown; isError?: boolean }>
}

function fakePi() {
  const handlers = new Map<string, (event: any, context: ExtensionContext) => Promise<unknown>>()
  const tools = new Map<string, RegisteredTool>()
  let activeTools = ['read', 'bash']
  const schema = { min: () => schema }
  const api = {
    zod: {
      string: () => schema,
      object: () => ({}),
    },
    logger: { error: vi.fn() },
    registerTool(tool: RegisteredTool) { tools.set(tool.name, tool) },
    on(event: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown>) {
      handlers.set(event, handler)
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: async (names: string[]) => { activeTools = [...names] },
  } as unknown as ExtensionAPI
  return { api, handlers, tools, activeTools: () => activeTools }
}

async function projectFixture(selected = true) {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-extension-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  await Promise.all([
    mkdir(join(root, '.git'), { recursive: true }),
    mkdir(join(home, '.runtime-presets', 'portable-runtime'), { recursive: true }),
  ])
  await writeFile(join(home, '.runtime-presets', 'portable-runtime', 'runtime.cordis.yml'), '[]\n')
  if (selected) await writeFile(join(home, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: portable-runtime\n')
  return { root, home }
}

interface MutableExtensionContext {
  readonly ctx: ExtensionContext
  setCwd(cwd: string): void
  setSessionId(sessionId: string): void
}

function mutableExtensionContext(cwd: string, sessionId = 'omp-session'): MutableExtensionContext {
  let currentCwd = cwd
  let currentSessionId = sessionId
  return {
    ctx: {
      get cwd() { return currentCwd },
      hasUI: false,
      ui: { notify: vi.fn() },
      sessionManager: { getSessionId: () => currentSessionId },
    } as unknown as ExtensionContext,
    setCwd(nextCwd: string) { currentCwd = nextCwd },
    setSessionId(nextSessionId: string) { currentSessionId = nextSessionId },
  }
}

function extensionContext(cwd: string, sessionId = 'omp-session'): ExtensionContext {
  return mutableExtensionContext(cwd, sessionId).ctx
}

async function invokeWithNativeApproval(
  tool: RegisteredTool,
  args: Record<string, unknown>,
  options: { readonly hasUI: boolean; readonly select?: (prompt: string) => Promise<string | undefined> },
) {
  const resolved = resolveApproval(tool as never, args, 'yolo', {})
  if (resolved.policy === 'deny') throw new Error('tool denied')
  if (resolved.policy === 'prompt') {
    if (!options.hasUI) throw new Error(`Tool "${tool.name}" requires approval but no interactive UI available.`)
    const prompt = formatApprovalPrompt(tool as never, args, resolved.reason)
    const choice = await options.select?.(prompt)
    if (choice !== 'Approve') throw new Error(`Tool call denied by user: ${tool.name}`)
  }
  return tool.execute('approved', args, undefined, undefined, extensionContext(process.cwd()))
}

function published(connection: ExtensionConnection) {
  return connection.requests
    .filter(request => request.method === 'event.publish')
    .map(request => request.params as Record<string, unknown>)
}

describe('OMP JSON Schema translation', () => {
  it('preserves nested objects, arrays, scalars, enums, descriptions, and additional-property policy', () => {
    const parameters = ompToolParametersFromJsonSchema({
      type: 'object',
      description: 'Structured input',
      properties: {
        mode: { type: 'string', enum: ['fast', 'safe'], description: 'Execution mode' },
        retries: { type: 'integer', minimum: 0 },
        enabled: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        options: {
          type: 'object',
          properties: { threshold: { type: 'number' } },
          required: ['threshold'],
          additionalProperties: false,
        },
      },
      required: ['mode', 'tags', 'options'],
      additionalProperties: false,
    }) as (value: unknown) => unknown

    expect(parameters({
      mode: 'safe',
      tags: ['verified'],
      options: { threshold: 0.5 },
    })).toMatchObject({ mode: 'safe', tags: ['verified'], options: { threshold: 0.5 } })
    expect((parameters({ mode: 'unsafe', tags: [], options: {}, extra: true }) as { length?: number }).length)
      .toBeGreaterThan(0)
  })

  it('rejects unsupported constructs at their schema path instead of widening validation', () => {
    expect(() => ompToolParametersFromJsonSchema({
      type: 'object',
      properties: { query: { type: 'string', contentEncoding: 'base64' } },
    })).toThrow('$.properties.query.contentEncoding is not supported')
    expect(() => ompToolParametersFromJsonSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] }))
      .toThrow('$.oneOf is not supported')
  })
})

describe('Doppelganger OMP extension', () => {
  it('preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({
      home,
      actorId: 'actor-one',
      childFactory: factory,
      tokenBudget: 321,
    })(pi.api)
    const ctx = extensionContext(root)

    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(factory.connection.requests[0]).toMatchObject({
      method: 'session.activate',
      params: { actorId: 'actor-one' },
    })
    expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_memory_search'])
    await expect(pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start',
      prompt: 'Current user turn',
      systemPrompt: ['Existing OMP instructions.'],
    }, ctx)).resolves.toBeUndefined()
    const outboundMessages = [{
      role: 'user', content: [{ type: 'text', text: 'Current user turn' }], timestamp: 1,
    }]
    const projected = await pi.handlers.get('context')!({
      type: 'context', messages: outboundMessages,
    }, ctx) as { messages: unknown[] }
    expect(projected.messages).toEqual([
      ...outboundMessages,
      {
        role: 'developer',
        content: [{ type: 'text', text: 'Persona context.' }],
        attribution: 'agent',
        timestamp: expect.any(Number),
      },
    ])
    expect(outboundMessages).toHaveLength(1)
    expect(factory.connection.requests).toContainEqual({
      method: 'context.resolve',
      params: expect.objectContaining({ input: 'Current user turn', tokenBudget: 321 }),
    })

    const search = pi.tools.get('doppelganger_memory_search')!
    expect(typeof search.parameters).toBe('function')
    expect((search.parameters as (value: unknown) => unknown)({ query: 'Cordis' })).toEqual({ query: 'Cordis' })
    expect((search.parameters as (value: unknown) => { length?: number })({}).length).toBeGreaterThan(0)
    const proxyResult = await search.execute('call', { query: 'Cordis' }, undefined, undefined, ctx)
    expect(proxyResult.content[0]?.text).toContain('"found": 1')

    factory.connection.notifications.get('tools.changed')?.([{
      name: 'memory.remember',
      description: 'Remember',
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string', minLength: 1 } },
        required: ['content'],
        additionalProperties: false,
      },
      available: true,
    }])
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_memory_remember']))
    expect((await search.execute('call', { query: 'stale' }, undefined, undefined, ctx)).isError).toBe(true)
    const remember = pi.tools.get('doppelganger_memory_remember')!
    const firstSchema = remember.parameters
    factory.connection.notifications.get('tools.changed')?.([{
      name: 'memory.remember',
      description: 'Remember updated',
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string' }, operationId: { type: 'string' } },
        required: ['content', 'operationId'],
        additionalProperties: false,
      },
      available: true,
    }])
    await vi.waitFor(() => expect(pi.tools.get('doppelganger_memory_remember')?.description).toContain('updated'))
    expect(pi.tools.get('doppelganger_memory_remember')?.parameters).not.toBe(firstSchema)

    factory.connection.contextContent = 'Reloaded runtime context.'
    factory.connection.notifications.get('runtime.changed')?.({
      runtimeRevision: 'two',
      diagnostics: { compositionRevision: 'two' },
      tools: [{
        name: 'memory.remember',
        description: 'Remember updated',
        inputSchema: {
          type: 'object',
          properties: { content: { type: 'string' }, operationId: { type: 'string' } },
          required: ['content', 'operationId'],
          additionalProperties: false,
        },
        available: true,
      }],
    })
    await expect(pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start',
      prompt: 'Next turn',
      systemPrompt: ['Existing OMP instructions.'],
    }, ctx)).resolves.toBeUndefined()
    const afterReload = await pi.handlers.get('context')!({
      type: 'context', messages: outboundMessages,
    }, ctx) as { messages: Array<{ role?: string; content?: Array<{ text?: string }> }> }
    expect(afterReload.messages.at(-1)).toMatchObject({
      role: 'developer', content: [{ type: 'text', text: 'Reloaded runtime context.' }],
    })

    await pi.handlers.get('turn_start')!({ type: 'turn_start', turnIndex: 0, timestamp: 10 }, ctx)
    await pi.handlers.get('tool_execution_start')!({
      type: 'tool_execution_start', toolCallId: 'call-one', toolName: 'read', args: { path: 'a.ts' },
    }, ctx)
    await pi.handlers.get('tool_execution_end')!({
      type: 'tool_execution_end', toolCallId: 'call-one', toolName: 'read', result: { content: 'file' }, isError: false,
    }, ctx)
    await pi.handlers.get('turn_end')!({
      type: 'turn_end',
      turnIndex: 0,
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-one', name: 'read', arguments: { path: 'a.ts' } }],
        stopReason: 'toolUse',
      },
      toolResults: [{
        role: 'toolResult',
        toolCallId: 'call-one',
        toolName: 'read',
        content: [{ type: 'text', text: 'file' }],
        details: { content: 'file' },
        isError: false,
      }],
    }, ctx)
    expect(published(factory.connection).map(event => event.type)).not.toContain('turn-committed')
    await pi.handlers.get('turn_end')!({
      type: 'turn_end',
      turnIndex: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Completed answer.' }], stopReason: 'stop' },
      toolResults: [{
        role: 'toolResult',
        toolCallId: 'call-two',
        toolName: 'ignored-aggregate',
        content: [{ type: 'text', text: 'must not be forwarded' }],
        details: { content: 'must not be forwarded' },
        isError: false,
      }],
    }, ctx)
    expect(published(factory.connection).map(event => event.type)).toEqual([
      'session-started',
      'turn-started',
      'tool-started',
      'tool-completed',
      'turn-committed',
    ])
    expect(published(factory.connection).at(-2)).toMatchObject({
      protocolVersion: 2,
      type: 'tool-completed',
      turnId: 'omp-session:turn:2',
      callId: 'call-one',
      name: 'read',
      outcome: 'completed',
      result: { value: { content: 'file' } },
    })
    expect(published(factory.connection).at(-1)).toMatchObject({
      protocolVersion: 2,
      type: 'turn-committed',
      turnId: 'omp-session:turn:2',
      principalInput: { value: 'Next turn' },
      assistantOutput: { value: 'Completed answer.' },
      outcome: 'completed',
    })

    expect(published(factory.connection).at(-1)).not.toHaveProperty('toolOutcomes')

    factory.connection.notifications.get('tools.changed')?.([])
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash']))
    await pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)
    await vi.waitFor(() => expect(published(factory.connection).at(-1)?.type).toBe('session-disposed'))
    await vi.waitFor(() => expect(factory.connection.disposed).toBe(true))
    expect(pi.api.logger.error).not.toHaveBeenCalled()
  })
  it('resolves fresh runtime context before every model request in one agent run', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory, tokenBudget: 222 })(pi.api)
    const ctx = extensionContext(root)
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Remember this' }], timestamp: 1 }]

    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    await pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start', prompt: 'Remember this', systemPrompt: ['Host prompt'],
    }, ctx)

    factory.connection.contextContent = 'First context.'
    const first = await pi.handlers.get('context')!({ type: 'context', messages }, ctx) as { messages: unknown[] }
    factory.connection.contextContent = 'Second context.'
    const second = await pi.handlers.get('context')!({ type: 'context', messages }, ctx) as { messages: unknown[] }

    expect(messages).toHaveLength(1)
    expect(first.messages).toHaveLength(2)
    expect(second.messages).toHaveLength(2)
    expect(first.messages.at(-1)).toMatchObject({
      role: 'developer', content: [{ type: 'text', text: 'First context.' }], attribution: 'agent',
    })
    expect(second.messages.at(-1)).toMatchObject({
      role: 'developer', content: [{ type: 'text', text: 'Second context.' }], attribution: 'agent',
    })
    expect(factory.connection.requests.filter(request => request.method === 'context.resolve')).toEqual([
      { method: 'context.resolve', params: { input: 'Remember this', turnId: 'omp-session:turn:1', tokenBudget: 222 } },
      { method: 'context.resolve', params: { input: 'Remember this', turnId: 'omp-session:turn:1', tokenBudget: 222 } },
    ])

    factory.connection.contextError = new Error('context failed')
    const failed = await pi.handlers.get('context')!({ type: 'context', messages }, ctx)
    expect(failed).toBeUndefined()
    expect(messages).toHaveLength(1)
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash']))
  })
  it('rebinds new resumed forked and branched sessions while retaining same-session tree navigation', async () => {
    const { root, home } = await projectFixture()
    const secondRoot = await mkdtemp(join(tmpdir(), 'doppelganger-extension-second-'))
    temporaryRoots.push(secondRoot)
    await mkdir(join(secondRoot, '.git'), { recursive: true })
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const session = mutableExtensionContext(root, 'session-one')

    await pi.handlers.get('session_start')!({ type: 'session_start' }, session.ctx)
    await pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start', prompt: 'Old turn', systemPrompt: [],
    }, session.ctx)
    session.setSessionId('session-two')
    session.setCwd(secondRoot)
    await pi.handlers.get('turn_start')!({ type: 'turn_start', turnIndex: 0, timestamp: 10 }, session.ctx)
    expect(published(factory.connection).at(-1)).toMatchObject({
      type: 'turn-started', sessionId: 'session-one', turnId: 'session-one:turn:1',
    })

    await pi.handlers.get('session_switch')!({
      type: 'session_switch', reason: 'resume', previousSessionFile: 'one.jsonl',
    }, session.ctx)
    expect(factory.connections).toHaveLength(2)
    expect(factory.connection.disposed).toBe(true)
    expect(published(factory.connection).at(-1)).toMatchObject({ type: 'session-disposed', sessionId: 'session-one' })
    expect(factory.connectionAt(1).requests[0]).toMatchObject({
      method: 'session.activate', params: { sessionId: 'session-two', workspaceRoot: secondRoot },
    })
    expect(published(factory.connectionAt(1)).at(0)).toMatchObject({ type: 'session-started', sessionId: 'session-two' })
    await pi.handlers.get('session_switch')!({
      type: 'session_switch', reason: 'resume', previousSessionFile: 'one.jsonl',
    }, session.ctx)
    await pi.handlers.get('session_branch')!({ type: 'session_branch', previousSessionFile: 'one.jsonl' }, session.ctx)
    expect(factory.connections).toHaveLength(2)


    await pi.handlers.get('session_tree')!({ type: 'session_tree', newLeafId: 'leaf', oldLeafId: null }, session.ctx)
    expect(factory.connections).toHaveLength(2)

    session.setSessionId('session-three')
    await pi.handlers.get('session_branch')!({ type: 'session_branch', previousSessionFile: 'two.jsonl' }, session.ctx)
    expect(factory.connections).toHaveLength(3)
    expect(factory.connectionAt(1).disposed).toBe(true)
    expect(factory.connectionAt(2).requests[0]).toMatchObject({
      method: 'session.activate', params: { sessionId: 'session-three', workspaceRoot: secondRoot },
    })

    factory.connectionAt(3).activationError = new Error('replacement failed')
    session.setSessionId('session-four')
    await pi.handlers.get('session_switch')!({
      type: 'session_switch', reason: 'fork', previousSessionFile: 'three.jsonl',
    }, session.ctx)
    expect(factory.connections).toHaveLength(4)
    expect(factory.connectionAt(2).disposed).toBe(true)
    expect(pi.activeTools()).toEqual(['read', 'bash'])
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('replacement failed'))
  })

  it('publishes no session completion for resumable OMP settle hooks', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)

    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(pi.handlers.has('agent_end')).toBe(false)
    expect(pi.handlers.has('session_stop')).toBe(false)
    expect(published(factory.connection).map(event => event.type)).not.toContain('session-completed')
  })
  it('commits only the latest requested binding when activation overlaps a session switch', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const firstActivation = deferred()
    factory.connection.activationGate = firstActivation.promise
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const session = mutableExtensionContext(root, 'session-one')

    const starting = pi.handlers.get('session_start')!({ type: 'session_start' }, session.ctx)
    await vi.waitFor(() => expect(factory.connection.requests).toContainEqual({
      method: 'session.activate', params: expect.objectContaining({ sessionId: 'session-one' }),
    }))
    session.setSessionId('session-two')
    const switching = pi.handlers.get('session_switch')!({
      type: 'session_switch', reason: 'resume', previousSessionFile: 'one.jsonl',
    }, session.ctx)
    firstActivation.resolve()
    await Promise.all([starting, switching])

    expect(factory.connection.disposed).toBe(true)
    expect(published(factory.connection).map(event => event.type)).not.toContain('session-started')
    expect(factory.connectionAt(1).requests[0]).toMatchObject({
      method: 'session.activate', params: { sessionId: 'session-two' },
    })
    expect(published(factory.connectionAt(1)).at(0)).toMatchObject({
      type: 'session-started', sessionId: 'session-two',
    })
    expect(factory.events.indexOf('dispose:0')).toBeLessThan(factory.events.indexOf('session.activate:1'))
  })

  it('discards stale context notifications lifecycle callbacks and proxy closures after replacement', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    factory.connection.activationTools = [runtimeTool('memory.old')]
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const session = mutableExtensionContext(root, 'session-one')

    await pi.handlers.get('session_start')!({ type: 'session_start' }, session.ctx)
    await pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start', prompt: 'Old prompt', systemPrompt: [],
    }, session.ctx)
    const oldTool = pi.tools.get('doppelganger_memory_old')!
    const oldToolsChanged = factory.connection.notifications.get('tools.changed')!
    const oldRuntimeFailed = factory.connection.notifications.get('runtime.failed')!
    const contextGate = deferred()
    factory.connection.contextGate = contextGate.promise
    const lateContext = pi.handlers.get('context')!({
      type: 'context', messages: [{ role: 'user', content: 'Old prompt', timestamp: 1 }],
    }, session.ctx)
    await vi.waitFor(() => expect(factory.connection.requests.some(request => request.method === 'context.resolve')).toBe(true))

    factory.connectionAt(1).activationTools = [runtimeTool('memory.new')]
    session.setSessionId('session-two')
    await pi.handlers.get('session_switch')!({
      type: 'session_switch', reason: 'resume', previousSessionFile: 'one.jsonl',
    }, session.ctx)
    contextGate.resolve()

    expect(await lateContext).toBeUndefined()
    oldToolsChanged([runtimeTool('memory.stale')])
    oldRuntimeFailed({ message: 'stale runtime failure' })
    await Promise.resolve()
    expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_memory_new'])
    expect((await oldTool.execute('stale', {}, undefined, undefined, session.ctx)).details).toEqual({
      code: 'RUNTIME_UNAVAILABLE', message: 'runtime tool is inactive',
    })
    await pi.handlers.get('turn_end')!({
      type: 'turn_end', turnIndex: 0,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Late old answer' }], stopReason: 'stop' },
      toolResults: [],
    }, session.ctx)
    expect(published(factory.connectionAt(1)).map(event => event.type)).toEqual(['session-started'])
  })

  it('invalidates an activation that settles after shutdown begins', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const activation = deferred()
    factory.connection.activationGate = activation.promise
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)

    const starting = pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    await vi.waitFor(() => expect(factory.connection.requests.some(request => request.method === 'session.activate')).toBe(true))
    pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)
    activation.resolve()
    await starting

    await vi.waitFor(() => expect(factory.connection.disposed).toBe(true))
    expect(published(factory.connection).map(event => event.type)).not.toContain('session-started')
    expect(pi.activeTools()).toEqual(['read', 'bash'])
  })
  it('projects readable proxy names, dispatches canonical names, and rejects stale closures after replacement', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    factory.connection.activationTools = [
      runtimeTool('persona.revise'),
      runtimeTool('runtime-plugin.inspect-list'),
      runtimeTool('memory.candidates.list'),
    ]
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)

    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(pi.activeTools()).toEqual([
      'read',
      'bash',
      'doppelganger_persona_revise',
      'doppelganger_runtime-plugin_inspect-list',
      'doppelganger_memory_candidates_list',
    ])

    const candidates = pi.tools.get('doppelganger_memory_candidates_list')!
    await candidates.execute('canonical', {}, undefined, undefined, ctx)
    expect(factory.connection.requests).toContainEqual({
      method: 'tools.invoke',
      params: { name: 'memory.candidates.list', input: {} },
    })

    const stale = pi.tools.get('doppelganger_persona_revise')!
    const invocationCount = factory.connection.requests.filter(request => request.method === 'tools.invoke').length
    factory.connection.notifications.get('tools.changed')?.([runtimeTool('memory.next')])
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_memory_next']))
    expect((await stale.execute('stale', {}, undefined, undefined, ctx)).details).toEqual({
      code: 'RUNTIME_UNAVAILABLE',
      message: 'runtime tool is inactive',
    })
    expect(factory.connection.requests.filter(request => request.method === 'tools.invoke')).toHaveLength(invocationCount)
  })

  it('accepts 64-character proxies while isolating overlong and colliding descriptors', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const maximumPortableName = `a.${'b'.repeat(49)}`
    const overlongPortableName = `a.${'b'.repeat(50)}`
    const maximumProxyName = `doppelganger_a_${'b'.repeat(49)}`
    const overlongProxyName = `doppelganger_a_${'b'.repeat(50)}`
    expect(maximumProxyName).toHaveLength(64)
    expect(overlongProxyName).toHaveLength(65)
    factory.connection.activationTools = [
      runtimeTool(maximumPortableName),
      runtimeTool(overlongPortableName),
      runtimeTool('one.two'),
      runtimeTool('one_two'),
      runtimeTool('valid.echo'),
    ]
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)

    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(pi.activeTools()).toEqual(['read', 'bash', maximumProxyName, 'doppelganger_valid_echo'])
    expect(pi.tools.has(maximumProxyName)).toBe(true)
    expect(pi.tools.has(overlongProxyName)).toBe(false)
    expect(pi.tools.has('doppelganger_one_two')).toBe(false)
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining(
      `portable tool "${overlongPortableName}" maps to a 65-character OMP proxy; limit is 64`,
    ))
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining(
      'runtime tools "one.two" and "one_two" map to the same OMP proxy "doppelganger_one_two"',
    ))

    await pi.tools.get(maximumProxyName)!.execute('maximum', {}, undefined, undefined, ctx)
    expect(factory.connection.requests).toContainEqual({
      method: 'tools.invoke',
      params: { name: maximumPortableName, input: {} },
    })
  })
  it('enforces required approval once per exact call in yolo and follows current reload metadata', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(pi.tools.get('doppelganger_memory_search')?.loadMode).toBe('discoverable')
    factory.connection.notifications.get('tools.changed')?.([{
      name: 'persona.revise',
      description: 'Revise Persona',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          replacement: { type: 'string' },
        },
        required: ['target', 'replacement'],
        additionalProperties: false,
      },
      approval: { policy: 'required', reason: 'This changes active Persona instructions.' },
      available: true,
    }])
    await vi.waitFor(() => expect(pi.tools.has('doppelganger_persona_revise')).toBe(true))
    const tool = pi.tools.get('doppelganger_persona_revise')!
    expect(tool.loadMode).toBe('essential')
    const args = { replacement: 'Updated.\n', target: 'trait:evolving-profile' }

    const prompts: string[] = []
    const approve = async (prompt: string) => {
      prompts.push(prompt)
      return 'Approve'
    }
    const first = await invokeWithNativeApproval(tool, args, { hasUI: true, select: approve })
    const second = await invokeWithNativeApproval(tool, args, { hasUI: true, select: approve })
    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Reason: This changes active Persona instructions.')
    expect(prompts[0]).toContain('Portable tool: persona.revise')
    expect(prompts[0]).toContain('Arguments: {\n  "replacement": "Updated.\\n",\n  "target": "trait:evolving-profile"\n}')
    expect(factory.connection.requests.filter(request => request.method === 'tools.invoke')).toHaveLength(2)

    await expect(invokeWithNativeApproval(tool, args, { hasUI: true, select: async () => 'Deny' }))
      .rejects.toThrow('Tool call denied by user')
    await expect(invokeWithNativeApproval(tool, args, {
      hasUI: true,
      select: async () => { throw new Error('approval cancelled') },
    })).rejects.toThrow('approval cancelled')
    await expect(invokeWithNativeApproval(tool, args, { hasUI: false }))
      .rejects.toThrow('requires approval but no interactive UI available')
    expect(factory.connection.requests.filter(request => request.method === 'tools.invoke')).toHaveLength(2)

    factory.connection.notifications.get('tools.changed')?.([{
      name: 'persona.revise',
      description: 'Revise Persona',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' }, replacement: { type: 'string' } },
        required: ['target', 'replacement'],
        additionalProperties: false,
      },
      available: true,
    }])
    await vi.waitFor(() => expect(pi.tools.get('doppelganger_persona_revise')?.loadMode).toBe('discoverable'))
    await vi.waitFor(() => expect((tool.approval as () => unknown)()).toBe('exec'))
    expect(tool.formatApprovalDetails?.(args)).toBeUndefined()

    factory.connection.notifications.get('tools.changed')?.([{
      name: 'persona.revise',
      description: 'Revise Persona',
      inputSchema: {
        type: 'object',
        properties: { target: { type: 'string' }, replacement: { type: 'string' } },
        required: ['target', 'replacement'],
        additionalProperties: false,
      },
      approval: { policy: 'required', reason: 'Review the updated revision.' },
      available: true,
    }])
    await vi.waitFor(() => expect(pi.tools.get('doppelganger_persona_revise')?.loadMode).toBe('essential'))
    await vi.waitFor(() => expect((tool.approval as () => unknown)()).toEqual({
      tier: 'write', policy: 'prompt', reason: 'Review the updated revision.',
    }))
    const bounded = tool.formatApprovalDetails?.({ replacement: 'x'.repeat(4_000), target: 'trait:evolving-profile' })
    expect(Array.isArray(bounded) ? bounded.join('\n').length : 0).toBeLessThan(2_100)
  })


  it('owns independent children for concurrent OMP sessions', async () => {
    const { root, home } = await projectFixture()
    const firstFactory = new ExtensionFactory()
    const secondFactory = new ExtensionFactory()
    const firstPi = fakePi()
    const secondPi = fakePi()
    createDoppelgangerOmpExtension({ home, actorId: 'actor-one', childFactory: firstFactory })(firstPi.api)
    createDoppelgangerOmpExtension({ home, actorId: 'actor-two', childFactory: secondFactory })(secondPi.api)

    await Promise.all([
      firstPi.handlers.get('session_start')!({ type: 'session_start' }, extensionContext(root, 'first-session')),
      secondPi.handlers.get('session_start')!({ type: 'session_start' }, extensionContext(root, 'second-session')),
    ])

    expect(firstFactory.connection).not.toBe(secondFactory.connection)
    expect(firstFactory.connection.requests).toContainEqual(expect.objectContaining({
      method: 'session.activate', params: expect.objectContaining({ actorId: 'actor-one' }),
    }))
    expect(secondFactory.connection.requests).toContainEqual(expect.objectContaining({
      method: 'session.activate', params: expect.objectContaining({ actorId: 'actor-two' }),
    }))
    firstFactory.connection.notifications.get('runtime.failed')?.({ message: 'first child failed' })
    await vi.waitFor(() => expect(firstPi.activeTools()).toEqual(['read', 'bash']))
    expect(secondPi.activeTools()).toContain('doppelganger_memory_search')

    await secondPi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, extensionContext(root, 'second-session'))
    await vi.waitFor(() => expect(secondFactory.connection.disposed).toBe(true))
  })

  it('publishes bounded pre-compaction lifecycle material', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    await pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start', prompt: 'Current user turn', systemPrompt: [],
    }, ctx)
    await pi.handlers.get('turn_start')!({ type: 'turn_start', turnIndex: 0, timestamp: 10 }, ctx)

    await pi.handlers.get('session_before_compact')!({
      preparation: { summary: 'bounded preparation' },
      branchEntries: [{ role: 'user', content: 'bounded branch' }],
      customInstructions: 'retain current goal',
    }, ctx)

    const event = published(factory.connection).at(-1)
    expect(event).toMatchObject({
      protocolVersion: 2,
      type: 'pre-compaction',
      sessionId: 'omp-session',
      turnId: expect.any(String),
      material: {
        value: {
          preparation: { summary: 'bounded preparation' },
          branchEntries: [{ role: 'user', content: 'bounded branch' }],
          customInstructions: 'retain current goal',
        },
      },
    })
    expect(published(factory.connection).filter(item => item.type === 'pre-compaction')).toHaveLength(1)
    await pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)
    await vi.waitFor(() => expect(factory.connection.disposed).toBe(true))
  })

  it('isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics', async () => {
    const { root, home } = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    factory.connection.notifications.get('runtime.failed')?.({ message: 'child crashed' })
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash']))
    await vi.waitFor(() => expect(factory.connection.disposed).toBe(true))
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('child crashed'))
    await expect(pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start', prompt: 'OMP still works', systemPrompt: ['Normal prompt'],
    }, ctx)).resolves.toBeUndefined()
  })


  it('rejects invalid actor configuration before starting a child', async () => {
    const { root, home } = await projectFixture()
    const pi = fakePi()
    const factory = new ExtensionFactory()
    createDoppelgangerOmpExtension({ home, actorId: ' ', childFactory: factory })(pi.api)

    await pi.handlers.get('session_start')!({ type: 'session_start' }, extensionContext(root))

    expect(factory.connection.requests).toEqual([])
    expect(pi.activeTools()).toEqual(['read', 'bash'])
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('actorId must be a non-empty string'))
  })
  it('initializes only without selection and writes a strict Runtime Preset manifest', async () => {
    const { root, home } = await projectFixture(false)
    const pi = fakePi()
    const factory = new ExtensionFactory()
    createDoppelgangerOmpExtension({
      home,
      runtimePresets: { includeShippedRoot: false, defaultRuntimePreset: null },
      childFactory: factory,
    })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_initialize'])
    const initialize = pi.tools.get('doppelganger_initialize')!
    expect(initialize.defaultInactive).toBe(true)
    expect(factory.connection.requests).toEqual([])
    const result = await initialize.execute('call', { runtimePreset: 'portable-runtime' }, undefined, undefined, ctx)
    expect(result.isError).toBeUndefined()
    expect(await readFile(join(root, '.doppelganger', 'manifest.yaml'), 'utf8')).toBe(
      'version: 1\nruntimePreset: "portable-runtime"\n',
    )
    expect(factory.connection.requests[0]).toMatchObject({ method: 'session.activate' })
  })

  it('releases the OMP shutdown handler while bounded child disposal continues', async () => {
    const { root, home } = await projectFixture()
    const pi = fakePi()
    const factory = new ExtensionFactory()
    factory.connection.hangDisposal = true
    createDoppelgangerOmpExtension({ home, childFactory: factory })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)

    const outcome = await Promise.race([
      Promise.resolve(pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)).then(() => 'returned'),
      new Promise<string>(resolve => setTimeout(() => resolve('host-timeout'), 50)),
    ])

    expect(outcome).toBe('returned')
    await vi.waitFor(() => expect(factory.connection.disposed).toBe(true))
  })

  it('bounds shutdown and reports forced completion honestly', async () => {
    const { root, home } = await projectFixture()
    const pi = fakePi()
    const factory = new ExtensionFactory()
    factory.connection.hangSessionDisposal = true
    factory.connection.disposal = { outcome: 'terminated', sessionDisposeAcknowledged: false }
    createDoppelgangerOmpExtension({ home, childFactory: factory, shutdownTimeoutMs: 10 })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    await pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)
    await vi.waitFor(() => expect(factory.connection.disposed).toBe(true))
    await vi.waitFor(() => expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('timed out')))
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('runtime shutdown terminated'))
  })
})
