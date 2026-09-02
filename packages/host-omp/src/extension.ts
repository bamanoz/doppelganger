import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromJsonSchema } from '@oh-my-pi/omptype/from-json-schema'
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import type { CompositionPatchInput } from '@doppelganger/doppelganger-composition-runtime'
import {
  createRuntimePresetRoster,
  type RuntimePresetRosterConfig,
} from '@doppelganger/doppelganger-runtime-presets'
import {
  LIFECYCLE_PROTOCOL_VERSION,
  createActorIdentity,
  serializeLifecycleValue,
  type JsonValue,
  type LifecycleError,
  type LifecycleEvent,
  type ToolDescriptor,
} from '@doppelganger/doppelganger-protocols'
import { OmpAdapterSession, discoverOmpProject, type OmpChildFactory } from './adapter.ts'
import { defineSerializedOmpActivation, type SerializedOmpActivation } from './contracts.ts'
import { NodeOmpChildFactory } from './process.ts'

const INITIALIZE_TOOL = 'doppelganger_initialize'
const PROXY_PREFIX = 'doppelganger_'
const OMP_TOOL_NAME_LIMIT = 64

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$comment', '$defs', '$id', '$ref', '$schema',
  'additionalProperties', 'allOf', 'anyOf', 'const', 'default', 'definitions',
  'deprecated', 'description', 'enum', 'examples', 'exclusiveMaximum',
  'exclusiveMinimum', 'format', 'items', 'maximum', 'maxItems', 'maxLength',
  'minimum', 'minItems', 'minLength', 'multipleOf', 'not', 'oneOf', 'pattern',
  'prefixItems', 'properties', 'readOnly', 'required', 'title', 'type', 'writeOnly',
])
const SUPPORTED_SCHEMA_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'])
const SUPPORTED_STRING_FORMATS = new Set([
  'date', 'date-time', 'email', 'ipv4', 'ipv6', 'regex', 'uri', 'url', 'uuid',
])

function schemaObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${path} must be a JSON Schema object`)
  }
  return value as Record<string, unknown>
}

function schemaArray(value: unknown, path: string, allowEmpty = false): readonly unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
}

function finiteNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`)
}

