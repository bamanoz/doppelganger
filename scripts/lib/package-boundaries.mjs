import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const INTERNAL_PREFIX = '@doppelganger/'
const DEPENDENCY_SECTIONS = ['dependencies', 'peerDependencies', 'devDependencies']
const IMPORT_PATTERN = /(?:from\s+|import\s*\()(['"])([^'"]+)\1/gu

async function files(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path, suffix)
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : []
  }))
  return nested.flat().sort()
}

function isObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
}

export function validateBoundaryManifest(value) {
  const violations = []
  if (!isObject(value)) return ['boundary manifest: expected an object']
  if (value.version !== 1) violations.push('boundary manifest: version must be 1')
  if (!isObject(value.packages)) return [...violations, 'boundary manifest: packages must be an object']
  const names = Object.keys(value.packages)
  if (names.length === 0) violations.push('boundary manifest: packages must not be empty')
  if (names.join('\n') !== [...names].sort().join('\n')) {
    violations.push('boundary manifest: package keys must be sorted')
  }
  const directories = new Set()
  for (const name of names) {
    const entry = value.packages[name]
    const prefix = `boundary manifest: ${name}`
    if (!name.startsWith(INTERNAL_PREFIX)) violations.push(`${prefix}: package name must start with ${INTERNAL_PREFIX}`)
    if (!isObject(entry)) {
      violations.push(`${prefix}: entry must be an object`)
      continue
    }
    if (typeof entry.directory !== 'string' || entry.directory.length === 0 || entry.directory.includes('/') || entry.directory.includes('\\')) {
      violations.push(`${prefix}: directory must be one non-empty path segment`)
    } else if (directories.has(entry.directory)) {
      violations.push(`${prefix}: duplicate directory ${entry.directory}`)
    } else {
      directories.add(entry.directory)
    }
    if (!Array.isArray(entry.dependencies) || entry.dependencies.some(dependency => typeof dependency !== 'string')) {
      violations.push(`${prefix}: dependencies must be an array of package names`)
      continue
    }
    const dependencies = entry.dependencies
    if (new Set(dependencies).size !== dependencies.length) violations.push(`${prefix}: dependencies must be unique`)
    if (dependencies.join('\n') !== [...dependencies].sort().join('\n')) violations.push(`${prefix}: dependencies must be sorted`)
    for (const dependency of dependencies) {
      if (!(dependency in value.packages)) violations.push(`${prefix}: unknown dependency ${dependency}`)
      if (dependency === name) violations.push(`${prefix}: package cannot depend on itself`)
    }
  }
  return violations.sort()
}

export async function checkPackageBoundaries(root, manifestPath = join(root, 'scripts', 'package-boundaries.json')) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (cause) {
    return [`boundary manifest: invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`]
  }
  const violations = validateBoundaryManifest(manifest)
  if (violations.length > 0 || !isObject(manifest.packages)) return violations

  const packageEntries = (await readdir(join(root, 'packages'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const configuredDirectories = Object.values(manifest.packages).map(entry => entry.directory).sort()
  for (const directory of packageEntries) {
    if (!configuredDirectories.includes(directory)) violations.push(`packages/${directory}: workspace package is missing from boundary manifest`)
  }
  for (const directory of configuredDirectories) {
    if (!packageEntries.includes(directory)) violations.push(`boundary manifest: unknown workspace directory packages/${directory}`)
  }

  for (const [name, entry] of Object.entries(manifest.packages)) {
    const packageRoot = join(root, 'packages', entry.directory)
    let packageManifest
    try {
      packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    } catch (cause) {
      violations.push(`${entry.directory}/package.json: unreadable manifest: ${cause instanceof Error ? cause.message : String(cause)}`)
      continue
    }
    if (packageManifest.name !== name) {
      violations.push(`${entry.directory}/package.json: expected package name ${name}, found ${String(packageManifest.name)}`)
    }
    const allowed = new Set(entry.dependencies)
    for (const section of DEPENDENCY_SECTIONS) {
      for (const dependency of Object.keys(packageManifest[section] ?? {}).filter(value => value.startsWith(INTERNAL_PREFIX)).sort()) {
        if (!allowed.has(dependency)) {
          violations.push(`${entry.directory}/package.json: forbidden ${section} edge ${name} -> ${dependency}`)
        }
      }
    }
    try {
      for (const filename of await files(join(packageRoot, 'src'), '.ts')) {
        const source = await readFile(filename, 'utf8')
        for (const match of source.matchAll(IMPORT_PATTERN)) {
          const dependency = match[2]
          if (dependency?.startsWith(INTERNAL_PREFIX) && !allowed.has(dependency)) {
            violations.push(`${relative(root, filename)}: forbidden source edge ${name} -> ${dependency}`)
          }
        }
      }
    } catch (cause) {
      violations.push(`${entry.directory}/src: unreadable source tree: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return violations.sort()
}
