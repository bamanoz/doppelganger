import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { describe, expect, it } from 'vitest'
import { ToolRegistry, type JsonValue } from '@doppelganger/doppelganger-protocols'
import { DynamicRuntimePluginsPlugin } from '../src/index.ts'

async function setup() {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: crypto.randomUUID(), runtimePresetId: 'test' }))
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(Timer)
  await ctx.plugin(DynamicRuntimePluginsPlugin, {
    maximumDiagnosticMessageLength: 80,
    maximumDiagnosticStackLength: 160,
  })
  return ctx
}

function objectValue(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected JSON object')
  return value as Readonly<Record<string, JsonValue>>
}

function field(value: JsonValue, name: string): JsonValue {
  return objectValue(value)[name] ?? null
}

async function define(ctx: Context, source: string, prefix: string, pluginId?: JsonValue) {
  const result = await ctx.doppelgangerTools.invoke('runtime-plugin.define', {
    ...(pluginId === undefined ? { idPrefix: prefix } : { pluginId }),
    name: `${prefix} name`,
    purpose: `${prefix} purpose`,
    source,
  })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

async function run(ctx: Context, definition: JsonValue, mode: 'run' | 'update') {
  const record = objectValue(definition)
  return ctx.doppelgangerTools.invoke('runtime-plugin.run', {
    pluginId: record.pluginId ?? null,
    packageId: record.packageId ?? null,
    mode,
    name: record.name ?? null,
    purpose: record.purpose ?? null,
    sourceDigest: record.sourceDigest ?? null,
  })
}

async function inspect(ctx: Context, pluginId: JsonValue) {
  const result = await ctx.doppelgangerTools.invoke('runtime-plugin.inspect-self', { pluginId })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('generated Fiber lifecycle and version transitions', () => {
  it('mounts a first Package, commits current after activation, and follows parking semantics', async () => {
    const ctx = await setup()
    const definition = await define(ctx, [
      'return {',
      '  inject: ["doppelgangerHttp"],',
      '  apply(ctx) { ctx.provide("test.waiting", "active") },',
      '}',
    ].join('\n'), 'waiting')
    const started = await run(ctx, definition, 'run')
    expect(started).toMatchObject({
      ok: true,
      value: { status: 'waiting', waitingFor: ['doppelgangerHttp'] },
    })
    expect(await inspect(ctx, field(definition, 'pluginId'))).toMatchObject({
      currentPackageId: field(definition, 'packageId'),
      activeRun: { packageId: field(definition, 'packageId'), waitingFor: ['doppelgangerHttp'] },
      latestDiagnostic: { phase: 'waiting' },
    })
    expect(ctx.get('test.waiting')).toBeUndefined()

    const removeHttp = ctx.provide('doppelgangerHttp', Object.freeze({ request: async () => ({ status: 204, headers: {}, body: '' }) }))
    await settle()
    expect(ctx.get('test.waiting')).toBe('active')
    expect(await inspect(ctx, field(definition, 'pluginId'))).toMatchObject({
      activeRun: { waitingFor: [] },
    })
    expect(objectValue(await inspect(ctx, field(definition, 'pluginId'))).latestDiagnostic).toBeUndefined()

    await removeHttp()
    await settle()
    expect(ctx.get('test.waiting')).toBeUndefined()
    expect(await inspect(ctx, field(definition, 'pluginId'))).toMatchObject({
      activeRun: { waitingFor: ['doppelgangerHttp'] },
      latestDiagnostic: { phase: 'waiting' },
    })
    await ctx.fiber.dispose()
  })

  it('updates and explicitly rolls back immutable Packages with clean cutover', async () => {
    const ctx = await setup()
    const first = await define(ctx, 'return { apply(ctx) { ctx.provide("test.version", "one") } }', 'version')
    expect(await run(ctx, first, 'run')).toMatchObject({ ok: true })
    expect(ctx.get('test.version')).toBe('one')

    const second = await define(
      ctx,
      'return { apply(ctx) { ctx.provide("test.version", "two") } }',
      'version-two',
      field(first, 'pluginId'),
    )
    expect(await run(ctx, second, 'update')).toMatchObject({ ok: true })
    expect(ctx.get('test.version')).toBe('two')
    expect(await inspect(ctx, field(first, 'pluginId'))).toMatchObject({
      currentPackageId: field(second, 'packageId'),
      activeRun: { packageId: field(second, 'packageId') },
    })

    expect(await run(ctx, first, 'update')).toMatchObject({ ok: true })
    expect(ctx.get('test.version')).toBe('one')
    expect(await inspect(ctx, field(first, 'pluginId'))).toMatchObject({
      currentPackageId: field(first, 'packageId'),
      activeRun: { packageId: field(first, 'packageId') },
    })
    await ctx.fiber.dispose()
  })

  it('rejects inconsistent and overlapping transitions before disturbing current', async () => {
    const ctx = await setup()
    const first = await define(ctx, 'return { apply(ctx) { ctx.provide("test.version", "one") } }', 'stable')
    await run(ctx, first, 'run')
    const second = await define(
      ctx,
      'return { apply(ctx) { ctx.provide("test.version", "two") } }',
      'candidate',
      field(first, 'pluginId'),
    )
    expect(await run(ctx, first, 'update')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TRANSITION' },
    })
    expect(await run(ctx, second, 'run')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TRANSITION' },
    })
    expect(ctx.get('test.version')).toBe('one')

    const slow = await define(ctx, [
      'return {',
      '  inject: ["timer"],',
      '  async apply(ctx) {',
      '    await new Promise(resolve => ctx.timeout(resolve, 20));',
      '    ctx.provide("test.slow", "done");',
      '  },',
      '}',
    ].join('\n'), 'slow')
    const firstAttempt = run(ctx, slow, 'run')
    const overlapping = await run(ctx, slow, 'run')
    expect(overlapping).toMatchObject({ ok: false, error: { code: 'TRANSITION_IN_PROGRESS' } })
    expect(await firstAttempt).toMatchObject({ ok: true })
    expect(ctx.get('test.slow')).toBe('done')
    await ctx.fiber.dispose()
  })

  it('retains known-good current and failed target while a failed update stays stopped', async () => {
    const ctx = await setup()
    const first = await define(ctx, 'return { apply(ctx) { ctx.provide("test.version", "known-good") } }', 'known-good')
    await run(ctx, first, 'run')
    const failed = await define(
      ctx,
      'return { apply() { throw new Error("candidate failed with a deliberately long diagnostic payload") } }',
      'failed',
      field(first, 'pluginId'),
    )
    const result = await run(ctx, failed, 'update')
    expect(result).toMatchObject({ ok: false, error: { code: 'PACKAGE_APPLY_FAILED' } })
    expect(ctx.get('test.version')).toBeUndefined()
    const state = await inspect(ctx, field(first, 'pluginId'))
    expect(state).toMatchObject({
      currentPackageId: field(first, 'packageId'),
      nextPackageId: field(failed, 'packageId'),
      latestDiagnostic: {
        pluginId: field(first, 'pluginId'),
        packageId: field(failed, 'packageId'),
        phase: 'apply',
        message: expect.stringContaining('candidate failed'),
      },
    })
    expect(objectValue(state).activeRun).toBeUndefined()
    const diagnostic = objectValue(objectValue(state).latestDiagnostic ?? null)
    expect(String(diagnostic.message).length).toBeLessThanOrEqual(80)
    expect(String(diagnostic.stack).length).toBeLessThanOrEqual(160)

    expect(await run(ctx, first, 'run')).toMatchObject({ ok: true })
    expect(ctx.get('test.version')).toBe('known-good')
    expect(await inspect(ctx, field(first, 'pluginId'))).toMatchObject({
      currentPackageId: field(first, 'packageId'),
      activeRun: { packageId: field(first, 'packageId') },
    })
    await ctx.fiber.dispose()
  })
})
