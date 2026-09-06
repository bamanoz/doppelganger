import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { dirname, join, normalize, parse, resolve } from 'node:path'
import {
  createCompositionDefinition,
  createCompositionRuntime,
  type CompositionRuntime,
  type CompositionSession,
  type CompositionReloadEvent,
  type CompositionReloadFailureEvent,
} from '@doppelganger/doppelganger-composition-runtime'
import type { HostExtensionSelectionInput } from '@doppelganger/doppelganger-host-extensions'
import {
  defineRuntimeHostCapabilities,
  RUNTIME_HOST_PROTOCOL_VERSION,
  type RuntimeHostBridge,
} from '@doppelganger/doppelganger-protocols'
import {
  createRuntimePresetRoster,
  type RuntimePresetRosterConfig,
} from '@doppelganger/doppelganger-runtime-presets'
import {
  createStandardOpenClawHostExtensionRuntime,
  type OpenClawHostExtensionRuntime,
  type OpenClawHostSessionFacts,
} from './host-extensions.ts'

export interface DirectActivationOptions {
  readonly roster?: RuntimePresetRosterConfig
  readonly explicitRuntimePreset?: string
  readonly workspaceRoot?: string
  readonly hostExtensions?: OpenClawHostExtensionRuntime
  readonly hostExtensionSelections?: readonly HostExtensionSelectionInput[]
  readonly hostFacts?: OpenClawHostSessionFacts
  resolveActor?(facts: OpenClawHostSessionFacts): unknown
  readonly watch?: boolean
  readonly onCatalogChanged?: (revision: string) => void
  readonly onReload?: (event: CompositionReloadEvent) => void
  readonly onReloadFailure?: (event: CompositionReloadFailureEvent) => void
}

export interface DirectActivation {
  readonly runtimePresetId: string
  readonly session: CompositionSession
  readonly bridge: RuntimeHostBridge
}

export interface PendingDirectActivation {
  readonly ready: Promise<DirectActivation | undefined>
  dispose(): Promise<void>
}

export const OPENCLAW_RUNTIME_HOST_CAPABILITIES = defineRuntimeHostCapabilities({
  protocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
  context: { delivery: 'per-turn' },
  tools: { delivery: 'session-start', requiredApproval: true, cancellation: true },
  lifecycle: { events: [] },
})

interface ProjectDiscovery {
  readonly workspaceRoot: string
  readonly manifestPath?: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function discoverProject(start: string): Promise<ProjectDiscovery> {
  let current = normalize(resolve(start))
  const filesystemRoot = parse(current).root
  while (true) {
    const manifestPath = join(current, '.doppelganger', 'manifest.yaml')
    if (await pathExists(manifestPath)) return Object.freeze({ workspaceRoot: current, manifestPath })
    if (await pathExists(join(current, '.git'))) return Object.freeze({ workspaceRoot: current })
    if (current === filesystemRoot) return Object.freeze({ workspaceRoot: normalize(resolve(start)) })
    current = dirname(current)
  }
}

function collectFailure(failures: unknown[], seen: Set<unknown>, error: unknown): void {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) collectFailure(failures, seen, nested)
    return
  }
  if (seen.has(error)) return
  seen.add(error)
  failures.push(error)
}

function aggregate(failures: readonly unknown[], message: string): Error {
  if (failures.length === 1 && failures[0] instanceof Error) return failures[0]
  return new AggregateError(failures, message)
}

