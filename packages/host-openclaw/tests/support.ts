import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnyAgentTool, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core'
import type { HostExtensionSelectionInput } from '@doppelganger/doppelganger-host-extensions'
import type {
  OpenClawAgentContext,
  OpenClawBeforeToolCallEvent,
  OpenClawToolHookContext,
} from '../src/adapter.ts'
import { prepareCatalog, type PreparedCatalog } from '../src/catalog.ts'
import { createOpenClawPlugin } from '../src/plugin.ts'

export interface FixtureState {
  contextRequests: Array<{ input: string; turnId?: string; actor: unknown }>
  activations: number
  calls: Array<{ name: string; input: unknown; actor: unknown; callId: string }>
  disposals: number
  failContext: boolean
  replaceEcho?: () => void
  removeEcho?: () => void
  addUndeclared?: () => void
  releaseHold?: (callId: string) => void
  driftEcho?: () => void
}

export interface RegisteredPlugin {
  hooks: Map<string, Function>
  toolFactory: ((context: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined) | undefined
  toolNames: readonly string[]
  cleanup: ((context: { reason: 'disable' | 'reset' | 'delete' | 'restart'; sessionKey?: string; runId?: string }) => Promise<void> | void) | undefined
  service: { readonly id: string; start(): void | Promise<void>; stop?(): void | Promise<void> } | undefined
  diagnostics: string[]
}

export type NativeHarnessContext = OpenClawPluginToolContext & OpenClawAgentContext

export interface NativeHarness {
  readonly root: string
  readonly home: string
  readonly workspaceRoot: string
  readonly state: FixtureState
  readonly prepared: PreparedCatalog
  readonly plugin: RegisteredPlugin
  readonly pluginConfig: Readonly<Record<string, unknown>>
  readonly nativeNames: Readonly<Record<string, string>>
  context(overrides?: Partial<NativeHarnessContext>): NativeHarnessContext
  warm(context?: NativeHarnessContext): Promise<void>
  prompt(prompt: string, context?: NativeHarnessContext): Promise<unknown>
  tools(context?: OpenClawPluginToolContext): AnyAgentTool[]
  beforeTool(tool: AnyAgentTool, callId: string, params: Record<string, unknown>, context?: NativeHarnessContext, abortSignal?: AbortSignal): Promise<unknown>
  invoke(tool: AnyAgentTool, callId: string, params: Record<string, unknown>, context?: NativeHarnessContext, abortSignal?: AbortSignal): Promise<unknown>
  dispose(): Promise<void>
}

const DESCRIPTORS = [
  { name: 'fixture.echo', label: 'Fixture Echo', description: 'Echo input and actor state', inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } }, available: true },
  { name: 'fixture.approved', label: 'Fixture Approved', description: 'Invoke an approval-protected fixture operation', inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } }, approval: { policy: 'required', reason: 'Review the fixture operation' }, available: true },
  { name: 'fixture.hold', label: 'Fixture Hold', description: 'Wait until the native call is cancelled', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, available: true },
  { name: 'fixture.fail', label: 'Fixture Failure', description: 'Return a structured portable domain failure', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, available: true },
  { name: 'fixture.actor-required', label: 'Fixture Actor Required', description: 'Require a bound actor identity', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, available: true },
] as const

