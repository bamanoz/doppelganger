import '@doppelganger/doppelganger-composition-runtime'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { JsonValue, ToolDefinition } from '@doppelganger/doppelganger-protocols'
import {
  CODEGRAPH_LIMITS,
  CodeGraphPluginConfigSchema,
  normalizeCodeGraphPluginConfig,
  type CodeGraphPluginConfig,
  type NormalizedCodeGraphPluginConfig,
} from './config.ts'
import { CodeGraphAdapter } from './adapter.ts'
import { CodeGraphError } from './errors.ts'

export type { CodeGraphPluginConfig } from './config.ts'

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
})

const EXPLORE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    query: Object.freeze({ type: 'string', minLength: 1, maxLength: CODEGRAPH_LIMITS.maximumQueryBytes }),
    maxFiles: Object.freeze({ type: 'integer', minimum: 1, maximum: CODEGRAPH_LIMITS.maximumMaxFiles }),
  }),
  required: Object.freeze(['query']),
  additionalProperties: false,
})

function sameConfig(left: NormalizedCodeGraphPluginConfig, right: NormalizedCodeGraphPluginConfig): boolean {
  return left.executable === right.executable
    && left.statusTimeoutMs === right.statusTimeoutMs
    && left.syncTimeoutMs === right.syncTimeoutMs
    && left.exploreTimeoutMs === right.exploreTimeoutMs
    && left.shutdownTimeoutMs === right.shutdownTimeoutMs
    && left.maximumExploreOutputBytes === right.maximumExploreOutputBytes
    && left.defaultMaxFiles === right.defaultMaxFiles
    && left.maximumConcurrentExplorations === right.maximumConcurrentExplorations
    && left.maximumQueuedExplorations === right.maximumQueuedExplorations
}

function inputRecord(input: JsonValue): Readonly<Record<string, JsonValue>> {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new CodeGraphError('CODEGRAPH_INVALID_INPUT', 'tool input must be an object')
  }
  return input as Readonly<Record<string, JsonValue>>
}

function exploreInput(input: JsonValue, config: NormalizedCodeGraphPluginConfig): { readonly query: string; readonly maxFiles: number } {
  const value = inputRecord(input)
  const unknown = Object.keys(value).filter(key => key !== 'query' && key !== 'maxFiles')
  if (unknown.length > 0) throw new CodeGraphError('CODEGRAPH_INVALID_INPUT', `unsupported input fields: ${unknown.sort().join(', ')}`)
  if (typeof value.query !== 'string') throw new CodeGraphError('CODEGRAPH_INVALID_INPUT', 'query must be a string')
  const query = value.query.trim()
  if (query.length === 0 || Buffer.byteLength(query, 'utf8') > CODEGRAPH_LIMITS.maximumQueryBytes) {
    throw new CodeGraphError('CODEGRAPH_INVALID_INPUT', `query must contain between 1 and ${CODEGRAPH_LIMITS.maximumQueryBytes} UTF-8 bytes`)
  }
  const maxFiles = value.maxFiles ?? config.defaultMaxFiles
  if (typeof maxFiles !== 'number' || !Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > CODEGRAPH_LIMITS.maximumMaxFiles) {
    throw new CodeGraphError('CODEGRAPH_INVALID_INPUT', `maxFiles must be an integer between 1 and ${CODEGRAPH_LIMITS.maximumMaxFiles}`)
  }
  return Object.freeze({ query, maxFiles })
}

function definitions(adapter: CodeGraphAdapter, config: NormalizedCodeGraphPluginConfig): readonly ToolDefinition[] {
  return Object.freeze([
    {
      name: 'codegraph.status',
      description: 'Diagnose the local CodeGraph prerequisite and index for this Runtime Session workspace.',
      inputSchema: EMPTY_OBJECT_SCHEMA,
      async invoke(input, _context) {
        const value = inputRecord(input)
        if (Object.keys(value).length > 0) throw new CodeGraphError('CODEGRAPH_INVALID_INPUT', 'codegraph.status accepts no fields')
        return await adapter.status() as unknown as JsonValue
      },
    },
    {
      name: 'codegraph.explore',
      description: 'Return bounded graph-ranked source context and call paths from the existing local CodeGraph index.',
      inputSchema: EXPLORE_SCHEMA,
      async invoke(input, _context) {
        const value = exploreInput(input, config)
        return await adapter.explore(value.query, value.maxFiles) as unknown as JsonValue
      },
    },
  ] satisfies readonly ToolDefinition[])
}

export const CodeGraphPlugin: Plugin<CodeGraphPluginConfig> = {
  name: 'doppelganger-codegraph',
  Config: CodeGraphPluginConfigSchema as NonNullable<Plugin<CodeGraphPluginConfig>['Config']>,
  inject: ['doppelgangerRuntimeSession', 'doppelgangerTools'],
  apply(ctx: Context, input: CodeGraphPluginConfig = {}) {
    const config = normalizeCodeGraphPluginConfig(input)
    ctx.on('internal/update', (nextInput, _noSave, next) => {
      const nextConfig = normalizeCodeGraphPluginConfig(nextInput)
      if (sameConfig(config, nextConfig)) return
      return next()
    })
    const adapter = new CodeGraphAdapter(ctx.doppelgangerRuntimeSession.workspaceRoot, config)
    for (const definition of definitions(adapter, config)) ctx.doppelgangerTools.register(definition)
    ctx.effect(() => () => adapter.dispose(), 'codegraph.dispose')
  },
}

export default CodeGraphPlugin
