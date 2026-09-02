import { createHash } from 'node:crypto'
import type { Fiber, Plugin } from '@deepseek-ai/cordis'
import type { JsonValue } from '@doppelganger/doppelganger-protocols'
import type { NormalizedDynamicRuntimePluginsConfig } from './config.ts'
import { errorMessage, errorStack, RuntimePluginError } from './errors.ts'
import { evaluatePackage, precheckSource } from './evaluator.ts'
import { approvedInjectNames, guardPlugin } from './guard.ts'
import type {
  RuntimePluginDefineInput,
  RuntimePluginDiagnostic,
  RuntimePluginDiagnosticPhase,
  RuntimePluginPackage,
  RuntimePluginRecord,
  RuntimePluginRun,
  RuntimePluginRunInput,
} from './types.ts'

function digest(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`
}

function frozenDiagnostic(
  config: NormalizedDynamicRuntimePluginsConfig,
  input: Omit<RuntimePluginDiagnostic, 'message' | 'stack'> & { message: string; stack?: string },
): RuntimePluginDiagnostic {
  const message = input.message.slice(0, config.maximumDiagnosticMessageLength)
  const stack = input.stack?.slice(0, config.maximumDiagnosticStackLength)
  return Object.freeze({
    pluginId: input.pluginId,
    packageId: input.packageId,
    runId: input.runId,
    phase: input.phase,
    message,
    ...(stack === undefined ? {} : { stack }),
  })
}

function diagnosticData(diagnostic: RuntimePluginDiagnostic): JsonValue {
  return {
    pluginId: diagnostic.pluginId,
    packageId: diagnostic.packageId,
    runId: diagnostic.runId,
    phase: diagnostic.phase,
    message: diagnostic.message,
    ...(diagnostic.stack === undefined ? {} : { stack: diagnostic.stack }),
  }
}

function packageData(definition: RuntimePluginPackage, includeSource = false): JsonValue {
  return {
    packageId: definition.packageId,
    name: definition.name,
    purpose: definition.purpose,
    sourceDigest: definition.sourceDigest,
    sourceBytes: definition.sourceBytes,
    ...(includeSource ? { source: definition.source } : {}),
  }
}

function phaseError(code: string, diagnostic: RuntimePluginDiagnostic): RuntimePluginError {
  return new RuntimePluginError(code, diagnostic.message, diagnosticData(diagnostic))
}

export class DynamicRuntimePluginRegistry {
  private readonly plugins = new Map<string, RuntimePluginRecord>()
  private readonly transitioning = new Set<string>()
  private readonly group: Fiber
  private readonly disposalDiagnostics = new WeakMap<Fiber, RuntimePluginDiagnostic>()
  private readonly config: NormalizedDynamicRuntimePluginsConfig
  private nextPlugin = 1
  private nextPackage = 1
  private nextRun = 1
  private storedSourceBytes = 0
  private mutationQueue = Promise.resolve()
  private disposing = false
  private disposalTask: Promise<void> | undefined

  constructor(group: Fiber, config: NormalizedDynamicRuntimePluginsConfig) {
    this.group = group
    this.config = config
    group.ctx.on('internal/status', fiber => {
      for (const plugin of this.plugins.values()) {
        const run = plugin.activeRun
        if (run?.fiber === fiber) this.refreshRunState(plugin, run)
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.disposing) {
      return Promise.reject(new RuntimePluginError('REGISTRY_DISPOSED', 'runtime plugin registry is disposing'))
    }
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private plugin(pluginId: string): RuntimePluginRecord {
    const plugin = this.plugins.get(pluginId)
    if (plugin === undefined) {
      throw new RuntimePluginError('PLUGIN_NOT_FOUND', `runtime Plugin "${pluginId}" was not found`)
    }
    return plugin
  }

  private package(plugin: RuntimePluginRecord, packageId: string): RuntimePluginPackage {
    const definition = plugin.packages.get(packageId)
    if (definition === undefined) {
      throw new RuntimePluginError(
        'PACKAGE_NOT_FOUND',
        `runtime Package "${packageId}" does not belong to Plugin "${plugin.pluginId}"`,
      )
    }
    return definition
  }

  private refreshRunState(plugin: RuntimePluginRecord, run: RuntimePluginRun): void {
    const waitingFor = Object.keys(run.fiber.inject).filter(name => this.group.ctx.get(name) === undefined)
    run.waitingFor = Object.freeze(waitingFor)
    if (waitingFor.length > 0) {
      plugin.latestDiagnostic = frozenDiagnostic(this.config, {
        pluginId: plugin.pluginId,
        packageId: run.packageId,
        runId: run.runId,
        phase: 'waiting',
        message: `waiting for approved services: ${waitingFor.join(', ')}`,
      })
    } else if (plugin.latestDiagnostic?.phase === 'waiting' && plugin.latestDiagnostic.runId === run.runId) {
      delete plugin.latestDiagnostic
    }
  }

  private inspection(value: JsonValue): JsonValue {
    const serialized = JSON.stringify(value)
    const bytes = Buffer.byteLength(serialized, 'utf8')
    if (bytes > this.config.maximumInspectionBytes) {
      throw new RuntimePluginError(
        'INSPECTION_LIMIT_EXCEEDED',
        `inspection output exceeds ${this.config.maximumInspectionBytes} bytes`,
      )
    }
    return JSON.parse(serialized)
  }

  define(input: RuntimePluginDefineInput): Promise<JsonValue> {
    return this.enqueue(() => {
      const name = input.name.trim()
      const purpose = input.purpose.trim()
      if (name.length === 0 || name.length > this.config.maximumNameLength) {
        throw new RuntimePluginError('INVALID_INPUT', `name must contain 1-${this.config.maximumNameLength} characters`)
      }
      if (purpose.length === 0 || purpose.length > this.config.maximumPurposeLength) {
        throw new RuntimePluginError(
          'INVALID_INPUT',
          `purpose must contain 1-${this.config.maximumPurposeLength} characters`,
        )
      }
      let sourceBytes: number
      try {
        sourceBytes = precheckSource(input.source, this.config.maximumSourceBytes)
      } catch (cause) {
        throw new RuntimePluginError('SOURCE_PARSE_FAILED', errorMessage(cause), { phase: 'parse' })
      }
      if (this.storedSourceBytes + sourceBytes > this.config.maximumTotalSourceBytes) {
        throw new RuntimePluginError(
          'REGISTRY_LIMIT_EXCEEDED',
          `stored source would exceed ${this.config.maximumTotalSourceBytes} bytes`,
        )
      }

      let plugin: RuntimePluginRecord
      if (input.plugin.kind === 'new') {
        if (this.plugins.size >= this.config.maximumPlugins) {
          throw new RuntimePluginError(
            'REGISTRY_LIMIT_EXCEEDED',
            `registry supports at most ${this.config.maximumPlugins} Plugins`,
          )
        }
        const prefix = input.plugin.idPrefix.trim()
        if (!/^[a-z][a-z0-9-]{2,31}$/.test(prefix)) {
          throw new RuntimePluginError('INVALID_INPUT', 'idPrefix must be 3-32 lowercase semantic characters')
        }
        plugin = { pluginId: `${prefix}-${this.nextPlugin++}`, packages: new Map() }
      } else {
        plugin = this.plugin(input.plugin.pluginId)
      }
      if (plugin.packages.size >= this.config.maximumPackagesPerPlugin) {
        throw new RuntimePluginError(
          'REGISTRY_LIMIT_EXCEEDED',
          `Plugin supports at most ${this.config.maximumPackagesPerPlugin} Packages`,
        )
      }

      const packageId = `pkg-${this.nextPackage++}`
      const definition = Object.freeze({
        packageId,
        name,
        purpose,
        source: input.source,
        sourceDigest: digest(input.source),
        sourceBytes,
      })
      plugin.packages.set(packageId, definition)
      if (input.plugin.kind === 'new') this.plugins.set(plugin.pluginId, plugin)
      this.storedSourceBytes += sourceBytes
      return Object.freeze({
        pluginId: plugin.pluginId,
        packageId,
        name,
        purpose,
        sourceDigest: definition.sourceDigest,
      })
    })
  }

  inspect(pluginId?: string, packageId?: string): JsonValue {
    if (packageId !== undefined && pluginId === undefined) {
      throw new RuntimePluginError('INVALID_INPUT', 'packageId requires its owning pluginId')
    }
    if (pluginId === undefined) {
      return this.inspection(Object.freeze({
        plugins: Object.freeze([...this.plugins.values()].map(plugin => Object.freeze({
          pluginId: plugin.pluginId,
          packageCount: plugin.packages.size,
          ...(plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId }),
          ...(plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId }),
          running: plugin.activeRun !== undefined,
        }))),
      }))
    }
    const plugin = this.plugin(pluginId)
    if (plugin.activeRun !== undefined) this.refreshRunState(plugin, plugin.activeRun)
    const common = {
      pluginId,
      ...(plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId }),
      ...(plugin.nextPackageId === undefined ? {} : { nextPackageId: plugin.nextPackageId }),
      ...(plugin.activeRun === undefined ? {} : { activeRun: {
        runId: plugin.activeRun.runId,
        packageId: plugin.activeRun.packageId,
        waitingFor: plugin.activeRun.waitingFor,
      } }),
      ...(plugin.latestDiagnostic === undefined ? {} : {
        latestDiagnostic: diagnosticData(plugin.latestDiagnostic),
      }),
    }
    if (packageId === undefined) {
      return this.inspection(Object.freeze({
        ...common,
        packages: Object.freeze([...plugin.packages.values()].map(definition => packageData(definition))),
      }))
    }
    const definition = this.package(plugin, packageId)
    return this.inspection(Object.freeze({ ...common, package: packageData(definition, true) }))
  }

  private diagnostic(
    plugin: RuntimePluginRecord,
    definition: RuntimePluginPackage,
    runId: string,
    phase: RuntimePluginDiagnosticPhase,
    cause: unknown,
  ): RuntimePluginDiagnostic {
    const stack = errorStack(cause)
    const diagnostic = frozenDiagnostic(this.config, {
      pluginId: plugin.pluginId,
      packageId: definition.packageId,
      runId,
      phase,
      message: errorMessage(cause),
      ...(stack === undefined ? {} : { stack }),
    })
    plugin.latestDiagnostic = diagnostic
    return diagnostic
  }

  private validateTransition(
    plugin: RuntimePluginRecord,
    definition: RuntimePluginPackage,
    input: RuntimePluginRunInput,
  ): void {
    if (
      definition.name !== input.name
      || definition.purpose !== input.purpose
      || definition.sourceDigest !== input.sourceDigest
    ) {
      throw new RuntimePluginError(
        'PACKAGE_METADATA_MISMATCH',
        'approved Package metadata does not match the immutable definition',
      )
    }
    if (input.mode === 'run') {
      if (plugin.currentPackageId !== undefined && plugin.currentPackageId !== definition.packageId) {
        throw new RuntimePluginError(
          'INVALID_TRANSITION',
          'mode "run" may target only the current known-good Package',
        )
      }
    } else if (plugin.currentPackageId === undefined || plugin.currentPackageId === definition.packageId) {
      throw new RuntimePluginError(
        'INVALID_TRANSITION',
        'mode "update" requires a different Package and an existing current Package',
      )
    }
  }

  private async disposeRun(plugin: RuntimePluginRecord): Promise<void> {
    const run = plugin.activeRun
    delete plugin.activeRun
    if (run === undefined) return
    await run.fiber.dispose()
    const diagnostic = this.disposalDiagnostics.get(run.fiber)
    this.disposalDiagnostics.delete(run.fiber)
    if (diagnostic !== undefined) throw phaseError('RUN_DISPOSAL_FAILED', diagnostic)
  }

  run(input: RuntimePluginRunInput): Promise<JsonValue> {
    if (this.transitioning.has(input.pluginId)) {
      return Promise.reject(new RuntimePluginError(
        'TRANSITION_IN_PROGRESS',
        `runtime Plugin "${input.pluginId}" already has an activation transition in progress`,
      ))
    }
    this.transitioning.add(input.pluginId)
    const result = this.enqueue(async () => {
      const plugin = this.plugin(input.pluginId)
      const definition = this.package(plugin, input.packageId)
      this.validateTransition(plugin, definition, input)
      const runId = `run-${this.nextRun++}`
      plugin.nextPackageId = definition.packageId

      let evaluated: Plugin
      try {
        evaluated = await evaluatePackage(definition.packageId, definition.source, this.config)
        approvedInjectNames(evaluated)
      } catch (cause) {
        const diagnostic = this.diagnostic(plugin, definition, runId, 'evaluation', cause)
        throw phaseError('PACKAGE_EVALUATION_FAILED', diagnostic)
      }

      if (plugin.activeRun !== undefined) await this.disposeRun(plugin)
      let guardDiagnostic: RuntimePluginDiagnostic | undefined
      let fiber: Fiber | undefined
      const guarded = guardPlugin(
        evaluated,
        cause => {
          guardDiagnostic = this.diagnostic(plugin, definition, runId, 'guard', cause)
        },
        cause => {
          const diagnostic = this.diagnostic(plugin, definition, runId, 'disposal', cause)
          if (fiber !== undefined) this.disposalDiagnostics.set(fiber, diagnostic)
        },
      )
      fiber = this.group.ctx.plugin(guarded)
      try {
        await fiber.await()
      } catch (cause) {
        await fiber.dispose()
        const diagnostic = guardDiagnostic ?? this.diagnostic(plugin, definition, runId, 'apply', cause)
        throw phaseError('PACKAGE_APPLY_FAILED', diagnostic)
      }

      const waitingFor = approvedInjectNames(evaluated).filter(name => this.group.ctx.get(name) === undefined)
      const run: RuntimePluginRun = {
        runId,
        packageId: definition.packageId,
        fiber,
        waitingFor: Object.freeze(waitingFor),
      }
      plugin.activeRun = run
      plugin.currentPackageId = definition.packageId
      delete plugin.nextPackageId
      if (waitingFor.length > 0) {
        plugin.latestDiagnostic = frozenDiagnostic(this.config, {
          pluginId: plugin.pluginId,
          packageId: definition.packageId,
          runId,
          phase: 'waiting',
          message: `waiting for approved services: ${waitingFor.join(', ')}`,
        })
      } else if (guardDiagnostic === undefined) {
        delete plugin.latestDiagnostic
      } else {
        plugin.latestDiagnostic = guardDiagnostic
      }
      return Object.freeze({
        pluginId: plugin.pluginId,
        packageId: definition.packageId,
        runId,
        status: waitingFor.length === 0 ? 'running' : 'waiting',
        ...(waitingFor.length === 0 ? {} : { waitingFor: Object.freeze(waitingFor) }),
      })
    })
    return result.finally(() => { this.transitioning.delete(input.pluginId) })
  }

  stop(pluginId: string): Promise<JsonValue> {
    return this.enqueue(async () => {
      const plugin = this.plugin(pluginId)
      const wasRunning = plugin.activeRun !== undefined
      await this.disposeRun(plugin)
      return Object.freeze({ pluginId, stopped: true, wasRunning })
    })
  }

  undefine(pluginId: string): Promise<JsonValue> {
    return this.enqueue(async () => {
      const plugin = this.plugin(pluginId)
      const wasRunning = plugin.activeRun !== undefined
      await this.disposeRun(plugin)
      for (const definition of plugin.packages.values()) this.storedSourceBytes -= definition.sourceBytes
      this.plugins.delete(pluginId)
      return Object.freeze({ pluginId, removed: true, wasRunning })
    })
  }

  dispose(): Promise<void> {
    this.disposing = true
    return this.disposalTask ??= this.mutationQueue.then(async () => {
      const errors: unknown[] = []
      for (const plugin of [...this.plugins.values()]) {
        try {
          await this.disposeRun(plugin)
        } catch (cause) {
          errors.push(cause)
        }
      }
      this.plugins.clear()
      this.storedSourceBytes = 0
      if (errors.length > 0) throw new AggregateError(errors, 'dynamic runtime plugin cleanup failed')
    })
  }
}