function fixtureSource(stateKey: string): string {
  return `
import { ToolInvocationError } from '@doppelganger/doppelganger-protocols'
const state = globalThis[${JSON.stringify(stateKey)}]
export default {
  name: 'openclaw-fixture', inject: ['doppelgangerContext', 'doppelgangerTools'],
  apply(ctx) {
    state.activations += 1
    const actor = () => ctx.get('doppelgangerActor', false)
    const holds = new Map()
    const echo = suffix => ({
      name: 'fixture.echo', label: 'Fixture Echo', description: 'Echo input and actor state',
      inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
      invoke(input, context) { state.calls.push({ name: 'fixture.echo', input, actor: actor(), callId: context.callId }); return { value: input.value + suffix, actor: actor() } },
    })
    const approved = {
      name: 'fixture.approved', label: 'Fixture Approved', description: 'Invoke an approval-protected fixture operation',
      inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
      approval: { policy: 'required', reason: 'Review the fixture operation' },
      invoke(input, context) { state.calls.push({ name: 'fixture.approved', input, actor: actor(), callId: context.callId }); return { approved: input.value, actor: actor() } },
    }
    const actorRequired = {
      name: 'fixture.actor-required', label: 'Fixture Actor Required', description: 'Require a bound actor identity',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      invoke(input, context) {
        const identity = actor()
        state.calls.push({ name: 'fixture.actor-required', input, actor: identity, callId: context.callId })
        if (identity?.state !== 'bound') throw new ToolInvocationError('ACTOR_REQUIRED', 'fixture requires a bound actor')
        return { actorId: identity.actorId }
      },
    }
    const hold = {
      name: 'fixture.hold', label: 'Fixture Hold', description: 'Wait until the native call is cancelled',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      async invoke(input, context) {
        state.calls.push({ name: 'fixture.hold', input, actor: actor(), callId: context.callId })
        if (context.signal.aborted) return { cancelled: true }
        const { promise, resolve } = Promise.withResolvers()
        const abort = () => resolve()
        holds.set(context.callId, resolve)
        context.signal.addEventListener('abort', abort, { once: true })
        await promise
        context.signal.removeEventListener('abort', abort)
        holds.delete(context.callId)
        return { cancelled: context.signal.aborted }
      },
    }
    const fail = {
      name: 'fixture.fail', label: 'Fixture Failure', description: 'Return a structured portable domain failure',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      invoke() { throw new ToolInvocationError('FIXTURE_DOMAIN', 'fixture refused the operation', { retryable: false }) },
    }
    const undeclared = { name: 'fixture.extra', label: 'Fixture Extra', description: 'Undeclared fixture tool', inputSchema: { type: 'object', additionalProperties: false, properties: {} }, invoke() { return null } }
    const registration = ctx.doppelgangerTools.registerSet('openclaw-fixture', [echo(''), approved, actorRequired, hold, fail])
    ctx.doppelgangerContext.register({
      id: 'openclaw-fixture',
      resolve(request) {
        state.contextRequests.push({ input: request.turn.input, turnId: request.turn.turnId, actor: actor() })
        if (state.failContext) throw new Error('fixture context failure')
        return [
          { source: 'fixture-instruction', content: 'FIXTURE INSTRUCTION', priority: 10, authority: 'instruction' },
          { source: 'fixture-data', content: 'FIXTURE DATA', priority: 5, authority: 'data' },
        ]
      },
    })
    const driftedEcho = { ...echo('-drift'), inputSchema: { type: 'object', additionalProperties: false, properties: { count: { type: 'integer' } } } }
    state.replaceEcho = () => registration.replace([echo('-replacement'), approved, actorRequired, hold, fail])
    state.releaseHold = callId => holds.get(callId)?.()
    state.removeEcho = () => registration.replace([approved, actorRequired, hold, fail])
    state.addUndeclared = () => registration.replace([echo('-replacement'), approved, actorRequired, hold, fail, undeclared])
    state.driftEcho = () => registration.replace([driftedEcho, approved, actorRequired, hold, fail])
    ctx.effect(() => () => { state.disposals += 1 }, 'openclawFixture.disposal')
  },
}
`
}

