import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OMP_RPC_PROTOCOL_VERSION,
  type SerializedOmpActivation,
} from '../src/contracts.ts'
import {
  OmpAdapterSession,
  discoverOmpProject,
  type OmpChildConnection,
  type OmpChildFactory,
} from '../src/adapter.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FakeConnection implements OmpChildConnection {
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly notifications = new Map<string, (params: unknown) => void>()
  disposed = false
  activateVersion: number = OMP_RPC_PROTOCOL_VERSION
  activateTools: unknown = [{
    name: 'memory.search',
    description: 'search',
    inputSchema: { type: 'object' },
    approval: { policy: 'required', reason: 'Review this mutation' },
    available: true,
  }]

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'session.activate') return {
      protocolVersion: this.activateVersion,
      diagnostics: { compositionRevision: 'effective-one' },
      runtimeRevision: 'effective-one',
      tools: this.activateTools,
    }
    return null
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    this.notifications.set(method, handler)
    return () => this.notifications.delete(method)
  }

  async dispose() {
    this.disposed = true
    return { outcome: 'graceful' as const, sessionDisposeAcknowledged: true }
  }
}

class FakeFactory implements OmpChildFactory {
  readonly activateVersion: number | undefined
  readonly activateTools: unknown
  readonly connections: FakeConnection[] = []

  constructor(activateVersion?: number, activateTools?: unknown) {
    this.activateVersion = activateVersion
    this.activateTools = activateTools
  }

  async start(): Promise<OmpChildConnection> {
    const connection = new FakeConnection()
    if (this.activateVersion !== undefined) connection.activateVersion = this.activateVersion
    if (this.activateTools !== undefined) connection.activateTools = this.activateTools
    this.connections.push(connection)
    return connection
  }
}

function activation(root: string, sessionId: string, actorId?: string): SerializedOmpActivation {
  return {
    composition: {
      id: 'portable-runtime',
      revision: 'one',
      loaderPath: join(root, 'runtime.cordis.yml'),
      patches: [],
    },
    sessionId,
    workspaceRoot: root,
    hostKind: 'omp',
    watch: false,
    ...(actorId === undefined ? {} : { actorId }),
  }
}

describe('OMP adapter state machine', () => {
  it('discovers the nearest manifest without walking above the Git root', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'doppelganger-discovery-'))
    temporaryRoots.push(outer)
    const repository = join(outer, 'repository')
    const nested = join(repository, 'packages', 'feature', 'src')
    await Promise.all([
      mkdir(join(repository, '.git'), { recursive: true }),
      mkdir(nested, { recursive: true }),
      mkdir(join(repository, 'packages', '.doppelganger'), { recursive: true }),
    ])
    const nearest = join(repository, 'packages', '.doppelganger', 'manifest.yaml')
    await writeFile(nearest, 'version: 1\nruntimePreset: portable-runtime\n')
    expect(await discoverOmpProject(nested)).toEqual({
      workspaceRoot: join(repository, 'packages'),
      manifestPath: nearest,
    })

    await rm(nearest)
    const outside = join(outer, '.doppelganger', 'manifest.yaml')
    await mkdir(join(outer, '.doppelganger'), { recursive: true })
    await writeFile(outside, 'version: 1\nruntimePreset: outside\n')
    expect(await discoverOmpProject(nested)).toEqual({ workspaceRoot: repository })
  })

  it('executes a generic serialized activation without preset assembly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-adapter-'))
    temporaryRoots.push(root)
    const descriptor = activation(root, 'portable-session', 'actor-one')
    const factory = new FakeFactory()
    const adapter = new OmpAdapterSession({ activation: descriptor, childFactory: factory })
    expect(await adapter.start()).toMatchObject({
      state: 'active',
      initializationAvailable: false,
      tools: [{ approval: { policy: 'required', reason: 'Review this mutation' } }],
    })
    expect(factory.connections).toHaveLength(1)
    expect(factory.connections[0]?.requests[0]).toEqual({
      method: 'session.activate',
      params: {
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        ...descriptor,
      },
    })
    await expect(adapter.dispose()).resolves.toEqual({ outcome: 'graceful', sessionDisposeAcknowledged: true })
  })

  it('keeps absent activation inactive and reports malformed or incompatible descriptors', async () => {
    const factory = new FakeFactory()
    const inactive = new OmpAdapterSession({ childFactory: factory })
    expect(await inactive.start()).toEqual({ state: 'inactive', initializationAvailable: true, tools: [] })
    expect(factory.connections).toHaveLength(0)

    const malformed = new OmpAdapterSession({
      activation: {
        ...activation('relative', 'invalid'),
        composition: { ...activation('relative', 'invalid').composition, loaderPath: 'relative/cordis.yaml' },
      },
      childFactory: factory,
    })
    expect(await malformed.start()).toMatchObject({
      state: 'failed',
      diagnostic: { code: 'RUNTIME_START_FAILED' },
    })
    expect(factory.connections).toHaveLength(0)

    const invalidActor = new OmpAdapterSession({
      activation: { ...activation(join(process.cwd(), 'fixture'), 'invalid-actor'), actorId: ' ' },
      childFactory: factory,
    })
    expect(await invalidActor.start()).toMatchObject({
      state: 'failed',
      diagnostic: { message: 'actorId must be a non-empty string' },
    })
    expect(factory.connections).toHaveLength(0)

    const incompatibleFactory = new FakeFactory(OMP_RPC_PROTOCOL_VERSION + 1)
    const incompatible = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'incompatible'),
      childFactory: incompatibleFactory,
    })
    expect(await incompatible.start()).toMatchObject({ state: 'failed' })
    expect(incompatibleFactory.connections[0]?.disposed).toBe(true)
    const malformedApprovalFactory = new FakeFactory(undefined, [{
      name: 'memory.search',
      description: 'search',
      inputSchema: { type: 'object' },
      approval: { policy: 'required', reason: ' ' },
      available: true,
    }])
    const malformedApproval = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'malformed-approval'),
      childFactory: malformedApprovalFactory,
    })
    await expect(malformedApproval.start()).resolves.toMatchObject({
      state: 'failed',
      diagnostic: { message: expect.stringContaining('approval.reason') },
    })
    expect(malformedApprovalFactory.connections[0]?.disposed).toBe(true)

  })
})
