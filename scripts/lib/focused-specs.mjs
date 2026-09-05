import { access, readdir, readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const ID = /^- \*\*ID\*\*: `([^`]+)`$/u
const EVIDENCE = /^- \*\*EVIDENCE\*\*: `([^`]+)`$/u
const WHEN = /^- \*\*WHEN\*\*/u
const THEN = /^- \*\*THEN\*\*/u
const REQUIREMENT = /^### Requirement: (.+)$/u
const SCENARIO = /^#### Scenario: (.+)$/u
const MALFORMED_SCENARIO = /^(?:#{1,3}|#{5,}) Scenario:/u
const OPERATION = /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/u
const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const CONDITIONAL_SUITE_MODIFIERS = new Set(['only', 'skip', 'skipIf', 'runIf', 'todo'])
const INVALID_TEST_MODIFIERS = new Set(['only', 'skip', 'skipIf', 'runIf', 'todo', 'each'])

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function files(directory, suffix) {
  if (!await exists(directory)) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path, suffix)
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : []
  }))
  return nested.flat().sort()
}

function display(root, path) {
  return relative(root, path).split(sep).join('/')
}

function diagnostic(root, scenario, message) {
  const identity = scenario.ids[0] ?? 'anonymous'
  return `${display(root, scenario.path)}:${scenario.line} [${identity}]: ${message}`
}

export function parseFocusedSpecDocument(path, source) {
  const lines = source.split('\n')
  const scenarios = []
  const malformedScenarioHeadings = []
  let operation = 'CURRENT'
  let requirement

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const operationMatch = OPERATION.exec(line)
    if (operationMatch !== null) operation = operationMatch[1]
    const requirementMatch = REQUIREMENT.exec(line)
    if (requirementMatch !== null) requirement = requirementMatch[1]
    if (MALFORMED_SCENARIO.test(line)) malformedScenarioHeadings.push(index + 1)

    const scenarioMatch = SCENARIO.exec(line)
    if (scenarioMatch === null) continue

    const body = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (SCENARIO.test(lines[cursor]) || REQUIREMENT.test(lines[cursor]) || lines[cursor].startsWith('## ')) break
      body.push(lines[cursor])
    }
    scenarios.push({
      path,
      line: index + 1,
      name: scenarioMatch[1],
      requirement,
      operation,
      ids: body.flatMap(value => ID.exec(value)?.[1] ?? []),
      evidence: body.flatMap(value => EVIDENCE.exec(value)?.[1] ?? []),
      whenCount: body.filter(value => WHEN.test(value)).length,
      thenCount: body.filter(value => THEN.test(value)).length,
    })
  }

  return { path, scenarios, malformedScenarioHeadings }
}

function validateScenarioShape(root, document, scenario) {
  const violations = []
  if (scenario.ids.length !== 1) {
    violations.push(diagnostic(root, scenario, `expected exactly one ID row, found ${scenario.ids.length}`))
  } else if (!STABLE_ID.test(scenario.ids[0])) {
    violations.push(diagnostic(root, scenario, `invalid stable ID ${scenario.ids[0]}`))
  }
  if (scenario.evidence.length === 0) {
    violations.push(diagnostic(root, scenario, 'expected at least one EVIDENCE row'))
  }
  if (scenario.whenCount !== 1) {
    violations.push(diagnostic(root, scenario, `expected exactly one WHEN row, found ${scenario.whenCount}`))
  }
  if (scenario.thenCount !== 1) {
    violations.push(diagnostic(root, scenario, `expected exactly one THEN row, found ${scenario.thenCount}`))
  }
  for (const line of document.malformedScenarioHeadings) {
    violations.push(`${display(root, document.path)}:${line}: scenario headings must use exactly four hashes`)
  }
  return violations
}

function directTestCall(node) {
  if (!ts.isCallExpression(node)) return
  if (ts.isIdentifier(node.expression) && (node.expression.text === 'it' || node.expression.text === 'test')) {
    return { direct: true, modified: false }
  }
  if (ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && (node.expression.expression.text === 'it' || node.expression.expression.text === 'test')) {
    return { direct: false, modified: INVALID_TEST_MODIFIERS.has(node.expression.name.text) }
  }
  if (ts.isCallExpression(node.expression)
    && ts.isPropertyAccessExpression(node.expression.expression)
    && ts.isIdentifier(node.expression.expression.expression)
    && (node.expression.expression.expression.text === 'it' || node.expression.expression.expression.text === 'test')) {
    return { direct: false, modified: INVALID_TEST_MODIFIERS.has(node.expression.expression.name.text) }
  }
}

