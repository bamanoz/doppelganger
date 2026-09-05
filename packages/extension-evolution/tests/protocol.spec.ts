import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createRuntimeSessionMetadataPlugin } from '@doppelganger/doppelganger-composition-runtime'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import {
  ContextProtocol,
  LIFECYCLE_PROTOCOL_VERSION,
  createActorIdentityPlugin,
  createStructuredInference,
  publishLifecycleEvent,
  serializeLifecycleValue,
  STRUCTURED_INFERENCE_SERVICE,
  ToolRegistry,
  type JsonValue,
} from '@doppelganger/doppelganger-protocols'
import { InstanceSqliteService } from '@doppelganger/doppelganger-sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvolutionPlugin, EvolutionService, type EvolutionPluginConfig } from '../src/index.ts'
import { EvolutionProtocolPlugin } from '../src/protocol.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function base(home: string, actorId: string | null = 'actor-a'): Promise<Context> {
  const context = new Context()
  await context.plugin(createRuntimeSessionMetadataPlugin({ sessionId: 'session-a', runtimePresetId: 'test' }))
  await context.plugin(createActorIdentityPlugin(actorId ?? undefined))
  await context.plugin(createPersonaActivationPlugin({ instanceId: 'mark', sessionId: 'session-a' }))
  await context.plugin(InstanceSqliteService, { home })
  await context.plugin(ContextProtocol)
  await context.plugin(ToolRegistry)
  return context
}

function object(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('expected object')
  return value as Readonly<Record<string, JsonValue>>
}

