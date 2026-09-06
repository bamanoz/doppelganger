import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  digestToolInput,
  serializeLifecycleValue,
} from '@doppelganger/doppelganger-protocols'
import { RuntimePresetRoster } from '@doppelganger/doppelganger-runtime-presets'
import { Pool } from 'pg'
import { OMP_RPC_PROTOCOL_VERSION, OMP_RUNTIME_HOST_CAPABILITIES } from '../src/contracts.ts'
import {
  OmpAdapterSession,
  type OmpChildConnection,
  type OmpChildDisposal,
  type OmpChildFactory,
} from '../src/adapter.ts'
import { createDoppelgangerOmpExtension, resolveOmpActivation } from '../src/extension.ts'
import { NodeOmpChildFactory } from '../src/process.ts'
import { FramedJsonRpcPeer } from '../src/protocol.ts'

const temporaryRoots: string[] = []
let rpcOrdinal = 0

interface ChildHarness {
  readonly child: ChildProcessWithoutNullStreams
  readonly peer: FramedJsonRpcPeer
  readonly stderr: Buffer[]
}

interface RpcRequester {
  request(method: string, params?: unknown): Promise<unknown>
}

interface RecordedChildConnection extends OmpChildConnection {
  readonly requests: Array<{ readonly method: string; readonly params: unknown }>
  readonly disposed: Promise<OmpChildDisposal>
}

interface CommittedLifecycleEvent extends Record<string, unknown> {
  readonly deliveryId: string
  readonly sessionId: string
  readonly turnId: string
}

class RecordingNodeChildFactory implements OmpChildFactory {
  readonly connections: RecordedChildConnection[] = []
  readonly #inner: NodeOmpChildFactory

  constructor() {
    this.#inner = new NodeOmpChildFactory({
      childPath: fileURLToPath(new URL('../src/child.ts', import.meta.url)),
      shutdownTimeoutMs: 1000,
    })
  }

  async start(): Promise<OmpChildConnection> {
    const inner = await this.#inner.start()
    const requests: Array<{ readonly method: string; readonly params: unknown }> = []
    const completion = Promise.withResolvers<OmpChildDisposal>()
    let disposal: Promise<OmpChildDisposal> | undefined
    const connection: RecordedChildConnection = {
      requests,
      disposed: completion.promise,
      ...(inner.processId === undefined ? {} : { processId: inner.processId }),
      request(method, params) {
        requests.push({ method, params })
        return inner.request(method, params)
      },
      onNotification(method, handler) {
        return inner.onNotification(method, handler)
      },
      dispose() {
        disposal ??= inner.dispose().then(result => {
          completion.resolve(result)
          return result
        }, cause => {
          completion.reject(cause)
          throw cause
        })
        return disposal
      },
    }
    this.connections.push(connection)
    return connection
  }
}

interface MountedOmpExtension {
  readonly handlers: Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown>
  readonly context: ExtensionContext
  readonly errors: string[]
}

function mountedOmpExtension(
  root: string,
  sessionId: string,
  install: (api: ExtensionAPI) => void,
): MountedOmpExtension {
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown>()
  const errors: string[] = []
  let activeTools = ['read', 'bash']
  const schema = { min: () => schema }
  const api = {
    zod: { string: () => schema, object: () => ({}) },
    logger: { error(message: string) { errors.push(message) } },
    registerTool() {},
    on(event: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown) {
      handlers.set(event, handler)
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: async (names: string[]) => { activeTools = [...names] },
  } as unknown as ExtensionAPI
  const context = {
    cwd: root,
    hasUI: false,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext
  install(api)
  return { handlers, context, errors }
}

function published(connection: RecordedChildConnection, type?: string): Array<Record<string, unknown>> {
  return connection.requests.flatMap(request => (
    request.method === 'event.publish'
    && request.params !== null
    && typeof request.params === 'object'
    && (type === undefined || ('type' in request.params && request.params.type === type))
      ? [request.params as Record<string, unknown>]
      : []
  ))
}

async function waitForInferenceCalls(connection: OmpChildConnection, expected: number): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const result = await invokeTool(connection, 'signal-test.inference-calls', {})
    if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === true
      && 'value' in result && result.value !== null && typeof result.value === 'object'
      && 'calls' in result.value && result.value.calls === expected) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error(`signal inference call count ${expected} timed out`)
}

interface EvolutionDatabaseState {
  readonly receipts: Array<Record<string, unknown>>
  readonly signals: Array<Record<string, unknown>>
  readonly aggregates: Array<Record<string, unknown>>
  readonly proposals: Array<Record<string, unknown>>
  readonly evidence: Array<Record<string, unknown>>
  readonly diagnostics: Array<Record<string, unknown>>
  readonly transitions: Array<Record<string, unknown>>
}

function evolutionDatabaseState(path: string): EvolutionDatabaseState {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return {
      receipts: database.prepare('SELECT delivery_id, session_id, turn_id FROM evolution_signal_receipts ORDER BY delivery_id').all(),
      signals: database.prepare('SELECT delivery_id, turn_id, source FROM evolution_signals ORDER BY delivery_id').all(),
      aggregates: database.prepare('SELECT occurrence_count, deterministic_occurrence_count, distinct_turns, distinct_sessions, promotion_status, proposal_id FROM evolution_signal_aggregates').all(),
      proposals: database.prepare('SELECT id, kind, scope, status, current_revision FROM evolution_proposals ORDER BY id').all(),
      evidence: database.prepare('SELECT proposal_id, source_id FROM evolution_evidence ORDER BY source_id').all(),
      diagnostics: database.prepare('SELECT code, delivery_id, pattern_key FROM evolution_signal_diagnostics ORDER BY code, delivery_id').all(),
      transitions: database.prepare('SELECT proposal_id, from_status, to_status FROM evolution_transitions ORDER BY created_at, id').all(),
    }
  } finally {
    database.close()
  }
}

async function waitForEvolutionState(
  path: string,
  predicate: (state: EvolutionDatabaseState) => boolean,
): Promise<EvolutionDatabaseState> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const state = evolutionDatabaseState(path)
    if (predicate(state)) return state
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error('Evolution database state timed out')
}

async function completeOmpTurn(
  extension: MountedOmpExtension,
  ordinal: number,
  outcome: 'completed' | 'failed' | 'cancelled',
  commit = true,
): Promise<void> {
  await extension.handlers.get('before_agent_start')!({
    type: 'before_agent_start', prompt: `Read missing fixture ${ordinal}.`, systemPrompt: [],
  }, extension.context)
  const timestamp = Date.now()
  await extension.handlers.get('turn_start')!({
    type: 'turn_start', turnIndex: ordinal, timestamp,
  }, extension.context)
  await extension.handlers.get('tool_execution_end')!({
    type: 'tool_execution_end',
    toolCallId: `native-read-${ordinal}`,
    toolName: 'read',
    result: { code: 'ENOENT', message: 'Missing fixture.' },
    isError: true,
  }, extension.context)
  if (!commit) return
  await extension.handlers.get('turn_end')!({
    type: 'turn_end',
    turnIndex: ordinal,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'The fixture read failed.' }],
      stopReason: outcome === 'completed' ? 'stop' : outcome === 'failed' ? 'error' : 'aborted',
      timestamp: timestamp + 1,
    },
    toolResults: [],
  }, extension.context)
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>()
  const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 3000)
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

function notification(peer: FramedJsonRpcPeer, method: string): Promise<unknown> {
  const { promise, resolve } = Promise.withResolvers<unknown>()
  const remove = peer.onNotification(method, value => {
    remove()
    resolve(value)
  })
  return promise
}

async function resolveContext(peer: RpcRequester, input: string, tokenBudget = 1000): Promise<unknown> {
  return peer.request('context.resolve', {
    requestId: `child-context:${++rpcOrdinal}`,
    turn: { input, turnId: `child-turn:${rpcOrdinal}` },
    tokenBudget,
  })
}

async function toolCatalog(peer: RpcRequester) {
  return peer.request('tools.snapshot') as Promise<{
    revision: string
    tools: Array<{ name: string; revision: string; approval?: unknown }>
  }>
}

async function invokeTool(
  peer: RpcRequester,
  name: string,
  input: Record<string, unknown>,
  options: { readonly callId?: string; readonly toolRevision?: string; readonly grantId?: string } = {},
): Promise<unknown> {
  const current = await toolCatalog(peer)
  const descriptor = current.tools.find(tool => tool.name === name)
  const callId = options.callId ?? `child-call:${++rpcOrdinal}`
  const toolRevision = options.toolRevision ?? descriptor?.revision ?? 'tool:missing'
  return peer.request('tools.invoke', {
    callId,
    name,
    toolRevision,
    input,
    ...(descriptor?.approval === undefined ? {} : {
      approval: {
        kind: 'one-shot',
        grantId: options.grantId ?? `child-grant:${rpcOrdinal}`,
        callId,
        toolRevision,
        inputDigest: digestToolInput(input as never),
      },
    }),
  })
}

