import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatApprovalPrompt, resolveApproval } from '@oh-my-pi/pi-coding-agent/tools/approval'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  digestToolInput,
  serializeLifecycleValue,
} from '@doppelganger/doppelganger-protocols'
import { OmpAdapterSession, type OmpChildConnection } from '../src/adapter.ts'
import {
  createDoppelgangerOmpExtension,
  resolveOmpActivation,
} from '../src/extension.ts'
import { NodeOmpChildFactory } from '../src/process.ts'

const semanticEmbedderPath = fileURLToPath(new URL('./fixtures/deterministic-embedder.ts', import.meta.url))
const mcpFixturePath = fileURLToPath(new URL('../../extension-mcp/tests/fixtures/stdio-server.mjs', import.meta.url))
let homePath = ''
let workspacePath = ''
let presetPath = ''
let presetSource = ''
let storagePath = ''
const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
const activeAdapters: OmpAdapterSession[] = []
const temporaryRoots: string[] = []
let mutationOrdinal = 0
function captureRow(): string[] {
  return [
    '- id: doppelganger-memory-capture',
    '  name: "@doppelganger/doppelganger-memory/capture"',
    '  inject: [doppelgangerActor, doppelgangerMemory, doppelgangerPersona]',
    '  isolate:',
    '    doppelgangerActor: session',
    '    doppelgangerMemory: session',
    '    doppelgangerPersona: session',
    '  config:',
    '    enabled: true',
  ]
}

function declarativeTestPreset(storage: string, capture = false, semantic = false): string {
  return [
    '- id: doppelganger-context',
    '  name: "@doppelganger/doppelganger-protocols/context"',
    '  isolate:',
    '    doppelgangerContext: session',
    '- id: doppelganger-tools',
    '  name: "@doppelganger/doppelganger-protocols/tools"',
    '  isolate:',
    '    doppelgangerTools: session',
    '- id: doppelganger-persona',
    '  name: "@doppelganger/doppelganger-persona"',
    '  inject: [doppelgangerRuntimeSession, doppelgangerContext]',
    '  isolate:',
    '    doppelgangerRuntimeSession: session',
    '    doppelgangerContext: session',
    '    doppelgangerPersona: session',
    '  config:',
    '    instanceId: integration-persona',
    '    identity: { path: identity.md, priority: 1000 }',
    '    traits:',
    '      - { name: engineer, path: traits/engineer.md, priority: 700 }',
    '      - { name: concise, path: traits/concise.md, priority: 600 }',
    '      - { name: evolving-profile, path: traits/evolving-profile.md, priority: 500 }',
    '- id: doppelganger-persona-authoring',
    '  name: "@doppelganger/doppelganger-persona-authoring"',
    '  inject: [doppelgangerPersona, doppelgangerTools]',
    '  isolate:',
    '    doppelgangerPersona: session',
    '    doppelgangerTools: session',
    '  config:',
    '    writableTargets: ["trait:evolving-profile"]',
    '- id: doppelganger-sqlite',
    '  name: "@doppelganger/doppelganger-sqlite"',
    '  isolate:',
    '    doppelgangerInstanceSqlite: session',
    '  config:',
    `    home: ${JSON.stringify(storage)}`,
    '- id: doppelganger-memory',
    '  name: "@doppelganger/doppelganger-memory"',
    '  inject: [doppelgangerActor, doppelgangerPersona, doppelgangerContext, doppelgangerTools, doppelgangerInstanceSqlite]',
    '  isolate:',
    '    doppelgangerActor: session',
    '    doppelgangerPersona: session',
    '    doppelgangerContext: session',
    '    doppelgangerTools: session',
    '    doppelgangerInstanceSqlite: session',
    '    doppelgangerMemory: session',
    ...(semantic ? ['    doppelgangerMemorySemantic: session'] : []),
    ...(capture ? captureRow() : []),
    '',
  ].join('\n')
}

