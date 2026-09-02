import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { basename, isAbsolute, join, normalize } from 'node:path'
import { dump, load } from 'js-yaml'
import {
  applyMutation,
  commandDigest,
  deepFreeze,
  EvolutionError,
  operationId,
  type EvolutionDiagnostic,
  type EvolutionEvidenceSummary,
  type EvolutionHistoryEntry,
  type EvolutionMutationCommand,
  type EvolutionMutationContext,
  type EvolutionProposal,
  type EvolutionProposalKind,
  type EvolutionProposalStatus,
  type EvolutionReminderDelivery,
  validateStoredProposal,
} from './model.ts'
import {
  EVOLUTION_PROJECT_DOCUMENT_VERSION,
  type EvolutionProjectDocument,
} from './schema.ts'

interface ProjectPartition {
  readonly root: string
  readonly instanceId: string
  readonly actorId: string
  readonly projectId: string
}

interface LoadedDocument {
  readonly path: string
  readonly raw: string
  readonly document: EvolutionProjectDocument
}

interface ProjectSnapshot {
  readonly documents: readonly LoadedDocument[]
  readonly diagnostics: readonly EvolutionDiagnostic[]
}

const STATUS = new Set<EvolutionProposalStatus>([
  'proposed', 'reviewing', 'researching', 'options-ready', 'selected', 'planned',
  'implementing', 'snoozed', 'rejected', 'done',
])
const KIND = new Set<EvolutionProposalKind>(['persona', 'capability'])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} contains unsupported fields: ${extras.join(', ')}`)
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : string(value, field)
}

function iso(value: unknown, field: string): string {
  const result = string(value, field)
  const date = new Date(result)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be an ISO 8601 UTC timestamp`)
  }
  return result
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be a positive safe integer`)
  }
  return value
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be a string array`)
  }
  return Object.freeze([...value])
}