async function changedCatalog(peer: FramedJsonRpcPeer, operation: () => Promise<void>): Promise<{
  revision: string
  tools: Array<{ name: string; description: string; approval?: unknown; revision: string }>
}> {
  const before = await toolCatalog(peer)
  const changed = notification(peer, 'toolCatalog.changed')
  await operation()
  await timeout(changed, 'tool catalog change') as { revision: string }
  const catalog = await toolCatalog(peer)
  expect(catalog.revision).not.toBe(before.revision)
  return catalog as never
}

interface ChildRuntimeDiagnostics {
  readonly runtimeRevision: string
  readonly diagnostics: { readonly reload?: { readonly state?: string; readonly error?: string } }
}

async function runtimeDiagnostics(peer: FramedJsonRpcPeer): Promise<ChildRuntimeDiagnostics> {
  return peer.request('runtime.diagnostics') as Promise<ChildRuntimeDiagnostics>
}

async function waitForReloadState(peer: FramedJsonRpcPeer, state: string): Promise<ChildRuntimeDiagnostics> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const current = await runtimeDiagnostics(peer)
    if (current.diagnostics?.reload?.state === state) return current
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`runtime reload state ${state} timed out`)
}

function activation(root: string, patches: readonly object[] = [], actorId?: string, sessionId = 'omp-session') {
  return {
    protocolVersion: OMP_RPC_PROTOCOL_VERSION,
    capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
    composition: {
      id: 'generic-child',
      revision: 'authored-one',
      loaderPath: join(root, 'runtime.cordis.yml'),
      patches,
    },
    sessionId,
    workspaceRoot: root,
    hostKind: 'omp' as const,
    watch: true,
    hostExtensions: {
      modules: [],
      selections: [
        { id: 'actor', config: null },
        { id: 'omp-host-events', config: null },
        { id: 'runtime-host', config: null },
      ],
      facts: { hostKind: 'omp', ...(actorId === undefined ? {} : { actorId }) },
    },
  }
}

async function childHarness(): Promise<ChildHarness> {
  const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
  const child = spawn(process.execPath, ['--no-warnings', childPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  if (child.stdin === null || child.stdout === null) throw new Error('child stdio unavailable')
  const stderr: Buffer[] = []
  child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
  return { child, peer: new FramedJsonRpcPeer(child.stdout, child.stdin), stderr }
}

async function dispose(harness: ChildHarness): Promise<void> {
  if (harness.child.killed || harness.child.exitCode !== null || harness.child.signalCode !== null) return
  const exited = once(harness.child, 'exit')
  await timeout(harness.peer.request('session.dispose'), 'session.dispose')
  await timeout(exited.then(() => undefined), 'child exit')
}

function childError(harness: ChildHarness, cause: unknown): Error {
  harness.child.kill()
  const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  return new Error(`${message}\n${Buffer.concat(harness.stderr).toString('utf8')}`)
}

async function writeProtocolPreset(root: string): Promise<void> {
  const protocolPackage = JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)
  await Promise.all([
    writeFile(join(root, 'context.mjs'), `export { ContextProtocol as default } from ${protocolPackage}\n`),
    writeFile(join(root, 'tools.mjs'), `export { ToolRegistry as default } from ${protocolPackage}\n`),
    writeFile(join(root, 'feature.mjs'), [
      'export default {',
      "  name: 'generic-feature',",
      "  inject: ['doppelgangerContext', 'doppelgangerTools'],",
      '  apply(ctx, config) {',
      '    ctx.doppelgangerContext.register({',
      "      id: 'generic-feature',",
      '      resolve: () => [{',
      "        source: 'generic-feature', authority: 'instruction', priority: 100, content: config.content,",
      '      }],',
      '    })',
      '    ctx.doppelgangerTools.register({',
      "      name: config.toolName, description: config.description, available: true, ...(config.approval === undefined ? {} : { approval: config.approval }),",
      "      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },",
      '      invoke: input => ({ echoed: input.value, generation: config.content }),',
      '    })',
      '  },',
      '}',
      '',
    ].join('\n')),
    writeFile(join(root, 'runtime.cordis.yml'), [
      '- id: context',
      '  name: ./context.mjs',
      '  isolate:',
      '    doppelgangerContext: session',
      '- id: tools',
      '  name: ./tools.mjs',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: feature',
      '  name: ./feature.mjs',
      '  inject: [doppelgangerContext, doppelgangerTools]',
      '  isolate:',
      '    doppelgangerContext: session',
      '    doppelgangerTools: session',
      '  config:',
      '    toolName: generic.echo',
      '    content: Generic runtime context one.',
      '    description: Echo one',
      '    approval:',
      '      policy: required',
      '      reason: Review this exact generic invocation.',
      '',
    ].join('\n')),
  ])
}

const POSTGRESQL_DSN_ENV = 'DOPPELGANGER_TEST_POSTGRESQL_DSN'

function requiredPostgresqlDsn(): string {
  const dsn = process.env[POSTGRESQL_DSN_ENV]
  if (typeof dsn !== 'string' || dsn.trim().length === 0) {
    throw new Error(`${POSTGRESQL_DSN_ENV} is required for the PostgreSQL OMP vertical`)
  }
  return dsn
}

function postgresqlSchema(label: string): string {
  return `doppelganger_omp_${label}_${process.pid}_${Date.now()}_${++rpcOrdinal}`
}

function quotePostgresqlIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) throw new TypeError('invalid PostgreSQL test schema')
  return `"${value}"`
}

async function writePostgresqlMemoryPreset(root: string, schema: string): Promise<void> {
  await writeFile(join(root, 'runtime.cordis.yml'), [
    '- id: context',
    '  name: "@doppelganger/doppelganger-protocols/context"',
    '  isolate:',
    '    doppelgangerContext: session',
    '- id: tools',
    '  name: "@doppelganger/doppelganger-protocols/tools"',
    '  isolate:',
    '    doppelgangerTools: session',
    '- id: persona',
    '  name: "@doppelganger/doppelganger-persona"',
    '  inject: [doppelgangerRuntimeSession, doppelgangerContext]',
    '  isolate:',
    '    doppelgangerRuntimeSession: session',
    '    doppelgangerContext: session',
    '    doppelgangerPersona: session',
    '  config:',
    '    instanceId: postgresql-memory-vertical',
    '- id: memory-postgresql',
    '  name: "@doppelganger/doppelganger-memory/postgresql"',
    '  inject: [doppelgangerActor]',
    '  isolate:',
    '    doppelgangerActor: session',
    '    doppelgangerMemoryRepository: session',
    '  config:',
    `    connectionStringEnv: ${POSTGRESQL_DSN_ENV}`,
    `    schema: ${schema}`,
    '    poolSize: 2',
    '    connectionTimeoutMs: 5000',
    '    statementTimeoutMs: 5000',
    '    lockTimeoutMs: 5000',
    '- id: memory',
    '  name: "@doppelganger/doppelganger-memory"',
    '  inject: [doppelgangerActor, doppelgangerPersona, doppelgangerContext, doppelgangerTools, doppelgangerMemoryRepository]',
    '  isolate:',
    '    doppelgangerActor: session',
    '    doppelgangerPersona: session',
    '    doppelgangerContext: session',
    '    doppelgangerTools: session',
    '    doppelgangerMemoryRepository: session',
    '    doppelgangerMemory: session',
    '- id: memory-capture',
    '  name: "@doppelganger/doppelganger-memory/capture"',
    '  inject: [doppelgangerActor, doppelgangerPersona, doppelgangerMemory]',
    '  isolate:',
    '    doppelgangerActor: session',
    '    doppelgangerPersona: session',
    '    doppelgangerMemory: session',
    '  config:',
    '    enabled: true',
    '',
  ].join('\n'))
}

async function memoryToolValue(
  peer: RpcRequester,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const result = await invokeTool(peer, name, input)
  if (result === null || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('value' in result)) {
    throw new Error(`${name} failed: ${JSON.stringify(result)}`)
  }
  return result.value
}

function memorySearchContents(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('memory search returned an invalid result')
  return value.flatMap(item => {
    if (item === null || typeof item !== 'object' || !('record' in item)
      || item.record === null || typeof item.record !== 'object' || !('revision' in item.record)
      || item.record.revision === null || typeof item.record.revision !== 'object'
      || !('content' in item.record.revision) || typeof item.record.revision.content !== 'string') return []
    return [item.record.revision.content]
  })
}

function memoryRecordCoordinates(value: unknown): { id: string; revisionId: string } {
  if (value === null || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
    || !('revision' in value) || value.revision === null || typeof value.revision !== 'object'
    || !('id' in value.revision) || typeof value.revision.id !== 'string') {
    throw new TypeError('memory mutation returned an invalid record')
  }
  return { id: value.id, revisionId: value.revision.id }
}

function namedTool(value: unknown): value is { readonly name: string } {
  return value !== null && typeof value === 'object' && 'name' in value && typeof value.name === 'string'
}

function activationToolNames(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || !('catalog' in value)
    || value.catalog === null || typeof value.catalog !== 'object' || !('tools' in value.catalog)
    || !Array.isArray(value.catalog.tools) || !value.catalog.tools.every(namedTool)) {
    throw new TypeError('memory activation returned an invalid tool catalog')
  }
  return value.catalog.tools.map(tool => tool.name)
}

