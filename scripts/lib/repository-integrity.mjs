import { spawnSync } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { checkFocusedSpecs } from './focused-specs.mjs'

const MARKDOWN_LINK = /!?(?:\[[^\]]*\])\(([^)]+)\)/gu
const NODE_SCRIPT = /(?:^|\s)node\s+(scripts\/[^\s"';&|]+\.mjs)/gu
const OBSOLETE_IDENTIFIERS = ['@doppelganger/extension-', '@doppelganger/preset-aiden']
const LEGACY_REQUIREMENTS = new Set([
  'Existing persona selection precedence',
  'Global persona selection',
  'Persona context is appended without replacing OMP instructions',
  'Persona context projection',
  'Persona tool projection',
  'Project persona selection',
  'Scoped activation metadata',
])
const LEGACY_RUNTIME_PHRASES = [
  'activate personas concurrently',
  'configured global default persona',
  'disable persona behavior',
  'no project persona or global default',
  'persona activation is required',
  'persona context and tools are disabled',
  'preset or persona selection',
  'selected by the nearest project manifest',
  'without any persona selection',
]

async function files(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path, suffix)
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : []
  }))
  return nested.flat().sort()
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function localImports(path, source) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const imports = []
  const add = value => {
    if (ts.isStringLiteral(value) && value.text.startsWith('.')) imports.push(value.text)
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) add(node.moduleSpecifier)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      if (specifier !== undefined) add(specifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports
}
async function verificationSourceViolations(root) {
  const packagePath = join(root, 'package.json')
  if (!await exists(packagePath)) return []
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'))
  const scriptsRoot = join(root, 'scripts')
  const seeds = []
  for (const command of Object.values(packageManifest.scripts ?? {})) {
    if (typeof command !== 'string') continue
    for (const match of command.matchAll(NODE_SCRIPT)) seeds.push(resolve(root, match[1]))
  }
  const testsRoot = join(scriptsRoot, 'tests')
  if (await exists(testsRoot)) seeds.push(...await files(testsRoot, '.ts'))

  const violations = []
  const sources = new Set()
  const pending = [...new Set(seeds)]
  while (pending.length > 0) {
    const path = pending.pop()
    if (path === undefined || sources.has(path)) continue
    sources.add(path)
    if (!await exists(path)) {
      violations.push(`${display(root, path)}: required verification source is missing`)
      continue
    }
    const source = await readFile(path, 'utf8')
    for (const specifier of localImports(path, source)) {
      const target = resolve(dirname(path), specifier)
      if (target === scriptsRoot || target.startsWith(`${scriptsRoot}${sep}`)) pending.push(target)
    }
  }

  for (const path of sources) {
    const relativePath = display(root, path)
    const ignored = spawnSync('git', [
      '-C', root, 'check-ignore', '--no-index', '--quiet', '--', relativePath,
    ], { encoding: 'utf8' })
    if (ignored.status === 0) violations.push(`${relativePath}: required verification source is ignored by Git`)
    else if (ignored.status !== 1 && ignored.status !== 128) {
      violations.push(`${relativePath}: cannot determine Git ignore status`)
    }
  }
  return violations
}


function display(root, path) {
  return relative(root, path).split(sep).join('/')
}

function localMarkdownTarget(raw) {
  const value = raw.trim().replace(/^<|>$/gu, '').split(/\s+["']/u, 1)[0]
  if (!value || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(value)) return
  const [pathname] = value.split('#', 1)
  if (!pathname || extname(pathname).toLowerCase() !== '.md') return
  return decodeURIComponent(pathname)
}

function activeOpenSpec(path) {
  return !path.split(sep).includes('archive')
}

function allowsRemovedSpecReference(path) {
  return path.endsWith(join('specs', 'repository-integrity', 'spec.md'))
}

function allowsObsoleteIdentifier(path, line) {
  return path.endsWith(join('openspec', 'specs', 'loader-plugin-composition', 'spec.md'))
    || line.includes('No obsolete concrete package or aggregate-preset identifier remains')
}

function legacySpecViolations(root, path, source) {
  const violations = []
  let removedRequirements = false
  for (const [index, line] of source.split('\n').entries()) {
    if (line.startsWith('## ')) removedRequirements = line === '## REMOVED Requirements'
    const requirement = /^### Requirement: (.+)$/u.exec(line)?.[1]
    if (!removedRequirements && requirement !== undefined && LEGACY_REQUIREMENTS.has(requirement)) {
      violations.push(`${display(root, path)}:${index + 1}: legacy runtime-owned Persona requirement ${requirement}`)
    }
    if (removedRequirements) continue
    const lower = line.toLowerCase()
    for (const phrase of LEGACY_RUNTIME_PHRASES) {
      if (lower.includes(phrase)) {
        violations.push(`${display(root, path)}:${index + 1}: legacy runtime-owned Persona selection phrase ${phrase}`)
      }
    }
  }
  return violations
}

export async function checkRepositoryIntegrity(root) {
  const violations = []
  violations.push(...await verificationSourceViolations(root))
  const docsRoot = join(root, 'docs')
  const docs = await files(docsRoot, '.md')
  const docsIndexPath = join(docsRoot, 'README.md')
  const docsIndex = await readFile(docsIndexPath, 'utf8')
  for (const path of docs.filter(value => value !== docsIndexPath)) {
    const indexedPath = display(docsRoot, path)
    if (!docsIndex.includes(`](${indexedPath})`)) violations.push(`${display(root, path)}: document is not indexed by docs/README.md`)
  }

  const linkSources = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...docs]
  for (const path of linkSources) {
    const source = await readFile(path, 'utf8')
    for (const match of source.matchAll(MARKDOWN_LINK)) {
      const target = localMarkdownTarget(match[1])
      if (target === undefined) continue
      const resolved = normalize(resolve(dirname(path), target))
      if (!await exists(resolved)) violations.push(`${display(root, path)}: unresolved Markdown link ${target}`)
    }
  }

  const openspecRoot = join(root, 'openspec')
  const openSpecDocuments = await files(openspecRoot, '.md')
  const liveOpenSpecDocuments = openSpecDocuments.filter(activeOpenSpec)
  const removedReferenceSources = [...linkSources, ...liveOpenSpecDocuments]
  for (const path of removedReferenceSources) {
    if (allowsRemovedSpecReference(path)) continue
    const source = await readFile(path, 'utf8')
    if (source.includes('SPEC.md')) violations.push(`${display(root, path)}: references removed live document SPEC.md`)
  }

  for (const path of liveOpenSpecDocuments) {
    const source = await readFile(path, 'utf8')
    for (const [index, line] of source.split('\n').entries()) {
      for (const identifier of OBSOLETE_IDENTIFIERS) {
        if (line.includes(identifier) && !allowsObsoleteIdentifier(path, line)) {
          violations.push(`${display(root, path)}:${index + 1}: obsolete identifier ${identifier}`)
        }
      }
    }
    if (path.includes(`${sep}specs${sep}`)) violations.push(...legacySpecViolations(root, path, source))
  }
  violations.push(...await checkFocusedSpecs(root))
  return [...new Set(violations)].sort()
}