export function registerNativePlugin(
  prepared: PreparedCatalog,
  pluginConfig: Record<string, unknown>,
  registrationMode: 'full' | 'discovery' | 'tool-discovery' = 'full',
): RegisteredPlugin {
  const hooks = new Map<string, Function>()
  const diagnostics: string[] = []
  let toolFactory: RegisteredPlugin['toolFactory']
  let toolNames: readonly string[] = []
  let cleanup: RegisteredPlugin['cleanup']
  let service: RegisteredPlugin['service']
  const nativePlugin = createOpenClawPlugin(prepared)
  if (nativePlugin.register === undefined) throw new Error('OpenClaw plugin register callback is unavailable')
  nativePlugin.register({
    registrationMode,
    pluginConfig,
    logger: {
      debug(message: string) { diagnostics.push(message) }, info(message: string) { diagnostics.push(message) },
      warn(message: string) { diagnostics.push(message) }, error(message: string) { diagnostics.push(message) },
    },
    on(hook: string, handler: Function) { hooks.set(hook, handler) },
    registerTool(factory: RegisteredPlugin['toolFactory'], options: { names?: readonly string[] }) { toolFactory = factory; toolNames = options.names ?? [] },
    registerService(registration: NonNullable<RegisteredPlugin['service']>) { service = registration },
    lifecycle: { registerRuntimeLifecycle(registration: { cleanup(context: { reason: 'disable' | 'reset' | 'delete' | 'restart'; sessionKey?: string; runId?: string }): Promise<void> | void }) { cleanup = registration.cleanup } },
  } as never)
  if (registrationMode === 'full') {
    if (service === undefined) throw new Error('OpenClaw plugin service was not registered')
    void service.start()
  }
  return { hooks, get toolFactory() { return toolFactory }, get toolNames() { return toolNames }, get cleanup() { return cleanup }, get service() { return service }, diagnostics }
}

