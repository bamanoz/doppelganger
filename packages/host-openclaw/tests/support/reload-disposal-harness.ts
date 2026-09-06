import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnyAgentTool, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core'
import type {
  OpenClawAgentContext,
  OpenClawBeforeToolCallEvent,
  OpenClawToolHookContext,
} from '../../src/adapter.ts'
import { prepareCatalog, type PreparedCatalog } from '../../src/catalog.ts'
import { createOpenClawPlugin } from '../../src/plugin.ts'

type Deferred = PromiseWithResolvers<void>

export interface ReloadDisposalBinding {
  readonly actorId: string
  readonly agentId: string
  readonly sessionKey: string
  readonly sessionId: string
}

export interface ReloadDisposalState {
  readonly applications: Array<{ actorId: string; application: number; generation: string }>
  readonly applicationCounts: Map<string, number>
  readonly calls: Array<{ actorId: string; callId: string; generation: string; name: string }>
  readonly registrations: Array<{ actorId: string; generation: string; names: readonly string[] }>
  readonly activationStarted: Map<string, Deferred>
  readonly activationRelease: Map<string, Deferred>
  readonly callStarted: Map<string, Deferred>
  readonly callCancelled: Map<string, Deferred>
  readonly callRelease: Map<string, Deferred>
  readonly lateCallbackRelease: Map<string, Deferred>
  readonly latestLateCallback: Map<string, string>
  readonly heldActivations: Set<string>
  readonly restorationFailures: Set<string>
  readonly throwingDisposers: Set<string>
  readonly resumedActivations: string[]
  readonly cancelledCalls: string[]
  readonly settledCalls: string[]
  readonly cleanupStages: string[]
  readonly lateCallbackAttempts: string[]
  readonly lateCallbackOutcomes: Array<{ callbackId: string; outcome: string }>
}

export type ReloadDisposalContext = OpenClawPluginToolContext & OpenClawAgentContext

interface RegisteredPlugin {
  readonly hooks: Map<string, Function>
  readonly diagnostics: string[]
  readonly toolFactory: ((context: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined) | undefined
  readonly cleanup: ((context: {
    reason: 'disable' | 'reset' | 'delete' | 'restart'
    sessionKey?: string
    runId?: string
  }) => Promise<void> | void) | undefined
  readonly service: { start(): void | Promise<void>; stop?(): void | Promise<void> } | undefined
}

export interface ReloadDisposalHarness {
  readonly root: string
  readonly workspaceRoot: string
  readonly loaderPath: string
  readonly state: ReloadDisposalState
  readonly prepared: PreparedCatalog
  readonly plugin: RegisteredPlugin
  readonly nativeNames: Readonly<Record<string, string>>
  context(binding: ReloadDisposalBinding, overrides?: Partial<ReloadDisposalContext>): ReloadDisposalContext
  writeGeneration(generation: string): Promise<void>
  warm(context: ReloadDisposalContext): Promise<void>
  tools(context: ReloadDisposalContext): AnyAgentTool[]
  beforeTool(tool: AnyAgentTool, callId: string, params: Record<string, unknown>, context: ReloadDisposalContext): Promise<unknown>
  invoke(tool: AnyAgentTool, callId: string, params: Record<string, unknown>, context: ReloadDisposalContext): Promise<unknown>
  cleanup(sessionKey?: string): Promise<void>
  waitForActivation(actorId: string): Promise<void>
  releaseActivation(actorId: string): void
  waitForCall(callId: string): Promise<void>
  waitForCancellation(callId: string): Promise<void>
  releaseCall(callId: string): void
  releaseLatestLateCallback(actorId: string): string
  dispose(): Promise<void>
}

const PREPARED_DESCRIPTORS = [
  {
    name: 'reload.probe',
    label: 'Reload Probe',
    description: 'Reports the Loader generation captured by this native closure',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'string' } },
    },
    available: true,
  },
  {
    name: 'reload.hold',
    label: 'Reload Hold',
    description: 'Remains active after cancellation until the fixture releases it',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    available: true,
  },
] as const

