import { Context, Inject, isConstructor, type Disposable, type Effect, type Plugin } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@doppelganger/doppelganger-protocols'
import { APPROVED_EVENT_NAMES, APPROVED_SERVICE_NAMES } from './catalog.ts'

const RESERVED_SERVICE_PREFIXES = ['doppelganger', 'runtime-plugin', 'cordis']

type DynamicTimer = {
  timeout(callback: () => void, delay: number): () => void
  interval(callback: () => void, delay: number): () => void
}

function denyContext(value: unknown, label: string, report: (error: Error) => void): unknown {
  const reject = (resolved: unknown) => {
    if (Context.is(resolved)) {
      const error = new Error(`${label} returned a Cordis Context, which generated Package code cannot access`)
      report(error)
      throw error
    }
    return resolved
  }
  return value instanceof Promise ? value.then(reject) : reject(value)
}

function guardedService(service: object | Function, name: string, report: (error: Error) => void): unknown {
  const callable = typeof service === 'function' ? service : undefined
  const target = callable === undefined ? Object.create(null) as object : function () {}
  return new Proxy(target, {
    get(_target, property) {
      const value = Reflect.get(service, property, service)
      if (typeof value !== 'function') return denyContext(value, `service "${name}"`, report)
      return (...args: unknown[]) => denyContext(
        Reflect.apply(value, service, args),
        `service "${name}" method "${String(property)}"`,
        report,
      )
    },
    apply(_target, thisArgument, argumentsList) {
      if (callable === undefined) throw new TypeError(`service "${name}" is not callable`)
      return denyContext(
        Reflect.apply(callable, thisArgument, argumentsList),
        `service "${name}"`,
        report,
      )
    },
  })
}

function toolsFacade(ctx: Context, report: (error: Error) => void) {
  return Object.freeze({
    snapshot: () => ctx.doppelgangerTools.snapshot(),
    register: (definition: ToolDefinition) => {
      if (typeof definition?.name !== 'string' || definition.name.startsWith('runtime-plugin.')) {
        const error = new Error('generated tools cannot use the reserved runtime-plugin namespace')
        report(error)
        throw error
      }
      const registration = ctx.doppelgangerTools.register(definition)
      return () => registration.dispose()
    },
  })
}

function contextFacade(ctx: Context) {
  return Object.freeze({ register: ctx.doppelgangerContext.register.bind(ctx.doppelgangerContext) })
}

function validateProvideName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(name)) {
    throw new TypeError('generated service name must be a lowercase qualified name')
  }
  if (RESERVED_SERVICE_PREFIXES.some(prefix => name === prefix || name.startsWith(`${prefix}.`))) {
    throw new Error(`generated service name "${name}" uses a reserved namespace`)
  }
}

function generatedContext(
  ctx: Context,
  report: (error: Error) => void,
  reportDisposal: (error: Error) => void,
): Context {
  const declared = new Set(Object.keys(ctx.fiber.inject))
  const service = (name: string, requireDeclaration: boolean): unknown => {
    if (!APPROVED_SERVICE_NAMES.has(name)) {
      const error = new Error(`service "${name}" is not in the generated runtime inspection catalog`)
      report(error)
      throw error
    }
    if (requireDeclaration && !declared.has(name)) {
      const error = new Error(`service "${name}" is not declared in the generated Plugin inject contract`)
      report(error)
      throw error
    }
    if (name === 'doppelgangerTools') return toolsFacade(ctx, report)
    if (name === 'doppelgangerContext') return contextFacade(ctx)
    const value = ctx.get(name)
    if (value === undefined || value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
    return guardedService(value, name, report)
  }

  const proxy = new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (property === 'get') return (name: string) => service(name, false)
      if (property === 'logger') {
        return (name = 'generated-runtime-plugin') => {
          const logger = ctx.logger(name)
          return Object.freeze({
            debug: logger.debug.bind(logger),
            error: logger.error.bind(logger),
            info: logger.info.bind(logger),
            warn: logger.warn.bind(logger),
          })
        }
      }
      if (typeof property !== 'string') return undefined
      if (property === 'timeout' || property === 'interval') {
        return (callback: () => void, delay: number) => {
          if (!declared.has('timer')) {
            const error = new Error('timer helpers require inject: ["timer"]')
            report(error)
            throw error
          }
          const timer: DynamicTimer | undefined = ctx.get('timer')
          if (timer === undefined) {
            const error = new Error('timer service is not currently available')
            report(error)
            throw error
          }
          return timer[property](callback, delay)
        }
      }
      if (property === 'on' || property === 'once') {
        return (name: string, listener: (...args: unknown[]) => unknown) => {
          if (!APPROVED_EVENT_NAMES.has(name)) {
            const error = new Error(`event "${name}" is not in the generated runtime inspection catalog`)
            report(error)
            throw error
          }
          return ctx[property](name as never, listener as never)
        }
      }
      if (property === 'provide') {
        return (name: unknown, value: unknown) => {
          validateProvideName(name)
          return ctx.provide(name, value)
        }
      }
      if (property === 'effect') return effectFacade(ctx, reportDisposal)
      return service(property, true)
    },
    set(_target, property) {
      const error = new Error(`generated Context is read-only; cannot assign "${String(property)}"`)
      report(error)
      throw error
    },
    has(_target, property) {
      return property === 'get' || property === 'logger' || property === 'effect'
        || property === 'on' || property === 'once' || property === 'provide'
        || (typeof property === 'string' && (declared.has(property)
          || ((property === 'timeout' || property === 'interval') && declared.has('timer'))))
    },
  })
  return proxy as Context
}

