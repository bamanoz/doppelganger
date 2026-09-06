import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  ContextProtocol,
  createActorIdentityPlugin,
  ToolRegistry,
  type JsonValue,
} from '@doppelganger/doppelganger-protocols'
import {
  MemoryPlugin,
  MemoryProtocolPlugin,
  MemoryService,
  SqliteMemoryPlugin,
  type MemoryEmbedderIdentity,
  type MemoryPluginConfig,
  type MemorySemanticRetriever,
  type MemoryVectorIndexIdentity,
} from '../src/index.ts'
import { memoryProjectionOwner } from '../src/projection-store.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function resultObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('expected object result')
  return value as Readonly<Record<string, JsonValue>>
}

const embedderIdentity: MemoryEmbedderIdentity = {
  provider: 'test', modelId: 'test-embedder', revision: '1',
  artifactDigest: `sha256:${'a'.repeat(64)}`,
  pooling: 'mean', projection: 'none', dimensions: 3, normalized: true, distanceMetric: 'cosine',
}
const vectorIndexIdentity: MemoryVectorIndexIdentity = {
  backend: 'sqlite_exact', namespace: 'memory-protocol', sanitizedTarget: 'test memory protocol index',
  configFingerprint: 'b'.repeat(64), dimensions: 3, distanceMetric: 'cosine',
}

async function activateSemanticGeneration(
  context: Context,
  instanceId: string,
  generationId: string,
  timestamp: string,
): Promise<void> {
  const transitionUntil = new Date(new Date(timestamp).getTime() + 300_000).toISOString()
  const owner = memoryProjectionOwner(instanceId, generationId, embedderIdentity, vectorIndexIdentity)
  let transition = await context.doppelgangerMemory.projectionStore.prepareGeneration(
    owner,
    JSON.stringify(embedderIdentity),
    JSON.stringify(vectorIndexIdentity),
    timestamp,
    transitionUntil,
  )
  if (transition === undefined) throw new Error('semantic generation transition was not acquired')
  const page = await context.doppelgangerMemory.projectionStore.rebuildPage(owner, transition, undefined, 10_000, timestamp)
  transition = await context.doppelgangerMemory.projectionStore.markRebuildPage(
    owner,
    transition,
    page,
    timestamp,
    transitionUntil,
  )
  if (transition === undefined || !(await context.doppelgangerMemory.projectionStore.activateGeneration(owner, transition, timestamp))) {
    throw new Error('semantic generation was not activated')
  }
}

