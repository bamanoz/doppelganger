import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, type Plugin } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionReloadEvent,
} from '../src/index.ts'

const temporaryRoots: string[] = []
const contextModule = fileURLToPath(new URL('../../extension-protocols/src/context-plugin.ts', import.meta.url))
const toolsModule = fileURLToPath(new URL('../../extension-protocols/src/tools-plugin.ts', import.meta.url))
const personaModule = fileURLToPath(new URL('../../extension-persona/src/index.ts', import.meta.url))
const sqliteModule = fileURLToPath(new URL('../../extension-sqlite/src/index.ts', import.meta.url))
const evolutionModule = fileURLToPath(new URL('../../extension-evolution/src/index.ts', import.meta.url))

interface InferenceService {
  infer(request: { readonly input: string }): Promise<{ readonly value: { readonly generation: string } }>
}

interface InferenceHarness {
  readonly calls: string[]
  readonly pending: Map<string, () => void>
}
interface PiCompositionHarness {
  generation: string
  readonly calls: string[]
  readonly pending: Map<string, () => void>
}


declare global {
  var doppelgangerInferenceCompositionHarness: InferenceHarness | undefined
  var doppelgangerPiCompositionHarness: PiCompositionHarness | undefined
}


function actor(actorId: string): Plugin {
  return {
    name: 'inference-test-actor',
    apply(ctx: Context) {
      ctx.provide('doppelgangerActor', Object.freeze({ state: 'bound' as const, actorId }))
    },
  }
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
        }, 3_000),
      }
      waiters.push(waiter)
      return promise
    },
  }
}

async function providerModule(root: string): Promise<string> {
  const filename = join(root, 'inference-provider.mjs')
  await writeFile(filename, `
export default {
  name: 'composition-inference-provider',
  provide: 'doppelgangerInference',
  apply(ctx, config) {
    if (config.fail === true) throw new Error('invalid inference provider generation')
    const generation = config.generation
    const service = Object.freeze({
      async infer(request) {
        const harness = globalThis.doppelgangerInferenceCompositionHarness
        harness?.calls.push(generation + ':' + request.input)
        if (request.input === 'hold') {
          await new Promise(resolve => harness?.pending.set(generation, resolve))
        }
        return Object.freeze({ value: Object.freeze({ generation }) })
      },
    })
    ctx.provide('doppelgangerInference', service)
  },
}
`)
  return filename
}

async function piProviderModule(root: string): Promise<string> {
  const filename = join(root, 'pi-inference-provider.mjs')
  const piModule = new URL('../../extension-inference-pi/src/index.ts', import.meta.url).href
  const protocolsModule = new URL('../../extension-protocols/src/index.ts', import.meta.url).href
  const sdkModule = new URL('../../../node_modules/@earendil-works/pi-ai/dist/index.js', import.meta.url).href
  await writeFile(filename, `
import { createStructuredInference } from ${JSON.stringify(protocolsModule)}
import { PiStructuredInferenceProvider, normalizePiInferencePluginConfig } from ${JSON.stringify(piModule)}
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from ${JSON.stringify(sdkModule)}

export default {
  name: 'composition-pi-inference-provider',
  provide: 'doppelgangerInference',
  apply(ctx, input) {
    const generation = globalThis.doppelgangerPiCompositionHarness?.generation ?? 'unconfigured'
    const models = createModels()
    const faux = fauxProvider({
      provider: 'composition-faux',
      models: [{ id: 'composition-model' }],
    })
    faux.setResponses([async (_context, _options, state) => {
      const harness = globalThis.doppelgangerPiCompositionHarness
      harness?.calls.push(generation + ':' + state.callCount)
      if (generation === 'one') {
        await new Promise(resolve => harness?.pending.set(generation, resolve))
      }
      return fauxAssistantMessage(fauxToolCall('return_result', { generation }))
    }])
    models.setProvider(faux.provider)
    const provider = new PiStructuredInferenceProvider(normalizePiInferencePluginConfig(input), models)
    ctx.provide('doppelgangerInference', createStructuredInference(provider))
    ctx.effect(() => () => provider.close(), 'compositionPiInference.close')
  },
}
`)
  return filename
}

function providerEntry(module: string, generation: string, id = 'inference', fail = false): EntryOptions {
  return {
    id,
    name: module,
    isolate: { doppelgangerInference: 'session' },
    config: { generation, ...(fail ? { fail: true } : {}) },
  }
}
function piEntry(module: string, maximumOutputTokens: number): EntryOptions {
  return {
    id: 'pi-inference',
    name: module,
    isolate: { doppelgangerInference: 'session' },
    config: {
      provider: 'composition-faux',
      model: 'composition-model',
      maximumOutputTokens,
    },
  }
}

