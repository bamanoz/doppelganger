import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  ToolInvocationError,
  type ContextContribution,
  type JsonValue,
} from '@doppelganger/doppelganger-protocols'
import {
  MemoryError,
  type MemoryKind,
  type MemoryRecord,
  type MemoryRole,
} from './service.ts'
import type {} from './service.ts'

interface JsonSchemaObject {
  readonly [key: string]: JsonValue
}

function objectInput(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ToolInvocationError('INVALID_INPUT', 'tool input must be an object')
  }
  const input = value as Readonly<Record<string, JsonValue>>
  if (input.principalId !== undefined || input.actorId !== undefined) {
    throw new ToolInvocationError('INVALID_INPUT', 'memory tool input must not select principalId or actorId')
  }
  return input
}

function requiredString(input: Readonly<Record<string, JsonValue>>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(input: Readonly<Record<string, JsonValue>>, field: string): string | undefined {
  if (input[field] === undefined) return
  return requiredString(input, field)
}

function optionalBoolean(input: Readonly<Record<string, JsonValue>>, field: string): boolean | undefined {
  const value = input[field]
  if (value === undefined) return
  if (typeof value !== 'boolean') throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be a boolean`)
  return value
}

function optionalNumber(input: Readonly<Record<string, JsonValue>>, field: string): number | undefined {
  const value = input[field]
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be a finite number`)
  }
  return value
}

function enumString<const T extends string>(
  input: Readonly<Record<string, JsonValue>>,
  field: string,
  values: readonly T[],
  optional = false,
): T | undefined {
  const value = optional ? optionalString(input, field) : requiredString(input, field)
  if (value === undefined) return
  if (!(values as readonly string[]).includes(value)) {
    throw new ToolInvocationError('INVALID_INPUT', `unsupported ${field} "${value}"`)
  }
  return value as T
}

function memoryKind(input: Readonly<Record<string, JsonValue>>): MemoryKind {
  return enumString(input, 'kind', ['decision', 'fact', 'preference', 'procedure'])!
}

