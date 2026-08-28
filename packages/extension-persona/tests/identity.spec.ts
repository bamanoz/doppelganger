import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionDefinition, createCompositionRuntime } from '@doppelganger/composition-runtime'
import { ContextProtocol, type AssembledContext } from '@doppelganger/extension-protocols'
import { IdentityPlugin, createPersonaActivationPlugin } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('identity plugin', () => {
  it('contributes instruction Markdown and reloads valid content for the next resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-identity-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'cordis.json')
    const identityPath = join(root, 'identity.md')
    await writeFile(identityPath, '# Aiden\n\nPrefer evidence.')
    await writeFile(loaderPath, JSON.stringify([
      { id: 'context', name: 'cordis:context' },
      { id: 'identity', name: 'cordis:identity' },
    ]))
    let resolveContext: (() => Promise<AssembledContext>) | undefined
    const host: Plugin = {
      name: 'identity-host',
      inject: ['doppelgangerContext'],
      apply(ctx) {
        resolveContext = () => ctx.doppelgangerContext.resolve({
          turn: { input: 'current task' },
          tokenBudget: 1000,
        })
      },
    }
    const composition = createCompositionDefinition({
      id: 'identity-composition',
      revision: 'one',
      loaderPath,
      imports: { context: ContextProtocol, identity: IdentityPlugin },
      mounts: { persona: {}, host: {} },
    })
    const runtime = createCompositionRuntime({ watch: { base: root, root: ['.'], debounce: 5 } })
    const session = await runtime.activate({
      composition,
      sessionId: 'identity-session',
      mounts: {
        persona: createPersonaActivationPlugin({
          instanceId: 'aiden',
          principalId: 'local-user',
          sessionId: 'identity-session',
          instanceHome: join(root, 'instance'),
          definitionRoot: root,
          identity: { path: identityPath, priority: 500 },
        }),
        host,
      },
    })
    if (resolveContext === undefined) throw new Error('identity host did not activate')

    const resolver = resolveContext
    expect((await resolver()).contributions).toEqual([expect.objectContaining({
      source: 'persona.identity',
      authority: 'instruction',
      priority: 500,
      content: '# Aiden\n\nPrefer evidence.',
    })])
    await writeFile(identityPath, '# Aiden\n\nPrefer verified evidence.')
    await expect.poll(async () => (await resolver()).content).toContain('verified evidence')

    await session.dispose()
    await runtime.dispose()
  })
})
