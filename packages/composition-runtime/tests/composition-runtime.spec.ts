import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CompositionActivationError,
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionDefinition,
} from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function composition(
  entries: readonly EntryOptions[],
  options: {
    readonly imports?: Readonly<Record<string, Plugin>>
    readonly mounts?: Parameters<typeof createCompositionDefinition>[0]['mounts']
  } = {},
): Promise<CompositionDefinition> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-'))
  temporaryRoots.push(root)
  const loaderPath = join(root, 'cordis.json')
  await writeFile(loaderPath, JSON.stringify(entries))
  return createCompositionDefinition({
    id: 'generic-composition',
    revision: 'one',
    loaderPath,
    ...(options.imports === undefined ? {} : { imports: options.imports }),
    ...(options.mounts === undefined ? {} : { mounts: options.mounts }),
  })
}

describe('composition definitions', () => {
  it('normalizes and freezes domain-neutral contracts', () => {
    const loaderPath = resolve('fixtures', 'cordis.yml')
    const plugin: Plugin = { name: 'feature', apply: () => undefined }
    const definition = createCompositionDefinition({
      id: 'generic',
      revision: 'one',
      loaderPath,
      imports: { feature: plugin },
      mounts: { host: { target: 'protocols' }, optional: { required: false } },
    })

    expect(definition).toMatchObject({
      id: 'generic',
      revision: 'one',
      loaderPath,
      root: resolve('fixtures'),
      imports: { feature: plugin },
      mounts: {
        host: { target: 'protocols', required: true },
        optional: { required: false },
      },
    })
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.imports)).toBe(true)
    expect(Object.isFrozen(definition.mounts.host)).toBe(true)
  })

  it('rejects malformed paths, imports, mount names, and reserved imports', () => {
    const loaderPath = resolve('fixtures', 'cordis.yml')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath: 'cordis.yml' }))
      .toThrow('loaderPath must be absolute')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath: resolve('cordis.txt') }))
      .toThrow('must name a .json, .yaml, or .yml Loader tree')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath, imports: { group: {} as Plugin } }))
      .toThrow('reserved by the runtime')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath, mounts: { BadName: {} } }))
      .toThrow('lowercase kebab-case')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath, mounts: { host: { target: '' } } }))
      .toThrow('target must be a non-empty string')
  })
})

describe('named mounts and session isolation', () => {
  it('mounts declared plugins at their target and isolates concurrent sessions', async () => {
    const observed = new Map<string, string>()
    const consumer: Plugin = {
      name: 'consumer',
      inject: ['mountedValue', 'sessionLabel'],
      apply(ctx) {
        const label = ctx.get('sessionLabel') as string
        observed.set(label, ctx.get('mountedValue') as string)
      },
    }
    const definition = await composition([{
      id: 'protocols',
      name: 'cordis:group',
      group: true,
      isolate: { mountedValue: 'session', sessionLabel: 'session' },
      config: [{ id: 'consumer', name: 'cordis:consumer' }],
    }], {
      imports: { consumer },
      mounts: {
        host: { target: 'protocols' },
        metadata: { target: 'protocols' },
        optional: { required: false },
      },
    })
    const runtime = createCompositionRuntime({ watch: false })
    const provider = (service: string, value: string): Plugin => ({
      name: `${service}-${value}`,
      apply(ctx) { ctx.provide(service, value) },
    })

    const [first, second] = await Promise.all([
      runtime.activate({
        composition: definition,
        sessionId: 'first',
        mounts: {
          host: provider('mountedValue', 'alpha'),
          metadata: provider('sessionLabel', 'first'),
        },
      }),
      runtime.activate({
        composition: definition,
        sessionId: 'second',
        mounts: {
          host: provider('mountedValue', 'beta'),
          metadata: provider('sessionLabel', 'second'),
        },
      }),
    ])

    expect(observed).toEqual(new Map([['first', 'alpha'], ['second', 'beta']]))
    await first.dispose()
    expect(second.diagnostics().entries.every(entry => entry.state === 'active')).toBe(true)
    await runtime.dispose()
  })

  it('rejects undeclared and missing required mounts before activation', async () => {
    const definition = await composition([], { mounts: { host: {} } })
    const runtime = createCompositionRuntime({ watch: false })
    const plugin: Plugin = { name: 'noop', apply: () => undefined }

    await expect(runtime.activate({ composition: definition, sessionId: 'missing' }))
      .rejects.toThrow('mount "host" is required')
    await expect(runtime.activate({ composition: definition, sessionId: 'extra', mounts: { host: plugin, extra: plugin } }))
      .rejects.toThrow('mount "extra" is not declared')
    await runtime.dispose()
  })

  it('rejects a mount whose declared target does not exist', async () => {
    const definition = await composition([], { mounts: { host: { target: 'missing-group' } } })
    const runtime = createCompositionRuntime({ watch: false })
    const activation = runtime.activate({
      composition: definition,
      sessionId: 'invalid-target',
      mounts: { host: { name: 'host', apply: () => undefined } },
    })

    await expect(activation).rejects.toMatchObject({
      diagnostics: {
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'doppelganger-mount-host', state: 'missing' }),
        ]),
      },
    })
    await runtime.dispose()
  })
})

describe('activation audit and lifecycle', () => {
  it('reports missing services and cleans partially activated resources', async () => {
    let disposed = 0
    const started: Plugin = { name: 'started', apply: () => () => { disposed += 1 } }
    const waiting: Plugin = { name: 'waiting', inject: ['absentService'], apply: () => undefined }
    const definition = await composition([
      { id: 'started', name: 'cordis:started' },
      { id: 'waiting', name: 'cordis:waiting' },
    ], { imports: { started, waiting } })
    const runtime = createCompositionRuntime({ watch: false })

    const activation = runtime.activate({ composition: definition, sessionId: 'audit' })
    await expect(activation).rejects.toBeInstanceOf(CompositionActivationError)
    await expect(activation).rejects.toMatchObject({
      diagnostics: {
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'waiting', state: 'pending', missingServices: ['absentService'] }),
        ]),
      },
    })
    expect(disposed).toBe(1)
    await runtime.dispose()
  })

  it('keeps caller-owned roots alive and disposes sessions idempotently', async () => {
    const definition = await composition([])
    const context = new Context()
    const runtime = createCompositionRuntime({ context, watch: false })
    const first = await runtime.activate({ composition: definition, sessionId: 'first' })
    const second = await runtime.activate({ composition: definition, sessionId: 'second' })

    const firstDisposal = first.dispose()
    expect(first.dispose()).toBe(firstDisposal)
    await firstDisposal
    expect(second.diagnostics().entries).toEqual([])
    const runtimeDisposal = runtime.dispose()
    expect(runtime.dispose()).toBe(runtimeDisposal)
    await runtimeDisposal
    await expect(context.plugin(() => undefined).await()).resolves.toBeDefined()
    await context.fiber.dispose()
  })
})