function resolvedContextData(value: unknown): string {
  if (value === null || typeof value !== 'object' || !('data' in value) || typeof value.data !== 'string') {
    throw new TypeError('memory context resolution returned an invalid result')
  }
  return value.data
}

async function waitForMemoryValue(
  peer: RpcRequester,
  name: string,
  input: Record<string, unknown>,
  predicate: (value: unknown) => boolean,
): Promise<unknown> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const value = await memoryToolValue(peer, name, input)
    if (predicate(value)) return value
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  throw new Error(`${name} visibility timed out`)
}

async function writeOmpEventPreset(root: string): Promise<void> {
  const protocolPackage = JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)
  await Promise.all([
    writeFile(join(root, 'tools.mjs'), `export { ToolRegistry as default } from ${protocolPackage}\n`),
    writeFile(join(root, 'omp-events.mjs'), [
      'let lastEvent = null',
      'export default {',
      "  name: 'omp-event-observer',",
      "  inject: ['doppelgangerTools'],",
      '  apply(ctx) {',
      "    ctx.on('doppelganger/host/omp/todo-reminder', event => { lastEvent = event })",
      '    ctx.doppelgangerTools.register({',
      "      name: 'omp.todo.last', description: 'Return the last OMP todo reminder',",
      "      inputSchema: { type: 'object', properties: {}, additionalProperties: false },",
      '      invoke: () => lastEvent,',
      '    })',
      '  },',
      '}',
      '',
    ].join('\n')),
    writeFile(join(root, 'runtime.cordis.yml'), [
      '- id: tools',
      '  name: ./tools.mjs',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: omp-events',
      '  name: ./omp-events.mjs',
      '  inject: [doppelgangerTools]',
      '  isolate:',
      '    doppelgangerTools: session',
      '',
    ].join('\n')),
  ])
}

async function writeEvolutionPreset(root: string): Promise<void> {
  const modules = {
    context: JSON.stringify(new URL('../../extension-protocols/src/context-plugin.ts', import.meta.url).href),
    tools: JSON.stringify(new URL('../../extension-protocols/src/tools-plugin.ts', import.meta.url).href),
    persona: JSON.stringify(new URL('../../extension-persona/src/index.ts', import.meta.url).href),
    sqlite: JSON.stringify(new URL('../../extension-sqlite/src/index.ts', import.meta.url).href),
    evolution: JSON.stringify(new URL('../../extension-evolution/src/index.ts', import.meta.url).href),
  }
  await Promise.all([
    ...Object.entries(modules).map(([name, specifier]) => writeFile(
      join(root, `${name}.mjs`), `export { default } from ${specifier}\n`,
    )),
    writeFile(join(root, 'runtime.cordis.yml'), [
      '- id: context',
      '  name: ./context.mjs',
      '  isolate:',
      '    doppelgangerContext: session',
      '- id: tools',
      '  name: ./tools.mjs',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: persona',
      '  name: ./persona.mjs',
      '  inject: [doppelgangerRuntimeSession, doppelgangerContext]',
      '  isolate:',
      '    doppelgangerRuntimeSession: session',
      '    doppelgangerContext: session',
      '    doppelgangerPersona: session',
      '  config:',
      '    instanceId: evolution-child-test',
      '- id: sqlite',
      '  name: ./sqlite.mjs',
      '  isolate:',
      '    doppelgangerInstanceSqlite: session',
      '  config:',
      `    home: ${JSON.stringify(join(root, 'home'))}`,
      '- id: evolution',
      '  name: ./evolution.mjs',
      '  inject: [doppelgangerRuntimeSession, doppelgangerActor, doppelgangerPersona, doppelgangerInstanceSqlite, doppelgangerContext, doppelgangerTools]',
      '  isolate:',
      '    doppelgangerRuntimeSession: session',
      '    doppelgangerActor: session',
      '    doppelgangerPersona: session',
      '    doppelgangerInstanceSqlite: session',
      '    doppelgangerContext: session',
      '    doppelgangerTools: session',
      '    doppelgangerEvolution: session',
      '',
    ].join('\n')),
  ])
}

async function writeEvolutionSignalPreset(root: string): Promise<void> {
  await writeEvolutionPreset(root)
  const protocols = JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)
  await writeFile(join(root, 'inference.mjs'), [
    `import { createStructuredInference } from ${protocols}`,
    'let calls = 0',
    'export default {',
    "  name: 'deterministic-signal-inference',",
    "  provide: 'doppelgangerInference',",
    "  inject: ['doppelgangerTools'],",
    '  apply(ctx) {',
    '    ctx.provide(\'doppelgangerInference\', createStructuredInference({',
    '      async infer(request) {',
    '        const material = JSON.parse(request.input).committedTurn',
    '        setImmediate(() => { calls += 1 })',
    '        const errorCode = material.toolOutcomes[0]?.errorCode ?? \'OMP_TOOL_FAILED\'',
    '        return { value: { hypotheses: [{',
    "          kind: 'capability', scope: 'global', patternKey: `tool.read.failed.${errorCode.toLowerCase()}`,",
    "          title: 'Improve repeated read failure handling',",
    "          rationale: 'Independent committed turns repeatedly encounter the same read failure.',",
    "          summary: 'The read tool repeatedly failed with the same structured error.',",
    "          tags: ['capability', 'tool-failure', 'read'], severity: 'medium', reuseValue: 'medium',",
    '          provenance: [material.deliveryId, material.turnId],',
    '        }] } }',
    '      },',
    '    }))',
    '    ctx.doppelgangerTools.register({',
    "      name: 'signal-test.inference-calls', description: 'Return deterministic signal inference calls',",
    "      inputSchema: { type: 'object', properties: {}, additionalProperties: false },",
    '      invoke: () => ({ calls }),',
    '    })',
    '  },',
    '}',
    '',
  ].join('\n'))
  const source = await readFile(join(root, 'runtime.cordis.yml'), 'utf8')
  const inferenceRow = [
    '- id: inference',
    '  name: ./inference.mjs',
    '  inject: [doppelgangerTools]',
    '  isolate:',
    '    doppelgangerTools: session',
    '    doppelgangerInference: session',
  ].join('\n')
  const withInference = source.replace('- id: evolution', `${inferenceRow}\n- id: evolution`)
    .replace(
      '  inject: [doppelgangerRuntimeSession, doppelgangerActor, doppelgangerPersona, doppelgangerInstanceSqlite, doppelgangerContext, doppelgangerTools]',
      '  inject: [doppelgangerRuntimeSession, doppelgangerActor, doppelgangerPersona, doppelgangerInstanceSqlite, doppelgangerContext, doppelgangerTools, doppelgangerInference]',
    )
    .replace(
      '    doppelgangerEvolution: session\n',
      '    doppelgangerEvolution: session\n    doppelgangerInference: session\n  config:\n    signalInferenceEnabled: true\n',
    )
  await writeFile(join(root, 'runtime.cordis.yml'), withInference)
}

async function invokeEvolution(
  peer: RpcRequester,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await invokeTool(peer, name, input)
  if (result === null || typeof result !== 'object' || !('ok' in result) || result.ok !== true
    || !('value' in result) || result.value === null || typeof result.value !== 'object') {
    throw new Error(`${name} failed: ${JSON.stringify(result)}`)
  }
  return result.value as Record<string, unknown>
}

function actorPresetDefinition(authoredActorId: string): string {
  return [
    '- id: tools',
    '  name: ./tools.mjs',
    '  isolate:',
    '    doppelgangerTools: session',
    '- id: actor-observer',
    '  name: ./actor.mjs',
    '  inject: [doppelgangerActor, doppelgangerTools]',
    '  isolate:',
    '    doppelgangerActor: session',
    '    doppelgangerTools: session',
    '  config:',
    `    authoredActorId: ${authoredActorId}`,
    '',
  ].join('\n')
}

async function writeActorPreset(root: string, authoredActorId = 'authored'): Promise<void> {
  const protocolPackage = JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)
  await Promise.all([
    writeFile(join(root, 'tools.mjs'), `export { ToolRegistry as default } from ${protocolPackage}\n`),
    writeFile(join(root, 'actor.mjs'), [
      'export default {',
      "  name: 'actor-observer',",
      "  inject: ['doppelgangerActor', 'doppelgangerTools'],",
      '  apply(ctx, config) {',
      '    ctx.doppelgangerTools.register({',
      "      name: 'actor.inspect', description: 'Inspect actor binding', available: true,",
      "      inputSchema: { type: 'object', properties: {}, additionalProperties: false },",
      '      invoke: () => ({ actor: ctx.doppelgangerActor, authoredActorId: config.authoredActorId }),',
      '    })',
      '  },',
      '}',
      '',
    ].join('\n')),
    writeFile(join(root, 'runtime.cordis.yml'), actorPresetDefinition(authoredActorId)),
  ])
}

