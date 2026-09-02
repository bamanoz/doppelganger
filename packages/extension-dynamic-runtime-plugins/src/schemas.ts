import type { JsonValue } from '@doppelganger/doppelganger-protocols'

const string = (
  maximum: number,
  pattern?: string,
): Readonly<Record<string, JsonValue>> => Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: maximum,
  ...(pattern === undefined ? {} : { pattern }),
})

const object = (
  properties: Readonly<Record<string, JsonValue>>,
  required: readonly string[] = [],
): Readonly<Record<string, JsonValue>> => Object.freeze({
  type: 'object',
  properties: Object.freeze(properties),
  required: Object.freeze([...required]),
  additionalProperties: false,
})

export const inspectListSchema = object({})

export const inspectQuerySchema = object({
  provider: string(32, '^(Service|Event|Builtin|Tool)$'),
  method: string(64, '^[a-z][a-z0-9-]*$'),
  name: string(256),
}, ['provider', 'method', 'name'])

export const inspectSelfSchema = object({
  pluginId: string(128),
  packageId: string(128),
})

export function defineSchema(maximumNameLength: number, maximumPurposeLength: number, maximumSourceBytes: number) {
  return object({
    pluginId: string(128),
    idPrefix: string(32, '^[a-z][a-z0-9-]{2,31}$'),
    name: string(maximumNameLength),
    purpose: string(maximumPurposeLength),
    source: string(maximumSourceBytes),
  }, ['name', 'purpose', 'source'])
}

export function runSchema(maximumNameLength: number, maximumPurposeLength: number) {
  return object({
    pluginId: string(128),
    packageId: string(128),
    mode: string(6, '^(run|update)$'),
    name: string(maximumNameLength),
    purpose: string(maximumPurposeLength),
    sourceDigest: string(71, '^sha256:[0-9a-f]{64}$'),
  }, ['pluginId', 'packageId', 'mode', 'name', 'purpose', 'sourceDigest'])
}

export const pluginIdentitySchema = object({ pluginId: string(128) }, ['pluginId'])