export function beginDirectActivation(options: DirectActivationOptions): PendingDirectActivation {
  let runtime: CompositionRuntime | undefined
  let bridge: RuntimeHostBridge | undefined
  let disposed = false
  let disposing: Promise<void> | undefined

  const binding = {
    attach(next: RuntimeHostBridge) {
      if (disposed) throw new Error('OpenClaw direct activation was disposed before the Runtime Host bridge attached')
      if (bridge !== undefined) throw new Error('OpenClaw direct activation attached more than one Runtime Host bridge')
      bridge = next
    },
    detach(current: RuntimeHostBridge) {
      if (bridge === current) bridge = undefined
    },
    toolCatalogChanged(revision: string) {
      if (!disposed) options.onCatalogChanged?.(revision)
    },
  }

  const pending = (async (): Promise<DirectActivation | undefined> => {
    const roster = createRuntimePresetRoster(options.roster ?? { defaultRuntimePreset: null })
    const project = await discoverProject(options.workspaceRoot ?? options.hostFacts?.workspaceRoot ?? process.cwd())
    const selection = await roster.select({
      ...(options.explicitRuntimePreset === undefined
        ? {}
        : { explicitRuntimePreset: options.explicitRuntimePreset }),
      ...(project.manifestPath === undefined ? {} : { projectManifestPath: project.manifestPath }),
    })
    if (selection === undefined) return
    if (disposed) throw new Error('OpenClaw direct activation was disposed during Runtime Preset selection')

    const composition = createCompositionDefinition({
      id: selection.preset.id,
      revision: selection.preset.revision,
      loaderPath: selection.preset.loaderPath,
      patches: [
        { source: 'user Runtime Preset patch', filename: selection.userPatchPath, optional: true },
        ...(selection.projectPatchPath === undefined
          ? []
          : [{ source: 'project Runtime Preset patch', filename: selection.projectPatchPath, optional: true }]),
      ],
    })
    const sessionId = options.hostFacts?.sessionId ?? `openclaw-${randomUUID()}`
    const facts: OpenClawHostSessionFacts = options.hostFacts ?? Object.freeze({
      hostKind: 'openclaw',
      agentId: 'direct',
      sessionKey: 'direct',
      sessionId,
      workspaceRoot: project.workspaceRoot,
    })
    if (facts.workspaceRoot !== project.workspaceRoot) {
      throw new TypeError('OpenClaw Host Extension facts workspaceRoot must equal the selected project workspace root')
    }
    const hostExtensions = options.hostExtensions ?? createStandardOpenClawHostExtensionRuntime()
    const plan = hostExtensions.plan({
      ...(options.hostExtensionSelections === undefined ? {} : { selections: options.hostExtensionSelections }),
      binding,
      capabilities: OPENCLAW_RUNTIME_HOST_CAPABILITIES,
      resolveActor: context => options.resolveActor?.(context.facts),
    })
    const protectedComposition = plan.instantiate({
      sessionId,
      runtimePresetId: selection.preset.id,
      workspaceRoot: project.workspaceRoot,
      facts,
    })
    const owner = createCompositionRuntime({
      watch: options.watch === false ? false : { base: dirname(composition.loaderPath), root: ['.'] },
      ...(options.onReload === undefined ? {} : { onReload: options.onReload }),
      ...(options.onReloadFailure === undefined ? {} : { onReloadFailure: options.onReloadFailure }),
    })
    runtime = owner
    const activated = await owner.activate({
      composition,
      sessionId,
      workspaceRoot: project.workspaceRoot,
      protectedComposition,
    })
    if (disposed) {
      await activated.dispose()
      throw new Error('OpenClaw direct activation completed after disposal')
    }
    const activeBridge = bridge
    if (activeBridge === undefined) {
      throw new Error(
        `OpenClaw Runtime Session activated without a Runtime Host bridge: ${JSON.stringify(activated.diagnostics())}`,
      )
    }
    return Object.freeze({
      runtimePresetId: selection.preset.id,
      session: activated,
      bridge: activeBridge,
    })
  })()

  const dispose = (): Promise<void> => {
    if (disposing !== undefined) return disposing
    disposed = true
    disposing = (async () => {
      const failures: unknown[] = []
      const seen = new Set<unknown>()
      const activeRuntime = runtime
      const runtimeCleanup = activeRuntime?.dispose()
      const [activationResult, runtimeResult] = await Promise.allSettled([
        pending,
        runtimeCleanup ?? Promise.resolve(),
      ])
      if (runtimeResult.status === 'rejected') collectFailure(failures, seen, runtimeResult.reason)
      if (activationResult.status === 'fulfilled' && activationResult.value !== undefined) {
        try {
          await activationResult.value.session.dispose()
        } catch (error) {
          collectFailure(failures, seen, error)
        }
      }
      runtime = undefined
      bridge = undefined
      if (failures.length > 0) throw aggregate(failures, 'OpenClaw direct activation cleanup failed')
    })()
    return disposing
  }

  const ready = pending.catch(async error => {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'OpenClaw direct activation and cleanup failed')
    }
    throw error
  })

  return Object.freeze({ ready, dispose })
}
