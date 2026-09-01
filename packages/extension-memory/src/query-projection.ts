export type MemorySemanticQueryProjectionMethod = 'pass-through' | 'final-question' | 'trailing-segment' | 'bounded-tail'

export interface MemorySemanticQueryProjection {
  readonly query: string
  readonly method: MemorySemanticQueryProjectionMethod
  readonly originalCharacters: number
  readonly projectedCharacters: number
}

function characters(value: string): readonly string[] {
  return [...value]
}

function bounded(value: string, maximumCharacters: number, tail = false): string {
  const points = characters(value)
  if (points.length <= maximumCharacters) return value
  return (tail ? points.slice(-maximumCharacters) : points.slice(0, maximumCharacters)).join('')
}

function meaningful(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value)
}

function normalize(value: string): string {
  return value.toWellFormed().normalize('NFKC').replaceAll(/\s+/gu, ' ').trim()
}

export function projectMemorySemanticQuery(
  input: string,
  maximumCharacters: number,
): MemorySemanticQueryProjection {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters <= 0) {
    throw new TypeError('semantic query maximumCharacters must be a positive safe integer')
  }
  const normalized = normalize(input)
  const originalCharacters = characters(normalized).length
  if (originalCharacters <= maximumCharacters) {
    return Object.freeze({
      query: normalized,
      method: 'pass-through',
      originalCharacters,
      projectedCharacters: originalCharacters,
    })
  }
  const questions = [...normalized.matchAll(/(?:^|[.!。！？?]\s+)([^.!。！？?]{1,4096}[?？])/gu)]
  for (let index = questions.length - 1; index >= 0; index -= 1) {
    const candidate = normalize(questions[index]?.[1] ?? '')
    const length = characters(candidate).length
    if (meaningful(candidate) && length <= maximumCharacters) {
      return Object.freeze({
        query: candidate,
        method: 'final-question',
        originalCharacters,
        projectedCharacters: length,
      })
    }
  }

  const segments = normalized.split(/(?:\n+|(?<=[.!。！？?])\s+)/u)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const candidate = normalize(segments[index] ?? '')
    const length = characters(candidate).length
    if (meaningful(candidate) && length <= maximumCharacters) {
      return Object.freeze({
        query: candidate,
        method: 'trailing-segment',
        originalCharacters,
        projectedCharacters: length,
      })
    }
  }

  const query = bounded(normalized, maximumCharacters, true)
  return Object.freeze({
    query,
    method: 'bounded-tail',
    originalCharacters,
    projectedCharacters: characters(query).length,
  })
}
