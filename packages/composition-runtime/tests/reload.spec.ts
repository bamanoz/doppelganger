import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionDefinition, createCompositionRuntime } from '../src/index.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('composition reload', () => {
  it('serializes valid updates and restores the last audited composition after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-reload-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'cordis.json')
    const lifecycle: string[] = []
    const feature: Plugin<{ value: string }> = {
      name: 'reload-feature',
      apply(_ctx: Context, config: { value: string }) {
        lifecycle.push(`start:${config.value}`)
        if (config.value === 'invalid') throw new Error('invalid feature revision')
        return () => { lifecycle.push(`stop:${config.value}`) }
      },
    }
    const entries = (value: string): EntryOptions[] => [{
      id: 'feature',
      name: 'cordis:feature',
      config: { value },
    }]
    await writeFile(loaderPath, JSON.stringify(entries('one')))
    const definition = createCompositionDefinition({
      id: 'reload-composition',
      revision: 'one',
      loaderPath,
      imports: { feature },
    })
    const runtime = createCompositionRuntime({ watch: { base: root, root: [] } })
    const session = await runtime.activate({ composition: definition, sessionId: 'reload' })

    await writeFile(loaderPath, JSON.stringify(entries('two')))
    await expect.poll(() => lifecycle.filter(event => event === 'start:two').length).toBe(1)
    expect(lifecycle).toContain('stop:one')

    await writeFile(loaderPath, JSON.stringify(entries('invalid')))
    await expect.poll(() => session.diagnostics().reload?.state).toBe('failed')
    expect(session.diagnostics().reload?.error).toContain('invalid feature revision')
    expect(lifecycle.filter(event => event === 'start:two').length).toBe(2)

    await writeFile(loaderPath, JSON.stringify(entries('three')))
    await expect.poll(() => lifecycle.filter(event => event === 'start:three').length).toBe(1)
    expect(session.diagnostics().reload).toBeUndefined()

    await runtime.dispose()
    expect(lifecycle.filter(event => event === 'stop:three').length).toBe(1)
  })
})
