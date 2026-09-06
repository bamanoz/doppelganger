import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionDefinition,
  type ProtectedComposition,
} from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(entries: unknown[] = []): Promise<{ readonly root: string; readonly loaderPath: string; readonly definition: CompositionDefinition }> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-host-extensions-'))
  roots.push(root)
  const loaderPath = join(root, 'runtime.cordis.json')
  await writeFile(loaderPath, JSON.stringify(entries))
  return {
    root,
    loaderPath,
    definition: createCompositionDefinition({ id: 'host-extensions', revision: 'fixture', loaderPath }),
  }
}

function composition(entries: ProtectedComposition['entries']): ProtectedComposition {
  return { entries }
}

describe('Host Extension Composition', () => {
  it('defines a domain-neutral protected composition without host imports', async () => {
    const files = await fixture()
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition: files.definition,
      sessionId: 'empty',
      protectedComposition: composition([]),
    })

    expect(session.diagnostics().entries.map(entry => entry.id)).toEqual([
      'doppelganger-runtime-session-metadata',
    ])
    await runtime.dispose()
  })

  it('exposes only the unified protected composition activation contract', async () => {
    const files = await fixture()
    const runtime = createCompositionRuntime({ watch: false })
    const legacyPlugins = {
      composition: files.definition,
      sessionId: 'legacy-plugins',
      runtimePlugins: {},
    }
    const legacyIsolation = {
      composition: files.definition,
      sessionId: 'legacy-isolation',
      runtimePluginIsolation: {},
    }

    await expect(runtime.activate(legacyPlugins as never)).rejects.toThrow('activation.runtimePlugins is not supported')
    await expect(runtime.activate(legacyIsolation as never)).rejects.toThrow('activation.runtimePluginIsolation is not supported')
    await runtime.dispose()
  })

  it('settles dependent host extensions through the protected Loader tree', async () => {
    const files = await fixture()
    const observed: string[] = []
    const provider: Plugin = {
      name: 'host-fact-provider',
      apply(ctx: Context) {
        observed.push('provider')
        ctx.provide('hostSessionFacts', Object.freeze({ sessionId: 'dependent' }))
      },
    }
    const consumer: Plugin = {
      name: 'host-fact-consumer',
      inject: ['hostSessionFacts'],
      apply(ctx: Context) {
        const facts = ctx.get('hostSessionFacts') as { readonly sessionId: string }
        observed.push(facts.sessionId)
      },
    }
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition: files.definition,
      sessionId: 'dependent',
      protectedComposition: composition([
        { id: 'facts', plugin: provider, isolate: { hostSessionFacts: 'session' } },
        { id: 'consumer', plugin: consumer },
      ]),
    })

    expect(observed).toEqual(['provider', 'dependent'])
    expect(session.diagnostics().entries.map(entry => entry.id)).toEqual([
      'doppelganger-runtime-session-metadata',
      'doppelganger-runtime-facts',
      'doppelganger-runtime-consumer',
    ])
    await runtime.dispose()
  })

  it('validates protected entries before creating a Cordis Fiber', async () => {
    const files = await fixture()
    let applied = false
    const plugin: Plugin = { name: 'must-not-apply', apply: () => { applied = true } }
    const runtime = createCompositionRuntime({ watch: false })

    await expect(runtime.activate({
      composition: files.definition,
      sessionId: 'duplicate',
      protectedComposition: composition([{ id: 'same', plugin }, { id: 'same', plugin }]),
    })).rejects.toThrow('duplicates protected entry')
    await expect(runtime.activate({
      composition: files.definition,
      sessionId: 'reserved',
      protectedComposition: composition([{ id: 'session', plugin }]),
    })).rejects.toThrow('reserved by the runtime')
    await expect(runtime.activate({
      composition: files.definition,
      sessionId: 'isolate',
      protectedComposition: composition([{ id: 'facts', plugin, isolate: { facts: 'global' as 'session' } }]),
    })).rejects.toThrow('must equal "session"')
    expect(applied).toBe(false)
    await runtime.dispose()
  })

  it('keeps Host Extensions outside authored preset and patch control', async () => {
    const files = await fixture([{ id: 'doppelganger-runtime-forged', name: './forged.mjs' }])
    const runtime = createCompositionRuntime({ watch: false })

    await expect(runtime.activate({
      composition: files.definition,
      sessionId: 'forged',
      protectedComposition: composition([]),
    })).rejects.toThrow('uses reserved prefix')
    await runtime.dispose()
  })

  it('exhausts protected and authored cleanup when a host extension fails', async () => {
    const files = await fixture()
    const disposed: string[] = []
    const runtime = createCompositionRuntime({ watch: false })

    let failure: unknown
    try {
      await runtime.activate({
        composition: files.definition,
        sessionId: 'cleanup',
        protectedComposition: composition([
          {
            id: 'failing-cleanup',
            plugin: {
              name: 'failing-cleanup',
              apply: () => () => {
                disposed.push('failing')
                throw new Error('protected cleanup failed')
              },
            },
          },
          {
            id: 'sibling-cleanup',
            plugin: { name: 'sibling-cleanup', apply: () => () => { disposed.push('sibling') } },
          },
          {
            id: 'blocked',
            plugin: { name: 'blocked', inject: ['missingHostFact'], apply() {} },
          },
        ]),
      })
    } catch (error) {
      failure = error
    }
    if (!(failure instanceof AggregateError)) throw failure
    const failureText = failure.errors.map(error => error instanceof Error ? error.message : String(error)).join('\n')
    expect(failureText).toContain('missingHostFact')
    expect(failureText).toContain('protected cleanup failed')
    expect(disposed).toEqual(expect.arrayContaining(['failing', 'sibling']))
    await expect(runtime.dispose()).resolves.toBeUndefined()
  })

  it('preserves one protected composition across authored reload', async () => {
    const files = await fixture()
    const featurePath = join(files.root, 'feature.mjs')
    await writeFile(featurePath, "export default { name: 'feature', apply() {} }")
    let protectedActivations = 0
    let resolveReload: (() => void) | undefined
    const reloaded = new Promise<void>(resolve => { resolveReload = resolve })
    const runtime = createCompositionRuntime({
      watch: { base: files.root, root: ['.'], debounce: 10, ignored: [] },
      onReload: () => resolveReload?.(),
    })
    const session = await runtime.activate({
      composition: files.definition,
      sessionId: 'reload',
      protectedComposition: composition([{
        id: 'stable',
        plugin: { name: 'stable-protected', apply: () => { protectedActivations += 1 } },
      }]),
    })

    await writeFile(files.loaderPath, JSON.stringify([{ id: 'feature', name: './feature.mjs' }]))
    await reloaded
    expect(protectedActivations).toBe(1)
    expect(session.diagnostics().entries.map(entry => entry.id)).toContain('doppelganger-runtime-stable')
    await runtime.dispose()
  })

  it('isolates concurrent protected compositions by Runtime Session', async () => {
    const files = await fixture()
    const observed = new Map<string, string>()
    const entry = (sessionId: string): ProtectedComposition['entries'][number] => ({
      id: 'facts',
      plugin: {
        name: `facts-${sessionId}`,
        inject: ['doppelgangerRuntimeSession'],
        apply(ctx: Context) {
          ctx.provide('hostSessionFacts', Object.freeze({ sessionId }))
          observed.set(sessionId, ctx.doppelgangerRuntimeSession.sessionId)
        },
      },
      isolate: { hostSessionFacts: 'session', doppelgangerRuntimeSession: 'session' },
    })
    const runtime = createCompositionRuntime({ watch: false })
    await Promise.all([
      runtime.activate({ composition: files.definition, sessionId: 'first', protectedComposition: composition([entry('first')]) }),
      runtime.activate({ composition: files.definition, sessionId: 'second', protectedComposition: composition([entry('second')]) }),
    ])

    expect(observed).toEqual(new Map([['first', 'first'], ['second', 'second']]))
    await runtime.dispose()
  })
})
