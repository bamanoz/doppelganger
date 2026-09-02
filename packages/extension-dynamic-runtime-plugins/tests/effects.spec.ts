import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ContextProtocol, ToolRegistry, type JsonValue } from '@doppelganger/doppelganger-protocols'
import { DynamicRuntimePluginsPlugin } from '../src/index.ts'

async function setup() {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: crypto.randomUUID(), runtimePresetId: 'test' }))
  await ctx.plugin(ContextProtocol)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(DynamicRuntimePluginsPlugin, {})
  await ctx.plugin({
    name: 'unrelated-effects',
    inject: ['doppelgangerContext', 'doppelgangerTools'],
    apply(child) {
      child.doppelgangerContext.register({
        id: 'unrelated',
        resolve: () => [{ source: 'unrelated', content: 'stable', priority: 1, authority: 'data' }],
      })
      child.doppelgangerTools.register({
        name: 'unrelated.echo',
        description: 'Unrelated tool',
        inputSchema: { type: 'object', additionalProperties: false },
        invoke: () => ({ stable: true }),
      })
    },
  })
  return ctx
}

function record(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected JSON object')
  return value as Readonly<Record<string, JsonValue>>
}

async function define(ctx: Context, source: string, pluginId?: JsonValue) {
  const result = await ctx.doppelgangerTools.invoke('runtime-plugin.define', {
    ...(pluginId === undefined ? { idPrefix: 'effects' } : { pluginId }),
    name: pluginId === undefined ? 'effect package one' : 'effect package two',
    purpose: 'prove portable effect lifecycle',
    source,
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function run(ctx: Context, definition: JsonValue, mode: 'run' | 'update') {
  const value = record(definition)
  return ctx.doppelgangerTools.invoke('runtime-plugin.run', {
    pluginId: value.pluginId ?? null,
    packageId: value.packageId ?? null,
    mode,
    name: value.name ?? null,
    purpose: value.purpose ?? null,
    sourceDigest: value.sourceDigest ?? null,
  })
}

function source(version: string, fail = false): string {
  return [
    'return {',
    '  inject: ["doppelgangerContext", "doppelgangerTools"],',
    '  apply(ctx) {',
    `    const state = { version: ${JSON.stringify(version)}, events: 0 };`,
    '    ctx.provide("generated.state", state);',
    '    ctx.doppelgangerContext.register({',
    `      id: ${JSON.stringify(`generated-${version}`)},`,
    `      resolve: () => [{ source: ${JSON.stringify(`generated-${version}`)}, content: ${JSON.stringify(version)}, priority: 10, authority: "data" }],`,
    '    });',
    '    ctx.doppelgangerTools.register({',
    `      name: ${JSON.stringify(`generated.${version}`)},`,
    `      description: ${JSON.stringify(`Generated ${version} tool`)},`,
    '      inputSchema: { type: "object", additionalProperties: false },',
    `      invoke: () => ({ version: ${JSON.stringify(version)} }),`,
    '    });',
    '    ctx.on("doppelganger/turn-started", () => { state.events += 1 });',
    ...(fail ? ['    throw new Error("candidate apply failed");'] : []),
    '  },',
    '}',
  ].join('\n')
}

async function resolvedSources(ctx: Context) {
  const resolved = await ctx.doppelgangerContext.resolve({ turn: { input: 'test' }, tokenBudget: 100 })
  return resolved.contributions.map(contribution => contribution.source)
}

describe('portable generated effect lifecycle', () => {
  it('unwinds generated context, tool, lifecycle subscription, and service effects on stop', async () => {
    const ctx = await setup()
    const definition = await define(ctx, source('one'))
    expect(await run(ctx, definition, 'run')).toMatchObject({ ok: true })
    const state = ctx.get('generated.state') as { version: string; events: number }
    await ctx.parallel('doppelganger/turn-started', {} as never)
    expect(state).toEqual({ version: 'one', events: 1 })
    expect(await resolvedSources(ctx)).toEqual(['generated-one', 'unrelated'])
    expect(await ctx.doppelgangerTools.invoke('generated.one', {})).toEqual({ ok: true, value: { version: 'one' } })

    const value = record(definition)
    expect(await ctx.doppelgangerTools.invoke('runtime-plugin.stop', { pluginId: value.pluginId ?? null }))
      .toMatchObject({ ok: true, value: { stopped: true, wasRunning: true } })
    await ctx.parallel('doppelganger/turn-started', {} as never)
    expect(state.events).toBe(1)
    expect(ctx.get('generated.state')).toBeUndefined()
    expect(await resolvedSources(ctx)).toEqual(['unrelated'])
    expect(await ctx.doppelgangerTools.invoke('generated.one', {})).toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_FOUND' },
    })
    expect(await ctx.doppelgangerTools.invoke('unrelated.echo', {})).toEqual({ ok: true, value: { stable: true } })
    await ctx.fiber.dispose()
  })

  it('cuts over atomically to only the committed update while unrelated effects remain active', async () => {
    const ctx = await setup()
    const first = await define(ctx, source('one'))
    await run(ctx, first, 'run')
    const oldState = ctx.get('generated.state') as { events: number }
    const second = await define(ctx, source('two'), record(first).pluginId)
    expect(await run(ctx, second, 'update')).toMatchObject({ ok: true })

    const newState = ctx.get('generated.state') as { version: string; events: number }
    await ctx.parallel('doppelganger/turn-started', {} as never)
    expect(oldState.events).toBe(0)
    expect(newState).toEqual({ version: 'two', events: 1 })
    expect(await resolvedSources(ctx)).toEqual(['generated-two', 'unrelated'])
    expect(await ctx.doppelgangerTools.invoke('generated.one', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    expect(await ctx.doppelgangerTools.invoke('generated.two', {})).toEqual({ ok: true, value: { version: 'two' } })
    expect(await ctx.doppelgangerTools.invoke('unrelated.echo', {})).toEqual({ ok: true, value: { stable: true } })
    await ctx.fiber.dispose()
  })

  it('removes every failed candidate effect and preserves unrelated registrations', async () => {
    const ctx = await setup()
    const first = await define(ctx, source('one'))
    await run(ctx, first, 'run')
    const pluginId = record(first).pluginId
    const second = await define(ctx, source('two', true), pluginId)
    expect(await run(ctx, second, 'update')).toMatchObject({
      ok: false,
      error: { code: 'PACKAGE_APPLY_FAILED', message: expect.stringContaining('candidate apply failed') },
    })

    expect(ctx.get('generated.state')).toBeUndefined()
    expect(await resolvedSources(ctx)).toEqual(['unrelated'])
    expect(await ctx.doppelgangerTools.invoke('generated.one', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    expect(await ctx.doppelgangerTools.invoke('generated.two', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    expect(await ctx.doppelgangerTools.invoke('unrelated.echo', {})).toEqual({ ok: true, value: { stable: true } })
    const inspected = await ctx.doppelgangerTools.invoke('runtime-plugin.inspect-self', { pluginId: pluginId ?? null })
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        currentPackageId: record(first).packageId,
        nextPackageId: record(second).packageId,
        latestDiagnostic: { phase: 'apply', packageId: record(second).packageId },
      },
    })
    if (!inspected.ok) throw new Error(inspected.error.message)
    expect(record(inspected.value)).not.toHaveProperty('activeRun')
    await ctx.fiber.dispose()
  })

  it('reports rejecting generated cleanup as a correlated disposal failure', async () => {
    const ctx = await setup()
    const definition = await define(ctx, [
      'return {',
      '  apply(ctx) {',
      '    ctx.effect(() => () => { throw new Error("generated cleanup rejected") });',
      '  },',
      '}',
    ].join('\n'))
    expect(await run(ctx, definition, 'run')).toMatchObject({ ok: true })
    const pluginId = record(definition).pluginId ?? null
    expect(await ctx.doppelgangerTools.invoke('runtime-plugin.stop', { pluginId })).toMatchObject({
      ok: false,
      error: {
        code: 'RUN_DISPOSAL_FAILED',
        message: expect.stringContaining('generated cleanup rejected'),
        data: { phase: 'disposal', pluginId },
      },
    })
    await ctx.fiber.dispose()
  })
})
