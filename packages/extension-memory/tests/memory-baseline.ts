import { expect } from 'vitest'
import type {
  JsonValue,
  ToolCatalogSnapshot,
  ToolInvocationRequest,
  ToolInvocationResult,
} from '@doppelganger/doppelganger-protocols'
import type {
  CorrectMemoryRequest,
  ForgetMemoryRequest,
  MemoryEvidence,
  MemoryRecord,
  MemoryRevision,
  ObserveMemoryRequest,
  PinMemoryRequest,
  RememberMemoryRequest,
} from '../src/index.ts'

type Awaitable<T> = T | Promise<T>

export interface MemoryBaselineDomain {
  remember(request: RememberMemoryRequest): Awaitable<MemoryRecord>
  propose(request: RememberMemoryRequest): Awaitable<MemoryRecord>
  correct(request: CorrectMemoryRequest): Awaitable<MemoryRecord>
  forget(request: ForgetMemoryRequest): Awaitable<boolean>
  pin(request: PinMemoryRequest): Awaitable<MemoryRecord>
  get(id: string): Awaitable<MemoryRecord | undefined>
  inspect(id: string): Awaitable<MemoryRecord>
  history(id: string): Awaitable<readonly MemoryRevision[]>
  evidence(id: string): Awaitable<readonly MemoryEvidence[]>
  observe(request: ObserveMemoryRequest): Awaitable<MemoryRecord>
  listCandidates(): Awaitable<readonly MemoryRecord[]>
}

export interface MemoryBaselineTools {
  snapshot(): ToolCatalogSnapshot
  invoke(request: ToolInvocationRequest, sessionId: string): Promise<ToolInvocationResult>
}

export interface MemoryBaselineSession {
  readonly memory: MemoryBaselineDomain
  readonly tools: MemoryBaselineTools
  dispose(): Promise<void>
}

export interface MemoryBaselineSessionOptions {
  readonly actorId: string
  readonly sessionId: string
  readonly projectId: string | null
}

export interface MemoryBaselineFixture {
  createSession(options: MemoryBaselineSessionOptions): Promise<MemoryBaselineSession>
}

async function captureFailure(operation: () => Awaitable<unknown>): Promise<{ readonly code?: unknown }> {
  try {
    await operation()
  } catch (error) {
    if (typeof error !== 'object' || error === null) throw new Error('expected structured memory error')
    return error as { readonly code?: unknown }
  }
  throw new Error('expected memory operation to fail')
}

function resultObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('expected object tool result')
  }
  return value as Readonly<Record<string, JsonValue>>
}

function descriptor(tools: MemoryBaselineTools, name: string) {
  const value = tools.snapshot().tools.find(candidate => candidate.name === name)
  if (value === undefined) throw new Error(`missing memory tool ${name}`)
  return value
}

export async function assertCurrentRecordReceiptReplay(fixture: MemoryBaselineFixture): Promise<void> {
  const session = await fixture.createSession({
    actorId: 'baseline-actor',
    sessionId: 'baseline-receipt-session',
    projectId: 'baseline-project',
  })
  try {
    const rememberRequest = {
      operationId: 'baseline-receipt-remember',
      subjectKey: 'project.runtime.transport',
      kind: 'decision' as const,
      content: 'The runtime uses transport A.',
    }
    const created = await session.memory.remember(rememberRequest)
    const corrected = await session.memory.correct({
      operationId: 'baseline-receipt-correct',
      id: created.id,
      expectedRevisionId: created.revision.id,
      content: 'The runtime uses transport B.',
    })

    const replayed = await session.memory.remember(rememberRequest)

    expect(replayed).toEqual(corrected)
    expect(replayed.revision).toMatchObject({
      ordinal: 2,
      content: 'The runtime uses transport B.',
      supersedesRevisionId: created.revision.id,
      sourceKind: 'correction',
    })
    expect(await session.memory.history(created.id)).toHaveLength(2)
  } finally {
    await session.dispose()
  }
}

