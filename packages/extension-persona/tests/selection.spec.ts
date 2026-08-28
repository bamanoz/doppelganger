import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionRuntime } from '@doppelganger/composition-runtime'
import { type ContextProtocol } from '@doppelganger/extension-protocols'
import {
  resolvePersonaSelection,
  type PersonaActivation,
} from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-selection-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const instanceHome = join(home, 'instances', 'aiden')
  const definitionRoot = join(root, 'definition')
  const projectRoot = join(root, 'project')
  await Promise.all([
    mkdir(instanceHome, { recursive: true }),
    mkdir(join(definitionRoot, 'traits'), { recursive: true }),
    mkdir(join(projectRoot, '.doppelganger'), { recursive: true }),
  ])
  const userConfigPath = join(home, 'config.yaml')
  const otherUserConfigPath = join(home, 'other-config.yaml')
  const noDefaultConfigPath = join(home, 'no-default.yaml')
  const projectManifestPath = join(projectRoot, '.doppelganger', 'manifest.yaml')
  const instancePath = join(instanceHome, 'instance.yaml')
  const definitionPath = join(definitionRoot, 'persona.yaml')
  const loaderPath = join(definitionRoot, 'cordis.yaml')
  await Promise.all([
    writeFile(userConfigPath, [
      'version: 1',
      'principalId: local-user',
      'defaultInstance: aiden',
      'instances:',
      '  aiden: instances/aiden/instance.yaml',
    ].join('\n')),
    writeFile(otherUserConfigPath, [
      'version: 1',
      'principalId: other-user',
      'defaultInstance: aiden',
      'instances:',
      '  aiden: instances/aiden/instance.yaml',
    ].join('\n')),
    writeFile(noDefaultConfigPath, [
      'version: 1',
      'principalId: local-user',
      'instances:',
      '  aiden: instances/aiden/instance.yaml',
    ].join('\n')),
    writeFile(projectManifestPath, [
      'version: 1',
      'projectId: selection-project',
      'instanceId: aiden',
      'traits: [engineer, concise]',
    ].join('\n')),
    writeFile(instancePath, [
      'version: 1',
      'id: aiden',
      'definition: ../../../definition/persona.yaml',
    ].join('\n')),
    writeFile(definitionPath, [
      'version: 1',
      'id: aiden',
      'revision: one',
      'loader: cordis.yaml',
      'identity: { path: identity.md, priority: 1000 }',
      'traits:',
      '  engineer: { path: traits/engineer.md }',
      '  concise: { path: traits/concise.md }',
      'mounts:',
      '  persona: { target: session-protocols }',
      '  host: { target: session-protocols }',
    ].join('\n')),
    writeFile(loaderPath, [
      '- id: session-protocols',
      '  name: cordis:group',
      '  group: true',
      '  inject: [loader]',
      '  isolate:',
      '    doppelgangerContext: persona',
      '    doppelgangerPersona: persona',
      '  config:',
      '    - id: context',
      '      name: cordis:context',
      '    - id: identity',
      '      name: cordis:identity',
      '      inject: [doppelgangerContext, doppelgangerPersona]',
      '    - id: traits',
      '      name: cordis:traits',
      '      inject: [doppelgangerContext, doppelgangerPersona]',
    ].join('\n')),
    writeFile(join(definitionRoot, 'identity.md'), 'Identity content.'),
    writeFile(join(definitionRoot, 'traits', 'engineer.md'), 'Engineer trait.'),
    writeFile(join(definitionRoot, 'traits', 'concise.md'), 'Concise trait.'),
  ])
  return { root, userConfigPath, otherUserConfigPath, noDefaultConfigPath, projectManifestPath, instanceHome }
}

describe('persona selection resolution', () => {
  it('resolves project selection, global fallback, and inactive unconfigured state', async () => {
    const files = await fixture()
    const project = await resolvePersonaSelection({
      userConfigPath: files.userConfigPath,
      projectManifestPath: files.projectManifestPath,
    })
    const global = await resolvePersonaSelection({
      userConfigPath: files.userConfigPath,
    })
    const inactive = await resolvePersonaSelection({
      userConfigPath: files.noDefaultConfigPath,
    })

    expect(project).toMatchObject({
      instance: { id: 'aiden' },
      instanceHome: files.instanceHome,
      project: { projectId: 'selection-project' },
      selectedTraits: ['engineer', 'concise'],
      composition: { id: 'aiden', revision: 'one' },
    })
    expect(global).toMatchObject({ instance: { id: 'aiden' }, selectedTraits: [] })
    expect(global).not.toHaveProperty('project')
    expect(inactive).toBeUndefined()
  })

  it('activates concurrent sessions with shared assets but independent runtime services', async () => {
    const files = await fixture()
    const selection = await resolvePersonaSelection({
      userConfigPath: files.userConfigPath,
      projectManifestPath: files.projectManifestPath,
    })
    const otherSelection = await resolvePersonaSelection({
      userConfigPath: files.otherUserConfigPath,
      projectManifestPath: files.projectManifestPath,
    })
    if (selection === undefined) throw new Error('configured selection resolved inactive')
    if (otherSelection === undefined) throw new Error('other principal selection resolved inactive')
    if (selection.project === undefined) throw new Error('project selection lost project metadata')
    const services = new Map<string, ContextProtocol>()
    const activations: PersonaActivation[] = []
    const host: Plugin = {
      name: 'selection-host',
      inject: ['doppelgangerContext', 'doppelgangerPersona'],
      apply(ctx) {
        services.set(ctx.doppelgangerPersona.sessionId, ctx.doppelgangerContext)
        activations.push(ctx.doppelgangerPersona)
      },
    }
    const runtime = createCompositionRuntime({ watch: false })
    const sessions = await Promise.all([
      { selection, sessionId: 'one' },
      { selection: otherSelection, sessionId: 'two' },
    ].map(({ selection: selected, sessionId }) => runtime.activate({
      composition: selected.composition,
      sessionId,
      mounts: {
        persona: selected.personaMount(sessionId),
        host,
      },
    })))

    expect(activations.map(activation => activation.instanceId)).toEqual(['aiden', 'aiden'])
    expect(activations.map(activation => activation.principalId).sort()).toEqual(['local-user', 'other-user'])
    expect(activations.every(activation => activation.projectId === 'selection-project')).toBe(true)
    expect(activations.every(Object.isFrozen)).toBe(true)
    expect(services.size).toBe(2)
    expect(services.get('one')).not.toBe(services.get('two'))
    expect(selection.definition.identity?.path).toContain('identity.md')

    await sessions[0]!.dispose()
    const secondService = services.get('two')
    if (secondService === undefined) throw new Error('second session service missing')
    const secondContext = await secondService.resolve({ turn: { input: 'task' }, tokenBudget: 1000 })
    expect(secondContext.content).toContain('Identity content.')
    expect(secondContext.content).toContain('Engineer trait.')
    await runtime.dispose()
  })
})
