import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { describe, expect, it } from 'vitest'
import {
  ContextProtocol,
  ToolRegistry,
  type JsonValue,
} from '@doppelganger/doppelganger-protocols'
import { DynamicRuntimePluginsPlugin } from '../src/index.ts'
import { invokeTool } from './support.ts'

async function setup(options: { readonly http?: unknown } = {}) {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: crypto.randomUUID(), runtimePresetId: 'test' }))
  if (options.http !== undefined) ctx.provide('doppelgangerHttp', options.http)
  await ctx.plugin(ContextProtocol)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(Timer)
  await ctx.plugin(DynamicRuntimePluginsPlugin, { vmTimeoutMs: 25 })
  return ctx
}

function objectValue(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected JSON object')
  }
  const record = value as Readonly<Record<string, JsonValue>>
  return record
}

function valueField(value: JsonValue, name: string): JsonValue {
  return objectValue(value)[name] ?? null
}

async function define(ctx: Context, source: string, prefix = 'guard') {
  const result = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
    idPrefix: prefix,
    name: prefix,
    purpose: `test ${prefix}`,
    source,
  } }, 'test-session')
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

async function run(ctx: Context, definition: JsonValue) {
  const record = objectValue(definition)
  return invokeTool(ctx, 'runtime-plugin.run', {
    pluginId: record.pluginId ?? null,
    packageId: record.packageId ?? null,
    mode: 'run',
    name: record.name ?? null,
    purpose: record.purpose ?? null,
    sourceDigest: record.sourceDigest ?? null,
  })
}