function validateToolJsonSchema(schema: unknown, path = '$'): void {
  if (typeof schema === 'boolean') return
  const node = schemaObject(schema, path)
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      throw new TypeError(`${path}.${key} is not supported by the OMP JSON Schema translator`)
    }
  }

  if ('oneOf' in node) throw new TypeError(`${path}.oneOf is not supported by the OMP JSON Schema translator`)
  if (node.$ref !== undefined) {
    if (typeof node.$ref !== 'string' || !/^#(?:$|\/(?:\$defs|definitions)\/[^/]+$)/.test(node.$ref)) {
      throw new TypeError(`${path}.$ref must be "#" or a local $defs/definitions reference`)
    }
    const structuralSiblings = Object.keys(node).filter(key => ![
      '$comment', '$defs', '$id', '$ref', '$schema', 'definitions', 'description', 'title',
    ].includes(key))
    if (structuralSiblings.length > 0) {
      throw new TypeError(`${path}.$ref cannot have structural sibling keywords`)
    }
  }

  if (node.type !== undefined) {
    const types = typeof node.type === 'string' ? [node.type] : schemaArray(node.type, `${path}.type`)
    for (const type of types) {
      if (typeof type !== 'string' || !SUPPORTED_SCHEMA_TYPES.has(type)) {
        throw new TypeError(`${path}.type contains unsupported type ${JSON.stringify(type)}`)
      }
    }
    if (new Set(types).size !== types.length) throw new TypeError(`${path}.type must not contain duplicates`)
  }
  if (node.enum !== undefined) schemaArray(node.enum, `${path}.enum`)
  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const) {
    if (node[keyword] !== undefined) finiteNumber(node[keyword], `${path}.${keyword}`)
  }
  if (typeof node.multipleOf === 'number' && node.multipleOf <= 0) {
    throw new TypeError(`${path}.multipleOf must be greater than zero`)
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (node[keyword] !== undefined) nonNegativeInteger(node[keyword], `${path}.${keyword}`)
  }
  if (node.pattern !== undefined) {
    if (typeof node.pattern !== 'string') throw new TypeError(`${path}.pattern must be a string`)
    try {
      new RegExp(node.pattern)
    } catch (cause) {
      throw new TypeError(`${path}.pattern must be a valid regular expression`, { cause })
    }
  }
  if (node.format !== undefined && (typeof node.format !== 'string' || !SUPPORTED_STRING_FORMATS.has(node.format))) {
    throw new TypeError(`${path}.format is not supported by the OMP JSON Schema translator`)
  }

  if (node.required !== undefined) {
    const required = schemaArray(node.required, `${path}.required`, true)
    if (required.some(value => typeof value !== 'string')) throw new TypeError(`${path}.required must contain only strings`)
    if (new Set(required).size !== required.length) throw new TypeError(`${path}.required must not contain duplicates`)
  }
  if (node.properties !== undefined) {
    const properties = schemaObject(node.properties, `${path}.properties`)
    for (const [name, property] of Object.entries(properties)) validateToolJsonSchema(property, `${path}.properties.${name}`)
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    validateToolJsonSchema(node.additionalProperties, `${path}.additionalProperties`)
  }
  for (const keyword of ['$defs', 'definitions'] as const) {
    if (node[keyword] === undefined) continue
    const definitions = schemaObject(node[keyword], `${path}.${keyword}`)
    for (const [name, definition] of Object.entries(definitions)) validateToolJsonSchema(definition, `${path}.${keyword}.${name}`)
  }
  for (const keyword of ['allOf', 'anyOf'] as const) {
    if (node[keyword] === undefined) continue
    schemaArray(node[keyword], `${path}.${keyword}`).forEach((branch, index) => {
      validateToolJsonSchema(branch, `${path}.${keyword}[${index}]`)
    })
  }
  if (node.not !== undefined) {
    const negated = schemaObject(node.not, `${path}.not`)
    if (Object.keys(negated).length !== 0) throw new TypeError(`${path}.not only supports the empty schema`)
  }
  if (node.prefixItems !== undefined) {
    schemaArray(node.prefixItems, `${path}.prefixItems`, true).forEach((item, index) => {
      validateToolJsonSchema(item, `${path}.prefixItems[${index}]`)
    })
  }
  if (node.items !== undefined) {
    if (Array.isArray(node.items)) throw new TypeError(`${path}.items tuple arrays are not supported; use prefixItems`)
    validateToolJsonSchema(node.items, `${path}.items`)
  }
}

export function ompToolParametersFromJsonSchema(schema: unknown) {
  validateToolJsonSchema(schema)
  return fromJsonSchema(schema)
}

export interface OmpActivationRequest {
  readonly cwd: string
  readonly sessionId: string
}

export interface DoppelgangerOmpExtensionOptions {
  readonly home?: string
  readonly actorId?: string
  readonly explicitRuntimePreset?: string
  readonly runtimePresets?: Omit<RuntimePresetRosterConfig, 'home'>
  readonly patches?: readonly CompositionPatchInput[]
  readonly watch?: boolean
  readonly childFactory?: OmpChildFactory
  readonly childPath?: string
  readonly tokenBudget?: number
  readonly shutdownTimeoutMs?: number
}

export const DEFAULT_OMP_CHILD_PATH = fileURLToPath(new URL('./child.ts', import.meta.url))

export function resolveOmpChildPath(options: Pick<DoppelgangerOmpExtensionOptions, 'childPath'>): string {
  return options.childPath ?? DEFAULT_OMP_CHILD_PATH
}

function runtimePresetRoster(options: DoppelgangerOmpExtensionOptions) {
  return createRuntimePresetRoster({
    ...(options.runtimePresets ?? {}),
    ...(options.home === undefined ? {} : { home: options.home }),
  })
}

export async function resolveOmpActivation(
  options: DoppelgangerOmpExtensionOptions,
  request: OmpActivationRequest,
): Promise<SerializedOmpActivation | undefined> {
  const actor = createActorIdentity(options.actorId)
  const project = await discoverOmpProject(request.cwd)
  const selection = await runtimePresetRoster(options).select({
    ...(options.explicitRuntimePreset === undefined ? {} : { explicitRuntimePreset: options.explicitRuntimePreset }),
    ...(project?.manifestPath === undefined ? {} : { projectManifestPath: project.manifestPath }),
  })
  if (selection === undefined) return
  return defineSerializedOmpActivation({
    composition: {
      id: selection.preset.id,
      revision: selection.preset.revision,
      loaderPath: selection.preset.loaderPath,
      patches: [
        { source: 'user Runtime Preset patch', filename: selection.userPatchPath, optional: true },
        ...(selection.projectPatchPath === undefined
          ? []
          : [{ source: 'project Runtime Preset patch', filename: selection.projectPatchPath, optional: true }]),
        ...(options.patches ?? []),
      ],
    },
    sessionId: request.sessionId,
    ...(project === undefined ? {} : { workspaceRoot: project.workspaceRoot }),
    ...(actor.state === 'bound' ? { actorId: actor.actorId } : {}),
    hostKind: 'omp',
    ...(options.watch === undefined ? {} : { watch: options.watch }),
  })
}

