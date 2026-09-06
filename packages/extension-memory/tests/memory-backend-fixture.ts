import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  ContextProtocol,
  LIFECYCLE_PROTOCOL_VERSION,
  ToolRegistry,
  createActorIdentityPlugin,
  publishLifecycleEvent,
  serializeLifecycleValue,
} from '@doppelganger/doppelganger-protocols'
import {
  MemoryProtocolPlugin,
  MemoryService,
  createMemoryCapturePlugin,
  type MemorySemanticRetriever,
  type MemoryServiceConfig,
} from '../src/index.ts'
import { openMemoryDatabase, type MemoryDatabase } from '../src/persistence/database.ts'
import { createMemoryRepository } from '../src/persistence/repository.ts'
import type { MemoryApi } from '../src/repository.ts'
import {
  createPostgresqlFixture,
  type PostgresqlFixture,
} from './postgresql-fixture.ts'

export type MemoryBackendKind = 'sqlite' | 'postgresql'

export interface MemoryBackendSessionOptions {
  readonly actorId?: string
  readonly sessionId?: string
  readonly projectId?: string | null
  readonly instanceId?: string
  readonly now?: () => Date
  readonly id?: () => string
  readonly memoryConfig?: Omit<MemoryServiceConfig, 'now' | 'id'>
  readonly semantic?: MemorySemanticRetriever
  readonly capture?: boolean
}

export interface MemoryBackendSession {
  readonly context: Context
  readonly memory: MemoryApi
  readonly database: MemoryDatabase
  readonly tools: Context['doppelgangerTools']
  emitCommittedTurn(input: {
    readonly deliveryId: string
    readonly turnId: string
    readonly principalInput: string
    readonly assistantOutput: string
  }): Promise<void>
  dispose(): Promise<void>
}

export interface MemoryBackendFixture {
  readonly kind: MemoryBackendKind
  readonly sqliteHome?: string
  readonly postgresql?: PostgresqlFixture
  createSession(options?: MemoryBackendSessionOptions): Promise<MemoryBackendSession>
  close(): Promise<void>
}

interface FixtureState {
  readonly kind: MemoryBackendKind
  readonly sqliteHome?: string
  readonly postgresql?: PostgresqlFixture
  readonly connectionStringEnv?: string
  readonly sessions: Set<MemoryBackendSession>
  closed: boolean
}

function providerConfig(state: FixtureState) {
  if (state.kind === 'sqlite') {
    return { kind: 'sqlite' as const, home: state.sqliteHome!, namespace: 'memory', busyTimeoutMs: 5_000 }
  }
  const config = state.postgresql!.config
  return {
    kind: 'postgresql' as const,
    connectionStringEnv: state.connectionStringEnv ?? config.connectionStringEnv,
    schema: config.schema,
    poolSize: config.poolSize,
    connectionTimeoutMs: config.connectionTimeoutMs,
    statementTimeoutMs: config.statementTimeoutMs,
    lockTimeoutMs: config.lockTimeoutMs,
  }
}

async function createSession(
  state: FixtureState,
  options: MemoryBackendSessionOptions = {},
): Promise<MemoryBackendSession> {
  if (state.closed) throw new Error('memory backend fixture is closed')
  const actorId = options.actorId ?? 'backend-actor'
  const sessionId = options.sessionId ?? `backend-${state.kind}-session`
  const projectId = options.projectId === undefined ? 'backend-project' : options.projectId
  const instanceId = options.instanceId ?? 'backend-persona'
  const context = new Context()
  let database: MemoryDatabase | undefined
  try {
    await context.plugin(createPersonaActivationPlugin({
      instanceId,
      sessionId,
      ...(projectId === null ? {} : {
        projectId,
        projectRoot: join(state.sqliteHome ?? tmpdir(), projectId),
      }),
    })).await()
    await context.plugin(createActorIdentityPlugin(actorId)).await()
    await context.plugin(ContextProtocol).await()
    await context.plugin(ToolRegistry).await()
    if (options.semantic !== undefined) {
      const semantic = options.semantic
      const provider: Plugin = {
        name: `memory-backend-semantic-${sessionId}`,
        apply(ctx) {
          ctx.provide('doppelgangerMemorySemantic', semantic)
        },
      }
      await context.plugin(provider).await()
    }

    database = await openMemoryDatabase(providerConfig(state), actorId)
    const repository = createMemoryRepository(database)
    context.provide('doppelgangerMemoryRepository', repository)
    await context.plugin(MemoryService, {
      ...options.memoryConfig,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.id === undefined ? {} : { id: options.id }),
    }).await()
    await context.plugin(MemoryProtocolPlugin).await()
    if (options.capture === true) await context.plugin(createMemoryCapturePlugin({ enabled: true })).await()

    let disposed = false
    let session!: MemoryBackendSession
    session = {
      context,
      memory: context.doppelgangerMemory,
      database,
      tools: context.doppelgangerTools,
      async emitCommittedTurn(input) {
        await publishLifecycleEvent(context, {
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'turn-committed',
          deliveryId: input.deliveryId,
          sessionId,
          turnId: input.turnId,
          timestamp: Date.now(),
          principalInput: serializeLifecycleValue(input.principalInput),
          assistantOutput: serializeLifecycleValue(input.assistantOutput),
          outcome: 'completed',
        })
      },
      async dispose() {
        if (disposed) return
        disposed = true
        state.sessions.delete(session)
        await context.fiber.dispose()
        await repository.close()
      },
    }
    state.sessions.add(session)
    return session
  } catch (error) {
    await context.fiber.dispose().catch(() => undefined)
    await database?.close().catch(() => undefined)
    throw error
  }
}

export async function createMemoryBackendFixture(
  kind: MemoryBackendKind,
  options: { readonly postgresqlFixture?: PostgresqlFixture; readonly connectionStringEnv?: string } = {},
): Promise<MemoryBackendFixture> {
  const sqliteHome = kind === 'sqlite'
    ? await mkdtemp(join(tmpdir(), 'doppelganger-memory-backend-'))
    : undefined
  const postgresql = kind === 'postgresql'
    ? options.postgresqlFixture ?? await createPostgresqlFixture()
    : undefined
  const state: FixtureState = {
    kind,
    ...(sqliteHome === undefined ? {} : { sqliteHome }),
    ...(postgresql === undefined ? {} : { postgresql }),
    ...(options.connectionStringEnv === undefined ? {} : { connectionStringEnv: options.connectionStringEnv }),
    sessions: new Set(),
    closed: false,
  }
  let closePromise: Promise<void> | undefined
  return {
    kind,
    ...(sqliteHome === undefined ? {} : { sqliteHome }),
    ...(postgresql === undefined ? {} : { postgresql }),
    createSession: sessionOptions => createSession(state, sessionOptions),
    close() {
      closePromise ??= (async () => {
        state.closed = true
        const results = await Promise.allSettled([...state.sessions].reverse().map(session => session.dispose()))
        const rejected = results.find(result => result.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
        await postgresql?.close()
        if (sqliteHome !== undefined) await rm(sqliteHome, { recursive: true, force: true })
      })()
      return closePromise
    },
  }
}
