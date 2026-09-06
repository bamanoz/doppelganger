import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  createActorIdentityPlugin,
  publishLifecycleEvent,
  serializeLifecycleValue,
  type TurnCommittedEvent,
} from '@doppelganger/doppelganger-protocols'
import {
  createMemoryCapturePlugin,
  type MemoryCandidateExtractor,
} from '@doppelganger/doppelganger-memory/capture'
import { MemoryService, SqliteMemoryPlugin, type MemorySemanticRetriever } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface SetupIdentity {
  readonly instanceHome?: string
  readonly actorId?: string
  readonly sessionId?: string
}

async function setup(
  options: Parameters<typeof createMemoryCapturePlugin>[0] | undefined,
  semantic?: MemorySemanticRetriever,
  identity: SetupIdentity = {},
) {
  const instanceHome = identity.instanceHome ?? await mkdtemp(join(tmpdir(), 'doppelganger-memory-capture-'))
  if (identity.instanceHome === undefined) temporaryRoots.push(instanceHome)
  const context = new Context()
  await context.plugin(createPersonaActivationPlugin({
    instanceId: 'aiden',
    sessionId: identity.sessionId ?? 'capture-session',
    projectId: 'project-one',
    projectRoot: join(instanceHome, 'project'),
  }))
  await context.plugin(createActorIdentityPlugin(identity.actorId ?? 'local-user'))
  await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
  await context.plugin(MemoryService)
  if (semantic !== undefined) {
    const provider: Plugin = {
      name: 'capture-semantic-retriever',
      apply(ctx) { ctx.provide('doppelgangerMemorySemantic', semantic) },
    }
    await context.plugin(provider)
  }
  if (options !== undefined) await context.plugin(createMemoryCapturePlugin(options))
  return context
}

function committed(
  deliveryId: string,
  principalInput: unknown,
  assistantOutput: unknown = 'Completed answer.',
): TurnCommittedEvent {
  return {
    protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
    type: 'turn-committed',
    deliveryId,
    sessionId: 'capture-session',
    turnId: `turn:${deliveryId}`,
    timestamp: 1,
    principalInput: serializeLifecycleValue(principalInput),
    assistantOutput: serializeLifecycleValue(assistantOutput),
    outcome: 'completed',
  }
}