function gate(map: Map<string, Deferred>, id: string): Deferred {
  let current = map.get(id)
  if (current === undefined) {
    current = Promise.withResolvers<void>()
    map.set(id, current)
  }
  return current
}

function state(): ReloadDisposalState {
  return {
    applications: [],
    applicationCounts: new Map(),
    calls: [],
    registrations: [],
    activationStarted: new Map(),
    activationRelease: new Map(),
    callStarted: new Map(),
    callCancelled: new Map(),
    callRelease: new Map(),
    lateCallbackRelease: new Map(),
    latestLateCallback: new Map(),
    heldActivations: new Set(),
    restorationFailures: new Set(),
    throwingDisposers: new Set(),
    resumedActivations: [],
    cancelledCalls: [],
    settledCalls: [],
    cleanupStages: [],
    lateCallbackAttempts: [],
    lateCallbackOutcomes: [],
  }
}

function pluginHarness(prepared: PreparedCatalog, pluginConfig: Record<string, unknown>): RegisteredPlugin {
  const hooks = new Map<string, Function>()
  const diagnostics: string[] = []
  let toolFactory: RegisteredPlugin['toolFactory']
  let cleanup: RegisteredPlugin['cleanup']
  let service: RegisteredPlugin['service']
  createOpenClawPlugin(prepared).register?.({
    registrationMode: 'full',
    pluginConfig,
    logger: {
      debug(message: string) { diagnostics.push(message) },
      info(message: string) { diagnostics.push(message) },
      warn(message: string) { diagnostics.push(message) },
      error(message: string) { diagnostics.push(message) },
    },
    on(name: string, handler: Function) { hooks.set(name, handler) },
    registerTool(factory: RegisteredPlugin['toolFactory']) { toolFactory = factory },
    registerService(registration: NonNullable<RegisteredPlugin['service']>) { service = registration },
    lifecycle: {
      registerRuntimeLifecycle(registration: { cleanup?: RegisteredPlugin['cleanup'] }) {
        cleanup = registration.cleanup
      },
    },
  } as never)
  if (service === undefined) throw new Error('OpenClaw plugin service was not registered')
  void service.start()
  return {
    hooks,
    diagnostics,
    get toolFactory() { return toolFactory },
    get cleanup() { return cleanup },
    get service() { return service },
  }
}

