import { hostname } from 'node:os'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquirePersonaAssetLock } from '../src/lock.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function target() {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-persona-lock-'))
  temporaryRoots.push(root)
  const filename = join(root, 'trait.md')
  await writeFile(filename, 'Profile.\n')
  return { filename, lockPath: `${filename}.doppelganger.lock` }
}

describe('Persona asset interprocess lock', () => {
  it('excludes concurrent owners and removes only its own token', async () => {
    const { filename, lockPath } = await target()
    const first = await acquirePersonaAssetLock(filename, 100)
    await expect(acquirePersonaAssetLock(filename, 30)).rejects.toMatchObject({ code: 'PERSONA_LOCK_TIMEOUT' })

    const foreign = `${JSON.stringify({
      version: 1,
      token: '00000000-0000-4000-8000-000000000000',
      pid: process.pid,
      hostname: hostname(),
      createdAt: new Date().toISOString(),
    })}\n`
    await writeFile(lockPath, foreign)
    await first.release()
    await expect(readFile(lockPath, 'utf8')).resolves.toBe(foreign)
  })

  it('recovers only a provably dead same-host owner and fails closed on uncertain metadata', async () => {
    const { filename, lockPath } = await target()
    await writeFile(lockPath, `${JSON.stringify({
      version: 1,
      token: '11111111-1111-4111-8111-111111111111',
      pid: 999_999,
      hostname: hostname(),
      createdAt: new Date(0).toISOString(),
    })}\n`)
    const recovered = await acquirePersonaAssetLock(filename, 100)
    await recovered.release()
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(lockPath, '{"unknown":true}\n')
    await expect(acquirePersonaAssetLock(filename, 30)).rejects.toMatchObject({ code: 'PERSONA_LOCK_TIMEOUT' })
    await expect(readFile(lockPath, 'utf8')).resolves.toBe('{"unknown":true}\n')
  })
})
