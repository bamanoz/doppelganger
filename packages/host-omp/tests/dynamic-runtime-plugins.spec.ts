import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import { formatApprovalPrompt, resolveApproval } from '@oh-my-pi/pi-coding-agent/tools/approval'
import {
  createDoppelgangerOmpExtension,
  type OmpChildConnection,
  type OmpChildDisposal,
  type OmpChildFactory,
} from '../src/index.ts'
import { NodeOmpChildFactory } from '../src/process.ts'

const temporaryRoots: string[] = []
const childPath = fileURLToPath(new URL('../src/child.ts', import.meta.url))
const contextModule = new URL('../../extension-protocols/src/context-plugin.ts', import.meta.url).href
const toolsModule = new URL('../../extension-protocols/src/tools-plugin.ts', import.meta.url).href
const dynamicModule = new URL('../../extension-dynamic-runtime-plugins/src/index.ts', import.meta.url).href

interface ProjectedTool {
  readonly name: string
  readonly description: string
  readonly loadMode?: 'essential' | 'discoverable'
  readonly parameters: unknown
  readonly approval?: unknown
  readonly formatApprovalDetails?: (args: unknown) => string | string[] | undefined
  execute(
    callId: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ): Promise<{ readonly details?: unknown; readonly content: readonly { readonly text: string }[]; readonly isError?: boolean }>
}

interface MountedExtension {
  readonly handlers: Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown>
  readonly tools: Map<string, ProjectedTool>
  readonly context: ExtensionContext
  readonly activeTools: () => readonly string[]
  readonly errors: string[]
}

interface RecordedRequest {
  readonly method: string
  readonly params: unknown
}

class RecordingConnection implements OmpChildConnection {
  readonly requests: RecordedRequest[] = []
  readonly notifications: Array<{ readonly method: string; readonly params: unknown }> = []
  readonly #inner: OmpChildConnection
  disposal: OmpChildDisposal | undefined

  constructor(inner: OmpChildConnection) {
    this.#inner = inner
  }

  request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    return this.#inner.request(method, params)
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    return this.#inner.onNotification(method, params => {
      this.notifications.push({ method, params })
      handler(params)
    })
  }

  async dispose(): Promise<OmpChildDisposal> {
    return this.disposal ??= await this.#inner.dispose()
  }
}

class RecordingFactory implements OmpChildFactory {
  readonly inner: NodeOmpChildFactory
  connection: RecordingConnection | undefined

  constructor(shutdownTimeoutMs = 1000) {
    this.inner = new NodeOmpChildFactory({ childPath, shutdownTimeoutMs })
  }

  async start(): Promise<OmpChildConnection> {
    const connection = new RecordingConnection(await this.inner.start())
    this.connection = connection
    return connection
  }
}

function proxyName(runtimeName: string): string {
  return `doppelganger_${runtimeName.replaceAll('.', '_')}`
}

