import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionDefinition, createCompositionRuntime } from '@doppelganger/composition-runtime'
import { ContextProtocol, type AssembledContext } from '@doppelganger/extension-protocols'
import { TraitsPlugin, createPersonaActivationPlugin, type PersonaActivation } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('traits plugin', () => {
  it('composes selected traits in order without changing instance identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-traits-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'cordis.json')
    const engineerPath = join(root, 'engineer.md')
    const concisePath = join(root, 'concise.md')
    await Promise.all([
      writeFile(engineerPath, 'Prefer exact interfaces.'),
      writeFile(concisePath, 'Remove filler.'),
      writeFile(loaderPath, JSON.stringify([
        { id: 'context', name: 'cordis:context' },
        { id: 'traits', name: 'cordis:traits' },
      ])),
    ])
    let resolveContext: (() => Promise<AssembledContext>) | undefined
    let activation: PersonaActivation | undefined
    const host: Plugin = {
      name: 'traits-host',
      inject: ['doppelgangerContext', 'doppelgangerPersona'],
      apply(ctx) {
        activation = ctx.doppelgangerPersona
        resolveContext = () => ctx.doppelgangerContext.resolve({
          turn: { input: 'task' },
          tokenBudget: 1000,
        })
      },
    }
    const composition = createCompositionDefinition({
      id: 'traits-composition',
      revision: 'one',
      loaderPath,
      imports: { context: ContextProtocol, traits: TraitsPlugin },
      mounts: { persona: {}, host: {} },
    })
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition,
      sessionId: 'traits-session',
      mounts: {
        persona: createPersonaActivationPlugin({
          instanceId: 'stable-aiden',
          principalId: 'local-user',
          sessionId: 'traits-session',
          instanceHome: join(root, 'instance'),
          definitionRoot: root,
          traits: [
            { name: 'engineer', path: engineerPath },
            { name: 'concise', path: concisePath },
          ],
        }),
        host,
      },
    })
    if (resolveContext === undefined || activation === undefined) throw new Error('traits host did not activate')

    const result = await resolveContext()
    expect(result.contributions.map(contribution => contribution.source)).toEqual([
      'persona.trait.0000.engineer',
      'persona.trait.0001.concise',
    ])
    expect(result.contributions.map(contribution => contribution.content)).toEqual([
      'Prefer exact interfaces.',
      'Remove filler.',
    ])
    expect(result.contributions.every(contribution => contribution.authority === 'instruction')).toBe(true)
    expect(activation.instanceId).toBe('stable-aiden')

    await session.dispose()
    await runtime.dispose()
  })
})
