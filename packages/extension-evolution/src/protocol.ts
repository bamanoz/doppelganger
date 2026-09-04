import type { Context, Plugin } from '@deepseek-ai/cordis'
import {
  ToolInvocationError,
  type ContextContribution,
  type JsonValue,
  type ToolDefinition,
  type ToolInvocationContext,
} from '@doppelganger/doppelganger-protocols'
import {
  EvolutionError,
  type EvolutionProposalStatus,
  type EvolutionScope,
} from './service.ts'
import type {} from './service.ts'

interface JsonSchemaObject {
  readonly [key: string]: JsonValue
}

const STRING = Object.freeze({ type: 'string' as const })
const POSITIVE_INTEGER = Object.freeze({ type: 'integer' as const, minimum: 1 })
const KIND = Object.freeze({ type: 'string' as const, enum: ['persona', 'capability'] })
const SCOPE = Object.freeze({ type: 'string' as const, enum: ['global', 'project'] })
const STATUS = Object.freeze({
  type: 'string' as const,
  enum: ['proposed', 'reviewing', 'researching', 'options-ready', 'selected', 'planned', 'implementing', 'snoozed', 'rejected', 'done'],
})
const TAGS = Object.freeze({ type: 'array' as const, items: STRING, maxItems: 20 })
const EVIDENCE = Object.freeze({
  type: 'array' as const,
  maxItems: 20,
  items: {
    type: 'object',
    properties: { summary: STRING, sourceId: STRING },
    required: ['summary', 'sourceId'],
    additionalProperties: false,
  },
})

function objectSchema(properties: Readonly<Record<string, JsonSchemaObject>>, required: readonly string[] = []): JsonSchemaObject {
  return Object.freeze({ type: 'object', properties, required, additionalProperties: false })
}

const baseMutation = { operationId: STRING, id: STRING, expectedRevision: POSITIVE_INTEGER }
const TRANSITION_TARGETS = [
  'reviewing', 'researching', 'options-ready', 'selected',
  'planned', 'implementing', 'done', 'proposed',
] as const
const TRANSITION_FIELDS: Readonly<Record<(typeof TRANSITION_TARGETS)[number], readonly string[]>> = Object.freeze({
  reviewing: ['reviewSummary'],
  researching: ['researchQuestion'],
  'options-ready': ['optionsSummary', 'sourceIds'],
  selected: ['selectedOption'],
  planned: ['planReference'],
  implementing: ['implementationReference'],
  done: ['outcome'],
  proposed: ['detail'],
})
const TRANSITION_INPUT_FIELDS = [
  'operationId', 'id', 'expectedRevision', 'target',
  'reviewSummary', 'researchQuestion', 'optionsSummary', 'sourceIds',
  'selectedOption', 'planReference', 'implementationReference', 'outcome', 'detail',
] as const
const SOURCE_IDS = Object.freeze({ type: 'array' as const, items: STRING, minItems: 1, maxItems: 20 })

function inputRecord(value: JsonValue, allowed: readonly string[]): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ToolInvocationError('INVALID_INPUT', 'tool input must be an object')
  }
  const record = value as Readonly<Record<string, JsonValue>>
  const prohibited = ['actorId', 'principalId', 'instanceId', 'projectId'].find(field => record[field] !== undefined)
  if (prohibited !== undefined) throw new ToolInvocationError('INVALID_INPUT', `tool input must not select ${prohibited}`)
  const extra = Object.keys(record).find(key => !allowed.includes(key))
  if (extra !== undefined) throw new ToolInvocationError('INVALID_INPUT', `unsupported input field "${extra}"`)
  return record
}