function structuredRequest(input: string) {
  return {
    purpose: 'composition.pi-snapshot',
    system: 'Return the configured generation.',
    input,
    outputSchema: {
      type: 'object',
      properties: { generation: { type: 'string' } },
      required: ['generation'],
      additionalProperties: false,
    },
  } as const
}


function evolutionEntry(signalInferenceEnabled: boolean): EntryOptions {
  return {
    id: 'evolution',
    name: evolutionModule,
    inject: [
      'doppelgangerRuntimeSession', 'doppelgangerActor', 'doppelgangerPersona',
      'doppelgangerInstanceSqlite', 'doppelgangerContext', 'doppelgangerTools',
      ...(signalInferenceEnabled ? ['doppelgangerInference'] : []),
    ],
    isolate: {
      doppelgangerRuntimeSession: 'session',
      doppelgangerActor: 'session',
      doppelgangerPersona: 'session',
      doppelgangerInstanceSqlite: 'session',
      doppelgangerContext: 'session',
      doppelgangerTools: 'session',
      doppelgangerEvolution: 'session',
      doppelgangerInference: 'session',
    },
    config: { signalInferenceEnabled },
  }
}

function evolutionLoader(home: string, provider: EntryOptions | undefined, signalInferenceEnabled: boolean): string {
  const entries: EntryOptions[] = [
    { id: 'context', name: contextModule, isolate: { doppelgangerContext: 'session' } },
    { id: 'tools', name: toolsModule, isolate: { doppelgangerTools: 'session' } },
    {
      id: 'persona',
      name: personaModule,
      inject: ['doppelgangerRuntimeSession', 'doppelgangerContext'],
      isolate: {
        doppelgangerRuntimeSession: 'session',
        doppelgangerContext: 'session',
        doppelgangerPersona: 'session',
      },
      config: { instanceId: 'inference-composition-persona' },
    },
    { id: 'sqlite', name: sqliteModule, isolate: { doppelgangerInstanceSqlite: 'session' }, config: { home } },
    evolutionEntry(signalInferenceEnabled),
    ...(provider === undefined ? [] : [provider]),
  ]
  return JSON.stringify(entries)
}

function inferenceObserver(set: (service: InferenceService) => void): Plugin {
  return {
    name: 'inference-composition-observer',
    inject: ['doppelgangerInference'],
    apply(ctx: Context) {
      set(ctx.get('doppelgangerInference') as InferenceService)
    },
  }
}