describe('Evolution protocol', () => {
  it('registers exactly seven strict portable controls and removes effects on disposal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-protocol-'))
    roots.push(home)
    const context = await base(home)
    await context.plugin(EvolutionService, { id: () => crypto.randomUUID() })
    const protocol = await context.plugin(EvolutionProtocolPlugin)
    const tools = context.doppelgangerTools.snapshot().tools
    expect(tools.map(tool => tool.name)).toEqual([
      'evolution.inspect',
      'evolution.list',
      'evolution.propose',
      'evolution.reject',
      'evolution.reminder.record',
      'evolution.snooze',
      'evolution.transition',
    ])
    const transition = tools.find(tool => tool.name === 'evolution.transition')
    expect(transition?.inputSchema).toMatchObject({
      type: 'object',
      required: ['operationId', 'id', 'expectedRevision', 'target'],
      properties: { target: { type: 'string', enum: expect.arrayContaining(['reviewing', 'researching', 'done']) } },
      additionalProperties: false,
    })
    expect(transition?.inputSchema).not.toHaveProperty('oneOf')
    const invalid = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'evolution.propose', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'evolution.propose')!.revision, input: {
      operationId: 'invalid', kind: 'capability', scope: 'global', dedupeKey: 'capability.invalid',
      title: 'Invalid override', rationale: 'Actor override must be rejected.', actorId: 'other',
    } }, 'test-session')
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    const proposed = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'evolution.propose', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'evolution.propose')!.revision, input: {
      operationId: 'proposal', kind: 'capability', scope: 'global', dedupeKey: 'capability.search',
      title: 'Semantic search', rationale: 'Repeated repository searches need semantic retrieval.', tags: ['search'],
    } }, 'test-session')
    expect(proposed.ok).toBe(true)
    const proposal = object(proposed.ok ? proposed.value : null)
    if (typeof proposal.id !== 'string') throw new Error('expected proposal id')
    const irrelevant = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'evolution.transition', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'evolution.transition')!.revision, input: {
      operationId: 'irrelevant', id: proposal.id, expectedRevision: 1,
      target: 'researching', researchQuestion: 'Which option?', reviewSummary: 'Wrong target metadata.',
    } }, 'test-session')
    expect(irrelevant).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    const stale = await context.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'evolution.transition', toolRevision: context.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'evolution.transition')!.revision, input: {
      operationId: 'stale', id: proposal.id, expectedRevision: 2,
      target: 'researching', researchQuestion: 'Which option?',
    } }, 'test-session')
    expect(stale).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } })
    await protocol.dispose()
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    expect((await context.doppelgangerContext.resolve({ turn: { input: 'semantic search' }, tokenBudget: 1000 })).contributions).toEqual([])
    await context.fiber.dispose()
  })

  it('contributes bounded instruction context and one read-only relevant reminder candidate', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-context-'))
    roots.push(home)
    const context = await base(home)
    let now = new Date('2026-09-02T12:00:00.000Z')
    let ordinal = 0
    await context.plugin(EvolutionService, { now: () => now, id: () => `id-${++ordinal}` })
    await context.plugin(EvolutionProtocolPlugin)
    const first = await context.doppelgangerEvolution.propose({
      operationId: 'search-proposal', kind: 'capability', scope: 'global', dedupeKey: 'capability.semantic-search',
      title: 'Semantic search', rationale: 'Repository search needs reusable semantic retrieval.', tags: ['repository', 'search'],
    })
    await context.doppelgangerEvolution.propose({
      operationId: 'release-proposal', kind: 'capability', scope: 'global', dedupeKey: 'capability.release',
      title: 'Release automation', rationale: 'Automate release publishing.', tags: ['release'],
    })
    const empty = await context.doppelgangerContext.resolve({ turn: { input: '' }, tokenBudget: 1000 })
    expect(empty.contributions.map(item => item.source)).toEqual(['evolution.policy'])
    const unrelated = await context.doppelgangerContext.resolve({ turn: { input: 'translate this sentence' }, tokenBudget: 1000 })
    expect(unrelated.contributions.map(item => item.source)).toEqual(['evolution.policy'])
    const relevant = await context.doppelgangerContext.resolve({ turn: { input: 'improve repository semantic search' }, tokenBudget: 1000 })
    expect(relevant.contributions.map(item => item.source)).toEqual([
      'evolution.policy',
      `evolution.reminder.${first.id}`,
    ])
    expect((await context.doppelgangerEvolution.inspect(first.id)).proposal.reminders).toEqual([])
    const zero = await context.doppelgangerContext.resolve({ turn: { input: 'semantic search' }, tokenBudget: 0 })
    expect(zero.contributions).toEqual([])

    await context.doppelgangerEvolution.recordReminder({
      operationId: 'delivered', id: first.id, expectedRevision: 1, sessionId: 'session-a', turnId: 'turn-a',
    })
    const cooled = await context.doppelgangerContext.resolve({ turn: { input: 'semantic search' }, tokenBudget: 1000 })
    expect(cooled.contributions.map(item => item.source)).toEqual(['evolution.policy'])
    now = new Date('2026-09-09T12:00:00.000Z')
    const due = await context.doppelgangerContext.resolve({ turn: { input: 'semantic search' }, tokenBudget: 1000 })
    expect(due.contributions.some(item => item.source === `evolution.reminder.${first.id}`)).toBe(true)
    await context.fiber.dispose()
  })

  it('excludes rejected and currently snoozed proposals from reminders', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-terminal-reminders-'))
    roots.push(home)
    const context = await base(home)
    await context.plugin(EvolutionService, {
      now: () => new Date('2026-09-02T12:00:00.000Z'),
      id: () => crypto.randomUUID(),
    })
    await context.plugin(EvolutionProtocolPlugin)
    const rejected = await context.doppelgangerEvolution.propose({
      operationId: 'rejected-proposal', kind: 'capability', scope: 'global',
      dedupeKey: 'capability.rejected-reminder', title: 'Rejected release search',
      rationale: 'This otherwise relevant proposal will be rejected.', tags: ['release', 'search'],
    })
    await context.doppelgangerEvolution.reject({
      operationId: 'reject-proposal', id: rejected.id, expectedRevision: rejected.revision,
      reason: 'The user declined this opportunity.',
    })
    const snoozed = await context.doppelgangerEvolution.propose({
      operationId: 'snoozed-proposal', kind: 'capability', scope: 'global',
      dedupeKey: 'capability.snoozed-reminder', title: 'Snoozed release search',
      rationale: 'This otherwise relevant proposal is deferred.', tags: ['release', 'search'],
    })
    await context.doppelgangerEvolution.snooze({
      operationId: 'snooze-proposal', id: snoozed.id, expectedRevision: snoozed.revision,
      until: '2026-09-10T12:00:00.000Z', reason: 'Return after the current milestone.',
    })
    const resolved = await context.doppelgangerContext.resolve({
      turn: { input: 'improve release search' }, tokenBudget: 1000,
    })
    expect(resolved.contributions.map(item => item.source)).toEqual(['evolution.policy'])
    await context.fiber.dispose()
  })

  it('selects expired snoozes without mutating stored proposals or delivery state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-expired-read-only-'))
    roots.push(home)
    let now = new Date('2026-09-01T00:00:00.000Z')
    const context = await base(home)
    await context.plugin(EvolutionService, { now: () => now, id: () => crypto.randomUUID() })
    await context.plugin(EvolutionProtocolPlugin)
    const proposal = await context.doppelgangerEvolution.propose({
      operationId: 'expired-read-propose', kind: 'capability', scope: 'global',
      dedupeKey: 'capability.expired-read', title: 'Expired snooze search',
      rationale: 'A relevant proposal should be selected after its deadline without a write.', tags: ['search'],
    })
    const snoozed = await context.doppelgangerEvolution.snooze({
      operationId: 'expired-read-snooze', id: proposal.id, expectedRevision: proposal.revision,
      until: '2026-09-02T00:00:00.000Z', reason: 'Wait until the deadline.',
    })
    now = new Date('2026-09-03T00:00:00.000Z')
    const resolved = await context.doppelgangerContext.resolve({
      turn: { input: 'expired snooze search' }, tokenBudget: 1000,
    })
    expect(resolved.contributions.map(item => item.source)).toContain(`evolution.reminder.${proposal.id}`)
    const inspected = await context.doppelgangerEvolution.inspect(proposal.id)
    expect(inspected.proposal).toEqual(snoozed)
    expect(inspected.proposal.status).toBe('snoozed')
    expect(inspected.proposal.reminders).toEqual([])
    await context.fiber.dispose()
  })

  it('captures deterministic committed evidence by default and deduplicates lifecycle retries', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-signal-default-'))
    roots.push(home)
    const context = await base(home)
    await context.plugin(EvolutionPlugin, {
      capabilityPromotionMinTurns: 3,
      signalPromotionScore: 6,
    })
    for (let index = 0; index < 3; index += 1) {
      const toolEvent = {
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'tool-completed' as const,
        deliveryId: `tool-delivery-${index}`,
        sessionId: 'session-a',
        turnId: `turn-${index}`,
        callId: `call-${index}`,
        name: 'read',
        outcome: 'failed' as const,
        error: { code: 'ENOENT', message: 'Missing file.' },
        timestamp: Date.parse(`2026-09-04T00:0${index}:00.000Z`),
      }
      const turnEvent = {
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-committed' as const,
        deliveryId: `turn-delivery-${index}`,
        sessionId: 'session-a',
        turnId: `turn-${index}`,
        outcome: 'completed' as const,
        principalInput: serializeLifecycleValue('Read the missing file.'),
        assistantOutput: serializeLifecycleValue('The read operation failed.'),
        timestamp: Date.parse(`2026-09-04T00:0${index}:30.000Z`),
      }
      await publishLifecycleEvent(context, toolEvent)
      await publishLifecycleEvent(context, toolEvent)
      await publishLifecycleEvent(context, turnEvent)
      await publishLifecycleEvent(context, turnEvent)
    }

    await vi.waitFor(async () => {
      expect((await context.doppelgangerEvolution.list()).proposals).toHaveLength(1)
    })
    const result = await context.doppelgangerEvolution.list()
    expect(result.proposals[0]).toMatchObject({
      kind: 'capability',
      scope: 'global',
      status: 'proposed',
    })
    expect(result.proposals[0]?.evidence.map(item => item.sourceId).sort()).toEqual([
      'lifecycle:turn-delivery-0',
      'lifecycle:turn-delivery-1',
      'lifecycle:turn-delivery-2',
    ])
    await context.fiber.dispose()
  })

  it('persists and promotes deterministic lifecycle evidence when structured inference fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-inference-fallback-'))
    roots.push(home)
    const context = await base(home)
    let inferenceCalls = 0
    try {
      await context.plugin({
        provide: STRUCTURED_INFERENCE_SERVICE,
        apply(ctx) {
          ctx.provide(STRUCTURED_INFERENCE_SERVICE, createStructuredInference({
            async infer() {
              inferenceCalls += 1
              throw new Error('provider failure is not lifecycle failure')
            },
          }))
        },
      })
      await context.plugin(EvolutionPlugin, { signalInferenceEnabled: true })
      for (let index = 0; index < 3; index += 1) {
        await publishLifecycleEvent(context, {
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'tool-completed',
          deliveryId: `fallback-tool-${index}`,
          sessionId: 'session-a',
          turnId: `fallback-turn-${index}`,
          callId: `fallback-call-${index}`,
          name: 'read',
          outcome: 'failed',
          error: { code: 'ENOENT', message: 'Missing file.' },
          timestamp: Date.now(),
        })
        await publishLifecycleEvent(context, {
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'turn-committed',
          deliveryId: `fallback-delivery-${index}`,
          sessionId: 'session-a',
          turnId: `fallback-turn-${index}`,
          outcome: 'completed',
          principalInput: serializeLifecycleValue('Read the missing file.'),
          assistantOutput: serializeLifecycleValue('The read operation failed.'),
          timestamp: Date.now(),
        })
      }
      await vi.waitFor(async () => {
        expect((await context.doppelgangerEvolution.list()).proposals).toHaveLength(1)
      })
      const result = await context.doppelgangerEvolution.list()
      expect(inferenceCalls).toBe(3)
      expect(result.proposals[0]).toMatchObject({ kind: 'capability', status: 'proposed', revision: 1 })
      expect(result.proposals[0]!.evidence.map(item => item.sourceId).sort()).toEqual([
        'lifecycle:fallback-delivery-0',
        'lifecycle:fallback-delivery-1',
        'lifecycle:fallback-delivery-2',
      ])
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INFERENCE_PROVIDER_FAILURE' }))
      expect(context.doppelgangerTools.snapshot().tools).toHaveLength(7)
    } finally {
      await context.fiber.dispose()
    }
  })

  it('preserves proposal-only behavior when proactive capture is disabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-signal-disabled-'))
    roots.push(home)
    const context = await base(home)
    let inferenceCalls = 0
    await context.plugin({
      provide: STRUCTURED_INFERENCE_SERVICE,
      apply(ctx) {
        ctx.provide(STRUCTURED_INFERENCE_SERVICE, createStructuredInference({
          async infer() {
            inferenceCalls += 1
            return { value: { hypotheses: [] } }
          },
        }))
      },
    })
    await context.plugin(EvolutionPlugin, { proactiveSignalsEnabled: false, signalInferenceEnabled: false })
    await publishLifecycleEvent(context, {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-committed',
      deliveryId: 'disabled-turn',
      sessionId: 'session-a',
      turnId: 'turn-disabled',
      outcome: 'completed',
      principalInput: serializeLifecycleValue('Нет, я просил другое.'),
      assistantOutput: serializeLifecycleValue('Я не могу выполнить это.'),
      timestamp: Date.parse('2026-09-04T01:00:00.000Z'),
    })
    await Promise.resolve()

    expect(inferenceCalls).toBe(0)
    expect((await context.doppelgangerEvolution.list()).proposals).toEqual([])
    expect(context.doppelgangerTools.snapshot().tools).toHaveLength(7)
    await context.fiber.dispose()
  })


  it('rejects unsafe signal configuration before registering listeners', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-signal-config-'))
    roots.push(home)
    const context = await base(home)
    const plugin = context.plugin(EvolutionPlugin, { capabilityPromotionMinTurns: 2 })

    await expect(plugin.await()).rejects.toThrow('capabilityPromotionMinTurns')
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    await publishLifecycleEvent(context, {
      protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
      type: 'turn-committed',
      deliveryId: 'invalid-config-turn',
      sessionId: 'session-a',
      turnId: 'turn-invalid',
      outcome: 'completed',
      principalInput: serializeLifecycleValue('ignored'),
      assistantOutput: serializeLifecycleValue('ignored'),
      timestamp: Date.parse('2026-09-04T01:00:00.000Z'),
    })
    expect(context.get('doppelgangerEvolution')).toBeUndefined()
    await context.fiber.dispose()
  })

  it('rejects unknown configuration and fails before storage open for an unbound actor', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-config-'))
    roots.push(home)
    const context = await base(home)
    const unsupported = context.plugin(EvolutionPlugin, { unsupported: true } as unknown as EvolutionPluginConfig)
    await expect(unsupported.await()).rejects.toThrow('evolution.unsupported is not supported')
    expect(context.doppelgangerTools.snapshot().tools).toEqual([])
    await context.fiber.dispose()
    const unbound = await base(home, null)
    const plugin = unbound.plugin(EvolutionPlugin, {})
    await expect(plugin.await()).rejects.toThrow('Evolution requires a bound host actor')
    expect(unbound.doppelgangerTools.snapshot().tools).toEqual([])
    await unbound.fiber.dispose()
  })
})
