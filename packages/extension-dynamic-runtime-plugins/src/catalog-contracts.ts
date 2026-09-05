import type {
  AssembledContext,
  ContextProvider,
  ContextResolveRequest,
  ToolCatalogSnapshot,
  ToolDefinition,
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
    resolve(request: ContextResolveRequest): Promise<AssembledContext>
  }
  readonly tools: {
    register(definition: ToolDefinition): () => void
    snapshot(): ToolCatalogSnapshot
  }
  readonly timer: {
    timeout(callback: () => void, delay: number): () => void
    interval(callback: () => void, delay: number): () => void
  }
  readonly http: DynamicRuntimeHttpService
}