function semanticRows(storage: string): string[] {
  return [
    '- id: deterministic-semantic-embedder',
    `  name: ${JSON.stringify(semanticEmbedderPath)}`,
    '  isolate:',
    '    doppelgangerMemoryEmbedder: session',
    '- id: semantic-sqlite-exact',
    '  name: "@doppelganger/doppelganger-memory-vectors/sqlite-exact"',
    '  isolate:',
    '    doppelgangerMemoryVectorIndex: session',
    '  config:',
    `    databasePath: ${JSON.stringify(join(storage, 'semantic-vectors.sqlite3'))}`,
    '    namespace: omp-semantic-test',
    '    dimensions: 3',
    '    sanitizedTarget: local:omp-semantic-test',
    '- id: semantic-coordinator',
    '  name: "@doppelganger/doppelganger-memory-vectors"',
    '  inject: [doppelgangerMemory, doppelgangerTools, doppelgangerMemoryEmbedder, doppelgangerMemoryVectorIndex]',
    '  isolate:',
    '    doppelgangerPersona: session',
    '    doppelgangerMemory: session',
    '    doppelgangerTools: session',
    '    doppelgangerMemoryEmbedder: session',
    '    doppelgangerMemoryVectorIndex: session',
    '    doppelgangerMemorySemantic: session',
    '  config:',
    '    instanceId: integration-persona',
    '    pollIntervalMs: 10',
    '    batchSize: 4',
    '    retryBaseMs: 10',
    '    operationTimeoutMs: 1000',
  ]
}

