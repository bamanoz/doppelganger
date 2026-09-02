import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { createPersonaActivationPlugin, type PersonaAssetRevision } from '@doppelganger/doppelganger-persona'
import { ToolRegistry, type ToolInvocationResult } from '@doppelganger/doppelganger-protocols'
import { PersonaAuthoringPlugin } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function sharedAsset() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-concurrency-'))
  temporaryRoots.push(root)
  const filename = join(root, 'evolving-profile.md')
  await writeFile(filename, 'Initial profile.\n')
  return { filename, url: pathToFileURL(await realpath(filename)).href }
}

async function session(filename: string, id: string) {
  const ctx = new Context()
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(createPersonaActivationPlugin({
    instanceId: 'test-persona',
    sessionId: id,
    traits: [{ name: 'evolving-profile', path: filename }],
  }))
  const authoring = await ctx.plugin(PersonaAuthoringPlugin, {
    writableTargets: ['trait:evolving-profile'],
    hmrTimeoutMs: 500,
    lockTimeoutMs: 1_000,
  })
  return { ctx, authoring }
}

async function inspectedRevision(ctx: Context): Promise<PersonaAssetRevision> {
  const result = await ctx.doppelgangerTools.invoke('persona.inspect', { target: 'trait:evolving-profile' })
  if (!result.ok || result.value === null || Array.isArray(result.value) || typeof result.value !== 'object') {
    throw new Error('inspection failed')
  }
  const revision = (result.value as Readonly<Record<string, unknown>>).revision
  if (typeof revision !== 'string') throw new Error('revision missing')
  return revision as PersonaAssetRevision
}

function revise(ctx: Context, expectedRevision: PersonaAssetRevision, replacement: string): Promise<ToolInvocationResult> {
  return ctx.doppelgangerTools.invoke('persona.revise', {
    target: 'trait:evolving-profile',
    expectedRevision,
    replacement,
    rationale: 'Concurrent test.',
  })
}

async function child(filename: string, expectedRevision: string, replacement: string, pause: number) {
  const childPath = fileURLToPath(new URL('./fixtures/lock-cas-child.ts', import.meta.url))
  const processHandle = spawn(process.execPath, ['--no-warnings', childPath, filename, expectedRevision, replacement, String(pause)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  processHandle.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
  processHandle.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
  const [code] = await once(processHandle, 'exit') as [number | null]
  if (code !== 0) throw new Error(Buffer.concat(stderr).toString('utf8'))
  return JSON.parse(Buffer.concat(stdout).toString('utf8')) as { status: string }
}

function resultStatus(result: ToolInvocationResult): string | undefined {
  if (!result.ok || result.value === null || Array.isArray(result.value) || typeof result.value !== 'object') {
    return undefined
  }
  const status = (result.value as Readonly<Record<string, unknown>>).status
  return typeof status === 'string' ? status : undefined
}

describe('Persona concurrent writers', () => {
  it('allows at most one same-revision Runtime Session to commit', async () => {
    const { filename, url } = await sharedAsset()
    const first = await session(filename, 'session-one')
    const second = await session(filename, 'session-two')
    const expected = await inspectedRevision(first.ctx)
    expect(await inspectedRevision(second.ctx)).toBe(expected)

    const replacements = ['First replacement.\n', 'Second replacement.\n'] as const
    const operations = [
      revise(first.ctx, expected, replacements[0]),
      revise(second.ctx, expected, replacements[1]),
    ]
    await expect.poll(() => readFile(filename, 'utf8')).toSatisfy(content => replacements.includes(content as never))
    const winner = await readFile(filename, 'utf8')
    const revision = await inspectedRevision(winner === replacements[0] ? first.ctx : second.ctx)
    first.ctx.emit('doppelganger/persona-asset-reloaded', { url, outcome: 'success', revision })
    second.ctx.emit('doppelganger/persona-asset-reloaded', { url, outcome: 'success', revision })

    const results = await Promise.all(operations)
    expect(results.filter(result => resultStatus(result) === 'applied')).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.error.code === 'PERSONA_REVISION_CONFLICT')).toHaveLength(1)
    expect(replacements).toContain(winner)

    await Promise.all([first.authoring.dispose(), second.authoring.dispose()])
    await Promise.all([first.ctx.fiber.dispose(), second.ctx.fiber.dispose()])
  })

  it('serializes independent Node processes so one same-revision CAS conflicts', async () => {
    const { filename } = await sharedAsset()
    const inspector = await session(filename, 'inspector')
    const expected = await inspectedRevision(inspector.ctx)
    await inspector.authoring.dispose()
    await inspector.ctx.fiber.dispose()

    const [first, second] = await Promise.all([
      child(filename, expected, 'Process one.\n', 100),
      child(filename, expected, 'Process two.\n', 0),
    ])
    expect([first.status, second.status].sort()).toEqual(['applied', 'conflict'])
    expect(['Process one.\n', 'Process two.\n']).toContain(await readFile(filename, 'utf8'))
  })
})
