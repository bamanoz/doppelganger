import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  ContextProtocol,
  LIFECYCLE_PROTOCOL_VERSION,
  ToolRegistry,
  createActorIdentityPlugin,
  publishLifecycleEvent,
  serializeLifecycleValue,
} from '@doppelganger/doppelganger-protocols'
import { describe, expect, it } from 'vitest'
import {
  MemoryPlugin,
  PostgresqlMemoryPlugin,
  SqliteMemoryPlugin,
  createMemoryCapturePlugin,
  type MemoryRepository,
} from '../src/index.ts'
import { openMemoryDatabase, type MemoryDatabase } from '../src/persistence/database.ts'
import { resolvePostgresqlConnection } from '../src/persistence/config.ts'
import { activateMemoryRepository } from '../src/persistence/provider.ts'
import { assertDetachedResults } from './memory-backend-assertions.ts'
import { createMemoryBackendFixture } from './memory-backend-fixture.ts'
import { createPostgresqlFixture } from './postgresql-fixture.ts'

async function dependencies(context: Context, home: string, actorId = 'backend-actor'): Promise<void> {
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'backend-persona',
    sessionId: 'backend-provider-session',
    projectId: 'backend-project',
    projectRoot: join(home, 'backend-project'),
  })).await()
  await context.plugin(createActorIdentityPlugin(actorId)).await()
  await context.plugin(ContextProtocol).await()
  await context.plugin(ToolRegistry).await()
}

async function publicProvider(kind: 'sqlite' | 'postgresql') {
  const home = await mkdtemp(join(tmpdir(), `doppelganger-memory-${kind}-provider-`))
  const postgresql = kind === 'postgresql' ? await createPostgresqlFixture() : undefined
  const context = new Context()
  await dependencies(context, home)
  if (kind === 'sqlite') await context.plugin(SqliteMemoryPlugin, { home }).await()
  else await context.plugin(PostgresqlMemoryPlugin, postgresql!.config).await()
  await context.plugin(MemoryPlugin, {}).await()
  await context.plugin(createMemoryCapturePlugin({ enabled: true })).await()
  return {
    home,
    postgresql,
    context,
    async close() {
      await context.fiber.dispose()
      await postgresql?.close()
      await rm(home, { recursive: true, force: true })
    },
  }
}

async function assertPublicProviderActivation(kind: 'sqlite' | 'postgresql'): Promise<void> {
  const fixture = await publicProvider(kind)
  try {
    const record = await fixture.context.doppelgangerMemory.remember({
      operationId: `provider-activation-${kind}`,
      subjectKey: 'project.provider.activation',
      kind: 'fact',
      content: `The ${kind} provider owns canonical memory.`,
    })
    expect((await fixture.context.doppelgangerMemory.search({ query: `${kind} canonical`, tokenBudget: 100 }))[0]?.record.id).toBe(record.id)
    expect(fixture.context.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toContain('memory.remember')
    await publishLifecycleEvent(fixture.context, {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-committed',
      deliveryId: `provider-activation-delivery-${kind}`,
      sessionId: 'backend-provider-session',
      turnId: `provider-activation-turn-${kind}`,
      timestamp: Date.now(),
      principalInput: serializeLifecycleValue('[fact:project.provider.capture] Provider capture is durable.'),
      assistantOutput: serializeLifecycleValue('Acknowledged.'),
      outcome: 'completed',
    })
    expect(await fixture.context.doppelgangerMemory.listCandidates()).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectKey: 'project.provider.capture', status: 'candidate' }),
    ]))
  } finally {
    await fixture.close()
  }
}

