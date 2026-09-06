import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnyAgentTool, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core'
import type {
  ActorIdentity,
  JsonValue,
  RuntimeHostCapabilities,
  ToolCatalogSnapshot,
  ToolInvocationResult,
} from '@doppelganger/doppelganger-protocols'
import type {
  RuntimeHostConformanceRegistration,
  RuntimeHostConformanceTool,
} from '@doppelganger/doppelganger-protocols/test-support/runtime-host-conformance'
import {
  createOpenClawPlugin,
  prepareCatalog,
  type PreparedCatalog,
} from '../../src/index.ts'
import type {
  OpenClawBeforeToolCallEvent,
  OpenClawBeforeToolCallResult,
  OpenClawToolHookContext,
} from '../../src/adapter.ts'

const controlPath = fileURLToPath(new URL('./conformance-fixture.mjs', import.meta.url))
const emptyControlPath = fileURLToPath(new URL('./conformance-empty-fixture.mjs', import.meta.url))
const lifecycleConsumerPath = fileURLToPath(new URL('./conformance-lifecycle-consumer.mjs', import.meta.url))

export const OPENCLAW_CONFORMANCE_TOOL_NAMES = Object.freeze([
  'alpha.read',
  'approval.write',
  'beta.read',
  'first.read',
  'replacement.read',
  'second.read',
  'worker.dispose',
  'worker.fast',
  'worker.late',
  'worker.successor',
  'worker.wait',
] as const)

type ConformanceToolName = typeof OPENCLAW_CONFORMANCE_TOOL_NAMES[number]

interface ConformanceFixtureCall {
  readonly name: string
  readonly input: JsonValue
  readonly callId: string
  readonly sessionId: string
  readonly turnId?: string
  readonly actor: ActorIdentity
}

interface FixtureRegistration {
  replace(definitions: readonly RuntimeHostConformanceTool[]): void
  dispose(): Promise<void>
}

interface FixtureControl {
  snapshot(): ToolCatalogSnapshot
  registerSet(
    ownerId: string,
    definitions: readonly RuntimeHostConformanceTool[],
  ): FixtureRegistration
  waitForCall(callId: string): Promise<void>
  releaseCall(callId: string): void
  requireLifecycle(eventType: string): void
}

interface ConformanceFixtureState {
  readonly calls: ConformanceFixtureCall[]
  readonly started: Map<string, PromiseWithResolvers<void>>
  readonly releases: Map<string, PromiseWithResolvers<void>>
  readonly catalogChanges: string[]
  readonly lifecycleEvents: unknown[]
  lifecycleRequirement?: {
    readonly active: boolean
    readonly missing?: string
    readonly diagnostic?: string
  }
  actorIdentity?: ActorIdentity
  capabilities?: RuntimeHostCapabilities
  runtimeSessionId?: string
  control?: FixtureControl
}

