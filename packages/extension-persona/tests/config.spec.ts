import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PersonaConfigError,
  loadPersonaDefinitionMetadata,
  loadPersonaInstanceMetadata,
  loadProjectPersonaManifest,
  loadUserPersonaConfig,
  selectPersonaTraits,
} from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('persona configuration', () => {
  it('loads user, project, instance, Loader, identity, and ordered trait configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-config-'))
    temporaryRoots.push(root)
    const userHome = join(root, 'home')
    const instanceHome = join(userHome, 'instances', 'aiden')
    const definitionRoot = join(root, 'definitions', 'aiden')
    const projectRoot = join(root, 'project')
    await Promise.all([
      mkdir(instanceHome, { recursive: true }),
      mkdir(definitionRoot, { recursive: true }),
      mkdir(join(projectRoot, '.doppelganger'), { recursive: true }),
    ])
    const userConfigPath = join(userHome, 'config.yaml')
    const instancePath = join(instanceHome, 'instance.yaml')
    const definitionPath = join(definitionRoot, 'persona.yaml')
    const loaderPath = join(definitionRoot, 'cordis.yaml')
    const manifestPath = join(projectRoot, '.doppelganger', 'manifest.yaml')
    await Promise.all([
      writeFile(userConfigPath, [
        'version: 1',
        'principalId: local-user',
        'defaultInstance: aiden',
        'instances:',
        '  aiden: instances/aiden/instance.yaml',
      ].join('\n')),
      writeFile(instancePath, [
        'version: 1',
        'id: aiden',
        'definition: ../../../definitions/aiden/persona.yaml',
      ].join('\n')),
      writeFile(definitionPath, [
        'version: 1',
        'id: aiden',
        'revision: "2026-08-28"',
        'loader: cordis.yaml',
        'identity:',
        '  path: identity.md',
        '  priority: 100',
        'traits:',
        '  engineer:',
        '    path: traits/engineer.md',
        '    priority: 80',
        '  concise:',
        '    path: traits/concise.md',
        '    priority: 70',
        'mounts:',
        '  persona: { target: protocols }',
      ].join('\n')),
      writeFile(loaderPath, [
        '- id: protocols',
        '  name: cordis:group',
        '  group: true',
        '  config:',
        '    - id: context',
        '      name: cordis:context',
      ].join('\n')),
      writeFile(manifestPath, [
        'version: 1',
        'projectId: doppelganger',
        'instanceId: aiden',
        'traits:',
        '  - engineer',
        '  - concise',
      ].join('\n')),
    ])

    const projectFilesBefore = await readdir(projectRoot, { recursive: true })
    const user = await loadUserPersonaConfig(userConfigPath)
    const project = await loadProjectPersonaManifest(manifestPath)
    const instance = await loadPersonaInstanceMetadata(user.instances.aiden!)
    const definition = await loadPersonaDefinitionMetadata(instance.definition)
    const traits = selectPersonaTraits(definition, project.traits, manifestPath)

    expect(user.defaultInstance).toBe('aiden')
    expect(user.principalId).toBe('local-user')
    expect(instance).toMatchObject({ id: 'aiden', definition: definitionPath })
    expect(definition).toMatchObject({
      id: 'aiden',
      revision: '2026-08-28',
      loaderPath,
      identity: { path: join(definitionRoot, 'identity.md'), priority: 100 },
      mounts: { persona: { target: 'protocols' } },
    })
    expect(definition.entries[0]).toMatchObject({ id: 'protocols', group: true })
    expect(traits.map(trait => trait.path)).toEqual([
      join(definitionRoot, 'traits', 'engineer.md'),
      join(definitionRoot, 'traits', 'concise.md'),
    ])
    expect(await readdir(projectRoot, { recursive: true })).toEqual(projectFilesBefore)
  })

  it('returns field-level diagnostics for invalid input and unknown traits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-errors-'))
    temporaryRoots.push(root)
    const manifestPath = join(root, 'manifest.yaml')
    const missingPrincipalPath = join(root, 'missing-principal.yaml')
    const invalidPrincipalPath = join(root, 'invalid-principal.yaml')
    await writeFile(manifestPath, [
      'version: 2',
      'projectId: ""',
      'instance: aiden',
      'traits:',
      '  - engineer',
      '  - engineer',
    ].join('\n'))
    await writeFile(missingPrincipalPath, 'version: 1\ninstances: {}\n')
    await writeFile(invalidPrincipalPath, 'version: 1\nprincipalId: " "\ninstances: {}\n')
    for (const filename of [missingPrincipalPath, invalidPrincipalPath]) {
      await expect(loadUserPersonaConfig(filename)).rejects.toMatchObject({
        diagnostics: expect.arrayContaining([{
          path: '$.principalId',
          message: 'must be a non-empty string',
        }]),
      })
    }

    try {
      await loadProjectPersonaManifest(manifestPath)
      expect.unreachable('invalid project manifest loaded')
    } catch (error) {
      expect(error).toBeInstanceOf(PersonaConfigError)
      expect((error as PersonaConfigError).diagnostics).toEqual(expect.arrayContaining([
        { path: '$.instance', message: 'unknown field' },
        { path: '$.version', message: 'must equal 1' },
        { path: '$.projectId', message: 'must be a non-empty string' },
        { path: '$.instanceId', message: 'must be a non-empty string' },
        { path: '$.traits[1]', message: 'duplicate trait "engineer"' },
      ]))
    }

    expect(() => selectPersonaTraits({
      version: 1,
      id: 'aiden',
      revision: 'one',
      loader: 'cordis.yaml',
      traits: {},
      mounts: {},
    }, ['unknown'], manifestPath)).toThrow('unknown trait "unknown"')
  })
})
