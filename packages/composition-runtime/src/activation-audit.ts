import type { Entry, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import type { CompositionDefinition } from './definition.ts'

export type CompositionEntryState =
  | 'active'
  | 'disabled'
  | 'disposed'
  | 'failed'
  | 'loading'
  | 'missing'
  | 'pending'
  | 'unloading'

export interface CompositionEntryDiagnostic {
  readonly id: string
  readonly plugin: string
  readonly state: CompositionEntryState
  readonly missingServices?: readonly string[]
  readonly error?: string
}

export interface CompositionReloadDiagnostic {
  readonly state: 'failed'
  readonly error: string
}

export interface CompositionDiagnostics {
  readonly compositionId: string
  readonly compositionRevision: string
  readonly entries: readonly CompositionEntryDiagnostic[]
  readonly reload?: CompositionReloadDiagnostic
}

const STATE_NAMES: Readonly<Record<number, CompositionEntryState>> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: 'disposed',
  5: 'unloading',
}
function errorText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause)
  const parts = [cause.stack ?? cause.message]
  if (cause instanceof AggregateError) {
    parts.push(...cause.errors.map(errorText))
  } else if (cause.cause !== undefined) {
    parts.push(errorText(cause.cause))
  }
  return parts.join('\nCaused by: ')
}

async function inspectEntry(entry: Entry): Promise<CompositionEntryDiagnostic> {
  if (entry.disabled) return Object.freeze({ id: entry.id, plugin: entry.options.name, state: 'disabled' })
  const fiber = entry.fiber
  if (fiber === undefined) {
    return Object.freeze({
      id: entry.id,
      plugin: entry.options.name,
      state: 'missing',
      error: 'enabled Loader entry has no Fiber',
    })
  }
  const state = STATE_NAMES[fiber.state] ?? 'failed'
  if (state === 'active') return Object.freeze({ id: entry.id, plugin: entry.options.name, state })
  if (state === 'pending') {
    const missingServices = Object.keys(fiber.inject).filter(name => fiber.ctx.get(name) === undefined)
    return Object.freeze({
      id: entry.id,
      plugin: entry.options.name,
      state,
      missingServices: Object.freeze(missingServices),
    })
  }
  if (state === 'failed') {
    let error: string | undefined
    try {
      await fiber.await()
    } catch (cause) {
      error = errorText(cause)
    }
    return Object.freeze({
      id: entry.id,
      plugin: entry.options.name,
      state,
      ...(error === undefined ? {} : { error }),
    })
  }
  return Object.freeze({ id: entry.id, plugin: entry.options.name, state })
}

export async function inspectCompositionTree(
  composition: CompositionDefinition,
  tree: EntryTree,
): Promise<CompositionDiagnostics> {
  const entries = await Promise.all([...tree.entries()].map(inspectEntry))
  return Object.freeze({
    compositionId: composition.id,
    compositionRevision: composition.revision,
    entries: Object.freeze(entries),
  })
}

export function failedCompositionDiagnostics(
  composition: CompositionDefinition,
  error: unknown,
): CompositionDiagnostics {
  return Object.freeze({
    compositionId: composition.id,
    compositionRevision: composition.revision,
    entries: Object.freeze([Object.freeze({
      id: 'doppelganger-composition',
      plugin: composition.loaderPath,
      state: 'failed' as const,
      error: errorText(error),
    })]),
  })
}

export function activationFailures(diagnostics: CompositionDiagnostics): CompositionEntryDiagnostic[] {
  return diagnostics.entries.filter(entry => entry.state !== 'active' && entry.state !== 'disabled')
}

export class CompositionActivationError extends Error {
  readonly diagnostics: CompositionDiagnostics

  constructor(diagnostics: CompositionDiagnostics, cause?: unknown) {
    const failures = activationFailures(diagnostics)
    const lines = failures.map((entry) => {
      const missing = entry.missingServices === undefined || entry.missingServices.length === 0
        ? ''
        : `; missing services: ${entry.missingServices.join(', ')}`
      const error = entry.error === undefined ? '' : `; ${entry.error}`
      return `${entry.id} (${entry.plugin}): ${entry.state}${missing}${error}`
    })
    super(
      `composition activation failed for ${diagnostics.compositionId}@${diagnostics.compositionRevision}:\n${lines.join('\n')}`,
      cause === undefined ? undefined : { cause },
    )
    this.diagnostics = diagnostics
    this.name = 'CompositionActivationError'
  }
}
