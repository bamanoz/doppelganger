import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  catalogSourceDigest,
  readCatalogSources,
} from './catalog-source.mjs'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const outputPath = resolve(packageRoot, 'src/catalog.generated.ts')
const declarations = await readCatalogSources(repositoryRoot)

const requiredDeclarations = [
  ['packages/extension-protocols/src/context.ts', /export class ContextProtocol[\s\S]*?register\(provider: ContextProvider\): \(\) => void/],
  ['packages/extension-protocols/src/tools.ts', /export class ToolRegistry[\s\S]*?register\(definition: ToolDefinition\): ToolRegistration/],
  ['packages/extension-protocols/src/tools.ts', /snapshot\(\): ToolCatalogSnapshot/],
  ['packages/extension-protocols/src/lifecycle.ts', /'pre-compaction': 'doppelganger\/pre-compaction'/],
  ['packages/extension-dynamic-runtime-plugins/src/catalog-contracts.ts', /export interface DynamicRuntimeHttpService[\s\S]*?request\(input: DynamicRuntimeHttpRequest\): Promise<DynamicRuntimeHttpResponse>/],
  ['node_modules/@deepseek-ai/cordis-plugin-timer/src/index.ts', /timeout\(callback: \(\) => void, delay: number\): \(\) => void/],
  ['node_modules/@deepseek-ai/cordis-plugin-timer/src/index.ts', /interval\(callback: \(\) => void, delay: number\): \(\) => void/],
]
for (const [source, pattern] of requiredDeclarations) {
  if (!pattern.test(declarations[source])) {
    throw new Error(`approved catalog declaration changed: ${source} ${pattern}`)
  }
}
const sourceDigest = catalogSourceDigest(declarations)

