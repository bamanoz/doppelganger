export interface MemoryPartition {
  readonly instanceId: string
  readonly principalId: string
  readonly projectId?: string
}

export interface MemoryEligibilityOptions {
  readonly statuses?: readonly ('active' | 'candidate' | 'rejected')[]
  readonly temporal?: boolean
}

export interface MemoryEligibilityPredicate {
  readonly sql: string
  readonly parameters: readonly (number | string)[]
}

export function memoryEligibility(
  partition: MemoryPartition,
  now: string,
  options: MemoryEligibilityOptions = {},
  alias = 'r',
): MemoryEligibilityPredicate {
  const parameters: (number | string)[] = [partition.instanceId, partition.principalId]
  const predicates = [
    `${alias}.instance_id = ?`,
    `${alias}.principal_id = ?`,
  ]
  if (partition.projectId === undefined) {
    predicates.push(`${alias}.scope_kind = 'relationship'`)
  } else {
    predicates.push(`(${alias}.scope_kind = 'relationship' OR (${alias}.scope_kind = 'project' AND ${alias}.project_id = ?))`)
    parameters.push(partition.projectId)
  }
  if (options.statuses !== undefined) {
    if (options.statuses.length === 0) predicates.push('0 = 1')
    else {
      predicates.push(`${alias}.status IN (${options.statuses.map(() => '?').join(', ')})`)
      parameters.push(...options.statuses)
    }
  }
  if (options.temporal === true) {
    predicates.push(`(${alias}.valid_from IS NULL OR ${alias}.valid_from <= ?)`)
    predicates.push(`(${alias}.valid_until IS NULL OR ${alias}.valid_until > ?)`)
    predicates.push(`(${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`)
    parameters.push(now, now, now)
  }
  return Object.freeze({ sql: predicates.join(' AND '), parameters: Object.freeze(parameters) })
}

export function memoryTemporalState(
  value: { readonly validFrom?: string; readonly validUntil?: string; readonly expiresAt?: string },
  now: string,
): 'eligible' | 'expired' | 'not-yet-valid' {
  if (value.validFrom !== undefined && value.validFrom > now) return 'not-yet-valid'
  if ((value.validUntil !== undefined && value.validUntil <= now) || (value.expiresAt !== undefined && value.expiresAt <= now)) {
    return 'expired'
  }
  return 'eligible'
}