function memoryRole(input: Readonly<Record<string, JsonValue>>, optional = false): MemoryRole | undefined {
  return enumString(input, 'role', ['principal', 'assistant', 'tool', 'system'], optional)
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function toolHandler(operation: (input: Readonly<Record<string, JsonValue>>) => unknown | Promise<unknown>) {
  return async (value: JsonValue): Promise<JsonValue> => {
    try {
      return json(await operation(objectInput(value)))
    } catch (cause) {
      if (cause instanceof ToolInvocationError) throw cause
      if (cause instanceof MemoryError) throw new ToolInvocationError(cause.code, cause.message)
      throw cause
    }
  }
}

function recordContribution(record: MemoryRecord, stable = false): ContextContribution {
  const scope = record.scope.kind === 'relationship' ? 'relationship' : `project:${record.scope.projectId}`
  const authority = record.kind === 'preference' ? 'instruction' : 'data'
  return Object.freeze({
    source: `memory.${record.id}`,
    content: `[Memory ${record.kind}; ${scope}; subject=${record.subjectKey}]\n${record.revision.content}`,
    priority: record.pinned && record.scope.kind === 'relationship' && record.kind === 'preference'
      ? 700
      : stable ? 300 : authority === 'instruction' ? 500 : 100,
    authority,
  })
}

const STRING = Object.freeze({ type: 'string' as const })
const NUMBER_0_1 = Object.freeze({ type: 'number' as const, minimum: 0, maximum: 1 })
const TIME = Object.freeze({ type: 'string' as const, description: 'ISO 8601 UTC timestamp.' })
const KIND = Object.freeze({ type: 'string' as const, enum: ['decision', 'fact', 'preference', 'procedure'] })
const SCOPE = Object.freeze({ type: 'string' as const, enum: ['relationship', 'project'] })
const ROLE = Object.freeze({ type: 'string' as const, enum: ['principal', 'assistant', 'tool', 'system'] })

function objectSchema(
  properties: Readonly<Record<string, JsonSchemaObject>>,
  required: readonly string[] = [],
): JsonSchemaObject {
  return Object.freeze({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  })
}

const operationProperty = { operationId: { ...STRING, description: 'Stable idempotency identity for this mutation.' } }
const idProperty = { id: { ...STRING, description: 'Canonical memory record identifier.' } }
const temporalProperties = { validFrom: TIME, validUntil: TIME, expiresAt: TIME }
const createProperties = {
  ...operationProperty,
  subjectKey: { ...STRING, description: 'Stable lowercase subject key such as preference.response.verbosity.' },
  content: STRING,
  kind: KIND,
  scope: SCOPE,
  confidence: NUMBER_0_1,
  salience: NUMBER_0_1,
  ...temporalProperties,
  turnId: STRING,
  role: ROLE,
}

export const MemoryProtocolPlugin: Plugin = {
  name: 'doppelganger-memory-protocol',
  inject: ['doppelgangerMemory', 'doppelgangerTools', 'doppelgangerContext'],
  apply(ctx: Context) {
    const register = (
      name: string,
      description: string,
      inputSchema: JsonSchemaObject,
      operation: (input: Readonly<Record<string, JsonValue>>) => unknown | Promise<unknown>,
    ) => ctx.doppelgangerTools.register({
      name,
      description,
      inputSchema,
      invoke: toolHandler(operation),
    })

    register('memory.search', 'Search eligible active memory in the current partition.', objectSchema({
      query: STRING,
      tokenBudget: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1 },
    }, ['query']), async input => ctx.doppelgangerMemory.search({
      query: requiredString(input, 'query'),
      tokenBudget: optionalNumber(input, 'tokenBudget') ?? 1000,
      ...(optionalNumber(input, 'limit') === undefined ? {} : { limit: optionalNumber(input, 'limit')! }),
    }))
    register('memory.remember', 'Store explicit principal-directed active memory.', objectSchema(
      createProperties,
      ['operationId', 'subjectKey', 'content', 'kind'],
    ), input => ctx.doppelgangerMemory.remember({
      operationId: requiredString(input, 'operationId'),
      subjectKey: requiredString(input, 'subjectKey'),
      content: requiredString(input, 'content'),
      kind: memoryKind(input),
      ...(enumString(input, 'scope', ['relationship', 'project'], true) === undefined
        ? {}
        : { scope: enumString(input, 'scope', ['relationship', 'project'], true)! }),
      ...(optionalNumber(input, 'confidence') === undefined ? {} : { confidence: optionalNumber(input, 'confidence')! }),
      ...(optionalNumber(input, 'salience') === undefined ? {} : { salience: optionalNumber(input, 'salience')! }),
      ...Object.fromEntries(['validFrom', 'validUntil', 'expiresAt']
        .flatMap(field => optionalString(input, field) === undefined ? [] : [[field, optionalString(input, field)!]])),
      evidence: {
        turnId: optionalString(input, 'turnId') ?? requiredString(input, 'operationId'),
        role: memoryRole(input, true) ?? 'principal',
      },
    }))
    register('memory.candidates.propose', 'Create an inferred candidate that cannot enter recall before promotion.', objectSchema(
      createProperties,
      ['operationId', 'subjectKey', 'content', 'kind'],
    ), input => ctx.doppelgangerMemory.propose({
      operationId: requiredString(input, 'operationId'),
      subjectKey: requiredString(input, 'subjectKey'),
      content: requiredString(input, 'content'),
      kind: memoryKind(input),
      ...(enumString(input, 'scope', ['relationship', 'project'], true) === undefined
        ? {}
        : { scope: enumString(input, 'scope', ['relationship', 'project'], true)! }),
      ...(optionalNumber(input, 'confidence') === undefined ? {} : { confidence: optionalNumber(input, 'confidence')! }),
      ...(optionalNumber(input, 'salience') === undefined ? {} : { salience: optionalNumber(input, 'salience')! }),
      ...Object.fromEntries(['validFrom', 'validUntil', 'expiresAt']
        .flatMap(field => optionalString(input, field) === undefined ? [] : [[field, optionalString(input, field)!]])),
      evidence: {
        turnId: optionalString(input, 'turnId') ?? requiredString(input, 'operationId'),
        role: memoryRole(input, true) ?? 'assistant',
      },
    }))
    register('memory.inspect', 'Inspect canonical memory including temporal and conflict state.', objectSchema(idProperty, ['id']), input => (
      ctx.doppelgangerMemory.inspect(requiredString(input, 'id'))
    ))
    register('memory.history', 'Inspect immutable revision history.', objectSchema(idProperty, ['id']), input => (
      ctx.doppelgangerMemory.history(requiredString(input, 'id'))
    ))
    register('memory.evidence.list', 'Inspect bounded provenance evidence.', objectSchema(idProperty, ['id']), input => (
      ctx.doppelgangerMemory.evidence(requiredString(input, 'id'))
    ))
    register('memory.evidence.observe', 'Add bounded supporting or contradicting evidence.', objectSchema({
      ...operationProperty,
      ...idProperty,
      turnId: STRING,
      role: ROLE,
      relation: { type: 'string', enum: ['support', 'contradiction'] },
      excerpt: STRING,
    }, ['operationId', 'id', 'turnId', 'role', 'relation', 'excerpt']), input => ctx.doppelgangerMemory.observe({
      operationId: requiredString(input, 'operationId'),
      recordId: requiredString(input, 'id'),
      turnId: requiredString(input, 'turnId'),
      role: memoryRole(input)!,
      relation: enumString(input, 'relation', ['support', 'contradiction'])!,
      excerpt: requiredString(input, 'excerpt'),
    }))
    register('memory.correct', 'Create a corrected immutable revision using compare-and-swap.', objectSchema({
      ...operationProperty,
      ...idProperty,
      content: STRING,
      expectedRevisionId: STRING,
      confidence: NUMBER_0_1,
      salience: NUMBER_0_1,
      ...temporalProperties,
      turnId: STRING,
    }, ['operationId', 'id', 'content', 'expectedRevisionId']), input => ctx.doppelgangerMemory.correct({
      operationId: requiredString(input, 'operationId'),
      id: requiredString(input, 'id'),
      content: requiredString(input, 'content'),
      expectedRevisionId: requiredString(input, 'expectedRevisionId'),
      ...(optionalNumber(input, 'confidence') === undefined ? {} : { confidence: optionalNumber(input, 'confidence')! }),
      ...(optionalNumber(input, 'salience') === undefined ? {} : { salience: optionalNumber(input, 'salience')! }),
      ...Object.fromEntries(['validFrom', 'validUntil', 'expiresAt']
        .flatMap(field => optionalString(input, field) === undefined ? [] : [[field, optionalString(input, field)!]])),
      evidence: { turnId: optionalString(input, 'turnId') ?? requiredString(input, 'operationId'), role: 'principal' },
    }))
    register('memory.forget', 'Permanently delete canonical and locally derived memory state.', objectSchema({
      ...operationProperty,
      ...idProperty,
    }, ['operationId', 'id']), input => ({
      deleted: ctx.doppelgangerMemory.forget({
        operationId: requiredString(input, 'operationId'),
        id: requiredString(input, 'id'),
      }),
    }))
    register('memory.candidates.list', 'List reviewable candidates in the active partition.', objectSchema({}), () => (
      ctx.doppelgangerMemory.listCandidates()
    ))
    register('memory.candidates.approve', 'Approve a conflict-free candidate as active memory.', objectSchema({
      ...operationProperty,
      ...idProperty,
    }, ['operationId', 'id']), input => ctx.doppelgangerMemory.approve({
      operationId: requiredString(input, 'operationId'),
      candidateId: requiredString(input, 'id'),
    }))
    register('memory.candidates.reject', 'Terminally reject a candidate.', objectSchema({
      ...operationProperty,
      ...idProperty,
    }, ['operationId', 'id']), input => ctx.doppelgangerMemory.reject({
      operationId: requiredString(input, 'operationId'),
      candidateId: requiredString(input, 'id'),
    }))
    register('memory.candidates.corroborate', 'Add distinct-session candidate evidence and re-evaluate promotion.', objectSchema({
      ...operationProperty,
      ...idProperty,
      turnId: STRING,
      content: STRING,
      role: ROLE,
      contradiction: { type: 'boolean' },
    }, ['operationId', 'id', 'turnId', 'content']), input => ctx.doppelgangerMemory.corroborate({
      operationId: requiredString(input, 'operationId'),
      candidateId: requiredString(input, 'id'),
      turnId: requiredString(input, 'turnId'),
      content: requiredString(input, 'content'),
      ...(memoryRole(input, true) === undefined ? {} : { role: memoryRole(input, true)! }),
      ...(optionalBoolean(input, 'contradiction') === undefined
        ? {}
        : { contradiction: optionalBoolean(input, 'contradiction')! }),
    }))
    register('memory.conflicts.list', 'List reviewable conflicts.', objectSchema({ id: STRING }), input => (
      ctx.doppelgangerMemory.conflicts(optionalString(input, 'id'))
    ))
    register('memory.conflicts.resolve', 'Resolve a conflict using active-revision compare-and-swap.', objectSchema({
      ...operationProperty,
      conflictId: STRING,
      expectedRevisionId: STRING,
      resolution: { type: 'string', enum: ['dismiss', 'keep-active', 'promote-candidate'] },
    }, ['operationId', 'conflictId', 'expectedRevisionId', 'resolution']), input => ctx.doppelgangerMemory.resolveConflict({
      operationId: requiredString(input, 'operationId'),
      conflictId: requiredString(input, 'conflictId'),
      expectedRevisionId: requiredString(input, 'expectedRevisionId'),
      resolution: enumString(input, 'resolution', ['dismiss', 'keep-active', 'promote-candidate'])!,
    }))
    for (const pinned of [true, false]) {
      register(pinned ? 'memory.pin' : 'memory.unpin', pinned
        ? 'Pin active relationship preference memory for context precedence.'
        : 'Remove context precedence from active memory.', objectSchema({
        ...operationProperty,
        ...idProperty,
      }, ['operationId', 'id']), input => ctx.doppelgangerMemory.pin({
        operationId: requiredString(input, 'operationId'),
        id: requiredString(input, 'id'),
        pinned,
      }))
    }

    ctx.doppelgangerContext.register({
      id: 'persona.memory',
      async resolve(request) {
        if (request.tokenBudget === 0) return []
        const stable = ctx.doppelgangerMemory.stableProfile()
        const stableIds = new Set(stable.map(record => record.id))
        const ranked = request.turn.input.trim().length === 0
          ? []
          : await ctx.doppelgangerMemory.search({
              query: request.turn.input,
              tokenBudget: request.tokenBudget,
            })
        return Object.freeze([
          ...stable.map(record => recordContribution(record, true)),
          ...ranked.flatMap(result => stableIds.has(result.record.id) ? [] : [recordContribution(result.record)]),
        ])
      },
    })
  },
}
