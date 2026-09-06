import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Inject, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { loadRuntimePresetEntries, resolveRuntimePresetImport } from '@doppelganger/doppelganger-runtime-presets'
import {
  CompositionActivationError,
  activationFailures,
  failedCompositionDiagnostics,
  inspectCompositionTree,
  type CompositionDiagnostics,
} from './activation-audit.ts'
import type { CompositionDefinition } from './definition.ts'
import {
  defineCompositionPatchLayer,
  loadCompositionPatchFile,
  prepareComposition,
  type CompositionPatchLayer,
} from './patches.ts'
import {
  createRuntimeSessionMetadata,
  createRuntimeSessionMetadataPlugin,
} from './session-metadata.ts'
import { RUNTIME_LOGGING_SERVICE, RuntimeLoggingRouter } from './runtime-logging.ts'

const runtimeOwnerPlugin: Plugin = { name: 'doppelganger-composition-runtime-owner', apply: () => undefined }
const sessionOwnerPlugin: Plugin = { name: 'doppelganger-composition-session-owner', apply: () => undefined }
const RUNTIME_METADATA_IMPORT = 'doppelganger-runtime-session'
const RUNTIME_METADATA_ENTRY = 'doppelganger-runtime-session-metadata'
let nextSessionNamespace = 0

export interface CompositionWatchOptions {
  readonly base?: string
  readonly root?: readonly string[]
  readonly debounce?: number
  readonly ignored?: readonly string[]
}

export interface CompositionReloadEvent {
  readonly compositionId: string
  readonly compositionRevision: string
  readonly diagnostics: CompositionDiagnostics
}

export type CompositionReloadFailureEvent = CompositionReloadEvent

export interface CompositionRuntimeOptions {
  readonly context?: Context
  readonly watch?: false | CompositionWatchOptions
  readonly onReload?: (event: CompositionReloadEvent) => void
  readonly onReloadFailure?: (event: CompositionReloadFailureEvent) => void
}
export interface ProtectedCompositionEntry {
  readonly id: string
  readonly plugin: Plugin
  readonly isolate?: Readonly<Record<string, 'session'>>
}

export interface ProtectedComposition {
  readonly entries: readonly ProtectedCompositionEntry[]
}

export interface CompositionActivation {
  readonly composition: CompositionDefinition
  readonly sessionId: string
  readonly workspaceRoot?: string
  readonly protectedComposition?: ProtectedComposition
}

export interface CompositionSession {
  diagnostics(): CompositionDiagnostics
  dispose(): Promise<void>
}

export interface CompositionRuntime {
  activate(request: CompositionActivation): Promise<CompositionSession>
  dispose(): Promise<void>
}

interface CompositionGeneration {
  readonly patches: readonly PatchOptions[]
  readonly effective: readonly EntryOptions[]
  readonly revision: string
}

async function disposeFiber(fiber: Fiber): Promise<void> {
  await fiber.dispose()
  while (fiber.inertia !== undefined) await fiber.inertia
}

function collectCleanupFailure(failures: unknown[], seen: Set<unknown>, error: unknown): void {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) collectCleanupFailure(failures, seen, nested)
    return
  }
  if (seen.has(error)) return
  seen.add(error)
  failures.push(error)
}


function loggedFailure(args: readonly unknown[]): unknown {
  const first = args[0]
  if (first instanceof Error) return first
  return new Error(args.map(value => typeof value === 'string' ? value : String(value)).join(' '))
}

async function settleCleanup(stages: readonly (() => Promise<void>)[], message: string): Promise<void> {
  const failures: unknown[] = []
  const seen = new Set<unknown>()
  for (const stage of stages) {
    try {
      await stage()
    } catch (error) {
      collectCleanupFailure(failures, seen, error)
    }
  }
  if (failures.length > 0) {
    const details = failures.map(error => error instanceof Error ? error.message : String(error)).join('; ')
    throw new AggregateError(failures, `${message}: ${details}`)
  }
}

function diagnosticFailureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const own = error.stack ?? error.message
  if (error instanceof AggregateError) return [own, ...error.errors.map(diagnosticFailureText)].join('\nCaused by: ')
  return error.cause === undefined ? own : `${own}\nCaused by: ${diagnosticFailureText(error.cause)}`
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new TypeError(`${path}.${key} is not supported`)
  }
}

function validProtectedComposition(input: ProtectedComposition | undefined): ProtectedComposition {
  if (input === undefined) return Object.freeze({ entries: Object.freeze([]) })
  const composition = plainRecord(input)
  if (composition === undefined) throw new TypeError('activation.protectedComposition must be an object')
  exactKeys(composition, ['entries'], 'activation.protectedComposition')
  if (!Array.isArray(composition.entries)) {
    throw new TypeError('activation.protectedComposition.entries must be an array')
  }
  const ids = new Set<string>()
  const entries = composition.entries.map((candidate, index): ProtectedCompositionEntry => {
    const path = `activation.protectedComposition.entries[${index}]`
    const entry = plainRecord(candidate)
    if (entry === undefined) throw new TypeError(`${path} must be an object`)
    exactKeys(entry, ['id', 'plugin', 'isolate'], path)
    if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id)) {
      throw new TypeError(`${path}.id must use lowercase kebab-case`)
    }
    if (entry.id === 'session' || entry.id === 'session-metadata') {
      throw new TypeError(`${path}.id is reserved by the runtime`)
    }
    if (ids.has(entry.id)) throw new TypeError(`${path}.id duplicates protected entry "${entry.id}"`)
    ids.add(entry.id)
    const plugin = entry.plugin
    if (plugin === null || (typeof plugin !== 'object' && typeof plugin !== 'function')) {
      throw new TypeError(`${path}.plugin must be a Cordis plugin`)
    }
    const isolateInput = entry.isolate
    let isolate: Readonly<Record<string, 'session'>> | undefined
    if (isolateInput !== undefined) {
      const isolateRecord = plainRecord(isolateInput)
      if (isolateRecord === undefined) throw new TypeError(`${path}.isolate must be an object when present`)
      const normalized: Record<string, 'session'> = Object.create(null)
      for (const [service, label] of Object.entries(isolateRecord)) {
        if (service.trim().length === 0 || service !== service.trim()) {
          throw new TypeError(`${path}.isolate contains an invalid service name`)
        }
        if (label !== 'session') throw new TypeError(`${path}.isolate.${service} must equal "session"`)
        normalized[service] = 'session'
      }
      isolate = Object.freeze(normalized)
    }
    return Object.freeze({
      id: entry.id,
      plugin: plugin as Plugin,
      ...(isolate === undefined ? {} : { isolate }),
    })
  })
  return Object.freeze({ entries: Object.freeze(entries) })
}

function protectedRuntimeLayer(composition: ProtectedComposition): CompositionPatchLayer {
  const insert: EntryOptions[] = [{
    id: RUNTIME_METADATA_ENTRY,
    name: `cordis:${RUNTIME_METADATA_IMPORT}`,
    isolate: { doppelgangerRuntimeSession: 'session' },
  }]
  for (const entry of composition.entries) {
    const services = new Set([
      ...Object.keys(Inject.resolve(entry.plugin.inject)),
      ...Object.keys(entry.isolate ?? {}),
    ])
    const isolate = Object.fromEntries([...services].map(service => [service, 'session']))
    insert.push({
      id: `doppelganger-runtime-${entry.id}`,
      name: `cordis:doppelganger-runtime-${entry.id}`,
      ...(Object.keys(isolate).length === 0 ? {} : { isolate }),
    })
  }
  return Object.freeze({
    source: 'protected Host Extension Composition',
    baseUrl: process.cwd(),
    patches: Object.freeze([{ insert }]),
  })
}