async function writePersonaAuthoringPreset(root: string): Promise<void> {
  await mkdir(join(root, 'traits'), { recursive: true })
  await Promise.all([
    writeFile(join(root, 'identity.md'), 'You are Test Persona.\n'),
    writeFile(join(root, 'traits', 'evolving-profile.md'), 'Prefer careful iteration.\n'),
    writeFile(join(root, 'runtime.cordis.yml'), [
      '- id: context',
      '  name: "@doppelganger/doppelganger-protocols/context"',
      '  isolate:',
      '    doppelgangerContext: session',
      '- id: tools',
      '  name: "@doppelganger/doppelganger-protocols/tools"',
      '  isolate:',
      '    doppelgangerTools: session',
      '- id: persona',
      '  name: "@doppelganger/doppelganger-persona"',
      '  inject: [doppelgangerRuntimeSession, doppelgangerContext]',
      '  isolate:',
      '    doppelgangerRuntimeSession: session',
      '    doppelgangerContext: session',
      '    doppelgangerPersona: session',
      '  config:',
      '    instanceId: test-persona',
      '    identity: { path: identity.md, priority: 1000 }',
      '    traits:',
      '      - { name: evolving-profile, path: traits/evolving-profile.md, priority: 500 }',
      '- id: persona-authoring',
      '  name: "@doppelganger/doppelganger-persona-authoring"',
      '  inject: [doppelgangerPersona, doppelgangerTools]',
      '  isolate:',
      '    doppelgangerPersona: session',
      '    doppelgangerTools: session',
      '  config:',
      '    writableTargets: ["trait:evolving-profile"]',
      '    hmrTimeoutMs: 3000',
      '',
    ].join('\n')),
  ])
}

async function writePersonaEvolutionPreset(root: string): Promise<void> {
  await writePersonaAuthoringPreset(root)
  const source = await readFile(join(root, 'runtime.cordis.yml'), 'utf8')
  await writeFile(join(root, 'runtime.cordis.yml'), `${source}${[
    '- id: sqlite',
    '  name: "@doppelganger/doppelganger-sqlite"',
    '  isolate:',
    '    doppelgangerInstanceSqlite: session',
    '  config:',
    `    home: ${JSON.stringify(join(root, 'home'))}`,
    '- id: evolution',
    '  name: "@doppelganger/doppelganger-evolution"',
    '  inject: [doppelgangerRuntimeSession, doppelgangerActor, doppelgangerPersona, doppelgangerInstanceSqlite, doppelgangerContext, doppelgangerTools]',
    '  isolate:',
    '    doppelgangerRuntimeSession: session',
    '    doppelgangerActor: session',
    '    doppelgangerPersona: session',
    '    doppelgangerInstanceSqlite: session',
    '    doppelgangerContext: session',
    '    doppelgangerTools: session',
    '    doppelgangerEvolution: session',
    '',
  ].join('\n')}`)
}

function featurePatch(
  content: string,
  description: string,
  toolName = 'generic.echo',
  approval?: { readonly policy: string; readonly reason?: string },
): string {
  return [
    '- id: feature',
    '  config:',
    `    toolName: ${toolName}`,
    `    content: ${content}`,
    `    description: ${description}`,
    ...(approval === undefined ? [] : [
      '    approval:',
      `      policy: ${approval.policy}`,
      ...(approval.reason === undefined ? [] : [`      reason: ${approval.reason}`]),
    ]),
    '',
  ].join('\n')
}