interface RegisteredPlugin {
  readonly hooks: Map<string, Function>
  readonly toolNames: readonly string[]
  readonly diagnostics: string[]
  readonly toolFactory: ((context: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined) | undefined
  readonly contextEngineRegistrations: readonly string[]
  readonly selectedContextEngine: string
  readonly cleanup: ((context: {
    reason: 'disable' | 'reset' | 'delete' | 'restart'
    sessionKey?: string
    runId?: string
  }) => Promise<void> | void) | undefined
  readonly service: { start(): void | Promise<void>; stop?(): void | Promise<void> } | undefined
}

export interface OpenClawConformanceHarness {
  readonly prepared: PreparedCatalog
  readonly plugin: RegisteredPlugin
  readonly state: ConformanceFixtureState
  readonly nativeNames: Readonly<Record<ConformanceToolName, string>>
  readonly context: OpenClawPluginToolContext
  readonly runId: string
  readonly actorIdentity: ActorIdentity
  readonly capabilities: RuntimeHostCapabilities
  readonly runtimeSessionId: string
  portableSnapshot(): ToolCatalogSnapshot
  nativeTools(): AnyAgentTool[]
  nativeTool(name: ConformanceToolName): AnyAgentTool
  registerSet(
    ownerId: string,
    definitions: readonly RuntimeHostConformanceTool[],
  ): Promise<RuntimeHostConformanceRegistration>
  beforeTool(
    tool: AnyAgentTool,
    callId: string,
    params: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): OpenClawBeforeToolCallResult | undefined
  execute(
    tool: AnyAgentTool,
    callId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolInvocationResult>
  executeRetained(
    tool: AnyAgentTool,
    callId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolInvocationResult>
  waitForCall(callId: string): Promise<void>
  releaseCall(callId: string): void
  requireLifecycle(eventType: string): void
  dispose(): Promise<void>
}

const APPROVAL_BY_NAME: Partial<Record<ConformanceToolName, {
  readonly policy: 'required'
  readonly reason: string
}>> = {
  'approval.write': {
    policy: 'required',
    reason: 'Confirm exact conformance mutation',
  },
}

function descriptor(name: ConformanceToolName) {
  const requirement = APPROVAL_BY_NAME[name]
  return {
    name,
    label: name,
    description: `Conformance tool ${name}`,
    inputSchema: { type: 'object' },
    ...(requirement === undefined ? {} : { approval: requirement }),
    available: true,
  }
}

function preparedCatalog(): PreparedCatalog {
  return prepareCatalog('conformance', {
    revision: 'catalog:prepared',
    tools: OPENCLAW_CONFORMANCE_TOOL_NAMES.map((name, index) => ({
      ...descriptor(name),
      revision: `prepared:${index}`,
    })),
  })
}

function registerPlugin(prepared: PreparedCatalog, pluginConfig: Record<string, unknown>): RegisteredPlugin {
  const hooks = new Map<string, Function>()
  const diagnostics: string[] = []
  let toolFactory: RegisteredPlugin['toolFactory']
  const contextEngineRegistrations: string[] = []
  const selectedContextEngine = 'existing-context-engine'
  let toolNames: readonly string[] = []
  let cleanup: RegisteredPlugin['cleanup']
  let service: RegisteredPlugin['service']
  const logger = {
    debug(message: string) { diagnostics.push(message) },
    info(message: string) { diagnostics.push(message) },
    warn(message: string) { diagnostics.push(message) },
    error(message: string) { diagnostics.push(message) },
  }
  const api = {
    id: 'doppelganger',
    name: 'Doppelganger',
    source: 'test',
    registrationMode: 'full',
    config: { plugins: { slots: { contextEngine: selectedContextEngine } } },
    pluginConfig,
    runtime: {},
    logger,
    on(name: string, handler: Function) { hooks.set(name, handler) },
    registerTool(factory: RegisteredPlugin['toolFactory'], options: { names?: string[] }) {
      toolFactory = factory
      toolNames = Object.freeze([...(options.names ?? [])])
    },
    registerContextEngine(id: string) { contextEngineRegistrations.push(id) },
    registerService(registration: NonNullable<RegisteredPlugin['service']>) { service = registration },
    lifecycle: {
      registerRuntimeLifecycle(registration: { cleanup?: RegisteredPlugin['cleanup'] }) {
        cleanup = registration.cleanup
      },
    },
  }
  createOpenClawPlugin(prepared).register?.(api as never)
  if (service === undefined) throw new Error('OpenClaw plugin service was not registered')
  void service.start()
  return {
    hooks,
    get toolFactory() { return toolFactory },
    get toolNames() { return toolNames },
    get cleanup() { return cleanup },
    get service() { return service },
    diagnostics,
    contextEngineRegistrations,
    selectedContextEngine,
  }
}

function toolsFromFactory(plugin: RegisteredPlugin, context: OpenClawPluginToolContext): AnyAgentTool[] {
  const tools = plugin.toolFactory?.(context)
  if (tools == null) return []
  return Array.isArray(tools) ? tools : [tools]
}

function toolExecute(tool: AnyAgentTool): (
  callId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown> {
  if (typeof tool.execute !== 'function') throw new Error(`native tool ${tool.name} has no execute function`)
  return tool.execute
}

export function conformanceTool(
  name: ConformanceToolName,
  value: JsonValue,
  options: Partial<RuntimeHostConformanceTool> = {},
): RuntimeHostConformanceTool {
  return {
    name,
    description: `Conformance tool ${name}`,
    inputSchema: { type: 'object' },
    fixtureResult: { value },
    ...options,
  }
}

export async function createOpenClawConformanceHarness(options: {
  readonly nativeSessionId?: string
  readonly actor?: 'unbound' | { readonly actorId: string }
  readonly context?: boolean
  readonly tools?: boolean
  readonly lifecycleConsumer?: boolean
} = {}): Promise<OpenClawConformanceHarness> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-openclaw-conformance-'))
  const home = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  const presetRoot = join(root, 'presets')
  const preset = join(presetRoot, 'conformance')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(preset, { recursive: true }),
  ])
  await writeFile(join(workspaceRoot, '.git'), '')

