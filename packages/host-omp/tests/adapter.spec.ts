import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ToolRegistry, digestToolInput, type ToolDefinition } from '@doppelganger/doppelganger-protocols'
import { NodeOmpChildFactory } from '../src/process.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OMP_RPC_PROTOCOL_VERSION,
  OMP_RUNTIME_HOST_CAPABILITIES,
  defineToolCatalogSnapshot,
  defineToolInvocationResult,
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

function catalog(revision = 'catalog:1', toolRevision = 'tool:1', approvalReason = 'Review this mutation') {
  return {
    revision,
    tools: [{
      name: 'memory.search',
      label: 'Memory search',
      description: 'search',
      inputSchema: { type: 'object' },
      revision: toolRevision,
      approval: { policy: 'required', reason: approvalReason },
      available: true,
    }],
  }
}

class FakeConnection implements OmpChildConnection {
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly notifications = new Map<string, (params: unknown) => void>()
  disposed = false
  activateVersion: number = OMP_RPC_PROTOCOL_VERSION
  activateCapabilities: unknown = OMP_RUNTIME_HOST_CAPABILITIES
  currentCatalog: unknown = catalog()
  beforeActivateReturn: (() => void) | undefined

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'session.activate') {
      const activationCatalog = this.currentCatalog
      this.beforeActivateReturn?.()
      return {
        protocolVersion: this.activateVersion,
        capabilities: this.activateCapabilities,
        diagnostics: { compositionRevision: 'effective-one' },
        runtimeRevision: 'effective-one',
        catalog: activationCatalog,
      }
    }
    if (method === 'tools.snapshot') return this.currentCatalog
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
  readonly configure: ((connection: FakeConnection) => void) | undefined
  readonly connections: FakeConnection[] = []

  constructor(configure?: (connection: FakeConnection) => void) {
    this.configure = configure
  }

  async start(): Promise<OmpChildConnection> {
    const connection = new FakeConnection()
    this.configure?.(connection)
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

  it('executes a generic serialized activation with the closed OMP capability profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-adapter-'))
    temporaryRoots.push(root)
    const descriptor = activation(root, 'portable-session', 'actor-one')
    const factory = new FakeFactory()
    const adapter = new OmpAdapterSession({ activation: descriptor, childFactory: factory })
    expect(await adapter.start()).toMatchObject({
      state: 'active',
      initializationAvailable: false,
      capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
      catalog: { tools: [{ approval: { policy: 'required', reason: 'Review this mutation' } }] },
    })
    expect(factory.connections).toHaveLength(1)
    expect(factory.connections[0]?.requests[0]).toEqual({
      method: 'session.activate',
      params: {
        protocolVersion: OMP_RPC_PROTOCOL_VERSION,
        capabilities: OMP_RUNTIME_HOST_CAPABILITIES,
        ...descriptor,
      },
    })
    await expect(adapter.dispose()).resolves.toEqual({ outcome: 'graceful', sessionDisposeAcknowledged: true })
  })

  it('keeps absent activation inactive and reports malformed or incompatible descriptors', async () => {
    const factory = new FakeFactory()
    const inactive = new OmpAdapterSession({ childFactory: factory })
    expect(await inactive.start()).toEqual({
      state: 'inactive', initializationAvailable: true, catalog: { revision: 'catalog:0', tools: [] },
    })
    expect(factory.connections).toHaveLength(0)

    const malformed = new OmpAdapterSession({
      activation: {
        ...activation('relative', 'invalid'),
        composition: { ...activation('relative', 'invalid').composition, loaderPath: 'relative/cordis.yaml' },
      },
      childFactory: factory,
    })
    expect(await malformed.start()).toMatchObject({ state: 'failed', diagnostic: { code: 'RUNTIME_START_FAILED' } })
    expect(factory.connections).toHaveLength(0)

    const invalidActor = new OmpAdapterSession({
      activation: {
        ...activation(join(process.cwd(), 'fixture'), 'invalid-actor'),
        hostExtensions: {
          ...activation(join(process.cwd(), 'fixture'), 'invalid-actor').hostExtensions,
          facts: { hostKind: 'omp', actorId: ' ' },
        },
      },
      childFactory: factory,
    })
    expect(await invalidActor.start()).toMatchObject({
      state: 'failed', diagnostic: { message: 'actorId must be a non-empty string' },
    })
    expect(factory.connections).toHaveLength(0)

    const incompatibleFactory = new FakeFactory(connection => { connection.activateVersion += 1 })
    const incompatible = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'incompatible'),
      childFactory: incompatibleFactory,
    })
    expect(await incompatible.start()).toMatchObject({ state: 'failed' })
    expect(incompatibleFactory.connections[0]?.disposed).toBe(true)

    const unknownCapabilityFactory = new FakeFactory(connection => {
      connection.activateCapabilities = { ...OMP_RUNTIME_HOST_CAPABILITIES, features: ['native-hook'] }
    })
    const unknownCapability = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'unknown-capability'),
      childFactory: unknownCapabilityFactory,
    })
    await expect(unknownCapability.start()).resolves.toMatchObject({
      state: 'failed', diagnostic: { message: expect.stringContaining('unsupported fields') },
    })

    const malformedApprovalFactory = new FakeFactory(connection => {
      connection.currentCatalog = catalog('catalog:1', 'tool:1', ' ')
    })
    const malformedApproval = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'malformed-approval'),
      childFactory: malformedApprovalFactory,
    })
    await expect(malformedApproval.start()).resolves.toMatchObject({
      state: 'failed', diagnostic: { message: expect.stringContaining('approval.reason') },
    })
    expect(malformedApprovalFactory.connections[0]?.disposed).toBe(true)
  })

  it('reconciles a catalog change received while session activation is still pending', async () => {
    const factory = new FakeFactory(connection => {
      connection.beforeActivateReturn = () => {
        connection.currentCatalog = catalog('catalog:2', 'tool:2')
        connection.notifications.get('toolCatalog.changed')?.({ revision: 'catalog:2' })
      }
    })
    const observed: string[] = []
    const adapter = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'startup-catalog-race'),
      childFactory: factory,
      onCatalogChanged: current => { observed.push(current.revision) },
    })

    await expect(adapter.start()).resolves.toMatchObject({
      state: 'active',
      catalog: { revision: 'catalog:2' },
    })
    expect(factory.connections[0]?.requests.map(request => request.method)).toEqual([
      'session.activate',
      'tools.snapshot',
    ])
    expect(observed).toEqual(['catalog:2'])
  })

  it('commits only the exact catalog revision named by the callback', async () => {
    const factory = new FakeFactory()
    const observed: string[] = []
    const adapter = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'catalog-revisions'),
      childFactory: factory,
      onCatalogChanged: current => { observed.push(current.revision) },
    })
    await adapter.start()
    const connection = factory.connections[0]!
    connection.currentCatalog = catalog('catalog:2', 'tool:2')
    connection.notifications.get('toolCatalog.changed')?.({ revision: 'catalog:2' })
    await vi.waitFor(() => expect(adapter.snapshot().catalog.revision).toBe('catalog:2'))

    connection.notifications.get('toolCatalog.changed')?.({ revision: 'catalog:1' })
    await new Promise(resolve => setImmediate(resolve))
    expect(adapter.snapshot().catalog.revision).toBe('catalog:2')
    expect(observed).toEqual(['catalog:1', 'catalog:2'])
  })
})
describe('OMP strict portable JSON admission', () => {
  it('rejects non-JSON descriptors and results without coercion', () => {
    const toJSON = vi.fn(() => ({ coerced: true }))
    expect(() => defineToolCatalogSnapshot({
      revision: 'catalog:1',
      tools: [{
        name: 'memory.search', label: 'Search', description: 'search', revision: 'tool:1', available: true,
        inputSchema: { type: 'object', bad: NaN, toJSON },
      }],
    })).toThrow('non-finite number')
    expect(toJSON).not.toHaveBeenCalled()
    expect(() => defineToolInvocationResult({ ok: true, value: { missing: undefined } }))
      .toThrow('tools.invoke result.value.missing must be JSON-compatible')
    expect(() => defineToolInvocationResult({ ok: true, value: { get secret() { throw new Error('executed') } } }))
      .toThrow('tools.invoke result.value.secret must not be an accessor')
    const symbol = Symbol('unsupported')
    expect(() => defineToolInvocationResult({ ok: true, value: { [symbol]: true } })).toThrow('symbol')
    const sparse = [1, , 3]
    expect(() => defineToolInvocationResult({ ok: true, value: sparse }))
      .toThrow('tools.invoke result.value must contain a dense JSON array without extra properties')
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => defineToolInvocationResult({ ok: true, value: cycle })).toThrow('cycles')
  })
  it('preserves exact valid JSON values through direct and transported invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-json-parity-'))
    temporaryRoots.push(root)
    const definition: ToolDefinition = {
      name: 'parity.echo', description: 'Echo exact JSON', approval: { policy: 'required' },
      inputSchema: { type: 'object', properties: { omitted: { type: 'array', default: [] } } },
      invoke: input => input,
    }
    await writeFile(join(root, 'echo.mjs'), `export default { name: 'parity-echo', inject: ['doppelgangerTools'], apply(ctx) { ctx.doppelgangerTools.register({ ...${JSON.stringify(definition)}, invoke: input => input }) } }`)
    await writeFile(join(root, 'runtime.cordis.yml'), JSON.stringify([
      { id: 'tools', name: '@doppelganger/doppelganger-protocols/tools', isolate: { doppelgangerTools: 'session' } },
      { id: 'echo', name: './echo.mjs', isolate: { doppelgangerTools: 'session' } },
    ]))
    const direct = new Context()
    const adapter = new OmpAdapterSession({ activation: activation(root, 'parity'), childFactory: new NodeOmpChildFactory({ childPath: fileURLToPath(new URL('../src/child.ts', import.meta.url)) }) })
    try {
      await direct.plugin(ToolRegistry)
      direct.doppelgangerTools.register(definition)
      expect((await adapter.start()).state).toBe('active')
      const input = { text: 'JSON: Ελληνικά 中文', array: [null, false, 0, 1.25, { nested: 'value' }], empty: {}, enabled: true }
      const requestFor = (revision: string) => ({ callId: 'parity-call', name: definition.name, toolRevision: revision, input, approval: { kind: 'one-shot' as const, grantId: 'parity-grant', callId: 'parity-call', toolRevision: revision, inputDigest: digestToolInput(input) } })
      const directResult = await direct.doppelgangerTools.invoke(requestFor(direct.doppelgangerTools.snapshot().tools[0]!.revision), 'parity')
      const transported = defineToolInvocationResult(await adapter.connection()!.request('tools.invoke', requestFor(adapter.snapshot().catalog.tools[0]!.revision)))
      expect(directResult).toEqual({ ok: true, value: input })
      expect(transported).toEqual(directResult)
      if (!transported.ok) throw new Error(transported.error.message)
      expect(transported.value).not.toHaveProperty('omitted')
      expect(digestToolInput(transported.value)).toBe(digestToolInput(input))
    } finally {
      await adapter.dispose()
      await direct.fiber.dispose()
    }
  })
})
