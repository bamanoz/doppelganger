import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  CompositionActivationError,
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionDefinition,
  type RuntimeSessionMetadata,
} from '../src/index.ts'

interface TestMcpSnapshot {
  readonly servers: Array<{ readonly id: string; readonly state: string }>
  readonly diagnostics: Array<{ readonly code: string }>
}

declare global {
  var doppelgangerLifecycle: string[] | undefined
  var doppelgangerMcpSnapshot: (() => TestMcpSnapshot) | undefined
  var doppelgangerMcpCatalogSnapshots: string[][] | undefined
}
const temporaryRoots: string[] = []
const mcpFixture = fileURLToPath(new URL('../../extension-mcp/tests/fixtures/stdio-server.mjs', import.meta.url))

afterEach(async () => {
  globalThis.doppelgangerLifecycle = undefined
  globalThis.doppelgangerMcpSnapshot = undefined
  globalThis.doppelgangerMcpCatalogSnapshots = undefined
  delete process.env.COMPOSITION_MCP_INITIALIZE_DELAY
  delete process.env.COMPOSITION_MCP_ARGUMENT_MARKER
  delete process.env.COMPOSITION_MCP_DISCOVERY_DELAY
  delete process.env.COMPOSITION_MCP_EXIT_MARKER
  delete process.env.COMPOSITION_MCP_INITIAL_DISCOVERY_MODE
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function composition(entries: unknown[]): Promise<{ definition: CompositionDefinition; source: string }> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-composition-'))
  temporaryRoots.push(root)
  const loaderPath = join(root, 'runtime.cordis.json')
  const source = JSON.stringify(entries)
  await writeFile(loaderPath, source)
  return {
    source,
    definition: createCompositionDefinition({
      id: 'generic-composition',
      revision: 'authored-one',
      loaderPath,
    }),
  }
}

async function plugin(root: string, name: string, source: string): Promise<string> {
  const filename = join(root, name)
  await writeFile(filename, source)
  return `./${name}`
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function mcpComposition(config: object, options: { readonly observeCatalog?: boolean } = {}): Promise<CompositionDefinition> {
  const files = await composition([])
  const root = dirname(files.definition.loaderPath)
  const observer = await plugin(root, 'mcp-observer.mjs', [
    "export default { name: 'mcp-observer', inject: ['doppelgangerMcp'], apply(ctx) {",
    '  globalThis.doppelgangerMcpSnapshot = () => ctx.doppelgangerMcp.snapshot()',
    '} }',
  ].join('\n'))
  const catalogObserver = options.observeCatalog === true
    ? await plugin(root, 'mcp-catalog-observer.mjs', [
        "export default { name: 'mcp-catalog-observer', inject: ['doppelgangerTools'], apply(ctx) {",
        '  const capture = () => ctx.doppelgangerTools.snapshot().tools.map(tool => tool.name)',
        '  globalThis.doppelgangerMcpCatalogSnapshots = [capture()]',
        "  ctx.on('doppelganger/tools-changed', () => { globalThis.doppelgangerMcpCatalogSnapshots.push(capture()) })",
        '  return () => { globalThis.doppelgangerMcpCatalogSnapshots.push(capture()) }',
        '} }',
      ].join('\n'))
    : undefined
  return createCompositionDefinition({
    ...files.definition,
    patches: [{
      source: 'MCP activation fixture',
      baseUrl: root,
      patches: [{ insert: [
        {
          id: 'doppelganger-tools',
          name: '@doppelganger/doppelganger-protocols/tools',
          isolate: { doppelgangerTools: 'session' },
        },
        ...(catalogObserver === undefined ? [] : [{
          id: 'mcp-catalog-observer',
          name: catalogObserver,
          inject: ['doppelgangerTools'],
          isolate: { doppelgangerTools: 'session' },
        }]),
        {
          id: 'doppelganger-mcp',
          name: '@doppelganger/doppelganger-extension-mcp/loader',
          inject: ['doppelgangerTools'],
          isolate: { doppelgangerTools: 'session', doppelgangerMcp: 'session' },
          config,
        },
        {
          id: 'mcp-observer',
          name: observer,
          inject: ['doppelgangerMcp'],
          isolate: { doppelgangerMcp: 'session' },
        },
      ] }],
    }],
  })
}

describe('composition definitions', () => {
  it('normalizes and freezes the domain-neutral layered contract', () => {
    const loaderPath = resolve('fixtures', 'runtime.cordis.yml')
    const definition = createCompositionDefinition({
      id: 'generic',
      revision: 'one',
      loaderPath,
      patches: [{
        source: 'host',
        baseUrl: resolve('fixtures'),
        patches: [{ insert: [{ id: 'feature', name: './feature.mjs' }] }],
      }],
    })

    expect(definition).toMatchObject({ id: 'generic', revision: 'one', loaderPath })
    expect(definition.patches).toHaveLength(1)
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.patches)).toBe(true)
  })

  it('rejects malformed preset IDs, paths, and patch paths', () => {
    const loaderPath = resolve('fixtures', 'runtime.cordis.yml')
    expect(() => createCompositionDefinition({ id: 'Bad', revision: 'r', loaderPath }))
      .toThrow('lowercase kebab-case')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath: 'runtime.cordis.yml' }))
      .toThrow('loaderPath must be absolute')
    expect(() => createCompositionDefinition({ id: 'x', revision: 'r', loaderPath: resolve('cordis.txt') }))
      .toThrow('must name a .json, .yaml, or .yml Loader tree')
    expect(() => createCompositionDefinition({
      id: 'x', revision: 'r', loaderPath, patches: [{ source: 'x', filename: 'x.yml', optional: true }],
    })).toThrow('filename must be absolute')
  })
})