describe('Node OMP runtime child', () => {
  it('activates an empty Runtime Preset without standard protocols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-empty-child-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'runtime.cordis.yml'), '[]\n')
    const harness = await childHarness()
    try {
      const activated = await timeout(harness.peer.request('session.activate', activation(root)), 'empty activation')
      expect(activated).toMatchObject({
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
        runtimeRevision: expect.any(String),
        catalog: { revision: 'catalog:0', tools: [] },
      })
      await expect(resolveContext(harness.peer, 'Current task')).resolves.toEqual({
        instructions: '', data: '', contributions: [], omittedSources: [], tokenCount: 0,
      })
      await expect(invokeTool(harness.peer, 'generic.missing', {})).resolves.toEqual({
        ok: false,
        error: {
          code: 'TOOL_PROTOCOL_UNAVAILABLE',
          message: 'the active Runtime Preset does not provide the tools protocol',
        },
      })
      await expect(harness.peer.request('event.publish', {
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'session-started',
        deliveryId: 'invalid-extra-field',
        sessionId: 'omp-session',
        timestamp: 1,
        outcome: 'completed',
      })).rejects.toThrow('unsupported fields: outcome')
      await expect(harness.peer.request('event.publish', {
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'session-started',
        deliveryId: 'invalid-session',
        sessionId: 'other-session',
        timestamp: 1,
      })).rejects.toThrow('must equal Runtime Session "omp-session"')
    } catch (cause) {
      throw childError(harness, cause)
    } finally {
      await dispose(harness)
    }
  })

  it('shares committed PostgreSQL memory across direct FramedJsonRpc child sessions', async () => {
    const dsn = requiredPostgresqlDsn()
    const sharedRoot = await mkdtemp(join(tmpdir(), 'doppelganger-postgresql-memory-child-'))
    const missingRoot = await mkdtemp(join(tmpdir(), 'doppelganger-postgresql-memory-unbound-'))
    temporaryRoots.push(sharedRoot, missingRoot)
    const sharedSchema = postgresqlSchema('shared')
    const missingActorSchema = postgresqlSchema('missing_actor')
    const admin = new Pool({
      connectionString: dsn,
      max: 1,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
      lock_timeout: 5000,
    })
    const harnesses: ChildHarness[] = []
    try {
      await Promise.all([
        writePostgresqlMemoryPreset(sharedRoot, sharedSchema),
        writePostgresqlMemoryPreset(missingRoot, missingActorSchema),
      ])

      expect((await admin.query<{ oid: string | null }>('SELECT to_regnamespace($1) AS oid', [missingActorSchema])).rows[0]?.oid ?? null).toBeNull()
      expect((await admin.query<{ oid: string | null }>('SELECT to_regnamespace($1) AS oid', [sharedSchema])).rows[0]?.oid ?? null).toBeNull()
      const unbound = await childHarness()
      harnesses.push(unbound)
      await expect(unbound.peer.request('session.activate', activation(missingRoot, [], undefined, 'postgresql-unbound')))
        .rejects.toThrow('bound host actor')
      expect((await admin.query<{ oid: string | null }>('SELECT to_regnamespace($1) AS oid', [missingActorSchema])).rows[0]?.oid ?? null).toBeNull()
      await dispose(unbound)

      const first = await childHarness()
      const second = await childHarness()
      harnesses.push(first, second)
      const activations = await Promise.all([
        first.peer.request('session.activate', activation(sharedRoot, [], 'postgresql-actor', 'postgresql-first')),
        second.peer.request('session.activate', activation(sharedRoot, [], 'postgresql-actor', 'postgresql-second')),
      ])
      expect((await admin.query<{ oid: string | null }>('SELECT to_regnamespace($1) AS oid', [sharedSchema])).rows[0]?.oid ?? null).not.toBeNull()
      for (const activated of activations) {
        expect(activationToolNames(activated)).toEqual(expect.arrayContaining([
          'memory.remember',
          'memory.search',
          'memory.inspect',
          'memory.candidates.list',
          'memory.forget',
        ]))
      }

      const remembered = memoryRecordCoordinates(await memoryToolValue(first.peer, 'memory.remember', {
        operationId: 'postgresql-vertical-remember',
        subjectKey: 'project.storage.canonical',
        kind: 'fact',
        content: 'Shared PostgreSQL canonical storage is visible after commit.',
      }))
      expect(memorySearchContents(await memoryToolValue(second.peer, 'memory.search', {
        query: 'shared PostgreSQL canonical storage',
      }))).toContain('Shared PostgreSQL canonical storage is visible after commit.')

      const contextData = resolvedContextData(await resolveContext(second.peer, 'Which canonical storage is visible after commit?'))
      expect(contextData).toContain('Shared PostgreSQL canonical storage is visible after commit.')

      await second.peer.request('event.publish', {
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-committed',
        deliveryId: 'postgresql-capture-delivery',
        sessionId: 'postgresql-second',
        turnId: 'postgresql-capture-turn',
        timestamp: 1,
        principalInput: serializeLifecycleValue('[fact:project.storage.capture] PostgreSQL capture is shared after commit.'),
        assistantOutput: serializeLifecycleValue('Captured through the real OMP child transport.'),
        outcome: 'completed',
      })
      const candidates = await waitForMemoryValue(
        first.peer,
        'memory.candidates.list',
        {},
        value => Array.isArray(value) && value.some(item => item !== null && typeof item === 'object'
          && 'subjectKey' in item && item.subjectKey === 'project.storage.capture'),
      )
      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectKey: 'project.storage.capture', status: 'candidate' }),
      ]))

      await dispose(first)
      const restarted = await childHarness()
      harnesses.push(restarted)
      await restarted.peer.request('session.activate', activation(sharedRoot, [], 'postgresql-actor', 'postgresql-first'))
      expect(memorySearchContents(await memoryToolValue(restarted.peer, 'memory.search', {
        query: 'shared PostgreSQL canonical storage',
      }))).toContain('Shared PostgreSQL canonical storage is visible after commit.')
      expect(await memoryToolValue(restarted.peer, 'memory.candidates.list', {})).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectKey: 'project.storage.capture', status: 'candidate' }),
      ]))
      expect(await memoryToolValue(restarted.peer, 'memory.inspect', { id: remembered.id })).toEqual(
        expect.objectContaining({ id: remembered.id, revision: expect.objectContaining({ id: remembered.revisionId }) }),
      )
      expect(await memoryToolValue(restarted.peer, 'memory.forget', {
        operationId: 'postgresql-vertical-forget',
        id: remembered.id,
      })).toEqual({ deleted: true })
      expect(memorySearchContents(await memoryToolValue(second.peer, 'memory.search', {
        query: 'shared PostgreSQL canonical storage',
      }))).toEqual([])

      await Promise.all([dispose(second), dispose(restarted)])
    } catch (cause) {
      const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
      const stderr = harnesses.map(harness => Buffer.concat(harness.stderr).toString('utf8')).filter(Boolean).join('\n')
      throw new Error(`${message}${stderr.length === 0 ? '' : `\n${stderr}`}`)
    } finally {
      await Promise.all(harnesses.map(harness => dispose(harness).catch(() => undefined)))
      try {
        await Promise.all([
          admin.query(`DROP SCHEMA IF EXISTS ${quotePostgresqlIdentifier(sharedSchema)} CASCADE`),
          admin.query(`DROP SCHEMA IF EXISTS ${quotePostgresqlIdentifier(missingActorSchema)} CASCADE`),
        ])
      } finally {
        await admin.end()
      }
    }
  }, 30_000)

  it('routes validated OMP todo reminders through the child runtime plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-events-child-'))
    temporaryRoots.push(root)
    await writeOmpEventPreset(root)
    const harness = await childHarness()
    try {
      await harness.peer.request('session.activate', activation(root))
      await expect(harness.peer.request('omp.todo-reminder', {
        protocolVersion: 1,
        type: 'todo-reminder',
        deliveryId: 'omp-session:todo-reminder:1',
        sessionId: 'omp-session',
        timestamp: 1,
        todos: [
          { content: 'Finish host event transport', status: 'in_progress' },
          { content: 'Wait for review', status: 'blocked', blocker: 'review pending' },
        ],
        attempt: 1,
        maxAttempts: 3,
      })).resolves.toBeNull()
      await expect(invokeTool(harness.peer, 'omp.todo.last', {})).resolves.toMatchObject({
        ok: true,
        value: {
          type: 'todo-reminder',
          deliveryId: 'omp-session:todo-reminder:1',
          todos: [
            { content: 'Finish host event transport', status: 'in_progress' },
            { content: 'Wait for review', status: 'blocked', blocker: 'review pending' },
          ],
        },
      })
      await expect(harness.peer.request('omp.todo-reminder', {
        protocolVersion: 1,
        type: 'todo-reminder',
        deliveryId: 'invalid',
        sessionId: 'omp-session',
        timestamp: 1,
        todos: [{ content: 'Invalid status', status: 'unknown' }],
        attempt: 1,
        maxAttempts: 3,
      })).rejects.toThrow('status is unsupported')
    } catch (cause) {
      throw childError(harness, cause)
    } finally {
      await dispose(harness)
    }
  })

  it('activates the shipped standard Runtime Preset from an empty home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-standard-child-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const selected = await resolveOmpActivation({ home }, { cwd: workspace, sessionId: 'standard-session' })
    expect(selected).toMatchObject({ composition: { id: 'standard' }, sessionId: 'standard-session' })
    const adapter = new OmpAdapterSession({
      activation: selected!,
      childFactory: new NodeOmpChildFactory({
        childPath: fileURLToPath(new URL('../src/child.ts', import.meta.url)),
        shutdownTimeoutMs: 1000,
      }),
    })
    try {
      await expect(adapter.start()).resolves.toMatchObject({ state: 'active', catalog: { tools: [] } })
      const connection = adapter.connection()
      if (connection === undefined) throw new Error('standard adapter connection is inactive')
      const context = await resolveContext(connection, 'Current task', 2000) as { instructions: string; data: string }
      expect(context.instructions).toContain("You are the user's durable personal and technical assistant.")
      expect(context.data).toBe('')
    } finally {
      await adapter.dispose()
    }
  })

  it('activates a copied user preset and rejects a broken deployment default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-copied-standard-child-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const roster = new RuntimePresetRoster({ home })
    const copiedDirectory = await roster.copy({ from: 'standard', id: 'custom-standard', name: 'Custom Standard' })
    const copied = await resolveOmpActivation({ home, explicitRuntimePreset: 'custom-standard' }, {
      cwd: workspace,
      sessionId: 'copied-standard-session',
    })
    expect(copied).toMatchObject({
      composition: {
        id: 'custom-standard',
        loaderPath: join(copiedDirectory, 'runtime.cordis.yml'),
      },
    })
    const adapter = new OmpAdapterSession({
      activation: copied!,
      childFactory: new NodeOmpChildFactory({
        childPath: fileURLToPath(new URL('../src/child.ts', import.meta.url)),
        shutdownTimeoutMs: 1000,
      }),
    })
    try {
      await expect(adapter.start()).resolves.toMatchObject({ state: 'active' })
    } finally {
      await adapter.dispose()
    }

    const brokenRoot = join(root, 'broken-system')
    await mkdir(join(brokenRoot, 'standard'), { recursive: true })
    await writeFile(join(brokenRoot, 'standard', 'runtime.cordis.yml'), '- id: missing\n  name: ./missing.mjs\n')
    await expect(resolveOmpActivation({
      home: join(root, 'empty-home'),
      runtimePresets: {
        includeShippedRoot: false,
        includeUserRoot: false,
        roots: [{ path: brokenRoot, trust: 'system' }],
      },
    }, { cwd: workspace, sessionId: 'broken-standard-session' })).rejects.toMatchObject({
      code: 'RUNTIME_PRESET_SELECTION_FAILED',
      runtimePresetId: 'standard',
    })
  })

  it('resolves explicit, project, and user selection and rejects unhealthy winners', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-selection-child-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const empty = join(home, '.runtime-presets', 'empty')
    const generic = join(home, '.runtime-presets', 'generic')
    const broken = join(home, '.runtime-presets', 'broken')
    await Promise.all([
      mkdir(join(workspace, '.git'), { recursive: true }),
      mkdir(join(workspace, '.doppelganger'), { recursive: true }),
      mkdir(empty, { recursive: true }),
      mkdir(generic, { recursive: true }),
      mkdir(broken, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(empty, 'runtime.cordis.yml'), '[]\n'),
      writeProtocolPreset(generic),
      writeFile(join(broken, 'runtime.cordis.yml'), '- id: missing\n  name: ./missing.mjs\n'),
      writeFile(join(home, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: empty\n'),
      writeFile(join(workspace, '.doppelganger', 'manifest.yaml'), 'version: 1\nruntimePreset: generic\n'),
    ])

    const explicit = await resolveOmpActivation({ home, explicitRuntimePreset: 'empty' }, {
      cwd: workspace,
      sessionId: 'explicit-session',
    })
    expect(explicit).toMatchObject({
      composition: { id: 'empty', loaderPath: join(empty, 'runtime.cordis.yml') },
      sessionId: 'explicit-session',
      workspaceRoot: workspace,
    })
    const project = await resolveOmpActivation({ home }, { cwd: workspace, sessionId: 'project-session' })
    expect(project?.composition.id).toBe('generic')
    const adapter = new OmpAdapterSession({
      activation: project!,
      childFactory: new NodeOmpChildFactory({
        childPath: fileURLToPath(new URL('../src/child.ts', import.meta.url)),
        shutdownTimeoutMs: 1000,
      }),
    })
    expect(await adapter.start()).toMatchObject({
      state: 'active',
      catalog: { tools: [{
        name: 'generic.echo',
        approval: { policy: 'required', reason: 'Review this exact generic invocation.' },
      }] },
    })
    await adapter.dispose()

    await writeFile(join(workspace, '.doppelganger', 'manifest.yaml'), 'version: 1\n')
    expect((await resolveOmpActivation({ home }, { cwd: workspace, sessionId: 'user-session' }))?.composition.id).toBe('empty')
    await writeFile(join(home, 'config.yaml'), 'version: 1\n')
    await expect(resolveOmpActivation({
      home,
      runtimePresets: { includeShippedRoot: false, defaultRuntimePreset: null },
    }, { cwd: workspace, sessionId: 'inactive-session' })).resolves.toBeUndefined()

    await writeFile(join(home, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: broken\n')
    await expect(resolveOmpActivation({ home }, { cwd: workspace, sessionId: 'failed-session' }))
      .rejects.toMatchObject({ code: 'RUNTIME_PRESET_SELECTION_FAILED', runtimePresetId: 'broken' })

    await writeFile(join(home, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: missing\n')
    await expect(resolveOmpActivation({ home }, { cwd: workspace, sessionId: 'missing-session' }))
      .rejects.toMatchObject({ code: 'RUNTIME_PRESET_SELECTION_FAILED' })
  }, 15_000)

  it('rebuilds ordered user/project layers and rejects stale tools after committed reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-generic-child-'))
    temporaryRoots.push(root)
    await mkdir(join(root, 'project', '.doppelganger'), { recursive: true })
    await writeProtocolPreset(root)
    const userPatch = join(root, 'runtime.cordis.patch.yml')
    const projectPatch = join(root, 'project', '.doppelganger', 'runtime.cordis.patch.yml')
    await Promise.all([
      writeFile(userPatch, featurePatch('User runtime context.', 'User echo')),
      writeFile(projectPatch, featurePatch('Project runtime context.', 'Project echo')),
    ])
    const harness = await childHarness()
    try {
      const params = activation(root, [
        { source: 'user patch', filename: userPatch, optional: true },
        { source: 'project patch', filename: projectPatch, optional: true },
      ])
      const activated = await timeout(harness.peer.request('session.activate', params), 'generic activation') as {
        runtimeRevision: string
        catalog: { tools: Array<{ name: string; description: string }> }
      }
      expect(activated.catalog.tools).toMatchObject([{ name: 'generic.echo', description: 'Project echo' }])
      await expect(resolveContext(harness.peer, 'Current task')).resolves.toMatchObject({
        instructions: 'Project runtime context.',
      })

      const afterProjectRemoval = await changedCatalog(harness.peer, async () => { await unlink(projectPatch) })
      expect(afterProjectRemoval.tools).toMatchObject([{ name: 'generic.echo', description: 'User echo' }])
      await expect(resolveContext(harness.peer, 'User layer')).resolves.toMatchObject({
        instructions: 'User runtime context.', data: '',
      })

      const baseCatalog = await changedCatalog(harness.peer, async () => { await unlink(userPatch) })
      expect(baseCatalog.tools).toMatchObject([{
        name: 'generic.echo',
        description: 'Echo one',
        approval: { policy: 'required', reason: 'Review this exact generic invocation.' },
      }])
      await expect(resolveContext(harness.peer, 'Base layer')).resolves.toMatchObject({
        instructions: 'Generic runtime context one.',
      })

      const reloaded = await changedCatalog(harness.peer, async () => {
        await writeFile(projectPatch, featurePatch('Reloaded project context.', 'Reloaded echo', 'generic.reloaded'))
      })
      expect(reloaded.tools).toMatchObject([{ name: 'generic.reloaded', description: 'Reloaded echo' }])
      expect(reloaded.tools[0]).not.toHaveProperty('approval')
      await expect(invokeTool(harness.peer, 'generic.reloaded', { value: 'hello' })).resolves.toEqual({
        ok: true, value: { echoed: 'hello', generation: 'Reloaded project context.' },
      })
      await expect(invokeTool(harness.peer, 'generic.echo', { value: 'stale' }))
        .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })

      const withApproval = await changedCatalog(harness.peer, async () => {
        await writeFile(projectPatch, featurePatch(
          'Approval project context.',
          'Approval echo',
          'generic.reloaded',
          { policy: 'required', reason: 'Review the reloaded invocation.' },
        ))
      })
      expect(withApproval.tools).toMatchObject([{
        name: 'generic.reloaded',
        approval: { policy: 'required', reason: 'Review the reloaded invocation.' },
      }])

      await new Promise(resolve => setTimeout(resolve, 100))
      const withoutApproval = await changedCatalog(harness.peer, async () => {
        await writeFile(projectPatch, featurePatch('Reloaded project context.', 'Reloaded echo', 'generic.reloaded'))
      })
      expect(withoutApproval.tools[0]).not.toHaveProperty('approval')
      await new Promise(resolve => setTimeout(resolve, 100))

      await writeFile(projectPatch, featurePatch(
        'Invalid approval context.',
        'Invalid approval echo',
        'generic.reloaded',
        { policy: 'sometimes', reason: 'Invalid policy.' },
      ))
      const malformed = await waitForReloadState(harness.peer, 'failed')
      expect(malformed.diagnostics.reload?.error).toContain('approval policy')
      expect((await toolCatalog(harness.peer)).tools).toMatchObject([{
        name: 'generic.reloaded', description: 'Reloaded echo', available: true,
      }])
      await new Promise(resolve => setTimeout(resolve, 100))

      await writeFile(projectPatch, '- id: absent\n  config: {}\n')
      const deadline = Date.now() + 5000
      let failed: ChildRuntimeDiagnostics | undefined
      while (Date.now() < deadline) {
        const current = await runtimeDiagnostics(harness.peer)
        if (current.diagnostics.reload?.error?.includes('project patch')) {
          failed = current
          break
        }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(failed?.diagnostics.reload).toMatchObject({ state: 'failed', error: expect.stringContaining('project patch') })
      expect((await toolCatalog(harness.peer)).tools).toMatchObject([{
        name: 'generic.reloaded', description: 'Reloaded echo', available: true,
      }])
      await expect(invokeTool(harness.peer, 'generic.reloaded', { value: 'retained' })).resolves.toEqual({
        ok: true, value: { echoed: 'retained', generation: 'Reloaded project context.' },
      })
      await expect(resolveContext(harness.peer, 'Still active')).resolves.toMatchObject({
        instructions: 'Reloaded project context.',
      })
    } catch (cause) {
      throw childError(harness, cause)
    } finally {
      await dispose(harness)
    }
  }, 15_000)

  it('projects Evolution generically, persists global and project lifecycles, removes stale tools, and disposes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-child-'))
    temporaryRoots.push(root)
    await writeEvolutionPreset(root)
    const harness = await childHarness()
    try {
      const activated = await timeout(harness.peer.request('session.activate', activation(root, [], 'actor-one')), 'Evolution activation') as {
        catalog: { tools: Array<{ name: string }> }
      }
      expect(activated.catalog.tools.map(tool => tool.name)).toEqual([
        'evolution.inspect', 'evolution.list', 'evolution.propose', 'evolution.reject',
        'evolution.reminder.record', 'evolution.snooze', 'evolution.transition',
      ])
      await expect(resolveContext(harness.peer, 'Improve reusable capability planning.')).resolves.toMatchObject({
        instructions: expect.stringContaining('[Doppelganger Evolution Policy]'),
      })

      const persona = await invokeEvolution(harness.peer, 'evolution.propose', {
        operationId: 'global-persona-propose', kind: 'persona', scope: 'global',
        dedupeKey: 'persona.verified-progress', title: 'Verified progress reporting',
        rationale: 'Repeated collaboration evidence supports a stable Persona review.',
      })
      const reviewing = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'global-persona-review', id: persona.id, expectedRevision: persona.revision,
        target: 'reviewing', reviewSummary: 'The user explicitly selected review.',
      })
      const completed = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'global-persona-done', id: persona.id, expectedRevision: reviewing.revision,
        target: 'done', outcome: 'Persona activation was separately confirmed.',
      })
      expect(completed).toMatchObject({ kind: 'persona', scope: 'global', status: 'done' })

      const capability = await invokeEvolution(harness.peer, 'evolution.propose', {
        operationId: 'project-capability-propose', kind: 'capability', scope: 'project',
        dedupeKey: 'project.release-checks', title: 'Project release checks',
        rationale: 'This repository repeatedly needs a reviewable release check workflow.',
      })
      const researching = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'project-capability-research', id: capability.id, expectedRevision: capability.revision,
        target: 'researching', researchQuestion: 'Which maintained approach fits this repository?',
      })
      const optionsReady = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'project-capability-options', id: capability.id, expectedRevision: researching.revision,
        target: 'options-ready', optionsSummary: 'Compared existing, portable, and host-only mechanisms.',
        sourceIds: ['source:primary-one'],
      })
      const selected = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'project-capability-selected', id: capability.id, expectedRevision: optionsReady.revision,
        target: 'selected', selectedOption: 'Permanent Doppelganger Loader plugin.',
      })
      const planned = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'project-capability-planned', id: capability.id, expectedRevision: selected.revision,
        target: 'planned', planReference: 'openspec:release-checks',
      })
      const implementing = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'project-capability-implementing', id: capability.id, expectedRevision: planned.revision,
        target: 'implementing', implementationReference: 'change:release-checks',
      })
      const done = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'project-capability-done', id: capability.id, expectedRevision: implementing.revision,
        target: 'done', outcome: 'The selected capability passed its verification scenario.',
      })
      expect(done).toMatchObject({ kind: 'capability', scope: 'project', status: 'done' })
      const projectDirectory = join(root, '.doppelganger', 'evolution', 'opportunities')
      const proposalFiles = (await readdir(projectDirectory)).filter(name => name.endsWith('.yaml'))
      expect(proposalFiles).toHaveLength(1)
      expect(await readFile(join(projectDirectory, proposalFiles[0]!), 'utf8')).toContain('status: done')

      const source = await readFile(join(root, 'runtime.cordis.yml'), 'utf8')
      const removed = await changedCatalog(harness.peer, async () => {
        await writeFile(join(root, 'runtime.cordis.yml'), source.slice(0, source.indexOf('- id: evolution')))
      })
      expect(removed.tools).toEqual([])
      await expect(invokeTool(harness.peer, 'evolution.list', {}))
        .resolves.toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    } catch (cause) {
      throw childError(harness, cause)
    } finally {
      await dispose(harness)
    }
    expect(harness.child.exitCode).toBe(0)
  }, 15_000)

  it('promotes lifecycle evidence through generic OMP events while preserving every consent gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-signals-child-'))
    temporaryRoots.push(root)
    await writeEvolutionSignalPreset(root)
    const harnesses = await Promise.all([childHarness(), childHarness(), childHarness()])
    const sessionIds = ['omp-signal-session-one', 'omp-signal-session-two', 'omp-signal-session-three']
    try {
      // Initialize the shared schema before exercising concurrent signal delivery.
      for (const [index, harness] of harnesses.entries()) {
        await harness.peer.request('session.activate', activation(root, [], 'actor-one', sessionIds[index]!))
      }
      await Promise.all(harnesses.map(async (harness, index) => {
        const sessionId = sessionIds[index]!
        const turnId = `${sessionId}:turn-one`
        const toolEvent = {
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'tool-completed' as const,
          deliveryId: `${sessionId}:tool-delivery`,
          sessionId,
          turnId,
          callId: `${sessionId}:call-one`,
          name: 'read',
          outcome: 'failed' as const,
          error: { code: 'ENOENT', message: 'Missing file.' },
          timestamp: Date.parse(`2026-09-04T00:0${index}:00.000Z`),
        }
        const turnEvent = {
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'turn-committed' as const,
          deliveryId: `${sessionId}:turn-delivery`,
          sessionId,
          turnId,
          principalInput: serializeLifecycleValue('Read the missing file.'),
          assistantOutput: serializeLifecycleValue('The read operation failed.'),
          outcome: 'completed' as const,
          timestamp: Date.parse(`2026-09-04T00:0${index}:30.000Z`),
        }
        await expect(harness.peer.request('event.publish', toolEvent)).resolves.toBeNull()
        await expect(harness.peer.request('event.publish', turnEvent)).resolves.toBeNull()
      }))

      let listed: Record<string, unknown> | undefined
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        listed = await invokeEvolution(harnesses[0]!.peer, 'evolution.list', {})
        if (Array.isArray(listed.proposals) && listed.proposals.length === 1) break
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(listed?.proposals).toEqual([expect.objectContaining({
        kind: 'capability',
        scope: 'global',
        status: 'proposed',
        revision: 1,
        evidence: expect.arrayContaining(sessionIds.map(sessionId => expect.objectContaining({
          sourceId: `lifecycle:${sessionId}:turn-delivery`,
        }))),
      })])
      const proposal = (listed!.proposals as Array<Record<string, unknown>>)[0]!
      const inspected = await invokeEvolution(harnesses[0]!.peer, 'evolution.inspect', { id: proposal.id })
      expect(inspected).toMatchObject({
        proposal: {
          id: proposal.id,
          status: 'proposed',
          revision: 1,
          history: [{ toStatus: 'proposed' }],
        },
      })
      expect(inspected.proposal).not.toHaveProperty('reviewSummary')
      expect(inspected.proposal).not.toHaveProperty('researchQuestion')
      expect(inspected.proposal).not.toHaveProperty('planReference')
      expect(inspected.proposal).not.toHaveProperty('implementationReference')
      await Promise.all(harnesses.map(harness => expect(
        invokeTool(harness.peer, 'signal-test.inference-calls', {}),
      ).resolves.toEqual({ ok: true, value: { calls: 1 } })))
    } catch (cause) {
      for (const harness of harnesses) harness.child.kill()
      const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
      throw new Error(`${message}\n${harnesses.map(harness => Buffer.concat(harness.stderr).toString('utf8')).join('\n')}`)
    } finally {
      await Promise.all(harnesses.map(dispose))
    }
    expect(harnesses.map(harness => harness.child.exitCode)).toEqual([0, 0, 0])
  }, 20_000)

  it('records distinct Evolution turns across fresh bindings for one resumed OMP session without duplicating replayed evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-resumed-omp-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const preset = join(home, '.runtime-presets', 'evolution-resumed-session')
    await Promise.all([
      mkdir(preset, { recursive: true }),
      mkdir(join(workspace, '.git'), { recursive: true }),
    ])
    await writeEvolutionSignalPreset(preset)
    await writeFile(join(home, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: evolution-resumed-session\n')
    const databasePath = join(preset, 'home', 'storage', 'evolution.sqlite')
    const factory = new RecordingNodeChildFactory()
    const sessionId = 'omp-resumed-signal-session'
    const completed: CommittedLifecycleEvent[] = []
    let extension: MountedOmpExtension | undefined
    const mounted: MountedOmpExtension[] = []

    const startBinding = async () => {
      extension = mountedOmpExtension(workspace, sessionId, createDoppelgangerOmpExtension({
        home,
        actorId: 'actor-one',
        childFactory: factory,
        watch: false,
      }))
      mounted.push(extension)
      await extension.handlers.get('session_start')!({ type: 'session_start' }, extension.context)
      return factory.connections.at(-1)!
    }
    const stopBinding = async (connection: RecordedChildConnection) => {
      await extension!.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, extension!.context)
      await timeout(connection.disposed, 'resumed OMP child disposal')
      expect(connection.processId).toEqual(expect.any(Number))
    }
    const collectCommitted = (connection: RecordedChildConnection): CommittedLifecycleEvent => {
      const committed = published(connection, 'turn-committed').at(-1)
      if (committed === undefined
        || typeof committed.deliveryId !== 'string'
        || typeof committed.sessionId !== 'string'
        || typeof committed.turnId !== 'string') {
        throw new Error('OMP extension did not publish a valid committed turn')
      }
      const event = committed as CommittedLifecycleEvent
      completed.push(event)
      return event
    }

    try {
      const first = await startBinding()
      await completeOmpTurn(extension!, 1, 'completed')
      const firstCommitted = collectCommitted(first)
      const afterFirst = await waitForEvolutionState(databasePath, state => (
        state.receipts.length === 1 && state.signals.length === 1
      ))
      expect(afterFirst.receipts).toEqual([expect.objectContaining({
        delivery_id: firstCommitted.deliveryId,
        session_id: sessionId,
        turn_id: firstCommitted.turnId,
      })])
      expect(afterFirst.signals).toEqual([expect.objectContaining({
        delivery_id: firstCommitted.deliveryId,
        turn_id: firstCommitted.turnId,
        source: 'deterministic',
      })])
      expect(afterFirst.aggregates).toEqual([expect.objectContaining({
        occurrence_count: 1,
        deterministic_occurrence_count: 1,
        distinct_turns: 1,
        distinct_sessions: 1,
        promotion_status: 'pending',
        proposal_id: null,
      })])
      expect(afterFirst.proposals).toEqual([])

      await expect(first.request('event.publish', structuredClone(firstCommitted))).resolves.toBeNull()
      await waitForInferenceCalls(first, 2)
      expect(evolutionDatabaseState(databasePath)).toEqual(afterFirst)
      await completeOmpTurn(extension!, 2, 'failed')
      await completeOmpTurn(extension!, 3, 'cancelled')
      await completeOmpTurn(extension!, 4, 'completed', false)
      await stopBinding(first)
      expect(evolutionDatabaseState(databasePath)).toEqual(afterFirst)

      const second = await startBinding()
      await expect(second.request('event.publish', structuredClone(firstCommitted))).resolves.toBeNull()
      await waitForInferenceCalls(second, 1)
      expect(evolutionDatabaseState(databasePath)).toEqual(afterFirst)
      await completeOmpTurn(extension!, 1, 'completed')
      const secondCommitted = collectCommitted(second)
      const afterSecond = await waitForEvolutionState(databasePath, state => (
        state.receipts.length === 2 && state.signals.length === 2
      ))
      expect(afterSecond.receipts.map(row => row.delivery_id).sort())
        .toEqual([firstCommitted.deliveryId, secondCommitted.deliveryId].sort())
      expect(afterSecond.signals.map(row => row.delivery_id).sort())
        .toEqual([firstCommitted.deliveryId, secondCommitted.deliveryId].sort())
      expect(afterSecond.aggregates).toEqual([expect.objectContaining({
        occurrence_count: 2,
        deterministic_occurrence_count: 2,
        distinct_turns: 2,
        distinct_sessions: 1,
        promotion_status: 'pending',
        proposal_id: null,
      })])
      expect(afterSecond.proposals).toEqual([])
      expect(afterSecond.evidence).toEqual([])
      expect(afterSecond.transitions).toEqual([])
      await stopBinding(second)

      const third = await startBinding()
      await completeOmpTurn(extension!, 1, 'completed')
      collectCommitted(third)
      const finalState = await waitForEvolutionState(databasePath, state => (
        state.receipts.length === 3
        && state.signals.length === 3
        && state.proposals.length === 1
        && state.evidence.length === 3
        && state.transitions.length === 1
        && state.aggregates.some(row => row.promotion_status === 'promoted')
      ))

      const deliveryIds = completed.map(event => event.deliveryId)
      const turnIds = completed.map(event => event.turnId)
      expect(completed).toHaveLength(3)
      expect(new Set(deliveryIds).size).toBe(3)
      expect(new Set(turnIds).size).toBe(3)
      expect(completed.map(event => event.sessionId)).toEqual([sessionId, sessionId, sessionId])
      expect(finalState.receipts.map(row => row.delivery_id).sort()).toEqual([...deliveryIds].sort())
      expect(finalState.receipts.map(row => row.turn_id).sort()).toEqual([...turnIds].sort())
      expect(finalState.signals.map(row => row.delivery_id).sort()).toEqual([...deliveryIds].sort())
      expect(finalState.aggregates).toEqual([expect.objectContaining({
        occurrence_count: 3,
        deterministic_occurrence_count: 3,
        distinct_turns: 3,
        distinct_sessions: 1,
        promotion_status: 'promoted',
        proposal_id: expect.any(String),
      })])
      expect(finalState.proposals).toEqual([expect.objectContaining({
        kind: 'capability', scope: 'global', status: 'proposed', current_revision: 1,
      })])
      expect(finalState.evidence.map(row => row.source_id).sort())
        .toEqual(deliveryIds.map(deliveryId => `lifecycle:${deliveryId}`).sort())
      expect(finalState.transitions).toEqual([expect.objectContaining({
        from_status: null, to_status: 'proposed',
      })])
      expect(finalState.diagnostics).toEqual([])

      const listed = await invokeEvolution(third, 'evolution.list', {})
      expect(listed.proposals).toEqual([expect.objectContaining({
        kind: 'capability', scope: 'global', status: 'proposed', revision: 1,
      })])
      const proposals = listed.proposals
      if (!Array.isArray(proposals) || proposals.length !== 1
        || proposals[0] === null
        || typeof proposals[0] !== 'object'
        || !('id' in proposals[0])
        || typeof proposals[0].id !== 'string') {
        throw new Error('Evolution did not list exactly one proposal')
      }
      const inspected = await invokeEvolution(third, 'evolution.inspect', { id: proposals[0].id })
      expect(inspected).toMatchObject({
        proposal: { id: proposals[0].id, status: 'proposed', history: [{ toStatus: 'proposed' }] },
      })
      expect(inspected.proposal).not.toHaveProperty('researchQuestion')
      expect(inspected.proposal).not.toHaveProperty('planReference')
      expect(inspected.proposal).not.toHaveProperty('implementationReference')
      expect(inspected.proposal).not.toHaveProperty('reviewSummary')
      expect(mounted.flatMap(candidate => candidate.errors)).toEqual([])
      await stopBinding(third)
    } finally {
      await Promise.all(factory.connections.map(connection => connection.dispose()))
    }
  }, 30_000)

  it('keeps a Persona proposal inert until review and completes it only after separately confirmed activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-evolution-vertical-'))
    temporaryRoots.push(root)
    await writePersonaEvolutionPreset(root)
    const traitPath = join(root, 'traits', 'evolving-profile.md')
    const original = await readFile(traitPath, 'utf8')
    const harness = await childHarness()
    try {
      await harness.peer.request('session.activate', activation(root, [], 'actor-one'))
      const proposed = await invokeEvolution(harness.peer, 'evolution.propose', {
        operationId: 'persona-vertical-propose', kind: 'persona', scope: 'global',
        dedupeKey: 'persona.reversible-verification', title: 'Prefer reversible verified changes',
        rationale: 'Durable collaboration evidence supports a review of this stable assistant quality.',
      })
      expect(await readFile(traitPath, 'utf8')).toBe(original)
      const reviewing = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'persona-vertical-review', id: proposed.id, expectedRevision: proposed.revision,
        target: 'reviewing', reviewSummary: 'The user explicitly chose to review this proposal.',
      })
      expect(await readFile(traitPath, 'utf8')).toBe(original)
      const inspected = await invokeTool(harness.peer, 'persona.inspect', { target: 'trait:evolving-profile' })
      if (inspected === null || typeof inspected !== 'object' || !('ok' in inspected) || inspected.ok !== true
        || !('value' in inspected) || inspected.value === null || typeof inspected.value !== 'object'
        || !('revision' in inspected.value) || typeof inspected.value.revision !== 'string') {
        throw new Error('persona.inspect returned an invalid result')
      }
      const replacement = 'Prefer reversible changes with observed verification.\n'
      await expect(invokeTool(harness.peer, 'persona.revise', {
        target: 'trait:evolving-profile',
        expectedRevision: inspected.value.revision,
        replacement,
        rationale: 'Apply the explicitly reviewed stable Persona quality.',
        evidenceIds: ['evolution:persona-vertical'],
      })).resolves.toMatchObject({ ok: true, value: { status: 'applied' } })
      expect(await readFile(traitPath, 'utf8')).toBe(replacement)
      const completed = await invokeEvolution(harness.peer, 'evolution.transition', {
        operationId: 'persona-vertical-done', id: proposed.id, expectedRevision: reviewing.revision,
        target: 'done', outcome: 'Persona Authoring confirmed exact-revision HMR activation.',
      })
      expect(completed).toMatchObject({ status: 'done', kind: 'persona', scope: 'global' })
    } catch (cause) {
      throw childError(harness, cause)
    } finally {
      await dispose(harness)
    }
  }, 15_000)

  it('commits Persona revisions only after the Composition Runtime activates the replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-authoring-'))
    temporaryRoots.push(root)
    await writePersonaAuthoringPreset(root)
    const harness = await childHarness()
    try {
      await harness.peer.request('session.activate', activation(root))
      await expect(resolveContext(harness.peer, 'Review this implementation.')).resolves.toMatchObject({
        instructions: expect.stringContaining('Prefer careful iteration.'),
      })

      const inspected = await invokeTool(harness.peer, 'persona.inspect', { target: 'trait:evolving-profile' })
      if (inspected === null || typeof inspected !== 'object' || !('ok' in inspected) || inspected.ok !== true
        || !('value' in inspected) || inspected.value === null || typeof inspected.value !== 'object'
        || !('revision' in inspected.value) || typeof inspected.value.revision !== 'string') {
        throw new Error('persona.inspect returned an invalid result')
      }
      const replacement = 'Prefer verified, reversible evolution.\n'
      await expect(invokeTool(harness.peer, 'persona.revise', {
        target: 'trait:evolving-profile',
        expectedRevision: inspected.value.revision,
        replacement,
        rationale: 'Prefer confirmed runtime changes.',
      })).resolves.toMatchObject({
        ok: true,
        value: { status: 'applied', target: 'trait:evolving-profile' },
      })
      await expect(resolveContext(harness.peer, 'Review this implementation.')).resolves.toMatchObject({
        instructions: expect.stringContaining('Prefer verified, reversible evolution.'),
      })
    } catch (cause) {
      throw childError(harness, cause)
    } finally {
      await dispose(harness)
    }
  }, 15_000)

  it('isolates bound actors, exposes unbound state, and retains the host binding across reload', async () => {
    const roots = await Promise.all(['one', 'two', 'unbound'].map(async name => {
      const root = await mkdtemp(join(tmpdir(), `doppelganger-actor-${name}-`))
      temporaryRoots.push(root)
      await writeActorPreset(root)
      return root
    }))
    const harnesses = await Promise.all(roots.map(() => childHarness()))
    try {
      await Promise.all([
        harnesses[0]!.peer.request('session.activate', activation(roots[0]!, [], 'actor-one')),
        harnesses[1]!.peer.request('session.activate', activation(roots[1]!, [], 'actor-two')),
        harnesses[2]!.peer.request('session.activate', activation(roots[2]!)),
      ])
      const inspect = (harness: ChildHarness) => invokeTool(harness.peer, 'actor.inspect', {})
      await expect(inspect(harnesses[0]!)).resolves.toEqual({
        ok: true, value: { actor: { state: 'bound', actorId: 'actor-one' }, authoredActorId: 'authored' },
      })
      await expect(inspect(harnesses[1]!)).resolves.toEqual({
        ok: true, value: { actor: { state: 'bound', actorId: 'actor-two' }, authoredActorId: 'authored' },
      })
      await expect(inspect(harnesses[2]!)).resolves.toEqual({
        ok: true, value: { actor: { state: 'unbound' }, authoredActorId: 'authored' },
      })

      await changedCatalog(harnesses[0]!.peer, async () => {
        await writeFile(join(roots[0]!, 'runtime.cordis.yml'), actorPresetDefinition('forged-actor'))
      })
      await expect(inspect(harnesses[0]!)).resolves.toEqual({
        ok: true, value: { actor: { state: 'bound', actorId: 'actor-one' }, authoredActorId: 'forged-actor' },
      })
    } catch (cause) {
      throw childError(harnesses[0]!, cause)
    } finally {
      await Promise.all(harnesses.map(dispose))
    }
  }, 15_000)
})
