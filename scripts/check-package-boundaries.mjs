import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const rules = {
  'composition-runtime': specifier => specifier.startsWith('@doppelganger/extension-'),
  'extension-protocols': specifier => specifier.startsWith('@doppelganger/'),
  'extension-sqlite': specifier => specifier.startsWith('@doppelganger/'),
  'extension-persona': specifier => (
    specifier.startsWith('@doppelganger/')
    && ![
      '@doppelganger/composition-runtime',
      '@doppelganger/extension-protocols',
    ].includes(specifier)
  ),
  'extension-memory': specifier => (
    specifier.startsWith('@doppelganger/')
    && ![
      '@doppelganger/extension-persona',
      '@doppelganger/extension-protocols',
      '@doppelganger/extension-sqlite',
    ].includes(specifier)
  ),
  'preset-aiden': specifier => (
    specifier.startsWith('@doppelganger/')
    && ![
      '@doppelganger/composition-runtime',
      '@doppelganger/extension-memory',
      '@doppelganger/extension-persona',
      '@doppelganger/extension-protocols',
      '@doppelganger/extension-sqlite',
    ].includes(specifier)
  ),
  'host-omp': specifier => [
    '@doppelganger/extension-persona',
    '@doppelganger/extension-memory',
  ].includes(specifier),
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  }))
  return nested.flat()
}

const violations = []
for (const [packageName, forbidden] of Object.entries(rules)) {
  const packageRoot = join(root, 'packages', packageName)
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const specifier of Object.keys(manifest[section] ?? {})) {
      if (forbidden(specifier)) violations.push(`${packageName}/package.json: forbidden ${section} entry ${specifier}`)
    }
  }
  for (const filename of await sourceFiles(join(packageRoot, 'src'))) {
    const source = await readFile(filename, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/gu)) {
      const specifier = match[2]
      if (specifier !== undefined && forbidden(specifier)) {
        violations.push(`${filename}: forbidden import ${specifier}`)
      }
    }
  }
}

if (violations.length > 0) throw new Error(`package boundary violations:\n${violations.join('\n')}`)
process.stdout.write(`checked ${Object.keys(rules).length} package boundaries\n`)
