import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectPersonaAsset } from '../src/asset.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function expectedRevision(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

describe('Persona asset inspection', () => {
  it('returns exact validated bytes, content, canonical URL, mode, and revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-authoring-asset-'))
    temporaryRoots.push(root)
    const filename = join(root, 'trait.md')
    const bytes = Buffer.from('Exact content with newline.\n')
    await writeFile(filename, bytes, { mode: 0o640 })

    const asset = await inspectPersonaAsset(filename, bytes.length)
    expect(asset.filename).toBe(filename)
    expect(asset.url).toBe(pathToFileURL(await realpath(filename)).href)
    expect(asset.content).toBe('Exact content with newline.\n')
    expect(asset.bytes).toEqual(bytes)
    expect(asset.revision).toBe(expectedRevision(bytes))
    expect(asset.mode).toBe(0o640)
    expect(Object.isFrozen(asset)).toBe(true)
  })

  it('rejects unsafe, invalid UTF-8, oversized, and non-regular assets without following links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-authoring-asset-'))
    temporaryRoots.push(root)
    const target = join(root, 'target.md')
    const link = join(root, 'link.md')
    const directory = join(root, 'directory')
    const invalid = join(root, 'invalid.md')
    const oversized = join(root, 'oversized.md')
    await Promise.all([
      writeFile(target, 'target'),
      mkdir(directory),
      writeFile(invalid, Uint8Array.of(0xff)),
      writeFile(oversized, '12345'),
    ])
    await symlink(target, link)

    await expect(inspectPersonaAsset(join(root, 'absent.md'), 10)).rejects.toMatchObject({
      code: 'PERSONA_ASSET_UNSAFE',
    })
    await expect(inspectPersonaAsset(link, 10)).rejects.toMatchObject({ code: 'PERSONA_ASSET_UNSAFE' })
    await expect(inspectPersonaAsset(directory, 10)).rejects.toMatchObject({ code: 'PERSONA_ASSET_UNSAFE' })
    await expect(inspectPersonaAsset(invalid, 10)).rejects.toMatchObject({ code: 'PERSONA_ASSET_UNSAFE' })
    await expect(inspectPersonaAsset(oversized, 4)).rejects.toMatchObject({ code: 'PERSONA_ASSET_TOO_LARGE' })
  })
})