function requiredString(record: Readonly<Record<string, JsonValue>>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(record: Readonly<Record<string, JsonValue>>, field: string): string | undefined {
  return record[field] === undefined ? undefined : requiredString(record, field)
}

function requiredInteger(record: Readonly<Record<string, JsonValue>>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be a positive safe integer`)
  }
  return value
}

function optionalBoolean(record: Readonly<Record<string, JsonValue>>, field: string): boolean | undefined {
  const value = record[field]
  if (value === undefined) return
  if (typeof value !== 'boolean') throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be a boolean`)
  return value
}

function stringArray(record: Readonly<Record<string, JsonValue>>, field: string, required = false): readonly string[] | undefined {
  const value = record[field]
  if (value === undefined && !required) return
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new ToolInvocationError('INVALID_INPUT', `"${field}" must be an array of non-empty strings`)
  }
  return value.map(item => (item as string).trim())
}

function evidence(record: Readonly<Record<string, JsonValue>>): readonly { summary: string; sourceId: string }[] | undefined {
  const value = record.evidence
  if (value === undefined) return
  if (!Array.isArray(value)) throw new ToolInvocationError('INVALID_INPUT', '"evidence" must be an array')
  return value.map(item => {
    const source = inputRecord(item, ['summary', 'sourceId'])
    return {
      summary: requiredString(source, 'summary'),
      sourceId: requiredString(source, 'sourceId'),
    }
  })
}