export async function createReloadDisposalHarness(options: {
  readonly bindings: readonly ReloadDisposalBinding[]
  readonly warmupTimeoutMs?: number
}): Promise<ReloadDisposalHarness> {
  const root = await mkdtemp(join(tmpdir(), 'doppelganger-openclaw-reload-disposal-'))
  const home = join(root, 'home')
  const workspaceRoot = join(root, 'workspace')
  const presetRoot = join(root, 'presets')
  const preset = join(presetRoot, 'reload-disposal')
  const loaderPath = join(preset, 'runtime.cordis.yml')
  const packageScope = join(root, 'node_modules', '@doppelganger')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(preset, { recursive: true }),
    mkdir(packageScope, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(workspaceRoot, '.git'), ''),
    symlink(
      fileURLToPath(new URL('../../../extension-protocols', import.meta.url)),
      join(packageScope, 'doppelganger-protocols'),
      'dir',
    ),
    symlink(
      fileURLToPath(new URL('./reload-disposal-fixture.mjs', import.meta.url)),
      join(preset, 'reload-disposal-fixture.mjs'),
    ),
  ])
  const stateKey = `__doppelgangerOpenClawReloadDisposal${Date.now()}${Math.random().toString(16).slice(2)}`
  const fixtureState = state()
  Object.defineProperty(globalThis, stateKey, { value: fixtureState, configurable: true })
  const prepared = prepareCatalog('reload-disposal', {
    revision: 'catalog:prepared',
    tools: PREPARED_DESCRIPTORS.map((descriptor, index) => ({ ...descriptor, revision: `prepared:${index}` })),
  })
  const plugin = pluginHarness(prepared, {
    roster: {
      home,
      defaultRuntimePreset: 'reload-disposal',
      roots: [{ path: presetRoot, trust: 'system' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    },
    warmupTimeoutMs: options.warmupTimeoutMs ?? 5_000,
    contextTokenBudget: 1_000,
    actors: options.bindings.map(binding => ({
      agentId: binding.agentId,
      sessionKey: binding.sessionKey,
      workspaceRoot,
      actorId: binding.actorId,
    })),
  })
  const nativeNames = Object.freeze(Object.fromEntries(
    prepared.tools.map(tool => [tool.descriptor.name, tool.nativeName]),
  ))
  const writeGeneration = (generation: string) => writeFile(loaderPath, JSON.stringify([
    {
      id: 'tools',
      name: '@doppelganger/doppelganger-protocols/tools',
      isolate: { doppelgangerTools: 'session' },
    },
    {
      id: 'fixture',
      name: './reload-disposal-fixture.mjs',
      config: { stateKey, generation },
      isolate: { doppelgangerActor: 'session', doppelgangerTools: 'session' },
    },
  ]))
  await writeGeneration('one')
  const beforeTool = async (
    tool: AnyAgentTool,
    callId: string,
    params: Record<string, unknown>,
    context: ReloadDisposalContext,
  ): Promise<unknown> => {
    const hook = plugin.hooks.get('before_tool_call')
    if (hook === undefined) throw new Error('before_tool_call hook was not registered')
    const event: OpenClawBeforeToolCallEvent = {
      toolName: tool.name,
      params,
      toolCallId: callId,
      ...(context.runId === undefined ? {} : { runId: context.runId }),
    }
    const hookContext: OpenClawToolHookContext = {
      toolName: tool.name,
      toolCallId: callId,
      ...(context.agentId === undefined ? {} : { agentId: context.agentId }),
      ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      ...(context.runId === undefined ? {} : { runId: context.runId }),
    }
    return hook(event, hookContext)
  }

  return {
    root,
    workspaceRoot,
    loaderPath,
    state: fixtureState,
    prepared,
    plugin,
    nativeNames,
    context(binding, overrides = {}) {
      return {
        agentId: binding.agentId,
        sessionKey: binding.sessionKey,
        sessionId: binding.sessionId,
        workspaceDir: workspaceRoot,
        runId: `run-${binding.actorId}`,
        ...overrides,
      }
    },
    writeGeneration,
    async warm(context) {
      const hook = plugin.hooks.get('before_model_resolve')
      if (hook === undefined) throw new Error('before_model_resolve hook was not registered')
      await hook({ prompt: 'reload/disposal fixture prompt' }, context)
    },
    tools(context) {
      const resolved = plugin.toolFactory?.(context)
      if (resolved == null) return []
      return Array.isArray(resolved) ? resolved : [resolved]
    },
    beforeTool,
    async invoke(tool, callId, params, context) {
      const hookResult = await beforeTool(tool, callId, params, context) as {
        block?: boolean
        blockReason?: string
      } | undefined
      if (hookResult?.block) throw new Error(hookResult.blockReason ?? 'native before-tool hook blocked the call')
      return tool.execute(callId, params)
    },
    async cleanup(sessionKey) {
      await plugin.cleanup?.({ reason: sessionKey === undefined ? 'disable' : 'reset', ...(sessionKey === undefined ? {} : { sessionKey }) })
    },
    waitForActivation(actorId) { return gate(fixtureState.activationStarted, actorId).promise },
    releaseActivation(actorId) { gate(fixtureState.activationRelease, actorId).resolve() },
    waitForCall(callId) { return gate(fixtureState.callStarted, callId).promise },
    waitForCancellation(callId) { return gate(fixtureState.callCancelled, callId).promise },
    releaseCall(callId) { gate(fixtureState.callRelease, callId).resolve() },
    releaseLatestLateCallback(actorId) {
      const callbackId = fixtureState.latestLateCallback.get(actorId)
      if (callbackId === undefined) throw new Error(`no late callback is registered for ${actorId}`)
      gate(fixtureState.lateCallbackRelease, callbackId).resolve()
      return callbackId
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
    const deferred = Promise.withResolvers<void>()
    setTimeout(deferred.resolve, 10)
    await deferred.promise
  }
}
