import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIDEN_DEFINITION_PATH, resolveAidenActivation } from '@doppelganger/preset-aiden'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  serializeLifecycleValue,
} from '@doppelganger/extension-protocols'
import {
  NodeOmpChildFactory,
  discoverProjectManifest,
  OmpAdapterSession,
  type OmpChildConnection,
} from '../src/index.ts'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
let userConfigPath = ''
let instancePath = ''
const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
const activeAdapters: OmpAdapterSession[] = []
const temporaryRoots: string[] = []
let mutationOrdinal = 0

beforeEach(async () => {
  mutationOrdinal = 0
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-vertical-instance-'))
  temporaryRoots.push(root)
  const instanceHome = join(root, 'instance')
  userConfigPath = join(root, 'config.yaml')
  await mkdir(instanceHome, { recursive: true })
  await Promise.all([
    writeFile(instancePath = join(instanceHome, 'instance.yaml'), [
      'version: 1',
      'id: aiden',
      `definition: ${JSON.stringify(AIDEN_DEFINITION_PATH)}`,
      'settings:',
      '  memoryCapture:',
      '    enabled: false',
    ].join('\n')),
    writeFile(userConfigPath, [
      'version: 1',
      'principalId: local-user',
      'defaultInstance: aiden',
      'instances:',
      `  aiden: ${JSON.stringify(instancePath)}`,
    ].join('\n')),
  ])
})

afterEach(async () => {
  await Promise.all(activeAdapters.splice(0).map(adapter => adapter.dispose()))
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function realSession(
  sessionId: string,
  cwd = repositoryRoot,
): Promise<{ adapter: OmpAdapterSession; connection: OmpChildConnection }> {
  const projectManifestPath = await discoverProjectManifest(cwd)
  const activation = await resolveAidenActivation({
    userConfigPath,
    sessionId,
    ...(projectManifestPath === undefined ? {} : { projectManifestPath }),
  })
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
  const result = await connection.request('tools.invoke', { name, input: normalized })
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

async function contextContent(connection: OmpChildConnection, input: string): Promise<string> {
  const result = await connection.request('context.resolve', {
    input,
    turnId: `turn-${Date.now()}`,
    tokenBudget: 2000,
  })
  if (result === null || typeof result !== 'object' || !('content' in result) || typeof result.content !== 'string') {
    throw new Error('context.resolve returned an invalid result')
  }
  return result.content
}

async function waitUntil(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${label} timed out`)
}

describe('real Aiden persona vertical', () => {
  it('activates the host-neutral definition and projects identity plus selected traits', async () => {
    const { connection } = await realSession('persona-context')
    const raw = await connection.request('context.resolve', {
      input: 'Review this implementation.',
      turnId: 'turn-one',
      tokenBudget: 2000,
    })
    if (raw === null || typeof raw !== 'object' || !('content' in raw) || typeof raw.content !== 'string') {
      throw new Error('context.resolve returned an invalid result')
    }
    expect(raw.content).toContain('You are Aiden, a durable technical collaborator.')
    expect(raw.content).toContain('Approach software work as a production engineer.')
    expect(raw.content).toContain('Communicate conclusions first.')
  })

  it('preserves global and project memory across process restarts without leaking project scope', async () => {
    const first = await realSession('continuity-first')
    const preference = recordCoordinates(await invoke(first.connection, 'memory.remember', {
      kind: 'preference', content: 'Prefer restart-safe adapters.', global: true,
    }))
    await invoke(first.connection, 'memory.remember', {
      kind: 'decision', content: 'The Doppelganger project selected Cordis.',
    })
    await first.adapter.dispose()

    const otherProject = await mkdtemp(join(tmpdir(), 'doppelganger-other-project-'))
    temporaryRoots.push(otherProject)
    await mkdir(join(otherProject, '.git'))
    await mkdir(join(otherProject, '.doppelganger'))
    await writeFile(join(otherProject, '.doppelganger', 'manifest.yaml'), [
      'version: 1',
      'projectId: other-project',
      'instanceId: aiden',
      'traits: [engineer]',
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

  it('runs the complete memory lifecycle through OMP tool RPC', async () => {
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

  it('captures committed OMP turns only as idempotent review candidates', async () => {
    await writeFile(instancePath, [
      'version: 1',
      'id: aiden',
      `definition: ${JSON.stringify(AIDEN_DEFINITION_PATH)}`,
      'settings:',
      '  memoryCapture:',
      '    enabled: true',
    ].join('\n'))
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
      toolOutcomes: [],
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

  it('applies valid live updates, rolls invalid changes back, and preserves state across plugin reload', async () => {
    const identityPath = join(repositoryRoot, 'packages', 'preset-aiden', 'definition', 'identity.md')
    const loaderPath = join(repositoryRoot, 'packages', 'preset-aiden', 'definition', 'cordis.yaml')
    const originalIdentity = await readFile(identityPath, 'utf8')
    const originalLoader = await readFile(loaderPath, 'utf8')
    const memoryProtocolBlock = [
      '    - id: memory-protocol',
      '      name: cordis:memory-protocol',
      '      inject: [doppelgangerMemory, doppelgangerTools, doppelgangerContext]',
    ].join('\n')
    expect(originalLoader).toContain(memoryProtocolBlock)
    const session = await realSession('live-reload')
    await invoke(session.connection, 'memory.remember', {
      kind: 'fact', content: 'Persistent reload sentinel uses heliotrope-731.',
    })

    try {
      await writeFile(identityPath, 'You are Aiden after a valid live profile update.\n')
      await waitUntil(async () => (await contextContent(session.connection, 'profile identity')).includes(
        'You are Aiden after a valid live profile update.',
      ), 'valid identity reload')

      await writeFile(loaderPath, originalLoader.replace('name: cordis:identity', 'name: cordis:missing-plugin'))
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(await contextContent(session.connection, 'profile identity')).toContain(
        'You are Aiden after a valid live profile update.',
      )
      expect(session.adapter.snapshot().tools.map(tool => tool.name)).toContain('memory.search')

      await writeFile(loaderPath, originalLoader.replace(`${memoryProtocolBlock}\n`, ''))
      await waitUntil(() => !session.adapter.snapshot().tools.some(tool => tool.name === 'memory.search'), 'tool removal')
      expect(session.adapter.snapshot().state).toBe('active')

      await writeFile(loaderPath, originalLoader)
      await waitUntil(() => session.adapter.snapshot().tools.some(tool => tool.name === 'memory.search'), 'tool restoration')
      expect(searchContents(await invoke(session.connection, 'memory.search', {
        query: 'heliotrope 731',
      }))).toContain('Persistent reload sentinel uses heliotrope-731.')
    } finally {
      await writeFile(identityPath, originalIdentity)
      await writeFile(loaderPath, originalLoader)
    }
  })
})
