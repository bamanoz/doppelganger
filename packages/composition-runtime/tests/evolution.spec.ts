import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context, type Plugin } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
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

interface Tools {
  snapshot(): { readonly revision: string; readonly tools: readonly { readonly name: string; readonly revision: string }[] }
}
interface ToolsEvents {
  on(name: 'doppelganger/tools-changed', listener: (revision: string) => void): () => void
}


function actor(actorId?: string): Plugin {
  return {
    name: 'evolution-test-actor',
    apply(ctx: Context) {
      ctx.provide('doppelgangerActor', actorId === undefined
        ? Object.freeze({ state: 'unbound' as const })
        : Object.freeze({ state: 'bound' as const, actorId }))
    },
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

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

function evolutionEntry(remindersEnabled = true): EntryOptions {
  return {
    id: 'evolution',
    name: evolutionModule,
    inject: [
      'doppelgangerRuntimeSession', 'doppelgangerActor', 'doppelgangerPersona',
      'doppelgangerInstanceSqlite', 'doppelgangerContext', 'doppelgangerTools',
    ],
    isolate: {
      doppelgangerRuntimeSession: 'session',
      doppelgangerActor: 'session',
      doppelgangerPersona: 'session',
      doppelgangerInstanceSqlite: 'session',
      doppelgangerContext: 'session',
      doppelgangerTools: 'session',
      doppelgangerEvolution: 'session',
    },
    config: { remindersEnabled },
  }
}

function loader(home: string, options: { evolution?: boolean; sqlite?: boolean; reminders?: boolean } = {}): string {
  const entries: unknown[] = [
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
      config: { instanceId: 'arbitrary-persona' },
    },
  ]
  if (options.sqlite !== false) entries.push({
    id: 'sqlite',
    name: sqliteModule,
    isolate: { doppelgangerInstanceSqlite: 'session' },
    config: { home },
  })
  if (options.evolution !== false) entries.push(evolutionEntry(options.reminders ?? true))
  return JSON.stringify(entries)
}

function observer(target: Map<string, { service: object; tools: readonly string[] }>): Plugin {
  return {
    name: 'evolution-composition-observer',
    inject: ['doppelgangerRuntimeSession', 'doppelgangerEvolution', 'doppelgangerTools'],
    apply(ctx: Context) {
      const tools = ctx.get('doppelgangerTools') as Tools
      const update = () => target.set(ctx.doppelgangerRuntimeSession.sessionId, {
        service: ctx.get('doppelgangerEvolution') as object,
        tools: tools.snapshot().tools.map(tool => tool.name),
      })
      update()
      ;(ctx as unknown as ToolsEvents).on('doppelganger/tools-changed', update)
    },
  }
}

describe('Evolution under Composition Runtime', () => {
  it('activates an arbitrary isolated Runtime Preset and remains neutral when omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-composition-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    await writeFile(loaderPath, loader(root, { evolution: false }))
    const runtime = createCompositionRuntime({ watch: false })
    const observed = new Map<string, { service: object; tools: readonly string[] }>()
    const plainDefinition = createCompositionDefinition({ id: 'arbitrary-evolution', revision: 'one', loaderPath })
    const definition = createCompositionDefinition({
      ...plainDefinition,
      patches: [{ source: 'Evolution opt-in', baseUrl: root, patches: [{ insert: [evolutionEntry()] }] }],
    })
    const hostActor = actor('actor-a')
    const first = await runtime.activate({
      composition: definition,
      sessionId: 'first',
      protectedComposition: {
        entries: [
          { id: 'actor', plugin: hostActor, isolate: { doppelgangerActor: 'session' } },
          { id: 'observer', plugin: observer(observed) },
        ],
      },
    })
    await runtime.activate({
      composition: definition,
      sessionId: 'second',
      protectedComposition: {
        entries: [
          { id: 'actor', plugin: hostActor, isolate: { doppelgangerActor: 'session' } },
          { id: 'observer', plugin: observer(observed) },
        ],
      },
    })
    expect(observed.get('first')?.tools).toEqual([
      'evolution.inspect', 'evolution.list', 'evolution.propose', 'evolution.reject',
      'evolution.reminder.record', 'evolution.snooze', 'evolution.transition',
    ])
    expect(observed.get('first')?.service).not.toBe(observed.get('second')?.service)
    expect(first.diagnostics().entries.find(entry => entry.id === 'evolution')).toMatchObject({ state: 'active' })
    await runtime.dispose()

    await writeFile(loaderPath, loader(root, { evolution: false }))
    const neutralRuntime = createCompositionRuntime({ watch: false })
    let tools: readonly string[] = ['unexpected']
    const neutralObserver: Plugin = {
      name: 'neutral-observer',
      inject: ['doppelgangerTools'],
      apply(ctx: Context) { tools = (ctx.get('doppelgangerTools') as Tools).snapshot().tools.map(tool => tool.name) },
    }
    await neutralRuntime.activate({
      composition: plainDefinition,
      sessionId: 'neutral',
      protectedComposition: {
        entries: [
          { id: 'observer', plugin: neutralObserver },
        ],
      },
    })
    expect(tools).toEqual([])
    await neutralRuntime.dispose()
  })

  it('reports missing injection, rejects an unbound actor, and commits valid watched configuration changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-evolution-reload-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const definition = createCompositionDefinition({ id: 'reloadable-evolution', revision: 'one', loaderPath })

    await writeFile(loaderPath, loader(root, { sqlite: false }))
    const missingRuntime = createCompositionRuntime({ watch: false })
    await expect(missingRuntime.activate({
      composition: definition,
      sessionId: 'missing',
      protectedComposition: {
        entries: [
          { id: 'actor', plugin: actor('actor-a'), isolate: { doppelgangerActor: 'session' } },
        ],
      },
    })).rejects.toThrow('missing services: doppelgangerInstanceSqlite')
    await missingRuntime.dispose()

    await writeFile(loaderPath, loader(root))
    const unboundRuntime = createCompositionRuntime({ watch: false })
    await expect(unboundRuntime.activate({
      composition: definition,
      sessionId: 'unbound',
      protectedComposition: {
        entries: [
          { id: 'actor', plugin: actor(), isolate: { doppelgangerActor: 'session' } },
        ],
      },
    })).rejects.toThrow('Evolution requires a bound host actor')
    await unboundRuntime.dispose()

    await writeFile(loaderPath, loader(root, { reminders: false }))
    const reloads = eventQueue()
    const watched = createCompositionRuntime({ watch: { base: root, root: [] }, onReload: reloads.push })
    const active = await watched.activate({
      composition: definition,
      sessionId: 'watched',
      protectedComposition: {
        entries: [
          { id: 'actor', plugin: actor('actor-a'), isolate: { doppelgangerActor: 'session' } },
        ],
      },
    })
    const next = reloads.next('Evolution config replacement')
    await writeFile(loaderPath, loader(root, { reminders: true }))
    const committed = await next
    expect(committed.diagnostics.entries.find(entry => entry.id === 'evolution')).toMatchObject({ state: 'active' })
    expect(active.diagnostics().entries.find(entry => entry.id === 'evolution')).toMatchObject({ state: 'active' })
    await watched.dispose()
  })
})
