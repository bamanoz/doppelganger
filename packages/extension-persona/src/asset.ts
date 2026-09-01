import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-hmr'

export type PersonaAssetRevision = `sha256:${string}`
export type PersonaAssetReloadOutcome = 'success' | 'failed'

export interface PersonaAssetReloadEvent {
  readonly url: string
  readonly outcome: PersonaAssetReloadOutcome
  readonly revision?: PersonaAssetRevision
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'doppelganger/persona-asset-reloaded'(event: PersonaAssetReloadEvent): void
  }
}

const MAX_DIAGNOSTIC_FILENAME_LENGTH = 1_024
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 2_048

export interface PersonaAssetDiagnostic {
  readonly kind: string
  readonly filename: string
  readonly message: string
}

export interface PersonaAssetOptions {
  readonly filename: string
  readonly kind: string
  readonly readBytes?: (filename: string) => Promise<Uint8Array>
  readonly onDiagnostic?: (diagnostic: PersonaAssetDiagnostic) => void | Promise<void>
}

export interface PersonaAsset {
  readonly filename: string
  readonly url: string
  content(): Promise<string>
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`
}

function errorMessage(cause: unknown): string {
  try {
    return cause instanceof Error ? cause.message : String(cause)
  } catch {
    return 'asset reload failed with an unprintable error'
  }
}

interface PersonaAssetCandidate {
  readonly content: string
  readonly revision: PersonaAssetRevision
}

class PersonaAssetReadError extends Error {
  readonly revision?: PersonaAssetRevision

  constructor(cause: unknown, revision?: PersonaAssetRevision) {
    super(errorMessage(cause), { cause })
    this.name = 'PersonaAssetReadError'
    if (revision !== undefined) this.revision = revision
  }
}

function exactRevision(bytes: Uint8Array): PersonaAssetRevision {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function readCandidate(
  filename: string,
  kind: string,
  readBytes: (filename: string) => Promise<Uint8Array>,
): Promise<PersonaAssetCandidate> {
  let bytes: Uint8Array
  try {
    bytes = await readBytes(filename)
  } catch (cause) {
    throw new PersonaAssetReadError(cause)
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new PersonaAssetReadError(new TypeError(`${kind} asset reader must return bytes`))
  }
  const revision = exactRevision(bytes)
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    if (content.length === 0) throw new Error(`${kind} asset is empty: ${filename}`)
    return Object.freeze({ content, revision })
  } catch (cause) {
    throw new PersonaAssetReadError(cause, revision)
  }
}

function emitReload(ctx: Context, event: PersonaAssetReloadEvent): void {
  try {
    ctx.emit('doppelganger/persona-asset-reloaded', Object.freeze(event))
  } catch {
    // Reload observers are advisory and must not poison the serialized asset queue.
  }
}

export async function createPersonaAsset(ctx: Context, options: PersonaAssetOptions): Promise<PersonaAsset> {
  const filename = options.filename
  const kind = options.kind
  const readBytes = options.readBytes ?? readFile
  const url = pathToFileURL(await realpath(filename)).href
  let content = (await readCandidate(filename, kind, readBytes)).content
  let reload = Promise.resolve()
  let disposed = false

  ctx.on('hmr/change', (changedUrl) => {
    if (changedUrl !== url || disposed) return
    reload = reload.then(async () => {
      try {
        const candidate = await readCandidate(filename, kind, readBytes)
        if (disposed) return
        content = candidate.content
        emitReload(ctx, { url, outcome: 'success', revision: candidate.revision })
      } catch (cause) {
        if (disposed) return
        const revision = cause instanceof PersonaAssetReadError ? cause.revision : undefined
        if (options.onDiagnostic !== undefined) {
          const diagnostic = Object.freeze({
            kind: bounded(kind, 128),
            filename: bounded(filename, MAX_DIAGNOSTIC_FILENAME_LENGTH),
            message: bounded(errorMessage(cause), MAX_DIAGNOSTIC_MESSAGE_LENGTH),
          })
          try {
            await options.onDiagnostic(diagnostic)
          } catch {
            // Asset diagnostics are advisory and must not poison the serialized reload queue.
          }
        }
        emitReload(ctx, {
          url,
          outcome: 'failed',
          ...(revision === undefined ? {} : { revision }),
        })
      }
    })
  })
  ctx.fiber.effect(() => () => { disposed = true }, `persona asset ${filename}`)

  return Object.freeze({
    filename,
    url,
    async content() {
      await reload
      return content
    },
  })
}
