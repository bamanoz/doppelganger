import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersonaAssetReloadEvent, PersonaAssetRevision } from '../src/index.ts'
import {
  createPersonaAsset,
  type PersonaAsset,
  type PersonaAssetDiagnostic,
} from '../src/asset.ts'

const temporaryRoots: string[] = []

function bytes(content: string): Uint8Array {
  return Buffer.from(content)
}

function revision(content: Uint8Array): PersonaAssetRevision {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>()
  const timer = setTimeout(() => reject(new Error(`${label} timed out`)), 3000)
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

function nextReload(ctx: Context): Promise<PersonaAssetReloadEvent> {
  const { promise, resolve } = Promise.withResolvers<PersonaAssetReloadEvent>()
  const remove = ctx.on('doppelganger/persona-asset-reloaded', event => {
    remove()
    resolve(event)
  })
  return timeout(promise, 'Persona asset reload')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('file-backed Persona asset', () => {
  it('uses canonical file URLs and rejects empty or invalid UTF-8 initial content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-asset-'))
    temporaryRoots.push(root)
    const target = join(root, 'identity.md')
    const alias = join(root, 'identity-link.md')
    await writeFile(target, '  Persona identity.  ')
    await symlink(target, alias)

    const ctx = new Context()
    const asset = await createPersonaAsset(ctx, { filename: alias, kind: 'identity' })
    expect(asset.url).toBe(pathToFileURL(await realpath(target)).href)
    await expect(asset.content()).resolves.toBe('Persona identity.')
    await ctx.fiber.dispose()

    const empty = join(root, 'empty.md')
    await writeFile(empty, ' \n\t ')
    const emptyCtx = new Context()
    await expect(createPersonaAsset(emptyCtx, { filename: empty, kind: 'identity' }))
      .rejects.toThrow(`identity asset is empty: ${empty}`)
    await emptyCtx.fiber.dispose()

    const invalid = join(root, 'invalid.md')
    await writeFile(invalid, Uint8Array.of(0xff))
    const invalidCtx = new Context()
    await expect(createPersonaAsset(invalidCtx, { filename: invalid, kind: 'identity' }))
      .rejects.toThrow('encoded data was not valid')
    await invalidCtx.fiber.dispose()
  })

  it('serializes repeated reloads and emits immutable exact-byte revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-asset-'))
    temporaryRoots.push(root)
    const filename = join(root, 'trait.md')
    await writeFile(filename, 'unused')
    const repeated = bytes(' repeated reload \n')
    const first = Promise.withResolvers<Uint8Array>()
    const second = Promise.withResolvers<Uint8Array>()
    const reads: Array<Promise<Uint8Array> | Uint8Array> = [bytes('initial'), first.promise, second.promise]
    const events: PersonaAssetReloadEvent[] = []
    let readCount = 0
    let asset: PersonaAsset | undefined
    const ctx = new Context()
    ctx.on('doppelganger/persona-asset-reloaded', event => { events.push(event) })
    ctx.on('doppelganger/persona-asset-reloaded', () => { throw new Error('observer failed') })
    const plugin: Plugin = {
      name: 'persona-asset-test',
      async apply(owner) {
        asset = await createPersonaAsset(owner, {
          filename,
          kind: 'trait',
          readBytes: async () => {
            const value = reads[readCount++]
            if (value === undefined) throw new Error('unexpected asset read')
            return value
          },
        })
      },
    }
    const fiber = await ctx.plugin(plugin)
    if (asset === undefined) throw new Error('Persona asset did not activate')
    const active = asset

    ctx.emit('hmr/change', pathToFileURL(join(root, 'unrelated.md')).href)
    await Promise.resolve()
    expect(readCount).toBe(1)

    ctx.emit('hmr/change', active.url)
    await Promise.resolve()
    ctx.emit('hmr/change', active.url)
    await Promise.resolve()
    expect(readCount).toBe(2)
    first.resolve(repeated)
    await expect.poll(() => readCount).toBe(3)
    second.resolve(repeated)
    await expect(timeout(active.content(), 'serialized reload')).resolves.toBe('repeated reload')

    expect(events).toEqual([
      { url: active.url, outcome: 'success', revision: revision(repeated) },
      { url: active.url, outcome: 'success', revision: revision(repeated) },
    ])
    expect(events.every(Object.isFrozen)).toBe(true)

    await fiber.dispose()
    ctx.emit('hmr/change', active.url)
    await Promise.resolve()
    expect(readCount).toBe(3)
    expect(events).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('retains last-good content and reports readable and unreadable failed revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-asset-'))
    temporaryRoots.push(root)
    const filename = join(root, 'trait.md')
    await writeFile(filename, 'initial')
    const empty = bytes(' \n')
    const invalid = Uint8Array.of(0xff)
    const nextGood = bytes('next good')
    const reads: Array<Uint8Array | Error> = [bytes('last good'), empty, invalid, new Error('x'.repeat(3000)), nextGood]
    const diagnostics: PersonaAssetDiagnostic[] = []
    let readCount = 0
    const ctx = new Context()
    const asset = await createPersonaAsset(ctx, {
      filename,
      kind: 'trait',
      readBytes: async () => {
        const value = reads[readCount++]
        if (value instanceof Error) throw value
        if (value === undefined) throw new Error('unexpected asset read')
        return value
      },
      onDiagnostic: diagnostic => {
        diagnostics.push(diagnostic)
        throw new Error('diagnostic observer failed')
      },
    })

    let changed = nextReload(ctx)
    ctx.emit('hmr/change', asset.url)
    await expect(changed).resolves.toEqual({ url: asset.url, outcome: 'failed', revision: revision(empty) })
    await expect(asset.content()).resolves.toBe('last good')

    changed = nextReload(ctx)
    ctx.emit('hmr/change', asset.url)
    await expect(changed).resolves.toEqual({ url: asset.url, outcome: 'failed', revision: revision(invalid) })
    await expect(asset.content()).resolves.toBe('last good')

    changed = nextReload(ctx)
    ctx.emit('hmr/change', asset.url)
    await expect(changed).resolves.toEqual({ url: asset.url, outcome: 'failed' })
    await expect(asset.content()).resolves.toBe('last good')

    changed = nextReload(ctx)
    ctx.emit('hmr/change', asset.url)
    await expect(changed).resolves.toEqual({ url: asset.url, outcome: 'success', revision: revision(nextGood) })
    await expect(asset.content()).resolves.toBe('next good')

    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[2]).toMatchObject({ kind: 'trait', filename })
    expect(diagnostics[2]?.message.length).toBeLessThanOrEqual(2048)
    expect(diagnostics[2]?.message.endsWith('…')).toBe(true)
    await ctx.fiber.dispose()
  })
})
