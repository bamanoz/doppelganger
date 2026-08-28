import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import { OMP_RPC_PROTOCOL_VERSION } from '../src/contracts.ts'
import {
  createDoppelgangerOmpExtension,
  type OmpChildConnection,
  type OmpChildDisposal,
  type OmpChildFactory,
  type SerializedCompositionActivation,
} from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class ExtensionConnection implements OmpChildConnection {
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly notifications = new Map<string, (params: unknown) => void>()
  contextContent = 'Persona context.'
  disposed = false
  hangSessionCompletion = false
  disposal: OmpChildDisposal = { outcome: 'graceful', sessionDisposeAcknowledged: true }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'session.activate') return {
      protocolVersion: OMP_RPC_PROTOCOL_VERSION,
      diagnostics: {},
      tools: [{
        name: 'memory.search',
        description: 'Search memory',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
        available: true,
      }],
    }
    if (method === 'context.resolve') return { content: this.contextContent, contributions: [], omittedSources: [], tokenCount: 4 }
    if (method === 'tools.invoke') return { ok: true, value: { found: 1 } }
    if (method === 'event.publish' && this.hangSessionCompletion) {
      const event = params as { type?: string }
      if (event.type === 'session-completed') return new Promise(() => undefined)
    }
    return null
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    this.notifications.set(method, handler)
    return () => this.notifications.delete(method)
  }

  async dispose(): Promise<OmpChildDisposal> {
    this.disposed = true
    return this.disposal
  }
}

class ExtensionFactory implements OmpChildFactory {
  readonly connection = new ExtensionConnection()
  async start(): Promise<OmpChildConnection> { return this.connection }
}

interface RegisteredTool {
  name: string
  description: string
  defaultInactive?: boolean
  parameters: unknown
  execute(...args: unknown[]): Promise<{ content: Array<{ text: string }>; isError?: boolean }>
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

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-extension-'))
  temporaryRoots.push(root)
  await mkdir(join(root, '.git'), { recursive: true })
  return root
}

function activation(cwd: string, sessionId: string): SerializedCompositionActivation {
  return {
    composition: {
      id: 'portable-persona',
      revision: 'one',
      loaderPath: join(cwd, 'cordis.yaml'),
      imports: {},
      mounts: { persona: { target: 'session', required: true }, host: { target: 'session', required: true } },
    },
    sessionId,
    mounts: {},
    hostMount: 'host',
    watch: false,
  }
}

function extensionContext(cwd: string): ExtensionContext {
  return {
    cwd,
    hasUI: false,
    ui: { notify: vi.fn() },
    sessionManager: { getSessionId: () => 'omp-session' },
  } as unknown as ExtensionContext
}

function published(connection: ExtensionConnection) {
  return connection.requests
    .filter(request => request.method === 'event.publish')
    .map(request => request.params as Record<string, unknown>)
}

