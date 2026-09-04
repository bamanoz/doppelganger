import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '@doppelganger/doppelganger-protocols'
import {
  DynamicRuntimePluginsPlugin,
  normalizeDynamicRuntimePluginsConfig,
} from '../src/index.ts'
import type { DynamicRuntimePluginsConfig } from '../src/config.ts'

async function setup(config: DynamicRuntimePluginsConfig = {}) {
  const ctx = new Context()
  ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: 'session-1', runtimePresetId: 'test' }))
  await ctx.plugin(ToolRegistry)
  const plugin = await ctx.plugin(DynamicRuntimePluginsPlugin, config)
  return { ctx, plugin }
}

async function loaderProjection(includeDynamic: boolean): Promise<readonly string[]> {
  const ctx = new Context()
  await ctx.plugin(Loader)
  let projected: readonly string[] = []
  const metadata: Plugin = {
    name: 'test-runtime-session',
    apply(child) {
      child.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: 'loader-session', runtimePresetId: 'test' }))
    },
  }
  const observer: Plugin = {
    name: 'test-tool-observer',
    inject: ['doppelgangerTools'],
    apply(child) {
      projected = child.doppelgangerTools.snapshot().tools.map(tool => tool.name)
      child.on('doppelganger/tools-changed', () => {
        projected = child.doppelgangerTools.snapshot().tools.map(tool => tool.name)
      })
    },
  }
  ctx.loader.builtins.metadata = metadata
  ctx.loader.builtins.tools = ToolRegistry
  ctx.loader.builtins.dynamic = DynamicRuntimePluginsPlugin
  ctx.loader.builtins.observer = observer
  await ctx.loader.create({ name: 'cordis:metadata', isolate: { doppelgangerRuntimeSession: 'session' } })
  await ctx.loader.create({ name: 'cordis:tools', isolate: { doppelgangerTools: 'session' } })
  if (includeDynamic) {
    await ctx.loader.create({
      name: 'cordis:dynamic',
      isolate: { doppelgangerRuntimeSession: 'session', doppelgangerTools: 'session' },
    })
  }
  await ctx.loader.create({ name: 'cordis:observer', isolate: { doppelgangerTools: 'session' } })
  await ctx.fiber.dispose()
  return projected
}

describe('Dynamic Runtime Plugins foundation', () => {
  it('normalizes safe bounded configuration and rejects unknown unsafe values', () => {
    expect(normalizeDynamicRuntimePluginsConfig()).toEqual({
      vmTimeoutMs: 1_000,
      maximumSourceBytes: 65_536,
      maximumNameLength: 128,
      maximumPurposeLength: 1_024,
      maximumPlugins: 32,
      maximumPackagesPerPlugin: 32,
      maximumTotalSourceBytes: 524_288,
      maximumInspectionBytes: 65_536,
      maximumDiagnosticMessageLength: 2_048,
      maximumDiagnosticStackLength: 8_192,
    })
    expect(() => normalizeDynamicRuntimePluginsConfig({ unknown: true })).toThrow('unsupported fields')
    expect(() => normalizeDynamicRuntimePluginsConfig({ vmTimeoutMs: Number.NaN })).toThrow('finite safe integer')
    expect(() => normalizeDynamicRuntimePluginsConfig({ maximumPlugins: -1 })).toThrow('between 1')
    expect(() => normalizeDynamicRuntimePluginsConfig({ maximumSourceBytes: 2_000, maximumTotalSourceBytes: 1_000 }))
      .toThrow('must not exceed')
  })

  it('registers exactly the seven control tools only when explicitly composed', async () => {
    const plain = new Context()
    await plain.plugin(ToolRegistry)
    expect(plain.doppelgangerTools.snapshot().tools).toEqual([])

    const { ctx, plugin } = await setup()
    expect(ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)).toEqual([
      'runtime-plugin.define',
      'runtime-plugin.inspect-list',
      'runtime-plugin.inspect-query',
      'runtime-plugin.inspect-self',
      'runtime-plugin.run',
      'runtime-plugin.stop',
      'runtime-plugin.undefine',
    ])
    expect(ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'runtime-plugin.run')?.approval?.policy)
      .toBe('required')
    await plugin.dispose()
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await ctx.fiber.dispose()
    await plain.fiber.dispose()
  })

  it('is Loader-visible, isolated with protocol services, and neutral when omitted', async () => {
    expect(await loaderProjection(false)).toEqual([])
    expect(await loaderProjection(true)).toEqual([
      'runtime-plugin.define',
      'runtime-plugin.inspect-list',
      'runtime-plugin.inspect-query',
      'runtime-plugin.inspect-self',
      'runtime-plugin.run',
      'runtime-plugin.stop',
      'runtime-plugin.undefine',
    ])
  })

  it('fails before tool registration when configuration is invalid', async () => {
    const ctx = new Context()
    ctx.provide('doppelgangerRuntimeSession', Object.freeze({ sessionId: 'session-1', runtimePresetId: 'test' }))
    await ctx.plugin(ToolRegistry)
    await expect(ctx.plugin(DynamicRuntimePluginsPlugin, { vmTimeoutMs: 0 })).rejects.toThrow('between 1')
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await ctx.fiber.dispose()
  })
})
