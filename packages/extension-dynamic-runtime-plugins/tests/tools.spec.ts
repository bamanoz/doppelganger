import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ToolRegistry, type JsonValue } from '@doppelganger/doppelganger-protocols'
import { DynamicRuntimePluginsPlugin, normalizeDynamicRuntimePluginsConfig } from '../src/index.ts'
import { DynamicRuntimePluginRegistry } from '../src/registry.ts'
import { invokeTool } from './support.ts'

async function setup() {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: crypto.randomUUID(), runtimePresetId: 'test' }))
  await ctx.plugin(ToolRegistry)
  const owner = await ctx.plugin(DynamicRuntimePluginsPlugin, { vmTimeoutMs: 10 })
  return { ctx, owner }
}

function objectValue(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected JSON object')
  return value as Readonly<Record<string, JsonValue>>
}

function field(value: JsonValue, name: string): JsonValue {
  return objectValue(value)[name] ?? null
}

async function define(
  ctx: Context,
  source = 'return { apply() {} }',
  pluginId?: JsonValue,
  prefix = 'tools',
) {
  const result = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
    ...(pluginId === undefined ? { idPrefix: prefix } : { pluginId }),
    name: `${prefix} name`,
    purpose: `${prefix} purpose`,
    source,
  } }, 'test-session')
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

async function run(ctx: Context, definition: JsonValue, overrides: Readonly<Record<string, JsonValue>> = {}) {
  const record = objectValue(definition)
  return invokeTool(ctx, 'runtime-plugin.run', {
    pluginId: record.pluginId ?? null,
    packageId: record.packageId ?? null,
    mode: 'run',
    name: record.name ?? null,
    purpose: record.purpose ?? null,
    sourceDigest: record.sourceDigest ?? null,
    ...overrides,
  })
}

