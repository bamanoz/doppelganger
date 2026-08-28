import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader, { type Entry, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import {
  CompositionActivationError,
  activationFailures,
  failedCompositionDiagnostics,
  inspectCompositionTree,
  type CompositionDiagnostics,
} from './activation-audit.ts'
import { mountImportName, type CompositionDefinition } from './definition.ts'

const RESERVED_BUILTINS: Readonly<Record<string, true>> = { include: true, group: true }
const runtimeOwnerPlugin: Plugin = { name: 'doppelganger-composition-runtime-owner', apply: () => undefined }
const sessionOwnerPlugin: Plugin = { name: 'doppelganger-composition-session-owner', apply: () => undefined }
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

export interface CompositionRuntimeOptions {
  readonly context?: Context
  readonly watch?: false | CompositionWatchOptions
  readonly onReload?: (event: CompositionReloadEvent) => void
}

export interface CompositionActivation {
  readonly composition: CompositionDefinition
  readonly sessionId: string
  readonly mounts?: Readonly<Record<string, Plugin>>
}

export interface CompositionSession {
  diagnostics(): CompositionDiagnostics
  dispose(): Promise<void>
}

export interface CompositionRuntime {
  activate(request: CompositionActivation): Promise<CompositionSession>
  dispose(): Promise<void>
}

async function disposeFiber(fiber: Fiber): Promise<void> {
  await fiber.dispose()
  while (fiber.inertia !== undefined) await fiber.inertia
}

function validateActivation(request: CompositionActivation): Readonly<Record<string, Plugin>> {
  if (request.sessionId.trim().length === 0) throw new TypeError('activation.sessionId must be a non-empty string')
  const supplied = request.mounts ?? {}
  for (const name of Object.keys(supplied)) {
    if (request.composition.mounts[name] === undefined) {
      throw new TypeError(`activation mount "${name}" is not declared by composition ${request.composition.id}`)
    }
  }
  for (const [name, point] of Object.entries(request.composition.mounts)) {
    if (point.required && supplied[name] === undefined) {
      throw new TypeError(`activation mount "${name}" is required by composition ${request.composition.id}`)
    }
  }
  for (const [name, plugin] of Object.entries(supplied)) {
    if (plugin === null || (typeof plugin !== 'object' && typeof plugin !== 'function')) {
      throw new TypeError(`activation.mounts.${name} must be a Cordis plugin`)
    }
  }
  return supplied
}

function mountPatches(
  composition: CompositionDefinition,
  mounts: Readonly<Record<string, Plugin>>,
): PatchOptions[] {
  const patches: PatchOptions[] = []
  for (const [name, point] of Object.entries(composition.mounts)) {
    if (mounts[name] === undefined) continue
    const entry: EntryOptions = {
      id: `doppelganger-mount-${name}`,
      name: `cordis:${mountImportName(name)}`,
    }
    patches.push(point.target === undefined ? { insert: [entry] } : { id: point.target, insert: [entry] })
  }
  return patches
}

interface SessionTreeMount {
  readonly plugin: typeof Include
  readonly trees: Include[]
}

function sessionTree(
  composition: CompositionDefinition,
  mounts: Readonly<Record<string, Plugin>>,
): SessionTreeMount {
  const builtins: Record<string, Plugin> = { group: Group }
  for (const [name, plugin] of Object.entries(composition.imports)) {
    if (RESERVED_BUILTINS[name] === true) throw new Error(`composition import "${name}" is reserved by the runtime`)
    builtins[name] = plugin
  }
  for (const [name, plugin] of Object.entries(mounts)) builtins[mountImportName(name)] = plugin

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
            entry.options.isolate = Object.fromEntries(Object.entries(isolate).map(([name, label]) => [
              name,
              typeof label === 'string' && !label.startsWith(namespace) ? `${namespace}${label}` : label,
            ]))
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
      return super.import(name, getOuterStack)
    }

    override write(): void {
    }
  }
  builtins.include = SessionTree
  return { plugin: SessionTree, trees }
}