describe('canonical memory repository providers', () => {
  it('activates SQLite as a complete canonical provider', async () => {
    await assertPublicProviderActivation('sqlite')
  })

  it('activates PostgreSQL as a complete canonical provider', async () => {
    await assertPublicProviderActivation('postgresql')
  })

  it('preserves the configured SQLite home and default memory namespace', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-location-'))
    const context = new Context()
    try {
      await dependencies(context, home)
      await context.plugin(SqliteMemoryPlugin, { home }).await()
      await context.plugin(MemoryPlugin, {}).await()
      await context.doppelgangerMemory.remember({
        operationId: 'location-remember',
        subjectKey: 'project.location.contract',
        kind: 'fact',
        content: 'The canonical database retains its location.',
      })
      await expect(access(join(home, 'storage', 'memory.sqlite'))).resolves.toBeUndefined()
    } finally {
      await context.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('rejects duplicate canonical providers in one realm', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-duplicate-'))
    const postgresql = await createPostgresqlFixture()
    const context = new Context()
    try {
      await dependencies(context, home)
      await context.plugin(SqliteMemoryPlugin, { home }).await()
      const duplicate = context.plugin(PostgresqlMemoryPlugin, postgresql.config)
      await expect(duplicate.await()).rejects.toThrow(/doppelgangerMemoryRepository|already provided/i)
      expect(context.get('doppelgangerMemory')).toBeUndefined()
    } finally {
      await context.fiber.dispose()
      await postgresql.close()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('does not create SQLite state when PostgreSQL initialization fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-no-fallback-'))
    const environmentName = 'DOPPELGANGER_MEMORY_TEST_UNREACHABLE_DSN'
    const previous = process.env[environmentName]
    process.env[environmentName] = 'postgresql://memory_test:do-not-expose@127.0.0.1:1/memory_test?sslmode=disable'
    const context = new Context()
    try {
      await dependencies(context, home)
      const provider = context.plugin(PostgresqlMemoryPlugin, {
        connectionStringEnv: environmentName,
        schema: 'memory_no_fallback',
        poolSize: 1,
        connectionTimeoutMs: 20,
        statementTimeoutMs: 20,
        lockTimeoutMs: 20,
      })
      await expect(provider.await()).rejects.toBeDefined()
      await expect(access(join(home, 'storage'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(context.get('doppelgangerMemoryRepository')).toBeUndefined()
    } finally {
      await context.fiber.dispose()
      if (previous === undefined) delete process.env[environmentName]
      else process.env[environmentName] = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('returns detached JSON-compatible results from both repositories', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const fixture = await createMemoryBackendFixture(kind)
      try {
        await assertDetachedResults(fixture)
      } finally {
        await fixture.close()
      }
    }
  })

  it('rejects invalid indirect PostgreSQL credentials without exposing secret values', async () => {
    const secret = 'postgresql://memory_test:credential-marker@127.0.0.1:1/memory_test?sslmode=disable'
    const environmentName = 'DOPPELGANGER_MEMORY_TEST_INVALID_DSN'
    const previous = process.env[environmentName]
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-credential-'))
    const missing = new Context()
    const invalid = new Context()
    try {
      delete process.env[environmentName]
      await dependencies(missing, home)
      const missingProvider = missing.plugin(PostgresqlMemoryPlugin, {
        connectionStringEnv: environmentName,
        schema: 'memory_missing_credential',
      })
      const missingError = await missingProvider.await().then(() => undefined, error => error)
      expect(String(missingError)).not.toContain(secret)

      process.env[environmentName] = secret
      await dependencies(invalid, home)
      const invalidProvider = invalid.plugin(PostgresqlMemoryPlugin, {
        connectionStringEnv: environmentName,
        schema: 'memory_invalid_credential',
        poolSize: 1,
        connectionTimeoutMs: 20,
      })
      const invalidError = await invalidProvider.await().then(() => undefined, error => error)
      expect(String(invalidError)).not.toContain('credential-marker')
      expect(JSON.stringify(invalidError)).not.toContain('credential-marker')

      for (const unsafe of [
        'postgresql://memory_test:credential-marker@db.example.test/memory_test?sslmode=verify-full&sslmode=disable',
        'postgresql://memory_test:credential-marker@localhost/memory_test?host=remote.example.test',
        'postgresql://memory_test:credential-marker@db.example.test/memory_test?statement_timeout=0',
      ]) {
        process.env[environmentName] = unsafe
        expect(() => resolvePostgresqlConnection({
          kind: 'postgresql',
          connectionStringEnv: environmentName,
          schema: 'memory_connection_policy',
        })).toThrow('invalid or unsafe')
      }

      process.env[environmentName] = 'postgresql://memory_test:credential-marker@db.example.test/memory_test?application_name=doppelganger'
      const verifiedRemote = new URL(resolvePostgresqlConnection({
        kind: 'postgresql',
        connectionStringEnv: environmentName,
        schema: 'memory_connection_policy',
      }))
      expect(verifiedRemote.hostname).toBe('db.example.test')
      expect(verifiedRemote.searchParams.get('sslmode')).toBe('verify-full')

      process.env[environmentName] = 'postgresql://memory_test:credential-marker@db.example.test/memory_test?sslmode=disable'
      const explicitlyDisabled = new URL(resolvePostgresqlConnection({
        kind: 'postgresql',
        connectionStringEnv: environmentName,
        schema: 'memory_connection_policy',
      }))
      expect(explicitlyDisabled.searchParams.get('sslmode')).toBe('disable')
      expect(explicitlyDisabled.toString()).not.toContain('statement_timeout')
    } finally {
      await invalid.fiber.dispose()
      await missing.fiber.dispose()
      if (previous === undefined) delete process.env[environmentName]
      else process.env[environmentName] = previous
      await rm(home, { recursive: true, force: true })
    }
  })

  it('closes late repository initialization candidates exactly once', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-memory-late-provider-'))
    const context = new Context()
    const candidateReady = Promise.withResolvers<MemoryDatabase>()
    const release = Promise.withResolvers<void>()
    let closeCalls = 0
    try {
      await context.plugin(createActorIdentityPlugin('backend-actor')).await()
      const provider = context.plugin({
        name: 'late-memory-provider',
        inject: ['doppelgangerActor'],
        apply(ctx) {
          return activateMemoryRepository(ctx, { kind: 'sqlite', home }, async (config, actorId) => {
            const database = await openMemoryDatabase(config, actorId)
            const close = database.close.bind(database)
            Object.defineProperty(database, 'close', {
              value: () => {
                closeCalls += 1
                return close()
              },
            })
            candidateReady.resolve(database)
            await release.promise
            return database
          })
        },
      })
      const database = await candidateReady.promise
      const disposal = provider.dispose()
      release.resolve()
      await expect(provider.await()).rejects.toBeDefined()
      await disposal
      expect(closeCalls).toBe(1)
      await expect(database.read(async () => true)).rejects.toMatchObject({ code: 'MEMORY_STORAGE_CLOSED' })
      expect(context.get('doppelgangerMemoryRepository')).toBeUndefined()
    } finally {
      release.resolve()
      await context.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('settles operations and closes both repository implementations on disposal', async () => {
    for (const kind of ['sqlite', 'postgresql'] as const) {
      const owned = await publicProvider(kind)
      const repository = owned.context.get('doppelgangerMemoryRepository') as MemoryRepository
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const pending = repository.transaction({ instanceId: 'backend-persona', actorId: 'backend-actor', projectId: 'backend-project' }, async () => {
        entered.resolve()
        await release.promise
        return 'settled'
      })
      await entered.promise
      const disposing = owned.context.fiber.dispose()
      release.resolve()
      expect(await pending).toBe('settled')
      await disposing
      await expect(repository.getRecord({ instanceId: 'backend-persona', actorId: 'backend-actor' }, 'missing', new Date().toISOString()))
        .rejects.toMatchObject({ code: 'MEMORY_STORAGE_CLOSED' })
      await owned.postgresql?.close()
      await rm(owned.home, { recursive: true, force: true })
    }
  })
})