describe('Dynamic Runtime Plugin control tools', () => {
  it('publishes strict complete schemas and shell-equivalent exact-run approval', async () => {
    const { ctx } = await setup()
    const descriptors = ctx.doppelgangerTools.snapshot().tools
    expect(descriptors.map(tool => tool.name)).toEqual([
      'runtime-plugin.define',
      'runtime-plugin.inspect-list',
      'runtime-plugin.inspect-query',
      'runtime-plugin.inspect-self',
      'runtime-plugin.run',
      'runtime-plugin.stop',
      'runtime-plugin.undefine',
    ])
    for (const descriptor of descriptors) {
      expect(descriptor.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }
    const runDescriptor = descriptors.find(tool => tool.name === 'runtime-plugin.run')
    expect(runDescriptor?.approval).toMatchObject({
      policy: 'required',
      reason: expect.stringContaining('shell access'),
    })
    expect(runDescriptor?.approval?.reason).toContain('pluginId, packageId, mode, name, purpose, and sourceDigest')
    expect(runDescriptor?.inputSchema).toMatchObject({
      required: ['pluginId', 'packageId', 'mode', 'name', 'purpose', 'sourceDigest'],
    })
    await ctx.fiber.dispose()
  })

  it('rejects malformed additional fields before mutation', async () => {
    const { ctx } = await setup()
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      idPrefix: 'strict',
      name: 'strict',
      purpose: 'strict validation',
      source: 'return { apply() {} }',
      extra: true,
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      idPrefix: 'strict',
      pluginId: 'foreign-1',
      name: 'strict',
      purpose: 'strict validation',
      source: 'return { apply() {} }',
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-self', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-self')!.revision, input: {} }, 'test-session')).resolves.toEqual({
      ok: true,
      value: { plugins: [] },
    })
    await ctx.fiber.dispose()
  })

  it('revalidates every immutable approved field before evaluation', async () => {
    const { ctx } = await setup()
    const definition = await define(ctx, 'while (true) {}', undefined, 'metadata')
    for (const overrides of [
      { pluginId: 'missing-999' },
      { packageId: 'pkg-999' },
      { name: 'substituted' },
      { purpose: 'substituted' },
      { sourceDigest: `sha256:${'0'.repeat(64)}` },
      { mode: 'update' },
    ] as const) {
      const result = await run(ctx, definition, overrides)
      expect(result).toMatchObject({ ok: false })
      if (!result.ok) expect(result.error.message).not.toContain('timed out')
    }
    expect(await run(ctx, definition)).toMatchObject({
      ok: false,
      error: { code: 'PACKAGE_EVALUATION_FAILED', message: expect.stringContaining('timed out') },
    })
    await ctx.fiber.dispose()
  })

  it('serializes mutations deterministically and supports idempotent stop and restart', async () => {
    const { ctx } = await setup()
    const firstPromise = ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      idPrefix: 'ordered', name: 'first', purpose: 'first', source: 'return { apply(ctx) { ctx.provide("test.control", "active") } }',
    } }, 'test-session')
    const secondPromise = ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.define', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.define')!.revision, input: {
      idPrefix: 'ordered', name: 'second', purpose: 'second', source: 'return { apply() {} }',
    } }, 'test-session')
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])
    expect(firstResult).toMatchObject({ ok: true, value: { pluginId: 'ordered-1', packageId: 'pkg-1' } })
    expect(secondResult).toMatchObject({ ok: true, value: { pluginId: 'ordered-2', packageId: 'pkg-2' } })
    if (!firstResult.ok) throw new Error(firstResult.error.message)
    expect(await run(ctx, firstResult.value)).toMatchObject({ ok: true })
    expect(ctx.get('test.control')).toBe('active')

    expect(await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.stop', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.stop')!.revision, input: {
      pluginId: field(firstResult.value, 'pluginId'),
    } }, 'test-session')).toMatchObject({ ok: true, value: { stopped: true, wasRunning: true } })
    expect(ctx.get('test.control')).toBeUndefined()
    expect(await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.stop', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.stop')!.revision, input: {
      pluginId: field(firstResult.value, 'pluginId'),
    } }, 'test-session')).toMatchObject({ ok: true, value: { stopped: true, wasRunning: false } })
    expect(await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-self', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-self')!.revision, input: {
      pluginId: field(firstResult.value, 'pluginId'),
    } }, 'test-session')).toMatchObject({
      ok: true,
      value: { currentPackageId: field(firstResult.value, 'packageId'), packages: [expect.any(Object)] },
    })
    expect(await run(ctx, firstResult.value)).toMatchObject({ ok: true })
    expect(ctx.get('test.control')).toBe('active')
    await ctx.fiber.dispose()
  })

  it('undefines exhaustively, invalidates identities, and owner disposal is repeatable', async () => {
    const { ctx, owner } = await setup()
    const definition = await define(
      ctx,
      'return { apply(ctx) { ctx.provide("test.removed", true) } }',
      undefined,
      'remove',
    )
    expect(await run(ctx, definition)).toMatchObject({ ok: true })
    expect(ctx.get('test.removed')).toBe(true)
    expect(await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.undefine', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.undefine')!.revision, input: {
      pluginId: field(definition, 'pluginId'),
    } }, 'test-session')).toMatchObject({ ok: true, value: { removed: true, wasRunning: true } })
    expect(ctx.get('test.removed')).toBeUndefined()
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-self', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-self')!.revision, input: {
      pluginId: field(definition, 'pluginId'),
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'PLUGIN_NOT_FOUND' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.stop', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.stop')!.revision, input: {
      pluginId: field(definition, 'pluginId'),
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'PLUGIN_NOT_FOUND' } })

    const active = await define(
      ctx,
      'return { apply(ctx) { ctx.provide("test.owner", true) } }',
      undefined,
      'owner',
    )
    await run(ctx, active)
    await owner.dispose()
    await owner.dispose()
    expect(ctx.get('test.owner')).toBeUndefined()
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await expect(invokeTool(ctx, 'runtime-plugin.inspect-self', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_FOUND' },
    })
    await ctx.fiber.dispose()
  })

  it('exhausts sibling run cleanup when one generated disposer rejects and memoizes failure', async () => {
    const ctx = new Context()
    const group = ctx.plugin({ name: 'test-dynamic-runtime-group', apply() {} })
    await group.await()
    const registry = new DynamicRuntimePluginRegistry(group, normalizeDynamicRuntimePluginsConfig())

    const failing = objectValue(await registry.define({
      plugin: { kind: 'new', idPrefix: 'failing' },
      name: 'failing disposer',
      purpose: 'prove exhaustive disposal',
      source: 'return { apply(ctx) { ctx.provide("test.failure", true); ctx.effect(() => () => { throw new Error("cleanup rejected") }) } }',
    }))
    const sibling = objectValue(await registry.define({
      plugin: { kind: 'new', idPrefix: 'sibling' },
      name: 'sibling disposer',
      purpose: 'prove sibling cleanup',
      source: 'return { apply(ctx) { ctx.provide("test.sibling", true) } }',
    }))
    const runInput = (definition: Readonly<Record<string, JsonValue>>) => ({
      pluginId: String(definition.pluginId),
      packageId: String(definition.packageId),
      mode: 'run' as const,
      name: String(definition.name),
      purpose: String(definition.purpose),
      sourceDigest: String(definition.sourceDigest),
    })
    await registry.run(runInput(failing))
    await registry.run(runInput(sibling))
    expect(ctx.get('test.failure')).toBe(true)
    expect(ctx.get('test.sibling')).toBe(true)

    const disposal = registry.dispose()
    await expect(disposal).rejects.toThrow('dynamic runtime plugin cleanup failed')
    await expect(registry.dispose()).rejects.toThrow('dynamic runtime plugin cleanup failed')
    expect(ctx.get('test.failure')).toBeUndefined()
    expect(ctx.get('test.sibling')).toBeUndefined()
    await expect(registry.define({
      plugin: { kind: 'new', idPrefix: 'after' },
      name: 'after disposal',
      purpose: 'must be rejected',
      source: 'return { apply() {} }',
    })).rejects.toThrow('registry is disposing')
    await group.dispose()
    await ctx.fiber.dispose()
  })
})
