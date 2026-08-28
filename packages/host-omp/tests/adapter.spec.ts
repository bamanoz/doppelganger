import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OMP_RPC_PROTOCOL_VERSION,
  OmpAdapterSession,
  discoverProjectManifest,
  type OmpChildConnection,
  type OmpChildFactory,
  type SerializedCompositionActivation,
} from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FakeConnection implements OmpChildConnection {
  readonly requests: Array<{ method: string; params: unknown }> = []
  readonly notifications = new Map<string, (params: unknown) => void>()
  disposed = false
  activateVersion: number = OMP_RPC_PROTOCOL_VERSION

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'session.activate') return {
      protocolVersion: this.activateVersion,
      diagnostics: {},
      tools: [{
        name: 'memory.search',
        description: 'search',
        inputSchema: { type: 'object' },
        available: true,
      }],
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
  readonly connections: FakeConnection[] = []

  constructor(activateVersion?: number) {
    this.activateVersion = activateVersion
  }

  async start(): Promise<OmpChildConnection> {
    const connection = new FakeConnection()
    if (this.activateVersion !== undefined) connection.activateVersion = this.activateVersion
    this.connections.push(connection)
    return connection
  }
}

function activation(root: string, sessionId: string): SerializedCompositionActivation {
  return {
    composition: {
      id: 'portable-persona',
      revision: 'one',
      loaderPath: join(root, 'cordis.yaml'),
      imports: {},
      mounts: { persona: { target: 'session', required: true }, host: { target: 'session', required: true } },
    },
    sessionId,
    mounts: {
      persona: {
        module: '@doppelganger/extension-persona',
        exportName: 'createPersonaActivationPlugin',
        mode: 'factory' as const,
        config: { instanceId: 'portable', principalId: 'local-user', sessionId },
      },
    },
    hostMount: 'host',
    watch: false,
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
    await writeFile(nearest, 'version: 1\nprojectId: nearest\ninstanceId: aiden\n')
    expect(await discoverProjectManifest(nested)).toBe(nearest)

    await rm(nearest)
    const outside = join(outer, '.doppelganger', 'manifest.yaml')
    await mkdir(join(outer, '.doppelganger'), { recursive: true })
    await writeFile(outside, 'version: 1\nprojectId: outside\ninstanceId: aiden\n')
    expect(await discoverProjectManifest(nested)).toBeUndefined()
  })

  it('executes a generic serialized activation without preset assembly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-adapter-'))
    temporaryRoots.push(root)
    const descriptor = activation(root, 'portable-session')
    const factory = new FakeFactory()
    const adapter = new OmpAdapterSession({ activation: descriptor, childFactory: factory })
    expect(await adapter.start()).toMatchObject({ state: 'active', initializationAvailable: false })
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

    const incompatibleFactory = new FakeFactory(OMP_RPC_PROTOCOL_VERSION + 1)
    const incompatible = new OmpAdapterSession({
      activation: activation(join(process.cwd(), 'fixture'), 'incompatible'),
      childFactory: incompatibleFactory,
    })
    expect(await incompatible.start()).toMatchObject({ state: 'failed' })
    expect(incompatibleFactory.connections[0]?.disposed).toBe(true)
  })
})
