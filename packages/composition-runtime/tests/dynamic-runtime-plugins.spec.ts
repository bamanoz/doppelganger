import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionReloadEvent,
} from '../src/index.ts'

interface InvocationResult {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

interface Tools {
  list(): readonly { readonly name: string }[]
  invoke(name: string, input: unknown): Promise<InvocationResult>
}

const temporaryRoots: string[] = []
const dynamicRuntimePluginsModule = fileURLToPath(new URL('../../extension-dynamic-runtime-plugins/src/index.ts', import.meta.url))

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function loader(vmTimeoutMs: number): string {
  return JSON.stringify([
    {
      id: 'tools',
      name: '@doppelganger/doppelganger-protocols/tools',
      isolate: { doppelgangerTools: 'session' },
    },
    {
      id: 'dynamic-runtime-plugins',
      name: dynamicRuntimePluginsModule,
      config: { vmTimeoutMs },
      isolate: { doppelgangerRuntimeSession: 'session', doppelgangerTools: 'session' },
    },
  ])
}

function eventQueue() {
  const queued: CompositionReloadEvent[] = []
  const waiters: Array<{ resolve(value: CompositionReloadEvent): void; reject(error: Error): void; timer: NodeJS.Timeout }> = []
  return {
    push(value: CompositionReloadEvent) {
      const waiter = waiters.shift()
      if (waiter === undefined) queued.push(value)
      else {
        clearTimeout(waiter.timer)
        waiter.resolve(value)
      }
    },
    next(label: string) {
      const ready = queued.shift()
      if (ready !== undefined) return Promise.resolve(ready)
      const { promise, resolve, reject } = Promise.withResolvers<CompositionReloadEvent>()
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error(`${label} timed out`))
        }, 3000),
      }
      waiters.push(waiter)
      return promise
    },
  }
}

function value(result: InvocationResult): Record<string, unknown> {
  if (!result.ok || result.value === null || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new Error(result.error?.message ?? 'expected successful object result')
  }
  return result.value as Record<string, unknown>
}

async function defineAndRun(tools: Tools, idPrefix: string, toolName: string) {
  const definition = await tools.invoke('runtime-plugin.define', {
    idPrefix,
    name: `${idPrefix} package`,
    purpose: 'Composition Runtime lifecycle proof',
    source: [
      'return {',
      '  inject: ["doppelgangerTools"],',
      '  apply(ctx) {',
      '    ctx.doppelgangerTools.register({',
      `      name: ${JSON.stringify(toolName)},`,
      '      description: "Generated reload probe",',
      '      inputSchema: { type: "object", additionalProperties: false },',
      `      invoke: () => ({ owner: ${JSON.stringify(idPrefix)} }),`,
      '    });',
      '  },',
      '}',
    ].join('\n'),
  })
  const defined = value(definition)
  const started = await tools.invoke('runtime-plugin.run', {
    pluginId: defined.pluginId,
    packageId: defined.packageId,
    mode: 'run',
    name: defined.name,
    purpose: defined.purpose,
    sourceDigest: defined.sourceDigest,
  })
  expect(started).toMatchObject({ ok: true })
  return defined
}

describe('Dynamic Runtime Plugins under Composition Runtime', () => {
  it('settles generated children, resets ephemeral state on valid replacement, rolls invalid replacement back, and disposes to quiescence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-dynamic-composition-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    await writeFile(loaderPath, loader(20))
    const definition = createCompositionDefinition({
      id: 'dynamic-composition',
      revision: 'authored-one',
      loaderPath,
    })
    let tools: Tools | undefined
    const host: Plugin = {
      name: 'dynamic-composition-host',
      inject: ['doppelgangerTools'],
      apply(ctx: Context) {
        tools = ctx.get('doppelgangerTools') as Tools
      },
    }
    const reloads = eventQueue()
    const failures = eventQueue()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReload: reloads.push,
      onReloadFailure: failures.push,
    })
    const session = await runtime.activate({
      composition: definition,
      sessionId: 'dynamic-composition-session',
      runtimePlugins: { host },
    })
    if (tools === undefined) throw new Error('host tools did not activate')
    expect(tools.list().map(tool => tool.name)).toContain('runtime-plugin.run')

    await defineAndRun(tools, 'before', 'generated.before-reload')
    expect(await tools.invoke('generated.before-reload', {})).toEqual({ ok: true, value: { owner: 'before' } })

    const valid = reloads.next('valid dynamic row replacement')
    await writeFile(loaderPath, loader(30))
    const committed = await valid
    expect(await tools.invoke('runtime-plugin.inspect-self', {})).toEqual({ ok: true, value: { plugins: [] } })
    expect(await tools.invoke('generated.before-reload', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })

    await defineAndRun(tools, 'retained', 'generated.retained')
    expect(await tools.invoke('generated.retained', {})).toEqual({ ok: true, value: { owner: 'retained' } })

    const invalid = failures.next('invalid dynamic row replacement')
    await writeFile(loaderPath, loader(0))
    const rejected = await invalid
    expect(rejected.compositionRevision).toBe(committed.compositionRevision)
    expect(rejected.diagnostics.reload).toMatchObject({ state: 'failed', error: expect.stringContaining('vmTimeoutMs') })
    expect(await tools.invoke('generated.retained', {})).toEqual({ ok: true, value: { owner: 'retained' } })
    expect(await tools.invoke('runtime-plugin.inspect-self', {})).toMatchObject({
      ok: true,
      value: { plugins: [{ pluginId: 'retained-1', packageCount: 1, running: true }] },
    })

    await session.dispose()
    expect(tools.list()).toEqual([])
    expect(await tools.invoke('generated.retained', {})).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
    await runtime.dispose()
  })
})