describe('memory protocol', () => {
  it('rejects obsolete and unsupported memory configuration fields', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-config-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'aiden',
      sessionId: 'config-session',
    }))
    await context.plugin(createActorIdentityPlugin('local-user'))
    await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)

    const legacy = context.plugin(MemoryPlugin, {
      principalId: 'legacy-user',
    } as unknown as MemoryPluginConfig)
    await expect(legacy.await()).rejects.toThrow('memory.principalId is not supported')

    const unsupported = context.plugin(MemoryPlugin, {
      unsupported: true,
    } as unknown as MemoryPluginConfig)
    await expect(unsupported.await()).rejects.toThrow('memory.unsupported is not supported')
    await context.fiber.dispose()
  })

  it('registers complete schemas and contributes authority-aware whole memory records', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-protocol-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'aiden',
      sessionId: 'protocol-session',
      projectId: 'project-one',
      projectRoot: join(instanceHome, 'project'),
    }))
    await context.plugin(createActorIdentityPlugin('local-user'))
    await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)
    await context.plugin(MemoryService)
    const protocol = await context.plugin(MemoryProtocolPlugin)

    expect(context.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toEqual([
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
    const rememberSchema = context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.remember')!.inputSchema
    expect(rememberSchema).toMatchObject({
      type: 'object',
      required: ['operationId', 'subjectKey', 'content', 'kind'],
      additionalProperties: false,
      properties: {
        subjectKey: { type: 'string' },
        kind: { enum: ['decision', 'fact', 'preference', 'procedure'] },
        scope: { enum: ['relationship', 'project'] },
        confidence: { minimum: 0, maximum: 1 },
        expiresAt: { type: 'string' },
      },
    })

    for (const identityField of ['principalId', 'actorId'] as const) {
      const rejected = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.remember', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.remember')!.revision, input: {
        operationId: `reject-${identityField}`,
        subjectKey: 'identity.override',
        kind: 'fact',
        content: 'Tool input must not select a memory identity.',
        [identityField]: 'override',
      } }, 'test-session')
      expect(rejected).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }

    const preferenceResult = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.remember', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.remember')!.revision, input: {
      operationId: 'remember-preference',
      subjectKey: 'preference.response.evidence',
      kind: 'preference',
      content: 'Prefer evidence in technical answers.',
      scope: 'relationship',
    } }, 'test-session')
    const factResult = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.remember', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.remember')!.revision, input: {
      operationId: 'remember-fact',
      subjectKey: 'project.storage.engine',
      kind: 'fact',
      content: 'Project evidence is stored in SQLite.',
    } }, 'test-session')
    expect(preferenceResult.ok).toBe(true)
    expect(factResult.ok).toBe(true)
    if (!preferenceResult.ok) throw new Error(preferenceResult.error.message)
    const preference = resultObject(preferenceResult.value)
    await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.pin', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.pin')!.revision, input: {
      operationId: 'pin-preference',
      id: preference.id!,
    } }, 'test-session')

    const assembled = await context.doppelgangerContext.resolve({
      turn: { input: 'technical evidence SQLite' },
      tokenBudget: 100,
    })
    expect(assembled.contributions).toEqual([
      expect.objectContaining({
        source: `memory.${String(preference.id)}`,
        authority: 'instruction',
        priority: 700,
        content: expect.stringContaining('subject=preference.response.evidence'),
      }),
      expect.objectContaining({
        authority: 'data',
        priority: 100,
        content: expect.stringContaining('Project evidence is stored in SQLite.'),
      }),
    ])

    const secret = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'memory.remember', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.remember')!.revision, input: {
      operationId: 'secret',
      subjectKey: 'secret.token',
      kind: 'fact',
      content: 'api_key = sk_live_1234567890abcdefgh',
    } }, 'test-session')
    expect(secret).toMatchObject({ ok: false, error: { code: 'SECRET_REJECTED' } })
    await protocol.dispose()
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    await context.fiber.dispose()
  })

  it('awaits forget before projecting its deleted result', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-protocol-forget-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'aiden',
      sessionId: 'protocol-forget-session',
      projectId: 'project-one',
      projectRoot: join(instanceHome, 'project'),
    }))
    await context.plugin(createActorIdentityPlugin('local-user'))
    await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)
    await context.plugin(MemoryService)
    await context.plugin(MemoryProtocolPlugin)
    const memory = context.doppelgangerMemory
    const record = await memory.remember({
      operationId: 'protocol-forget-seed',
      subjectKey: 'project.protocol.forget',
      kind: 'fact',
      content: 'This record will be forgotten.',
    })
    const originalForget = memory.forget.bind(memory)
    let signalForgetStarted!: () => void
    let releaseForget!: () => void
    const forgetStarted = new Promise<void>(resolve => { signalForgetStarted = resolve })
    const forgetReleased = new Promise<void>(resolve => { releaseForget = resolve })
    memory.forget = async request => {
      signalForgetStarted()
      await forgetReleased
      return originalForget(request)
    }
    const forgetTool = context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'memory.forget')!
    let settled = false
    const invocation = context.doppelgangerTools.invoke({
      callId: crypto.randomUUID(),
      name: 'memory.forget',
      toolRevision: forgetTool.revision,
      input: { operationId: 'protocol-forget', id: record.id },
    }, 'test-session').then(result => {
      settled = true
      return result
    })
    await forgetStarted
    expect(settled).toBe(false)
    expect(await memory.get(record.id)).toBeDefined()
    releaseForget()
    expect(await invocation).toMatchObject({ ok: true, value: { deleted: true } })
    expect(await memory.get(record.id)).toBeUndefined()
    await context.fiber.dispose()
  })
  it('automatically recalls stable relationship profile without lexical overlap', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-stable-recall-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'smith',
      sessionId: 'stable-recall-session',
      projectId: 'project-one',
      projectRoot: join(instanceHome, 'project'),
    }))
    await context.plugin(createActorIdentityPlugin('valera'))
    await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)
    await context.plugin(MemoryService, { now: () => new Date('2026-09-02T12:00:00.000Z') })
    await context.plugin(MemoryProtocolPlugin)

    const identity = await context.doppelgangerMemory.remember({
      operationId: 'remember-principal-name',
      subjectKey: 'principal.identity.name',
      kind: 'fact',
      content: 'Пользователя зовут Валера.',
      scope: 'relationship',
    })
    const preference = await context.doppelgangerMemory.remember({
      operationId: 'remember-stable-preference',
      subjectKey: 'preference.response.concision',
      kind: 'preference',
      content: 'Отвечай кратко.',
      scope: 'relationship',
    })
    await context.doppelgangerMemory.pin({
      operationId: 'pin-stable-preference',
      id: preference.id,
      pinned: true,
    })
    const unpinnedPreferenceRecord = await context.doppelgangerMemory.remember({
      operationId: 'remember-unpinned-preference',
      subjectKey: 'preference.response.language',
      kind: 'preference',
      content: 'Всегда отвечай по-французски.',
      scope: 'relationship',
    })
    const unpinnedPreference = await context.doppelgangerContext.resolve({
      turn: { input: 'французски' },
      tokenBudget: 100,
    })
    expect(unpinnedPreference.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: `memory.${unpinnedPreferenceRecord.id}`,
        authority: 'instruction',
        content: expect.stringContaining('Всегда отвечай по-французски.'),
      }),
    ]))
    await context.doppelgangerMemory.remember({
      operationId: 'remember-expired-identity',
      subjectKey: 'principal.identity.former-city',
      kind: 'fact',
      content: 'Валера живёт в устаревшем городе.',
      scope: 'relationship',
      expiresAt: '2026-09-01T00:00:00.000Z',
    })
    await context.doppelgangerMemory.remember({
      operationId: 'remember-unrelated-project-fact',
      subjectKey: 'project.storage.engine',
      kind: 'fact',
      content: 'Проект использует SQLite.',
    })

    const assembled = await context.doppelgangerContext.resolve({
      turn: { input: 'Как ко мне обращаться?' },
      tokenBudget: 100,
    })

    expect(assembled.contributions).toEqual([
      expect.objectContaining({
        source: `memory.${preference.id}`,
        authority: 'instruction',
        priority: 700,
      }),
      expect.objectContaining({
        source: `memory.${identity.id}`,
        authority: 'data',
        priority: 300,
        content: expect.stringContaining('Пользователя зовут Валера.'),
      }),
    ])
    expect(assembled.instructions).not.toContain('Всегда отвечай по-французски.')
    expect(assembled.data).not.toContain('Валера живёт в устаревшем городе.')
    expect(assembled.data).not.toContain('Проект использует SQLite.')

    const constrained = await context.doppelgangerContext.resolve({
      turn: { input: 'SQLite' },
      tokenBudget: assembled.tokenCount,
    })
    expect(constrained.contributions.map(contribution => contribution.source)).toEqual([
      `memory.${preference.id}`,
      `memory.${identity.id}`,
    ])
    expect(constrained.omittedSources).toHaveLength(1)
    expect(constrained.data).not.toContain('Проект использует SQLite.')
    await context.fiber.dispose()
  })

  it('revalidates stable and ranked memory after asynchronous recall', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-final-revalidation-'))
    temporaryRoots.push(instanceHome)
    let currentTime = '2026-09-02T12:00:00.000Z'
    let releaseSemantic!: () => void
    let semanticStarted!: () => void
    const semanticEntered = new Promise<void>(resolve => { semanticStarted = resolve })
    const semanticBlocked = new Promise<void>(resolve => { releaseSemantic = resolve })
    const semantic: MemorySemanticRetriever = {
      async search() {
        semanticStarted()
        await semanticBlocked
        return []
      },
      status: () => ({ active: true, supportedMaintenance: [] }),
      async maintenance() { throw new Error('maintenance is unsupported by the recall fixture') }, 
    }
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'smith',
      sessionId: 'final-revalidation-session',
    }))
    await context.plugin(createActorIdentityPlugin('valera'))
    await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)
    await context.plugin({
      name: 'pending-memory-semantic',
      apply(ctx) { ctx.provide('doppelgangerMemorySemantic', semantic) },
    })
    await context.plugin(MemoryService, { now: () => new Date(currentTime) })
    await context.plugin(MemoryProtocolPlugin)
    await activateSemanticGeneration(context, 'smith', 'pending-generation', currentTime)

    const corrected = await context.doppelgangerMemory.remember({
      operationId: 'remember-corrected-stable',
      subjectKey: 'principal.identity.corrected',
      kind: 'fact',
      content: 'The stale identity value.',
      scope: 'relationship',
    })
    const forgotten = await context.doppelgangerMemory.remember({
      operationId: 'remember-forgotten-stable',
      subjectKey: 'principal.identity.forgotten',
      kind: 'fact',
      content: 'This identity will be forgotten.',
      scope: 'relationship',
    })
    const expiring = await context.doppelgangerMemory.remember({
      operationId: 'remember-expiring-stable',
      subjectKey: 'principal.identity.expiring',
      kind: 'fact',
      content: 'This identity will expire.',
      scope: 'relationship',
      expiresAt: '2026-09-02T12:01:00.000Z',
    })
    const inactive = await context.doppelgangerMemory.remember({
      operationId: 'remember-inactive-stable',
      subjectKey: 'preference.response.inactive',
      kind: 'preference',
      content: 'This preference will become inactive.',
      scope: 'relationship',
    })
    await context.doppelgangerMemory.pin({ operationId: 'pin-inactive-stable', id: inactive.id, pinned: true })

    const resolving = context.doppelgangerContext.resolve({
      turn: { input: 'identity preference' },
      tokenBudget: 200,
    })
    await semanticEntered
    const current = await context.doppelgangerMemory.correct({
      operationId: 'correct-pending-stable',
      id: corrected.id,
      expectedRevisionId: corrected.revision.id,
      content: 'The current identity value.',
    })
    await context.doppelgangerMemory.forget({ operationId: 'forget-pending-stable', id: forgotten.id })
    currentTime = '2026-09-02T12:02:00.000Z'
    const database = new DatabaseSync(join(instanceHome, 'storage', 'memory.sqlite'))
    try {
      database.prepare(`UPDATE memory_records SET status = 'rejected' WHERE id = ?`).run(inactive.id)
    } finally {
      database.close()
    }
    releaseSemantic()

    const assembled = await resolving
    expect(assembled.contributions).toEqual([
      expect.objectContaining({
        source: `memory.${current.id}`,
        authority: 'data',
        content: expect.stringContaining('The current identity value.'),
      }),
    ])
    expect(assembled.data).not.toContain(corrected.revision.content)
    expect(assembled.data).not.toContain(forgotten.revision.content)
    expect(assembled.data).not.toContain(expiring.revision.content)
    expect(assembled.instructions).not.toContain(inactive.revision.content)
    await context.fiber.dispose()
  })

  it('budgets deduplicated stable and ranked recall as one selection', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-combined-budget-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    try {
      await context.plugin(createPersonaActivationPlugin({ instanceId: 'smith', sessionId: 'combined-budget' }))
      await context.plugin(createActorIdentityPlugin('actor'))
      await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
      await context.plugin(ContextProtocol)
      await context.plugin(ToolRegistry)
      await context.plugin(MemoryService)
      await context.plugin(MemoryProtocolPlugin)
      const memory = context.doppelgangerMemory
      const preference = await memory.remember({ operationId: 'preference', subjectKey: 'preference.evidence', kind: 'preference', scope: 'relationship', content: 'Prefer concrete evidence in answers.' })
      await memory.pin({ operationId: 'pin', id: preference.id, pinned: true })
      const identity = await memory.remember({ operationId: 'identity', subjectKey: 'principal.identity.name', kind: 'fact', scope: 'relationship', content: 'The principal is called Robin.' })
      const fact = await memory.remember({ operationId: 'fact', subjectKey: 'project.evidence', kind: 'fact', scope: 'relationship', content: 'Concrete evidence is stored in SQLite.' })
      const stable = await context.doppelgangerContext.resolve({ turn: { input: 'greetings' }, tokenBudget: 1000 })
      expect(stable.contributions.map(item => item.source)).toEqual([`memory.${preference.id}`, `memory.${identity.id}`])
      const full = await context.doppelgangerContext.resolve({ turn: { input: 'evidence' }, tokenBudget: 1000 })
      expect(full.contributions.map(item => item.source)).toEqual([`memory.${preference.id}`, `memory.${identity.id}`, `memory.${fact.id}`])
      const constrained = await context.doppelgangerContext.resolve({ turn: { input: 'evidence' }, tokenBudget: stable.tokenCount })
      expect(constrained.contributions).toEqual(stable.contributions)
      expect(constrained.tokenCount).toBeLessThanOrEqual(stable.tokenCount)
      expect(constrained.omittedSources).toEqual([`memory.${fact.id}`])
      expect(constrained.instructions).toContain(preference.revision.content)
      expect(constrained.data).toContain(identity.revision.content)
      expect(constrained.data).not.toContain(fact.revision.content)
    } finally { await context.fiber.dispose() }
  })

  it('preserves approved preference authority independently of pinning', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-unpinned-authority-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    try {
      await context.plugin(createPersonaActivationPlugin({ instanceId: 'smith', sessionId: 'unpinned-authority' }))
      await context.plugin(createActorIdentityPlugin('actor'))
      await context.plugin(SqliteMemoryPlugin, { home: instanceHome })
      await context.plugin(ContextProtocol)
      await context.plugin(ToolRegistry)
      await context.plugin(MemoryService)
      await context.plugin(MemoryProtocolPlugin)
      const memory = context.doppelgangerMemory
      const preference = await memory.remember({ operationId: 'preference', subjectKey: 'preference.evidence', kind: 'preference', scope: 'relationship', content: 'Prefer concrete evidence in answers.' })
      const fact = await memory.remember({ operationId: 'fact', subjectKey: 'project.evidence', kind: 'fact', scope: 'relationship', content: 'Concrete evidence is stored in SQLite.' })
      const unrelated = await context.doppelgangerContext.resolve({ turn: { input: 'greetings' }, tokenBudget: 1000 })
      expect(unrelated.contributions).toEqual([])
      const selected = await context.doppelgangerContext.resolve({ turn: { input: 'evidence' }, tokenBudget: 1000 })
      expect(selected.contributions).toHaveLength(2)
      expect(selected.contributions).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: `memory.${preference.id}`, authority: 'instruction' }),
        expect.objectContaining({ source: `memory.${fact.id}`, authority: 'data' }),
      ]))
      expect(selected.instructions).toContain(preference.revision.content)
      expect(selected.data).toContain(fact.revision.content)
      expect(selected.instructions).not.toContain(fact.revision.content)
      const empty = await context.doppelgangerContext.resolve({ turn: { input: 'evidence' }, tokenBudget: 0 })
      expect(empty.contributions).toEqual([])
    } finally { await context.fiber.dispose() }
  })

})
