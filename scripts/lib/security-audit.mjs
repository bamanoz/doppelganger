function isObject(value) {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
}

function advisoryIds(vulnerability) {
  const ids = []
  for (const via of vulnerability.via ?? []) {
    if (!isObject(via) || typeof via.url !== 'string') continue
    const match = /\/advisories\/(GHSA-[a-z0-9-]+)/iu.exec(via.url)
    if (match?.[1] !== undefined) ids.push(match[1])
  }
  return [...new Set(ids)].sort()
}

export function summarizeAudit(audit) {
  if (!isObject(audit) || !isObject(audit.vulnerabilities)) throw new TypeError('npm audit output must contain vulnerabilities')
  return Object.fromEntries(Object.entries(audit.vulnerabilities).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => {
    if (!isObject(value)) throw new TypeError(`npm audit vulnerability ${name} must be an object`)
    return [name, {
      severity: value.severity,
      range: value.range,
      fixAvailable: value.fixAvailable !== false,
      advisoryIds: advisoryIds(value),
    }]
  }))
}

export function compareSecurityAudit(audit, baseline) {
  const violations = []
  if (!isObject(baseline) || baseline.version !== 1 || typeof baseline.reviewDate !== 'string'
    || typeof baseline.deploymentRestriction !== 'string' || !isObject(baseline.advisories)) {
    return ['security advisory baseline: invalid schema']
  }
  const actual = summarizeAudit(audit)
  const baselineNames = Object.keys(baseline.advisories).sort()
  const actualNames = Object.keys(actual).sort()
  for (const name of actualNames) {
    if (!(name in baseline.advisories)) violations.push(`new production advisory: ${name}`)
  }
  for (const name of baselineNames) {
    const expected = baseline.advisories[name]
    const observed = actual[name]
    if (observed === undefined) {
      violations.push(`reviewed advisory resolved or dependency path changed: ${name}`)
      continue
    }
    if (expected.fixAvailable === false && observed.fixAvailable === true) {
      violations.push(`compatible fix is now available: ${name}`)
    }
    for (const field of ['severity', 'range', 'fixAvailable']) {
      if (JSON.stringify(expected[field]) !== JSON.stringify(observed[field])) {
        violations.push(`security baseline drift for ${name}.${field}: expected ${JSON.stringify(expected[field])}, observed ${JSON.stringify(observed[field])}`)
      }
    }
    if (JSON.stringify(expected.advisoryIds) !== JSON.stringify(observed.advisoryIds)) {
      violations.push(`security baseline drift for ${name}.advisoryIds: expected ${JSON.stringify(expected.advisoryIds)}, observed ${JSON.stringify(observed.advisoryIds)}`)
    }
  }
  return [...new Set(violations)].sort()
}
