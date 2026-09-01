import { isAbsolute, normalize } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'

export const RUNTIME_SESSION_SERVICE = 'doppelgangerRuntimeSession' as const

export interface RuntimeSessionMetadataInput {
  readonly sessionId: string
  readonly runtimePresetId: string
  readonly workspaceRoot?: string
}

export interface RuntimeSessionMetadata {
  readonly sessionId: string
  readonly runtimePresetId: string
  readonly workspaceRoot?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerRuntimeSession: RuntimeSessionMetadata
  }
}

function nonEmpty(field: string, value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return normalized
}

export function createRuntimeSessionMetadata(input: RuntimeSessionMetadataInput): RuntimeSessionMetadata {
  let workspaceRoot: string | undefined
  if (input.workspaceRoot !== undefined) {
    workspaceRoot = normalize(nonEmpty('runtimeSession.workspaceRoot', input.workspaceRoot))
    if (!isAbsolute(workspaceRoot)) throw new TypeError('runtimeSession.workspaceRoot must be absolute')
  }
  return Object.freeze({
    sessionId: nonEmpty('runtimeSession.sessionId', input.sessionId),
    runtimePresetId: nonEmpty('runtimeSession.runtimePresetId', input.runtimePresetId),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  })
}

export function createRuntimeSessionMetadataPlugin(input: RuntimeSessionMetadataInput): Plugin {
  const metadata = createRuntimeSessionMetadata(input)
  return {
    name: 'doppelganger-runtime-session-metadata',
    apply(ctx: Context) {
      ctx.provide(RUNTIME_SESSION_SERVICE, metadata)
    },
  }
}