function mountedExtension(
  root: string,
  install: (api: ExtensionAPI) => void,
  sessionId: string = crypto.randomUUID(),
): MountedExtension {
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown>()
  const tools = new Map<string, ProjectedTool>()
  const errors: string[] = []
  let activeTools = ['read', 'bash']
  const schema = { min: () => schema }
  const api = {
    zod: { string: () => schema, object: () => ({}) },
    logger: { error(message: string) { errors.push(message) } },
    registerTool(tool: ProjectedTool) { tools.set(tool.name, tool) },
    on(event: string, handler: (event: unknown, context: ExtensionContext) => Promise<unknown> | unknown) {
      handlers.set(event, handler)
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: async (names: string[]) => { activeTools = [...names] },
  } as unknown as ExtensionAPI
  const context = {
    cwd: root,
    hasUI: true,
    ui: { notify(message: string) { errors.push(message) } },
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionContext
  install(api)
  return { handlers, tools, context, activeTools: () => activeTools, errors }
}

interface DynamicFixture {
  readonly root: string
  readonly home: string
  readonly preset: string
  readonly loaderPath: string
}

function loaderSource(vmTimeoutMs: number): string {
  return [
    '- id: context',
    `  name: ${JSON.stringify(contextModule)}`,
    '  isolate:',
    '    doppelgangerContext: session',
    '- id: tools',
    `  name: ${JSON.stringify(toolsModule)}`,
    '  isolate:',
    '    doppelgangerTools: session',
    '- id: base',
    '  name: ./base.mjs',
    '  inject: [doppelgangerContext, doppelgangerTools]',
    '  isolate:',
    '    doppelgangerContext: session',
    '    doppelgangerTools: session',
    '- id: dynamic-runtime-plugins',
    `  name: ${JSON.stringify(dynamicModule)}`,
    '  inject: [doppelgangerRuntimeSession, doppelgangerTools]',
    '  isolate:',
    '    doppelgangerRuntimeSession: session',
    '    doppelgangerContext: session',
    '    doppelgangerTools: session',
    '  config:',
    `    vmTimeoutMs: ${vmTimeoutMs}`,
    '',
  ].join('\n')
}

async function dynamicFixture(vmTimeoutMs = 20): Promise<DynamicFixture> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-dynamic-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const preset = join(home, '.runtime-presets', 'dynamic-test')
  const loaderPath = join(preset, 'runtime.cordis.yml')
  await mkdir(preset, { recursive: true })
  await Promise.all([
    writeFile(join(home, 'config.yaml'), 'version: 1\ndefaultRuntimePreset: dynamic-test\n'),
    writeFile(join(preset, 'base.mjs'), [
      'export default {',
      "  name: 'dynamic-test-base',",
      "  inject: ['doppelgangerContext', 'doppelgangerTools'],",
      '  apply(ctx) {',
      '    ctx.doppelgangerContext.register({',
      "      id: 'base-context',",
      "      resolve: () => [{ source: 'base-context', content: 'Base OMP context.', priority: 1, authority: 'data' }],",
      '    })',
      '    ctx.doppelgangerTools.register({',
      "      name: 'base.echo', description: 'Unrelated base tool',",
      "      inputSchema: { type: 'object', properties: {}, additionalProperties: false },",
      "      invoke: () => ({ base: true }),",
      '    })',
      '  },',
      '}',
      '',
    ].join('\n')),
    writeFile(loaderPath, loaderSource(vmTimeoutMs)),
  ])
  return { root, home, preset, loaderPath }
}

function generatedSource(version: string, options: { readonly fail?: boolean; readonly disposer?: 'hang' | 'reject' } = {}): string {
  return [
    'return {',
    '  inject: ["doppelgangerContext", "doppelgangerTools"],',
    '  apply(ctx) {',
    '    ctx.doppelgangerContext.register({',
    `      id: ${JSON.stringify(`generated-${version}`)},`,
    `      resolve: () => [{ source: ${JSON.stringify(`generated-${version}`)}, content: ${JSON.stringify(`Generated ${version} context.`)}, priority: 100, authority: "instruction" }],`,
    '    });',
    '    ctx.doppelgangerTools.register({',
    `      name: ${JSON.stringify(`generated.${version}`)},`,
    `      description: ${JSON.stringify(`Generated ${version} tool`)},`,
    '      inputSchema: { type: "object", properties: {}, additionalProperties: false },',
    `      invoke: () => ({ version: ${JSON.stringify(version)} }),`,
    '    });',
    ...(options.disposer === 'hang' ? ['    ctx.effect(() => () => new Promise(() => {}));'] : []),
    ...(options.disposer === 'reject' ? ['    ctx.effect(() => () => { throw new Error("generated cleanup rejected"); });'] : []),
    ...(options.fail === true ? ['    throw new Error("generated apply failed");'] : []),
    '  },',
    '}',
  ].join('\n')
}

function objectDetails(result: { readonly details?: unknown; readonly isError?: boolean }): Record<string, unknown> {
  if (result.isError === true || result.details === null || typeof result.details !== 'object' || Array.isArray(result.details)) {
    throw new Error(`expected successful object details: ${JSON.stringify(result.details)}`)
  }
  return result.details as Record<string, unknown>
}

async function execute(
  fixture: MountedExtension,
  runtimeName: string,
  args: Record<string, unknown>,
): Promise<{ readonly details?: unknown; readonly content: readonly { readonly text: string }[]; readonly isError?: boolean }> {
  const tool = fixture.tools.get(proxyName(runtimeName))
  if (tool === undefined) throw new Error(`missing projected tool ${runtimeName}`)
  return tool.execute(crypto.randomUUID(), args, undefined, undefined, fixture.context)
}

async function invokeWithNativeApproval(
  fixture: MountedExtension,
  runtimeName: string,
  args: Record<string, unknown>,
  options: { readonly hasUI: boolean; readonly select?: (prompt: string) => Promise<string | undefined> },
): Promise<{ readonly prompt?: string; readonly result: Awaited<ReturnType<typeof execute>> }> {
  const tool = fixture.tools.get(proxyName(runtimeName))
  if (tool === undefined) throw new Error(`missing projected tool ${runtimeName}`)
  const approval = resolveApproval(tool as never, args, 'yolo', {})
  if (approval.policy === 'deny') throw new Error(`tool denied: ${runtimeName}`)
  let prompt: string | undefined
  if (approval.policy === 'prompt') {
    if (!options.hasUI) throw new Error(`Tool "${tool.name}" requires approval but no interactive UI available.`)
    prompt = formatApprovalPrompt(tool as never, args, approval.reason)
    const choice = await options.select?.(prompt)
    if (choice !== 'Approve') throw new Error(`Tool call denied by user: ${tool.name}`)
  }
  const result = await execute(fixture, runtimeName, args)
  return { ...(prompt === undefined ? {} : { prompt }), result }
}

async function define(
  fixture: MountedExtension,
  source: string,
  pluginId?: unknown,
  prefix = 'generated',
): Promise<Record<string, unknown>> {
  return objectDetails(await execute(fixture, 'runtime-plugin.define', {
    ...(pluginId === undefined ? { idPrefix: prefix } : { pluginId }),
    name: `${prefix} package`,
    purpose: 'OMP dynamic runtime plugin integration proof',
    source,
  }))
}

function runArgs(definition: Record<string, unknown>, mode: 'run' | 'update') {
  return {
    pluginId: definition.pluginId,
    packageId: definition.packageId,
    mode,
    name: definition.name,
    purpose: definition.purpose,
    sourceDigest: definition.sourceDigest,
  }
}

async function approvedRun(
  fixture: MountedExtension,
  definition: Record<string, unknown>,
  mode: 'run' | 'update',
): Promise<{ readonly prompt: string; readonly result: Awaited<ReturnType<typeof execute>> }> {
  const invocation = await invokeWithNativeApproval(
    fixture,
    'runtime-plugin.run',
    runArgs(definition, mode),
    { hasUI: true, select: async () => 'Approve' },
  )
  if (invocation.prompt === undefined) throw new Error('runtime-plugin.run did not request native approval')
  return { prompt: invocation.prompt, result: invocation.result }
}

async function start(fixture: MountedExtension): Promise<void> {
  await fixture.handlers.get('session_start')?.({ type: 'session_start' }, fixture.context)
}

async function shutdown(fixture: MountedExtension): Promise<void> {
  await fixture.handlers.get('session_shutdown')?.({ type: 'session_shutdown' }, fixture.context)
}

async function projectedContext(
  fixture: MountedExtension,
  prompt = 'Inspect generated behavior.',
): Promise<{ readonly instructions: string; readonly data: string }> {
  const result = await fixture.handlers.get('before_agent_start')?.({
    type: 'before_agent_start',
    prompt,
    systemPrompt: [],
  }, fixture.context) as { readonly systemPrompt?: readonly string[] } | undefined
  const context = await fixture.handlers.get('context')?.({
    type: 'context',
    messages: [],
  }, fixture.context) as { readonly messages?: readonly Record<string, unknown>[] } | undefined
  const dataMessage = context?.messages?.find(message => (
    message.role === 'user'
    && message.synthetic === true
    && typeof message.content === 'string'
    && message.content.includes('[DOPPELGANGER RUNTIME DATA]')
  ))
  return {
    instructions: result?.systemPrompt?.at(-1) ?? '',
    data: typeof dataMessage?.content === 'string' ? dataMessage.content : '',
  }
}

function runInvocationCount(factory: RecordingFactory): number {
  return factory.connection?.requests.filter(request => {
    if (request.method !== 'tools.invoke' || request.params === null || typeof request.params !== 'object') return false
    return 'name' in request.params && request.params.name === 'runtime-plugin.run'
  }).length ?? 0
}

async function waitForTool(fixture: MountedExtension, runtimeName: string, active: boolean): Promise<void> {
  const name = proxyName(runtimeName)
  await vi.waitFor(() => expect(fixture.activeTools().includes(name)).toBe(active))
}

async function waitForCatalogChange(factory: RecordingFactory, previousCount: number): Promise<void> {
  await vi.waitFor(() => {
    const count = factory.connection?.notifications.filter(notification => notification.method === 'toolCatalog.changed').length ?? 0
    expect(count).toBeGreaterThan(previousCount)
  }, { timeout: 5000 })
}

async function waitForReloadFailure(factory: RecordingFactory, message: string): Promise<Record<string, unknown>> {
  let matched: Record<string, unknown> | undefined
  await vi.waitFor(async () => {
    const value = await factory.connection?.request('runtime.diagnostics')
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'diagnostics' in value) {
      const diagnostics = value.diagnostics
      if (diagnostics !== null && typeof diagnostics === 'object' && !Array.isArray(diagnostics) && 'reload' in diagnostics) {
        const reload = diagnostics.reload
        if (reload !== null && typeof reload === 'object' && !Array.isArray(reload)
          && 'error' in reload && String(reload.error).includes(message)) matched = value as Record<string, unknown>
      }
    }
    expect(matched).toBeDefined()
  }, { timeout: 5000 })
  return matched!
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('OMP Dynamic Runtime Plugins integration', () => {
  it('projects the exact control surface, enforces one-shot approval, and cuts generated effects over without stale invocation', async () => {
    const project = await dynamicFixture()
    const factory = new RecordingFactory()
    const fixture = mountedExtension(project.root, createDoppelgangerOmpExtension({ home: project.home, childFactory: factory }))
    try {
      await start(fixture)
      const control = [
        'runtime-plugin.define',
        'runtime-plugin.inspect-list',
        'runtime-plugin.inspect-query',
        'runtime-plugin.inspect-self',
        'runtime-plugin.run',
        'runtime-plugin.stop',
        'runtime-plugin.undefine',
      ]
      for (const name of [...control, 'base.echo']) expect(fixture.activeTools()).toContain(proxyName(name))
      const runTool = fixture.tools.get(proxyName('runtime-plugin.run'))!
      expect(runTool.loadMode).toBe('essential')
      expect(runTool.description).toContain('one-shot approval')
      expect(typeof runTool.parameters).toBe('function')
      expect((await execute(fixture, 'runtime-plugin.inspect-list', {})).isError).not.toBe(true)

      const denied = await define(fixture, generatedSource('denied'), undefined, 'denied')
      const deniedArgs = runArgs(denied, 'run')
      const parseRun = runTool.parameters as (value: unknown) => unknown
      expect(parseRun(deniedArgs)).toMatchObject(deniedArgs)
      expect((parseRun({ ...deniedArgs, extra: true }) as { length?: number }).length).toBeGreaterThan(0)
      let deniedPrompt = ''
      await expect(invokeWithNativeApproval(fixture, 'runtime-plugin.run', deniedArgs, {
        hasUI: true,
        select: async prompt => {
          deniedPrompt = prompt
          return 'Deny'
        },
      })).rejects.toThrow('Tool call denied by user')
      await expect(invokeWithNativeApproval(fixture, 'runtime-plugin.run', deniedArgs, {
        hasUI: true,
        select: async () => { throw new Error('approval cancelled') },
      })).rejects.toThrow('approval cancelled')
      await expect(invokeWithNativeApproval(fixture, 'runtime-plugin.run', deniedArgs, { hasUI: false }))
        .rejects.toThrow('requires approval but no interactive UI available')
      expect(deniedPrompt).toContain('shell access')
      expect(deniedPrompt).toContain('Portable tool: runtime-plugin.run')
      for (const value of Object.values(deniedArgs)) expect(deniedPrompt).toContain(String(value))
      expect(runInvocationCount(factory)).toBe(0)
      const deniedState = objectDetails(await execute(fixture, 'runtime-plugin.inspect-self', {
        pluginId: denied.pluginId,
      }))
      expect(deniedState).toMatchObject({
        pluginId: denied.pluginId,
        packages: [{ packageId: denied.packageId }],
      })
      expect(deniedState).not.toHaveProperty('activeRun')
      await waitForTool(fixture, 'generated.denied', false)

      const first = await define(fixture, generatedSource('one'), undefined, 'live')
      const firstRun = await approvedRun(fixture, first, 'run')
      expect(firstRun.result.isError).not.toBe(true)
      expect(runInvocationCount(factory)).toBe(1)
      expect(firstRun.prompt).toContain(String(first.sourceDigest))
      await waitForTool(fixture, 'generated.one', true)
      const projected = await projectedContext(fixture)
      expect(projected.instructions).toContain('Generated one context.')
      expect(projected.data).toContain('Base OMP context.')
      const staleOne = fixture.tools.get(proxyName('generated.one'))!
      expect(await execute(fixture, 'generated.one', {})).toMatchObject({ details: { version: 'one' } })

      const second = await define(fixture, generatedSource('two'), first.pluginId, 'live')
      const update = await approvedRun(fixture, second, 'update')
      expect(update.result.isError).not.toBe(true)
      expect(runInvocationCount(factory)).toBe(2)
      await waitForTool(fixture, 'generated.one', false)
      await waitForTool(fixture, 'generated.two', true)
      expect(await staleOne.execute('stale', {}, undefined, undefined, fixture.context)).toMatchObject({
        isError: true,
        details: { code: 'RUNTIME_UNAVAILABLE' },
      })
      expect(await execute(fixture, 'base.echo', {})).toMatchObject({ details: { base: true } })

      expect(await execute(fixture, 'runtime-plugin.stop', { pluginId: first.pluginId })).toMatchObject({
        details: { stopped: true, wasRunning: true },
      })
      await waitForTool(fixture, 'generated.two', false)
      expect((await projectedContext(fixture)).instructions).not.toContain('Generated two context.')
      const restart = await approvedRun(fixture, second, 'run')
      expect(restart.result.isError).not.toBe(true)
      expect(runInvocationCount(factory)).toBe(3)
      await waitForTool(fixture, 'generated.two', true)

      const rollback = await approvedRun(fixture, first, 'update')
      expect(rollback.result.isError).not.toBe(true)
      expect(runInvocationCount(factory)).toBe(4)
      await waitForTool(fixture, 'generated.one', true)
      await waitForTool(fixture, 'generated.two', false)
      expect(await execute(fixture, 'runtime-plugin.undefine', { pluginId: first.pluginId })).toMatchObject({
        details: { removed: true, wasRunning: true },
      })
      await waitForTool(fixture, 'generated.one', false)
      expect(await execute(fixture, 'runtime-plugin.inspect-self', { pluginId: first.pluginId })).toMatchObject({
        isError: true,
        details: { code: 'PLUGIN_NOT_FOUND' },
      })
    } finally {
      await shutdown(fixture)
    }
  }, 20_000)

  it('clears ephemeral state on valid owner replacement and retains active effects plus approval after invalid reload', async () => {
    const project = await dynamicFixture(20)
    const factory = new RecordingFactory()
    const fixture = mountedExtension(project.root, createDoppelgangerOmpExtension({ home: project.home, childFactory: factory }))
    try {
      await start(fixture)
      const first = await define(fixture, generatedSource('before-reload'), undefined, 'reload')
      expect((await approvedRun(fixture, first, 'run')).result.isError).not.toBe(true)
      await waitForTool(fixture, 'generated.before-reload', true)

      const catalogChanges = factory.connection?.notifications.filter(notification => notification.method === 'toolCatalog.changed').length ?? 0
      await writeFile(project.loaderPath, loaderSource(30))
      await waitForCatalogChange(factory, catalogChanges)
      await waitForTool(fixture, 'generated.before-reload', false)
      expect(await execute(fixture, 'runtime-plugin.inspect-self', {})).toMatchObject({ details: { plugins: [] } })

      const retained = await define(fixture, generatedSource('retained'), undefined, 'retained')
      expect((await approvedRun(fixture, retained, 'run')).result.isError).not.toBe(true)
      await waitForTool(fixture, 'generated.retained', true)
      const retainedArgs = runArgs(retained, 'run')
      const approvalBefore = resolveApproval(
        fixture.tools.get(proxyName('runtime-plugin.run')) as never,
        retainedArgs,
        'yolo',
        {},
      )
      expect(approvalBefore.policy).toBe('prompt')
      const promptBefore = approvalBefore.policy === 'prompt'
        ? formatApprovalPrompt(
          fixture.tools.get(proxyName('runtime-plugin.run')) as never,
          retainedArgs,
          approvalBefore.reason,
        )
        : ''

      await writeFile(project.loaderPath, loaderSource(0))
      const failed = await waitForReloadFailure(factory, 'vmTimeoutMs')
      expect(failed).toMatchObject({ diagnostics: { reload: { state: 'failed' } } })
      await waitForTool(fixture, 'generated.retained', true)
      expect(await execute(fixture, 'generated.retained', {})).toMatchObject({ details: { version: 'retained' } })
      const approvalAfter = resolveApproval(
        fixture.tools.get(proxyName('runtime-plugin.run')) as never,
        retainedArgs,
        'yolo',
        {},
      )
      expect(approvalAfter).toEqual(approvalBefore)
      expect(approvalAfter.policy).toBe('prompt')
      if (approvalAfter.policy === 'prompt') {
        expect(formatApprovalPrompt(
          fixture.tools.get(proxyName('runtime-plugin.run')) as never,
          retainedArgs,
          approvalAfter.reason,
        )).toBe(promptBefore)
      }
    } finally {
      await shutdown(fixture)
    }
  }, 20_000)

  it('contains structured generated failures and isolates a fatal child exit to its owning OMP session', async () => {
    const firstProject = await dynamicFixture()
    const secondProject = await dynamicFixture()
    const firstFactory = new RecordingFactory(200)
    const secondFactory = new RecordingFactory(200)
    const first = mountedExtension(firstProject.root, createDoppelgangerOmpExtension({ home: firstProject.home, childFactory: firstFactory }))
    const second = mountedExtension(secondProject.root, createDoppelgangerOmpExtension({ home: secondProject.home, childFactory: secondFactory }))
    try {
      await Promise.all([start(first), start(second)])
      const failed = await define(first, generatedSource('failed', { fail: true }), undefined, 'failed')
      expect((await approvedRun(first, failed, 'run')).result).toMatchObject({
        isError: true,
        details: { code: 'PACKAGE_APPLY_FAILED', message: expect.stringContaining('generated apply failed') },
      })
      expect(await execute(first, 'base.echo', {})).toMatchObject({ details: { base: true } })
      expect((await projectedContext(first)).data).toContain('Base OMP context.')

      const crash = await define(first, [
        'return {',
        '  apply() {',
        '    console.log.constructor("return process")().exit(42);',
        '  },',
        '}',
      ].join('\n'), undefined, 'crash')
      await approvedRun(first, crash, 'run')
      await vi.waitFor(() => expect(first.errors.join('\n')).toContain('runtime child exited unexpectedly'))
      await vi.waitFor(() => expect(first.activeTools()).toEqual(['read', 'bash']))
      expect(await execute(second, 'base.echo', {})).toMatchObject({ details: { base: true } })
      expect((await projectedContext(second)).data).toContain('Base OMP context.')
    } finally {
      await Promise.all([shutdown(first), shutdown(second)])
    }
  }, 20_000)

  it('forces bounded child termination when generated cleanup never settles', async () => {
    const project = await dynamicFixture()
    const factory = new RecordingFactory(100)
    const fixture = mountedExtension(project.root, createDoppelgangerOmpExtension({
      home: project.home,
      childFactory: factory,
      shutdownTimeoutMs: 100,
    }))
    await start(fixture)
    const definition = await define(fixture, generatedSource('hang', { disposer: 'hang' }), undefined, 'hang')
    expect((await approvedRun(fixture, definition, 'run')).result.isError).not.toBe(true)
    await shutdown(fixture)
    await vi.waitFor(() => expect(factory.connection?.disposal).toMatchObject({
      outcome: expect.stringMatching(/terminated|killed/u),
      sessionDisposeAcknowledged: false,
    }), { timeout: 5000 })
    expect(fixture.errors.join('\n')).toContain('runtime shutdown')
  }, 15_000)

  it('completes exhaustive cleanup and reports a rejecting generated disposer', async () => {
    const project = await dynamicFixture()
    const factory = new RecordingFactory(100)
    const fixture = mountedExtension(project.root, createDoppelgangerOmpExtension({
      home: project.home,
      childFactory: factory,
      shutdownTimeoutMs: 100,
    }))
    await start(fixture)
    const definition = await define(fixture, generatedSource('reject', { disposer: 'reject' }), undefined, 'reject')
    expect((await approvedRun(fixture, definition, 'run')).result.isError).not.toBe(true)
    await shutdown(fixture)
    await vi.waitFor(() => expect(factory.connection?.disposal).toMatchObject({
      outcome: expect.stringMatching(/terminated|killed/u),
      sessionDisposeAcknowledged: false,
      diagnostic: expect.stringContaining('generated cleanup rejected'),
    }), { timeout: 5000 })
    await vi.waitFor(() => expect(fixture.errors.join('\n')).toContain('runtime shutdown diagnostic'))
  }, 15_000)

  it('runs the real project-local extension through define, approved update, stop, and continued context use', async () => {
    const project = await dynamicFixture()
    vi.stubEnv('DOPPELGANGER_HOME', project.home)
    vi.resetModules()
    const extensionUrl = new URL('../../../.omp/extensions/doppelganger.ts', import.meta.url)
    extensionUrl.searchParams.set('dynamic-smoke', crypto.randomUUID())
    const projectExtension = (await import(extensionUrl.href)).default
    const fixture = mountedExtension(project.root, projectExtension, 'project-local-dynamic-smoke')
    try {
      await start(fixture)
      const first = await define(fixture, generatedSource('project-one'), undefined, 'project')
      expect((await approvedRun(fixture, first, 'run')).result.isError).not.toBe(true)
      await waitForTool(fixture, 'generated.project-one', true)
      expect((await projectedContext(fixture)).instructions).toContain('Generated project-one context.')

      const second = await define(fixture, generatedSource('project-two'), first.pluginId, 'project')
      expect((await approvedRun(fixture, second, 'update')).result.isError).not.toBe(true)
      await waitForTool(fixture, 'generated.project-one', false)
      await waitForTool(fixture, 'generated.project-two', true)
      expect(await execute(fixture, 'runtime-plugin.stop', { pluginId: first.pluginId })).toMatchObject({
        details: { stopped: true, wasRunning: true },
      })
      await waitForTool(fixture, 'generated.project-two', false)
      expect((await projectedContext(fixture, 'Continue after stopping the temporary plugin.')).data).toContain('Base OMP context.')
      expect(await execute(fixture, 'base.echo', {})).toMatchObject({ details: { base: true } })
    } finally {
      await shutdown(fixture)
    }
  }, 20_000)

  it('keeps ordinary presets and shipped standard unchanged when the extension is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doppelganger-omp-standard-'))
    temporaryRoots.push(root)
    const factory = new RecordingFactory()
    const fixture = mountedExtension(root, createDoppelgangerOmpExtension({
      home: join(root, 'home'),
      childFactory: factory,
    }))
    try {
      await start(fixture)
      expect(fixture.activeTools()).toEqual(['read', 'bash'])
      expect([...fixture.tools.keys()].some(name => name.includes('runtime_x2d_plugin'))).toBe(false)
    } finally {
      await shutdown(fixture)
    }
  }, 20_000)

  it('disposes active generated effects during bounded session shutdown', async () => {
    const project = await dynamicFixture()
    const factory = new RecordingFactory()
    const fixture = mountedExtension(project.root, createDoppelgangerOmpExtension({
      home: project.home,
      childFactory: factory,
    }))
    let closed = false
    try {
      await start(fixture)
      const definition = await define(fixture, generatedSource('graceful'), undefined, 'graceful')
      expect((await approvedRun(fixture, definition, 'run')).result.isError).not.toBe(true)
      await waitForTool(fixture, 'generated.graceful', true)
      await shutdown(fixture)
      closed = true
      await vi.waitFor(() => expect(factory.connection?.disposal).toMatchObject({
        outcome: 'graceful',
        sessionDisposeAcknowledged: true,
      }))
    } finally {
      if (!closed) await shutdown(fixture)
    }
  }, 20_000)
})