describe('layered activation and session isolation', () => {
  it('activates arbitrary modules, protected root plugins, and immutable metadata', async () => {
    const observed = new Map<string, { value: string; metadata: RuntimeSessionMetadata }>()
    const files = await composition([])
    const root = dirname(files.definition.loaderPath)
    const name = await plugin(root, 'feature.mjs', [
      'export default {',
      "  name: 'feature',",
      "  apply(ctx, config) { ctx.provide('featureValue', config.value) },",
      '}',
    ].join('\n'))
    const definition = createCompositionDefinition({
      ...files.definition,
      patches: [{
        source: 'host fixture',
        baseUrl: root,
        patches: [{ insert: [{ id: 'feature', name, config: { value: 'active' }, isolate: { featureValue: 'session' } }] }],
      }],
    })
    const host: Plugin = {
      name: 'host',
      inject: ['featureValue', 'doppelgangerRuntimeSession'],
      apply(ctx: Context) {
        observed.set(ctx.doppelgangerRuntimeSession.sessionId, {
          value: ctx.get('featureValue') as string,
          metadata: ctx.doppelgangerRuntimeSession,
        })
      },
    }
    const runtime = createCompositionRuntime({ watch: false })
    const first = await runtime.activate({
      composition: definition,
      sessionId: 'first',
      workspaceRoot: root,
      protectedComposition: {
        entries: [
          { id: 'host', plugin: host },
        ],
      },
    })
    const second = await runtime.activate({
      composition: definition,
      sessionId: 'second',
      protectedComposition: {
        entries: [
          { id: 'host', plugin: host },
        ],
      },
    })

    expect(observed.get('first')).toEqual({
      value: 'active',
      metadata: { sessionId: 'first', runtimePresetId: 'generic-composition', workspaceRoot: root },
    })
    expect(observed.get('second')).toEqual({
      value: 'active',
      metadata: { sessionId: 'second', runtimePresetId: 'generic-composition' },
    })
    expect(Object.isFrozen(observed.get('first')?.metadata)).toBe(true)
    expect(first.diagnostics().entries.map(entry => entry.id)).toEqual(expect.arrayContaining([
      'feature',
      'doppelganger-runtime-session-metadata',
      'doppelganger-runtime-host',
    ]))
    await first.dispose()
    expect(second.diagnostics().entries.every(entry => entry.state === 'active')).toBe(true)
    await runtime.dispose()
  })

  it('activates an empty composition with only runtime-owned plugins', async () => {
    const files = await composition([])
    let attached = false
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition: files.definition,
      sessionId: 'empty',
      protectedComposition: {
        entries: [
          { id: 'host', plugin: { name: 'empty-host', apply: () => { attached = true } } },
        ],
      },
    })
    expect(attached).toBe(true)
    expect(session.diagnostics().entries).toHaveLength(2)
    await runtime.dispose()
  })

  it('joins runtime-owned plugins to explicitly declared optional service realms', async () => {
    const files = await composition([])
    const root = dirname(files.definition.loaderPath)
    const name = await plugin(root, 'optional-feature.mjs', [
      'export default {',
      "  name: 'optional-feature',",
      "  apply(ctx) { ctx.provide('optionalFeature', 'visible') },",
      '}',
    ].join('\n'))
    const definition = createCompositionDefinition({
      ...files.definition,
      patches: [{
        source: 'fixture',
        baseUrl: root,
        patches: [{ insert: [{
          id: 'optional-feature',
          name,
          isolate: { optionalFeature: 'session' },
        }] }],
      }],
    })
    let hostContext: Context | undefined
    const runtime = createCompositionRuntime({ watch: false })
    await runtime.activate({
      composition: definition,
      sessionId: 'optional-realm',
      protectedComposition: {
        entries: [
          { id: 'host', plugin: { name: 'optional-host', apply: (ctx) => { hostContext = ctx } }, isolate: { optionalFeature: 'session' } },
        ],
      },
    })
    if (hostContext === undefined) throw new Error('runtime-owned host did not activate')
    expect(hostContext.get('optionalFeature', false)).toBe('visible')
    await runtime.dispose()
  })

  it('mounts an actor-neutral bridge, optional actor provider, and typed host sibling in isolated session realms', async () => {
    const files = await composition([])
    const observed = new Map<string, {
      readonly actor: unknown
      readonly bridge: unknown
      readonly native: unknown
      readonly order: readonly string[]
    }>()
    const runtime = createCompositionRuntime({ watch: false })
    const activate = async (sessionId: string, actor: 'absent' | 'unbound' | 'bound') => {
      const order: string[] = []
      const bridge: Plugin = {
        name: 'shared-runtime-host',
        apply(ctx) {
          order.push('bridge')
          ctx.provide('sharedHostBridge', Object.freeze({ sessionId }))
        },
      }
      const native: Plugin = {
        name: 'typed-omp-provider',
        inject: ['sharedHostBridge'],
        apply(ctx) {
          order.push('native')
          ctx.provide('ompNativeProvider', Object.freeze({ bridge: ctx.get('sharedHostBridge') }))
        },
      }
      const actorPlugin: Plugin | undefined = actor === 'absent' ? undefined : {
        name: 'separate-actor-provider',
        apply(ctx) {
          order.push('actor')
          ctx.provide('doppelgangerActor', actor === 'bound'
            ? Object.freeze({ state: 'bound', actorId: sessionId })
            : Object.freeze({ state: 'unbound' }))
        },
      }
      const observer: Plugin = {
        name: 'protected-observer',
        inject: ['sharedHostBridge', 'ompNativeProvider'],
        apply(ctx) {
          order.push('observer')
          observed.set(sessionId, {
            actor: ctx.get('doppelgangerActor', false),
            bridge: ctx.get('sharedHostBridge'),
            native: ctx.get('ompNativeProvider'),
            order: [...order],
          })
        },
      }
      return runtime.activate({
        composition: files.definition,
        sessionId,
        protectedComposition: {
          entries: [
            { id: 'bridge', plugin: bridge, isolate: { sharedHostBridge: 'session' } },
            ...(actorPlugin === undefined
              ? []
              : [{ id: 'actor', plugin: actorPlugin, isolate: { doppelgangerActor: 'session' as const } }]),
            { id: 'native', plugin: native, isolate: { sharedHostBridge: 'session', ompNativeProvider: 'session' } },
            {
              id: 'observer',
              plugin: observer,
              isolate: {
                sharedHostBridge: 'session',
                doppelgangerActor: 'session',
                ompNativeProvider: 'session',
              },
            },
          ],
        },
      })
    }

    const absent = await activate('absent-session', 'absent')
    const unbound = await activate('unbound-session', 'unbound')
    const bound = await activate('bound-session', 'bound')
    expect(observed.get('absent-session')?.actor).toBeUndefined()
    expect(observed.get('unbound-session')?.actor).toEqual({ state: 'unbound' })
    expect(observed.get('bound-session')?.actor).toEqual({ state: 'bound', actorId: 'bound-session' })
    expect(observed.get('bound-session')?.order).toEqual(['bridge', 'actor', 'native', 'observer'])
    expect(observed.get('absent-session')?.bridge).not.toBe(observed.get('bound-session')?.bridge)
    expect(observed.get('unbound-session')?.native).not.toBe(observed.get('bound-session')?.native)
    await Promise.all([absent.dispose(), unbound.dispose(), bound.dispose()])
    await runtime.dispose()
  })

  it('exhausts partially attached protected providers when activation fails', async () => {
    const files = await composition([])
    const lifecycle: string[] = []
    let attached: object | undefined
    const binding = {
      attach(bridge: object) {
        if (attached !== undefined) throw new Error('bridge already attached')
        attached = bridge
        lifecycle.push('bridge:attach')
      },
      detach(bridge: object) {
        if (attached === bridge) attached = undefined
        lifecycle.push('bridge:detach')
      },
    }
    const bridge: Plugin = {
      name: 'failing-shared-bridge',
      apply(ctx) {
        const value = Object.freeze({ sessionId: 'failing-protected' })
        binding.attach(value)
        ctx.provide('sharedHostBridge', value)
        ctx.effect(() => () => binding.detach(value), 'testBridge.detach')
        ctx.effect(() => {
          lifecycle.push('callback:attach')
          return () => { lifecycle.push('callback:dispose') }
        }, 'testBridge.callback')
      },
    }
    const actor: Plugin = {
      name: 'failing-actor-provider',
      apply(ctx) {
        ctx.provide('doppelgangerActor', Object.freeze({ state: 'unbound' }))
        return () => { lifecycle.push('actor:dispose') }
      },
    }
    const native: Plugin = {
      name: 'failing-native-provider',
      inject: ['sharedHostBridge'],
      apply(ctx) {
        ctx.provide('ompNativeProvider', Object.freeze({ active: true }))
        return () => { lifecycle.push('native:dispose') }
      },
    }
    const blocked: Plugin = {
      name: 'blocked-protected-provider',
      inject: ['missingProtectedDependency'],
      apply() {},
    }
    const runtime = createCompositionRuntime({ watch: false })
    await expect(runtime.activate({
      composition: files.definition,
      sessionId: 'failing-protected',
      protectedComposition: {
        entries: [
          { id: 'bridge', plugin: bridge, isolate: { sharedHostBridge: 'session' } },
          { id: 'actor', plugin: actor, isolate: { doppelgangerActor: 'session' } },
          { id: 'native', plugin: native, isolate: { sharedHostBridge: 'session', ompNativeProvider: 'session' } },
          { id: 'blocked', plugin: blocked },
        ],
      },
    })).rejects.toBeInstanceOf(CompositionActivationError)
    expect(attached).toBeUndefined()
    expect(lifecycle).toEqual(expect.arrayContaining([
      'bridge:attach', 'bridge:detach', 'callback:attach', 'callback:dispose', 'actor:dispose', 'native:dispose',
    ]))
    lifecycle.length = 0
    await runtime.dispose()
    expect(lifecycle).toEqual([])
  })

  it('reports missing services and cleans partially activated resources', async () => {
    const files = await composition([])
    const root = dirname(files.definition.loaderPath)
    await plugin(root, 'started.mjs', [
      "export default { name: 'started', apply() {",
      "  globalThis.doppelgangerLifecycle ??= []; globalThis.doppelgangerLifecycle.push('start')",
      "  return () => globalThis.doppelgangerLifecycle.push('stop')",
      '} }',
    ].join('\n'))
    await plugin(root, 'waiting.mjs', "export default { name: 'waiting', inject: ['absentService'], apply() {} }\n")
    const definition = createCompositionDefinition({
      ...files.definition,
      patches: [{
        source: 'fixture',
        baseUrl: root,
        patches: [{ insert: [
          { id: 'started', name: './started.mjs' },
          { id: 'waiting', name: './waiting.mjs' },
        ] }],
      }],
    })
    const runtime = createCompositionRuntime({ watch: false })
    const activation = runtime.activate({ composition: definition, sessionId: 'audit' })
    await expect(activation).rejects.toBeInstanceOf(CompositionActivationError)
    await expect(activation).rejects.toMatchObject({
      diagnostics: {
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'waiting', state: 'pending', missingServices: ['absentService'] }),
        ]),
      },
    })
    expect(globalThis.doppelgangerLifecycle).toEqual(['start', 'stop'])
    await runtime.dispose()
  })


  it('audits the MCP Loader row active without awaiting external server readiness', async () => {
    process.env.COMPOSITION_MCP_INITIALIZE_DELAY = '400'
    const definition = await mcpComposition({
      servers: {
        delayed: {
          startupTimeoutMs: 1_000,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [mcpFixture],
            environment: { MCP_INITIALIZE_DELAY_MS: { env: 'COMPOSITION_MCP_INITIALIZE_DELAY' } },
          },
        },
      },
    })
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({ composition: definition, sessionId: 'mcp-delayed' })

    expect(session.diagnostics().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'doppelganger-mcp', state: 'active' }),
    ]))
    expect(globalThis.doppelgangerMcpSnapshot?.().servers).toEqual([
      expect.objectContaining({ id: 'delayed', state: 'connecting' }),
    ])
    await waitFor(() => globalThis.doppelgangerMcpSnapshot?.().servers[0]?.state === 'active')
    await runtime.dispose()
  })

  it('keeps the Runtime Session active when an MCP server fails operationally', async () => {
    const definition = await mcpComposition({
      servers: {
        unavailable: {
          transport: { type: 'stdio', command: join(tmpdir(), 'missing-composition-mcp') },
        },
      },
    })
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({ composition: definition, sessionId: 'mcp-failed' })

    await waitFor(() => globalThis.doppelgangerMcpSnapshot?.().servers[0]?.state === 'failed')
    expect(session.diagnostics().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'doppelganger-mcp', state: 'active' }),
    ]))
    expect(globalThis.doppelgangerMcpSnapshot?.().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MCP_SPAWN_FAILED' }),
    ]))
    await runtime.dispose()
  })
  it('awaits every enabled MCP server before activating an await-ready row', async () => {
    process.env.COMPOSITION_MCP_INITIALIZE_DELAY = '180'
    const definition = await mcpComposition({
      startupMode: 'await-ready',
      servers: {
        ready: { transport: { type: 'stdio', command: process.execPath, args: [mcpFixture] } },
        slow: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [mcpFixture],
            environment: { MCP_INITIALIZE_DELAY_MS: { env: 'COMPOSITION_MCP_INITIALIZE_DELAY' } },
          },
        },
      },
    }, { observeCatalog: true })
    const runtime = createCompositionRuntime({ watch: false })
    let settled = false
    const activation = runtime.activate({ composition: definition, sessionId: 'mcp-await-ready' })
      .finally(() => { settled = true })

    await waitFor(() => globalThis.doppelgangerMcpCatalogSnapshots?.some(names => names.includes('mcp-ready.echo-value')) === true)
    expect(settled).toBe(false)
    const session = await activation

    expect(session.diagnostics().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'doppelganger-mcp', state: 'active' }),
    ]))
    expect(globalThis.doppelgangerMcpSnapshot?.().servers).toEqual([
      expect.objectContaining({ id: 'ready', state: 'active' }),
      expect.objectContaining({ id: 'slow', state: 'active' }),
    ])
    await runtime.dispose()
  })

  it('rejects await-ready MCP activation and cleans successful sibling servers', async () => {
    process.env.COMPOSITION_MCP_INITIALIZE_DELAY = '300'
    process.env.COMPOSITION_MCP_INITIAL_DISCOVERY_MODE = 'duplicate'
    const definition = await mcpComposition({
      startupMode: 'await-ready',
      servers: {
        broken: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [mcpFixture],
            environment: {
              MCP_INITIALIZE_DELAY_MS: { env: 'COMPOSITION_MCP_INITIALIZE_DELAY' },
              MCP_INITIAL_DISCOVERY_MODE: { env: 'COMPOSITION_MCP_INITIAL_DISCOVERY_MODE' },
            },
          },
        },
        healthy: { transport: { type: 'stdio', command: process.execPath, args: [mcpFixture] } },
      },
    }, { observeCatalog: true })
    const runtime = createCompositionRuntime({ watch: false })
    let failure: unknown
    try {
      await runtime.activate({ composition: definition, sessionId: 'mcp-await-ready-failed' })
    } catch (cause) {
      failure = cause
    }

    expect(failure).toBeInstanceOf(CompositionActivationError)
    expect((failure as CompositionActivationError).diagnostics.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'doppelganger-composition',
        state: 'failed',
        error: expect.stringContaining('MCP_TOOL_DUPLICATE'),
      }),
    ]))
    expect(globalThis.doppelgangerMcpCatalogSnapshots).toEqual(expect.arrayContaining([
      expect.arrayContaining(['mcp-healthy.echo-value']),
    ]))
    expect(globalThis.doppelgangerMcpCatalogSnapshots?.at(-1)).toEqual([])
    await runtime.dispose()
  })

  it('rejects timed out await-ready MCP activation and exhausts cleanup', async () => {
    const marker = join(tmpdir(), `composition-mcp-${Date.now()}-timeout.closed`)
    process.env.COMPOSITION_MCP_EXIT_MARKER = marker
    process.env.COMPOSITION_MCP_INITIALIZE_DELAY = '200'
    const definition = await mcpComposition({
      startupMode: 'await-ready',
      servers: {
        timeout: {
          startupTimeoutMs: 30,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [mcpFixture],
            environment: {
              MCP_EXIT_MARKER: { env: 'COMPOSITION_MCP_EXIT_MARKER' },
              MCP_INITIALIZE_DELAY_MS: { env: 'COMPOSITION_MCP_INITIALIZE_DELAY' },
            },
          },
        },
      },
    }, { observeCatalog: true })
    const runtime = createCompositionRuntime({ watch: false })
    let failure: unknown
    try {
      await runtime.activate({ composition: definition, sessionId: 'mcp-await-ready-timeout' })
    } catch (cause) {
      failure = cause
    }

    expect(failure).toBeInstanceOf(CompositionActivationError)
    expect((failure as CompositionActivationError).diagnostics.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'doppelganger-composition',
        state: 'failed',
        error: expect.stringContaining('MCP_INITIALIZE_TIMEOUT'),
      }),
    ]))
    await waitFor(() => existsSync(marker))
    expect(globalThis.doppelgangerMcpCatalogSnapshots?.at(-1)).toEqual([])
    await runtime.dispose()
  })

  it('cancels await-ready MCP activation without late catalog publication', async () => {
    const argumentMarker = join(tmpdir(), `composition-mcp-${Date.now()}-cancel.args`)
    const exitMarker = join(tmpdir(), `composition-mcp-${Date.now()}-cancel.closed`)
    process.env.COMPOSITION_MCP_ARGUMENT_MARKER = argumentMarker
    process.env.COMPOSITION_MCP_DISCOVERY_DELAY = '400'
    process.env.COMPOSITION_MCP_EXIT_MARKER = exitMarker
    const definition = await mcpComposition({
      startupMode: 'await-ready',
      servers: {
        cancelled: {
          startupTimeoutMs: 10_000,
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [mcpFixture],
            environment: {
              MCP_ARGUMENT_MARKER: { env: 'COMPOSITION_MCP_ARGUMENT_MARKER' },
              MCP_DISCOVERY_DELAY_MS: { env: 'COMPOSITION_MCP_DISCOVERY_DELAY' },
              MCP_EXIT_MARKER: { env: 'COMPOSITION_MCP_EXIT_MARKER' },
            },
          },
        },
      },
    }, { observeCatalog: true })
    const runtime = createCompositionRuntime({ watch: false })
    const activation = runtime.activate({ composition: definition, sessionId: 'mcp-await-ready-cancelled' })
    await waitFor(() => existsSync(argumentMarker))

    const disposalStartedAt = Date.now()
    const disposal = runtime.dispose()
    await expect(activation).rejects.toBeInstanceOf(CompositionActivationError)
    await disposal
    expect(Date.now() - disposalStartedAt).toBeLessThan(2_000)
    expect(existsSync(exitMarker)).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 450))
    expect(globalThis.doppelgangerMcpCatalogSnapshots?.some(names => names.some(name => name.startsWith('mcp-cancelled.')))).toBe(false)
    expect(globalThis.doppelgangerMcpCatalogSnapshots?.at(-1)).toEqual([])
  })

  it('never rewrites authored composition and disposes idempotently', async () => {
    const files = await composition([])
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({ composition: files.definition, sessionId: 'dispose' })
    const disposal = session.dispose()
    expect(session.dispose()).toBe(disposal)
    await disposal
    expect(await readFile(files.definition.loaderPath, 'utf8')).toBe(files.source)
    const runtimeDisposal = runtime.dispose()
    expect(runtime.dispose()).toBe(runtimeDisposal)
    await runtimeDisposal
  })

  it('cleans the attempted session when watch registration fails after activation', async () => {
    const context = new Context()
    let registrations = 0
    let watchDisposals = 0
    let sessionDisposals = 0
    const fakeHmrOwner = context.plugin({
      name: 'failing-watch-acquisition',
      apply(ctx) {
        ctx.provide('hmr', {
          async registerConfig() {
            registrations += 1
            if (registrations === 2) throw new Error('second watch registration failed')
            return async () => { watchDisposals += 1 }
          },
        } as never)
      },
    })
    await fakeHmrOwner.await()
    const files = await composition([])
    const patchPath = join(dirname(files.definition.loaderPath), 'runtime.patch.yml')
    await writeFile(patchPath, '[]\n')
    const definition = createCompositionDefinition({
      ...files.definition,
      patches: [{ source: 'watch failure fixture', filename: patchPath, optional: false }],
    })
    const runtime = createCompositionRuntime({ context })

    await expect(runtime.activate({
      composition: definition,
      sessionId: 'watch-acquisition-failure',
      protectedComposition: {
        entries: [
          { id: 'effect', plugin: {
          name: 'watch-acquisition-session-effect',
          apply() { return () => { sessionDisposals += 1 } },
        } },
        ],
      },
    })).rejects.toThrow('second watch registration failed')
    expect(watchDisposals).toBe(1)
    expect(sessionDisposals).toBe(1)
    await expect(runtime.dispose()).resolves.toBeUndefined()
    expect(watchDisposals).toBe(1)
    expect(sessionDisposals).toBe(1)
    await context.fiber.dispose()
  })

  it('aggregates watch acquisition and attempted-session cleanup failures', async () => {
    const context = new Context()
    let registrations = 0
    let siblingDisposals = 0
    const fakeHmrOwner = context.plugin({
      name: 'aggregate-watch-acquisition',
      apply(ctx) {
        ctx.provide('hmr', {
          async registerConfig() {
            registrations += 1
            if (registrations === 2) throw new Error('watch acquisition failed')
            return async () => { throw new Error('acquired watch cleanup failed') }
          },
        } as never)
      },
    })
    await fakeHmrOwner.await()
    const files = await composition([])
    const patchPath = join(dirname(files.definition.loaderPath), 'aggregate.patch.yml')
    await writeFile(patchPath, '[]\n')
    const definition = createCompositionDefinition({
      ...files.definition,
      patches: [{ source: 'aggregate watch fixture', filename: patchPath, optional: false }],
    })
    const runtime = createCompositionRuntime({ context })

    const failure = await runtime.activate({
      composition: definition,
      sessionId: 'aggregate-watch-failure',
      protectedComposition: {
        entries: [
          { id: 'failing', plugin: {
          name: 'aggregate-watch-failing-effect',
          apply() { return () => { throw new Error('attempted session cleanup failed') } },
        } },
          { id: 'sibling', plugin: {
          name: 'aggregate-watch-sibling-effect',
          apply() { return () => { siblingDisposals += 1 } },
        } },
        ],
      },
    }).catch(error => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors[0]).toMatchObject({ message: 'watch acquisition failed' })
    expect(failure.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'acquired watch cleanup failed' }),
      expect.objectContaining({ message: 'attempted session cleanup failed' }),
    ]))
    expect(siblingDisposals).toBe(1)
    await expect(runtime.dispose()).resolves.toBeUndefined()
    await context.fiber.dispose()
  })

  it('exhausts session cleanup after plugin and watch disposers fail while preserving siblings and a caller-owned root', async () => {
    const context = new Context()
    let watchDisposals = 0
    let siblingDisposals = 0
    const fakeHmrOwner = context.plugin({
      name: 'fake-hmr',
      apply(ctx) {
        ctx.provide('hmr', {
          async registerConfig() {
            return async () => {
              watchDisposals += 1
              throw new Error('watch disposal failed')
            }
          },
        } as never)
      },
    })
    await fakeHmrOwner.await()
    const files = await composition([])
    const runtime = createCompositionRuntime({ context })
    const session = await runtime.activate({
      composition: files.definition,
      sessionId: 'failing-cleanup',
      protectedComposition: {
        entries: [
          { id: 'failing', plugin: {
          name: 'failing-session-effect',
          apply() {
            return () => { throw new Error('plugin disposal failed') }
          },
        } },
          { id: 'sibling', plugin: {
          name: 'observable-session-effect',
          apply() {
            return () => { siblingDisposals += 1 }
          },
        } },
        ],
      },
    })

    const disposal = session.dispose()
    expect(session.dispose()).toBe(disposal)
    const cleanupFailure = await disposal.catch(error => error)
    expect(cleanupFailure).toMatchObject({
      message: expect.stringContaining('plugin disposal failed'),
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'watch disposal failed' }),
        expect.objectContaining({ message: 'plugin disposal failed' }),
      ]),
    })
    expect(watchDisposals).toBe(1)
    expect(siblingDisposals).toBe(1)
    await expect(runtime.dispose()).resolves.toBeUndefined()

    let callerRootActive = false
    const callerPlugin = context.plugin({
      name: 'caller-root-survives-runtime',
      apply() { callerRootActive = true },
    })
    await callerPlugin.await()
    expect(callerRootActive).toBe(true)
    await context.fiber.dispose()
  })

  it('settles every session and memoizes an aggregate runtime cleanup failure', async () => {
    const context = new Context()
    let watchDisposals = 0
    let sessionDisposals = 0
    const fakeHmrOwner = context.plugin({
      name: 'aggregate-fake-hmr',
      apply(ctx) {
        ctx.provide('hmr', {
          async registerConfig() {
            return async () => {
              watchDisposals += 1
              throw new Error('shared watch disposal failed')
            }
          },
        } as never)
      },
    })
    await fakeHmrOwner.await()
    const files = await composition([])
    const runtime = createCompositionRuntime({ context })
    const effect = (name: string): Plugin => ({
      name,
      apply() { return () => { sessionDisposals += 1 } },
    })
    const first = await runtime.activate({
      composition: files.definition,
      sessionId: 'aggregate-first',
      protectedComposition: {
        entries: [
          { id: 'effect', plugin: effect('aggregate-first-effect') },
        ],
      },
    })
    const second = await runtime.activate({
      composition: files.definition,
      sessionId: 'aggregate-second',
      protectedComposition: {
        entries: [
          { id: 'effect', plugin: effect('aggregate-second-effect') },
        ],
      },
    })

    const disposal = runtime.dispose()
    expect(runtime.dispose()).toBe(disposal)
    await expect(disposal).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'shared watch disposal failed' })],
    })
    expect(sessionDisposals).toBe(2)
    expect(watchDisposals).toBe(1)
    expect(first.dispose()).toBe(first.dispose())
    expect(second.dispose()).toBe(second.dispose())
    await expect(first.dispose()).resolves.toBeUndefined()
    await expect(second.dispose()).rejects.toBeInstanceOf(AggregateError)

    let callerRootActive = false
    const callerPlugin = context.plugin({
      name: 'caller-root-survives-aggregate-runtime',
      apply() { callerRootActive = true },
    })
    await callerPlugin.await()
    expect(callerRootActive).toBe(true)
    await context.fiber.dispose()
  })

  it('continues through runtime ownership and its owned root when a session cleanup stage rejects', async () => {
    let effectDisposals = 0
    const files = await composition([])
    const runtime = createCompositionRuntime({ watch: false })
    const session = await runtime.activate({
      composition: files.definition,
      sessionId: 'owned-root-cleanup',
      protectedComposition: {
        entries: [
          { id: 'effect', plugin: {
          name: 'owned-root-effect',
          apply() { return () => { effectDisposals += 1 } },
        } },
        ],
      },
    })
    const sessionFailure = Promise.reject(new Error('injected session cleanup failure'))
    Object.defineProperty(session, 'dispose', { value: () => sessionFailure })

    const disposal = runtime.dispose()
    await expect(disposal).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'injected session cleanup failure' })],
    })
    expect(effectDisposals).toBe(1)
    expect(runtime.dispose()).toBe(disposal)
  })
})