async function auditComposition(
  composition: CompositionDefinition,
  tree: Include,
  mounts: Readonly<Record<string, Plugin>>,
): Promise<CompositionDiagnostics> {
  const diagnostics = await inspectCompositionTree(composition, tree)
  const ids = new Set([...tree.entries()].map(entry => entry.id))
  const missing = Object.keys(mounts)
    .filter(name => !ids.has(`doppelganger-mount-${name}`))
    .map(name => Object.freeze({
      id: `doppelganger-mount-${name}`,
      plugin: `activation.mounts.${name}`,
      state: 'missing' as const,
      error: `declared mount target did not accept mount "${name}"`,
    }))
  if (missing.length === 0) return diagnostics
  return Object.freeze({
    ...diagnostics,
    entries: Object.freeze([...diagnostics.entries, ...missing]),
  })
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
  const definitionWatches = new Map<string, Promise<{
    sessions: Set<CompositionSession & { refresh(): Promise<void> }>
    dispose: () => Promise<void>
  }>>()
  const sessions = new Set<CompositionSession>()
  let disposed = false
  let runtimeDisposal: Promise<void> | undefined

  return {
    async activate(request) {
      if (disposed) throw new Error('composition runtime is disposed')
      const mounts = validateActivation(request)
      await ready
      if (disposed) throw new Error('composition runtime is disposed')

      const sessionOwner = owner.ctx.plugin(sessionOwnerPlugin)
      await sessionOwner.await()
      let mounted: SessionTreeMount | undefined
      let initialDiagnostics: CompositionDiagnostics | undefined
      try {
        mounted = sessionTree(request.composition, mounts)
        await sessionOwner.ctx.plugin(mounted.plugin, {
          path: pathToFileURL(request.composition.loaderPath).href,
          patches: mountPatches(request.composition, mounts),
        })
        const tree = mounted.trees[0]
        if (tree === undefined) throw new Error('composition tree did not mount')
        await tree.await()
        initialDiagnostics = await auditComposition(request.composition, tree, mounts)
        if (activationFailures(initialDiagnostics).length > 0) throw new CompositionActivationError(initialDiagnostics)
      } catch (error) {
        let failure = error
        if (!(failure instanceof CompositionActivationError)) {
          const tree = mounted?.trees[0]
          const inspected = tree === undefined
            ? undefined
            : await auditComposition(request.composition, tree, mounts)
          const diagnostics = inspected !== undefined && activationFailures(inspected).length > 0
            ? inspected
            : failedCompositionDiagnostics(request.composition, error)
          failure = new CompositionActivationError(diagnostics, error)
        }
        await disposeFiber(sessionOwner)
        throw failure
      }

      const tree = mounted.trees[0]
      if (tree === undefined || initialDiagnostics === undefined) {
        await disposeFiber(sessionOwner)
        throw new Error('composition activation completed without an audited tree')
      }
      let diagnostics = initialDiagnostics
      let mutation = Promise.resolve()
      let disposing = false
      let sessionDisposal: Promise<void> | undefined
      let session: CompositionSession & { refresh(): Promise<void> }

      const refresh = () => {
        const task = mutation.then(async () => {
          if (disposing) return
          const previousDiagnostics = diagnostics
          const previousConfig = structuredClone(tree.root.data)
          let applied = false
          try {
            await tree.refresh()
            applied = true
            await tree.await()
            const nextDiagnostics = await auditComposition(request.composition, tree, mounts)
            if (activationFailures(nextDiagnostics).length > 0) throw new CompositionActivationError(nextDiagnostics)
            diagnostics = nextDiagnostics
            try {
              options.onReload?.(Object.freeze({
                compositionId: request.composition.id,
                compositionRevision: request.composition.revision,
                diagnostics,
              }))
            } catch {
              // Observers cannot invalidate a committed Loader update.
            }
          } catch (error) {
            let failure = error
            if (applied && error instanceof CompositionActivationError) {
              try {
                await tree.root.update(previousConfig)
                await tree.await()
              } catch (rollbackError) {
                failure = new AggregateError(
                  [error, rollbackError],
                  `failed to roll back composition ${request.composition.id}`,
                )
              }
            }
            diagnostics = Object.freeze({
              ...previousDiagnostics,
              reload: Object.freeze({
                state: 'failed' as const,
                error: failure instanceof Error ? failure.stack ?? failure.message : String(failure),
              }),
            })
            throw failure
          }
        })
        mutation = task.catch(() => undefined)
        return task
      }

      const removeDefinitionWatch = async () => {
        const registrationTask = definitionWatches.get(request.composition.loaderPath)
        if (registrationTask === undefined) return
        const registration = await registrationTask
        registration.sessions.delete(session)
        if (registration.sessions.size > 0) return
        if (definitionWatches.get(request.composition.loaderPath) === registrationTask) {
          definitionWatches.delete(request.composition.loaderPath)
        }
        await registration.dispose()
      }

      session = {
        diagnostics: () => diagnostics,
        refresh,
        dispose: () => (sessionDisposal ??= (async () => {
          disposing = true
          await mutation
          await removeDefinitionWatch()
          await disposeFiber(sessionOwner)
          sessions.delete(session)
        })()),
      }
      sessions.add(session)

      if (options.watch !== false) {
        let registrationTask = definitionWatches.get(request.composition.loaderPath)
        if (registrationTask === undefined) {
          const watchedSessions = new Set<CompositionSession & { refresh(): Promise<void> }>()
          const hmr = owner.ctx.get('hmr') as Hmr | undefined
          if (hmr !== undefined) {
            registrationTask = hmr.registerConfig(request.composition.loaderPath, async () => {
              await Promise.all([...watchedSessions].map(watched => watched.refresh()))
            }).then(dispose => ({ sessions: watchedSessions, dispose }))
            definitionWatches.set(request.composition.loaderPath, registrationTask)
          }
        }
        if (registrationTask !== undefined) {
          try {
            const registration = await registrationTask
            registration.sessions.add(session)
          } catch (error) {
            if (definitionWatches.get(request.composition.loaderPath) === registrationTask) {
              definitionWatches.delete(request.composition.loaderPath)
            }
            await disposeFiber(sessionOwner)
            throw error
          }
        }
      }
      return session
    },
    dispose() {
      if (runtimeDisposal !== undefined) return runtimeDisposal
      disposed = true
      runtimeDisposal = (async () => {
        await Promise.all([...sessions].map(session => session.dispose()))
        await disposeFiber(owner)
        if (ownsRoot) await context.fiber.dispose()
      })()
      return runtimeDisposal
    },
  }
}
