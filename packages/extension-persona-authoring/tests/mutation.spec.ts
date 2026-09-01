import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPersonaActivationPlugin,
  type PersonaAssetReloadEvent,
  type PersonaAssetRevision,
} from '@doppelganger/doppelganger-persona'
import { ToolRegistry } from '@doppelganger/doppelganger-protocols'
import { PersonaAuthoringPlugin } from '../src/index.ts'

const temporaryRoots: string[] = []

function revision(content: string): PersonaAssetRevision {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup(options: { readonly hmrTimeoutMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-mutation-'))
  temporaryRoots.push(root)
  const identity = join(root, 'identity.md')
  const writable = join(root, 'evolving-profile.md')
  const protectedTrait = join(root, 'engineer.md')
  const unrelated = join(root, 'unrelated.md')
  await Promise.all([
    writeFile(identity, 'Identity.\n'),
    writeFile(writable, 'Initial profile.\n', { mode: 0o640 }),
    writeFile(protectedTrait, 'Engineer.\n'),
    writeFile(unrelated, 'Untouched.\n'),
  ])
  const ctx = new Context()
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(createPersonaActivationPlugin({
    instanceId: 'mark',
    sessionId: 'mutation-session',
    identity: { path: identity },
    traits: [
      { name: 'evolving-profile', path: writable },
      { name: 'engineer', path: protectedTrait },
    ],
  }))
  const authoring = await ctx.plugin(PersonaAuthoringPlugin, {
    writableTargets: ['trait:evolving-profile'],
    hmrTimeoutMs: options.hmrTimeoutMs ?? 500,
    lockTimeoutMs: 500,
  })
  const writableUrl = pathToFileURL(await realpath(writable)).href
  return { root, identity, writable, writableUrl, protectedTrait, unrelated, ctx, authoring }
}

async function inspectRevision(ctx: Context): Promise<PersonaAssetRevision> {
  const result = await ctx.doppelgangerTools.invoke('persona.inspect', { target: 'trait:evolving-profile' })
  if (!result.ok) throw new Error('inspection failed')
  const value = result.value
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('inspection failed')
  const record = value as Readonly<Record<string, unknown>>
  if (typeof record.revision !== 'string') throw new Error('inspection revision missing')
  return record.revision as PersonaAssetRevision
}

function revise(
  ctx: Context,
  expectedRevision: PersonaAssetRevision,
  replacement: string,
  input: Record<string, unknown> = {},
) {
  return ctx.doppelgangerTools.invoke('persona.revise', {
    target: 'trait:evolving-profile',
    expectedRevision,
    replacement,
    rationale: 'Durable collaboration behavior changed.',
    evidenceIds: ['memory:one', 'session:two'],
    ...input,
  })
}

function emit(ctx: Context, event: PersonaAssetReloadEvent): void {
  ctx.emit('doppelganger/persona-asset-reloaded', event)
}

async function waitForContent(filename: string, content: string): Promise<void> {
  await expect.poll(() => readFile(filename, 'utf8')).toBe(content)
}

describe('Persona mutation engine', () => {
  it('applies one HMR-confirmed exact replacement, preserves mode, and makes retries idempotent', async () => {
    const { ctx, authoring, writable, writableUrl, unrelated } = await setup()
    const expected = await inspectRevision(ctx)
    const replacement = 'Updated profile.\n'
    const applied = revise(ctx, expected, replacement)
    await waitForContent(writable, replacement)
    emit(ctx, { url: writableUrl, outcome: 'success', revision: revision(replacement) })
    await expect(applied).resolves.toEqual({
      ok: true,
      value: { status: 'applied', target: 'trait:evolving-profile', revision: revision(replacement) },
    })
    expect((await stat(writable)).mode & 0o777).toBe(0o640)
    await expect(readFile(unrelated, 'utf8')).resolves.toBe('Untouched.\n')

    await expect(revise(ctx, expected, replacement)).resolves.toEqual({
      ok: true,
      value: { status: 'already-current', target: 'trait:evolving-profile', revision: revision(replacement) },
    })
    await authoring.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects protected, conflicting, malformed, empty, invalid-Unicode, and oversized revisions', async () => {
    const { ctx, authoring, writable } = await setup()
    const expected = await inspectRevision(ctx)

    await expect(ctx.doppelgangerTools.invoke('persona.revise', {
      target: 'identity',
      expectedRevision: expected,
      replacement: 'Changed identity.\n',
      rationale: 'Not allowed.',
    })).resolves.toMatchObject({ ok: false, error: { code: 'PERSONA_TARGET_READ_ONLY' } })
    await expect(ctx.doppelgangerTools.invoke('persona.revise', {
      target: 'trait:engineer',
      expectedRevision: expected,
      replacement: 'Changed engineer.\n',
      rationale: 'Not allowed.',
    })).resolves.toMatchObject({ ok: false, error: { code: 'PERSONA_TARGET_READ_ONLY' } })

    await writeFile(writable, 'External edit.\n')
    await expect(revise(ctx, expected, 'Replacement.\n')).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PERSONA_REVISION_CONFLICT',
        data: { currentRevision: revision('External edit.\n') },
      },
    })
    await expect(revise(ctx, revision('External edit.\n'), ' ')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    })
    await expect(revise(ctx, revision('External edit.\n'), '\ud800')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    })
    await expect(revise(ctx, revision('External edit.\n'), 'x'.repeat(65_537))).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERSONA_ASSET_TOO_LARGE' },
    })
    await expect(revise(ctx, revision('External edit.\n'), 'Valid.\n', { path: writable })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    })
    await expect(readFile(writable, 'utf8')).resolves.toBe('External edit.\n')
    await authoring.dispose()
    await ctx.fiber.dispose()
  })

  it('ignores unrelated revisions and rolls a rejected candidate back after restoration confirmation', async () => {
    const { ctx, authoring, writable, writableUrl } = await setup()
    const expected = await inspectRevision(ctx)
    const replacement = 'Rejected profile.\n'
    const operation = revise(ctx, expected, replacement)
    await waitForContent(writable, replacement)
    emit(ctx, { url: writableUrl, outcome: 'success', revision: revision('Other bytes.\n') })
    await delay(20)
    await expect(readFile(writable, 'utf8')).resolves.toBe(replacement)
    emit(ctx, { url: writableUrl, outcome: 'failed', revision: revision(replacement) })
    await waitForContent(writable, 'Initial profile.\n')
    emit(ctx, { url: writableUrl, outcome: 'success', revision: expected })
    await expect(operation).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PERSONA_REVISION_REJECTED',
        data: { candidateRevision: revision(replacement), restoredRevision: expected },
      },
    })
    await expect(readFile(writable, 'utf8')).resolves.toBe('Initial profile.\n')
    await authoring.dispose()
    await ctx.fiber.dispose()
  })

  it('rolls timed-out candidates back and distinguishes confirmed from unconfirmed restoration', async () => {
    const confirmed = await setup({ hmrTimeoutMs: 150 })
    const expected = await inspectRevision(confirmed.ctx)
    const replacement = 'Timed out profile.\n'
    const operation = revise(confirmed.ctx, expected, replacement)
    await waitForContent(confirmed.writable, replacement)
    await waitForContent(confirmed.writable, 'Initial profile.\n')
    emit(confirmed.ctx, {
      url: confirmed.writableUrl,
      outcome: 'success',
      revision: expected,
    })
    await expect(operation).resolves.toMatchObject({ ok: false, error: { code: 'PERSONA_HMR_TIMEOUT' } })
    await confirmed.authoring.dispose()
    await confirmed.ctx.fiber.dispose()

    const unconfirmed = await setup({ hmrTimeoutMs: 40 })
    const unconfirmedExpected = await inspectRevision(unconfirmed.ctx)
    const unconfirmedOperation = revise(unconfirmed.ctx, unconfirmedExpected, 'Unconfirmed profile.\n')
    await expect(unconfirmedOperation).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'PERSONA_ROLLBACK_UNCONFIRMED',
        data: {
          candidateRevision: revision('Unconfirmed profile.\n'),
          restoredRevision: unconfirmedExpected,
          observedRevision: unconfirmedExpected,
        },
      },
    })
    await expect(readFile(unconfirmed.writable, 'utf8')).resolves.toBe('Initial profile.\n')
    await unconfirmed.authoring.dispose()
    await unconfirmed.ctx.fiber.dispose()
  })

  it('drains an in-flight mutation before plugin disposal completes', async () => {
    const { ctx, authoring, writable, writableUrl } = await setup()
    const expected = await inspectRevision(ctx)
    const replacement = 'Dispose-safe profile.\n'
    const operation = revise(ctx, expected, replacement)
    await waitForContent(writable, replacement)
    let disposed = false
    const disposal = authoring.dispose().then(() => { disposed = true })
    await delay(20)
    expect(disposed).toBe(false)
    emit(ctx, { url: writableUrl, outcome: 'success', revision: revision(replacement) })
    await expect(operation).resolves.toMatchObject({ ok: true, value: { status: 'applied' } })
    await disposal
    expect(ctx.doppelgangerTools.list()).toEqual([])
    await ctx.fiber.dispose()
  })
})
