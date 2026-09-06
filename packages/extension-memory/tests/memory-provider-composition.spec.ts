import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { ContextProtocol, ToolRegistry, createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { describe, expect, it } from 'vitest'
import { MemoryPlugin, MemoryService, PostgresqlMemoryPlugin, SqliteMemoryPlugin, type MemoryRepository } from '../src/index.ts'
import { openMemoryDatabase, type MemoryDatabase } from '../src/persistence/database.ts'
import { activateMemoryRepository } from '../src/persistence/provider.ts'
import { createPostgresqlFixture, type PostgresqlFixture } from './postgresql-fixture.ts'

interface CompositionFixture {
  readonly context: Context
  readonly home: string
  readonly postgresql?: PostgresqlFixture
  close(): Promise<void>
}

interface ReloadableMemoryProviderConfig {
  readonly generation: 'stable' | 'candidate'
  readonly home: string
}

async function composition(kind: 'sqlite' | 'postgresql'): Promise<CompositionFixture> {
  const home = await mkdtemp(join(tmpdir(), `doppelganger-memory-composition-${kind}-`))
  const postgresql = kind === 'postgresql' ? await createPostgresqlFixture() : undefined
  const context = new Context()
  try {
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'composition-persona',
      sessionId: `composition-${kind}`,
      projectId: 'composition-project',
      projectRoot: join(home, 'composition-project'),
    })).await()
    await context.plugin(createActorIdentityPlugin('composition-actor')).await()
    await context.plugin(ContextProtocol).await()
    await context.plugin(ToolRegistry).await()
    if (kind === 'sqlite') await context.plugin(SqliteMemoryPlugin, { home }).await()
    else await context.plugin(PostgresqlMemoryPlugin, postgresql!.config).await()
    await context.plugin(MemoryPlugin, {}).await()
    return {
      context,
      home,
      ...(postgresql === undefined ? {} : { postgresql }),
      async close() {
        await context.fiber.dispose()
        await postgresql?.close()
        await rm(home, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await context.fiber.dispose()
    await postgresql?.close()
    await rm(home, { recursive: true, force: true })
    throw error
  }
}

describe('memory provider composition', () => {
  it('reports a missing selected canonical repository provider', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-missing-provider-'))
    const context = new Context()
    try {
      await context.plugin(createPersonaActivationPlugin({ instanceId: 'composition-persona', sessionId: 'missing-provider' })).await()
      await context.plugin(createActorIdentityPlugin('composition-actor')).await()
      await context.plugin(ContextProtocol).await()
      await context.plugin(ToolRegistry).await()
      const memory = context.plugin(MemoryPlugin, {})
      expect(memory.state).toBe(0)
      expect(Object.keys(memory.inject)).toContain('doppelgangerMemoryRepository')
      expect(context.get('doppelgangerMemory')).toBeUndefined()
      expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    } finally {
      await context.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('activates host-bound memory with either canonical repository provider', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const fixture = await composition(kind)
      try {
        const record = await fixture.context.doppelgangerMemory.remember({
          operationId: `host-bound-${kind}`,
          subjectKey: 'project.host.bound',
          kind: 'fact',
          content: 'Memory derives its actor from the host service.',
        })
        expect(record).toMatchObject({
          instanceId: 'composition-persona',
          actorId: 'composition-actor',
          scope: { kind: 'project', projectId: 'composition-project' },
        })
      } finally {
        await fixture.close()
      }
    }
  })

  it('activates the complete memory surface with either canonical provider', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const fixture = await composition(kind)
      try {
        const tools = fixture.context.doppelgangerTools.snapshot().tools.map(tool => tool.name)
        expect(tools).toEqual([
          'memory.candidates.approve',
          'memory.candidates.corroborate',
          'memory.candidates.list',
          'memory.candidates.propose',
          'memory.candidates.reject',
          'memory.conflicts.list',
          'memory.conflicts.resolve',
          'memory.correct',
          'memory.evidence.list',
          'memory.evidence.observe',
          'memory.forget',
          'memory.history',
          'memory.inspect',
          'memory.pin',
          'memory.remember',
          'memory.search',
          'memory.unpin',
        ])
        const record = await fixture.context.doppelgangerMemory.remember({
          operationId: `complete-surface-${kind}`,
          subjectKey: 'preference.complete.surface',
          kind: 'preference',
          content: 'Prefer complete provider evidence.',
          scope: 'relationship',
        })
        await fixture.context.doppelgangerMemory.pin({ operationId: `complete-pin-${kind}`, id: record.id, pinned: true })
        const assembled = await fixture.context.doppelgangerContext.resolve({ turn: { input: 'unrelated query' }, tokenBudget: 100 })
        expect(assembled.contributions).toEqual([
          expect.objectContaining({ source: `memory.${record.id}`, authority: 'instruction' }),
        ])
      } finally {
        await fixture.close()
      }
    }
  })

  it('rejects unbound actors before either canonical provider opens storage', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-unbound-provider-'))
    const environmentName = 'DOPPELGANGER_MEMORY_TEST_UNBOUND_DSN'
    const previous = process.env[environmentName]
    delete process.env[environmentName]
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const context = new Context()
      try {
        await context.plugin(createActorIdentityPlugin()).await()
        const provider = kind === 'sqlite'
          ? context.plugin(SqliteMemoryPlugin, { home })
          : context.plugin(PostgresqlMemoryPlugin, { connectionStringEnv: environmentName, schema: 'memory_unbound_actor' })
        await expect(provider.await()).rejects.toThrow('bound host actor')
        expect(context.get('doppelgangerMemoryRepository')).toBeUndefined()
      } finally {
        await context.fiber.dispose()
      }
    }
    try {
      await expect(access(join(home, 'storage'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (previous === undefined) delete process.env[environmentName]
      else process.env[environmentName] = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('remains inert when memory and repository providers are omitted', async () => {
    const context = new Context()
    try {
      await context.plugin(ContextProtocol).await()
      await context.plugin(ToolRegistry).await()
      expect(context.get('doppelgangerMemory')).toBeUndefined()
      expect(context.get('doppelgangerMemoryRepository')).toBeUndefined()
      expect(context.doppelgangerTools.snapshot().tools).toEqual([])
      expect((await context.doppelgangerContext.resolve({ turn: { input: 'memory' }, tokenBudget: 100 })).contributions).toEqual([])
    } finally {
      await context.fiber.dispose()
    }
  })

  it('retains the audited provider generation when a late reload candidate fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-memory-provider-reload-'))
    const stableHome = join(root, 'stable')
    const candidateHome = join(root, 'candidate')
    const context = new Context()
    const candidateReady = Promise.withResolvers<MemoryDatabase>()
    const releaseCandidate = Promise.withResolvers<void>()
    const closeCalls: Record<string, number> = {}
    const openings: Record<string, number> = {}
    let candidateDatabase: MemoryDatabase | undefined
    const provider: Plugin<ReloadableMemoryProviderConfig> = {
      name: 'reloadable-memory-provider',
      inject: ['doppelgangerActor'],
      async apply(ctx: Context, config: ReloadableMemoryProviderConfig) {
        const application = (openings[config.generation] ?? 0) + 1
        openings[config.generation] = application
        const owner = `${config.generation}-${application}`
        await activateMemoryRepository(ctx, { kind: 'sqlite', home: config.home }, async (databaseConfig, actorId) => {
          const database = await openMemoryDatabase(databaseConfig, actorId)
          const close = database.close.bind(database)
          Object.defineProperty(database, 'close', {
            value: () => {
              closeCalls[owner] = (closeCalls[owner] ?? 0) + 1
              return close()
            },
          })
          if (config.generation === 'candidate') {
            candidateDatabase = database
            candidateReady.resolve(database)
            await releaseCandidate.promise
          }
          return database
        })
        if (config.generation === 'candidate') throw new Error('candidate repository activation rejected')
      },
    }
    try {
      await context.plugin(createPersonaActivationPlugin({
        instanceId: 'composition-persona',
        sessionId: 'provider-reload',
        projectId: 'composition-project',
        projectRoot: root,
      })).await()
      await context.plugin(createActorIdentityPlugin('composition-actor')).await()
      await context.plugin(Loader, {}).await()
      context.loader.builtins.memoryProvider = provider
      const entryId = await context.loader.create({
        name: 'cordis:memoryProvider',
        config: { generation: 'stable', home: stableHome },
      })
      const memory = context.plugin(MemoryService, {})
      await memory.await()
      const sentinel = await context.doppelgangerMemory.remember({
        operationId: 'provider-reload-sentinel',
        subjectKey: 'project.provider.reload',
        kind: 'fact',
        content: 'The audited provider generation remains canonical.',
      })
      const previousRepository = context.get('doppelgangerMemoryRepository') as MemoryRepository

      const reload = context.loader.update(entryId, {
        config: { generation: 'candidate', home: candidateHome },
      })
      const lateCandidate = await candidateReady.promise
      expect(lateCandidate).toBe(candidateDatabase)
      expect(context.get('doppelgangerMemoryRepository')).toBeUndefined()
      releaseCandidate.resolve()
      await expect(reload).rejects.toThrow('candidate repository activation rejected')
      await context.loader.await()
      await memory.await()
      expect(closeCalls).toMatchObject({ 'stable-1': 1, 'candidate-1': 1 })
      expect(closeCalls['stable-2'] ?? 0).toBe(0)
      await expect(previousRepository.getRecord(
        { instanceId: 'composition-persona', actorId: 'composition-actor', projectId: 'composition-project' },
        sentinel.id,
        new Date().toISOString(),
      )).rejects.toMatchObject({ code: 'MEMORY_STORAGE_CLOSED' })
      await expect(lateCandidate.read(async () => true)).rejects.toMatchObject({ code: 'MEMORY_STORAGE_CLOSED' })
      const restoredRepository = context.get('doppelgangerMemoryRepository') as MemoryRepository | undefined
      expect(restoredRepository).toBeDefined()
      expect((await restoredRepository!.getRecord(
        { instanceId: 'composition-persona', actorId: 'composition-actor', projectId: 'composition-project' },
        sentinel.id,
        new Date().toISOString(),
      ))?.revision.id).toBe(sentinel.revision.id)
      expect((await context.doppelgangerMemory.inspect(sentinel.id)).revision.id).toBe(sentinel.revision.id)

      await context.fiber.dispose()
      expect(closeCalls['stable-2']).toBe(1)
    } finally {
      releaseCandidate.resolve()
      await context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
