import { Context, Service } from '@deepseek-ai/cordis'

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
  readonly content: string
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

export class ContextProtocol extends Service {
  private readonly providers = new Map<string, ContextProvider>()
  private readonly estimateTokens: (content: string) => number

  constructor(ctx: Context, config: ContextProtocolConfig = {}) {
    super(ctx, 'doppelgangerContext')
    this.estimateTokens = config.estimateTokens ?? ((content) => Math.ceil(Buffer.byteLength(content, 'utf8') / 4))
  }

  register(provider: ContextProvider): () => void {
    const id = provider.id.trim()
    if (id.length === 0) throw new TypeError('context provider id must be non-empty')
    const owned = Object.freeze({ ...provider, id })
    return this.ctx.effect(() => {
      if (this.providers.has(id)) throw new Error(`context provider "${id}" is already registered`)
      this.providers.set(id, owned)
      return () => {
        if (this.providers.get(id) === owned) this.providers.delete(id)
      }
    }, `doppelgangerContext.register(${id})`)
  }

  async resolve(request: ContextResolveRequest): Promise<AssembledContext> {
    if (!Number.isSafeInteger(request.tokenBudget) || request.tokenBudget < 0) {
      throw new RangeError('context token budget must be a non-negative safe integer')
    }
    const providers = [...this.providers.values()].sort((left, right) => left.id.localeCompare(right.id))
    const resolved = await Promise.all(providers.map(provider => provider.resolve(request)))
    let sequence = 0
    const ranked: RankedContribution[] = []
    for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
      const provider = providers[providerIndex]!
      const contributions = resolved[providerIndex]!
      for (const contribution of contributions) {
        if (contribution.source.trim().length === 0) {
          throw new TypeError(`context provider "${provider.id}" returned an empty source`)
        }
        if (contribution.content.length === 0) continue
        if (!Number.isFinite(contribution.priority)) {
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
    let content = ''
    for (const { contribution } of ranked) {
      const candidate = content.length === 0 ? contribution.content : `${content}\n\n${contribution.content}`
      if (this.estimateTokens(candidate) <= request.tokenBudget) {
        accepted.push(Object.freeze({ ...contribution }))
        content = candidate
        continue
      }
      if (contribution.truncate !== true) {
        omittedSources.push(contribution.source)
        continue
      }

      const prefix = content.length === 0 ? '' : `${content}\n\n`
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
      content = `${prefix}${truncated}`
    }

    return Object.freeze({
      content,
      contributions: Object.freeze(accepted),
      omittedSources: Object.freeze(omittedSources),
      tokenCount: this.estimateTokens(content),
    })
  }
}