interface ActiveTurn {
  readonly id: string
  readonly principalInput: string
  started: boolean
}

function proxyName(runtimeName: string): string {
  const name = `${PROXY_PREFIX}${runtimeName.replaceAll('.', '_')}`
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new TypeError(`portable tool "${runtimeName}" maps to an OMP proxy with unsupported characters`)
  }
  if (name.length > OMP_TOOL_NAME_LIMIT) {
    throw new TypeError(
      `portable tool "${runtimeName}" maps to a ${name.length}-character OMP proxy; limit is ${OMP_TOOL_NAME_LIMIT}`,
    )
  }
  return name
}

const APPROVAL_ARGUMENT_LIMIT = 2_000

function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value === null || typeof value !== 'object') return value
  const record = value as { readonly [key: string]: JsonValue }
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalJson(record[key]!)]))
}

function boundedApprovalArguments(value: unknown): string {
  const encoded = JSON.stringify(canonicalJson(jsonValue(value)), null, 2)
  if (encoded.length <= APPROVAL_ARGUMENT_LIMIT) return encoded
  const omitted = encoded.length - APPROVAL_ARGUMENT_LIMIT
  return `${encoded.slice(0, APPROVAL_ARGUMENT_LIMIT)}[…${omitted}ch elided…]`
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    details: value,
    ...(isError ? { isError: true } : {}),
  }
}

function messageText(message: unknown): string | undefined {
  if (message === null || typeof message !== 'object' || !('content' in message)) return
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return
  const parts = content.flatMap(part => {
    if (part !== null && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      return [part.text]
    }
    return []
  })
  return parts.length === 0 ? undefined : parts.join('\n')
}

function continuesAfterTurn(message: unknown): boolean {
  if (message === null || typeof message !== 'object') return false
  if ('stopReason' in message && message.stopReason === 'toolUse') return true
  if (!('content' in message) || !Array.isArray(message.content)) return false
  return message.content.some(part => (
    part !== null && typeof part === 'object' && 'type' in part && part.type === 'toolCall'
  ))
}

function turnOutcome(message: unknown): 'completed' | 'failed' | 'cancelled' {
  if (message === null || typeof message !== 'object' || !('stopReason' in message)) return 'completed'
  if (message.stopReason === 'aborted') return 'cancelled'
  if (message.stopReason === 'error') return 'failed'
  return 'completed'
}

function lifecycleFailure(code: string, fallback: string, value: unknown): LifecycleError {
  return Object.freeze({
    code,
    message: messageText(value) ?? fallback,
    data: serializeLifecycleValue(value),
  })
}


function messageTimestamp(message: unknown): number {
  if (message !== null && typeof message === 'object' && 'timestamp' in message
    && typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) return message.timestamp
  return Date.now()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ]).finally(() => {
    clearTimeout(timer)
  })
}

