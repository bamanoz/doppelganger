import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/extension-persona'
import {
  ContextProtocol,
  ToolRegistry,
  type JsonValue,
} from '@doppelganger/extension-protocols'
import { InstanceSqliteService } from '@doppelganger/extension-sqlite'
import { MemoryProtocolPlugin, MemoryService } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function resultObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('expected object result')
  return value as Readonly<Record<string, JsonValue>>
}

describe('memory protocol', () => {
  it('registers complete schemas and contributes authority-aware whole memory records', async () => {
    const instanceHome = await mkdtemp(join(tmpdir(), 'doppelganger-memory-protocol-'))
    temporaryRoots.push(instanceHome)
    const context = new Context()
    await context.plugin(createPersonaActivationPlugin({
      instanceId: 'aiden',
      principalId: 'local-user',
      sessionId: 'protocol-session',
      projectId: 'project-one',
      projectRoot: join(instanceHome, 'project'),
      instanceHome,
      definitionRoot: instanceHome,
    }))
    await context.plugin(InstanceSqliteService, { home: instanceHome })
    await context.plugin(ContextProtocol)
    await context.plugin(ToolRegistry)
    await context.plugin(MemoryService)
    const protocol = await context.plugin(MemoryProtocolPlugin)

    expect(context.doppelgangerTools.list().map(tool => tool.name)).toEqual([
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
    const rememberSchema = context.doppelgangerTools.list().find(tool => tool.name === 'memory.remember')!.inputSchema
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

    const preferenceResult = await context.doppelgangerTools.invoke('memory.remember', {
      operationId: 'remember-preference',
      subjectKey: 'preference.response.evidence',
      kind: 'preference',
      content: 'Prefer evidence in technical answers.',
      scope: 'relationship',
    })
    const factResult = await context.doppelgangerTools.invoke('memory.remember', {
      operationId: 'remember-fact',
      subjectKey: 'project.storage.engine',
      kind: 'fact',
      content: 'Project evidence is stored in SQLite.',
    })
    expect(preferenceResult.ok).toBe(true)
    expect(factResult.ok).toBe(true)
    if (!preferenceResult.ok) throw new Error(preferenceResult.error.message)
    const preference = resultObject(preferenceResult.value)
    await context.doppelgangerTools.invoke('memory.pin', {
      operationId: 'pin-preference',
      id: preference.id!,
    })

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

    const secret = await context.doppelgangerTools.invoke('memory.remember', {
      operationId: 'secret',
      subjectKey: 'secret.token',
      kind: 'fact',
      content: 'api_key = sk_live_1234567890abcdefgh',
    })
    expect(secret).toMatchObject({ ok: false, error: { code: 'SECRET_REJECTED' } })
    await protocol.dispose()
    expect(context.doppelgangerTools.list()).toEqual([])
    await context.fiber.dispose()
  })
})