export async function assertForgottenResultReplay(fixture: MemoryBaselineFixture): Promise<void> {
  const session = await fixture.createSession({
    actorId: 'baseline-actor',
    sessionId: 'baseline-forget-session',
    projectId: 'baseline-project',
  })
  try {
    const rememberRequest = {
      operationId: 'baseline-forget-remember',
      subjectKey: 'project.retired.fact',
      kind: 'fact' as const,
      content: 'This fact will be forgotten.',
    }
    const record = await session.memory.remember(rememberRequest)
    const forgetRequest = {
      operationId: 'baseline-forget-operation',
      id: record.id,
    }

    expect(await session.memory.forget(forgetRequest)).toBe(true)
    expect(await session.memory.forget(forgetRequest)).toBe(true)
    expect(await session.memory.get(record.id)).toBeUndefined()
    expect(await captureFailure(() => session.memory.remember(rememberRequest))).toMatchObject({
      code: 'OPERATION_RESULT_DELETED',
    })
  } finally {
    await session.dispose()
  }
}

export async function assertPromotionProvenance(fixture: MemoryBaselineFixture): Promise<void> {
  const candidate = await (async () => {
    const first = await fixture.createSession({
      actorId: 'baseline-actor',
      sessionId: 'baseline-promotion-first',
      projectId: 'baseline-project',
    })
    try {
      const proposed = await first.memory.propose({
        operationId: 'baseline-promotion-propose',
        subjectKey: 'preference.response.evidence',
        kind: 'preference',
        content: 'Prefer evidence-first answers.',
        scope: 'relationship',
        evidence: {
          turnId: 'baseline-promotion-turn-one',
          role: 'principal',
          excerpt: 'Please prefer evidence-first answers.',
        },
      })
      expect(proposed).toMatchObject({
        status: 'candidate',
        sourceSessionId: 'baseline-promotion-first',
        revision: {
          sourceKind: 'inferred',
          sourceSessionId: 'baseline-promotion-first',
        },
      })
      return proposed
    } finally {
      await first.dispose()
    }
  })()

  const second = await fixture.createSession({
    actorId: 'baseline-actor',
    sessionId: 'baseline-promotion-second',
    projectId: 'baseline-project',
  })
  try {
    const promoted = await second.memory.observe({
      operationId: 'baseline-promotion-observe',
      recordId: candidate.id,
      turnId: 'baseline-promotion-turn-two',
      role: 'principal',
      relation: 'support',
      excerpt: 'Evidence-first answers remain preferred.',
    })

    expect(promoted).toMatchObject({
      id: candidate.id,
      status: 'active',
      sourceSessionId: 'baseline-promotion-first',
      revision: {
        id: candidate.revision.id,
        ordinal: 1,
        sourceKind: 'corroboration',
        sourceSessionId: 'baseline-promotion-first',
      },
    })
    expect(await second.memory.history(candidate.id)).toEqual([
      expect.objectContaining({
        id: candidate.revision.id,
        ordinal: 1,
        sourceKind: 'corroboration',
        sourceSessionId: 'baseline-promotion-first',
      }),
    ])
    const evidence = await second.memory.evidence(candidate.id)
    expect(evidence).toHaveLength(2)
    expect(evidence.map(item => item.sourceSessionId).sort()).toEqual([
      'baseline-promotion-first',
      'baseline-promotion-second',
    ])
    expect(evidence.every(item => item.role === 'principal' && item.relation === 'support')).toBe(true)
  } finally {
    await second.dispose()
  }
}

export async function assertActorProjectIsolation(fixture: MemoryBaselineFixture): Promise<void> {
  const { relationship, project } = await (async () => {
    const owner = await fixture.createSession({
      actorId: 'baseline-actor-one',
      sessionId: 'baseline-isolation-owner',
      projectId: 'baseline-project-alpha',
    })
    try {
      const relationship = await owner.memory.remember({
        operationId: 'baseline-isolation-relationship',
        subjectKey: 'preference.response.format',
        kind: 'preference',
        content: 'Use tables for comparisons.',
        scope: 'relationship',
      })
      const project = await owner.memory.remember({
        operationId: 'baseline-isolation-project',
        subjectKey: 'project.database.engine',
        kind: 'decision',
        content: 'Project Alpha uses SQLite.',
      })
      await owner.memory.propose({
        operationId: 'baseline-isolation-candidate',
        subjectKey: 'project.candidate.fact',
        kind: 'fact',
        content: 'Only the owning project can review this candidate.',
      })
      return { relationship, project }
    } finally {
      await owner.dispose()
    }
  })()

  const otherProject = await fixture.createSession({
    actorId: 'baseline-actor-one',
    sessionId: 'baseline-isolation-other-project',
    projectId: 'baseline-project-beta',
  })
  try {
    expect((await otherProject.memory.get(relationship.id))?.id).toBe(relationship.id)
    expect(await otherProject.memory.get(project.id)).toBeUndefined()
    expect(await otherProject.memory.listCandidates()).toEqual([])
    expect(await captureFailure(() => otherProject.memory.pin({
      operationId: 'baseline-isolation-cross-project-pin',
      id: project.id,
      pinned: true,
    }))).toMatchObject({ code: 'NOT_FOUND' })
  } finally {
    await otherProject.dispose()
  }

  const otherActor = await fixture.createSession({
    actorId: 'baseline-actor-two',
    sessionId: 'baseline-isolation-other-actor',
    projectId: 'baseline-project-alpha',
  })
  try {
    expect(await otherActor.memory.get(relationship.id)).toBeUndefined()
    expect(await otherActor.memory.get(project.id)).toBeUndefined()
    expect(await otherActor.memory.listCandidates()).toEqual([])
    expect(await captureFailure(() => otherActor.memory.inspect(relationship.id))).toMatchObject({
      code: 'NOT_FOUND',
    })
  } finally {
    await otherActor.dispose()
  }
}