export function approvedInjectNames(plugin: Plugin): readonly string[] {
  const inject = Inject.resolve(plugin.inject)
  const names = Object.keys(inject)
  const rejected = names.filter(name => !APPROVED_SERVICE_NAMES.has(name))
  if (rejected.length > 0) {
    throw new Error(`generated Plugin inject contains uncatalogued services: ${rejected.sort().join(', ')}`)
  }
  return Object.freeze(names)
}

function teachingGuardError(cause: unknown): Error {
  const named = cause !== null && typeof cause === 'object' && 'name' in cause && 'message' in cause
  if (named && cause.name === 'ReferenceError' && typeof cause.message === 'string') {
    return new ReferenceError(
      `${cause.message}. Generated Package code can use only inspected builtins and approved Runtime Session services.`,
      { cause },
    )
  }
  return cause instanceof Error ? cause : new Error(String(cause))
}

function guardResult(callback: () => unknown): unknown {
  try {
    const value = callback()
    return value instanceof Promise ? value.catch(cause => { throw teachingGuardError(cause) }) : value
  } catch (cause) {
    throw teachingGuardError(cause)
  }
}

function thenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? 'then' in value && typeof value.then === 'function'
    : false
}

function guardedDisposer(dispose: Disposable, report: (error: Error) => void): Disposable {
  return () => {
    try {
      const result = dispose()
      if (!thenable(result)) return result
      return Promise.resolve(result).catch(cause => {
        const error = teachingGuardError(cause)
        report(error)
        throw error
      })
    } catch (cause) {
      const error = teachingGuardError(cause)
      report(error)
      throw error
    }
  }
}

function guardedEffectResult(effect: Effect, report: (error: Error) => void): Effect {
  if (typeof effect === 'function') return guardedDisposer(effect, report)
  if (thenable(effect)) return Promise.resolve(effect).then(dispose => guardedDisposer(dispose as Disposable, report))
  if (Symbol.asyncIterator in effect) {
    return (async function* () {
      for await (const dispose of effect) yield guardedDisposer(dispose, report)
    })()
  }
  return (function* () {
    for (const dispose of effect) yield guardedDisposer(dispose, report)
  })()
}

function effectFacade(ctx: Context, report: (error: Error) => void) {
  return (execute: () => Effect, label?: string) => ctx.effect(
    () => guardedEffectResult(execute(), report),
    label,
  )
}

export function guardPlugin(
  plugin: Plugin,
  report: (error: Error) => void,
  reportDisposal: (error: Error) => void = report,
): Plugin {
  approvedInjectNames(plugin)
  if (typeof plugin === 'function') {
    if (isConstructor(plugin)) {
      const Constructor = plugin
      return new Proxy(Constructor, {
        construct(target, argumentsList, newTarget) {
          const [ctx, config] = argumentsList
          return guardResult(() => Reflect.construct(
            target,
            [generatedContext(ctx, report, reportDisposal), config],
            newTarget,
          )) as object
        },
      })
    }
    const callable = plugin as Plugin.Function
    const guarded: Plugin.Function = (ctx: Context, config: unknown) => guardResult(
      () => callable(generatedContext(ctx, report, reportDisposal), config),
    )
    Object.defineProperty(guarded, 'name', { value: plugin.name || 'generated-runtime-plugin' })
    if (plugin.inject !== undefined) guarded.inject = plugin.inject
    return guarded
  }
  const object = plugin as Plugin.Object
  return {
    ...object,
    apply(ctx: Context, config: unknown) {
      return guardResult(() => object.apply(generatedContext(ctx, report, reportDisposal), config))
    },
  }
}