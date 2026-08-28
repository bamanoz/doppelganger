import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/extension-persona'
import { InstanceSqliteService } from '@doppelganger/extension-sqlite'
import { MemoryError, MemoryService } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface SessionOptions {
  readonly principalId?: string
  readonly sessionId?: string
  readonly projectId?: string | null
  readonly now?: () => Date
  readonly id?: () => string
}

async function session(instanceHome: string, options: SessionOptions = {}) {
  const context = new Context()
  const projectId = options.projectId === undefined ? 'project-one' : options.projectId
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'aiden',
    principalId: options.principalId ?? 'local-user',
    sessionId: options.sessionId ?? 'session-one',
    ...(projectId === null ? {} : {
      projectId,
      projectRoot: join(instanceHome, projectId),
    }),
    instanceHome,
    definitionRoot: instanceHome,
  }))
  await context.plugin(InstanceSqliteService, { home: instanceHome })
  await context.plugin(MemoryService, {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.id === undefined ? {} : { id: options.id }),
  })
  return context
}

async function root(): Promise<string> {
  const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-mutations-'))
  temporaryRoots.push(instanceHome)
  return instanceHome
}

describe('memory mutations', () => {
  it('preserves immutable correction history and deep hard deletion', async () => {
    const instanceHome = await root()
    let nextId = 0
    const context = await session(instanceHome, { id: () => `id-${nextId += 1}` })
    const remembered = context.doppelgangerMemory.remember({
      operationId: 'remember-decision',
      subjectKey: 'project.loader.strategy',
      kind: 'decision',
      content: 'Use Cordis Loader updates.',
    })
    expect(remembered).toMatchObject({
      id: 'id-1',
      instanceId: 'aiden',
      principalId: 'local-user',
      subjectKey: 'project.loader.strategy',
      scope: { kind: 'project', projectId: 'project-one' },
      status: 'active',
      revision: { id: 'id-2', ordinal: 1, sourceKind: 'explicit' },
    })

    const corrected = context.doppelgangerMemory.correct({
      operationId: 'correct-decision',
      id: remembered.id,
      expectedRevisionId: remembered.revision.id,
      content: 'Use transactional Cordis Loader updates.',
    })
    expect(corrected.revision).toMatchObject({
      ordinal: 2,
      supersedesRevisionId: remembered.revision.id,
      sourceKind: 'correction',
    })
    expect(context.doppelgangerMemory.history(remembered.id).map(revision => revision.content)).toEqual([
      'Use Cordis Loader updates.',
      'Use transactional Cordis Loader updates.',
    ])
    try {
      context.doppelgangerMemory.correct({
        operationId: 'stale-correction',
        id: remembered.id,
        expectedRevisionId: remembered.revision.id,
        content: 'stale correction',
      })
      expect.unreachable('stale correction committed')
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryError)
      expect((error as MemoryError).code).toBe('REVISION_CONFLICT')
    }

    expect(context.doppelgangerMemory.pin({ operationId: 'pin-decision', id: remembered.id, pinned: true }).pinned).toBe(true)
    expect(context.doppelgangerMemory.forget({ operationId: 'forget-decision', id: remembered.id })).toBe(true)
    expect(context.doppelgangerMemory.get(remembered.id)).toBeUndefined()
    expect(() => context.doppelgangerMemory.history(remembered.id)).toThrow('active partition')
    expect(context.doppelgangerMemory.forget({ operationId: 'forget-decision', id: remembered.id })).toBe(true)
    await context.fiber.dispose()
  })

  it('makes mutations idempotent and reconciles equivalent subject observations as evidence', async () => {
    const instanceHome = await root()
    const first = await session(instanceHome, { sessionId: 'first' })
    const request = {
      operationId: 'remember-verbosity',
      subjectKey: 'preference.response.verbosity',
      kind: 'preference' as const,
      content: 'Prefer concise responses.',
      scope: 'relationship' as const,
      evidence: { turnId: 'turn-one', role: 'principal' as const },
    }
    const created = first.doppelgangerMemory.remember(request)
    expect(first.doppelgangerMemory.remember(request).id).toBe(created.id)
    expect(first.doppelgangerMemory.evidence(created.id)).toHaveLength(1)
    try {
      first.doppelgangerMemory.remember({ ...request, content: 'Prefer detailed responses.' })
      expect.unreachable('conflicting idempotency operation committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('IDEMPOTENCY_CONFLICT')
    }
    await first.fiber.dispose()

    const second = await session(instanceHome, { sessionId: 'second' })
    const repeated = second.doppelgangerMemory.remember({
      ...request,
      operationId: 'repeat-verbosity',
      evidence: { turnId: 'turn-two', role: 'principal' },
    })
    expect(repeated.id).toBe(created.id)
    expect(second.doppelgangerMemory.history(created.id)).toHaveLength(1)
    expect(second.doppelgangerMemory.evidence(created.id).map(evidence => evidence.sourceSessionId)).toEqual([
      'first',
      'second',
    ])
    await second.fiber.dispose()
  })

  it('isolates principals and projects before direct lookup or mutation', async () => {
    const instanceHome = await root()
    const principalOne = await session(instanceHome, { principalId: 'one', sessionId: 'one-a', projectId: 'alpha' })
    const relationship = principalOne.doppelgangerMemory.remember({
      operationId: 'one-relationship',
      subjectKey: 'preference.response.format',
      kind: 'preference',
      content: 'Use tables for comparisons.',
      scope: 'relationship',
    })
    const project = principalOne.doppelgangerMemory.remember({
      operationId: 'one-project',
      subjectKey: 'project.database.engine',
      kind: 'decision',
      content: 'Project Alpha uses SQLite.',
    })
    principalOne.doppelgangerMemory.propose({
      operationId: 'one-candidate',
      subjectKey: 'project.candidate',
      kind: 'fact',
      content: 'Principal one candidate.',
    })
    await principalOne.fiber.dispose()

    const otherProject = await session(instanceHome, { principalId: 'one', sessionId: 'one-b', projectId: 'beta' })
    expect(otherProject.doppelgangerMemory.get(relationship.id)?.id).toBe(relationship.id)
    expect(otherProject.doppelgangerMemory.get(project.id)).toBeUndefined()
    await otherProject.fiber.dispose()

    const principalTwo = await session(instanceHome, { principalId: 'two', sessionId: 'two-a', projectId: 'alpha' })
    expect(principalTwo.doppelgangerMemory.get(relationship.id)).toBeUndefined()
    expect(principalTwo.doppelgangerMemory.get(project.id)).toBeUndefined()
    expect(principalTwo.doppelgangerMemory.listCandidates()).toEqual([])
    expect(() => principalTwo.doppelgangerMemory.history(relationship.id)).toThrow('active partition')
    try {
      principalTwo.doppelgangerMemory.pin({ operationId: 'cross-principal-pin', id: relationship.id, pinned: true })
      expect.unreachable('cross-principal pin committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('NOT_FOUND')
    }
    await principalTwo.fiber.dispose()
  })

  it('falls back to relationship scope when no project is active', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome, { projectId: null })
    const remembered = context.doppelgangerMemory.remember({
      operationId: 'no-project',
      subjectKey: 'relationship.shared.fact',
      kind: 'fact',
      content: 'This session has no project.',
    })
    expect(remembered.scope).toEqual({ kind: 'relationship' })
    await context.fiber.dispose()
  })

  it('applies temporal eligibility at read time while retaining inspection history', async () => {
    const instanceHome = await root()
    let clock = new Date('2026-08-28T12:00:00.000Z')
    const context = await session(instanceHome, { now: () => clock })
    const future = context.doppelgangerMemory.remember({
      operationId: 'future',
      subjectKey: 'project.release.window',
      kind: 'fact',
      content: 'The release window opens tomorrow.',
      validFrom: '2026-08-29T12:00:00.000Z',
    })
    const temporary = context.doppelgangerMemory.remember({
      operationId: 'temporary',
      subjectKey: 'project.incident.status',
      kind: 'fact',
      content: 'The incident is active.',
      expiresAt: '2026-08-28T13:00:00.000Z',
    })
    expect((await context.doppelgangerMemory.search({ query: 'release incident', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([temporary.id])
    expect(context.doppelgangerMemory.inspect(future.id).temporalState).toBe('not-yet-valid')

    clock = new Date('2026-08-29T13:00:00.000Z')
    expect((await context.doppelgangerMemory.search({ query: 'release incident', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([future.id])
    expect(context.doppelgangerMemory.inspect(temporary.id).temporalState).toBe('expired')
    expect(context.doppelgangerMemory.history(temporary.id)[0]?.content).toBe('The incident is active.')
    await context.fiber.dispose()
  })

  it('commits exactly one concurrent-session correction for an expected revision', async () => {
    const instanceHome = await root()
    const seed = await session(instanceHome, { sessionId: 'seed' })
    const record = seed.doppelgangerMemory.remember({
      operationId: 'race-seed',
      subjectKey: 'project.runtime.choice',
      kind: 'decision',
      content: 'Use runtime A.',
    })
    await seed.fiber.dispose()
    const first = await session(instanceHome, { sessionId: 'race-one' })
    const second = await session(instanceHome, { sessionId: 'race-two' })
    const committed = first.doppelgangerMemory.correct({
      operationId: 'race-correction-one',
      id: record.id,
      expectedRevisionId: record.revision.id,
      content: 'Use runtime B.',
    })
    expect(committed.revision.ordinal).toBe(2)
    try {
      second.doppelgangerMemory.correct({
        operationId: 'race-correction-two',
        id: record.id,
        expectedRevisionId: record.revision.id,
        content: 'Use runtime C.',
      })
      expect.unreachable('second correction committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('REVISION_CONFLICT')
    }
    expect(first.doppelgangerMemory.history(record.id).map(revision => revision.content)).toEqual([
      'Use runtime A.',
      'Use runtime B.',
    ])
    await first.fiber.dispose()
    await second.fiber.dispose()
  })

  it('bounds evidence excerpts and rejects secret-bearing evidence atomically', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome)
    const record = context.doppelgangerMemory.remember({
      operationId: 'evidence-seed',
      subjectKey: 'project.evidence.policy',
      kind: 'fact',
      content: 'Evidence is bounded.',
    })
    context.doppelgangerMemory.observe({
      operationId: 'long-evidence',
      recordId: record.id,
      turnId: 'long-turn',
      role: 'tool',
      relation: 'support',
      excerpt: 'x'.repeat(2_000),
    })
    expect(context.doppelgangerMemory.evidence(record.id).at(-1)?.excerpt).toHaveLength(1_000)
    const count = context.doppelgangerMemory.evidence(record.id).length
    try {
      context.doppelgangerMemory.observe({
        operationId: 'secret-evidence',
        recordId: record.id,
        turnId: 'secret-turn',
        role: 'tool',
        relation: 'support',
        excerpt: 'access_token = abcdefghijklmnopqrstuvwxyz',
      })
      expect.unreachable('secret evidence committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('SECRET_REJECTED')
    }
    expect(context.doppelgangerMemory.evidence(record.id)).toHaveLength(count)
    await context.fiber.dispose()
  })

  it('rejects secrets before creating records, evidence, or receipts', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome)
    const secret = 'api_key = sk_live_1234567890abcdefgh'
    for (const operation of [
      () => context.doppelgangerMemory.remember({
        operationId: 'secret-active',
        subjectKey: 'secret.active',
        kind: 'fact',
        content: secret,
      }),
      () => context.doppelgangerMemory.propose({
        operationId: 'secret-candidate',
        subjectKey: 'secret.candidate',
        kind: 'preference',
        content: secret,
      }),
    ]) {
      try {
        operation()
        expect.unreachable('secret memory was stored')
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryError)
        expect((error as MemoryError).code).toBe('SECRET_REJECTED')
      }
    }
    expect(context.doppelgangerMemory.listCandidates()).toEqual([])
    await context.fiber.dispose()
  })
})