export function createDoppelgangerOmpExtension(options: DoppelgangerOmpExtensionOptions) {
  return function doppelgangerExtension(pi: ExtensionAPI): void {
    let adapter: OmpAdapterSession | undefined
    let turn: ActiveTurn | undefined
    let turnOrdinal = 0
    let preCompactionOrdinal = 0
    const activeDescriptors = new Map<string, ToolDescriptor>()
    const registeredProxyNames = new Map<string, string>()

    const report = (ctx: ExtensionContext, message: string) => {
      pi.logger.error(message)
      if (ctx.hasUI) ctx.ui.notify(message, 'error')
    }

    const deliveryId = (sessionId: string, type: string, identity = 'session') => (
      `${sessionId}:${type}:${identity}`
    )

    const setProjectedTools = async (tools: readonly ToolDescriptor[], ctx: ExtensionContext) => {
      const available = tools.filter(tool => tool.available)
      const candidates: Array<{ readonly descriptor: ToolDescriptor; readonly name: string }> = []
      const candidateNames = new Map<string, Set<string>>()
      const seenPortableNames = new Set<string>()

      for (const descriptor of available) {
        if (seenPortableNames.has(descriptor.name)) {
          report(ctx, `Doppelganger: runtime returned duplicate tool "${descriptor.name}"`)
          continue
        }
        seenPortableNames.add(descriptor.name)

        let name: string
        try {
          name = proxyName(descriptor.name)
        } catch (cause) {
          report(ctx, `Doppelganger: ${cause instanceof Error ? cause.message : String(cause)}`)
          continue
        }
        candidates.push({ descriptor, name })
        const portableNames = candidateNames.get(name) ?? new Set<string>()
        portableNames.add(descriptor.name)
        candidateNames.set(name, portableNames)
      }

      const collidedNames = new Set<string>()
      for (const [name, portableNames] of candidateNames) {
        if (portableNames.size < 2) continue
        collidedNames.add(name)
        report(
          ctx,
          `Doppelganger: runtime tools ${[...portableNames].map(portableName => `"${portableName}"`).join(' and ')} map to the same OMP proxy "${name}"`,
        )
      }

      const next = new Map<string, ToolDescriptor>()
      const projectedNames = new Set<string>()
      for (const { descriptor, name } of candidates) {
        if (collidedNames.has(name)) continue
        const registeredPortableName = registeredProxyNames.get(name)
        if (registeredPortableName !== undefined && registeredPortableName !== descriptor.name) {
          report(
            ctx,
            `Doppelganger: runtime tools "${registeredPortableName}" and "${descriptor.name}" map to the same OMP proxy "${name}"`,
          )
          continue
        }

        try {
          const projected = {
            name,
            label: `Doppelganger: ${descriptor.name}`,
            description: descriptor.description,
            parameters: ompToolParametersFromJsonSchema(descriptor.inputSchema),
            loadMode: descriptor.approval === undefined ? 'discoverable' as const : 'essential' as const,
            approval: () => {
              const approval = activeDescriptors.get(descriptor.name)?.approval
              return approval === undefined
                ? 'exec' as const
                : { tier: 'write', policy: 'prompt', reason: approval.reason } as const
            },
            formatApprovalDetails: (params: unknown) => {
              const active = activeDescriptors.get(descriptor.name)
              if (active?.approval === undefined) return
              return [
                `Portable tool: ${active.name}`,
                `Arguments: ${boundedApprovalArguments(params)}`,
              ]
            },
            async execute(_callId: string, params: unknown) {
              const active = activeDescriptors.get(descriptor.name)
              const connection = adapter?.connection()
              if (active === undefined || connection === undefined
                || registeredProxyNames.get(name) !== descriptor.name) {
                return textResult({ code: 'RUNTIME_UNAVAILABLE', message: 'runtime tool is inactive' }, true)
              }
              try {
                const result = await connection.request('tools.invoke', {
                  name: active.name,
                  input: jsonValue(params),
                }) as { ok: boolean; value?: unknown; error?: unknown }
                return result.ok ? textResult(result.value) : textResult(result.error, true)
              } catch (cause) {
                await adapter?.fail({ code: 'TOOL_PROXY_FAILED', message: cause instanceof Error ? cause.message : String(cause) })
                return textResult({ code: 'TOOL_PROXY_FAILED', message: cause instanceof Error ? cause.message : String(cause) }, true)
              }
            },
          }
          pi.registerTool(projected)
          registeredProxyNames.set(name, descriptor.name)
          projectedNames.add(name)
          next.set(descriptor.name, descriptor)
        } catch (cause) {
          report(
            ctx,
            `Doppelganger: cannot project portable tool "${descriptor.name}": ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
      }
      activeDescriptors.clear()
      for (const [name, descriptor] of next) activeDescriptors.set(name, descriptor)
      const existing = pi.getActiveTools().filter(name => !name.startsWith(PROXY_PREFIX) && name !== INITIALIZE_TOOL)
      const initialize = adapter?.snapshot().initializationAvailable === true ? [INITIALIZE_TOOL] : []
      await pi.setActiveTools([...existing, ...projectedNames, ...initialize])
    }

    const publish = async (event: LifecycleEvent) => {
      const connection = adapter?.connection()
      if (connection === undefined) return
      try {
        await connection.request('event.publish', event)
      } catch (cause) {
        await adapter?.fail({ code: 'EVENT_FORWARD_FAILED', message: cause instanceof Error ? cause.message : String(cause) })
      }
    }

    const start = async (ctx: ExtensionContext) => {
      if (adapter !== undefined) return adapter.snapshot()
      const childFactory = options.childFactory ?? new NodeOmpChildFactory({
        childPath: resolveOmpChildPath(options),
        ...(options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
        onNotificationObserverError: diagnostic => {
          report(ctx, `Doppelganger RPC notification observer ${diagnostic.method}: ${diagnostic.message}`)
        },
      })
      const sessionId = ctx.sessionManager.getSessionId()
      let activation: SerializedOmpActivation | undefined
      try {
        activation = await resolveOmpActivation(options, { cwd: ctx.cwd, sessionId })
      } catch (cause) {
        const code = cause !== null && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
          ? cause.code
          : 'ACTIVATION_RESOLUTION_FAILED'
        adapter = new OmpAdapterSession({ childFactory })
        await adapter.fail({ code, message: cause instanceof Error ? cause.message : String(cause) })
        report(ctx, `Doppelganger: ${adapter.snapshot().diagnostic!.message}`)
        return adapter.snapshot()
      }
      adapter = new OmpAdapterSession({
        ...(activation === undefined ? {} : { activation }),
        childFactory,
        onToolsChanged: tools => setProjectedTools(tools, ctx),
        notifyDiagnostic: problem => report(ctx, `Doppelganger: ${problem.message}`),
      })
      const snapshot = await adapter.start()
      await setProjectedTools(snapshot.tools, ctx)
      if (snapshot.state === 'active') {
        await publish({
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'session-started',
          deliveryId: deliveryId(sessionId, 'session-started'),
          sessionId,
          timestamp: Date.now(),
        })
      }
      return snapshot
    }

    pi.registerTool({
      name: INITIALIZE_TOOL,
      label: 'Initialize Doppelganger',
      description: 'Select and activate a discovered Runtime Preset for this workspace.',
      defaultInactive: true,
      parameters: pi.zod.object({
        runtimePreset: pi.zod.string().min(1),
      }),
      async execute(_callId, params, _signal, _onUpdate, ctx) {
        if (params === null || typeof params !== 'object' || !('runtimePreset' in params)
          || typeof params.runtimePreset !== 'string') {
          return textResult({ code: 'INVALID_RUNTIME_PRESET', message: 'runtimePreset must be a string' }, true)
        }
        const runtimePreset = params.runtimePreset
        if (adapter?.snapshot().state === 'active') return textResult({ active: true })
        try {
          await runtimePresetRoster(options).select({ explicitRuntimePreset: runtimePreset })
          const project = await discoverOmpProject(ctx.cwd)
          const workspaceRoot = project?.workspaceRoot ?? resolve(ctx.cwd)
          const directory = join(workspaceRoot, '.doppelganger')
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, 'manifest.yaml'), [
            'version: 1',
            `runtimePreset: ${JSON.stringify(runtimePreset)}`,
            '',
          ].join('\n'))
          await adapter?.dispose()
          adapter = undefined
          const snapshot = await start(ctx)
          return snapshot.state === 'active'
            ? textResult({ active: true, runtimePreset })
            : textResult(snapshot.diagnostic ?? { code: 'ACTIVATION_FAILED' }, true)
        } catch (cause) {
          return textResult({
            code: cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'INITIALIZATION_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }, true)
        }
      },
    })

    pi.on('session_start', async (_event, ctx) => { await start(ctx) })
    pi.on('before_agent_start', async (event, ctx) => {
      const snapshot = await start(ctx)
      if (snapshot.state !== 'active') return
      const sessionId = ctx.sessionManager.getSessionId()
      const currentTurn: ActiveTurn = {
        id: `${sessionId}:turn:${++turnOrdinal}`,
        principalInput: event.prompt,
        started: false,
      }
      turn = currentTurn
      try {
        const connection = adapter?.connection()
        if (connection === undefined) return
        const assembled = await connection.request('context.resolve', {
          input: event.prompt,
          turnId: currentTurn.id,
          tokenBudget: options.tokenBudget ?? 4000,
        }) as { content: string }
        if (assembled.content.length === 0) return
        return { systemPrompt: [...event.systemPrompt, assembled.content] }
      } catch (cause) {
        await adapter?.fail({ code: 'CONTEXT_PROJECTION_FAILED', message: cause instanceof Error ? cause.message : String(cause) })
        return
      }
    })
    pi.on('turn_start', async (event, ctx) => {
      if (turn === undefined || turn.started) return
      turn.started = true
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-started',
        deliveryId: deliveryId(ctx.sessionManager.getSessionId(), 'turn-started', turn.id),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: turn.id,
        timestamp: event.timestamp,
        principalInput: serializeLifecycleValue(turn.principalInput),
      })
    })
    pi.on('tool_execution_start', async (event, ctx) => {
      if (turn === undefined) return
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'tool-started',
        deliveryId: deliveryId(ctx.sessionManager.getSessionId(), 'tool-started', event.toolCallId),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: turn.id,
        callId: event.toolCallId,
        name: event.toolName,
        timestamp: Date.now(),
        input: serializeLifecycleValue(event.args),
      })
    })
    pi.on('tool_execution_end', async (event, ctx) => {
      if (turn === undefined) return
      const outcome = event.isError ? 'failed' : 'completed'
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'tool-completed',
        deliveryId: deliveryId(ctx.sessionManager.getSessionId(), 'tool-completed', event.toolCallId),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: turn.id,
        callId: event.toolCallId,
        name: event.toolName,
        timestamp: Date.now(),
        outcome,
        result: serializeLifecycleValue(event.result),
        ...(event.isError
          ? { error: lifecycleFailure('OMP_TOOL_FAILED', `OMP tool "${event.toolName}" failed`, event.result) }
          : {}),
      })
    })
    pi.on('turn_end', async (event, ctx) => {
      if (turn === undefined) return
      if (continuesAfterTurn(event.message)) return
      const completedTurn = turn
      const outcome = turnOutcome(event.message)
      turn = undefined
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'turn-committed',
        deliveryId: deliveryId(ctx.sessionManager.getSessionId(), 'turn-committed', completedTurn.id),
        sessionId: ctx.sessionManager.getSessionId(),
        turnId: completedTurn.id,
        timestamp: messageTimestamp(event.message),
        principalInput: serializeLifecycleValue(completedTurn.principalInput),
        assistantOutput: serializeLifecycleValue(messageText(event.message) ?? ''),
        outcome,
        ...(outcome === 'failed'
          ? { error: lifecycleFailure('OMP_ASSISTANT_FAILED', 'OMP assistant turn failed', event.message) }
          : {}),
      })
    })
    pi.on('session_before_compact', async (event, ctx) => {
      await publish({
        protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
        type: 'pre-compaction',
        deliveryId: deliveryId(ctx.sessionManager.getSessionId(), 'pre-compaction', String(++preCompactionOrdinal)),
        sessionId: ctx.sessionManager.getSessionId(),
        timestamp: Date.now(),
        ...(turn === undefined ? {} : { turnId: turn.id }),
        material: serializeLifecycleValue({
          preparation: event.preparation,
          branchEntries: event.branchEntries,
          ...(event.customInstructions === undefined ? {} : { customInstructions: event.customInstructions }),
        }),
      })
    })
    pi.on('session_shutdown', (_event, ctx) => {
      const closing = adapter
      turn = undefined
      if (closing === undefined) return
      const sessionId = ctx.sessionManager.getSessionId()
      const connection = closing.connection()
      adapter = undefined
      void (async () => {
        if (connection !== undefined) await withTimeout(connection.request('event.publish', {
          protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
          type: 'session-disposed',
          deliveryId: deliveryId(sessionId, 'session-disposed'),
          sessionId,
          timestamp: Date.now(),
          reason: 'OMP session shutdown without completion outcome',
        }), options.shutdownTimeoutMs ?? 2000, 'session disposal notification').catch(cause => {
          report(ctx, `Doppelganger: ${cause instanceof Error ? cause.message : String(cause)}`)
        })
        const disposal = await closing.dispose()
        if (disposal.outcome !== 'graceful' || !disposal.sessionDisposeAcknowledged) {
          report(ctx, `Doppelganger: runtime shutdown ${disposal.outcome}; session acknowledgement=${String(disposal.sessionDisposeAcknowledged)}`)
        }
        if (disposal.diagnostic !== undefined) {
          report(ctx, `Doppelganger: runtime shutdown diagnostic: ${disposal.diagnostic}`)
        }
      })().catch(cause => {
        report(ctx, `Doppelganger: runtime shutdown failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      })
    })
  }
}