export async function assertMemoryToolContractOutcomes(fixture: MemoryBaselineFixture): Promise<void> {
  const sessionId = 'baseline-tools-session'
  const session = await fixture.createSession({
    actorId: 'baseline-tools-actor',
    sessionId,
    projectId: 'baseline-tools-project',
  })
  let callSequence = 0
  const invoke = async (name: string, input: JsonValue): Promise<ToolInvocationResult> => {
    const tool = descriptor(session.tools, name)
    callSequence += 1
    return session.tools.invoke({
      callId: `baseline-tool-call-${callSequence}`,
      name,
      toolRevision: tool.revision,
      input,
    }, sessionId)
  }

  try {
    expect(session.tools.snapshot().tools.map(tool => tool.name)).toEqual([
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
    const rememberSchema = descriptor(session.tools, 'memory.remember').inputSchema
    expect(rememberSchema).toMatchObject({
      type: 'object',
      required: ['operationId', 'subjectKey', 'content', 'kind'],
      additionalProperties: false,
      properties: {
        operationId: { type: 'string' },
        subjectKey: { type: 'string' },
        content: { type: 'string' },
        kind: { enum: ['decision', 'fact', 'preference', 'procedure'] },
        scope: { enum: ['relationship', 'project'] },
        confidence: { minimum: 0, maximum: 1 },
        salience: { minimum: 0, maximum: 1 },
        validFrom: { type: 'string' },
        validUntil: { type: 'string' },
        expiresAt: { type: 'string' },
        turnId: { type: 'string' },
        role: { enum: ['principal', 'assistant', 'tool', 'system'] },
      },
    })
    expect(rememberSchema).not.toHaveProperty('properties.actorId')
    expect(rememberSchema).not.toHaveProperty('properties.principalId')

    for (const identityField of ['actorId', 'principalId'] as const) {
      expect(await invoke('memory.remember', {
        operationId: `baseline-tool-reject-${identityField}`,
        subjectKey: 'identity.override',
        kind: 'fact',
        content: 'Tool input must not select a memory identity.',
        [identityField]: 'override',
      })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }

    const rememberInput = {
      operationId: 'baseline-tool-remember',
      subjectKey: 'project.storage.engine',
      kind: 'fact',
      content: 'Project memory is stored canonically.',
    } as const
    const remembered = await invoke('memory.remember', rememberInput)
    expect(remembered.ok).toBe(true)
    if (!remembered.ok) throw new Error(remembered.error.message)
    const record = resultObject(remembered.value)

    expect(await invoke('memory.remember', {
      ...rememberInput,
      content: 'The same operation cannot change its command.',
    })).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } })
    expect(await invoke('memory.inspect', { id: 'missing-memory-record' }))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await invoke('memory.remember', {
      operationId: 'baseline-tool-secret',
      subjectKey: 'secret.token',
      kind: 'fact',
      content: 'api_key = sk_live_1234567890abcdefgh',
    })).toMatchObject({ ok: false, error: { code: 'SECRET_REJECTED' } })
    expect(await invoke('memory.forget', {
      operationId: 'baseline-tool-forget',
      id: record.id!,
    })).toEqual({ ok: true, value: { deleted: true } })
    expect(await invoke('memory.remember', rememberInput)).toMatchObject({
      ok: false,
      error: { code: 'OPERATION_RESULT_DELETED' },
    })
  } finally {
    await session.dispose()
  }
}
