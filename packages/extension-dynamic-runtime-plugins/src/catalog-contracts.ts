import type {
  ContextContribution,
  ContextProvider,
  ContextResolveRequest,
  ToolDefinition,
  ToolDescriptor,
  ToolRegistration,
} from '@doppelganger/doppelganger-protocols'

export interface DynamicRuntimeHttpRequest {
  readonly url: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly timeoutMs?: number
}

export interface DynamicRuntimeHttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface DynamicRuntimeHttpService {
  request(input: DynamicRuntimeHttpRequest): Promise<DynamicRuntimeHttpResponse>
}

export interface DynamicRuntimeCatalogContracts {
  readonly context: {
    register(provider: ContextProvider): () => void
    resolve(request: ContextResolveRequest): Promise<{
      readonly content: string
      readonly contributions: readonly ContextContribution[]
      readonly omittedSources: readonly string[]
      readonly tokenCount: number
    }>
  }
  readonly tools: {
    register(definition: ToolDefinition): ToolRegistration
    list(): readonly ToolDescriptor[]
  }
  readonly timer: {
    timeout(callback: () => void, delay: number): () => void
    interval(callback: () => void, delay: number): () => void
  }
  readonly http: DynamicRuntimeHttpService
}
