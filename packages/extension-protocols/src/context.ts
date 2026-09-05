import { Context, Service, type Logger } from '@deepseek-ai/cordis'
import { cloneJsonValue, type JsonValue } from './json-value.ts'

export type ContextAuthority = 'data' | 'instruction'

export interface ContextTurn {
  readonly input: string
  readonly turnId?: string
}

export interface ContextResolveRequest {
  readonly turn: ContextTurn
  readonly tokenBudget: number
}

export interface ContextContribution {
  readonly source: string
  readonly content: string
  readonly priority: number
  readonly authority: ContextAuthority
  readonly truncate?: boolean
}

export interface ContextProvider {
  readonly id: string
  resolve(request: ContextResolveRequest): readonly ContextContribution[] | Promise<readonly ContextContribution[]>
}

export interface AssembledContext {
  readonly instructions: string
  readonly data: string
  readonly contributions: readonly ContextContribution[]
  readonly omittedSources: readonly string[]
  readonly tokenCount: number
}

export interface ContextProtocolConfig {
  readonly estimateTokens?: (content: string) => number
}

interface RankedContribution {
  readonly contribution: ContextContribution
  readonly providerId: string
  readonly sequence: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    doppelgangerContext: ContextProtocol
  }
}

const ASSEMBLED_CONTEXT_LIMITS = Object.freeze({ maximumBytes: 1024 * 1024, maximumDepth: 8 })

function contextRecord(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Readonly<Record<string, JsonValue>>
}

function exactContextKeys(
  value: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value)
    .filter(key => !required.includes(key) && !optional.includes(key))
    .sort()
  if (unsupported.length > 0) throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  const missing = required.filter(key => !Object.hasOwn(value, key))
  if (missing.length > 0) throw new TypeError(`${label} is missing required fields: ${missing.join(', ')}`)
}

export function defineAssembledContext(input: unknown): AssembledContext {
  const value = cloneJsonValue(input, 'assembled context', ASSEMBLED_CONTEXT_LIMITS)
  const root = contextRecord(value, 'assembled context')
  exactContextKeys(root, ['instructions', 'data', 'contributions', 'omittedSources', 'tokenCount'], [], 'assembled context')
  if (typeof root.instructions !== 'string') throw new TypeError('assembled context.instructions must be a string')
  if (typeof root.data !== 'string') throw new TypeError('assembled context.data must be a string')
  if (!Array.isArray(root.contributions)) throw new TypeError('assembled context.contributions must be an array')
  for (let index = 0; index < root.contributions.length; index += 1) {
    const label = `assembled context.contributions[${index}]`
    const contribution = contextRecord(root.contributions[index]!, label)
    exactContextKeys(contribution, ['source', 'content', 'priority', 'authority'], ['truncate'], label)
    if (typeof contribution.source !== 'string' || contribution.source.trim().length === 0) {
      throw new TypeError(`${label}.source must be a non-empty string`)
    }
    if (typeof contribution.content !== 'string') throw new TypeError(`${label}.content must be a string`)
    if (typeof contribution.priority !== 'number' || !Number.isFinite(contribution.priority)) {
      throw new TypeError(`${label}.priority must be finite`)
    }
    if (contribution.authority !== 'instruction' && contribution.authority !== 'data') {
      throw new TypeError(`${label}.authority must be "instruction" or "data"`)
    }
    if (contribution.truncate !== undefined && typeof contribution.truncate !== 'boolean') {
      throw new TypeError(`${label}.truncate must be a boolean`)
    }
  }
  if (!Array.isArray(root.omittedSources)
    || root.omittedSources.some(source => typeof source !== 'string' || source.trim().length === 0)) {
    throw new TypeError('assembled context.omittedSources must contain non-empty strings')
  }
  if (!Number.isSafeInteger(root.tokenCount) || (root.tokenCount as number) < 0) {
    throw new TypeError('assembled context.tokenCount must be a non-negative safe integer')
  }
  return value as unknown as AssembledContext
}

export class ContextProtocol extends Service {
  private readonly providers = new Map<string, ContextProvider>()
  private readonly estimateTokens: (content: string) => number
  private readonly logger: Logger

  constructor(ctx: Context, config: ContextProtocolConfig = {}) {
    super(ctx, 'doppelgangerContext')
    this.logger = ctx.logger('doppelganger-context')
    this.logger.info('component.active')
    this.estimateTokens = config.estimateTokens ?? ((content) => Math.ceil(Buffer.byteLength(content, 'utf8') / 4))
  }