export async function createNativeHarness(options: {
  readonly empty?: boolean; readonly defaultless?: boolean; readonly preparedRuntimePresetId?: string
  readonly actorId?: string; readonly agentId?: string; readonly sessionKey?: string; readonly sessionId?: string
  readonly holdActivation?: boolean; readonly warmupTimeoutMs?: number
  readonly secondaryActor?: { readonly agentId: string; readonly sessionKey: string; readonly sessionId: string; readonly actorId: string; readonly workspaceRoot?: string }
  readonly registrationMode?: 'full' | 'discovery' | 'tool-discovery'
  readonly hostExtensions?: readonly HostExtensionSelectionInput[]
} = {}): Promise<NativeHarness> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-openclaw-native-'))
  const home = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  const secondaryWorkspaceRoot = options.secondaryActor?.workspaceRoot ?? join(root, 'workspace-secondary')
  const presetRoot = join(root, 'presets')
  const preset = join(presetRoot, 'fixture')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(preset, { recursive: true }),
    ...(options.secondaryActor === undefined ? [] : [mkdir(secondaryWorkspaceRoot, { recursive: true })]),
  ])
  const packageScope = join(root, 'node_modules', '@doppelganger')
  await mkdir(packageScope, { recursive: true })
  await symlink(fileURLToPath(new URL('../../extension-protocols', import.meta.url)), join(packageScope, 'doppelganger-protocols'), 'dir')
  await symlink(fileURLToPath(new URL('../../extension-mcp', import.meta.url)), join(packageScope, 'doppelganger-extension-mcp'), 'dir')
  await writeFile(join(workspaceRoot, '.git'), '')
  const stateKey = `__doppelgangerOpenClawFixture${Date.now()}${Math.random().toString(16).slice(2)}`
  const state: FixtureState = { contextRequests: [], calls: [], activations: 0, disposals: 0, failContext: false }
  Object.defineProperty(globalThis, stateKey, { value: state, configurable: true })
  const heldMcp = join(preset, 'hold-mcp.mjs')
  if (options.holdActivation === true) await writeFile(heldMcp, 'process.stdin.resume()\n')
  if (options.empty === true) await writeFile(join(preset, 'runtime.cordis.yml'), '[]\n')
  else await Promise.all([
    writeFile(join(preset, 'fixture.mjs'), fixtureSource(stateKey)),
    writeFile(join(preset, 'runtime.cordis.yml'), JSON.stringify([
      { id: 'context', name: '@doppelganger/doppelganger-protocols/context', isolate: { doppelgangerContext: 'session' } },
      { id: 'tools', name: '@doppelganger/doppelganger-protocols/tools', isolate: { doppelgangerTools: 'session' } },
      ...(options.holdActivation === true ? [{
        id: 'mcp',
        name: '@doppelganger/doppelganger-extension-mcp/loader',
        config: { startupMode: 'await-ready', servers: { held: { startupTimeoutMs: 600_000, transport: { type: 'stdio', command: process.execPath, args: [heldMcp] } } } },
        isolate: { doppelgangerTools: 'session' },
      }] : []),
      { id: 'fixture', name: './fixture.mjs', isolate: { doppelgangerContext: 'session', doppelgangerTools: 'session', doppelgangerActor: 'session' } },
    ])),
  ])
  const prepared = prepareCatalog(options.preparedRuntimePresetId ?? 'fixture', { revision: 'catalog:prepared', tools: options.empty === true ? [] : DESCRIPTORS.map((descriptor, index) => ({ ...descriptor, revision: `prepared:${index}` })) })
  const agentId = options.agentId ?? 'agent-one'
  const sessionKey = options.sessionKey ?? 'route-one'
  const sessionId = options.sessionId ?? 'session-one'
  const actors = [
    ...(options.actorId === undefined ? [] : [{ agentId, sessionKey, workspaceRoot, actorId: options.actorId }]),
    ...(options.secondaryActor === undefined ? [] : [{
      agentId: options.secondaryActor.agentId,
      sessionKey: options.secondaryActor.sessionKey,
      workspaceRoot: secondaryWorkspaceRoot,
      actorId: options.secondaryActor.actorId,
    }]),
  ]
  const pluginConfig = {
    roster: { home, defaultRuntimePreset: options.defaultless === true ? null : 'fixture', roots: [{ path: presetRoot, trust: 'system' as const }], includeShippedRoot: false, includeUserRoot: false },
    warmupTimeoutMs: options.warmupTimeoutMs ?? 5_000, contextTokenBudget: 1_000, actors,
    ...(options.hostExtensions === undefined ? {} : { hostExtensions: options.hostExtensions }),
  }
  const plugin = registerNativePlugin(prepared, pluginConfig, options.registrationMode)
  const defaultContext: NativeHarnessContext = { agentId, sessionKey, sessionId, workspaceDir: workspaceRoot, runId: 'run-one' }
  const nativeNames = Object.freeze(Object.fromEntries(prepared.tools.map(tool => [tool.descriptor.name, tool.nativeName])))
  return {
    root, home, workspaceRoot, state, prepared, plugin, pluginConfig, nativeNames,
    context(overrides = {}) { return { ...defaultContext, ...overrides } },
    async warm(context = defaultContext) { const hook = plugin.hooks.get('before_model_resolve'); if (hook === undefined) throw new Error('before_model_resolve hook was not registered'); await hook({ prompt: 'fixture prompt' }, context) },
    async prompt(prompt: string, context = defaultContext) { const hook = plugin.hooks.get('before_prompt_build'); if (hook === undefined) throw new Error('before_prompt_build hook was not registered'); return hook({ prompt, messages: [] }, context) },
    tools(context = defaultContext) { const resolved = plugin.toolFactory?.(context); if (resolved == null) return []; return Array.isArray(resolved) ? resolved : [resolved] },
    async beforeTool(tool, callId, params, context = defaultContext, abortSignal) {
      const hook = plugin.hooks.get('before_tool_call')
      if (hook === undefined) throw new Error('before_tool_call hook was not registered')
      const event: OpenClawBeforeToolCallEvent = { toolName: tool.name, params, toolCallId: callId, ...(context.runId === undefined ? {} : { runId: context.runId }) }
      const hookContext: OpenClawToolHookContext = {
        toolName: tool.name, toolCallId: callId,
        ...(context.workspaceDir === undefined ? {} : { workspaceDir: context.workspaceDir }),
        ...(context.agentId === undefined ? {} : { agentId: context.agentId }), ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
        ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }), ...(context.runId === undefined ? {} : { runId: context.runId }),
        ...(abortSignal === undefined ? {} : { abortSignal }),
      }
      return hook(event, hookContext)
    },
    async invoke(tool, callId, params, context = defaultContext, abortSignal) {
      const hookResult = await (this as NativeHarness).beforeTool(tool, callId, params, context, abortSignal) as { block?: boolean; blockReason?: string } | undefined
      if (hookResult?.block) throw new Error(hookResult.blockReason ?? 'native before-tool hook blocked the call')
      return tool.execute(callId, params, abortSignal)
    },
    async dispose() {
      try {
        await plugin.service?.stop?.()
        await plugin.cleanup?.({ reason: 'disable' })
      } finally {
        delete (globalThis as Record<string, unknown>)[stateKey]
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}

export async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 10)
    await promise
  }
}