function generationRevision(entries: readonly EntryOptions[]): string {
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

async function loadGeneration(
  composition: CompositionDefinition,
  trustedRuntimeLayer: CompositionPatchLayer,
): Promise<CompositionGeneration> {
  const base = await loadRuntimePresetEntries(composition.loaderPath)
  const layers: CompositionPatchLayer[] = []
  for (const input of composition.patches) {
    if ('filename' in input) {
      const loaded = await loadCompositionPatchFile(input)
      if (loaded !== undefined) layers.push(loaded)
    } else layers.push(defineCompositionPatchLayer(input))
  }
  layers.push(trustedRuntimeLayer)
  const prepared = prepareComposition(base, layers)
  return Object.freeze({
    patches: prepared.patches,
    effective: prepared.effective,
    revision: generationRevision(prepared.effective),
  })
}
interface SessionTreeMount {
  readonly plugin: typeof Include
  readonly trees: Include[]
}

function sessionTree(
  metadataPlugin: Plugin,
  protectedComposition: ProtectedComposition,
): SessionTreeMount {
  const builtins: Record<string, Plugin> = {
    group: Group,
    [RUNTIME_METADATA_IMPORT]: metadataPlugin,
  }
  for (const entry of protectedComposition.entries) {
    builtins[`doppelganger-runtime-${entry.id}`] = entry.plugin
  }

  const namespace = `doppelganger-composition-session-${nextSessionNamespace += 1}:`
  const trees: Include[] = []
  const treeSet = new WeakSet<Include>()
  let listenerInstalled = false
  class SessionTree extends Include {
    constructor(ctx: Context, config: Include.Config) {
      super(ctx, config)
      trees.push(this)
      treeSet.add(this)
      if (!listenerInstalled) {
        listenerInstalled = true
        ctx.on('loader/patch-context', (entry: Entry, next) => {
          if (!treeSet.has(entry.parent.tree as Include)) return next()
          const isolate = entry.options.isolate
          if (isolate !== undefined && isolate !== null) {
            entry.options.isolate = Object.fromEntries(Object.entries(isolate).flatMap(([name, label]) => {
              if (name === RUNTIME_LOGGING_SERVICE && label === 'session') return []
              return [[
                name,
                typeof label === 'string' && !label.startsWith(namespace) ? `${namespace}${label}` : label,
              ]]
            }))
          }
          return next()
        }, { prepend: true })
      }
    }

    override import(name: string, getOuterStack?: () => string[]): unknown {
      if (name.startsWith('cordis:')) {
        const builtin = builtins[name.slice('cordis:'.length)]
        if (builtin !== undefined) return builtin
      }
      if (name.startsWith('.') || name.startsWith('/') || /^[a-z][a-z0-9+.-]*:/iu.test(name)) {
        return super.import(name, getOuterStack)
      }
      return super.import(resolveRuntimePresetImport(name, this.ctx.baseUrl!), getOuterStack)
    }

    override write(): void {
    }
  }
  builtins.include = SessionTree
  return { plugin: SessionTree, trees }
}

function generationDefinition(
  composition: CompositionDefinition,
  revision: string,
): CompositionDefinition {
  return Object.freeze({ ...composition, revision })
}

async function auditComposition(
  composition: CompositionDefinition,
  revision: string,
  tree: Include,
): Promise<CompositionDiagnostics> {
  return inspectCompositionTree(generationDefinition(composition, revision), tree)
}

export function createCompositionRuntime(options: CompositionRuntimeOptions = {}): CompositionRuntime {
  const ownsRoot = options.context === undefined
  const context = options.context ?? new Context()
  const owner = context.plugin(runtimeOwnerPlugin)
  const ready = (async () => {
    await owner.await()
    if (context.get('loader') === undefined) await owner.ctx.plugin(Loader)
    if (options.watch === false || context.get('hmr') !== undefined) return
    if (context.get('timer') === undefined) await owner.ctx.plugin(Timer)
    const watch = options.watch ?? {}
    const basePath = `${resolve(watch.base ?? process.cwd())}${sep}`
    await owner.ctx.plugin(Hmr, {
      base: pathToFileURL(basePath).href,
      root: [...(watch.root ?? ['.'])],
      debounce: watch.debounce ?? 100,
      ignored: [...(watch.ignored ?? ['**/node_modules', '**/.*', 'cache', 'data'])],
    })
  })()
  const inputWatches = new Map<string, Promise<{
    sessions: Set<CompositionSession & { refresh(): Promise<void> }>
    dispose: () => Promise<void>
  }>>()
  const watchSettleMs = options.watch === false ? 0 : Math.max(0, options.watch?.debounce ?? 100)
  const sessions = new Set<CompositionSession>()
  let disposed = false
  let runtimeDisposal: Promise<void> | undefined

  return {
    async activate(request) {
      const activation = plainRecord(request)
      if (activation === undefined) throw new TypeError('activation must be an object')
      exactKeys(activation, ['composition', 'sessionId', 'workspaceRoot', 'protectedComposition'], 'activation')
      if (typeof request.sessionId !== 'string' || request.sessionId.trim().length === 0) {
        throw new TypeError('activation.sessionId must be a non-empty string')
      }
      const protectedComposition = validProtectedComposition(request.protectedComposition)
      const trustedRuntimeLayer = protectedRuntimeLayer(protectedComposition)
      const metadata = createRuntimeSessionMetadata({
        sessionId: request.sessionId,
        runtimePresetId: request.composition.id,
        ...(request.workspaceRoot === undefined ? {} : { workspaceRoot: request.workspaceRoot }),
      })
      const metadataPlugin = createRuntimeSessionMetadataPlugin(metadata)
      await ready
      if (disposed) throw new Error('composition runtime is disposed')

      const sessionOwner = owner.ctx.plugin(sessionOwnerPlugin)
      await sessionOwner.await()
      const sessionFibers = new WeakSet<Fiber>([sessionOwner.ctx.fiber])
      sessionOwner.ctx.on('internal/plugin', fiber => {
        if (sessionFibers.has(fiber.parent.fiber)) sessionFibers.add(fiber)
      }, { global: true })
      const sessionContext = sessionOwner.ctx.isolate(RUNTIME_LOGGING_SERVICE)
      let collectSessionCleanupFailures = false
      const loggedSessionCleanupFailures: unknown[] = []
      const logging = new RuntimeLoggingRouter(sessionContext, metadata, sessionFibers, args => {
        if (collectSessionCleanupFailures) loggedSessionCleanupFailures.push(loggedFailure(args))
      }, owner.ctx)
      const logger = sessionContext.logger('doppelganger-composition-runtime')
      logger.info('runtime.session.activation.started')
      const disposeSessionOwner = async () => {
        collectSessionCleanupFailures = true
        await settleCleanup([
          () => disposeFiber(sessionOwner),
          async () => {
            if (loggedSessionCleanupFailures.length > 0) {
              throw new AggregateError(loggedSessionCleanupFailures, 'session-owned cleanup failed')
            }
          },
          () => logging.dispose(),
        ], `failed to dispose composition session owner ${request.sessionId}`)
      }
      let mounted: SessionTreeMount | undefined
      let generation: CompositionGeneration | undefined
      let initialDiagnostics: CompositionDiagnostics | undefined
      try {
        generation = await loadGeneration(request.composition, trustedRuntimeLayer)
        mounted = sessionTree(metadataPlugin, protectedComposition)
        await sessionContext.plugin(mounted.plugin, {
          path: pathToFileURL(request.composition.loaderPath).href,
          patches: [...generation.patches],
        })
        const tree = mounted.trees[0]
        if (tree === undefined) throw new Error('composition tree did not mount')
        await tree.await()
        initialDiagnostics = await auditComposition(request.composition, generation.revision, tree)
        logger.debug('runtime.session.audit.completed entries=%d failures=%d', initialDiagnostics.entries.length, activationFailures(initialDiagnostics).length)
        if (activationFailures(initialDiagnostics).length > 0) throw new CompositionActivationError(initialDiagnostics)
        logging.settleActivation()
        logger.info('runtime.session.activation.completed revision=%s entries=%d', generation.revision, initialDiagnostics.entries.length)
      } catch (error) {
        logger.error('runtime.session.activation.failed reason=%s', error instanceof CompositionActivationError ? 'audit' : error instanceof Error ? error.name : typeof error)
        let failure = error
        if (!(failure instanceof CompositionActivationError)) {
          const tree = mounted?.trees[0]
          const inspected = tree === undefined || generation === undefined
            ? undefined
            : await auditComposition(request.composition, generation.revision, tree)
          const diagnostics = inspected !== undefined && activationFailures(inspected).length > 0
            ? inspected
            : failedCompositionDiagnostics(
                generationDefinition(request.composition, generation?.revision ?? request.composition.revision),
                error,
              )
          failure = new CompositionActivationError(diagnostics, error)
        }
        try {
          await disposeSessionOwner()
        } catch (cleanupError) {
          failure = new AggregateError([failure, cleanupError], `failed to clean up composition activation ${request.sessionId}`)
        }
        throw failure
      }

      const tree = mounted.trees[0]
      if (tree === undefined || generation === undefined || initialDiagnostics === undefined) {
        await disposeSessionOwner()
        throw new Error('composition activation completed without an audited tree')
      }
      let currentGeneration = generation
      let diagnostics = initialDiagnostics
      let mutation = Promise.resolve()
      let disposing = false
      let sessionDisposal: Promise<void> | undefined
      let session: CompositionSession & { refresh(): Promise<void> }

      const refresh = () => {
        const task = mutation.then(async () => {
          if (disposing) return
          const previousGeneration = currentGeneration
          const previousDiagnostics = diagnostics
          try {
            logger.info('runtime.session.reload.started revision=%s', previousGeneration.revision)
            const nextGeneration = await loadGeneration(request.composition, trustedRuntimeLayer)
            if (nextGeneration.revision === previousGeneration.revision) {
              logger.debug('runtime.session.reload.unchanged revision=%s', previousGeneration.revision)
              return
            }
            await tree.root.update(structuredClone(nextGeneration.effective) as EntryOptions[])
            await tree.await()
            const nextDiagnostics = await auditComposition(request.composition, nextGeneration.revision, tree)
            logger.debug('runtime.session.audit.completed entries=%d failures=%d', nextDiagnostics.entries.length, activationFailures(nextDiagnostics).length)
            if (activationFailures(nextDiagnostics).length > 0) throw new CompositionActivationError(nextDiagnostics)
            currentGeneration = nextGeneration
            diagnostics = nextDiagnostics
            logger.info('runtime.session.reload.completed revision=%s', nextGeneration.revision)
            if (watchSettleMs > 0) {
              await new Promise<void>(resolve => setTimeout(resolve, watchSettleMs))
            }
            try {
              options.onReload?.(Object.freeze({
                compositionId: request.composition.id,
                compositionRevision: currentGeneration.revision,
                diagnostics,
              }))
            } catch {
              // Observers cannot invalidate a committed Loader update.
            }
          } catch (error) {
            logger.warn('runtime.session.reload.failed revision=%s reason=%s', previousGeneration.revision, error instanceof CompositionActivationError ? 'audit' : error instanceof Error ? error.name : typeof error)
            logger.info('runtime.session.rollback.started revision=%s', previousGeneration.revision)
            let failure = error
            let restoredDiagnostics: CompositionDiagnostics | undefined
            try {
              await tree.root.update(structuredClone(previousGeneration.effective) as EntryOptions[])
              await tree.await()
              restoredDiagnostics = await auditComposition(request.composition, previousGeneration.revision, tree)
              logger.debug('runtime.session.rollback.audit.completed entries=%d failures=%d', restoredDiagnostics.entries.length, activationFailures(restoredDiagnostics).length)
              if (activationFailures(restoredDiagnostics).length > 0) throw new CompositionActivationError(restoredDiagnostics)
              logger.info('runtime.session.rollback.completed revision=%s', previousGeneration.revision)
            } catch (rollbackError) {
              logger.error('runtime.session.rollback.failed revision=%s reason=%s', previousGeneration.revision, rollbackError instanceof Error ? rollbackError.name : typeof rollbackError)
              failure = new AggregateError([error, rollbackError], `failed to roll back composition ${request.composition.id}`)
              try {
                restoredDiagnostics ??= await auditComposition(request.composition, previousGeneration.revision, tree)
              } catch (auditError) {
                restoredDiagnostics = failedCompositionDiagnostics(
                  generationDefinition(request.composition, previousGeneration.revision),
                  new AggregateError([rollbackError, auditError], 'restoration audit failed'),
                )
              }
            }
            currentGeneration = previousGeneration
            diagnostics = Object.freeze({
              ...(restoredDiagnostics ?? previousDiagnostics),
              reload: Object.freeze({ state: 'failed' as const, error: diagnosticFailureText(failure) }),
            })
            if (watchSettleMs > 0) await new Promise<void>(resolve => setTimeout(resolve, watchSettleMs))
            try {
              options.onReloadFailure?.(Object.freeze({
                compositionId: request.composition.id,
                compositionRevision: currentGeneration.revision,
                diagnostics,
              }))
            } catch {
              // Failure observers cannot invalidate the restored Loader generation.
            }
          }
        })
        mutation = task.catch(() => undefined)
        return task
      }

      const watchedPaths = [...new Set([
        request.composition.loaderPath,
        ...request.composition.patches.flatMap(input => 'filename' in input ? [input.filename] : []),
      ])]
      const joinedWatchPaths: string[] = []
      const removeInputWatches = async () => {
        const failures: unknown[] = []
        const seen = new Set<unknown>()
        for (const filename of joinedWatchPaths.splice(0).reverse()) {
          try {
            const registrationTask = inputWatches.get(filename)
            if (registrationTask === undefined) continue
            const registration = await registrationTask
            registration.sessions.delete(session)
            if (registration.sessions.size > 0) continue
            if (inputWatches.get(filename) === registrationTask) inputWatches.delete(filename)
            await registration.dispose()
          } catch (error) {
            collectCleanupFailure(failures, seen, error)
          }
        }
        if (failures.length > 0) throw new AggregateError(failures, 'failed to remove composition input watches')
      }

      session = {
        diagnostics: () => diagnostics,
        refresh,
        dispose: () => (sessionDisposal ??= (async () => {
          disposing = true
          logger.info('runtime.session.disposal.started')
          collectSessionCleanupFailures = true
          try {
            await settleCleanup([
              () => mutation,
              removeInputWatches,
              disposeSessionOwner,
            ], `failed to dispose composition session ${request.sessionId}`)
          } finally {
            sessions.delete(session)
          }
        })()),
      }
      sessions.add(session)

      if (options.watch !== false) {
        const hmr = owner.ctx.get('hmr') as Hmr | undefined
        if (hmr !== undefined) {
          try {
            for (const filename of watchedPaths) {
              let registrationTask = inputWatches.get(filename)
              if (registrationTask === undefined) {
                const watchedSessions = new Set<CompositionSession & { refresh(): Promise<void> }>()
                registrationTask = hmr.registerConfig(filename, async () => {
                  await Promise.all([...watchedSessions].map(watched => watched.refresh()))
                }).then(dispose => ({ sessions: watchedSessions, dispose }))
                inputWatches.set(filename, registrationTask)
              }
              let registration: Awaited<typeof registrationTask>
              try {
                registration = await registrationTask
              } catch (error) {
                if (inputWatches.get(filename) === registrationTask) inputWatches.delete(filename)
                throw error
              }
              registration.sessions.add(session)
              joinedWatchPaths.push(filename)
              logger.debug('runtime.session.watch.registered')
            }
          } catch (error) {
            logger.error('runtime.session.watch.failed reason=%s', error instanceof Error ? error.name : typeof error)
            let cleanupFailure: unknown
            try {
              await session.dispose()
            } catch (cause) {
              cleanupFailure = cause
            }
            if (cleanupFailure !== undefined) {
              const failures: unknown[] = [error]
              collectCleanupFailure(failures, new Set<unknown>([error]), cleanupFailure)
              throw new AggregateError(failures, `composition watch acquisition failed for ${request.sessionId}`)
            }
            throw error
          }
        }
      }
      return session
    },
    dispose() {
      if (runtimeDisposal !== undefined) return runtimeDisposal
      disposed = true
      runtimeDisposal = settleCleanup([
        ...[...sessions].map(session => () => session.dispose()),
        () => disposeFiber(owner),
        ...(ownsRoot ? [() => context.fiber.dispose()] : []),
      ], 'failed to dispose composition runtime')
      return runtimeDisposal
    },
  }
}
