import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { createActorIdentityPlugin } from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService } from '@doppelganger/doppelganger-sqlite'
import { MemoryError, MemoryService } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function session(instanceHome: string, sessionId: string) {
  const context = new Context()
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'aiden',
    sessionId,
    projectId: 'project-one',
    projectRoot: join(instanceHome, 'project'),
  }))
  await context.plugin(createActorIdentityPlugin('local-user'))
  await context.plugin(InstanceSqliteService, { home: instanceHome })
  await context.plugin(MemoryService)
  return context
}

async function root(): Promise<string> {
  const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-candidate-'))
  temporaryRoots.push(instanceHome)
  return instanceHome
}

describe('memory candidate lifecycle', () => {
  it('keeps candidates out of recall until manual approval and makes rejection terminal', async () => {
    const instanceHome = await root()
    const context = await session(instanceHome, 'session-one')
    const approved = context.doppelgangerMemory.propose({
      operationId: 'propose-approved',
      subjectKey: 'preference.interface.depth',
      kind: 'preference',
      content: 'Prefer narrow interfaces.',
    })
    const rejected = context.doppelgangerMemory.propose({
      operationId: 'propose-rejected',
      subjectKey: 'project.possible.fact',
      kind: 'fact',
      content: 'Possible temporary fact.',
    })
    expect(await context.doppelgangerMemory.search({ query: 'narrow temporary', tokenBudget: 100 })).toEqual([])
    expect(context.doppelgangerMemory.approve({ operationId: 'approve', candidateId: approved.id }))
      .toMatchObject({ status: 'active' })
    expect(context.doppelgangerMemory.reject({ operationId: 'reject', candidateId: rejected.id }))
      .toMatchObject({ status: 'rejected' })
    expect(context.doppelgangerMemory.listCandidates()).toEqual([])
    try {
      context.doppelgangerMemory.approve({ operationId: 'approve-rejected', candidateId: rejected.id })
      expect.unreachable('rejected candidate approved')
    } catch (error) {
      expect((error as MemoryError).code).toBe('NOT_FOUND')
    }
    await context.fiber.dispose()
  })

  it('requires distinct-session principal evidence for preference auto-promotion', async () => {
    const instanceHome = await root()
    const first = await session(instanceHome, 'session-one')
    const candidate = first.doppelgangerMemory.propose({
      operationId: 'propose-preference',
      subjectKey: 'preference.response.evidence',
      kind: 'preference',
      content: 'Prefer evidence-first answers.',
      scope: 'relationship',
      evidence: { turnId: 'turn-one', role: 'assistant' },
    })
    expect(first.doppelgangerMemory.observe({
      operationId: 'same-session-principal',
      recordId: candidate.id,
      turnId: 'turn-two',
      role: 'principal',
      relation: 'support',
      excerpt: 'Please prefer evidence-first answers.',
    }).status).toBe('candidate')
    await first.fiber.dispose()

    const second = await session(instanceHome, 'session-two')
    expect(second.doppelgangerMemory.observe({
      operationId: 'assistant-repeat',
      recordId: candidate.id,
      turnId: 'turn-three',
      role: 'assistant',
      relation: 'support',
      excerpt: 'I will prefer evidence-first answers.',
    }).status).toBe('candidate')
    expect(second.doppelgangerMemory.observe({
      operationId: 'second-principal',
      recordId: candidate.id,
      turnId: 'turn-four',
      role: 'principal',
      relation: 'support',
      excerpt: 'Evidence-first answers remain preferred.',
    }).status).toBe('active')
    await second.fiber.dispose()
  })

  it('represents inferred contradictions as reviewable conflicts without replacing active memory', async () => {
    const instanceHome = await root()
    const first = await session(instanceHome, 'session-one')
    const active = first.doppelgangerMemory.remember({
      operationId: 'remember-engine',
      subjectKey: 'project.database.engine',
      kind: 'decision',
      content: 'The project uses SQLite.',
    })
    const candidate = first.doppelgangerMemory.propose({
      operationId: 'propose-engine',
      subjectKey: 'project.database.engine',
      kind: 'decision',
      content: 'The project uses PostgreSQL.',
      evidence: { turnId: 'turn-one', role: 'principal' },
    })
    expect(candidate).toMatchObject({ status: 'candidate', hasUnresolvedConflict: true })
    const conflict = first.doppelgangerMemory.conflicts(candidate.id)[0]!
    expect(conflict).toMatchObject({ activeRecordId: active.id, candidateRecordId: candidate.id, status: 'unresolved' })
    expect((await first.doppelgangerMemory.search({ query: 'project database', tokenBudget: 100 }))
      .map(result => result.record.revision.content)).toEqual(['The project uses SQLite.'])
    await first.fiber.dispose()

    const second = await session(instanceHome, 'session-two')
    expect(second.doppelgangerMemory.observe({
      operationId: 'support-postgres',
      recordId: candidate.id,
      turnId: 'turn-two',
      role: 'principal',
      relation: 'support',
      excerpt: 'The project uses PostgreSQL.',
    }).status).toBe('candidate')
    const resolved = second.doppelgangerMemory.resolveConflict({
      operationId: 'resolve-postgres',
      conflictId: conflict.id,
      expectedRevisionId: active.revision.id,
      resolution: 'promote-candidate',
    })
    expect(resolved.revision).toMatchObject({
      content: 'The project uses PostgreSQL.',
      supersedesRevisionId: active.revision.id,
      sourceKind: 'conflict-resolution',
    })
    expect(second.doppelgangerMemory.history(active.id)).toHaveLength(2)
    expect(second.doppelgangerMemory.inspect(candidate.id).status).toBe('rejected')
    await second.fiber.dispose()
  })

  it('blocks promotion when contradiction evidence exists', async () => {
    const instanceHome = await root()
    const first = await session(instanceHome, 'session-one')
    const candidate = first.doppelgangerMemory.propose({
      operationId: 'propose-fact',
      subjectKey: 'project.service.x',
      kind: 'fact',
      content: 'The project uses service X.',
      evidence: { turnId: 'turn-one', role: 'principal' },
    })
    await first.fiber.dispose()

    const second = await session(instanceHome, 'session-two')
    expect(second.doppelgangerMemory.corroborate({
      operationId: 'contradict-service',
      candidateId: candidate.id,
      turnId: 'turn-two',
      content: 'The project does not use service X.',
      role: 'principal',
      contradiction: true,
    }).status).toBe('candidate')
    await second.fiber.dispose()

    const third = await session(instanceHome, 'session-three')
    expect(third.doppelgangerMemory.corroborate({
      operationId: 'support-service',
      candidateId: candidate.id,
      turnId: 'turn-three',
      content: 'Another principal observation mentions service X.',
      role: 'principal',
    }).status).toBe('candidate')
    await third.fiber.dispose()
  })
})
