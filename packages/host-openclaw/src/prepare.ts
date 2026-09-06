import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, parse, resolve } from 'node:path'
import type { RuntimePresetRosterConfig } from '@doppelganger/doppelganger-runtime-presets'
import { rolldown } from 'rolldown'
import { beginDirectActivation } from './direct.ts'
import { OPENCLAW_CONFIG_SCHEMA } from './options.ts'
import {
  createOpenClawHostExtensionRuntime,
  prepareOpenClawHostExtensions,
  validatePreparedOpenClawHostExtensions,
  type OpenClawHostExtensionConfiguration,
  type PreparedOpenClawHostExtensionBuild,
  type PreparedOpenClawHostExtensions,
} from './host-extensions.ts'
import {
  prepareCatalog,
  validatePreparedCatalog,
  type PreparedCatalog,
} from './catalog.ts'

const HOST_PACKAGE = '@doppelganger/doppelganger-host-openclaw'
const GENERATED_PLUGIN_ID = 'doppelganger'
const MAX_OPENCLAW_MANIFEST_BYTES = 256 * 1024
interface HostPackageMetadata {
  readonly version: string
  readonly openclawVersion: string
}

async function hostPackageMetadata(): Promise<HostPackageMetadata> {
  let source: string | undefined
  for (const relative of ['../package.json', '../../package.json']) {
    try {
      source = await readFile(new URL(relative, import.meta.url), 'utf8')
      break
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
  if (source === undefined) throw new Error('cannot locate host-openclaw package metadata')
  const value = JSON.parse(source) as {
    version?: unknown
    peerDependencies?: { openclaw?: unknown }
  }
  if (typeof value.version !== 'string' || value.version.trim().length === 0) {
    throw new Error('host-openclaw package metadata does not declare a version')
  }
  const openclawVersion = value.peerDependencies?.openclaw
  if (typeof openclawVersion !== 'string' || openclawVersion.trim().length === 0) {
    throw new Error('host-openclaw package metadata does not declare its supported OpenClaw version')
  }
  return Object.freeze({ version: value.version, openclawVersion })
}


export interface PrepareOpenClawDeploymentOptions {
  readonly output: string
  readonly roster?: RuntimePresetRosterConfig
  readonly explicitRuntimePreset?: string
  readonly workspaceRoot?: string
  readonly actorId?: string
  readonly hostExtensions?: OpenClawHostExtensionConfiguration
}

export interface PreparedOpenClawDeployment {
  readonly output: string
  readonly catalog: PreparedCatalog
  readonly hostExtensions: PreparedOpenClawHostExtensions
}

function renderPackageJson(metadata: HostPackageMetadata): string {
  return `${JSON.stringify({
    name: '@doppelganger/openclaw-prepared',
    version: metadata.version,
    private: true,
    type: 'module',
    files: ['index.js', 'openclaw.plugin.json', 'prepared-catalog.json', 'prepared-host-extensions.json', 'host-extensions'],
    dependencies: { [HOST_PACKAGE]: metadata.version },
    peerDependencies: { openclaw: metadata.openclawVersion },
    openclaw: { extensions: ['./index.js'] },
  }, null, 2)}\n`
}

function renderManifest(catalog: PreparedCatalog, metadata: HostPackageMetadata): string {
  return `${JSON.stringify({
    id: GENERATED_PLUGIN_ID,
    name: `Doppelganger (${catalog.runtimePresetId})`,
    description: `Prepared Doppelganger Runtime Preset ${catalog.runtimePresetId}.`,
    version: metadata.version,
    activation: { onStartup: true },
    configSchema: OPENCLAW_CONFIG_SCHEMA,
    contracts: { tools: catalog.tools.map(tool => tool.nativeName) },
  }, null, 2)}\n`
}

function renderWrapper(catalog: PreparedCatalog, extensions: PreparedOpenClawHostExtensions): string {
  const imports = extensions.modules.map((module, index) => (
    `import * as hostExtension${index} from ${JSON.stringify(module.file)}`
  ))
  return [
    ...imports,
    `import { createOpenClawPlugin } from ${JSON.stringify(`${HOST_PACKAGE}/plugin`)}`,
    `import { validatePreparedCatalog } from ${JSON.stringify(`${HOST_PACKAGE}/prepare`)}`,
    `import { createOpenClawHostExtensionRuntime } from ${JSON.stringify(`${HOST_PACKAGE}/host-extensions`)}`,
    '',
    `const prepared = validatePreparedCatalog(${JSON.stringify(catalog)})`,
    `const hostExtensions = createOpenClawHostExtensionRuntime(${JSON.stringify(extensions)}, [${extensions.modules.map((_module, index) => `hostExtension${index}`).join(', ')}])`,
    'export default createOpenClawPlugin(prepared, hostExtensions)',
    '',
  ].join('\n')
}

async function bundleHostExtensions(stage: string, extensions: PreparedOpenClawHostExtensionBuild): Promise<void> {
  if (extensions.sourceFiles.length === 0) return
  const outputDirectory = join(stage, 'host-extensions')
  await mkdir(outputDirectory, { mode: 0o700 })
  for (let index = 0; index < extensions.sourceFiles.length; index += 1) {
    const output = join(stage, extensions.prepared.modules[index]!.file.slice(2))
    const bundle = await rolldown({
      input: extensions.sourceFiles[index]!,
      external: [/^node:/u, '@deepseek-ai/cordis', 'openclaw', /^openclaw\//u],
    })
    try {
      await bundle.write({ file: output, format: 'esm', codeSplitting: false })
    } finally {
      await bundle.close()
    }
    await chmod(output, 0o600)
  }
}

async function writeStagedArtifact(
  stage: string,
  catalog: PreparedCatalog,
  extensions: PreparedOpenClawHostExtensionBuild,
  metadata: HostPackageMetadata,
): Promise<void> {
  const packageJson = renderPackageJson(metadata)
  const manifestJson = renderManifest(catalog, metadata)
  const preparedJson = `${JSON.stringify(catalog, null, 2)}\n`
  const preparedExtensionsJson = `${JSON.stringify(extensions.prepared, null, 2)}\n`
  const wrapper = renderWrapper(catalog, extensions.prepared)
  if (Buffer.byteLength(manifestJson, 'utf8') > MAX_OPENCLAW_MANIFEST_BYTES) {
    throw new TypeError(`generated OpenClaw manifest exceeds ${MAX_OPENCLAW_MANIFEST_BYTES} bytes`)
  }
  await mkdir(stage, { mode: 0o700 })
  await bundleHostExtensions(stage, extensions)
  await Promise.all([
    writeFile(join(stage, 'package.json'), packageJson, { encoding: 'utf8', mode: 0o600 }),
    writeFile(join(stage, 'openclaw.plugin.json'), manifestJson, { encoding: 'utf8', mode: 0o600 }),
    writeFile(join(stage, 'prepared-catalog.json'), preparedJson, { encoding: 'utf8', mode: 0o600 }),
    writeFile(join(stage, 'prepared-host-extensions.json'), preparedExtensionsJson, { encoding: 'utf8', mode: 0o600 }),
    writeFile(join(stage, 'index.js'), wrapper, { encoding: 'utf8', mode: 0o600 }),
  ])
  const [stagedPackageJson, stagedManifestJson, stagedPreparedJson, stagedExtensionsJson, stagedWrapper] = await Promise.all([
    readFile(join(stage, 'package.json'), 'utf8'),
    readFile(join(stage, 'openclaw.plugin.json'), 'utf8'),
    readFile(join(stage, 'prepared-catalog.json'), 'utf8'),
    readFile(join(stage, 'prepared-host-extensions.json'), 'utf8'),
    readFile(join(stage, 'index.js'), 'utf8'),
  ])
  if (stagedPackageJson !== packageJson) throw new Error('staged package metadata changed while writing')
  if (stagedManifestJson !== manifestJson) throw new Error('staged OpenClaw manifest changed while writing')
  if (stagedPreparedJson !== preparedJson) throw new Error('staged prepared catalog changed while writing')
  if (stagedExtensionsJson !== preparedExtensionsJson) throw new Error('staged prepared Host Extension metadata changed while writing')
  if (stagedWrapper !== wrapper) throw new Error('staged plugin wrapper changed while writing')
  const packageManifest = JSON.parse(stagedPackageJson) as { openclaw?: { extensions?: unknown } }
  const pluginManifest = JSON.parse(stagedManifestJson) as { configSchema?: unknown; contracts?: { tools?: unknown } }
  validatePreparedCatalog(JSON.parse(stagedPreparedJson))
  validatePreparedOpenClawHostExtensions(JSON.parse(stagedExtensionsJson))
  if (JSON.stringify(packageManifest.openclaw?.extensions) !== JSON.stringify(['./index.js'])) {
    throw new Error('staged package does not declare its OpenClaw entrypoint')
  }
  if (JSON.stringify(pluginManifest.configSchema) !== JSON.stringify(OPENCLAW_CONFIG_SCHEMA)) {
    throw new Error('staged plugin manifest configuration schema drifted from runtime options')
  }
  if (JSON.stringify(pluginManifest.contracts?.tools) !== JSON.stringify(catalog.tools.map(tool => tool.nativeName))) {
    throw new Error('staged plugin manifest tool declarations do not match the prepared catalog')
  }
  if (!stagedWrapper.includes('createOpenClawPlugin(prepared, hostExtensions)')) {
    throw new Error('staged plugin wrapper is incomplete')
  }
}


async function publishStagedArtifact(stage: string, output: string): Promise<void> {
  const backup = join(dirname(output), `.${basename(output)}.backup-${randomUUID()}`)
  let displaced = false
  try {
    try {
      await rename(output, backup)
      displaced = true
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    try {
      await rename(stage, output)
    } catch (publishFailure) {
      if (!displaced) throw publishFailure
      try {
        await rename(backup, output)
      } catch (restoreFailure) {
        throw new AggregateError([publishFailure, restoreFailure], 'failed to publish or restore the prior OpenClaw artifact')
      }
      throw publishFailure
    }
    if (displaced) {
      try {
        await rm(backup, { recursive: true })
      } catch (cleanupFailure) {
        const rollback = join(dirname(output), `.${basename(output)}.rollback-${randomUUID()}`)
        try {
          await rename(output, rollback)
          await rename(backup, output)
          await rm(rollback, { recursive: true, force: true })
        } catch (restoreFailure) {
          throw new AggregateError([cleanupFailure, restoreFailure], 'published OpenClaw artifact but could not remove the backup or restore the prior artifact')
        }
        throw cleanupFailure
      }
    }
  } catch (cause) {
    await rm(stage, { recursive: true, force: true })
    throw cause
  }
}

export async function prepareOpenClawDeployment(
  options: PrepareOpenClawDeploymentOptions,
): Promise<PreparedOpenClawDeployment> {
  if (typeof options.output !== 'string' || options.output.trim().length === 0) {
    throw new TypeError('OpenClaw preparation output must be a non-empty path')
  }
  const output = resolve(options.output)
  if (output === parse(output).root) throw new TypeError('OpenClaw preparation output must not be a filesystem root')
  const preparationWorkspace = resolve(options.workspaceRoot ?? process.cwd())
  const hostExtensionBuild = await prepareOpenClawHostExtensions(options.hostExtensions, preparationWorkspace)
  const hostExtensions = createOpenClawHostExtensionRuntime(
    hostExtensionBuild.prepared,
    hostExtensionBuild.importedModules,
  )
  const preparationSessionId = `openclaw-prepare-${randomUUID()}`
  const activation = beginDirectActivation({
    roster: options.roster ?? {},
    ...(options.explicitRuntimePreset === undefined ? {} : { explicitRuntimePreset: options.explicitRuntimePreset }),
    workspaceRoot: preparationWorkspace,
    hostExtensions,
    hostFacts: Object.freeze({
      hostKind: 'openclaw',
      agentId: 'preparation',
      sessionKey: 'preparation',
      sessionId: preparationSessionId,
      workspaceRoot: preparationWorkspace,
    }),
    resolveActor: () => options.actorId,
    watch: false,
  })
  let catalog: PreparedCatalog
  let activationFailure: unknown
  try {
    const active = await activation.ready
    if (active === undefined) throw new Error('no Runtime Preset was selected for OpenClaw preparation')
    catalog = prepareCatalog(active.runtimePresetId, active.bridge.snapshotTools())
  } catch (cause) {
    activationFailure = cause
    throw cause
  } finally {
    try {
      await activation.dispose()
    } catch (cleanupFailure) {
      if (activationFailure !== undefined) {
        throw new AggregateError([activationFailure, cleanupFailure], 'OpenClaw preparation activation and cleanup failed')
      }
      throw cleanupFailure
    }
  }

  const metadata = await hostPackageMetadata()
  await mkdir(dirname(output), { recursive: true })
  const stage = join(dirname(output), `.${basename(output)}.stage-${randomUUID()}`)
  try {
    await writeStagedArtifact(stage, catalog!, hostExtensionBuild, metadata)
    await publishStagedArtifact(stage, output)
  } catch (cause) {
    await rm(stage, { recursive: true, force: true })
    throw cause
  }
  return Object.freeze({ output, catalog: catalog!, hostExtensions: hostExtensionBuild.prepared })
}

export {
  nativeToolName,
  prepareCatalog,
  projectCatalog,
  validatePreparedCatalog,
  type PreparedCatalog,
  type PreparedTool,
} from './catalog.ts'