  register(provider: ContextProvider): () => void {
    const id = provider.id.trim()
    if (id.length === 0) throw new TypeError('context provider id must be non-empty')
    const owned = Object.freeze({ ...provider, id })
    return this.ctx.effect(() => {
      if (this.providers.has(id)) throw new Error(`context provider "${id}" is already registered`)
      this.providers.set(id, owned)
      this.logger.debug('context.provider.registered count=%d', this.providers.size)
      return () => {
        if (this.providers.get(id) === owned) this.providers.delete(id)
        this.logger.debug('context.provider.unregistered count=%d', this.providers.size)
      }
    }, `doppelgangerContext.register(${id})`)
  }

  async resolve(request: ContextResolveRequest): Promise<AssembledContext> {
    if (!Number.isSafeInteger(request.tokenBudget) || request.tokenBudget < 0) {
      this.logger.warn('context.resolve.rejected code=INVALID_TOKEN_BUDGET')
      throw new RangeError('context token budget must be a non-negative safe integer')
    }
    const providers = [...this.providers.values()].sort((left, right) => left.id.localeCompare(right.id))
    this.logger.debug('context.resolve.started providers=%d tokenBudget=%d', providers.length, request.tokenBudget)
    let resolved: readonly (readonly ContextContribution[])[]
    try {
      resolved = await Promise.all(providers.map(provider => provider.resolve(request)))
    } catch (error) {
      this.logger.warn('context.resolve.failed reason=%s', error instanceof Error ? error.name : typeof error)
      throw error
    }
    let sequence = 0
    const ranked: RankedContribution[] = []
    for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
      const provider = providers[providerIndex]!
      const contributions = resolved[providerIndex]!
      for (const contribution of contributions) {
        if (contribution.source.trim().length === 0) {
          this.logger.warn('context.resolve.failed code=INVALID_PROVIDER_SOURCE')
          throw new TypeError(`context provider "${provider.id}" returned an empty source`)
        }
        if (contribution.content.length === 0) continue
        if (!Number.isFinite(contribution.priority)) {
          this.logger.warn('context.resolve.failed code=INVALID_PROVIDER_PRIORITY')
          throw new TypeError(`context provider "${provider.id}" returned a non-finite priority`)
        }
        ranked.push({ contribution, providerId: provider.id, sequence: sequence += 1 })
      }
    }
    ranked.sort((left, right) => (
      right.contribution.priority - left.contribution.priority
      || left.contribution.source.localeCompare(right.contribution.source)
      || left.providerId.localeCompare(right.providerId)
      || left.sequence - right.sequence
    ))

    const accepted: ContextContribution[] = []
    const omittedSources: string[] = []
    let accountingContent = ''
    for (const { contribution } of ranked) {
      const candidate = accountingContent.length === 0
        ? contribution.content
        : `${accountingContent}\n\n${contribution.content}`
      if (this.estimateTokens(candidate) <= request.tokenBudget) {
        accepted.push(Object.freeze({ ...contribution }))
        accountingContent = candidate
        continue
      }
      if (contribution.truncate !== true) {
        omittedSources.push(contribution.source)
        continue
      }

      const prefix = accountingContent.length === 0 ? '' : `${accountingContent}\n\n`
      let low = 0
      let high = contribution.content.length
      let truncated = ''
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidatePart = `${contribution.content.slice(0, middle).trimEnd()}…`
        if (this.estimateTokens(`${prefix}${candidatePart}`) <= request.tokenBudget) {
          truncated = candidatePart
          low = middle + 1
        } else {
          high = middle - 1
        }
      }
      if (truncated.length === 0) {
        omittedSources.push(contribution.source)
        continue
      }
      const acceptedContribution = Object.freeze({ ...contribution, content: truncated })
      accepted.push(acceptedContribution)
      accountingContent = `${prefix}${truncated}`
    }

    const instructions = accepted
      .filter(contribution => contribution.authority === 'instruction')
      .map(contribution => contribution.content)
      .join('\n\n')
    const data = accepted
      .filter(contribution => contribution.authority === 'data')
      .map(contribution => contribution.content)
      .join('\n\n')
    const result = Object.freeze({
      instructions,
      data,
      contributions: Object.freeze(accepted),
      omittedSources: Object.freeze(omittedSources),
      tokenCount: this.estimateTokens(accountingContent),
    })
    this.logger.debug('context.resolve.completed accepted=%d omitted=%d', accepted.length, omittedSources.length)
    return result
  }
}