  const stateKey = `__doppelgangerOpenClawConformance${crypto.randomUUID().replaceAll('-', '')}`
  const state: ConformanceFixtureState = {
    calls: [],
    started: new Map(),
    releases: new Map(),
    catalogChanges: [],
    lifecycleEvents: [],
  }
  Object.defineProperty(globalThis, stateKey, { value: state, configurable: true })
  const loaderEntries = [
    ...(options.context === false ? [] : [{
      id: 'context',
      name: '@doppelganger/doppelganger-protocols/context',
      isolate: { doppelgangerContext: 'session' },
    }]),
    ...(options.tools === false ? [] : [{
      id: 'tools',
      name: '@doppelganger/doppelganger-protocols/tools',
      isolate: { doppelgangerTools: 'session' },
    }]),
    {
      id: 'control',
      name: options.tools === false ? emptyControlPath : controlPath,
      config: { stateKey },
      isolate: {
        doppelgangerActor: 'session',
        doppelgangerHostCapabilities: 'session',
        doppelgangerRuntimeSession: 'session',
        ...(options.tools === false ? {} : { doppelgangerTools: 'session' }),
      },
    },
    ...(options.lifecycleConsumer === true ? [{
      id: 'lifecycle-consumer',
      name: lifecycleConsumerPath,
      config: { stateKey },
      isolate: { doppelgangerHostCapabilities: 'session' },
    }] : []),
  ]
  await writeFile(join(preset, 'runtime.cordis.yml'), JSON.stringify(loaderEntries))