describe('Doppelganger OMP extension', () => {
  it('preserves host prompts, projects exact schemas and tools, and forwards committed lifecycle payloads', async () => {
    const root = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({
      childFactory: factory,
      activationResolver: request => activation(request.cwd, request.sessionId),
      tokenBudget: 321,
    })(pi.api)
    const ctx = extensionContext(root)

    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_memory_x2e_search'])
    const projected = await pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start',
      prompt: 'Current user turn',
      systemPrompt: ['Existing OMP instructions.'],
    }, ctx) as { systemPrompt: string[] }
    expect(projected.systemPrompt).toEqual(['Existing OMP instructions.', 'Persona context.'])
    expect(factory.connection.requests).toContainEqual({
      method: 'context.resolve',
      params: expect.objectContaining({ input: 'Current user turn', tokenBudget: 321 }),
    })

    const search = pi.tools.get('doppelganger_memory_x2e_search')!
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
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_memory_x2e_remember']))
    expect((await search.execute('call', { query: 'stale' }, undefined, undefined, ctx)).isError).toBe(true)
    const remember = pi.tools.get('doppelganger_memory_x2e_remember')!
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
    await vi.waitFor(() => expect(pi.tools.get('doppelganger_memory_x2e_remember')?.description).toContain('updated'))
    expect(pi.tools.get('doppelganger_memory_x2e_remember')?.parameters).not.toBe(firstSchema)

    factory.connection.contextContent = 'Reloaded persona context.'
    factory.connection.notifications.get('profile.changed')?.({ revision: 'two' })
    const afterReload = await pi.handlers.get('before_agent_start')!({
      type: 'before_agent_start',
      prompt: 'Next turn',
      systemPrompt: ['Existing OMP instructions.'],
    }, ctx) as { systemPrompt: string[] }
    expect(afterReload.systemPrompt).toEqual(['Existing OMP instructions.', 'Reloaded persona context.'])

    await pi.handlers.get('turn_start')!({ type: 'turn_start', turnIndex: 0, timestamp: 10 }, ctx)
    await pi.handlers.get('tool_execution_start')!({
      type: 'tool_execution_start', toolCallId: 'call-one', toolName: 'read', args: { path: 'a.ts' },
    }, ctx)
    await pi.handlers.get('tool_execution_end')!({
      type: 'tool_execution_end', toolCallId: 'call-one', toolName: 'read', result: { content: 'file' }, isError: false,
    }, ctx)
    await pi.handlers.get('agent_end')!({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Completed answer.' }], stopReason: 'stop' }],
    }, ctx)
    expect(published(factory.connection).map(event => event.type)).toEqual([
      'session-started',
      'turn-started',
      'tool-started',
      'tool-completed',
      'turn-committed',
    ])
    expect(published(factory.connection).at(-1)).toMatchObject({
      protocolVersion: 1,
      principalInput: { value: 'Next turn' },
      assistantOutput: { value: 'Completed answer.' },
      toolOutcomes: [{
        callId: 'call-one',
        name: 'read',
        outcome: 'completed',
        result: { value: { content: 'file' } },
      }],
    })

    factory.connection.notifications.get('tools.changed')?.([])
    await vi.waitFor(() => expect(pi.activeTools()).toEqual(['read', 'bash']))
    await pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)
    expect(published(factory.connection).at(-1)?.type).toBe('session-completed')
    expect(factory.connection.disposed).toBe(true)
    expect(pi.api.logger.error).not.toHaveBeenCalled()
  })

  it('isolates forced runtime failure while preserving ordinary OMP behavior and diagnostics', async () => {
    const root = await projectFixture()
    const factory = new ExtensionFactory()
    const pi = fakePi()
    createDoppelgangerOmpExtension({
      childFactory: factory,
      activationResolver: request => activation(request.cwd, request.sessionId),
    })(pi.api)
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

  it('activates initialization only when the generic resolver selects no persona', async () => {
    const root = await projectFixture()
    const pi = fakePi()
    const factory = new ExtensionFactory()
    createDoppelgangerOmpExtension({
      childFactory: factory,
      activationResolver: () => undefined,
    })(pi.api)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, extensionContext(root))
    expect(pi.activeTools()).toEqual(['read', 'bash', 'doppelganger_initialize'])
    expect(pi.tools.get('doppelganger_initialize')?.defaultInactive).toBe(true)
    expect(factory.connection.requests).toEqual([])
  })

  it('bounds shutdown and reports forced completion honestly', async () => {
    const root = await projectFixture()
    const pi = fakePi()
    const factory = new ExtensionFactory()
    factory.connection.hangSessionCompletion = true
    factory.connection.disposal = { outcome: 'terminated', sessionDisposeAcknowledged: false }
    createDoppelgangerOmpExtension({
      childFactory: factory,
      activationResolver: request => activation(request.cwd, request.sessionId),
      shutdownTimeoutMs: 10,
    })(pi.api)
    const ctx = extensionContext(root)
    await pi.handlers.get('session_start')!({ type: 'session_start' }, ctx)
    await pi.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, ctx)
    expect(factory.connection.disposed).toBe(true)
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    expect(pi.api.logger.error).toHaveBeenCalledWith(expect.stringContaining('runtime shutdown terminated'))
  })
})