const catalog = {
  services: [
    {
      name: 'doppelgangerContext',
      purpose: 'Register lifecycle-owned portable context contributions.',
      source: 'packages/extension-protocols/src/context.ts#ContextProtocol',
      methods: ['register(provider: ContextProvider): () => void'],
      properties: [],
      referencedTypes: ['ContextContribution', 'ContextResolveRequest'],
    },
    {
      name: 'doppelgangerHttp',
      purpose: 'Optional transport-neutral bounded HTTP request service.',
      source: 'packages/extension-dynamic-runtime-plugins/src/catalog-contracts.ts#DynamicRuntimeHttpService',
      methods: ['request(input: DynamicRuntimeHttpRequest): Promise<DynamicRuntimeHttpResponse>'],
      properties: [],
      referencedTypes: ['DynamicRuntimeHttpRequest', 'DynamicRuntimeHttpResponse'],
    },
    {
      name: 'doppelgangerTools',
      purpose: 'Read a source-free revisioned portable tool catalog and register lifecycle-owned tools.',
      source: 'packages/extension-protocols/src/tools.ts#ToolRegistry',
      methods: ['snapshot(): ToolCatalogSnapshot', 'register(definition: ToolDefinition): () => void'],
      properties: [],
      referencedTypes: ['ToolDefinition', 'ToolCatalogSnapshot', 'ToolDescriptor'],
    },
    {
      name: 'timer',
      purpose: 'Schedule lifecycle-owned one-shot and repeating callbacks.',
      source: 'node_modules/@deepseek-ai/cordis-plugin-timer/src/index.ts#TimerService',
      methods: ['timeout(callback: () => void, delay: number): () => void', 'interval(callback: () => void, delay: number): () => void'],
      properties: [],
      referencedTypes: [],
    },
  ],
  events: [
    { name: 'doppelganger/tools-changed', mode: 'emit', signature: '(): void' },
    { name: 'doppelganger/session-started', mode: 'parallel', signature: '(event: SessionStartedEvent): Promise<void> | void' },
    { name: 'doppelganger/session-completed', mode: 'parallel', signature: '(event: SessionCompletedEvent): Promise<void> | void' },
    { name: 'doppelganger/session-disposed', mode: 'parallel', signature: '(event: SessionDisposedEvent): Promise<void> | void' },
    { name: 'doppelganger/turn-started', mode: 'parallel', signature: '(event: TurnStartedEvent): Promise<void> | void' },
    { name: 'doppelganger/turn-committed', mode: 'parallel', signature: '(event: TurnCommittedEvent): Promise<void> | void' },
    { name: 'doppelganger/tool-started', mode: 'parallel', signature: '(event: ToolStartedEvent): Promise<void> | void' },
    { name: 'doppelganger/tool-completed', mode: 'parallel', signature: '(event: ToolCompletedEvent): Promise<void> | void' },
    { name: 'doppelganger/pre-compaction', mode: 'parallel', signature: '(event: PreCompactionEvent): Promise<void> | void' },
  ],
  builtins: [
    { name: 'ctx', purpose: 'Read-only guarded Cordis Context facade.', signatures: ['ctx.get(name)', 'ctx.effect(callback, label?)', 'ctx.on(name, listener)', 'ctx.once(name, listener)', 'ctx.provide(name, value)', 'ctx.logger(name)', 'ctx.timeout(callback, delay)', 'ctx.interval(callback, delay)'] },
    { name: 'console', purpose: 'Package-tagged process logging.', signatures: ['console.log(...values)', 'console.info(...values)', 'console.warn(...values)', 'console.error(...values)', 'console.debug(...values)'] },
    { name: 'TextEncoder', purpose: 'Standard UTF-8 encoder constructor.', signatures: ['new TextEncoder()'] },
    { name: 'TextDecoder', purpose: 'Standard text decoder constructor.', signatures: ['new TextDecoder(label?)'] },
    { name: 'atob', purpose: 'Decode base64 as UTF-8 text.', signatures: ['atob(value: string): string'] },
    { name: 'btoa', purpose: 'Encode UTF-8 text as base64.', signatures: ['btoa(value: string): string'] },
  ],
  referencedTypes: {
    ContextContribution: { source: 'packages/extension-protocols/src/context.ts', shape: '{ source: string; content: string; priority: number; authority: "instruction" | "data"; truncate?: boolean }' },
    ContextResolveRequest: { source: 'packages/extension-protocols/src/context.ts', shape: '{ turn: { input: string; turnId?: string }; tokenBudget: number }' },
    ToolDefinition: { source: 'packages/extension-protocols/src/tools.ts', shape: '{ name: string; description: string; inputSchema: JSON Schema; approval?: { policy: "required"; reason?: string }; available?: boolean; invoke(input): JsonValue | Promise<JsonValue> }' },
    ToolCatalogSnapshot: { source: 'packages/extension-protocols/src/tools.ts', shape: '{ revision: string; tools: readonly ToolDescriptor[] }' },
    ToolDescriptor: { source: 'packages/extension-protocols/src/tools.ts', shape: '{ name: string; label: string; description: string; inputSchema: JSON Schema; revision: string; approval?: ToolApprovalRequirement; available: boolean }' },
    ToolRegistration: { source: 'packages/extension-protocols/src/tools.ts', shape: 'Withheld from generated code; registration returns only an owned disposer function.' },
    DynamicRuntimeHttpRequest: { source: 'packages/extension-dynamic-runtime-plugins/src/catalog-contracts.ts', shape: '{ url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }' },
    DynamicRuntimeHttpResponse: { source: 'packages/extension-dynamic-runtime-plugins/src/catalog-contracts.ts', shape: '{ status: number; headers: Record<string, string>; body: string }' },
  },
}

const generated = [
  '// Generated by scripts/generate-catalog.mjs. Do not edit.',
  '',
  `export const CATALOG_SOURCE_DIGEST = ${JSON.stringify(sourceDigest)} as const`,
  '',
  `export const GENERATED_RUNTIME_PLUGIN_CATALOG = Object.freeze(${JSON.stringify(catalog, null, 2)} as const)`,
  '',
].join('\n')

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8')
  if (current !== generated) {
    throw new Error(`generated catalog is stale: ${relative(repositoryRoot, outputPath)}; run npm run generate:catalog --workspace @doppelganger/doppelganger-dynamic-runtime-plugins`)
  }
} else {
  await writeFile(outputPath, generated)
}
