import { describe, expect, it } from 'vitest'
import { compareSecurityAudit } from '../lib/security-audit.mjs'

function audit(fixAvailable = false, include = true) {
  return {
    vulnerabilities: include ? {
      vulnerable: {
        severity: 'high',
        range: '<2.0.0',
        fixAvailable,
        via: [{ url: 'https://github.com/advisories/GHSA-abcd-1234-efgh' }],
      },
    } : {},
  }
}

function baseline() {
  return {
    version: 1,
    reviewDate: '2026-08-30',
    deploymentRestriction: 'Trusted inputs only.',
    advisories: {
      vulnerable: {
        severity: 'high',
        range: '<2.0.0',
        fixAvailable: false,
        advisoryIds: ['GHSA-abcd-1234-efgh'],
        dependencyPath: 'root > vulnerable@1.0.0',
      },
    },
  }
}

describe('security advisory baseline', () => {
  it('accepts unchanged reviewed advisories', () => {
    expect(compareSecurityAudit(audit(), baseline())).toEqual([])
  })

  it('rejects newly introduced advisories', () => {
    const changed = audit()
    changed.vulnerabilities.newDependency = {
      severity: 'moderate',
      range: '*',
      fixAvailable: false,
      via: [],
    }
    expect(compareSecurityAudit(changed, baseline())).toContain('new production advisory: newDependency')
  })

  it('requires review when a baseline advisory resolves', () => {
    expect(compareSecurityAudit(audit(false, false), baseline())).toEqual([
      'reviewed advisory resolved or dependency path changed: vulnerable',
    ])
  })

  it('fails when a compatible fix becomes available', () => {
    expect(compareSecurityAudit(audit(true), baseline())).toContain(
      'compatible fix is now available: vulnerable',
    )
  })
})