function evidence(value: unknown, field: string): readonly EvolutionEvidenceSummary[] {
  if (!Array.isArray(value)) throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be an array`)
  return Object.freeze(value.map((item, index) => {
    const source = record(item, `${field}[${index}]`)
    exactKeys(source, ['id', 'summary', 'sourceId', 'createdAt'], `${field}[${index}]`)
    return deepFreeze({
      id: string(source.id, `${field}[${index}].id`),
      summary: string(source.summary, `${field}[${index}].summary`),
      sourceId: string(source.sourceId, `${field}[${index}].sourceId`),
      createdAt: iso(source.createdAt, `${field}[${index}].createdAt`),
    })
  }))
}

function history(value: unknown, field: string): readonly EvolutionHistoryEntry[] {
  if (!Array.isArray(value)) throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be an array`)
  return Object.freeze(value.map((item, index) => {
    const source = record(item, `${field}[${index}]`)
    exactKeys(source, ['id', 'fromStatus', 'toStatus', 'detail', 'sourceIds', 'createdAt'], `${field}[${index}]`)
    const fromStatus = optionalString(source.fromStatus, `${field}[${index}].fromStatus`) as EvolutionProposalStatus | undefined
    const toStatus = string(source.toStatus, `${field}[${index}].toStatus`) as EvolutionProposalStatus
    if ((fromStatus !== undefined && !STATUS.has(fromStatus)) || !STATUS.has(toStatus)) {
      throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field}[${index}] contains an invalid status`)
    }
    return deepFreeze({
      id: string(source.id, `${field}[${index}].id`),
      ...(fromStatus === undefined ? {} : { fromStatus }),
      toStatus,
      detail: string(source.detail, `${field}[${index}].detail`),
      sourceIds: stringArray(source.sourceIds, `${field}[${index}].sourceIds`),
      createdAt: iso(source.createdAt, `${field}[${index}].createdAt`),
    })
  }))
}

function reminders(value: unknown, field: string): readonly EvolutionReminderDelivery[] {
  if (!Array.isArray(value)) throw new EvolutionError('INVALID_PROJECT_DOCUMENT', `${field} must be an array`)
  return Object.freeze(value.map((item, index) => {
    const source = record(item, `${field}[${index}]`)
    exactKeys(source, ['id', 'sessionId', 'turnId', 'createdAt'], `${field}[${index}]`)
    return deepFreeze({
      id: string(source.id, `${field}[${index}].id`),
      sessionId: string(source.sessionId, `${field}[${index}].sessionId`),
      turnId: string(source.turnId, `${field}[${index}].turnId`),
      createdAt: iso(source.createdAt, `${field}[${index}].createdAt`),
    })
  }))
}

function proposal(value: unknown, partition: ProjectPartition, filename: string): EvolutionProposal {
  const source = record(value, 'proposal')
  exactKeys(source, [
    'id', 'instanceId', 'actorId', 'kind', 'scope', 'projectId', 'dedupeKey', 'title',
    'rationale', 'tags', 'status', 'revision', 'snoozedUntil', 'resumeStatus', 'evidence',
    'history', 'reminders', 'createdAt', 'updatedAt',
  ], 'proposal')
  const id = string(source.id, 'proposal.id')
  if (!SAFE_ID.test(id) || filename !== `${id}.yaml`) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'proposal id must equal its safe YAML filename')
  }
  const kind = string(source.kind, 'proposal.kind') as EvolutionProposalKind
  const status = string(source.status, 'proposal.status') as EvolutionProposalStatus
  if (!KIND.has(kind) || !STATUS.has(status)) throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'proposal kind or status is invalid')
  if (source.scope !== 'project' || kind !== 'capability') {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'project documents must contain project-scoped capability proposals')
  }
  if (source.instanceId !== partition.instanceId || source.actorId !== partition.actorId || source.projectId !== partition.projectId) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'proposal partition does not match the active Runtime Session')
  }
  const snoozedUntil = source.snoozedUntil === undefined ? undefined : iso(source.snoozedUntil, 'proposal.snoozedUntil')
  const resumeStatus = optionalString(source.resumeStatus, 'proposal.resumeStatus') as EvolutionProposal['resumeStatus']
  if ((status === 'snoozed') !== (snoozedUntil !== undefined && resumeStatus !== undefined)) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'snoozed proposal fields are inconsistent')
  }
  const stored: EvolutionProposal = deepFreeze({
    id,
    instanceId: partition.instanceId,
    actorId: partition.actorId,
    kind: 'capability',
    scope: 'project',
    projectId: partition.projectId,
    dedupeKey: string(source.dedupeKey, 'proposal.dedupeKey'),
    title: string(source.title, 'proposal.title'),
    rationale: string(source.rationale, 'proposal.rationale'),
    tags: stringArray(source.tags, 'proposal.tags'),
    status,
    revision: positiveInteger(source.revision, 'proposal.revision'),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    ...(resumeStatus === undefined ? {} : { resumeStatus }),
    evidence: evidence(source.evidence, 'proposal.evidence'),
    history: history(source.history, 'proposal.history'),
    reminders: reminders(source.reminders, 'proposal.reminders'),
    createdAt: iso(source.createdAt, 'proposal.createdAt'),
    updatedAt: iso(source.updatedAt, 'proposal.updatedAt'),
  })
  return validateStoredProposal(stored)
}

function parseDocument(raw: string, partition: ProjectPartition, filename: string): EvolutionProjectDocument {
  let loaded: unknown
  try {
    loaded = load(raw, { schema: undefined, json: true })
  } catch (cause) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', cause instanceof Error ? cause.message : String(cause))
  }
  const source = record(loaded, 'document')
  exactKeys(source, ['version', 'proposal', 'operations'], 'document')
  if (source.version !== EVOLUTION_PROJECT_DOCUMENT_VERSION) {
    throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'unsupported project document version')
  }
  const canonicalProposal = proposal(source.proposal, partition, filename)
  const operationSource = record(source.operations, 'document.operations')
  const operations: Record<string, { digest: string; proposal: EvolutionProposal }> = {}
  for (const [id, item] of Object.entries(operationSource)) {
    if (id.trim().length === 0 || id.length > 200) throw new EvolutionError('INVALID_PROJECT_DOCUMENT', 'operation key is invalid')
    const operation = record(item, `document.operations.${id}`)
    exactKeys(operation, ['digest', 'proposal'], `document.operations.${id}`)
    operations[id] = deepFreeze({
      digest: string(operation.digest, `document.operations.${id}.digest`),
      proposal: proposal(operation.proposal, partition, filename),
    })
  }
  return deepFreeze({ version: EVOLUTION_PROJECT_DOCUMENT_VERSION, proposal: canonicalProposal, operations: deepFreeze(operations) })
}

function renderDocument(document: EvolutionProjectDocument): string {
  return dump(document, {
    noRefs: true,
    noCompatMode: true,
    sortKeys: true,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
  })
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

export class ProjectEvolutionStore {
  private readonly directory: string
  private readonly lockPath: string

  private readonly partition: ProjectPartition
  private readonly lockTimeoutMs: number

  constructor(partition: ProjectPartition, lockTimeoutMs: number) {
    this.partition = partition
    this.lockTimeoutMs = lockTimeoutMs
    const root = normalize(partition.root)
    if (!isAbsolute(root)) throw new TypeError('project Evolution root must be absolute')
    this.directory = join(root, '.doppelganger', 'evolution', 'opportunities')
    this.lockPath = join(root, '.doppelganger', 'evolution', '.lock')
  }

  async list(): Promise<ProjectSnapshot> {
    let entries
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { documents: Object.freeze([]), diagnostics: Object.freeze([]) }
      throw cause
    }
    const documents: LoadedDocument[] = []
    const diagnostics: EvolutionDiagnostic[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name.endsWith('.yaml')) continue
      const path = join(this.directory, entry.name)
      try {
        const metadata = await lstat(path)
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new EvolutionError('UNSAFE_PROJECT_PATH', 'project proposal must be a regular non-symlink file')
        }
        const raw = await readFile(path, 'utf8')
        documents.push({ path, raw, document: parseDocument(raw, this.partition, entry.name) })
      } catch (cause) {
        diagnostics.push(deepFreeze({
          path,
          code: cause instanceof EvolutionError ? cause.code : 'PROJECT_READ_FAILED',
          message: cause instanceof Error ? cause.message : String(cause),
        }))
      }
    }
    return deepFreeze({ documents: Object.freeze(documents), diagnostics: Object.freeze(diagnostics) })
  }

  async inspect(id: string): Promise<{ proposal?: EvolutionProposal; diagnostics: readonly EvolutionDiagnostic[] }> {
    const snapshot = await this.list()
    return deepFreeze({
      ...(snapshot.documents.find(item => item.document.proposal.id === id)?.document.proposal === undefined
        ? {}
        : { proposal: snapshot.documents.find(item => item.document.proposal.id === id)!.document.proposal }),
      diagnostics: snapshot.diagnostics,
    })
  }

  async mutate(command: EvolutionMutationCommand, context: EvolutionMutationContext): Promise<EvolutionProposal> {
    const release = await this.acquireLock()
    try {
      const snapshot = await this.list()
      const commandId = operationId(command)
      const digest = commandDigest(command)
      for (const loaded of snapshot.documents) {
        const receipt = loaded.document.operations[commandId]
        if (receipt === undefined) continue
        if (receipt.digest !== digest) {
          throw new EvolutionError('OPERATION_CONFLICT', `operationId "${commandId}" was reused with a different command`)
        }
        return receipt.proposal
      }
      const current = snapshot.documents.map(item => item.document.proposal)
      const next = applyMutation(current, command, context)
      if (next.scope !== 'project') throw new EvolutionError('INVALID_SCOPE', 'project store received a global proposal')
      const previous = snapshot.documents.find(item => item.document.proposal.id === next.id)
      const operations = { ...(previous?.document.operations ?? {}), [commandId]: deepFreeze({ digest, proposal: next }) }
      const document: EvolutionProjectDocument = deepFreeze({ version: EVOLUTION_PROJECT_DOCUMENT_VERSION, proposal: next, operations })
      const target = join(this.directory, `${next.id}.yaml`)
      if (previous !== undefined) {
        const metadata = await lstat(previous.path)
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new EvolutionError('UNSAFE_PROJECT_PATH', 'project proposal path changed unsafely')
        const currentRaw = await readFile(previous.path, 'utf8')
        if (createHash('sha256').update(currentRaw).digest('hex') !== createHash('sha256').update(previous.raw).digest('hex')) {
          throw new EvolutionError('REVISION_CONFLICT', 'project proposal changed during mutation')
        }
      } else {
        try {
          await lstat(target)
          throw new EvolutionError('REVISION_CONFLICT', 'project proposal target already exists')
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
        }
      }
      await this.atomicWrite(target, renderDocument(document))
      return next
    } finally {
      await release()
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(join(this.partition.root, '.doppelganger', 'evolution'), { recursive: true })
    const started = Date.now()
    while (true) {
      try {
        await mkdir(this.lockPath)
        return async () => { await rm(this.lockPath, { recursive: true, force: true }) }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
        if (Date.now() - started >= this.lockTimeoutMs) throw new EvolutionError('PROJECT_LOCK_TIMEOUT', 'timed out acquiring project Evolution lock')
        await sleep(25)
      }
    }
  }

  private async atomicWrite(target: string, content: string): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `.${basename(target)}.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, target)
      const directory = await open(this.directory, 'r')
      try { await directory.sync() } finally { await directory.close() }
    } catch (cause) {
      await rm(temporary, { force: true })
      throw cause
    }
  }
}
