import type {
  OpenClawPluginConfigSchema,
  OpenClawPluginDefinition,
} from 'openclaw/plugin-sdk/core'
import { createPluginRuntimeStore } from 'openclaw/plugin-sdk/runtime-store'
import { OpenClawAdapter } from './adapter.ts'
import type { PreparedCatalog } from './catalog.ts'
import {
  createStandardOpenClawHostExtensionRuntime,
  type OpenClawHostExtensionRuntime,
} from './host-extensions.ts'
import { OPENCLAW_CONFIG_SCHEMA, normalizeOpenClawOptions, type OpenClawOptions } from './options.ts'

export const OPENCLAW_PLUGIN_CONFIG_SCHEMA: OpenClawPluginConfigSchema = Object.freeze({
  jsonSchema: OPENCLAW_CONFIG_SCHEMA,
  safeParse(value: unknown) {
    try {
      return { success: true, data: normalizeOpenClawOptions(value) }
    } catch (error) {
      return {
        success: false,
        error: {
          issues: [{ path: [], message: error instanceof Error ? error.message : String(error) }],
        },
      }
    }
  },
})

interface SharedDeployment {
  readonly adapter: OpenClawAdapter
  readonly fullLeases: Set<symbol>
}

class SharedOpenClawRuntime {
  readonly #deployments = new Map<string, SharedDeployment>()

  get empty(): boolean {
    return this.#deployments.size === 0
  }

  adapter(key: string, create: () => OpenClawAdapter): OpenClawAdapter {
    let deployment = this.#deployments.get(key)
    if (deployment === undefined) {
      deployment = { adapter: create(), fullLeases: new Set() }
      this.#deployments.set(key, deployment)
    }
    return deployment.adapter
  }

  acquireFullLease(key: string, adapter: OpenClawAdapter): () => Promise<void> {
    const deployment = this.#deployments.get(key)
    if (deployment?.adapter !== adapter) {
      throw new Error('OpenClaw shared Runtime deployment changed before its full-registry lease was acquired')
    }
    const token = Symbol('OpenClaw full-registry lease')
    deployment.fullLeases.add(token)
    let releasePromise: Promise<void> | undefined
    return () => {
      releasePromise ??= (async () => {
        deployment.fullLeases.delete(token)
        if (deployment.fullLeases.size !== 0 || this.#deployments.get(key) !== deployment) return
        this.#deployments.delete(key)
        await deployment.adapter.dispose()
      })()
      return releasePromise
    }
  }

  async retireSession(sessionKey: string): Promise<void> {
    const results = await Promise.allSettled(
      [...this.#deployments.values()].map(deployment => deployment.adapter.retireSession(sessionKey)),
    )
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'OpenClaw shared Runtime Session cleanup failed')
  }
}

const SHARED_RUNTIME = createPluginRuntimeStore<SharedOpenClawRuntime>({
  key: 'doppelganger.openclaw.runtime-owner.v1',
  errorMessage: 'OpenClaw shared Doppelganger Runtime is not initialized',
})

function sharedRuntime(): SharedOpenClawRuntime {
  let runtime = SHARED_RUNTIME.tryGetRuntime()
  if (runtime === null) {
    runtime = new SharedOpenClawRuntime()
    SHARED_RUNTIME.setRuntime(runtime)
  }
  return runtime
}

function adapterKey(prepared: PreparedCatalog, hostExtensions: OpenClawHostExtensionRuntime, options: OpenClawOptions): string {
  return `${prepared.fingerprint}\u0000${hostExtensions.prepared.fingerprint}\u0000${JSON.stringify(options)}`
}

function clearReleasedRuntime(runtime: SharedOpenClawRuntime, release: () => Promise<void>): () => Promise<void> {
  let releasePromise: Promise<void> | undefined
  return () => {
    releasePromise ??= release().finally(() => {
      if (runtime.empty && SHARED_RUNTIME.tryGetRuntime() === runtime) SHARED_RUNTIME.clearRuntime()
    })
    return releasePromise
  }
}

export function createOpenClawPlugin(
  prepared: PreparedCatalog,
  hostExtensions: OpenClawHostExtensionRuntime = createStandardOpenClawHostExtensionRuntime(),
): OpenClawPluginDefinition {
  return Object.freeze({
    id: 'doppelganger',
    name: 'Doppelganger',
    description: 'Portable Doppelganger Runtime Presets for OpenClaw',
    configSchema: OPENCLAW_PLUGIN_CONFIG_SCHEMA,
    register(api) {
      if (api.registrationMode !== 'full'
        && api.registrationMode !== 'discovery'
        && api.registrationMode !== 'tool-discovery') return

      const registerTools = (factory: Parameters<typeof api.registerTool>[0]) => {
        api.registerTool(factory, {
          names: prepared.tools.map(tool => tool.nativeName),
          optional: true,
        })
      }

      const options = normalizeOpenClawOptions(api.pluginConfig)
      const runtime = sharedRuntime()
      const key = adapterKey(prepared, hostExtensions, options)
      const adapter = runtime.adapter(key, () => new OpenClawAdapter(prepared, options, api.logger, hostExtensions))
      if (api.registrationMode === 'tool-discovery') {
        registerTools(context => adapter.tools(context))
        return
      }

      api.on('before_model_resolve', async (_event, context) => {
        try {
          await adapter.warm(context)
        } catch (error) {
          api.logger.warn(
            `Doppelganger warmup did not complete; OpenClaw may continue without Doppelganger: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }, { timeoutMs: Math.min(120_000, options.warmupTimeoutMs + 1_000) })

      api.on('before_prompt_build', (event, context) => adapter.projectContext(event, context))
      const beforeTool = (
        event: Parameters<OpenClawAdapter['beforeToolCall']>[0],
        context: Parameters<OpenClawAdapter['beforeToolCall']>[1],
      ) => adapter.beforeToolCall(event, context)
      if (prepared.tools.length === 0) api.on('before_tool_call', beforeTool)
      else api.on('before_tool_call', beforeTool, {
        matcher: prepared.tools.map(tool => tool.nativeName) as [string, ...string[]],
      })
      api.on('before_reset', async (_event, context) => {
        if (context.sessionKey !== undefined) await runtime.retireSession(context.sessionKey)
      })
      api.on('session_end', async (_event, context) => {
        if (context.sessionKey !== undefined) await runtime.retireSession(context.sessionKey)
      })

      registerTools(context => adapter.tools(context))

      if (api.registrationMode === 'full') {
        const release = clearReleasedRuntime(runtime, runtime.acquireFullLease(key, adapter))
        api.registerService({
          id: 'doppelganger-runtime-owner',
          start() {},
          stop: release,
        })
        api.lifecycle.registerRuntimeLifecycle({
          id: 'doppelganger-runtime',
          description: 'Owns Doppelganger Runtime Sessions and pending activations',
          cleanup: async context => {
            if (context.sessionKey !== undefined) await runtime.retireSession(context.sessionKey)
            else await release()
          },
        })
      }
    },
  })
}