  const prepared = preparedCatalog()
  const agentId = 'conformance-agent'
  const sessionKey = `conformance-route-${crypto.randomUUID()}`
  const nativeSessionId = options.nativeSessionId ?? `conformance-native-${crypto.randomUUID()}`
  const runId = `conformance-run-${crypto.randomUUID()}`
  const context: OpenClawPluginToolContext = {
    agentId,
    sessionKey,
    sessionId: nativeSessionId,
    workspaceDir: workspaceRoot,
  }
  const plugin = registerPlugin(prepared, {
    roster: {
      home,
      defaultRuntimePreset: 'conformance',
      roots: [{ path: presetRoot, trust: 'system' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    },
    warmupTimeoutMs: 5_000,
    contextTokenBudget: 1_000,
    actors: typeof options.actor === 'object'
      ? [{ agentId, sessionKey, workspaceRoot, actorId: options.actor.actorId }]
      : [],
  })
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    try {
      await plugin.service?.stop?.()
      await plugin.cleanup?.({ reason: 'disable' })
    } finally {
      delete (globalThis as Record<string, unknown>)[stateKey]
      await rm(root, { recursive: true, force: true })
    }
  }

  try {
    const warm = plugin.hooks.get('before_model_resolve')
    if (warm === undefined) throw new Error('before_model_resolve hook was not registered')
    await warm({ prompt: 'OpenClaw conformance' }, { ...context, runId })
    if (state.control === undefined || state.actorIdentity === undefined || state.capabilities === undefined || state.runtimeSessionId === undefined) {
      throw new Error(`OpenClaw conformance fixture did not activate: ${plugin.diagnostics.join('\n')}`)
    }
    const nativeNames = Object.freeze(Object.fromEntries(
      prepared.tools.map(tool => [tool.descriptor.name, tool.nativeName]),
    )) as Readonly<Record<ConformanceToolName, string>>
    const admissions = new Map<string, OpenClawBeforeToolCallResult | undefined>()
    const invokeBeforeTool = (
      tool: AnyAgentTool,
      callId: string,
      params: Record<string, unknown>,
      abortSignal?: AbortSignal,
    ): OpenClawBeforeToolCallResult | undefined => {
      const hook = plugin.hooks.get('before_tool_call')
      if (hook === undefined) throw new Error('before_tool_call hook was not registered')
      const event: OpenClawBeforeToolCallEvent = {
        toolName: tool.name,
        params,
        runId,
        toolCallId: callId,
      }
      const hookContext: OpenClawToolHookContext = {
        toolName: tool.name,
        agentId,
        sessionKey,
        sessionId: nativeSessionId,
        runId,
        toolCallId: callId,
        ...(abortSignal === undefined ? {} : { abortSignal }),
      }
      const result = hook(event, hookContext) as OpenClawBeforeToolCallResult | undefined
      admissions.set(callId, result)
      return result
    }
    const invokeNativeTool = async (
      tool: AnyAgentTool,
      callId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<ToolInvocationResult> => {
      const result = await toolExecute(tool)(callId, params, signal)
      if (result === null || typeof result !== 'object' || !('details' in result)) {
        throw new Error(`native tool ${tool.name} did not return adapter result details`)
      }
      const details = result.details
      if (details === null || typeof details !== 'object' || !('ok' in details) || typeof details.ok !== 'boolean') {
        throw new Error(`native tool ${tool.name} returned invalid adapter result details`)
      }
      return details as ToolInvocationResult
    }
    return {
      prepared,
      plugin,
      state,
      nativeNames,
      context,
      runId,
      actorIdentity: state.actorIdentity,
      capabilities: state.capabilities,
      runtimeSessionId: state.runtimeSessionId,
      portableSnapshot: () => state.control!.snapshot(),
      nativeTools: () => toolsFromFactory(plugin, context),
      nativeTool(name) {
        const nativeName = nativeNames[name]
        const tool = toolsFromFactory(plugin, context).find(candidate => candidate.name === nativeName)
        if (tool === undefined) throw new Error(`native projection is missing ${name}`)
        return tool
      },
      async registerSet(ownerId, definitions) {
        if (disposed) throw new Error('OpenClaw conformance harness is disposed')
        const registration = state.control!.registerSet(ownerId, definitions)
        return Object.freeze({
          async replace(next: readonly RuntimeHostConformanceTool[]) { registration.replace(next) },
          dispose: () => registration.dispose(),
        })
      },
      beforeTool(tool, callId, params, abortSignal) {
        return invokeBeforeTool(tool, callId, params, abortSignal)
      },
      async execute(tool, callId, params, signal) {
        const admission = admissions.has(callId)
          ? admissions.get(callId)
          : invokeBeforeTool(tool, callId, params, signal)
        admissions.delete(callId)
        if (admission?.block === true) throw new Error(admission.blockReason ?? 'native tool call blocked')
        return invokeNativeTool(tool, callId, params, signal)
      },
      executeRetained(tool, callId, params, signal) {
        return invokeNativeTool(tool, callId, params, signal)
      },
      waitForCall(callId) { return state.control!.waitForCall(callId) },
      releaseCall(callId) { state.control!.releaseCall(callId) },
      requireLifecycle(eventType) { state.control!.requireLifecycle(eventType) },
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

export async function waitForConformance(
  predicate: () => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await delay(10)
  }
}