function delayedMcpRows(): string[] {
  return [
    '- id: doppelganger-mcp',
    '  name: "@doppelganger/doppelganger-extension-mcp/loader"',
    '  inject: [doppelgangerTools]',
    '  isolate:',
    '    doppelgangerTools: session',
    '    doppelgangerMcp: session',
    '  config:',
    '    servers:',
    '      delayed:',
    '        startupTimeoutMs: 10000',
    '        transport:',
    '          type: stdio',
    `          command: ${JSON.stringify(process.execPath)}`,
    '          args:',
    `            - ${JSON.stringify(mcpFixturePath)}`,
    '          environment:',
    '            MCP_INITIALIZE_DELAY_MS:',
    '              env: OMP_TEST_MCP_INITIALIZE_DELAY',
  ]
}
beforeEach(async () => {
  mutationOrdinal = 0
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-vertical-instance-'))
  temporaryRoots.push(root)
  homePath = join(root, 'home')
  workspacePath = join(root, 'workspace')
  storagePath = join(root, 'state', 'integration-persona')
  const storage = storagePath
  const presetDirectory = join(homePath, '.runtime-presets', 'full-stack-test')
  presetPath = join(presetDirectory, 'runtime.cordis.yml')
  await Promise.all([
    mkdir(join(presetDirectory, 'traits'), { recursive: true }),
    mkdir(join(workspacePath, '.doppelganger'), { recursive: true }),
  ])
  presetSource = declarativeTestPreset(storage)
  await Promise.all([
    writeFile(presetPath, presetSource),
    writeFile(join(homePath, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: full-stack-test\n'),
    writeFile(join(presetDirectory, 'identity.md'), 'You are an integration test assistant.'),
    writeFile(join(presetDirectory, 'traits', 'engineer.md'), 'Approach software work as a production engineer.'),
    writeFile(join(presetDirectory, 'traits', 'concise.md'), 'Communicate conclusions first.'),
    writeFile(join(presetDirectory, 'traits', 'evolving-profile.md'), 'Preserve deliberate collaboration evolution.'),
    writeFile(join(workspacePath, '.doppelganger', 'manifest.yaml'), 'version: 1\nruntimePreset: full-stack-test\n'),
  ])
})

afterEach(async () => {
  await Promise.all(activeAdapters.splice(0).map(adapter => adapter.dispose()))
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  delete process.env.OMP_TEST_MCP_INITIALIZE_DELAY
})

async function realSession(
  sessionId: string,
  cwd = workspacePath,
  actorId: string | null = 'test-actor',
): Promise<{ adapter: OmpAdapterSession; connection: OmpChildConnection }> {
  const activation = await resolveOmpActivation({ home: homePath, watch: true, ...(actorId === null ? {} : { actorId }) }, { cwd, sessionId })
  const adapter = new OmpAdapterSession({
    ...(activation === undefined ? {} : { activation }),
    childFactory: new NodeOmpChildFactory({ childPath, shutdownTimeoutMs: 1000 }),
  })
  activeAdapters.push(adapter)
  const snapshot = await adapter.start()
  expect(snapshot.state, snapshot.diagnostic?.message).toBe('active')
  const connection = adapter.connection()
  if (connection === undefined) throw new Error('real runtime connection is inactive')
  return { adapter, connection }
}

async function invoke(connection: OmpChildConnection, name: string, input: Record<string, unknown>): Promise<unknown> {
  const ordinal = ++mutationOrdinal
  const normalized = { ...input }
  const relationship = normalized.global === true
  delete normalized.global
  if (new Set([
    'memory.remember',
    'memory.candidates.propose',
    'memory.evidence.observe',
    'memory.correct',
    'memory.forget',
    'memory.candidates.approve',
    'memory.candidates.reject',
    'memory.candidates.corroborate',
    'memory.conflicts.resolve',
    'memory.pin',
    'memory.unpin',
  ]).has(name)) normalized.operationId ??= `vertical:${name}:${ordinal}`
  if (name === 'memory.remember' || name === 'memory.candidates.propose') {
    normalized.subjectKey ??= `vertical.${String(normalized.kind ?? 'memory')}.${ordinal}`
    if (relationship) normalized.scope = 'relationship'
  }
  if (name === 'memory.candidates.corroborate') normalized.turnId ??= `turn:${ordinal}`
  const catalog = await connection.request('tools.snapshot') as {
    revision: string
    tools: Array<{ name: string; revision: string; approval?: unknown }>
  }
  const descriptor = catalog.tools.find(tool => tool.name === name)
  if (descriptor === undefined) throw new Error(`${name} is not present in the current catalog`)
  const callId = `vertical-call:${ordinal}`
  const result = await connection.request('tools.invoke', {
    callId,
    name,
    toolRevision: descriptor.revision,
    input: normalized,
    ...(descriptor.approval === undefined ? {} : {
      approval: {
        kind: 'one-shot',
        grantId: `vertical-grant:${ordinal}`,
        callId,
        toolRevision: descriptor.revision,
        inputDigest: digestToolInput(normalized as never),
      },
    }),
  })
  if (result === null || typeof result !== 'object' || !('ok' in result)) {
    throw new Error(`${name} returned an invalid result`)
  }
  if (result.ok !== true) {
    if ('error' in result && result.error !== null && typeof result.error === 'object') {
      const code = 'code' in result.error && typeof result.error.code === 'string' ? result.error.code : 'TOOL_ERROR'
      const message = 'message' in result.error && typeof result.error.message === 'string' ? result.error.message : `${name} failed`
      throw new Error(`${code}: ${message}`)
    }
    throw new Error(`${name} failed`)
  }
  if (!('value' in result)) throw new Error(`${name} returned no value`)
  return result.value
}
async function resolveContext(connection: OmpChildConnection): Promise<string> {
  const raw = await connection.request('context.resolve', {
    requestId: 'vertical-context-request',
    turn: { input: 'Review this implementation.', turnId: 'turn-one' },
    tokenBudget: 2000,
  })
  if (raw === null || typeof raw !== 'object' || !('content' in raw) || typeof raw.content !== 'string') {
    throw new Error('context.resolve returned an invalid result')
  }
  return raw.content
}


function recordCoordinates(value: unknown): { id: string; revisionId: string } {
  if (value === null || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
    || !('revision' in value) || value.revision === null || typeof value.revision !== 'object'
    || !('id' in value.revision) || typeof value.revision.id !== 'string') {
    throw new Error('memory tool returned an invalid record')
  }
  return { id: value.id, revisionId: value.revision.id }
}

function searchContents(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('memory.search returned an invalid result')
  return value.flatMap(item => {
    if (item === null || typeof item !== 'object' || !('record' in item)
      || item.record === null || typeof item.record !== 'object' || !('revision' in item.record)
      || item.record.revision === null || typeof item.record.revision !== 'object'
      || !('content' in item.record.revision) || typeof item.record.revision.content !== 'string') return []
    return [item.record.revision.content]
  })
}


async function waitUntil(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${label} timed out`)
}

interface ProjectedTool {
  readonly name?: string
  readonly loadMode?: 'essential' | 'discoverable'
  readonly approval?: unknown
  readonly formatApprovalDetails?: (args: unknown) => string | string[] | undefined
  readonly execute: (
    callId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ) => Promise<{ readonly details?: unknown; readonly isError?: boolean }>
}

function mountedOmpExtension(sessionId: string, install: (api: ExtensionAPI) => void) {
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown>>()
  const tools = new Map<string, ProjectedTool>()
  let activeTools = ['read', 'bash']
  const schema = { min: () => schema }
  const api = {
    zod: { string: () => schema, object: () => ({}) },
    logger: { error() {} },
    registerTool(tool: ProjectedTool & { readonly name: string }) { tools.set(tool.name, tool) },
    on(event: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown>) {
      handlers.set(event, handler)
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: async (names: string[]) => { activeTools = [...names] },
  } as unknown as ExtensionAPI
  const context = {
    cwd: workspacePath,
    hasUI: false,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext
  install(api)
  return { handlers, tools, context }
}

function realOmpExtension(sessionId: string) {
  return mountedOmpExtension(
    sessionId,
    createDoppelgangerOmpExtension({ home: homePath, actorId: 'test-actor', childPath, shutdownTimeoutMs: 1000 }),
  )
}

async function commitOmpTurn(
  fixture: ReturnType<typeof realOmpExtension>,
  principalInput: string,
  assistantOutput: string,
): Promise<void> {
  await fixture.handlers.get('before_agent_start')!({
    type: 'before_agent_start', prompt: principalInput, systemPrompt: [],
  }, fixture.context)
  await fixture.handlers.get('turn_start')!({ type: 'turn_start', turnIndex: 0, timestamp: 1 }, fixture.context)
  await fixture.handlers.get('turn_end')!({
    type: 'turn_end',
    turnIndex: 0,
    message: { role: 'assistant', content: [{ type: 'text', text: assistantOutput }], stopReason: 'stop', timestamp: 2 },
    toolResults: [],
  }, fixture.context)
}

describe('full-stack test Runtime Preset vertical', () => {
  it('activates the host-neutral definition and projects identity plus selected traits', async () => {
    const { connection } = await realSession('persona-context')
    const content = await resolveContext(connection)
    expect(content).toContain('You are an integration test assistant.')
    expect(content).toContain('Approach software work as a production engineer.')
    expect(content).toContain('Communicate conclusions first.')
    expect(content).toContain('Preserve deliberate collaboration evolution.')
    await expect(connection.request('tools.snapshot')).resolves.toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'persona.inspect' }),
        expect.objectContaining({
          name: 'persona.revise',
          approval: { policy: 'required', reason: 'This changes active Persona instructions.' },
        }),
      ]),
    })
    await expect(invoke(connection, 'persona.inspect', { target: 'identity' })).resolves.toMatchObject({ writable: false })
    await expect(invoke(connection, 'persona.inspect', { target: 'trait:engineer' })).resolves.toMatchObject({ writable: false })
    await expect(invoke(connection, 'persona.inspect', { target: 'trait:concise' })).resolves.toMatchObject({ writable: false })
    await expect(invoke(connection, 'persona.inspect', { target: 'trait:evolving-profile' })).resolves.toMatchObject({ writable: true })

    await writeFile(
      join(homePath, '.runtime-presets', 'full-stack-test', 'identity.md'),
      'You are a verified integration test assistant.',
    )
    await expect.poll(() => resolveContext(connection)).toContain('You are a verified integration test assistant.')
  })

  it('revises the active trait through the approved project-local OMP extension', async () => {
    vi.stubEnv('DOPPELGANGER_HOME', homePath)
    vi.stubEnv('DOPPELGANGER_ACTOR_ID', 'test-actor')
    vi.resetModules()
    const extensionUrl = new URL('../../../.omp/extensions/doppelganger.ts', import.meta.url)
    extensionUrl.searchParams.set('project-local-smoke', String(Date.now()))
    const projectExtension = (await import(extensionUrl.href)).default
    const fixture = mountedOmpExtension('approved-persona-revision', projectExtension)
    try {
      await fixture.handlers.get('session_start')!({ type: 'session_start' }, fixture.context)
      expect(fixture.tools.get('doppelganger_persona_inspect')?.loadMode).toBe('discoverable')
      expect(fixture.tools.get('doppelganger_persona_revise')?.loadMode).toBe('essential')
      const inspect = fixture.tools.get('doppelganger_persona_inspect')!
      const inspected = await inspect.execute(
        'inspect-evolving',
        { target: 'trait:evolving-profile' },
        undefined,
        undefined,
        fixture.context,
      )
      const value = inspected.details as { readonly revision: string }
      const revise = fixture.tools.get('doppelganger_persona_revise')!
      const replacement = 'Prefer explicit verification before durable behavioral change.\n'
      const args = {
        target: 'trait:evolving-profile',
        expectedRevision: value.revision,
        replacement,
        rationale: 'Exercise the native approved revision path.',
      }
      const approval = resolveApproval(revise as never, args, 'yolo', {})
      expect(approval).toMatchObject({ policy: 'prompt', tier: 'write' })
      expect(formatApprovalPrompt(revise as never, args, approval.reason)).toContain('Portable tool: persona.revise')
      const revised = await revise.execute('approved-revision', args, undefined, undefined, fixture.context)
      expect(revised.isError).not.toBe(true)
      expect(revised.details).toMatchObject({ status: 'applied', target: 'trait:evolving-profile' })

      const next = await fixture.handlers.get('before_agent_start')!({
        type: 'before_agent_start', prompt: 'Use the revised trait.', systemPrompt: [],
      }, fixture.context) as { systemPrompt?: string[] }
      expect(next.systemPrompt?.at(-1))
        .toContain('Prefer explicit verification before durable behavioral change.')
    } finally {
      await fixture.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, fixture.context)
      vi.unstubAllEnvs()
    }
  })


  it('fails memory activation before canonical storage opens when the host actor is unbound', async () => {
    const activation = await resolveOmpActivation({ home: homePath, watch: false }, { cwd: workspacePath, sessionId: 'unbound-memory' })
    const adapter = new OmpAdapterSession({
      ...(activation === undefined ? {} : { activation }),
      childFactory: new NodeOmpChildFactory({ childPath, shutdownTimeoutMs: 1000 }),
    })
    activeAdapters.push(adapter)

    expect(await adapter.start()).toMatchObject({
      state: 'failed',
      diagnostic: { message: expect.stringContaining('memory requires a bound host actor') },
    })
    await expect(access(join(storagePath, 'storage', 'memory.sqlite'))).rejects.toThrow()
  })

  it('preserves relationship and project memory across process restarts without leaking project or actor scope', async () => {
    const first = await realSession('continuity-first')
    const preference = recordCoordinates(await invoke(first.connection, 'memory.remember', {
      kind: 'preference', content: 'Prefer restart-safe adapters.', global: true,
    }))
    await invoke(first.connection, 'memory.remember', {
      kind: 'decision', content: 'The Doppelganger project selected Cordis.',
    })
    await first.adapter.dispose()

    const canonicalPath = join(storagePath, 'storage', 'memory.sqlite')
    const legacy = new DatabaseSync(canonicalPath)
    legacy.exec('ALTER TABLE memory_records RENAME COLUMN actor_id TO principal_id')
    legacy.exec('ALTER TABLE memory_operations RENAME COLUMN actor_id TO principal_id')
    legacy.exec('UPDATE memory_schema SET version = 3')
    legacy.close()

    const otherActor = await realSession('continuity-other-actor', workspacePath, 'another-actor')
    expect(searchContents(await invoke(otherActor.connection, 'memory.search', { query: 'restart safe adapters' }))).toEqual([])
    expect(searchContents(await invoke(otherActor.connection, 'memory.search', { query: 'selected Cordis' }))).toEqual([])
    await otherActor.adapter.dispose()

    const otherProject = await mkdtemp(join(tmpdir(), 'doppelganger-other-project-'))
    temporaryRoots.push(otherProject)
    await mkdir(join(otherProject, '.git'))
    await mkdir(join(otherProject, '.doppelganger'))
    await writeFile(join(otherProject, '.doppelganger', 'manifest.yaml'), [
      'version: 1',
      'runtimePreset: full-stack-test',
    ].join('\n'))
    const second = await realSession('continuity-second', otherProject)
    expect(searchContents(await invoke(second.connection, 'memory.search', { query: 'restart safe adapters' })))
      .toContain('Prefer restart-safe adapters.')
    expect(searchContents(await invoke(second.connection, 'memory.search', { query: 'selected Cordis' })))
      .not.toContain('The Doppelganger project selected Cordis.')

    const third = await realSession('continuity-third')
    const correctionResults = await Promise.all([
      invoke(second.connection, 'memory.correct', {
        id: preference.id,
        expectedRevisionId: preference.revisionId,
        content: 'Prefer deterministic restart-safe adapters.',
      }),
      invoke(third.connection, 'memory.correct', {
        id: preference.id,
        expectedRevisionId: preference.revisionId,
        content: 'Prefer observable restart-safe adapters.',
      }),
    ].map(operation => operation.then(() => 'committed', error => error instanceof Error ? error.message : String(error))))
    expect(correctionResults).toEqual(expect.arrayContaining([
      'committed',
      expect.stringContaining('REVISION_CONFLICT'),
    ]))

    await second.adapter.dispose()
    await third.adapter.dispose()
    const restarted = await realSession('continuity-restarted')
    expect(searchContents(await invoke(restarted.connection, 'memory.search', { query: 'restart safe adapters' }))).toHaveLength(1)
    expect(searchContents(await invoke(restarted.connection, 'memory.search', { query: 'selected Cordis' })))
      .toContain('The Doppelganger project selected Cordis.')
  })

  it('runs the complete actor-partitioned memory lifecycle through OMP tool RPC', async () => {
    const first = await realSession('memory-first')
    const explicit = recordCoordinates(await invoke(first.connection, 'memory.remember', {
      kind: 'fact',
      content: 'The lexical recall marker is flibbertigibbet-axiom-947.',
    }))
    expect(searchContents(await invoke(first.connection, 'memory.search', {
      query: 'flibbertigibbet axiom 947',
    }))).toContain('The lexical recall marker is flibbertigibbet-axiom-947.')

    const approved = recordCoordinates(await invoke(first.connection, 'memory.candidates.propose', {
      kind: 'preference', content: 'Prefer reviewed candidate memory.', global: true,
    }))
    const rejected = recordCoordinates(await invoke(first.connection, 'memory.candidates.propose', {
      kind: 'fact', content: 'This candidate should be rejected.',
    }))
    const candidates = await invoke(first.connection, 'memory.candidates.list', {})
    expect(Array.isArray(candidates) && candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: approved.id, status: 'candidate' }),
      expect.objectContaining({ id: rejected.id, status: 'candidate' }),
    ]))
    await invoke(first.connection, 'memory.candidates.approve', { id: approved.id })
    await invoke(first.connection, 'memory.candidates.reject', { id: rejected.id })
    expect(await invoke(first.connection, 'memory.candidates.list', {})).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rejected.id }),
    ]))

    const promotable = recordCoordinates(await invoke(first.connection, 'memory.candidates.propose', {
      kind: 'preference', content: 'Prefer evidence-backed changes.', global: true,
    }))
    await expect(invoke(first.connection, 'memory.candidates.corroborate', {
      id: promotable.id, content: 'Repeated in the original session.',
    })).resolves.toEqual(expect.objectContaining({ id: promotable.id, status: 'candidate' }))
    const second = await realSession('memory-second')
    const promoted = await invoke(second.connection, 'memory.candidates.corroborate', {
      id: promotable.id, content: 'The preference was independently repeated.',
    })
    expect(promoted).toEqual(expect.objectContaining({ id: promotable.id, status: 'active' }))

    const corrected = await invoke(first.connection, 'memory.correct', {
      id: explicit.id,
      expectedRevisionId: explicit.revisionId,
      content: 'The corrected lexical marker is flibbertigibbet-axiom-948.',
    })
    expect(corrected).toEqual(expect.objectContaining({ id: explicit.id }))
    const pinned = await invoke(first.connection, 'memory.pin', { id: explicit.id })
    expect(pinned).toEqual(expect.objectContaining({ pinned: true }))
    const unpinned = await invoke(first.connection, 'memory.unpin', { id: explicit.id })
    expect(unpinned).toEqual(expect.objectContaining({ pinned: false }))

    await expect(invoke(first.connection, 'memory.remember', {
      kind: 'fact', content: 'api_key = sk_live_1234567890abcdefgh',
    })).rejects.toThrow('SECRET_REJECTED')
    expect(searchContents(await invoke(first.connection, 'memory.search', {
      query: 'flibbertigibbet axiom 948',
    }))).toContain('The corrected lexical marker is flibbertigibbet-axiom-948.')
    expect(await invoke(first.connection, 'memory.forget', { id: explicit.id })).toEqual({ deleted: true })
    expect(searchContents(await invoke(first.connection, 'memory.search', {
      query: 'flibbertigibbet axiom 948',
    }))).toEqual([])
  })
  it('runs semantic recall, restart, reindex, fallback, recovery, deletion, and shutdown through a child runtime', async () => {
    const semanticPreset = declarativeTestPreset(storagePath, false, true)
    await writeFile(presetPath, `${semanticPreset.trimEnd()}\n${semanticRows(storagePath).join('\n')}\n`)
    const first = await realSession('semantic-first')
    const transport = recordCoordinates(await invoke(first.connection, 'memory.remember', {
      subjectKey: 'project.transport.framing',
      kind: 'fact',
      content: 'Transport framing uses deterministic envelopes.',
    }))
    await waitUntil(async () => {
      const status = await invoke(first.connection, 'memory.semantic.status', {})
      if (status === null || typeof status !== 'object' || !('counts' in status) || status.counts === null || typeof status.counts !== 'object') return false
      return 'indexed' in status.counts && status.counts.indexed === 1
        && 'pendingUpserts' in status.counts && status.counts.pendingUpserts === 0
    }, 'initial semantic projection')
    expect(searchContents(await invoke(first.connection, 'memory.search', {
      query: 'How does RPC communication package messages?',
    }))).toContain('Transport framing uses deterministic envelopes.')

    await first.adapter.dispose()
    const restarted = await realSession('semantic-restarted')
    expect(searchContents(await invoke(restarted.connection, 'memory.search', {
      query: 'How does RPC communication package messages?',
    }))).toContain('Transport framing uses deterministic envelopes.')

    const rebuilt = await invoke(restarted.connection, 'memory.semantic.rebuild', {})
    expect(rebuilt).toEqual(expect.objectContaining({ active: true, backend: 'sqlite_exact' }))

    const corrected = recordCoordinates(await invoke(restarted.connection, 'memory.correct', {
      id: transport.id,
      expectedRevisionId: transport.revisionId,
      content: 'Database storage uses SQLite.',
    }))
    await waitUntil(async () => searchContents(await invoke(restarted.connection, 'memory.search', {
      query: 'Where are durable records persisted?',
    })).includes('Database storage uses SQLite.'), 'semantic correction projection')
    expect(corrected.revisionId).not.toBe(transport.revisionId)

    const lexical = recordCoordinates(await invoke(restarted.connection, 'memory.remember', {
      subjectKey: 'project.fallback.anchor',
      kind: 'fact',
      content: 'The lexical-anchor remains durable.',
    }))
    expect(searchContents(await invoke(restarted.connection, 'memory.search', {
      query: 'FAIL_SEMANTIC lexical-anchor',
    }))).toContain('The lexical-anchor remains durable.')
    expect(searchContents(await invoke(restarted.connection, 'memory.search', {
      query: 'Where are durable records persisted?',
    }))).toContain('Database storage uses SQLite.')

    expect(await invoke(restarted.connection, 'memory.forget', { id: corrected.id })).toEqual({ deleted: true })
    expect(await invoke(restarted.connection, 'memory.forget', { id: lexical.id })).toEqual({ deleted: true })
    await waitUntil(async () => searchContents(await invoke(restarted.connection, 'memory.search', {
      query: 'Where are durable records persisted?',
    })).length === 0, 'semantic hard deletion')
    await restarted.adapter.dispose()
  })

  it('captures committed OMP turns only as idempotent review candidates', async () => {
    await writeFile(presetPath, `${presetSource.trimEnd()}\n${captureRow().join('\n')}\n`)
    const { connection } = await realSession('capture-through-omp')
    const event = {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-committed' as const,
      deliveryId: 'omp-capture-delivery',
      sessionId: 'capture-through-omp',
      turnId: 'capture-turn',
      timestamp: 1,
      principalInput: serializeLifecycleValue('[fact:project.capture.transport] OMP forwards committed capture material.'),
      assistantOutput: serializeLifecycleValue('Completed answer.'),
      outcome: 'completed' as const,
    }
    await expect(connection.request('event.publish', event)).resolves.toBeNull()
    await expect(connection.request('event.publish', event)).resolves.toBeNull()
    const candidates = await invoke(connection, 'memory.candidates.list', {})
    expect(candidates).toEqual([
      expect.objectContaining({ subjectKey: 'project.capture.transport', status: 'candidate' }),
    ])
    const candidate = recordCoordinates((candidates as unknown[])[0])
    expect(await invoke(connection, 'memory.evidence.list', { id: candidate.id })).toEqual([
      expect.objectContaining({ sourceTurnId: 'capture-turn', role: 'principal' }),
    ])
    expect(searchContents(await invoke(connection, 'memory.search', { query: 'capture transport' }))).toEqual([])
    await invoke(connection, 'memory.candidates.approve', { id: candidate.id })
    expect(searchContents(await invoke(connection, 'memory.search', { query: 'capture transport' })))
      .toContain('OMP forwards committed capture material.')
  })

  it('forwards committed OMP turns into capture only when the row is enabled', async () => {
    const disabled = realOmpExtension('capture-disabled')
    await disabled.handlers.get('session_start')!({ type: 'session_start' }, disabled.context)
    await commitOmpTurn(
      disabled,
      '[fact:project.capture.disabled] Disabled capture must not persist this observation.',
      'The disabled turn completed.',
    )
    const disabledList = disabled.tools.get('doppelganger_memory_candidates_list')!
    expect((await disabledList.execute('disabled-list', {}, undefined, undefined, disabled.context)).details).toEqual([])
    await disabled.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, disabled.context)

    await writeFile(presetPath, `${presetSource.trimEnd()}\n${captureRow().join('\n')}\n`)
    const enabled = realOmpExtension('capture-enabled')
    await enabled.handlers.get('session_start')!({ type: 'session_start' }, enabled.context)
    await commitOmpTurn(
      enabled,
      [
        '<!-- doppelganger:start -->',
        '[fact:project.capture.recursive] Projected memory must not be captured recursively.',
        '<!-- doppelganger:end -->',
        '[fact:project.capture.adapter] OMP forwarded this committed principal input.',
      ].join('\n'),
      'The enabled turn completed with actual assistant output.',
    )
    const enabledList = enabled.tools.get('doppelganger_memory_candidates_list')!
    const result = await enabledList.execute('enabled-list', {}, undefined, undefined, enabled.context)
    expect(result.isError).not.toBe(true)
    expect(result.details).toEqual([
      expect.objectContaining({
        subjectKey: 'project.capture.adapter',
        revision: expect.objectContaining({ content: 'OMP forwarded this committed principal input.' }),
        status: 'candidate',
      }),
    ])
    await enabled.handlers.get('session_shutdown')!({ type: 'session_shutdown' }, enabled.context)
  })


  it('projects a delayed MCP tool through the generic catalog change path after session activation', async () => {
    process.env.OMP_TEST_MCP_INITIALIZE_DELAY = '3000'
    await writeFile(presetPath, `${presetSource.trimEnd()}\n${delayedMcpRows().join('\n')}\n`)

    const session = await realSession('delayed-mcp-catalog')
    expect(session.adapter.snapshot().catalog.tools.map(tool => tool.name)).not.toContain('mcp-delayed.echo-value')
    await waitUntil(
      () => session.adapter.snapshot().catalog.tools.some(tool => tool.name === 'mcp-delayed.echo-value'),
      'delayed MCP tool projection',
    )
    expect(await invoke(session.connection, 'mcp-delayed.echo-value', { value: 'projected' })).toEqual({
      content: [{ type: 'text', text: 'projected' }],
      structuredContent: { echoed: 'projected' },
    })
  })
  it('applies valid preset updates, rolls invalid changes back, and preserves state across reload', async () => {
    const originalPreset = presetSource
    const session = await realSession('live-reload')
    await invoke(session.connection, 'memory.remember', {
      kind: 'fact', content: 'Persistent reload sentinel uses heliotrope-731.',
    })

    try {
      const runtimeRevision = async () => {
        const result = await session.connection.request('runtime.diagnostics') as { runtimeRevision: string }
        return result.runtimeRevision
      }
      const initialRevision = await runtimeRevision()
      await writeFile(presetPath, `${originalPreset.trimEnd()}\n${captureRow().join('\n')}\n`)
      await waitUntil(async () => await runtimeRevision() !== initialRevision, 'valid preset reload')
      expect(session.adapter.snapshot().catalog.tools.map(tool => tool.name)).toContain('memory.search')

      const validRevision = await runtimeRevision()
      await writeFile(presetPath, originalPreset.replace(
        '  name: "@doppelganger/doppelganger-memory"',
        '  name: ./missing-plugin.mjs',
      ))
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(session.adapter.snapshot().catalog.tools.map(tool => tool.name)).toContain('memory.search')

      await writeFile(presetPath, originalPreset)
      await waitUntil(async () => await runtimeRevision() !== validRevision, 'preset restoration')
      expect(searchContents(await invoke(session.connection, 'memory.search', {
        query: 'heliotrope 731',
      }))).toContain('Persistent reload sentinel uses heliotrope-731.')
    } finally {
      await writeFile(presetPath, originalPreset)
    }
  })
})
