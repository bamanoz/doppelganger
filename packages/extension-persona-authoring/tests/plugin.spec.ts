import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin } from '@doppelganger/doppelganger-persona'
import { ToolRegistry } from '@doppelganger/doppelganger-protocols'
import {
  PersonaAuthoringPlugin,
  normalizePersonaAuthoringConfig,
  type PersonaAuthoringConfig,
} from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-authoring-'))
  temporaryRoots.push(root)
  const identity = join(root, 'identity.md')
  const writable = join(root, 'evolving-profile.md')
  const protectedTrait = join(root, 'engineer.md')
  await Promise.all([
    writeFile(identity, 'Test identity.\n'),
    writeFile(writable, 'Evolving profile.\n'),
    writeFile(protectedTrait, 'Engineering quality.\n'),
  ])
  return { root, identity, writable, protectedTrait }
}

async function setup(config: PersonaAuthoringConfig) {
  const files = await fixture()
  const ctx = new Context()
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(createPersonaActivationPlugin({
    instanceId: 'test-persona',
    sessionId: 'session-one',
    identity: { path: files.identity },
    traits: [
      { name: 'evolving-profile', path: files.writable },
      { name: 'engineer', path: files.protectedTrait },
    ],
  }))
  const authoring = await ctx.plugin(PersonaAuthoringPlugin, config)
  return { ...files, ctx, authoring }
}

describe('Persona Authoring foundation', () => {
  it('normalizes strict bounded configuration', () => {
    const normalized = normalizePersonaAuthoringConfig({
      writableTargets: ['trait:evolving-profile'],
    })
    expect(normalized).toEqual({
      writableTargets: ['trait:evolving-profile'],
      maximumAssetBytes: 65_536,
      hmrTimeoutMs: 3_000,
      lockTimeoutMs: 3_000,
    })
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.writableTargets)).toBe(true)

    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: [],
      extra: true,
    })).toThrow('unknown field "extra"')
    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: ['trait:evolving-profile', 'trait:evolving-profile'],
    })).toThrow('writableTargets must be unique')
    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: ['identity'],
    })).toThrow('logical trait target')
    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: ['../identity.md'],
    })).toThrow('logical trait target')
    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: ['trait:*'],
    })).toThrow('safe logical trait target')
    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: [],
      maximumAssetBytes: 1_048_577,
    })).toThrow('maximumAssetBytes')
    expect(() => normalizePersonaAuthoringConfig({
      writableTargets: [],
      hmrTimeoutMs: 0,
    })).toThrow('hmrTimeoutMs')
  })

  it('registers exactly inspect and approved revise for one writable active trait', async () => {
    const { ctx, authoring, writable, identity } = await setup({ writableTargets: ['trait:evolving-profile'] })
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([
      expect.objectContaining({ name: 'persona.inspect', available: true }),
      expect.objectContaining({
        name: 'persona.revise',
        available: true,
        approval: {
          policy: 'required',
          reason: 'This changes active Persona instructions.',
        },
      }),
    ])

    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'persona.inspect', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'persona.inspect')!.revision, input: { target: 'identity' } }, 'test-session')).resolves.toMatchObject({
      ok: true,
      value: { target: 'identity', writable: false, content: 'Test identity.\n' },
    })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'persona.inspect', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'persona.inspect')!.revision, input: { target: 'trait:engineer' } }, 'test-session')).resolves.toMatchObject({
      ok: true,
      value: { target: 'trait:engineer', writable: false },
    })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'persona.inspect', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'persona.inspect')!.revision, input: { target: 'trait:evolving-profile' } }, 'test-session')).resolves.toMatchObject({
      ok: true,
      value: { target: 'trait:evolving-profile', writable: true, content: 'Evolving profile.\n' },
    })

    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'persona.inspect', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'persona.inspect')!.revision, input: { target: 'trait:absent' } }, 'test-session')).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSONA_TARGET_UNKNOWN' },
    })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'persona.inspect', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'persona.inspect')!.revision, input: { target: writable } }, 'test-session')).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSONA_TARGET_UNKNOWN' },
    })
    await expect(ctx.doppelgangerTools.invoke({ callId: crypto.randomUUID(), name: 'persona.inspect', toolRevision: ctx.doppelgangerTools.snapshot().tools.find(tool => tool.name === 'persona.inspect')!.revision, input: {
      target: 'identity',
      path: identity,
    } }, 'test-session')).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    await authoring.dispose()
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await ctx.fiber.dispose()
  })

  it('fails before tool registration for absent, duplicate, symbolic-link, and non-regular writable assets', async () => {
    const files = await fixture()
    const cases: Array<{
      readonly label: string
      readonly writablePath: string
      readonly writableTargets: readonly `trait:${string}`[]
      readonly traits: Array<{ name: string; path: string }>
    }> = []

    cases.push({
      label: 'absent',
      writablePath: files.writable,
      writableTargets: ['trait:absent'],
      traits: [{ name: 'evolving-profile', path: files.writable }],
    })
    cases.push({
      label: 'duplicate',
      writablePath: files.writable,
      writableTargets: ['trait:evolving-profile'],
      traits: [
        { name: 'evolving-profile', path: files.writable },
        { name: 'evolving-profile', path: files.protectedTrait },
      ],
    })

    const symlinkPath = join(files.root, 'writable-link.md')
    await symlink(files.writable, symlinkPath)
    cases.push({
      label: 'symbolic-link',
      writablePath: symlinkPath,
      writableTargets: ['trait:evolving-profile'],
      traits: [{ name: 'evolving-profile', path: symlinkPath }],
    })

    const directoryPath = join(files.root, 'trait-directory')
    await mkdir(directoryPath)
    cases.push({
      label: 'non-regular',
      writablePath: directoryPath,
      writableTargets: ['trait:evolving-profile'],
      traits: [{ name: 'evolving-profile', path: directoryPath }],
    })

    for (const candidate of cases) {
      const ctx = new Context()
      await ctx.plugin(ToolRegistry)
      await ctx.plugin(createPersonaActivationPlugin({
        instanceId: 'test-persona',
        sessionId: `session-${candidate.label}`,
        traits: candidate.traits,
      }))
      await expect(ctx.plugin(PersonaAuthoringPlugin, {
        writableTargets: candidate.writableTargets,
      })).rejects.toThrow()
      expect(ctx.doppelgangerTools.snapshot().tools, candidate.label).toEqual([])
      await ctx.fiber.dispose()
    }
  })
  it('keeps Persona read-only when authoring plugin is omitted', async () => {
    const files = await fixture()
    const ctx = new Context()
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(createPersonaActivationPlugin({
      instanceId: 'test-persona',
      sessionId: 'read-only-session',
      identity: { path: files.identity },
      traits: [{ name: 'evolving-profile', path: files.writable }],
    }))

    expect(ctx.doppelgangerPersona.traits).toEqual([
      expect.objectContaining({ name: 'evolving-profile' }),
    ])
    expect(ctx.doppelgangerTools.snapshot().tools).toEqual([])
    await ctx.fiber.dispose()
  })

})
