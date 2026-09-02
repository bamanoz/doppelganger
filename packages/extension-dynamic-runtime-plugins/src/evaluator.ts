import { createContext, runInContext, Script } from 'node:vm'
import type { Plugin } from '@deepseek-ai/cordis'
import type { NormalizedDynamicRuntimePluginsConfig } from './config.ts'

const TIMER_REDIRECT = 'Native timers are unavailable. Inspect and inject the catalogued timer service, then use ctx.timeout or ctx.interval so cleanup belongs to the generated Fiber.'
const REDIRECTS = Object.freeze({
  require: 'Node modules are unavailable. Use only inspected Runtime Session services.',
  fetch: 'Native fetch is unavailable. Inspect and inject the catalogued doppelgangerHttp service.',
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  setImmediate: TIMER_REDIRECT,
  clearTimeout: TIMER_REDIRECT,
  clearInterval: TIMER_REDIRECT,
})

const OBJECT_REDIRECTS = Object.freeze({
  Buffer: 'Node Buffer is unavailable. Use TextEncoder, TextDecoder, atob, or btoa.',
  process: 'Node process is unavailable. Use only inspected Runtime Session services.',
})

function traps(): Readonly<Record<string, () => never>> {
  return Object.fromEntries(Object.entries(REDIRECTS).map(([name, message]) => [
    name,
    () => { throw new Error(`${name} is unavailable in generated Package code. ${message}`) },
  ]))
}

function unavailableObject(name: string, message: string): object {
  return new Proxy(Object.freeze({}), {
    get() {
      throw new Error(`${name} is unavailable in generated Package code. ${message}`)
    },
    set() {
      throw new Error(`${name} is unavailable in generated Package code. ${message}`)
    },
  })
}

function referenceError(cause: unknown): cause is Error {
  return cause instanceof Error && cause.name === 'ReferenceError'
}

function teachRuntimeFailure(cause: unknown): Error {
  if (!referenceError(cause)) return cause instanceof Error ? cause : new Error(String(cause))
  return new ReferenceError(
    `${cause.message}. Generated Package code can use only inspected builtins and approved Runtime Session services.`,
    { cause },
  )
}

function taggedConsole(packageId: string) {
  const tag = `[runtime-plugin:${packageId}]`
  return Object.freeze({
    log: (...values: unknown[]) => console.log(tag, ...values),
    info: (...values: unknown[]) => console.info(tag, ...values),
    warn: (...values: unknown[]) => console.warn(tag, ...values),
    error: (...values: unknown[]) => console.error(tag, ...values),
    debug: (...values: unknown[]) => console.debug(tag, ...values),
  })
}

function syntaxContext(error: Error): string {
  const lines = (error.stack ?? String(error)).split('\n')
  const index = lines.findIndex(line => line.startsWith('SyntaxError'))
  return lines.slice(0, index < 0 ? Math.min(lines.length, 4) : index + 1).join('\n')
}

function teachingParseMessage(source: string, error: Error): string {
  if (/^\s*(?:import|export)\b/m.test(source)) {
    return 'Package source is a plain JavaScript async-function body; import and export syntax are unavailable.'
  }
  if (/<[A-Za-z][^>]*>|<\/>/.test(source)) {
    return 'Package source is plain JavaScript; JSX is unavailable.'
  }
  if (/\b(?:interface|type|enum|namespace)\s+[A-Za-z_$]|\bas\s+(?:const|[A-Za-z_$])|:\s*[A-Za-z_$][\w.$<>\[\]| ]*(?=[,)=;{])/m.test(source)) {
    return 'Package source is plain JavaScript; remove TypeScript declarations and annotations.'
  }
  return `Package source failed to parse:\n${syntaxContext(error)}`
}

export function precheckSource(source: string, maximumSourceBytes: number): number {
  const bytes = Buffer.byteLength(source, 'utf8')
  if (bytes === 0 || bytes > maximumSourceBytes) {
    throw new RangeError(`source must contain 1-${maximumSourceBytes} UTF-8 bytes`)
  }
  const wrapped = `(async () => {\n${source}\n})()`
  try {
    new Script(wrapped, { filename: 'runtime-plugin-define.js' })
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    throw new SyntaxError(teachingParseMessage(source, error))
  }
  return bytes
}

export function isCordisPlugin(value: unknown): value is Plugin {
  if (typeof value === 'function') return true
  return value !== null && typeof value === 'object' && 'apply' in value && typeof value.apply === 'function'
}

export async function evaluatePackage(
  packageId: string,
  source: string,
  config: NormalizedDynamicRuntimePluginsConfig,
): Promise<Plugin> {
  const sandbox = {
    ...traps(),
    ...Object.fromEntries(Object.entries(OBJECT_REDIRECTS).map(([name, message]) => [
      name,
      unavailableObject(name, message),
    ])),
    console: taggedConsole(packageId),
    TextEncoder,
    TextDecoder,
    atob: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
    btoa: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  }
  createContext(sandbox)
  let value: unknown
  try {
    value = await runInContext(
      `(async () => {\n${source}\n})()`,
      sandbox,
      { filename: `runtime-plugin-${packageId}.js`, timeout: config.vmTimeoutMs },
    )
  } catch (cause) {
    throw teachRuntimeFailure(cause)
  }
  if (!isCordisPlugin(value)) {
    throw new TypeError('Package source must return a Cordis Plugin function or an object with apply(ctx)')
  }
  return value
}