function stringArgument(node) {
  const value = node.arguments[0]
  if (value === undefined) return
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
}

function conditionalSuiteAncestor(node) {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isCallExpression(current) || !ts.isPropertyAccessExpression(current.expression)) continue
    const expression = current.expression.expression
    if (!ts.isIdentifier(expression) || (expression.text !== 'describe' && expression.text !== 'suite')) continue
    if (CONDITIONAL_SUITE_MODIFIERS.has(current.expression.name.text)) return true
  }
  return false
}

function collectTestTitles(source, path) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const valid = new Map()
  const invalid = new Set()

  function visit(node) {
    const call = directTestCall(node)
    if (call !== undefined) {
      const title = stringArgument(node)
      if (title !== undefined) {
        if (!call.direct || call.modified || conditionalSuiteAncestor(node)) {
          invalid.add(title)
        } else {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
          valid.set(title, [...(valid.get(title) ?? []), { line }])
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { valid, invalid }
}

export async function resolveEvidence(root, raw) {
  const reference = parseEvidenceReference(raw)
  if (reference.error !== undefined) return { violation: `invalid evidence ${raw}: ${reference.error}` }
  if (reference.planned) return { violation: `planned evidence is not allowed: ${raw}` }
  if (isAbsolute(reference.path) || reference.path.split('/').includes('..')) {
    return { violation: `evidence path must stay inside the repository: ${reference.path}` }
  }
  if (extname(reference.path) !== '.ts' || !reference.path.endsWith('.spec.ts')) {
    return { violation: `evidence path must name a .spec.ts file: ${reference.path}` }
  }
  const path = resolve(root, reference.path)
  if (!path.startsWith(`${resolve(root)}${sep}`) || !await exists(path)) {
    return { violation: `unresolved evidence file ${reference.path}` }
  }
  const titles = collectTestTitles(await readFile(path, 'utf8'), path)
  const matches = titles.valid.get(reference.title) ?? []
  if (matches.length > 1) return { violation: `evidence title is duplicated in ${reference.path}: ${reference.title}` }
  if (matches.length === 1) {
    return {
      relativePath: reference.path,
      absolutePath: path,
      title: reference.title,
      line: matches[0].line,
    }
  }
  if (titles.invalid.has(reference.title)) {
    return { violation: `evidence target is not a direct unconditional it/test case: ${raw}` }
  }
  return { violation: `unresolved evidence test title ${raw}` }
}

function parseEvidenceReference(raw) {
  const planned = raw.startsWith('planned:')
  const value = planned ? raw.slice('planned:'.length) : raw
  const separator = value.indexOf('::')
  if (separator <= 0 || separator === value.length - 2) return { planned, error: 'expected <path>::<static test title>' }
  return {
    planned,
    path: value.slice(0, separator),
    title: value.slice(separator + 2),
  }
}

async function validateEvidence(root, scenario, raw, { allowPlanned }) {
  const reference = parseEvidenceReference(raw)
  if (reference.planned && allowPlanned) return []
  const resolved = await resolveEvidence(root, raw)
  return resolved.violation === undefined ? [] : [diagnostic(root, scenario, resolved.violation)]
}

async function readDocuments(paths) {
  return Promise.all(paths.map(async path => parseFocusedSpecDocument(path, await readFile(path, 'utf8'))))
}

async function activeChangeSpecs(root) {
  const changesRoot = join(root, 'openspec', 'changes')
  if (!await exists(changesRoot)) return new Map()
  const entries = await readdir(changesRoot, { withFileTypes: true })
  const changes = new Map()
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    changes.set(entry.name, await files(join(changesRoot, entry.name, 'specs'), 'spec.md'))
  }
  return changes
}

async function validateDocuments(root, documents, { allowPlanned }) {
  const violations = []
  const identifiers = new Map()
  for (const document of documents) {
    for (const scenario of document.scenarios) {
      violations.push(...validateScenarioShape(root, document, scenario))
      const identity = scenario.ids[0]
      if (identity !== undefined) {
        const previous = identifiers.get(identity)
        if (previous !== undefined) {
          violations.push(diagnostic(root, scenario, `duplicate stable ID; first owned by ${display(root, previous.path)}:${previous.line}`))
        } else {
          identifiers.set(identity, scenario)
        }
      }
      for (const evidence of scenario.evidence) {
        violations.push(...await validateEvidence(root, scenario, evidence, { allowPlanned }))
      }
    }
  }
  return { violations, identifiers }
}

function activeCollisionViolations(root, currentIdentifiers, documents) {
  const violations = []
  for (const document of documents) {
    for (const scenario of document.scenarios) {
      const identity = scenario.ids[0]
      const current = identity === undefined ? undefined : currentIdentifiers.get(identity)
      if (current === undefined) continue
      if (scenario.operation === 'MODIFIED' || scenario.operation === 'REMOVED') continue
      violations.push(diagnostic(root, scenario, `stable ID already belongs to current scenario ${display(root, current.path)}:${current.line}`))
    }
  }
  return violations
}

export async function checkFocusedSpecs(root) {
  const currentPaths = await files(join(root, 'openspec', 'specs'), 'spec.md')
  const currentDocuments = await readDocuments(currentPaths)
  const current = await validateDocuments(root, currentDocuments, { allowPlanned: false })
  const violations = [...current.violations]
  for (const paths of (await activeChangeSpecs(root)).values()) {
    const documents = await readDocuments(paths)
    const active = await validateDocuments(root, documents, { allowPlanned: true })
    violations.push(...active.violations, ...activeCollisionViolations(root, current.identifiers, documents))
  }
  return [...new Set(violations)].sort()
}

export async function checkFocusedSpecChange(root, changeName) {
  const changeRoot = join(root, 'openspec', 'changes', changeName)
  if (!await exists(changeRoot) || changeName === 'archive') return [`openspec change does not exist: ${changeName}`]
  const currentPaths = await files(join(root, 'openspec', 'specs'), 'spec.md')
  const current = await validateDocuments(root, await readDocuments(currentPaths), { allowPlanned: false })
  const documents = await readDocuments(await files(join(changeRoot, 'specs'), 'spec.md'))
  const active = await validateDocuments(root, documents, { allowPlanned: false })
  return [...new Set([
    ...current.violations,
    ...active.violations,
    ...activeCollisionViolations(root, current.identifiers, documents),
  ])].sort()
}

function executionRoot(relativePath) {
  const parts = relativePath.split('/')
  if (parts[0] === 'scripts') return 'scripts'
  if (parts[0] === 'packages' && parts.length >= 2) return `packages/${parts[1]}`
  return undefined
}

export async function planFocusedSpecRun(root, options = {}) {
  const changeName = options.changeName
  const violations = changeName === undefined
    ? await checkFocusedSpecs(root)
    : await checkFocusedSpecChange(root, changeName)
  if (violations.length > 0) {
    throw new Error(`focused spec execution planning failed:\n${violations.join('\n')}`)
  }

  const specificationRoot = changeName === undefined
    ? join(root, 'openspec', 'specs')
    : join(root, 'openspec', 'changes', changeName, 'specs')
  const documents = await readDocuments(await files(specificationRoot, 'spec.md'))
  const targetByKey = new Map()
  const scenarios = []
  for (const document of documents) {
    for (const scenario of document.scenarios) {
      const evidenceKeys = []
      for (const evidence of scenario.evidence) {
        const resolved = await resolveEvidence(root, evidence)
        if (resolved.violation !== undefined) {
          throw new Error(`focused spec execution planning failed:\n${document.path}: ${resolved.violation}`)
        }
        const rootPath = executionRoot(resolved.relativePath)
        if (rootPath === undefined) {
          throw new Error(`focused spec execution planning failed:\n${document.path}: evidence is outside a supported Vitest root: ${resolved.relativePath}`)
        }
        const key = evidence
        evidenceKeys.push(key)
        if (!targetByKey.has(key)) {
          targetByKey.set(key, {
            key,
            reference: evidence,
            relativePath: resolved.relativePath,
            absolutePath: resolved.absolutePath,
            line: resolved.line,
            title: resolved.title,
            rootPath,
            absoluteRootPath: resolve(root, rootPath),
          })
        }
      }
      for (const id of scenario.ids) scenarios.push({ id, evidenceKeys })
    }
  }

  scenarios.sort((left, right) => left.id.localeCompare(right.id))
  const targets = [...targetByKey.values()].sort((left, right) => left.key.localeCompare(right.key))
  const groupsByRoot = new Map()
  for (const target of targets) {
    const group = groupsByRoot.get(target.rootPath) ?? {
      rootPath: target.rootPath,
      absoluteRootPath: target.absoluteRootPath,
      targets: [],
    }
    group.targets.push(target)
    groupsByRoot.set(target.rootPath, group)
  }
  const groups = [...groupsByRoot.values()].sort((left, right) => left.rootPath.localeCompare(right.rootPath))

  return {
    root,
    mode: changeName === undefined ? 'current' : 'change',
    ...(changeName === undefined ? {} : { changeName }),
    scenarios,
    targets,
    groups,
  }
}
