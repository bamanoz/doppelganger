import type {
  PgVectorClient,
  PgVectorPool,
  PgVectorQueryResult,
  PgVectorRuntime,
} from '../../src/pgvector.ts'

export interface RecordedPgVectorQuery {
  readonly text: string
  readonly values: readonly unknown[]
}

export type PgVectorQueryResponder = (
  text: string,
  values: readonly unknown[],
) => PgVectorQueryResult | Promise<PgVectorQueryResult>

export class FakePgVectorPool implements PgVectorPool {
  readonly queries: RecordedPgVectorQuery[] = []
  ended = false
  released = 0

  private readonly responder: PgVectorQueryResponder

  constructor(responder: PgVectorQueryResponder = () => ({ rows: [] })) {
    this.responder = responder
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PgVectorQueryResult<Row>> {
    this.queries.push({ text, values })
    return await this.responder(text, values) as PgVectorQueryResult<Row>
  }

  connect(): Promise<PgVectorClient> {
    return Promise.resolve({
      query: <Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<PgVectorQueryResult<Row>> => this.query<Row>(text, values),
      release: () => { this.released += 1 },
    })
  }

  end(): Promise<void> {
    this.ended = true
    return Promise.resolve()
  }
}
interface StoredPgVectorRow {
  readonly vectorId: string
  readonly generationId: string
  readonly recordId: string
  readonly revisionId: string
  readonly instanceId: string
  readonly actorId: string
  readonly scopeKind: string
  readonly projectId: string | null
  readonly kind: string
  readonly status: string
  readonly vector: readonly number[]
}

function decodedVector(value: unknown): readonly number[] {
  if (typeof value !== 'string') throw new TypeError('fake pgvector value must be encoded')
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'number')) throw new TypeError('fake pgvector value is malformed')
  return parsed
}

export class StatefulFakePgVectorPool extends FakePgVectorPool {
  private readonly vectors = new Map<string, StoredPgVectorRow>()
  private indexPresent = false

  override async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PgVectorQueryResult<Row>> {
    this.queries.push({ text, values })
    if (text.startsWith('INSERT INTO') && text.includes('_metadata')) return { rows: [], rowCount: 1 }
    if (text.startsWith('INSERT INTO')) {
      this.vectors.set(String(values[0]), {
        vectorId: String(values[0]), generationId: String(values[1]), recordId: String(values[2]),
        revisionId: String(values[3]), instanceId: String(values[4]), actorId: String(values[5]),
        scopeKind: String(values[6]), projectId: values[7] === null ? null : String(values[7]),
        kind: String(values[8]), status: String(values[10]), vector: decodedVector(values[11]),
      })
      return { rows: [], rowCount: 1 }
    }
    if (text.startsWith('DELETE FROM')) {
      this.vectors.delete(String(values[0]))
      return { rows: [], rowCount: 1 }
    }
    if (text.includes('SELECT COUNT(*)')) return { rows: [{ count: String(this.vectors.size) }] as unknown as Row[] }
    if (text.includes('FROM pg_indexes')) return { rows: (this.indexPresent ? [{ exists: 1 }] : []) as unknown as Row[] }
    if (text.includes('CREATE INDEX')) this.indexPresent = true
    if (text.includes('SELECT generation_id')) {
      let offset = 3
      const generationId = String(values[0])
      const instanceId = String(values[1])
      const actorId = String(values[2])
      const take = (present: boolean): unknown => present ? values[offset++] : undefined
      const scopeKind = take(text.includes('scope_kind ='))
      const projectId = take(text.includes('project_id ='))
      const kind = take(text.includes(' AND kind ='))
      const status = take(text.includes(' AND status ='))
      const queryVector = decodedVector(values[offset++])
      const limit = Number(values[offset])
      const rows = [...this.vectors.values()].filter(row => row.generationId === generationId
        && row.instanceId === instanceId && row.actorId === actorId
        && (scopeKind === undefined || row.scopeKind === scopeKind)
        && (!text.includes('project_id IS NULL') || row.projectId === null)
        && (projectId === undefined || row.projectId === projectId)
        && (kind === undefined || row.kind === kind)
        && (status === undefined || row.status === status))
        .map(row => ({
          generation_id: row.generationId,
          record_id: row.recordId,
          revision_id: row.revisionId,
          score: row.vector.reduce((score, component, index) => score + component * (queryVector[index] ?? 0), 0),
        }))
        .sort((left, right) => right.score - left.score || left.record_id.localeCompare(right.record_id) || left.revision_id.localeCompare(right.revision_id))
        .slice(0, limit)
      return { rows: rows as unknown as Row[] }
    }
    return { rows: [] }
  }
}

export function fakePgVectorRuntime(pool: FakePgVectorPool): PgVectorRuntime {
  return {
    createPool: () => pool,
    encodeVector: vector => `[${vector.join(',')}]`,
  }
}
