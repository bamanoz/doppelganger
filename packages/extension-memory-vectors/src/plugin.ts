import type { Context, Plugin } from '@deepseek-ai/cordis'
import { ToolInvocationError, type JsonValue } from '@doppelganger/doppelganger-protocols'
import Schema from '@deepseek-ai/schemastery'
import {
  MEMORY_SEMANTIC_SERVICE,
  MEMORY_VECTOR_INDEX_SERVICE,
} from '@doppelganger/doppelganger-memory'
import { MemoryVectorCoordinator, type MemoryVectorCoordinatorConfig } from './coordinator.ts'
import { createSQLiteExactMemoryVectorIndex, type SQLiteExactConfig } from './sqlite-exact.ts'

export type SQLiteExactVectorPluginConfig = SQLiteExactConfig

export const SQLiteExactVectorPluginConfigSchema: Schema<SQLiteExactVectorPluginConfig> = Schema.object({
  databasePath: Schema.string().min(1).max(4_096).required(),
  namespace: Schema.string().min(1).max(256),
  dimensions: Schema.natural().min(1).max(65_536).required(),
  configFingerprint: Schema.string().pattern(/^[a-f0-9]{64}$/),
  sanitizedTarget: Schema.string().min(1).max(512),
  busyTimeoutMs: Schema.natural().min(1).max(60_000),
})

export const MemoryVectorCoordinatorPluginConfigSchema: Schema<MemoryVectorCoordinatorConfig> = Schema.object({
  instanceId: Schema.string().min(1).max(256),
  pollIntervalMs: Schema.natural().min(1).max(60_000),
  batchSize: Schema.natural().min(1).max(128),
  maximumAttempts: Schema.natural().min(1).max(100),
  retryBaseMs: Schema.natural().min(1).max(60_000),
  operationTimeoutMs: Schema.natural().min(1).max(120_000),
})
const emptyInputSchema = Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false })
const maintenanceKinds = ['build-index', 'cleanup-generation', 'compact', 'reindex'] as const

function inputRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolInvocationError('INVALID_INPUT', 'semantic operation input must be an object')
  }
  return value as Readonly<Record<string, JsonValue>>
}

function operationFailure(): ToolInvocationError {
  return new ToolInvocationError('SEMANTIC_OPERATION_FAILED', 'semantic operation failed; inspect semantic status for sanitized diagnostics')
}

function registerCoordinatorTools(ctx: Context, coordinator: MemoryVectorCoordinator): void {
  ctx.doppelgangerTools.register({
    name: 'memory.semantic.status',
    description: 'Report sanitized semantic retrieval identity, generation, health, lag, and maintenance capabilities.',
    inputSchema: emptyInputSchema,
    invoke: async () => await coordinator.status() as unknown as JsonValue,
  })
  ctx.doppelgangerTools.register({
    name: 'memory.semantic.rebuild',
    description: 'Rebuild the configured semantic generation and atomically activate it after verification.',
    inputSchema: emptyInputSchema,
    invoke: async () => {
      try { await coordinator.rebuild() } catch { throw operationFailure() }
      return await coordinator.status() as unknown as JsonValue
    },
  })
  ctx.doppelgangerTools.register({
    name: 'memory.semantic.rollback',
    description: 'Atomically reactivate a retained semantic generation compatible with the configured vector space.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({ generationId: Object.freeze({ type: 'string', minLength: 1, maxLength: 256 }) }),
      required: Object.freeze(['generationId']),
      additionalProperties: false,
    }),
    invoke: async input => {
      const generationId = inputRecord(input).generationId
      if (typeof generationId !== 'string' || generationId.length === 0 || generationId.length > 256) {
        throw new ToolInvocationError('INVALID_INPUT', 'generationId must be a bounded string')
      }
      try { await coordinator.rollback(generationId) } catch { throw operationFailure() }
      return await coordinator.status() as unknown as JsonValue
    },
  })
  ctx.doppelgangerTools.register({
    name: 'memory.semantic.maintenance',
    description: 'Run one maintenance operation declared by the active semantic backend.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({ kind: Object.freeze({ type: 'string', enum: Object.freeze([...maintenanceKinds]) }) }),
      required: Object.freeze(['kind']),
      additionalProperties: false,
    }),
    invoke: async input => {
      const kind = inputRecord(input).kind
      if (typeof kind !== 'string' || !maintenanceKinds.includes(kind as typeof maintenanceKinds[number])) {
        throw new ToolInvocationError('INVALID_INPUT', 'kind is not a supported semantic maintenance operation')
      }
      try { return await coordinator.maintenance(kind as typeof maintenanceKinds[number]) as unknown as JsonValue } catch { throw operationFailure() }
    },
  })
}

export const SQLiteExactVectorPlugin: Plugin<SQLiteExactVectorPluginConfig> = {
  name: 'doppelganger-memory-vectors-sqlite-exact',
  Config: SQLiteExactVectorPluginConfigSchema as unknown as NonNullable<Plugin<SQLiteExactVectorPluginConfig>['Config']>,
  provide: MEMORY_VECTOR_INDEX_SERVICE,
  async apply(ctx: Context, config: SQLiteExactVectorPluginConfig) {
    const index = await createSQLiteExactMemoryVectorIndex(config)
    ctx.provide(MEMORY_VECTOR_INDEX_SERVICE, index)
    ctx.effect(() => async () => { await index.close() }, 'doppelgangerMemoryVectors.sqliteExact.close')
  },
}

export const MemoryVectorCoordinatorPlugin: Plugin<MemoryVectorCoordinatorConfig> = {
  name: 'doppelganger-memory-vector-coordinator',
  Config: MemoryVectorCoordinatorPluginConfigSchema as unknown as NonNullable<Plugin<MemoryVectorCoordinatorConfig>['Config']>,
  provide: MEMORY_SEMANTIC_SERVICE,
  inject: [
    'doppelgangerMemory',
    'doppelgangerPersona',
    'doppelgangerTools',
    'doppelgangerMemoryEmbedder',
    'doppelgangerMemoryVectorIndex',
  ],
  async apply(ctx: Context, config: MemoryVectorCoordinatorConfig = {}) {
    const coordinator = new MemoryVectorCoordinator(ctx, config)
    ctx.provide(MEMORY_SEMANTIC_SERVICE, coordinator)
    registerCoordinatorTools(ctx, coordinator)
    await coordinator.start()
    ctx.effect(() => async () => { await coordinator.stop() }, 'doppelgangerMemoryVectors.coordinator.stop')
  },
}

export default MemoryVectorCoordinatorPlugin