describe('guarded Package evaluator', () => {
  it('uses a fresh realm, enforces synchronous timeout, and validates the returned Plugin', async () => {
    const ctx = await setup()
    const first = await define(ctx, 'globalThis.realmMarker = 1; return { apply(ctx) { ctx.provide("test.realm", globalThis.realmMarker) } }', 'realm')
    expect(await run(ctx, first)).toMatchObject({ ok: true, value: { status: 'running' } })
    expect(ctx.get('test.realm')).toBe(1)
    await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.stop', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.stop')!.revision, input: { pluginId: valueField(first, 'pluginId') } }, 'test-session')

    const second = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      pluginId: valueField(first, 'pluginId'),
      name: 'realm two',
      purpose: 'fresh VM realm',
      source: 'return { apply(ctx) { ctx.provide("test.realm", typeof realmMarker) } }',
    } }, 'test-session')
    if (!second.ok) throw new Error(second.error.message)
    const restarted = await invokeTool(ctx, 'runtime-plugin.run', {
      pluginId: valueField(first, 'pluginId'),
      packageId: valueField(second.value, 'packageId'),
      mode: 'update',
      name: valueField(second.value, 'name'),
      purpose: valueField(second.value, 'purpose'),
      sourceDigest: valueField(second.value, 'sourceDigest'),
    })
    expect(restarted).toMatchObject({ ok: true })
    expect(ctx.get('test.realm')).toBe('undefined')

    const invalid = await define(ctx, 'return 42', 'invalid-return')
    expect(await run(ctx, invalid)).toMatchObject({
      ok: false,
      error: { code: 'PACKAGE_EVALUATION_FAILED', message: expect.stringContaining('must return a Cordis Plugin') },
    })
    const timeout = await define(ctx, 'while (true) {}', 'timeout')
    expect(await run(ctx, timeout)).toMatchObject({
      ok: false,
      error: { code: 'PACKAGE_EVALUATION_FAILED', message: expect.stringContaining('timed out') },
    })
    await ctx.fiber.dispose()
  })

  it('allows declared and optional approved services but rejects uncatalogued and framework access', async () => {
    const http = Object.freeze({ request: async () => Object.freeze({ status: 204, headers: {}, body: '' }) })
    const ctx = await setup({ http })
    ctx.provide('privateService', Object.freeze({ value: 1 }))
    const approved = await define(ctx, [
      'return {',
      '  inject: ["doppelgangerTools"],',
      '  apply(ctx) {',
      '    const listed = ctx.doppelgangerTools.snapshot().tools.length;',
      '    const optional = ctx.get("doppelgangerHttp");',
      '    ctx.provide("test.approved", { listed, optional: typeof optional.request });',
      '  },',
      '}',
    ].join('\n'), 'approved')
    expect(await run(ctx, approved)).toMatchObject({ ok: true })
    expect(ctx.get('test.approved')).toEqual({ listed: 7, optional: 'function' })

    for (const [prefix, expression, message] of [
      ['private', 'ctx.get("privateService")', 'not in the generated runtime inspection catalog'],
      ['root', 'ctx.root', 'service "root" is not in'],
      ['fiber', 'ctx.fiber', 'service "fiber" is not in'],
      ['registry', 'ctx.registry', 'service "registry" is not in'],
      ['plugin', 'ctx.plugin', 'service "plugin" is not in'],
      ['loader', 'ctx.loader', 'service "loader" is not in'],
    ] as const) {
      const definition = await define(ctx, `return { apply(ctx) { void ${expression} } }`, prefix)
      const result = await run(ctx, definition)
      expect(result).toMatchObject({ ok: false, error: { code: 'PACKAGE_APPLY_FAILED' } })
      if (!result.ok) expect(result.error.message).toContain(message)
    }
    await ctx.fiber.dispose()
  })

  it('rejects service-returned Context and records later guard failures', async () => {
    const ctx = await setup()
    ctx.provide('doppelgangerHttp', Object.freeze({ request: async () => ctx }))
    const definition = await define(ctx, [
      'return {',
      '  inject: ["doppelgangerHttp"],',
      '  async apply(ctx) {',
      '    ctx.provide("test.trigger", async () => ctx.doppelgangerHttp.request({ url: "https://example.invalid" }));',
      '  },',
      '}',
    ].join('\n'), 'context-result')
    expect(await run(ctx, definition)).toMatchObject({ ok: true })
    const trigger = ctx.get('test.trigger')
    expect(typeof trigger).toBe('function')
    if (typeof trigger !== 'function') throw new Error('missing generated trigger')
    await expect(trigger()).rejects.toThrow('returned a Cordis Context')
    const inspected = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-self', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-self')!.revision, input: {
      pluginId: valueField(definition, 'pluginId'),
    } }, 'test-session')
    expect(inspected).toMatchObject({
      ok: true,
      value: { latestDiagnostic: { phase: 'guard', message: expect.stringContaining('returned a Cordis Context') } },
    })
    await ctx.fiber.dispose()
  })

  it('teaches unavailable globals and withholds tool invocation and mutable registrations', async () => {
    const ctx = await setup()
    for (const [prefix, source, message] of [
      ['require', 'require("x")', 'Node modules are unavailable'],
      ['process', 'process.env', 'Node process is unavailable'],
      ['buffer', 'Buffer.from("x")', 'Node Buffer is unavailable'],
      ['fetch', 'fetch("https://example.invalid")', 'Native fetch is unavailable'],
      ['timer-global', 'setTimeout(() => {}, 1)', 'Native timers are unavailable'],
      ['unknown-global', 'notInspectedCapability()', 'only inspected builtins'],
    ] as const) {
      const definition = await define(ctx, `return { apply() { ${source} } }`, prefix)
      const result = await run(ctx, definition)
      expect(result).toMatchObject({ ok: false, error: { code: 'PACKAGE_APPLY_FAILED' } })
      if (!result.ok) expect(result.error.message).toContain(message)
    }

    const tools = await define(ctx, [
      'return {',
      '  inject: ["doppelgangerTools"],',
      '  apply(ctx) {',
      '    if (ctx.doppelgangerTools.invoke !== undefined) throw new Error("invoke leaked");',
      '    const dispose = ctx.doppelgangerTools.register({',
      '      name: "generated.echo",',
      '      description: "echo",',
      '      inputSchema: { type: "object", additionalProperties: false },',
      '      invoke: () => ({ echoed: true }),',
      '    });',
      '    if (typeof dispose !== "function") throw new Error("mutable registration leaked");',
      '  },',
      '}',
    ].join('\n'), 'generated-tool')
    expect(await run(ctx, tools)).toMatchObject({ ok: true })
    expect(ctx.doppelgangerTools.snapshot().tools.some(tool => tool.name === 'generated.echo')).toBe(true)

    const reserved = await define(ctx, [
      'return {',
      '  inject: ["doppelgangerTools"],',
      '  apply(ctx) {',
      '    ctx.doppelgangerTools.register({',
      '      name: "runtime-plugin.shadow",',
      '      description: "forbidden",',
      '      inputSchema: { type: "object" },',
      '      invoke: () => null,',
      '    });',
      '  },',
      '}',
    ].join('\n'), 'reserved-tool')
    expect(await run(ctx, reserved)).toMatchObject({
      ok: false,
      error: { code: 'PACKAGE_APPLY_FAILED', message: expect.stringContaining('reserved runtime-plugin namespace') },
    })
    await ctx.fiber.dispose()
  })
})
