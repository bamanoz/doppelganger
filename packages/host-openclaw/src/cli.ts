#!/usr/bin/env node
import { resolve } from 'node:path'
import type { RuntimePresetRoot, RuntimePresetTrust } from '@doppelganger/doppelganger-runtime-presets'
import type { HostExtensionSelectionInput } from '@doppelganger/doppelganger-host-extensions'
import { prepareOpenClawDeployment } from './prepare.ts'

const HELP = `Usage: doppelganger-openclaw-prepare --output <directory> [options]

Prepare a finite, installable OpenClaw plugin from an activated Doppelganger Runtime Preset.
Preparation executes trusted composition code and any external services configured by that preset.

Options:
  --output <directory>       Generated plugin directory (required)
  --home <directory>         Doppelganger home used for user selection and patches
  --preset <id>              Explicit Runtime Preset selection
  --workspace <directory>    Workspace used for project discovery and runtime metadata
  --actor <id>               Explicit trusted actor for actor-aware preparation only
  --host-extension <module> Import and bundle one Host Extension module (repeatable)
  --enable-host-extension <selection>
                             Select a prepared ID, optionally as id=<JSON config> (repeatable)
  --root <trust:path>        Add a Runtime Preset root; trust is system or user (repeatable)
  --roots <list>             Comma-separated trust:path Runtime Preset roots
  --default-preset <id>      Deployment default when no explicit/project/user selection exists
  --defaultless              Configure no deployment default
  --no-shipped-root          Exclude shipped Runtime Presets
  --no-user-root             Exclude the home-derived user Runtime Preset root
  -h, --help                 Show this help

The prepared artifact stores no actor identity or process-local tool revisions. To include initial
MCP tools, configure that preset's MCP Loader row with startupMode: await-ready before preparing.
`

export interface PrepareCliIo {
  readonly stdout: { write(value: string): unknown }
  readonly stderr: { write(value: string): unknown }
}

function valueAfter(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (value === undefined || value.length === 0 || value.startsWith('-')) throw new TypeError(`${flag} requires a value`)
  return value
}

function presetRoot(value: string, flag: string): RuntimePresetRoot {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) throw new TypeError(`${flag} must use system:<path> or user:<path>`)
  const trust = value.slice(0, separator) as RuntimePresetTrust
  if (trust !== 'system' && trust !== 'user') throw new TypeError(`${flag} trust must be system or user`)
  return Object.freeze({ trust, path: resolve(value.slice(separator + 1)) })
}
function hostExtensionSelection(value: string): HostExtensionSelectionInput {
  const separator = value.indexOf('=')
  if (separator < 0) return Object.freeze({ id: value })
  const id = value.slice(0, separator)
  const source = value.slice(separator + 1)
  if (id.length === 0 || source.length === 0) throw new TypeError('--enable-host-extension must use id or id=<JSON config>')
  let config: unknown
  try {
    config = JSON.parse(source)
  } catch (cause) {
    throw new TypeError(`--enable-host-extension contains invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  return Object.freeze({ id, config })
}


export async function runPrepareCli(
  args: readonly string[],
  io: PrepareCliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(HELP)
    return 0
  }
  let output: string | undefined
  let home: string | undefined
  let preset: string | undefined
  let workspaceRoot: string | undefined
  let actorId: string | undefined
  let defaultRuntimePreset: string | null | undefined
  let includeShippedRoot: boolean | undefined
  let includeUserRoot: boolean | undefined
  const roots: RuntimePresetRoot[] = []
  const hostExtensionModules: string[] = []
  const hostExtensionSelections: HostExtensionSelectionInput[] = []
  const singleUse = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!
    if (flag !== '--root' && flag !== '--roots' && flag !== '--host-extension' && flag !== '--enable-host-extension') {
      if (singleUse.has(flag)) throw new TypeError(`${flag} must not be repeated`)
      singleUse.add(flag)
    }
    switch (flag) {
      case '--output': output = valueAfter(args, index++, flag); break
      case '--home': home = valueAfter(args, index++, flag); break
      case '--preset': preset = valueAfter(args, index++, flag); break
      case '--workspace': workspaceRoot = valueAfter(args, index++, flag); break
      case '--actor': actorId = valueAfter(args, index++, flag); break
      case '--default-preset':
        if (defaultRuntimePreset !== undefined) throw new TypeError('--default-preset and --defaultless are mutually exclusive')
        defaultRuntimePreset = valueAfter(args, index++, flag)
        break
      case '--defaultless':
        if (defaultRuntimePreset !== undefined) throw new TypeError('--default-preset and --defaultless are mutually exclusive')
        defaultRuntimePreset = null
        break
      case '--no-shipped-root': includeShippedRoot = false; break
      case '--no-user-root': includeUserRoot = false; break
      case '--root': roots.push(presetRoot(valueAfter(args, index++, flag), flag)); break
      case '--roots': {
        const values = valueAfter(args, index++, flag).split(',').map(value => value.trim())
        if (values.some(value => value.length === 0)) throw new TypeError('--roots contains an empty entry')
        roots.push(...values.map(value => presetRoot(value, '--roots')))
        break
      }
      case '--host-extension': hostExtensionModules.push(valueAfter(args, index++, flag)); break
      case '--enable-host-extension': hostExtensionSelections.push(hostExtensionSelection(valueAfter(args, index++, flag))); break
      default: throw new TypeError(`unknown option ${JSON.stringify(flag)}; use --help for usage`)
    }
  }
  if (output === undefined) throw new TypeError('--output is required')
  const result = await prepareOpenClawDeployment({
    output,
    roster: {
      ...(home === undefined ? {} : { home: resolve(home) }),
      ...(defaultRuntimePreset === undefined ? {} : { defaultRuntimePreset }),
      ...(roots.length === 0 ? {} : { roots: Object.freeze(roots) }),
      ...(includeShippedRoot === undefined ? {} : { includeShippedRoot }),
      ...(includeUserRoot === undefined ? {} : { includeUserRoot }),
    },
    ...(preset === undefined ? {} : { explicitRuntimePreset: preset }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot: resolve(workspaceRoot) }),
    ...(actorId === undefined ? {} : { actorId }),
    ...((hostExtensionModules.length === 0 && hostExtensionSelections.length === 0) ? {} : {
      hostExtensions: {
        ...(hostExtensionModules.length === 0 ? {} : { modules: Object.freeze(hostExtensionModules) }),
        ...(hostExtensionSelections.length === 0 ? {} : { enabled: Object.freeze(hostExtensionSelections) }),
      },
    }),
  })
  io.stdout.write(`${JSON.stringify({
    output: result.output,
    runtimePresetId: result.catalog.runtimePresetId,
    fingerprint: result.catalog.fingerprint,
    hostExtensionFingerprint: result.hostExtensions.fingerprint,
    hostExtensions: result.hostExtensions.defaultSelection.map(selection => selection.id),
    tools: result.catalog.tools.map(tool => ({ nativeName: tool.nativeName, canonicalName: tool.descriptor.name })),
  }, null, 2)}\n`)
  return 0
}

if (import.meta.main) {
  runPrepareCli(process.argv.slice(2)).then(
    code => { process.exitCode = code },
    cause => {
      process.stderr.write(`doppelganger-openclaw-prepare: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      process.exitCode = 1
    },
  )
}
