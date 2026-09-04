import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ToolRegistry, type JsonValue } from '@doppelganger/doppelganger-protocols'
import { DynamicRuntimePluginsPlugin } from '../src/index.ts'

async function setup(config: object = {}) {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: crypto.randomUUID(), runtimePresetId: 'test' }))
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(DynamicRuntimePluginsPlugin, config)
  return ctx
}

async function call(ctx: Context, name: string, input: JsonValue): Promise<JsonValue> {
  const result = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: name, toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === name)!.revision, input: input }, 'test-session')
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

function isJsonRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function field(value: JsonValue, name: string): JsonValue {
  if (!isJsonRecord(value)) throw new Error('expected object')
  return value[name] ?? null
}

describe('ephemeral immutable Package definitions', () => {
  it('mints ordered non-reused identities without evaluating exact source', async () => {
    const ctx = await setup()
    const marker = `definition-${crypto.randomUUID()}`
    const source = `\nreturn { apply() { globalThis[${JSON.stringify(marker)}] = true } }\n`
    const first = await call(ctx, 'runtime-plugin.define', {
      idPrefix: 'demo', name: 'first', purpose: 'prove define is inert', source,
    })
    const pluginId = field(first, 'pluginId')
    const packageId = field(first, 'packageId')
    expect(globalThis).not.toHaveProperty(marker)
    expect(field(first, 'sourceDigest')).toBe(`sha256:${createHash('sha256').update(source).digest('hex')}`)

    const secondSource = 'return { apply() {} }\n'
    const second = await call(ctx, 'runtime-plugin.define', {
      pluginId, name: 'second', purpose: 'append immutable version', source: secondSource,
    })
    expect(field(second, 'packageId')).not.toBe(packageId)
    expect(await call(ctx, 'runtime-plugin.inspect-self', {})).toEqual({
      plugins: [{ pluginId, packageCount: 2, running: false }],
    })
    expect(await call(ctx, 'runtime-plugin.inspect-self', { pluginId })).toMatchObject({
      pluginId,
      packages: [
        { packageId, name: 'first', purpose: 'prove define is inert' },
        { packageId: field(second, 'packageId'), name: 'second', purpose: 'append immutable version' },
      ],
    })
    expect(await call(ctx, 'runtime-plugin.inspect-self', { pluginId, packageId })).toMatchObject({
      package: { packageId, source, sourceDigest: field(first, 'sourceDigest') },
    })

    await call(ctx, 'runtime-plugin.undefine', { pluginId })
    const replacement = await call(ctx, 'runtime-plugin.define', {
      idPrefix: 'demo', name: 'replacement', purpose: 'prove identities are not reused', source: secondSource,
    })
    expect(field(replacement, 'pluginId')).not.toBe(pluginId)
    expect(field(replacement, 'packageId')).not.toBe(packageId)
    await ctx.fiber.dispose()
  })

  it('rejects syntax and unsupported source forms without partial records', async () => {
    const ctx = await setup()
    const invalidSources: readonly (readonly [string, string])[] = [
      ['return {', 'failed to parse'],
      ['import value from "x"', 'import and export syntax'],
      ['interface Value {}\nreturn () => {}', 'TypeScript'],
      ['return <div />', 'JSX'],
    ]
    for (const [source, message] of invalidSources) {
      const result = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
        idPrefix: 'bad', name: 'bad', purpose: 'invalid source', source,
      } }, 'test-session')
      expect(result).toMatchObject({ ok: false, error: { code: 'SOURCE_PARSE_FAILED' } })
      if (!result.ok) expect(result.error.message).toContain(message)
    }
    expect(await call(ctx, 'runtime-plugin.inspect-self', {})).toEqual({ plugins: [] })
    await ctx.fiber.dispose()
  })

  it('enforces Plugin Package source aggregate and inspection limits without eviction', async () => {
    const ctx = await setup({
      maximumPlugins: 1,
      maximumPackagesPerPlugin: 1,
      maximumSourceBytes: 64,
      maximumTotalSourceBytes: 64,
      maximumInspectionBytes: 128,
    })
    const source = 'return { apply() {} }'
    const first = await call(ctx, 'runtime-plugin.define', {
      idPrefix: 'only', name: 'only', purpose: 'first package', source,
    })
    const pluginId = field(first, 'pluginId')
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      pluginId, name: 'extra', purpose: 'too many packages', source,
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'REGISTRY_LIMIT_EXCEEDED' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      idPrefix: 'other', name: 'other', purpose: 'too many plugins', source,
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'REGISTRY_LIMIT_EXCEEDED' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      idPrefix: 'large', name: 'large', purpose: 'oversized source', source: 'x'.repeat(65),
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'SOURCE_PARSE_FAILED' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-self', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-self')!.revision, input: {
      pluginId,
      packageId: field(first, 'packageId'),
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INSPECTION_LIMIT_EXCEEDED' } })
    expect(await call(ctx, 'runtime-plugin.inspect-self', {})).toMatchObject({ plugins: [{ pluginId }] })
    await ctx.fiber.dispose()

    const aggregate = await setup({
      maximumPlugins: 2,
      maximumPackagesPerPlugin: 2,
      maximumSourceBytes: 24,
      maximumTotalSourceBytes: 32,
    })
    const aggregateFirst = await call(aggregate, 'runtime-plugin.define', {
      idPrefix: 'total', name: 'first', purpose: 'aggregate first', source,
    })
    await expect(aggregate.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: aggregate.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      pluginId: field(aggregateFirst, 'pluginId'),
      name: 'second',
      purpose: 'aggregate overflow',
      source,
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'REGISTRY_LIMIT_EXCEEDED' } })
    expect(await call(aggregate, 'runtime-plugin.inspect-self', {
      pluginId: field(aggregateFirst, 'pluginId'),
    })).toMatchObject({ packages: [{ name: 'first' }] })
    await aggregate.fiber.dispose()
  })

  it('does not leak Package identities or source across Runtime Sessions', async () => {
    const first = await setup()
    const second = await setup()
    const defined = await call(first, 'runtime-plugin.define', {
      idPrefix: 'shared', name: 'private', purpose: 'session local', source: 'return { apply() {} }',
    })
    await expect(second.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-self', toolRevision: second.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-self')!.revision, input: {
      pluginId: field(defined, 'pluginId'),
      packageId: field(defined, 'packageId'),
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'PLUGIN_NOT_FOUND' } })
    expect(await call(second, 'runtime-plugin.inspect-self', {})).toEqual({ plugins: [] })
    await first.fiber.dispose()
    await second.fiber.dispose()
  })
})
