import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ToolRegistry, type JsonValue } from '@doppelganger/doppelganger-protocols'
import { DynamicRuntimePluginsPlugin } from '../src/index.ts'

async function setup(config: object = {}) {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: 'catalog', runtimePresetId: 'test' }))
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(DynamicRuntimePluginsPlugin, config)
  return ctx
}

async function invoke(ctx: Context, name: string, input: JsonValue) {
  const result = await ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: name, toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === name)!.revision, input: input }, 'test-session')
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

describe('generated runtime inspection catalog', () => {
  it('lists only provider capabilities before returning exact contracts', async () => {
    const ctx = await setup()
    expect(await invoke(ctx, 'runtime-plugin.inspect-list', {})).toEqual({
      providers: [
        expect.objectContaining({ provider: 'Builtin' }),
        expect.objectContaining({ provider: 'Event' }),
        expect.objectContaining({ provider: 'Service' }),
        expect.objectContaining({ provider: 'Tool' }),
      ],
    })

    const service = await invoke(ctx, 'runtime-plugin.inspect-query', {
      provider: 'Service', method: 'get', name: 'doppelgangerTools',
    })
    expect(service).toMatchObject({
      name: 'doppelgangerTools',
      available: true,
      methods: expect.arrayContaining(['snapshot(): ToolCatalogSnapshot']),
      referencedTypes: { ToolDescriptor: expect.any(Object) },
    })
    expect(await invoke(ctx, 'runtime-plugin.inspect-query', {
      provider: 'Service', method: 'get', name: 'doppelgangerHttp',
    })).toMatchObject({ name: 'doppelgangerHttp', available: false })
    await ctx.fiber.dispose()
  })

  it('returns dynamic source-free tool descriptors and approved event contracts', async () => {
    const ctx = await setup()
    const descriptor = await invoke(ctx, 'runtime-plugin.inspect-query', {
      provider: 'Tool', method: 'get', name: 'runtime-plugin.run',
    })
    expect(descriptor).toMatchObject({
      name: 'runtime-plugin.run',
      approval: { policy: 'required' },
      available: true,
    })
    expect(Object.prototype.hasOwnProperty.call(descriptor, 'invoke')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(descriptor, 'source')).toBe(false)
    expect(await invoke(ctx, 'runtime-plugin.inspect-query', {
      provider: 'Event', method: 'get', name: 'doppelganger/turn-committed',
    })).toEqual({
      name: 'doppelganger/turn-committed',
      mode: 'parallel',
      signature: '(event: TurnCommittedEvent): Promise<void> | void',
    })
    await ctx.fiber.dispose()
  })

  it('rejects uncatalogued providers, methods, names, and oversized output', async () => {
    const ctx = await setup()
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-query', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-query')!.revision, input: {
      provider: 'Private', method: 'get', name: 'registry',
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INSPECT_NOT_FOUND' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-query', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-query')!.revision, input: {
      provider: 'Service', method: 'invoke', name: 'doppelgangerTools',
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INSPECT_NOT_FOUND' } })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-query', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-query')!.revision, input: {
      provider: 'Service', method: 'get', name: 'loader',
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INSPECT_NOT_FOUND' } })
    await ctx.fiber.dispose()

    const bounded = await setup({ maximumInspectionBytes: 256 })
    await expect(bounded.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'runtime-plugin.inspect-query', toolRevision: bounded.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.inspect-query')!.revision, input: {
      provider: 'Service', method: 'get', name: 'doppelgangerTools',
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INSPECTION_LIMIT_EXCEEDED' } })
    await bounded.fiber.dispose()
  })
})
