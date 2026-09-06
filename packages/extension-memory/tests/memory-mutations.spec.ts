import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { MemoryError, MemoryService, SqliteMemoryPlugin } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface SessionOptions {
  readonly actorId?: string
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
    sessionId: options.sessionId ?? 'session-one',
    ...(projectId === null ? {} : {
      projectId,
      projectRoot: join(instanceHome, projectId),
    }),
  }))
  await context.plugin(createActorIdentityPlugin(options.actorId ?? 'local-user'))
  await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
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

  it('rejects an unbound actor before opening canonical storage', async () => {
    const instanceHome = await root()
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'aiden', sessionId: 'unbound-session',
    }))
    await context.plugin(createActorIdentityPlugin())

    const memory = context.plugin(SqliteMemoryPlugin, { home: instanceHome })
    await expect(memory.await()).rejects.toThrow('memory repository requires a bound host actor')
    await expect(access(join(instanceHome, 'storage'))).rejects.toMatchObject({ code: 'ENOENT' })
    await context.fiber.dispose()
  })


describe('memory mutations', () => {
  it('preserves immutable correction history and deep hard deletion', async () => {
    const instanceHome = await root()
    let nextId = 0
    const context = await session(instanceHome, { id: () => `id-${nextId += 1}` })
    const remembered = await context.doppelgangerMemory.remember({
      operationId: 'remember-decision',
      subjectKey: 'project.loader.strategy',
      kind: 'decision',
      content: 'Use Cordis Loader updates.',
    })
    expect(remembered).toMatchObject({
      id: 'id-1',
      instanceId: 'aiden',
      actorId: 'local-user',
      subjectKey: 'project.loader.strategy',
      scope: { kind: 'project', projectId: 'project-one' },
      status: 'active',
      revision: { id: 'id-2', ordinal: 1, sourceKind: 'explicit' },
    })

    const corrected = await context.doppelgangerMemory.correct({
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
    expect((await context.doppelgangerMemory.history(remembered.id)).map(revision => revision.content)).toEqual([
      'Use Cordis Loader updates.',
      'Use transactional Cordis Loader updates.',
    ])
    try {
      await context.doppelgangerMemory.correct({
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

    expect((await context.doppelgangerMemory.pin({ operationId: 'pin-decision', id: remembered.id, pinned: true })).pinned).toBe(true)
    expect(await context.doppelgangerMemory.forget({ operationId: 'forget-decision', id: remembered.id })).toBe(true)
    expect(await context.doppelgangerMemory.get(remembered.id)).toBeUndefined()
    await expect(context.doppelgangerMemory.history(remembered.id)).rejects.toThrow('active partition')
    expect(await context.doppelgangerMemory.forget({ operationId: 'forget-decision', id: remembered.id })).toBe(true)
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
    const created = await first.doppelgangerMemory.remember(request)
    expect((await first.doppelgangerMemory.remember(request)).id).toBe(created.id)
    expect(await first.doppelgangerMemory.evidence(created.id)).toHaveLength(1)
    try {
      await first.doppelgangerMemory.remember({ ...request, content: 'Prefer detailed responses.' })
      expect.unreachable('conflicting idempotency operation committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('IDEMPOTENCY_CONFLICT')
    }
    await first.fiber.dispose()

    const second = await session(instanceHome, { sessionId: 'second' })
    const repeated = await second.doppelgangerMemory.remember({
      ...request,
      operationId: 'repeat-verbosity',
      evidence: { turnId: 'turn-two', role: 'principal' },
    })
    expect(repeated.id).toBe(created.id)
    expect(await second.doppelgangerMemory.history(created.id)).toHaveLength(1)
    expect((await second.doppelgangerMemory.evidence(created.id)).map(evidence => evidence.sourceSessionId)).toEqual([
      'first',
      'second',
    ])
    await second.fiber.dispose()
  })

  it('isolates actors and projects before direct lookup or mutation', async () => {
    const instanceHome = await root()
    const actorOne = await session(instanceHome, { actorId: 'one', sessionId: 'one-a', projectId: 'alpha' })
    const relationship = await actorOne.doppelgangerMemory.remember({
      operationId: 'one-relationship',
      subjectKey: 'preference.response.format',
      kind: 'preference',
      content: 'Use tables for comparisons.',
      scope: 'relationship',
    })
    const project = await actorOne.doppelgangerMemory.remember({
      operationId: 'one-project',
      subjectKey: 'project.database.engine',
      kind: 'decision',
      content: 'Project Alpha uses SQLite.',
    })
    await actorOne.doppelgangerMemory.propose({
      operationId: 'one-candidate',
      subjectKey: 'project.candidate',
      kind: 'fact',
      content: 'Actor one candidate.',
    })
    await actorOne.fiber.dispose()

    const otherProject = await session(instanceHome, { actorId: 'one', sessionId: 'one-b', projectId: 'beta' })
    expect((await otherProject.doppelgangerMemory.get(relationship.id))?.id).toBe(relationship.id)
    expect(await otherProject.doppelgangerMemory.get(project.id)).toBeUndefined()
    await otherProject.fiber.dispose()

    const actorTwo = await session(instanceHome, { actorId: 'two', sessionId: 'two-a', projectId: 'alpha' })
    expect(await actorTwo.doppelgangerMemory.get(relationship.id)).toBeUndefined()
    expect(await actorTwo.doppelgangerMemory.get(project.id)).toBeUndefined()
    expect(await actorTwo.doppelgangerMemory.listCandidates()).toEqual([])
    await expect(actorTwo.doppelgangerMemory.history(relationship.id)).rejects.toThrow('active partition')
    try {
      await actorTwo.doppelgangerMemory.pin({ operationId: 'cross-actor-pin', id: relationship.id, pinned: true })
      expect.unreachable('cross-actor pin committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('NOT_FOUND')
    }
    await actorTwo.fiber.dispose()
  })

  it('falls back to relationship scope when no project is active', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome, { projectId: null })
    const remembered = await context.doppelgangerMemory.remember({
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
    const future = await context.doppelgangerMemory.remember({
      operationId: 'future',
      subjectKey: 'project.release.window',
      kind: 'fact',
      content: 'The release window opens tomorrow.',
      validFrom: '2026-08-29T12:00:00.000Z',
    })
    const temporary = await context.doppelgangerMemory.remember({
      operationId: 'temporary',
      subjectKey: 'project.incident.status',
      kind: 'fact',
      content: 'The incident is active.',
      expiresAt: '2026-08-28T13:00:00.000Z',
    })
    expect((await context.doppelgangerMemory.search({ query: 'release incident', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([temporary.id])
    expect((await context.doppelgangerMemory.inspect(future.id)).temporalState).toBe('not-yet-valid')

    clock = new Date('2026-08-29T13:00:00.000Z')
    expect((await context.doppelgangerMemory.search({ query: 'release incident', tokenBudget: 100 }))
      .map(result => result.record.id)).toEqual([future.id])
    expect((await context.doppelgangerMemory.inspect(temporary.id)).temporalState).toBe('expired')
    expect((await context.doppelgangerMemory.history(temporary.id))[0]?.content).toBe('The incident is active.')
    await context.fiber.dispose()
  })

  it('commits exactly one concurrent-session correction for an expected revision', async () => {
    const instanceHome = await root()
    const seed = await session(instanceHome, { sessionId: 'seed' })
    const record = await seed.doppelgangerMemory.remember({
      operationId: 'race-seed',
      subjectKey: 'project.runtime.choice',
      kind: 'decision',
      content: 'Use runtime A.',
    })
    await seed.fiber.dispose()
    const first = await session(instanceHome, { sessionId: 'race-one' })
    const second = await session(instanceHome, { sessionId: 'race-two' })
    const committed = await first.doppelgangerMemory.correct({
      operationId: 'race-correction-one',
      id: record.id,
      expectedRevisionId: record.revision.id,
      content: 'Use runtime B.',
    })
    expect(committed.revision.ordinal).toBe(2)
    try {
      await second.doppelgangerMemory.correct({
        operationId: 'race-correction-two',
        id: record.id,
        expectedRevisionId: record.revision.id,
        content: 'Use runtime C.',
      })
      expect.unreachable('second correction committed')
    } catch (error) {
      expect((error as MemoryError).code).toBe('REVISION_CONFLICT')
    }
    expect((await first.doppelgangerMemory.history(record.id)).map(revision => revision.content)).toEqual([
      'Use runtime A.',
      'Use runtime B.',
    ])
    await first.fiber.dispose()
    await second.fiber.dispose()
  })

  it('bounds evidence excerpts and rejects secret-bearing evidence atomically', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome)
    const record = await context.doppelgangerMemory.remember({
      operationId: 'evidence-seed',
      subjectKey: 'project.evidence.policy',
      kind: 'fact',
      content: 'Evidence is bounded.',
    })
    await context.doppelgangerMemory.observe({
      operationId: 'long-evidence',
      recordId: record.id,
      turnId: 'long-turn',
      role: 'tool',
      relation: 'support',
      excerpt: 'x'.repeat(2_000),
    })
    expect((await context.doppelgangerMemory.evidence(record.id))
      .find(evidence => evidence.sourceTurnId === 'long-turn')?.excerpt).toHaveLength(1_000)
    const count = (await context.doppelgangerMemory.evidence(record.id)).length
    try {
      await context.doppelgangerMemory.observe({
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
    expect(await context.doppelgangerMemory.evidence(record.id)).toHaveLength(count)
    await context.fiber.dispose()
  })

  it('rejects secrets before creating records, evidence, or receipts', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome)
    const secret = 'api_key = sk_live_1234567890abcdefgh'
    for (const operation of [
      async () => context.doppelgangerMemory.remember({
        operationId: 'secret-active',
        subjectKey: 'secret.active',
        kind: 'fact',
        content: secret,
      }),
      async () => context.doppelgangerMemory.propose({
        operationId: 'secret-candidate',
        subjectKey: 'secret.candidate',
        kind: 'preference',
        content: secret,
      }),
    ]) {
      try {
        await operation()
        expect.unreachable('secret memory was stored')
      } catch (error) {
        expect(error).toBeInstanceOf(MemoryError)
        expect((error as MemoryError).code).toBe('SECRET_REJECTED')
      }
    }
    expect(await context.doppelgangerMemory.listCandidates()).toEqual([])
    await context.fiber.dispose()
  })
})
