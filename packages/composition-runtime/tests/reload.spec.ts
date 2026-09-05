import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionReloadEvent,
} from '../src/index.ts'

const temporaryRoots: string[] = []

declare global {
  var doppelgangerReloadLifecycle: string[] | undefined
}

afterEach(async () => {
  globalThis.doppelgangerReloadLifecycle = undefined
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function patch(value: string): string {
  return ['- id: feature', '  config:', `    value: ${value}`, ''].join('\n')
}

function eventQueue<T>() {
  const queued: T[] = []
  const waiters: Array<{ resolve(value: T): void; reject(cause: Error): void; timer: NodeJS.Timeout }> = []
  return {
    push(value: T) {
      const waiter = waiters.shift()
      if (waiter === undefined) queued.push(value)
      else {
        clearTimeout(waiter.timer)
        waiter.resolve(value)
      }
    },
    next(label: string): Promise<T> {
      const value = queued.shift()
      if (value !== undefined) return Promise.resolve(value)
      const { promise, resolve, reject } = Promise.withResolvers<T>()
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error(`${label} timed out`))
        }, 3000),
      }
      waiters.push(waiter)
      return promise
    },
  }
}

describe('layered composition reload', () => {
  it('rebuilds edit/create/delete generations and rolls invalid layers back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-reload-'))
    temporaryRoots.push(root)
    const home = join(root, 'home')
    const project = join(root, 'project', '.doppelganger')
    await Promise.all([mkdir(home, { recursive: true }), mkdir(project, { recursive: true })])
    const loaderPath = join(root, 'runtime.cordis.yml')
    const userPatchPath = join(home, 'runtime.cordis.patch.yml')
    const projectPatchPath = join(project, 'runtime.cordis.patch.yml')
    const modulePath = join(root, 'feature.mjs')
    const loaderSource = [
      '- id: feature',
      '  name: ./feature.mjs',
      '  config:',
      '    value: base',
      '',
    ].join('\n')
    await Promise.all([
      writeFile(loaderPath, loaderSource),
      writeFile(modulePath, [
        'export default {',
        "  name: 'reload-feature',",
        '  apply(_ctx, config) {',
        '    globalThis.doppelgangerReloadLifecycle ??= []',
        "    globalThis.doppelgangerReloadLifecycle.push(`start:${config.value}`)",
        "    if (config.value === 'invalid') throw new Error('invalid feature revision')",
        "    return () => globalThis.doppelgangerReloadLifecycle.push(`stop:${config.value}`)",
        '  },',
        '}',
      ].join('\n')),
    ])
    const definition = createCompositionDefinition({
      id: 'reload-composition',
      revision: 'authored-one',
      loaderPath,
      patches: [
        { source: 'user patch', filename: userPatchPath, optional: true },
        { source: 'project patch', filename: projectPatchPath, optional: true },
      ],
    })
    const reloads = eventQueue<CompositionReloadEvent>()
    const failures = eventQueue<CompositionReloadEvent>()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReload: event => { reloads.push(event) },
      onReloadFailure: event => { failures.push(event) },
    })
    const session = await runtime.activate({ composition: definition, sessionId: 'reload' })
    expect(globalThis.doppelgangerReloadLifecycle).toContain('start:base')

    let completed = reloads.next('user patch creation')
    await writeFile(userPatchPath, patch('user'))
    const userReload = await completed
    expect(globalThis.doppelgangerReloadLifecycle).toContain('start:user')

    completed = reloads.next('project patch creation')
    await writeFile(projectPatchPath, patch('project'))
    const projectReload = await completed
    expect(globalThis.doppelgangerReloadLifecycle).toContain('start:project')

    const failed = failures.next('invalid project patch')
    await writeFile(projectPatchPath, '- id: missing\n  config: {}\n')
    const failure = await failed
    expect(failure.compositionRevision).toBe(projectReload.compositionRevision)
    expect(failure.diagnostics.reload).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('project patch'),
    })

    completed = reloads.next('invalid project patch removal')
    await unlink(projectPatchPath)
    const invalidRemoved = await completed
    expect(globalThis.doppelgangerReloadLifecycle?.at(-1)).toBe('start:user')

    completed = reloads.next('project patch recovery')
    await writeFile(projectPatchPath, patch('recovered'))
    await completed
    expect(session.diagnostics().reload).toBeUndefined()
    expect(globalThis.doppelgangerReloadLifecycle).toContain('start:recovered')

    completed = reloads.next('project patch removal')
    await unlink(projectPatchPath)
    const projectRemoved = await completed
    expect(globalThis.doppelgangerReloadLifecycle?.at(-2)).toBe('stop:recovered')
    expect(globalThis.doppelgangerReloadLifecycle?.at(-1)).toBe('start:user')

    completed = reloads.next('user patch removal')
    await unlink(userPatchPath)
    await completed
    expect(globalThis.doppelgangerReloadLifecycle?.at(-1)).toBe('start:base')
    expect(userReload.compositionRevision).toBe(invalidRemoved.compositionRevision)
    expect(invalidRemoved.compositionRevision).toBe(projectRemoved.compositionRevision)

    await runtime.dispose()
    expect(await readFile(loaderPath, 'utf8')).toBe(loaderSource)
    expect(globalThis.doppelgangerReloadLifecycle?.at(-1)).toBe('stop:base')
  })

  it('reports observed rollback audit failures without restoring stale healthy diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-rollback-audit-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.yml')
    const modulePath = join(root, 'feature.mjs')
    await Promise.all([
      writeFile(loaderPath, '- id: feature\n  name: ./feature.mjs\n  config:\n    value: base\n'),
      writeFile(modulePath, [
        'let applications = 0',
        'export default {',
        "  name: 'rollback-audit-feature',",
        '  apply(_ctx, config) {',
        '    applications += 1',
        '    if (config.value === "candidate") throw new Error("candidate activation rejected")',
        '    if (config.value === "base" && applications > 2) throw new Error("restoration activation rejected")',
        '  },',
        '}',
      ].join('\n')),
    ])
    const failures = eventQueue<CompositionReloadEvent>()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReloadFailure: event => { failures.push(event) },
    })
    const session = await runtime.activate({
      composition: createCompositionDefinition({
        id: 'rollback-audit',
        revision: 'authored',
        loaderPath,
        patches: [],
      }),
      sessionId: 'rollback-audit',
    })

    const failed = failures.next('failed restoration audit')
    await writeFile(loaderPath, '- id: feature\n  name: ./feature.mjs\n  config:\n    value: candidate\n')
    const event = await failed
    expect(event.diagnostics.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'feature',
        state: 'failed',
        error: expect.stringContaining('restoration activation rejected'),
      }),
    ]))
    expect(event.diagnostics.reload?.error).toContain('candidate activation rejected')
    expect(event.diagnostics.reload?.error).toContain('restoration activation rejected')
    expect(session.diagnostics()).toBe(event.diagnostics)

    await expect(runtime.dispose()).resolves.toBeUndefined()
  })

  it('aggregates candidate and restoration errors while retaining disposal ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-rollback-update-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.yml')
    const featurePath = join(root, 'feature.mjs')
    await Promise.all([
      writeFile(loaderPath, '- id: feature\n  name: ./feature.mjs\n  config:\n    cleanupThrows: false\n'),
      writeFile(featurePath, [
        'let applications = 0',
        'export default {',
        "  name: 'rollback-update-feature',",
        '  apply(_ctx, config) {',
        '    applications += 1',
        '    if (config.cleanupThrows && applications === 2) throw new Error("candidate update rejected")',
        '    if (!config.cleanupThrows && applications > 2) throw new Error("restoration update rejected")',
        '  },',
        '}',
      ].join('\n')),
    ])
    const failures = eventQueue<CompositionReloadEvent>()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReloadFailure: event => { failures.push(event) },
    })
    const session = await runtime.activate({
      composition: createCompositionDefinition({
        id: 'rollback-update',
        revision: 'authored',
        loaderPath,
        patches: [],
      }),
      sessionId: 'rollback-update',
    })

    const failed = failures.next('thrown restoration update')
    await writeFile(loaderPath, [
      '- id: feature',
      '  name: ./feature.mjs',
      '  config:',
      '    cleanupThrows: true',
      '',
    ].join('\n'))
    const event = await failed
    expect(event.diagnostics.reload?.error).toContain('candidate update rejected')
    expect(event.diagnostics.reload?.error).toContain('restoration update rejected')
    expect(session.diagnostics()).toBe(event.diagnostics)

    await expect(runtime.dispose()).resolves.toBeUndefined()
  })

  it('reports a pending entry observed during restoration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-rollback-pending-'))
    temporaryRoots.push(root)
    const loaderPath = join(root, 'runtime.cordis.yml')
    const modulePath = join(root, 'feature.mjs')
    await Promise.all([
      writeFile(loaderPath, '- id: provider\n  name: ./provider.mjs\n- id: feature\n  name: ./feature.mjs\n  config:\n    value: base\n'),
      writeFile(join(root, 'provider.mjs'), [
        'export let drop',
        'export default { name: "restoration-provider", apply(ctx) { drop = ctx.provide("restorationMissingService", true) } }',
      ].join('\n')),
      writeFile(modulePath, [
        'import { drop } from "./provider.mjs"',
        'export default {',
        "  name: 'rollback-pending-feature',",
        '  inject: ["restorationMissingService"],',
        '  apply(_ctx, config) { if (config.value === "candidate") drop() },',
        '}',
      ].join('\n')),
    ])
    const failures = eventQueue<CompositionReloadEvent>()
    const runtime = createCompositionRuntime({
      watch: { base: root, root: [] },
      onReloadFailure: event => { failures.push(event) },
    })
    const session = await runtime.activate({
      composition: createCompositionDefinition({
        id: 'rollback-pending', revision: 'authored', loaderPath, patches: [],
      }),
      sessionId: 'rollback-pending',
    })

    const failed = failures.next('pending restoration audit')
    await writeFile(loaderPath, '- id: provider\n  name: ./provider.mjs\n- id: feature\n  name: ./feature.mjs\n  config:\n    value: candidate\n')
    const event = await failed
    expect(event.diagnostics.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'feature', state: 'pending', missingServices: ['restorationMissingService'] }),
    ]))
    expect(event.diagnostics.reload?.error).toContain('pending')
    expect(session.diagnostics()).toBe(event.diagnostics)
    await runtime.dispose()
  })
})