function enumeration<T extends string>(record: Readonly<Record<string, JsonValue>>, field: string, values: readonly T[]): T {
  const value = requiredString(record, field)
  if (!values.includes(value as T)) throw new ToolInvocationError('INVALID_INPUT', `unsupported ${field} "${value}"`)
  return value as T
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function handler(operation: (input: JsonValue) => unknown | Promise<unknown>) {
  return async (input: JsonValue, _context: ToolInvocationContext): Promise<JsonValue> => {
    try {
      return json(await operation(input))
    } catch (cause) {
      if (cause instanceof ToolInvocationError) throw cause
      if (cause instanceof EvolutionError) throw new ToolInvocationError(cause.code, cause.message)
      throw cause
    }
  }
}

const EVOLUTION_POLICY = `[Doppelganger Evolution Policy]
Evaluate completed work and dialogue for stable Persona improvements and material reusable capability gaps. Distinguish Persona qualities from user facts and preferences. Prefer existing capabilities over new mechanisms. Complete and verify the current task before raising an opportunity, then present at most one concise proposal or reminder. Automatically discovered proposals are inert, consent-gated, never begin review, research, planning, or implementation, and never interrupt primary work. Record manual proposals before review, research, planning, or implementation. Require explicit user consent before Persona review or capability research. Prefer portable Doppelganger implementations over host-specific plugins whenever Doppelganger exposes the required seam.`

function definitions(ctx: Context): readonly ToolDefinition[] {
  return Object.freeze([
    {
      name: 'evolution.propose',
      description: 'Record or deduplicate a non-executing Persona or capability evolution proposal.',
      inputSchema: objectSchema({
        operationId: STRING, kind: KIND, scope: SCOPE, dedupeKey: STRING,
        title: STRING, rationale: STRING, tags: TAGS, evidence: EVIDENCE,
      }, ['operationId', 'kind', 'scope', 'dedupeKey', 'title', 'rationale']),
      invoke: handler(async value => {
        const input = inputRecord(value, ['operationId', 'kind', 'scope', 'dedupeKey', 'title', 'rationale', 'tags', 'evidence'])
        return ctx.doppelgangerEvolution.propose({
          operationId: requiredString(input, 'operationId'),
          kind: enumeration(input, 'kind', ['persona', 'capability']),
          scope: enumeration(input, 'scope', ['global', 'project']),
          dedupeKey: requiredString(input, 'dedupeKey'),
          title: requiredString(input, 'title'),
          rationale: requiredString(input, 'rationale'),
          ...(stringArray(input, 'tags') === undefined ? {} : { tags: stringArray(input, 'tags')! }),
          ...(evidence(input) === undefined ? {} : { evidence: evidence(input)! }),
        })
      }),
    },
    {
      name: 'evolution.list',
      description: 'List Evolution proposals with bounded filters and project-file diagnostics.',
      inputSchema: objectSchema({ kind: KIND, scope: SCOPE, status: STATUS, query: STRING, dueOnly: { type: 'boolean' } }),
      invoke: handler(async value => {
        const input = inputRecord(value, ['kind', 'scope', 'status', 'query', 'dueOnly'])
        const kind = optionalString(input, 'kind')
        const scope = optionalString(input, 'scope')
        const status = optionalString(input, 'status')
        return ctx.doppelgangerEvolution.list({
          ...(kind === undefined ? {} : { kind: enumeration(input, 'kind', ['persona', 'capability']) }),
          ...(scope === undefined ? {} : { scope: enumeration(input, 'scope', ['global', 'project']) as EvolutionScope }),
          ...(status === undefined ? {} : { status: enumeration(input, 'status', [...STATUS.enum] as EvolutionProposalStatus[]) }),
          ...(optionalString(input, 'query') === undefined ? {} : { query: optionalString(input, 'query')! }),
          ...(optionalBoolean(input, 'dueOnly') === undefined ? {} : { dueOnly: optionalBoolean(input, 'dueOnly')! }),
        })
      }),
    },
    {
      name: 'evolution.inspect',
      description: 'Inspect one proposal with exact revision, evidence, history, reminders, and project diagnostics.',
      inputSchema: objectSchema({ id: STRING }, ['id']),
      invoke: handler(value => {
        const input = inputRecord(value, ['id'])
        return ctx.doppelgangerEvolution.inspect(requiredString(input, 'id'))
      }),
    },
    {
      name: 'evolution.transition',
      description: 'Apply one kind-specific revision-checked forward proposal transition.',
      inputSchema: objectSchema({
        ...baseMutation,
        target: { type: 'string', enum: TRANSITION_TARGETS },
        reviewSummary: STRING,
        researchQuestion: STRING,
        optionsSummary: STRING,
        sourceIds: SOURCE_IDS,
        selectedOption: STRING,
        planReference: STRING,
        implementationReference: STRING,
        outcome: STRING,
        detail: STRING,
      }, ['operationId', 'id', 'expectedRevision', 'target']),
      invoke: handler(value => {
        const base = inputRecord(value, TRANSITION_INPUT_FIELDS)
        const common = {
          operationId: requiredString(base, 'operationId'),
          id: requiredString(base, 'id'),
          expectedRevision: requiredInteger(base, 'expectedRevision'),
        }
        const target = enumeration(base, 'target', TRANSITION_TARGETS)
        const allowed = new Set(['operationId', 'id', 'expectedRevision', 'target', ...TRANSITION_FIELDS[target]])
        const irrelevant = Object.keys(base).find(field => !allowed.has(field))
        if (irrelevant !== undefined) {
          throw new ToolInvocationError('INVALID_INPUT', `"${irrelevant}" is not valid for transition target "${target}"`)
        }
        switch (target) {
          case 'reviewing': return ctx.doppelgangerEvolution.transition({ ...common, target, reviewSummary: requiredString(base, 'reviewSummary') })
          case 'researching': return ctx.doppelgangerEvolution.transition({ ...common, target, researchQuestion: requiredString(base, 'researchQuestion') })
          case 'options-ready': return ctx.doppelgangerEvolution.transition({ ...common, target, optionsSummary: requiredString(base, 'optionsSummary'), sourceIds: stringArray(base, 'sourceIds', true)! })
          case 'selected': return ctx.doppelgangerEvolution.transition({ ...common, target, selectedOption: requiredString(base, 'selectedOption') })
          case 'planned': return ctx.doppelgangerEvolution.transition({ ...common, target, planReference: requiredString(base, 'planReference') })
          case 'implementing': return ctx.doppelgangerEvolution.transition({ ...common, target, implementationReference: requiredString(base, 'implementationReference') })
          case 'done': return ctx.doppelgangerEvolution.transition({ ...common, target, outcome: requiredString(base, 'outcome') })
          case 'proposed': return ctx.doppelgangerEvolution.transition({ ...common, target, detail: requiredString(base, 'detail') })
          default: throw new ToolInvocationError('INVALID_INPUT', `unsupported target "${target}"`)
        }
      }),
    },
    {
      name: 'evolution.snooze',
      description: 'Suppress an active proposal until a revision-checked future deadline.',
      inputSchema: objectSchema({ ...baseMutation, until: STRING, reason: STRING }, ['operationId', 'id', 'expectedRevision', 'until', 'reason']),
      invoke: handler(value => {
        const input = inputRecord(value, ['operationId', 'id', 'expectedRevision', 'until', 'reason'])
        return ctx.doppelgangerEvolution.snooze({
          operationId: requiredString(input, 'operationId'), id: requiredString(input, 'id'),
          expectedRevision: requiredInteger(input, 'expectedRevision'), until: requiredString(input, 'until'),
          reason: requiredString(input, 'reason'),
        })
      }),
    },
    {
      name: 'evolution.reject',
      description: 'Terminally reject an Evolution proposal at an exact revision.',
      inputSchema: objectSchema({ ...baseMutation, reason: STRING }, ['operationId', 'id', 'expectedRevision', 'reason']),
      invoke: handler(value => {
        const input = inputRecord(value, ['operationId', 'id', 'expectedRevision', 'reason'])
        return ctx.doppelgangerEvolution.reject({
          operationId: requiredString(input, 'operationId'), id: requiredString(input, 'id'),
          expectedRevision: requiredInteger(input, 'expectedRevision'), reason: requiredString(input, 'reason'),
        })
      }),
    },
    {
      name: 'evolution.reminder.record',
      description: 'Confirm that one exact proposal revision was presented in a stable session turn.',
      inputSchema: objectSchema({ ...baseMutation, sessionId: STRING, turnId: STRING }, ['operationId', 'id', 'expectedRevision', 'sessionId', 'turnId']),
      invoke: handler(value => {
        const input = inputRecord(value, ['operationId', 'id', 'expectedRevision', 'sessionId', 'turnId'])
        return ctx.doppelgangerEvolution.recordReminder({
          operationId: requiredString(input, 'operationId'), id: requiredString(input, 'id'),
          expectedRevision: requiredInteger(input, 'expectedRevision'), sessionId: requiredString(input, 'sessionId'),
          turnId: requiredString(input, 'turnId'),
        })
      }),
    },
  ])
}

export const EvolutionProtocolPlugin: Plugin = {
  name: 'doppelganger-evolution-protocol',
  inject: ['doppelgangerEvolution', 'doppelgangerContext', 'doppelgangerTools'],
  apply(ctx: Context) {
    ctx.doppelgangerContext.register({
      id: 'evolution',
      async resolve(request): Promise<readonly ContextContribution[]> {
        const instruction: ContextContribution = Object.freeze({
          source: 'evolution.policy', content: EVOLUTION_POLICY, priority: 650, authority: 'instruction', truncate: true,
        })
        const reminder = await ctx.doppelgangerEvolution.selectReminder(request.turn.input)
        if (reminder === undefined) return Object.freeze([instruction])
        return Object.freeze([instruction, Object.freeze({
          source: `evolution.reminder.${reminder.id}`,
          content: `[Evolution reminder candidate; id=${reminder.id}; revision=${reminder.revision}; kind=${reminder.kind}; scope=${reminder.scope}]\n${reminder.title}\n${reminder.rationale}`,
          priority: 120,
          authority: 'data',
          truncate: true,
        })])
      },
    })
    for (const definition of definitions(ctx)) ctx.doppelgangerTools.register(definition)
  },
}
