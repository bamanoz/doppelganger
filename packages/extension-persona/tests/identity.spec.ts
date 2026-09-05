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

describe('identity plugin', () => {
  it('contributes instruction Markdown and reloads valid content for the next resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-identity-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.json')
    const identityPath = join(root, 'identity.md')
    await Promise.all([
      writeFile(identityPath, '# Test Persona\n\nPrefer evidence.'),
      writeFile(join(root, 'context.mjs'), `export { ContextProtocol as default } from ${JSON.stringify(new URL('../../extension-protocols/src/index.ts', import.meta.url).href)}\n`),
      writeFile(join(root, 'identity.mjs'), `export { IdentityPlugin as default } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)}\n`),
      writeFile(loaderPath, JSON.stringify([
        { id: 'context', name: './context.mjs', isolate: { doppelgangerContext: 'session' } },
        {
          id: 'identity',
          name: './identity.mjs',
          isolate: { doppelgangerContext: 'session' },
        },
      ])),
    ])
    const identityUrl = pathToFileURL(await realpath(identityPath)).href
    let resolveContext: (() => Promise<AssembledContext>) | undefined
    let observeReload: ((url: string, outcome: 'success' | 'failed') => Promise<void>) | undefined
    let notifyChange: ((url: string) => void) | undefined
    const host: Plugin = {
      name: 'identity-host',
      inject: ['doppelgangerContext'],
      apply(ctx) {
        resolveContext = () => ctx.doppelgangerContext.resolve({
          turn: { input: 'current task' },
          tokenBudget: 1000,
        })
        observeReload = (url, outcome) => nextReload(ctx, url, outcome)
        notifyChange = url => ctx.emit('hmr/change', url)
      },
    }
    const context = new Context()
    const runtime = createCompositionRuntime({ context, watch: false })
    const session = await runtime.activate({
      composition: { id: 'identity-composition', revision: 'one', loaderPath, patches: [] },
      sessionId: 'identity-session',
      runtimePlugins: {
        host,
        persona: createPersonaActivationPlugin({
          instanceId: 'test-persona',
          sessionId: 'identity-session',
          identity: { path: identityPath, priority: 500 },
        }),
      },
    })
    if (resolveContext === undefined || observeReload === undefined || notifyChange === undefined) {
      throw new Error('identity host did not activate')
    }

    const resolver = resolveContext
    const observe = observeReload
    const notify = notifyChange
    expect((await resolver()).contributions).toEqual([expect.objectContaining({
      source: 'persona.identity',
      authority: 'instruction',
      priority: 500,
      content: '# Test Persona\n\nPrefer evidence.',
    })])
    let changed = observe(identityUrl, 'success')
    await writeFile(identityPath, '# Test Persona\n\nPrefer verified evidence.')
    notify(identityUrl)
    await changed
    expect((await resolver()).instructions).toContain('verified evidence')
    changed = observe(identityUrl, 'failed')
    await writeFile(identityPath, '')
    notify(identityUrl)
    await changed
    expect((await resolver()).instructions).toContain('verified evidence')
    changed = observe(identityUrl, 'success')
    await writeFile(identityPath, '# Test Persona\n\nPrefer recoverable evidence.')
    notify(identityUrl)
    await changed
    expect((await resolver()).instructions).toContain('recoverable evidence')
    await session.dispose()
    await runtime.dispose()
    await context.fiber.dispose()
  })
})
