import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OMP_RUNTIME_HOST_CAPABILITIES } from '../src/contracts.ts'
import {
  instantiateOmpHostExtensions,
  prepareOmpHostExtensions,
} from '../src/host-extensions.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-host-extension-'))
  roots.push(root)
  await writeFile(join(root, 'fixture.mjs'), [
    'let count = 0',
    'export const hostExtension = {',
    '  apiVersion: 1,',
    "  hostKind: 'omp',",
    "  id: 'fixture',",
    '  normalizeConfig(input) { return { label: input.label.trim() } },',
    '  createFactory(config) {',
    '    return context => ({',
    '      plugin: { name: `fixture-${context.sessionId}-${config.label}-${++count}`, apply() {} },',
    '    })',
    '  },',
    '}',
  ].join('\n'))
  return root
}

const runtimeBinding = Object.freeze({ attach() {}, detach() {}, toolCatalogChanged() {} })
const eventBinding = Object.freeze({ attach() {}, detach() {} })

describe('OMP Host Extension configuration', () => {
  it('imports and normalizes trusted modules before child binding', async () => {
    const root = await fixture()
    const prepared = await prepareOmpHostExtensions({
      modules: ['./fixture.mjs'],
      enabled: [{ id: 'fixture', config: { label: ' prepared ' } }],
    }, root, 'actor-one')

    expect(prepared.modules).toEqual([expect.stringMatching(/^file:/u)])
    expect(prepared.selections).toEqual([{ id: 'fixture', config: { label: 'prepared' } }])
    expect(prepared.facts).toEqual({ hostKind: 'omp', actorId: 'actor-one' })
    expect(Object.isFrozen(prepared)).toBe(true)
  })

  it('instantiates fresh imported entries in each Runtime Session', async () => {
    const root = await fixture()
    const prepared = await prepareOmpHostExtensions({
      modules: ['./fixture.mjs'],
      enabled: [{ id: 'fixture', config: { label: 'active' } }],
    }, root, undefined)
    const first = await instantiateOmpHostExtensions(
      prepared,
      { sessionId: 'first', runtimePresetId: 'standard', workspaceRoot: root },
      runtimeBinding,
      eventBinding,
      OMP_RUNTIME_HOST_CAPABILITIES,
    )
    const second = await instantiateOmpHostExtensions(
      prepared,
      { sessionId: 'second', runtimePresetId: 'standard', workspaceRoot: root },
      runtimeBinding,
      eventBinding,
      OMP_RUNTIME_HOST_CAPABILITIES,
    )

    expect(first.entries[0]?.id).toBe('fixture')
    expect(first.entries[0]?.plugin).not.toBe(second.entries[0]?.plugin)
    expect(first.entries[0]?.plugin).toMatchObject({ name: 'fixture-first-active-1' })
    expect(second.entries[0]?.plugin).toMatchObject({ name: 'fixture-second-active-2' })
  })

  it('supports explicit Actor Identity omission and rejects invalid plans before child creation', async () => {
    const root = await fixture()
    const omitted = await prepareOmpHostExtensions({
      enabled: [{ id: 'runtime-host' }, { id: 'omp-host-events' }],
    }, root, 'configured-but-omitted')

    expect(omitted.selections.map(selection => selection.id)).toEqual(['runtime-host', 'omp-host-events'])
    await expect(prepareOmpHostExtensions({ enabled: [{ id: 'missing' }] }, root, undefined))
      .rejects.toThrow('unknown Host Extension id "missing"')
    await expect(prepareOmpHostExtensions({ modules: ['./fixture.mjs', './fixture.mjs'] }, root, undefined))
      .rejects.toThrow('duplicate resolved specifiers')
  })
})
