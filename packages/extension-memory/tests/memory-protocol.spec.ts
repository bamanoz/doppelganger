import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  ContextProtocol,
  createActorIdentityPlugin,
  ToolRegistry,
  type JsonValue,
} from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService } from '@doppelganger/doppelganger-sqlite'
import { MemoryPlugin, MemoryProtocolPlugin, MemoryService, type MemoryPluginConfig } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function resultObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('expected object result')
  return value as Readonly<Record<string, JsonValue>>
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
    await context.plugin(InstanceSqliteService, { home: instanceHome })
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
    await context.plugin(InstanceSqliteService, { home: instanceHome })
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
    await context.plugin(InstanceSqliteService, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)
    await context.plugin(MemoryService, { now: () => new Date('2026-09-02T12:00:00.000Z') })
    await context.plugin(MemoryProtocolPlugin)

    const identity = context.doppelgangerMemory.remember({
      operationId: 'remember-principal-name',
      subjectKey: 'principal.identity.name',
      kind: 'fact',
      content: 'Пользователя зовут Валера.',
      scope: 'relationship',
    })
    const preference = context.doppelgangerMemory.remember({
      operationId: 'remember-stable-preference',
      subjectKey: 'preference.response.concision',
      kind: 'preference',
      content: 'Отвечай кратко.',
      scope: 'relationship',
    })
    context.doppelgangerMemory.pin({
      operationId: 'pin-stable-preference',
      id: preference.id,
      pinned: true,
    })
    context.doppelgangerMemory.remember({
      operationId: 'remember-unpinned-preference',
      subjectKey: 'preference.response.language',
      kind: 'preference',
      content: 'Всегда отвечай по-французски.',
      scope: 'relationship',
    })
    context.doppelgangerMemory.remember({
      operationId: 'remember-expired-identity',
      subjectKey: 'principal.identity.former-city',
      kind: 'fact',
      content: 'Валера живёт в устаревшем городе.',
      scope: 'relationship',
      expiresAt: '2026-09-01T00:00:00.000Z',
    })
    context.doppelgangerMemory.remember({
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
    expect(assembled.content).not.toContain('Всегда отвечай по-французски.')
    expect(assembled.content).not.toContain('Валера живёт в устаревшем городе.')
    expect(assembled.content).not.toContain('Проект использует SQLite.')

    const constrained = await context.doppelgangerContext.resolve({
      turn: { input: 'SQLite' },
      tokenBudget: assembled.tokenCount,
    })
    expect(constrained.contributions.map(contribution => contribution.source)).toEqual([
      `memory.${preference.id}`,
      `memory.${identity.id}`,
    ])
    expect(constrained.omittedSources).toHaveLength(1)
    expect(constrained.content).not.toContain('Проект использует SQLite.')
    await context.fiber.dispose()
  })

})
