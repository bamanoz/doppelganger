import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionRuntime } from '@doppelganger/doppelganger-composition-runtime'
import type { AssembledContext } from '@doppelganger/doppelganger-protocols'
import { createPersonaActivationPlugin } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function nextReload(ctx: Context, url: string, outcome: 'success' | 'failed'): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const timer = setTimeout(() => reject(new Error(`asset reload timed out: ${url} ${outcome}`)), 3000)
  const remove = ctx.on('doppelganger/persona-asset-reloaded', event => {
    if (event.url !== url || event.outcome !== outcome) return
    expect(event.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    remove()
    clearTimeout(timer)
    resolve()
  }, { global: true })
  return promise
}

describe('traits plugin', () => {
  it('composes and reloads selected traits without changing instance identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-traits-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const engineerPath = join(root, 'engineer.md')
    const concisePath = join(root, 'concise.md')
    await Promise.all([
      writeFile(engineerPath, 'Prefer exact interfaces.'),
      writeFile(concisePath, 'Remove filler.'),
      writeFile(join(root, 'context.mjs'), `export { ContextProtocol as default } from ${JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)}\n`),
      writeFile(join(root, 'traits.mjs'), `export { TraitsPlugin as default } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)}\n`),
      writeFile(loaderPath, JSON.stringify([
        { id: 'context', name: './context.mjs', isolate: { doppelgangerContext: 'session' } },
        {
          id: 'traits',
          name: './traits.mjs',
          isolate: { doppelgangerContext: 'session' },
        },
      ])),
    ])
    const engineerUrl = pathToFileURL(await realpath(engineerPath)).href
    let resolveContext: (() => Promise<AssembledContext>) | undefined
    let observeReload: ((url: string, outcome: 'success' | 'failed') => Promise<void>) | undefined
    let notifyChange: ((url: string) => void) | undefined
    const host: Plugin = {
      name: 'traits-host',
      inject: ['doppelgangerContext'],
      apply(ctx) {
        resolveContext = () => ctx.doppelgangerContext.resolve({
          turn: { input: 'task' },
          tokenBudget: 1000,
        })
        observeReload = (url, outcome) => nextReload(ctx, url, outcome)
        notifyChange = url => ctx.emit('hmr/change', url)
      },
    }
    const context = new Context()
    const runtime = createCompositionRuntime({ context, watch: false })
    const session = await runtime.activate({
      composition: { id: 'traits-composition', revision: 'one', loaderPath, patches: [] },
      sessionId: 'traits-session',
      runtimePlugins: {
        host,
        persona: createPersonaActivationPlugin({
          instanceId: 'stable-aiden',
          sessionId: 'traits-session',
          traits: [
            { name: 'engineer', path: engineerPath },
            { name: 'concise', path: concisePath },
          ],
        }),
      },
    })
    if (resolveContext === undefined || observeReload === undefined || notifyChange === undefined) {
      throw new Error('traits host did not activate')
    }
    const resolver = resolveContext
    const observe = observeReload
    const notify = notifyChange

    const result = await resolver()
    expect(result.contributions.map(contribution => contribution.source)).toEqual([
      'persona.trait.0000.engineer',
      'persona.trait.0001.concise',
    ])
    expect(result.contributions.map(contribution => contribution.content)).toEqual([
      'Prefer exact interfaces.',
      'Remove filler.',
    ])
    let changed = observe(engineerUrl, 'success')
    await writeFile(engineerPath, 'Prefer verified interfaces.')
    notify(engineerUrl)
    await changed
    expect((await resolver()).content).toContain('verified interfaces')
    changed = observe(engineerUrl, 'failed')
    await writeFile(engineerPath, '')
    notify(engineerUrl)
    await changed
    expect((await resolver()).content).toContain('verified interfaces')
    changed = observe(engineerUrl, 'success')
    await writeFile(engineerPath, 'Prefer recoverable interfaces.')
    notify(engineerUrl)
    await changed
    expect((await resolver()).content).toContain('recoverable interfaces')

    await session.dispose()
    await runtime.dispose()
    await context.fiber.dispose()
  })
})