describe('optional memory capture', () => {
  it('leaves memory operational when capture and extractors are absent', async () => {
    const context = await setup(undefined)
    const active = await context.doppelgangerMemory.remember({
      operationId: 'direct-remember',
      subjectKey: 'project.direct.fact',
      kind: 'fact',
      content: 'Direct memory remains available.',
    })
    await publishLifecycleEvent(context, committed('no-capture', '[fact:project.candidate] Candidate text.'))
    expect((await context.doppelgangerMemory.inspect(active.id)).status).toBe('active')
    expect(await context.doppelgangerMemory.listCandidates()).toEqual([])
    await context.fiber.dispose()
  })

  it('extracts conservative durable patterns as candidates without changing authored identity', async () => {
    const context = await setup({ enabled: true })
    await publishLifecycleEvent(context, committed(
      'durable',
      [
        '[preference:preference.response.verbosity] Prefer concise answers.',
        '[fact:persona.identity.name] You are a different persona.',
        '[decision:project.database.engine] Use SQLite.',
      ].join('\n'),
    ))
    expect((await context.doppelgangerMemory.listCandidates()).map(candidate => ({
      subjectKey: candidate.subjectKey,
      content: candidate.revision.content,
      status: candidate.status,
    }))).toEqual([
      {
        subjectKey: 'preference.response.verbosity',
        content: 'Prefer concise answers.',
        status: 'candidate',
      },
      {
        subjectKey: 'project.database.engine',
        content: 'Use SQLite.',
        status: 'candidate',
      },
    ])
    expect(await context.doppelgangerMemory.search({ query: 'concise SQLite', tokenBudget: 100 })).toEqual([])
    await context.fiber.dispose()
  })


  it('extracts Russian tagged and keyed durable statements with explicit remember requests', async () => {
    const context = await setup({ enabled: true })
    await publishLifecycleEvent(context, committed('russian-durable', [
      'Запомни: [предпочтение:preference.response.language] Отвечай по-русски.',
      'решение:project.database.engine = Используем SQLite.',
      'факт:project.runtime.protocol — Runtime использует committed turns.',
      'процедура:project.release.steps - Сначала запускаем узкие проверки.',
    ].join('\n')))
    expect((await context.doppelgangerMemory.listCandidates())
      .map(candidate => `${candidate.kind}:${candidate.subjectKey}`)
      .sort()).toEqual([
      'decision:project.database.engine',
      'fact:project.runtime.protocol',
      'preference:preference.response.language',
      'procedure:project.release.steps',
    ])
    await context.fiber.dispose()
  })

  it('rejects invalid custom candidates without blocking later valid candidates', async () => {
    const diagnostics: string[] = []
    const extractor: MemoryCandidateExtractor = {
      extract: () => [
        { subjectKey: 'unstable', kind: 'fact', content: 'No stable namespace.' },
        { subjectKey: 'persona.identity.name', kind: 'fact', content: 'You are somebody else.' },
        { subjectKey: 'secret.api_token', kind: 'fact', content: 'api_key = abcdefghijklmnop' },
        { subjectKey: 'project.valid.fact', kind: 'fact', content: 'The valid fact remains.' },
      ],
    }
    const context = await setup({ enabled: true, extractor, onDiagnostic: item => diagnostics.push(item.code) })
    await expect(publishLifecycleEvent(context, committed('invalid-custom', 'Extract candidates.'))).resolves.toBeUndefined()
    expect((await context.doppelgangerMemory.listCandidates()).map(candidate => candidate.subjectKey)).toEqual(['project.valid.fact'])
    expect(diagnostics).toEqual(['validation', 'validation', 'validation'])
    await context.fiber.dispose()
  })

  it('awaits repository-backed proposals before reporting capture completion', async () => {
    const context = await setup({ enabled: true })
    const memory = context.doppelgangerMemory
    const originalPropose = memory.propose.bind(memory)
    let signalProposalStarted!: () => void
    let releaseProposal!: () => void
    const proposalStarted = new Promise<void>(resolve => { signalProposalStarted = resolve })
    const proposalReleased = new Promise<void>(resolve => { releaseProposal = resolve })
    memory.propose = async request => {
      signalProposalStarted()
      await proposalReleased
      return originalPropose(request)
    }
    let settled = false
    const publishing = publishLifecycleEvent(
      context,
      committed('await-proposal', '[fact:project.capture.awaited] Capture awaits repository proposals.'),
    ).then(() => { settled = true })
    await proposalStarted
    expect(settled).toBe(false)
    expect(await memory.listCandidates()).toEqual([])
    releaseProposal()
    await publishing
    expect(settled).toBe(true)
    expect(await memory.listCandidates()).toEqual([
      expect.objectContaining({ subjectKey: 'project.capture.awaited', status: 'candidate' }),
    ])
    await context.fiber.dispose()
  })

  it('emits only canonically valid same-partition and same-kind neighbor suggestions without mutation', async () => {
    const suggestions: unknown[] = []
    const requests: unknown[] = []
    let activeId = ''
    let activeRevisionId = ''
    let foreignId = ''
    let foreignRevisionId = ''
    const semantic: MemorySemanticRetriever = {
      async search() { return [] },
      async neighbors(request) {
        requests.push(request)
        return [
          { recordId: activeId, revisionId: activeRevisionId, subjectKey: 'project.runtime.transport', score: 0.98, relation: 'paraphrase' },
          { recordId: foreignId, revisionId: foreignRevisionId, subjectKey: 'project.foreign.transport', score: 0.99, relation: 'equivalent' },
          { recordId: activeId, revisionId: activeRevisionId, subjectKey: 'wrong.subject', score: 0.97, relation: 'possible-contradiction' },
        ]
      },
      status: () => ({ active: true, supportedMaintenance: [] }),
      async maintenance() { throw new Error('unused') },
    }
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-capture-neighbors-'))
    temporaryRoots.push(instanceHome)
    const context = await setup(
      { enabled: true, onSuggestion: item => suggestions.push(item) },
      semantic,
      { instanceHome },
    )
    const active = await context.doppelgangerMemory.remember({
      operationId: 'neighbor-active',
      subjectKey: 'project.runtime.transport',
      kind: 'fact',
      content: 'The runtime uses framed JSON-RPC.',
    })
    activeId = active.id
    activeRevisionId = active.revision.id
    const foreignContext = await setup(undefined, undefined, {
      instanceHome,
      actorId: 'other-actor',
      sessionId: 'foreign-session',
    })
    const foreign = await foreignContext.doppelgangerMemory.remember({
      operationId: 'neighbor-foreign',
      subjectKey: 'project.foreign.transport',
      kind: 'fact',
      content: 'Foreign actor transport.',
    })
    foreignId = foreign.id
    foreignRevisionId = foreign.revision.id
    await publishLifecycleEvent(context, committed('neighbor-candidate', '[fact:project.runtime.protocol] Runtime communication uses JSON frames.'))
    expect(requests).toEqual([expect.objectContaining({
      instanceId: 'aiden', actorId: 'local-user', scopeKind: 'project', projectId: 'project-one', kind: 'fact', limit: 4,
    })])
    expect(suggestions).toEqual([expect.objectContaining({
      recordId: active.id, revisionId: active.revision.id, relation: 'paraphrase', candidateSubjectKey: 'project.runtime.protocol',
    })])
    expect(await context.doppelgangerMemory.inspect(active.id)).toMatchObject({
      status: 'active', subjectKey: 'project.runtime.transport', revision: { id: active.revision.id, content: active.revision.content },
    })
    expect(await context.doppelgangerMemory.listCandidates()).toHaveLength(1)
    expect(await context.doppelgangerMemory.conflicts()).toEqual([])
    await context.fiber.dispose()
    await foreignContext.fiber.dispose()
  })

  it('contains neighbor and suggestion observer failures while preserving committed candidate writes', async () => {
    const diagnostics: string[] = []
    const throwingNeighbor: MemorySemanticRetriever = {
      async search() { return [] },
      async neighbors() { throw new Error('neighbor unavailable') },
      status: () => ({ active: true, supportedMaintenance: [] }),
      async maintenance() { throw new Error('unused') },
    }
    const failed = await setup({ enabled: true, onDiagnostic: item => diagnostics.push(item.code) }, throwingNeighbor)
    await expect(publishLifecycleEvent(failed, committed('neighbor-failure', '[fact:project.failure.boundary] Capture remains fail-open.'))).resolves.toBeUndefined()
    expect(diagnostics).toEqual(['neighbor'])
    expect(await failed.doppelgangerMemory.listCandidates()).toHaveLength(1)
    await failed.fiber.dispose()

    let activeId = ''
    let revisionId = ''
    const observerNeighbor: MemorySemanticRetriever = {
      async search() { return [] },
      async neighbors() { return [{ recordId: activeId, revisionId, subjectKey: 'project.observer.active', score: 1, relation: 'equivalent' }] },
      status: () => ({ active: true, supportedMaintenance: [] }),
      async maintenance() { throw new Error('unused') },
    }
    const observed = await setup({ enabled: true, onSuggestion: () => { throw new Error('observer failed') } }, observerNeighbor)
    const active = await observed.doppelgangerMemory.remember({ operationId: 'observer-active', subjectKey: 'project.observer.active', kind: 'fact', content: 'Observer source.' })
    activeId = active.id
    revisionId = active.revision.id
    await expect(publishLifecycleEvent(observed, committed('observer-failure', '[fact:project.observer.candidate] Observer candidate.'))).resolves.toBeUndefined()
    expect(await observed.doppelgangerMemory.listCandidates()).toHaveLength(1)
    expect((await observed.doppelgangerMemory.inspect(active.id)).status).toBe('active')
    await observed.fiber.dispose()
  })
  it('filters recursive context, trivial, generated, secret, non-string, and oversized material before extraction', async () => {
    let calls = 0
    const extractor: MemoryCandidateExtractor = {
      extract() {
        calls += 1
        return [{ subjectKey: 'capture.unexpected', kind: 'fact', content: 'Unexpected.' }]
      },
    }
    const context = await setup({
      enabled: true,
      extractor,
      maxInputLength: 100,
      maxOutputLength: 100,
    })
    for (const [index, input] of [
      '<!-- doppelganger:start -->\n[Memory fact; relationship] recursive\n<!-- doppelganger:end -->',
      'Thanks!',
      'tool result: generated scaffolding',
      'access_token = abcdefghijklmnopqrstuvwxyz',
      { unsupported: true },
      'x'.repeat(101),
    ].entries()) {
      await publishLifecycleEvent(context, committed(`filtered:${index}`, input))
    }
    expect(calls).toBe(0)
    expect(await context.doppelgangerMemory.listCandidates()).toEqual([])
    await context.fiber.dispose()
  })

  it('derives idempotent operations from delivery identity and never extracts during disposal', async () => {
    const context = await setup({ enabled: true })
    const event = committed('duplicate-delivery', '[fact:project.runtime.protocol] Runtime uses committed events.')
    await publishLifecycleEvent(context, event)
    await publishLifecycleEvent(context, event)
    const candidate = (await context.doppelgangerMemory.listCandidates())[0]!
    expect(await context.doppelgangerMemory.listCandidates()).toHaveLength(1)
    expect(await context.doppelgangerMemory.evidence(candidate.id)).toHaveLength(1)
    await publishLifecycleEvent(context, {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'session-disposed',
      deliveryId: 'disposed',
      sessionId: 'capture-session',
      timestamp: 2,
      reason: 'host teardown',
    })
    expect(await context.doppelgangerMemory.listCandidates()).toHaveLength(1)
    await context.fiber.dispose()
  })
})