afterEach(async () => {
  globalThis.doppelgangerInferenceCompositionHarness = undefined
  globalThis.doppelgangerPiCompositionHarness = undefined
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Structured inference under Composition Runtime', () => {
  it('keeps arbitrary Runtime Presets neutral when structured inference is omitted and rejects duplicate providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-inference-composition-'))
    temporaryRoots.push(root)
    const module = await providerModule(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const definition = createCompositionDefinition({ id: 'inference-composition', revision: 'one', loaderPath })

    await writeFile(loaderPath, '[]')
    const neutral = createCompositionRuntime({ watch: false })
    const session = await neutral.activate({ composition: definition, sessionId: 'neutral' })
    expect(session.diagnostics().entries.map(entry => entry.id)).toEqual(['doppelganger-runtime-session-metadata'])
    await neutral.dispose()

    await writeFile(loaderPath, JSON.stringify([
      providerEntry(module, 'one', 'inference-one'),
      providerEntry(module, 'two', 'inference-two'),
    ]))
    const duplicate = createCompositionRuntime({ watch: false })
    await expect(duplicate.activate({ composition: definition, sessionId: 'duplicate' })).rejects.toThrow()
    await duplicate.dispose()
  })

  it('replaces Pi inference configuration atomically while in-flight calls retain their captured generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-pi-inference-reload-'))
    temporaryRoots.push(root)
    const module = await piProviderModule(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const definition = createCompositionDefinition({ id: 'pi-inference-reload', revision: 'one', loaderPath })
    globalThis.doppelgangerPiCompositionHarness = { generation: 'one', calls: [], pending: new Map() }
    await writeFile(loaderPath, JSON.stringify([piEntry(module, 11)]))
    const reloads = eventQueue()
    const failures = eventQueue()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReload: reloads.push,
      onReloadFailure: failures.push,
    })
    const services: InferenceService[] = []
    await runtime.activate({
      composition: definition,
      sessionId: 'pi-reload',
      runtimePlugins: { observer: inferenceObserver(service => services.push(service)) },
    })
    const first = services.at(-1)!
    const inFlight = first.infer(structuredRequest('hold'))
    const inFlightOutcome = inFlight.then(
      value => ({ value } as const),
      error => ({ error } as const),
    )
    await vi.waitFor(() => expect(globalThis.doppelgangerPiCompositionHarness?.pending.has('one')).toBe(true))

    globalThis.doppelgangerPiCompositionHarness.generation = 'two'
    const replacement = reloads.next('Pi inference replacement')
    await writeFile(loaderPath, JSON.stringify([piEntry(module, 22)]))
    await replacement
    const second = services.at(-1)!
    await expect(second.infer(structuredRequest('next'))).resolves.toEqual({
      value: { generation: 'two' },
      usage: expect.any(Object),
    })
    globalThis.doppelgangerPiCompositionHarness.pending.get('one')?.()
    const oldOutcome = await inFlightOutcome
    expect(oldOutcome).toEqual({ error: expect.objectContaining({ code: 'UNAVAILABLE' }) })
    expect(globalThis.doppelgangerPiCompositionHarness.calls).toEqual(['one:1', 'two:1'])

    const rollback = failures.next('invalid Pi inference rollback')
    await writeFile(loaderPath, JSON.stringify([{
      ...piEntry(module, 33),
      config: { provider: 'missing-provider', model: 'missing-model' },
    }]))
    await rollback
    const restored = services.at(-1)!
    await expect(restored.infer(structuredRequest('after-rollback'))).resolves.toEqual({
      value: { generation: 'two' },
      usage: expect.any(Object),
    })
    await runtime.dispose()
  })

  it('replaces inference provider snapshots atomically while in-flight calls retain their captured generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-inference-reload-'))
    temporaryRoots.push(root)
    const module = await providerModule(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const definition = createCompositionDefinition({ id: 'inference-reload', revision: 'one', loaderPath })
    await writeFile(loaderPath, JSON.stringify([providerEntry(module, 'one')]))
    const reloads = eventQueue()
    const failures = eventQueue()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReload: reloads.push,
      onReloadFailure: failures.push,
    })
    const services: InferenceService[] = []
    globalThis.doppelgangerInferenceCompositionHarness = { calls: [], pending: new Map() }
    await runtime.activate({
      composition: definition,
      sessionId: 'reload',
      runtimePlugins: { observer: inferenceObserver(service => services.push(service)) },
    })
    const first = services.at(-1)!
    const inFlight = first.infer({ input: 'hold' })
    await Promise.resolve()
    expect(globalThis.doppelgangerInferenceCompositionHarness.pending.has('one')).toBe(true)

    const replacement = reloads.next('inference provider replacement')
    await writeFile(loaderPath, JSON.stringify([providerEntry(module, 'two')]))
    await replacement
    const second = services.at(-1)!
    expect(second).not.toBe(first)
    await expect(second.infer({ input: 'next' })).resolves.toEqual({ value: { generation: 'two' } })
    globalThis.doppelgangerInferenceCompositionHarness.pending.get('one')?.()
    await expect(inFlight).resolves.toEqual({ value: { generation: 'one' } })

    const rollback = failures.next('invalid inference provider rollback')
    await writeFile(loaderPath, JSON.stringify([providerEntry(module, 'broken', 'inference', true)]))
    await rollback
    const restored = services.at(-1)!
    await expect(restored.infer({ input: 'after-rollback' })).resolves.toEqual({ value: { generation: 'two' } })
    await runtime.dispose()
  })

  it('resolves an Evolution inference dependency after a later provider row and rejects omission only when enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-inference-dependency-'))
    temporaryRoots.push(root)
    const module = await providerModule(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const definition = createCompositionDefinition({ id: 'evolution-inference-dependency', revision: 'one', loaderPath })

    await writeFile(loaderPath, evolutionLoader(root, providerEntry(module, 'one'), true))
    const ordered = createCompositionRuntime({ watch: false })
    const active = await ordered.activate({
      composition: definition,
      sessionId: 'ordered',
      runtimePlugins: { actor: actor('actor-a') },
      runtimePluginIsolation: { actor: ['doppelgangerActor'] },
    })
    expect(active.diagnostics().entries.find(entry => entry.id === 'evolution')).toMatchObject({ state: 'active' })
    await ordered.dispose()

    await writeFile(loaderPath, evolutionLoader(root, undefined, true))
    const missing = createCompositionRuntime({ watch: false })
    await expect(missing.activate({
      composition: definition,
      sessionId: 'missing',
      runtimePlugins: { actor: actor('actor-a') },
      runtimePluginIsolation: { actor: ['doppelgangerActor'] },
    })).rejects.toThrow('doppelgangerInference')
    await missing.dispose()

    await writeFile(loaderPath, evolutionLoader(root, undefined, false))
    const disabled = createCompositionRuntime({ watch: false })
    const proposalOnly = await disabled.activate({
      composition: definition,
      sessionId: 'disabled',
      runtimePlugins: { actor: actor('actor-a') },
      runtimePluginIsolation: { actor: ['doppelgangerActor'] },
    })
    expect(proposalOnly.diagnostics().entries.find(entry => entry.id === 'evolution')).toMatchObject({ state: 'active' })
    await disabled.dispose()
  })
})
