import { expect } from 'vitest'
import type { SqlEntityManager } from '@mikro-orm/sql'
import type { MemorySemanticRetriever } from '../src/index.ts'
import { memoryTransaction } from '../src/persistence/transaction.ts'
import {
  assertActorProjectIsolation,
  assertCurrentRecordReceiptReplay,
  assertForgottenResultReplay,
  assertMemoryToolContractOutcomes,
  assertPromotionProvenance,
  type MemoryBaselineFixture,
} from './memory-baseline.ts'
import { startMemoryTestClient } from './memory-test-process.ts'
import type { MemoryBackendFixture, MemoryBackendSession } from './memory-backend-fixture.ts'

const NOW = '2026-09-06T12:00:00.000Z'

function structuredCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

async function rows(session: MemoryBackendSession, sql: string, parameters: readonly unknown[] = []) {
  return session.database.read(async em => await em.execute(sql, [...parameters], 'all') as readonly Record<string, unknown>[])
}

async function count(session: MemoryBackendSession, table: string, where = '', parameters: readonly unknown[] = []): Promise<number> {
  const result = await rows(session, `SELECT COUNT(*) AS count FROM ${table}${where}`, parameters)
  return Number(result[0]?.count)
}

async function activateSemanticGeneration(session: MemoryBackendSession, generationId = 'backend-generation'): Promise<void> {
  await session.database.write({ instanceId: 'backend-persona' }, async em => {
    const store = await em.execute('SELECT id FROM memory_store', [], 'all') as readonly { id: string }[]
    expect(store).toHaveLength(1)
    const storeId = store[0]!.id
    await em.execute(`
      INSERT INTO memory_semantic_generations (
        id, store_id, instance_id, embedder_identity_json, vector_index_identity_json,
        embedder_fingerprint, vector_backend, vector_target_id, generation_revision,
        transition_token, transition_until, state, created_at, activated_at, completed_at, failure_code
      ) VALUES (?, ?, ?, '{}', '{}', ?, 'sqlite_exact', ?, 1, NULL, NULL, 'active', ?, ?, ?, NULL)
    `, [generationId, storeId, 'backend-persona', 'backend-fingerprint', 'backend-target', NOW, NOW, NOW], 'run')
    await em.execute(`
      INSERT INTO memory_semantic_active_generation (
        store_id, instance_id, generation_id, generation_revision, updated_at
      ) VALUES (?, ?, ?, 1, ?)
    `, [storeId, 'backend-persona', generationId, NOW], 'run')
  })
}

function semanticRetriever(search: MemorySemanticRetriever['search']): MemorySemanticRetriever {
  return {
    search,
    status: () => ({ active: true, supportedMaintenance: [] }),
    async maintenance() {
      throw new Error('semantic maintenance is outside canonical backend conformance')
    },
  }
}

export async function assertProviderActivation(fixture: MemoryBackendFixture): Promise<void> {
  const session = await fixture.createSession({ sessionId: `activation-${fixture.kind}`, capture: true })
  try {
    const record = await session.memory.remember({
      operationId: `activation-remember-${fixture.kind}`,
      subjectKey: 'project.backend.activation',
      kind: 'fact',
      content: `Canonical ${fixture.kind} memory is active.`,
    })
    expect((await session.memory.search({ query: `Canonical ${fixture.kind}`, tokenBudget: 100 }))[0]?.record.id).toBe(record.id)
    await session.emitCommittedTurn({
      deliveryId: `activation-delivery-${fixture.kind}`,
      turnId: `activation-turn-${fixture.kind}`,
      principalInput: '[preference:preference.backend.capture] Prefer durable backend evidence.',
      assistantOutput: 'Acknowledged.',
    })
    expect(await session.memory.listCandidates()).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectKey: 'preference.backend.capture', status: 'candidate' }),
    ]))
    expect(session.tools.snapshot().tools.map(tool => tool.name)).toContain('memory.remember')
  } finally {
    await session.dispose()
  }
}

export async function assertDetachedResults(fixture: MemoryBackendFixture): Promise<void> {
  const session = await fixture.createSession({ sessionId: `detached-${fixture.kind}` })
  const record = await session.memory.remember({
    operationId: `detached-remember-${fixture.kind}`,
    subjectKey: 'project.detached.result',
    kind: 'fact',
    content: 'Detached results remain stable after repository disposal.',
  })
  const snapshot = JSON.parse(JSON.stringify(record))
  await session.dispose()
  expect(JSON.parse(JSON.stringify(record))).toEqual(snapshot)
  expect(record.revision.content).toBe('Detached results remain stable after repository disposal.')
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(record.revision)).toBe(Object.prototype)
}

export async function assertAllMemoryCommands(fixture: MemoryBackendFixture): Promise<void> {
  const first = await fixture.createSession({ sessionId: `commands-${fixture.kind}-one` })
  try {
    const active = await first.memory.remember({
      operationId: `commands-${fixture.kind}-remember`,
      subjectKey: 'project.commands.fact',
      kind: 'fact',
      content: 'Every canonical command is awaited.',
      evidence: { turnId: 'commands-turn-one', role: 'principal' },
    })
    expect(await first.memory.get(active.id)).toEqual(active)
    expect(await first.memory.inspect(active.id)).toEqual(active)
    expect(await first.memory.evidence(active.id)).toHaveLength(1)
    await first.memory.observe({
      operationId: `commands-${fixture.kind}-observe`,
      recordId: active.id,
      turnId: 'commands-turn-two',
      role: 'tool',
      relation: 'support',
      excerpt: 'The command result was observed.',
    })
    expect(await first.memory.evidence(active.id)).toHaveLength(2)
    const corrected = await first.memory.correct({
      operationId: `commands-${fixture.kind}-correct`,
      id: active.id,
      expectedRevisionId: active.revision.id,
      content: 'Every canonical command is awaited and durable.',
    })
    expect((await first.memory.history(active.id)).map(revision => revision.content)).toEqual([
      'Every canonical command is awaited.',
      'Every canonical command is awaited and durable.',
    ])
    expect((await first.memory.pin({ operationId: `commands-${fixture.kind}-pin`, id: active.id, pinned: true })).pinned).toBe(true)
    expect((await first.memory.pin({ operationId: `commands-${fixture.kind}-unpin`, id: active.id, pinned: false })).pinned).toBe(false)

    const approved = await first.memory.propose({
      operationId: `commands-${fixture.kind}-propose-approved`,
      subjectKey: 'project.commands.approved',
      kind: 'decision',
      content: 'Approve this candidate manually.',
    })
    expect((await first.memory.listCandidates()).map(record => record.id)).toContain(approved.id)
    expect((await first.memory.approve({ operationId: `commands-${fixture.kind}-approve`, candidateId: approved.id })).status).toBe('active')

    const rejected = await first.memory.propose({
      operationId: `commands-${fixture.kind}-propose-rejected`,
      subjectKey: 'project.commands.rejected',
      kind: 'fact',
      content: 'Reject this candidate manually.',
    })
    expect((await first.memory.reject({ operationId: `commands-${fixture.kind}-reject`, candidateId: rejected.id })).status).toBe('rejected')

    const conflictActive = await first.memory.remember({
      operationId: `commands-${fixture.kind}-conflict-active`,
      subjectKey: 'project.commands.conflict',
      kind: 'decision',
      content: 'The project uses transport A.',
    })
    const conflictCandidate = await first.memory.propose({
      operationId: `commands-${fixture.kind}-conflict-candidate`,
      subjectKey: 'project.commands.conflict',
      kind: 'decision',
      content: 'The project uses transport B.',
      evidence: { turnId: 'commands-conflict-turn', role: 'principal' },
    })
    const conflict = (await first.memory.conflicts(conflictCandidate.id))[0]
    expect(conflict).toMatchObject({ activeRecordId: conflictActive.id, candidateRecordId: conflictCandidate.id, status: 'unresolved' })
    const resolved = await first.memory.resolveConflict({
      operationId: `commands-${fixture.kind}-resolve`,
      conflictId: conflict!.id,
      expectedRevisionId: conflictActive.revision.id,
      resolution: 'promote-candidate',
    })
    expect(resolved.revision).toMatchObject({
      content: 'The project uses transport B.',
      sourceKind: 'conflict-resolution',
      supersedesRevisionId: conflictActive.revision.id,
    })
    expect((await first.memory.conflicts(conflictActive.id))[0]?.status).toBe('resolved-candidate')

    expect((await first.memory.search({ query: 'canonical command durable', tokenBudget: 100 })).map(result => result.record.id)).toContain(corrected.id)
    expect((await first.memory.automaticRecall('canonical command durable', 100)).map(record => record.id)).toContain(corrected.id)
    expect(first.memory.semanticFailure()).toBeUndefined()
    expect(await first.memory.forget({ operationId: `commands-${fixture.kind}-forget`, id: corrected.id })).toBe(true)
    expect(await first.memory.get(corrected.id)).toBeUndefined()
  } finally {
    await first.dispose()
  }

  const seed = await fixture.createSession({ sessionId: `commands-${fixture.kind}-corroboration-one` })
  const candidate = await seed.memory.propose({
    operationId: `commands-${fixture.kind}-corroboration-propose`,
    subjectKey: 'preference.commands.corroboration',
    kind: 'preference',
    content: 'Prefer explicit canonical evidence.',
    scope: 'relationship',
    evidence: { turnId: 'commands-corroboration-one', role: 'principal' },
  })
  await seed.dispose()
  const corroboration = await fixture.createSession({ sessionId: `commands-${fixture.kind}-corroboration-two` })
  try {
    expect((await corroboration.memory.corroborate({
      operationId: `commands-${fixture.kind}-corroborate`,
      candidateId: candidate.id,
      turnId: 'commands-corroboration-two',
      content: 'Explicit canonical evidence remains preferred.',
      role: 'principal',
    })).status).toBe('active')
  } finally {
    await corroboration.dispose()
  }
}

export async function assertTemporalPinningAuthorityAndBudget(fixture: MemoryBackendFixture): Promise<void> {
  let clock = new Date(NOW)
  const session = await fixture.createSession({ sessionId: `authority-${fixture.kind}`, now: () => clock })
  try {
    const preference = await session.memory.remember({
      operationId: `authority-${fixture.kind}-preference`, subjectKey: 'preference.response.evidence', kind: 'preference',
      content: 'Prefer concrete evidence in answers.', scope: 'relationship',
    })
    await session.memory.pin({ operationId: `authority-${fixture.kind}-pin`, id: preference.id, pinned: true })
    const identity = await session.memory.remember({
      operationId: `authority-${fixture.kind}-identity`, subjectKey: 'principal.identity.name', kind: 'fact',
      content: 'The principal is called Robin.', scope: 'relationship',
    })
    const ranked = await session.memory.remember({
      operationId: `authority-${fixture.kind}-ranked`, subjectKey: 'project.evidence.location', kind: 'fact',
      content: 'Concrete evidence is stored canonically.',
    })
    const future = await session.memory.remember({
      operationId: `authority-${fixture.kind}-future`, subjectKey: 'project.future.window', kind: 'fact',
      content: 'The future window is open.', validFrom: '2026-09-07T00:00:00.000Z',
    })
    const expiring = await session.memory.remember({
      operationId: `authority-${fixture.kind}-expiring`, subjectKey: 'project.expiring.window', kind: 'fact',
      content: 'The temporary window is open.', expiresAt: '2026-09-06T12:01:00.000Z',
    })
    expect((await session.memory.search({ query: 'window open', tokenBudget: 100 })).map(result => result.record.id)).toEqual([expiring.id])
    expect((await session.memory.inspect(future.id)).temporalState).toBe('not-yet-valid')

    const stable = await session.context.doppelgangerContext.resolve({ turn: { input: 'unrelated greeting' }, tokenBudget: 1_000 })
    expect(stable.contributions.map(item => item.source)).toEqual([`memory.${preference.id}`, `memory.${identity.id}`])
    const selected = await session.context.doppelgangerContext.resolve({ turn: { input: 'concrete evidence' }, tokenBudget: 1_000 })
    expect(selected.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: `memory.${preference.id}`, authority: 'instruction' }),
      expect.objectContaining({ source: `memory.${identity.id}`, authority: 'data' }),
      expect.objectContaining({ source: `memory.${ranked.id}`, authority: 'data' }),
    ]))
    const constrained = await session.context.doppelgangerContext.resolve({ turn: { input: 'concrete evidence' }, tokenBudget: stable.tokenCount })
    expect(constrained.contributions).toEqual(stable.contributions)
    expect(constrained.omittedSources).toContain(`memory.${ranked.id}`)

    clock = new Date('2026-09-07T12:00:00.000Z')
    expect((await session.memory.search({ query: 'window open', tokenBudget: 100 })).map(result => result.record.id)).toEqual([future.id])
    expect((await session.memory.inspect(expiring.id)).temporalState).toBe('expired')
    expect((await session.memory.history(expiring.id))[0]?.content).toBe('The temporary window is open.')
  } finally {
    await session.dispose()
  }
}

export async function assertCapturePersistence(fixture: MemoryBackendFixture): Promise<void> {
  const session = await fixture.createSession({ sessionId: `capture-${fixture.kind}`, capture: true })
  try {
    await session.emitCommittedTurn({
      deliveryId: `capture-delivery-${fixture.kind}`,
      turnId: `capture-turn-${fixture.kind}`,
      principalInput: '[fact:project.capture.contract] Capture writes review candidates.',
      assistantOutput: 'The committed turn completed.',
    })
    const candidates = await session.memory.listCandidates()
    expect(candidates).toEqual([
      expect.objectContaining({ subjectKey: 'project.capture.contract', status: 'candidate', revision: expect.objectContaining({ content: 'Capture writes review candidates.' }) }),
    ])
    expect(await session.memory.evidence(candidates[0]!.id)).toEqual([
      expect.objectContaining({ sourceTurnId: `capture-turn-${fixture.kind}`, role: 'principal' }),
    ])
  } finally {
    await session.dispose()
  }
}

export async function assertCompleteCanonicalMemoryContract(fixture: MemoryBackendFixture): Promise<void> {
  const baseline = fixture as MemoryBaselineFixture
  await assertCurrentRecordReceiptReplay(baseline)
  await assertForgottenResultReplay(baseline)
  await assertPromotionProvenance(baseline)
  await assertActorProjectIsolation(baseline)
  await assertMemoryToolContractOutcomes(baseline)
  await assertAllMemoryCommands(fixture)
  await assertTemporalPinningAuthorityAndBudget(fixture)
  await assertCapturePersistence(fixture)
}

export async function assertScopedLexicalRecall(fixture: MemoryBackendFixture): Promise<void> {
  const owner = await fixture.createSession({ actorId: 'scope-actor', sessionId: 'scope-owner', projectId: 'alpha' })
  const relationship = await owner.memory.remember({ operationId: 'scope-relationship', subjectKey: 'preference.scope.evidence', kind: 'preference', content: 'Always state backend evidence.', scope: 'relationship' })
  await owner.memory.pin({ operationId: 'scope-pin', id: relationship.id, pinned: true })
  const alpha = await owner.memory.remember({ operationId: 'scope-alpha', subjectKey: 'project.scope.transport', kind: 'fact', content: 'Project alpha uses framed transport.' })
  await owner.dispose()
  const beta = await fixture.createSession({ actorId: 'scope-actor', sessionId: 'scope-beta', projectId: 'beta' })
  await beta.memory.remember({ operationId: 'scope-beta', subjectKey: 'project.scope.transport', kind: 'fact', content: 'Project beta uses framed transport.' })
  await beta.dispose()
  const foreign = await fixture.createSession({ actorId: 'foreign-actor', sessionId: 'scope-foreign', projectId: 'alpha' })
  await foreign.memory.remember({ operationId: 'scope-foreign', subjectKey: 'project.scope.transport', kind: 'fact', content: 'Foreign actor uses framed transport.' })
  await foreign.dispose()
  const reader = await fixture.createSession({ actorId: 'scope-actor', sessionId: 'scope-reader', projectId: 'alpha' })
  try {
    expect((await reader.memory.search({ query: 'backend evidence framed transport', tokenBudget: 200 })).map(result => result.record.id)).toEqual([relationship.id, alpha.id])
  } finally {
    await reader.dispose()
  }
}

export async function assertLexicalFallback(fixture: MemoryBackendFixture): Promise<void> {
  const seed = await fixture.createSession({ sessionId: `fallback-seed-${fixture.kind}` })
  const lexical = await seed.memory.remember({ operationId: `fallback-seed-${fixture.kind}`, subjectKey: 'project.fallback.lexical', kind: 'fact', content: 'Lexical fallback remains available.' })
  await activateSemanticGeneration(seed)
  await seed.dispose()
  const reader = await fixture.createSession({
    sessionId: `fallback-reader-${fixture.kind}`,
    semantic: semanticRetriever(async () => { throw Object.assign(new Error('secret backend details'), { code: 'backend' }) }),
  })
  try {
    expect((await reader.memory.search({ query: 'lexical fallback', tokenBudget: 100 })).map(result => result.record.id)).toEqual([lexical.id])
    expect(reader.memory.semanticFailure()).toMatchObject({ code: 'backend' })
    expect(JSON.stringify(reader.memory.semanticFailure())).not.toContain('secret backend details')
  } finally {
    await reader.dispose()
  }
}

export async function assertCompleteLexicalQueryProjection(fixture: MemoryBackendFixture): Promise<void> {
  const seed = await fixture.createSession({ sessionId: `projection-seed-${fixture.kind}` })
  const lexical = await seed.memory.remember({ operationId: `projection-lexical-${fixture.kind}`, subjectKey: 'project.projection.symbol', kind: 'fact', content: 'The exact symbol is RPC_FRAME_V7.' })
  const semantic = await seed.memory.remember({ operationId: `projection-semantic-${fixture.kind}`, subjectKey: 'project.projection.intent', kind: 'fact', content: 'Transport frames isolate message boundaries.' })
  await activateSemanticGeneration(seed)
  await seed.dispose()
  let observedQuery = ''
  const reader = await fixture.createSession({
    sessionId: `projection-reader-${fixture.kind}`,
    memoryConfig: { semanticQueryMaximumCharacters: 48 },
    semantic: semanticRetriever(async request => {
      observedQuery = request.query
      return [{ generationId: 'backend-generation', recordId: semantic.id, revisionId: semantic.revision.id, rank: 1 }]
    }),
  })
  try {
    const query = `RPC_FRAME_V7 ${'background '.repeat(20)}. How are message boundaries isolated?`
    const result = await reader.memory.search({ query, tokenBudget: 200 })
    expect(observedQuery).toBe('How are message boundaries isolated?')
    expect(result.map(item => item.record.id)).toEqual(expect.arrayContaining([lexical.id, semantic.id]))
  } finally {
    await reader.dispose()
  }
}

export async function assertHybridFusion(fixture: MemoryBackendFixture): Promise<void> {
  const seed = await fixture.createSession({ sessionId: `hybrid-seed-${fixture.kind}` })
  const lexical = await seed.memory.remember({ operationId: `hybrid-lexical-${fixture.kind}`, subjectKey: 'project.hybrid.lexical', kind: 'fact', content: 'SQLite syntax appears only in lexical memory.', salience: 0.2 })
  const semantic = await seed.memory.remember({ operationId: `hybrid-semantic-${fixture.kind}`, subjectKey: 'project.hybrid.semantic', kind: 'procedure', content: 'Persist writes in short transactions.', salience: 0.8 })
  const overlap = await seed.memory.remember({ operationId: `hybrid-overlap-${fixture.kind}`, subjectKey: 'project.hybrid.overlap', kind: 'procedure', content: 'SQLite writes use short transactions.', salience: 0.5 })
  const lexicalRanks = new Map(
    (await seed.memory.search({ query: 'SQLite', tokenBudget: 200 }))
      .map(result => [result.record.id, result.lexicalRank] as const),
  )
  await activateSemanticGeneration(seed)
  await seed.dispose()
  const reader = await fixture.createSession({
    sessionId: `hybrid-reader-${fixture.kind}`,
    semantic: semanticRetriever(async () => [
      { generationId: 'backend-generation', recordId: semantic.id, revisionId: semantic.revision.id, rank: 1 },
      { generationId: 'backend-generation', recordId: overlap.id, revisionId: overlap.revision.id, rank: 2 },
    ]),
  })
  try {
    const result = await reader.memory.search({ query: 'SQLite', tokenBudget: 200 })
    expect(result.map(item => item.record.id)).toEqual([overlap.id, semantic.id, lexical.id])
    expect(result[0]).toMatchObject({ lexicalRank: lexicalRanks.get(overlap.id), semanticRank: 2 })
    expect(new Set(result.map(item => item.record.id)).size).toBe(result.length)
  } finally {
    await reader.dispose()
  }
}

export async function assertStaleSemanticRevalidation(fixture: MemoryBackendFixture): Promise<void> {
  const seed = await fixture.createSession({ sessionId: `stale-seed-${fixture.kind}` })
  const corrected = await seed.memory.remember({ operationId: `stale-corrected-${fixture.kind}`, subjectKey: 'project.stale.corrected', kind: 'fact', content: 'Stale corrected value.' })
  const forgotten = await seed.memory.remember({ operationId: `stale-forgotten-${fixture.kind}`, subjectKey: 'project.stale.forgotten', kind: 'fact', content: 'Stale forgotten value.' })
  const stable = await seed.memory.remember({ operationId: `stale-stable-${fixture.kind}`, subjectKey: 'project.stale.stable', kind: 'fact', content: 'Stale stable value.' })
  await activateSemanticGeneration(seed)
  await seed.dispose()
  const started = Promise.withResolvers<void>()
  const blocked = Promise.withResolvers<void>()
  const reader = await fixture.createSession({
    sessionId: `stale-reader-${fixture.kind}`,
    semantic: semanticRetriever(async () => {
      started.resolve()
      await blocked.promise
      return [corrected, forgotten, stable].map((record, index) => ({ generationId: 'backend-generation', recordId: record.id, revisionId: record.revision.id, rank: index + 1 }))
    }),
  })
  const pending = reader.memory.search({ query: 'Stale', tokenBudget: 200 })
  await started.promise
  const writer = await fixture.createSession({ sessionId: `stale-writer-${fixture.kind}` })
  await writer.memory.correct({ operationId: `stale-correct-${fixture.kind}`, id: corrected.id, expectedRevisionId: corrected.revision.id, content: 'Fresh corrected value.' })
  await writer.memory.forget({ operationId: `stale-forget-${fixture.kind}`, id: forgotten.id })
  await writer.dispose()
  blocked.resolve()
  try {
    expect((await pending).map(result => result.record.id)).toEqual([stable.id])
  } finally {
    await reader.dispose()
  }
}

export async function assertFinalRecallRevalidation(fixture: MemoryBackendFixture): Promise<void> {
  let clock = new Date(NOW)
  const started = Promise.withResolvers<void>()
  const blocked = Promise.withResolvers<void>()
  const reader = await fixture.createSession({
    sessionId: `recall-reader-${fixture.kind}`,
    now: () => clock,
    semantic: semanticRetriever(async () => { started.resolve(); await blocked.promise; return [] }),
  })
  const corrected = await reader.memory.remember({ operationId: `recall-corrected-${fixture.kind}`, subjectKey: 'principal.identity.corrected', kind: 'fact', content: 'The stale identity value.', scope: 'relationship' })
  const forgotten = await reader.memory.remember({ operationId: `recall-forgotten-${fixture.kind}`, subjectKey: 'principal.identity.forgotten', kind: 'fact', content: 'The forgotten identity value.', scope: 'relationship' })
  const expiring = await reader.memory.remember({ operationId: `recall-expiring-${fixture.kind}`, subjectKey: 'principal.identity.expiring', kind: 'fact', content: 'The expiring identity value.', scope: 'relationship', expiresAt: '2026-09-06T12:01:00.000Z' })
  await activateSemanticGeneration(reader)
  const pending = reader.context.doppelgangerContext.resolve({ turn: { input: 'identity' }, tokenBudget: 200 })
  await started.promise
  const writer = await fixture.createSession({ sessionId: `recall-writer-${fixture.kind}`, now: () => clock })
  const current = await writer.memory.correct({ operationId: `recall-correct-${fixture.kind}`, id: corrected.id, expectedRevisionId: corrected.revision.id, content: 'The current identity value.' })
  await writer.memory.forget({ operationId: `recall-forget-${fixture.kind}`, id: forgotten.id })
  clock = new Date('2026-09-06T12:02:00.000Z')
  await writer.dispose()
  blocked.resolve()
  try {
    const assembled = await pending
    expect(assembled.contributions).toEqual([expect.objectContaining({ source: `memory.${current.id}`, content: expect.stringContaining('The current identity value.') })])
    expect(assembled.data).not.toContain(corrected.revision.content)
    expect(assembled.data).not.toContain(forgotten.revision.content)
    expect(assembled.data).not.toContain(expiring.revision.content)
  } finally {
    await reader.dispose()
  }
}

export async function assertNoProjectionWorkWithoutGeneration(fixture: MemoryBackendFixture): Promise<void> {
  const session = await fixture.createSession({ sessionId: `no-projection-${fixture.kind}` })
  try {
    const record = await session.memory.remember({ operationId: `no-projection-${fixture.kind}`, subjectKey: 'project.no.projection', kind: 'fact', content: 'Canonical and lexical state commit without semantic configuration.' })
    expect(await count(session, 'memory_records', ' WHERE id = ?', [record.id])).toBe(1)
    expect(await count(session, fixture.kind === 'sqlite' ? 'memory_fts' : 'memory_lexical_index', ' WHERE record_id = ?', [record.id])).toBe(1)
    expect(await count(session, 'memory_vector_projection_work', ' WHERE record_id = ?', [record.id])).toBe(0)
  } finally {
    await session.dispose()
  }
}

export async function assertProjectionAtomicCommit(fixture: MemoryBackendFixture): Promise<void> {
  const session = await fixture.createSession({ sessionId: `projection-atomic-${fixture.kind}` })
  try {
    await activateSemanticGeneration(session)
    const record = await session.memory.remember({ operationId: `projection-atomic-${fixture.kind}`, subjectKey: 'project.projection.atomic', kind: 'fact', content: 'Canonical and projection state commit atomically.' })
    expect(await count(session, 'memory_records', ' WHERE id = ?', [record.id])).toBe(1)
    expect(await count(session, 'memory_vector_projection_work', ' WHERE record_id = ? AND revision_id = ?', [record.id, record.revision.id])).toBe(1)
  } finally {
    await session.dispose()
  }
}

export async function assertMultilingualLexicalCorpus(fixture: MemoryBackendFixture): Promise<void> {
  const session = await fixture.createSession({ sessionId: `lexical-corpus-${fixture.kind}` })
  try {
    const records = await Promise.all([
      session.memory.remember({ operationId: `lexical-ru-${fixture.kind}`, subjectKey: 'project.lexical.ru', kind: 'fact', content: 'Проект использует транзакционную память.' }),
      session.memory.remember({ operationId: `lexical-en-${fixture.kind}`, subjectKey: 'project.lexical.en', kind: 'fact', content: 'The runtime uses canonical memory transactions.' }),
      session.memory.remember({ operationId: `lexical-id-${fixture.kind}`, subjectKey: 'project.lexical.identifier', kind: 'fact', content: 'The exact transport identifier is RPC_FRAME_V7.' }),
      session.memory.remember({ operationId: `lexical-unicode-${fixture.kind}`, subjectKey: 'project.lexical.unicode', kind: 'fact', content: 'Unicode protocol Ω preserves границы.' }),
    ])
    const cases = [
      ['транзакционную память', records[0]!.id],
      ['canonical transactions', records[1]!.id],
      [`irrelevant words ${'background '.repeat(8)} RPC_FRAME_V7`, records[2]!.id],
      ['Unicode Ω границы', records[3]!.id],
    ] as const
    for (const [query, id] of cases) {
      expect((await session.memory.search({ query, tokenBudget: 500 })).map(item => item.record.id), query).toContain(id)
    }
  } finally {
    await session.dispose()
  }
}

export async function assertConcurrentSubjectCreation(fixture: MemoryBackendFixture): Promise<void> {
  const first = await fixture.createSession({ sessionId: `subject-first-${fixture.kind}` })
  const second = await fixture.createSession({ sessionId: `subject-second-${fixture.kind}` })
  const gate = Promise.withResolvers<void>()
  const start = async (operation: () => Promise<unknown>) => { await gate.promise; return operation() }
  const firstWrite = start(() => first.memory.remember({ operationId: `subject-first-${fixture.kind}`, subjectKey: 'project.concurrent.subject', kind: 'decision', content: 'Use transport A.' }))
  const secondWrite = start(() => second.memory.remember({ operationId: `subject-second-${fixture.kind}`, subjectKey: 'project.concurrent.subject', kind: 'decision', content: 'Use transport B.' }))
  gate.resolve()
  const settled = await Promise.allSettled([firstWrite, secondWrite])
  try {
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const loser = settled.find(result => result.status === 'rejected')
    expect(loser?.status).toBe('rejected')
    if (loser?.status === 'rejected') expect(structuredCode(loser.reason)).toBe('SUBJECT_CONFLICT')
    const current = await first.memory.search({ query: 'transport', tokenBudget: 100 })
    expect(current).toHaveLength(1)
    expect(await first.memory.history(current[0]!.record.id)).toHaveLength(1)
  } finally {
    await second.dispose()
    await first.dispose()
  }
}

export async function assertConcurrentCorrectionCas(fixture: MemoryBackendFixture): Promise<void> {
  const seed = await fixture.createSession({ sessionId: `cas-seed-${fixture.kind}` })
  const record = await seed.memory.remember({ operationId: `cas-seed-${fixture.kind}`, subjectKey: 'project.concurrent.cas', kind: 'decision', content: 'Use runtime A.' })
  await seed.dispose()
  const first = await fixture.createSession({ sessionId: `cas-first-${fixture.kind}` })
  const second = await fixture.createSession({ sessionId: `cas-second-${fixture.kind}` })
  const gate = Promise.withResolvers<void>()
  const correct = async (session: MemoryBackendSession, suffix: string, content: string) => {
    await gate.promise
    return session.memory.correct({ operationId: `cas-${suffix}-${fixture.kind}`, id: record.id, expectedRevisionId: record.revision.id, content })
  }
  const pending = [correct(first, 'first', 'Use runtime B.'), correct(second, 'second', 'Use runtime C.')]
  gate.resolve()
  const settled = await Promise.allSettled(pending)
  try {
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const loser = settled.find(result => result.status === 'rejected')
    if (loser?.status === 'rejected') expect(structuredCode(loser.reason)).toBe('REVISION_CONFLICT')
    const history = await first.memory.history(record.id)
    expect(history).toHaveLength(2)
    expect(history[1]?.supersedesRevisionId).toBe(record.revision.id)
  } finally {
    await second.dispose()
    await first.dispose()
  }
}

export async function assertConcurrentIdenticalOperation(fixture: MemoryBackendFixture): Promise<void> {
  const first = await fixture.createSession({ sessionId: `identical-first-${fixture.kind}` })
  const second = await fixture.createSession({ sessionId: `identical-second-${fixture.kind}` })
  const request = {
    operationId: `identical-operation-${fixture.kind}`,
    subjectKey: 'project.concurrent.identical',
    kind: 'fact' as const,
    content: 'Identical delivery commits once.',
    evidence: { turnId: 'identical-turn', role: 'principal' as const },
  }
  const gate = Promise.withResolvers<void>()
  const deliver = async (session: MemoryBackendSession) => { await gate.promise; return session.memory.remember(request) }
  const pending = [deliver(first), deliver(second)]
  gate.resolve()
  const results = await Promise.all(pending)
  const left = results[0]!
  const right = results[1]!
  try {
    expect(left.id).toBe(right.id)
    expect(left.revision.id).toBe(right.revision.id)
    expect(await first.memory.history(left.id)).toHaveLength(1)
    expect(await first.memory.evidence(left.id)).toHaveLength(1)
    expect(await count(first, 'memory_operations', ' WHERE operation_id = ?', [request.operationId])).toBe(1)
  } finally {
    await second.dispose()
    await first.dispose()
  }
}

export async function assertCurrentReadFreshness(fixture: MemoryBackendFixture): Promise<void> {
  const first = await fixture.createSession({ sessionId: `fresh-writer-${fixture.kind}` })
  const second = await fixture.createSession({ sessionId: `fresh-reader-${fixture.kind}` })
  const record = await first.memory.remember({ operationId: `fresh-seed-${fixture.kind}`, subjectKey: 'project.freshness.current', kind: 'fact', content: 'The initial committed value.' })
  expect((await second.memory.inspect(record.id)).revision.id).toBe(record.revision.id)
  const corrected = await first.memory.correct({ operationId: `fresh-correct-${fixture.kind}`, id: record.id, expectedRevisionId: record.revision.id, content: 'The current committed value.' })
  try {
    expect(await second.memory.inspect(record.id)).toEqual(corrected)
  } finally {
    await second.dispose()
    await first.dispose()
  }
}

export async function assertDeletionFreshness(fixture: MemoryBackendFixture): Promise<void> {
  const first = await fixture.createSession({ sessionId: `delete-writer-${fixture.kind}` })
  const second = await fixture.createSession({ sessionId: `delete-reader-${fixture.kind}` })
  const record = await first.memory.remember({ operationId: `delete-seed-${fixture.kind}`, subjectKey: 'project.freshness.deleted', kind: 'fact', content: 'This committed value will be deleted.' })
  expect((await second.memory.inspect(record.id)).id).toBe(record.id)
  await first.memory.forget({ operationId: `delete-forget-${fixture.kind}`, id: record.id })
  try {
    expect(await second.memory.get(record.id)).toBeUndefined()
    expect((await second.memory.search({ query: 'committed deleted', tokenBudget: 100 })).map(result => result.record.id)).not.toContain(record.id)
  } finally {
    await second.dispose()
    await first.dispose()
  }
}

async function installSqliteOutboxFailure(session: MemoryBackendSession): Promise<void> {
  await session.database.write({ instanceId: 'backend-persona' }, async em => {
    await em.execute(`CREATE TRIGGER fail_projection_insert BEFORE INSERT ON memory_vector_projection_work BEGIN SELECT RAISE(ABORT, 'projection write failed'); END`, [], 'run')
  })
}

async function installPostgresqlLexicalFailure(session: MemoryBackendSession): Promise<void> {
  await session.database.write({ instanceId: 'backend-persona' }, async em => {
    await em.execute(`CREATE FUNCTION fail_memory_lexical_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'lexical write failed'; END $$`, [], 'run')
    await em.execute(`CREATE TRIGGER fail_memory_lexical_insert BEFORE INSERT OR UPDATE ON memory_lexical_index FOR EACH ROW EXECUTE FUNCTION fail_memory_lexical_write()`, [], 'run')
  })
}

async function assertNoFailedMutationRows(session: MemoryBackendSession, subjectKey: string): Promise<void> {
  expect(await count(session, 'memory_records', ' WHERE subject_key = ?', [subjectKey])).toBe(0)
  expect(await count(session, 'memory_revisions')).toBe(0)
  expect(await count(session, 'memory_evidence')).toBe(0)
  expect(await count(session, 'memory_operations')).toBe(0)
  expect(await count(session, session.database.kind === 'sqlite' ? 'memory_fts' : 'memory_lexical_index')).toBe(0)
  expect(await count(session, 'memory_vector_projection_work')).toBe(0)
}

export async function assertSqliteOutboxRollback(fixture: MemoryBackendFixture): Promise<void> {
  expect(fixture.kind).toBe('sqlite')
  const session = await fixture.createSession({ sessionId: 'sqlite-outbox-rollback' })
  try {
    await activateSemanticGeneration(session)
    await installSqliteOutboxFailure(session)
    await expect(session.memory.remember({ operationId: 'sqlite-outbox-rollback', subjectKey: 'project.atomic.sqlite', kind: 'fact', content: 'This mutation must roll back.' })).rejects.toBeDefined()
    await assertNoFailedMutationRows(session, 'project.atomic.sqlite')
  } finally {
    await session.dispose()
  }
}

export async function assertPostgresqlLexicalRollback(fixture: MemoryBackendFixture): Promise<void> {
  expect(fixture.kind).toBe('postgresql')
  const session = await fixture.createSession({ sessionId: 'postgresql-lexical-rollback' })
  try {
    await installPostgresqlLexicalFailure(session)
    await expect(session.memory.remember({ operationId: 'postgresql-lexical-rollback', subjectKey: 'project.atomic.postgresql', kind: 'fact', content: 'This mutation must roll back.' })).rejects.toBeDefined()
    await assertNoFailedMutationRows(session, 'project.atomic.postgresql')
  } finally {
    await session.dispose()
  }
}

export async function queryWithManager(manager: SqlEntityManager, sql: string, parameters: readonly unknown[] = []) {
  return await manager.execute(sql, [...parameters], 'all') as readonly Record<string, unknown>[]
}

export { activateSemanticGeneration, semanticRetriever }

async function waitForPostgresqlInstanceLockWait(fixture: MemoryBackendFixture): Promise<void> {
  const postgresql = fixture.postgresql
  if (postgresql === undefined) throw new Error('PostgreSQL fixture is unavailable')
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const waiting = await postgresql.client.em.fork().execute<Array<{ waiting: boolean }>>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE '%memory_instance_locks%'
          AND query LIKE '%FOR UPDATE%'
      ) AS waiting
    `)
    if (waiting[0]?.waiting === true) return
    const delay = Promise.withResolvers<void>()
    setTimeout(delay.resolve, 10)
    await delay.promise
  }
  throw new Error('repository write did not wait on the PostgreSQL instance lock')
}

export async function assertPostgresqlInstanceBeforePartitionLockOrder(fixture: MemoryBackendFixture): Promise<void> {
  expect(fixture.kind).toBe('postgresql')
  const postgresql = fixture.postgresql
  if (postgresql === undefined) throw new Error('PostgreSQL fixture is unavailable')
  const session = await fixture.createSession({ actorId: 'lock-order-actor', sessionId: 'lock-order-writer', projectId: 'lock-order-project' })
  const instanceClient = await postgresql.createIndependentClient()
  const actorClient = await postgresql.createIndependentClient()
  const instanceHeld = Promise.withResolvers<void>()
  const releaseInstance = Promise.withResolvers<void>()
  const actorHeld = Promise.withResolvers<void>()
  const releaseActor = Promise.withResolvers<void>()
  await session.database.write({ instanceId: 'backend-persona', actorId: 'lock-order-actor' }, async () => undefined)

  const instanceLock = memoryTransaction(instanceClient.em, 'write', async em => {
    await em.execute(`SET LOCAL search_path TO "${postgresql.schema}"`)
    await em.execute('SELECT instance_id FROM memory_instance_locks WHERE instance_id = ? FOR UPDATE', ['backend-persona'])
    instanceHeld.resolve()
    await releaseInstance.promise
  })
  await instanceHeld.promise
  const writer = session.memory.remember({
    operationId: 'lock-order-write',
    subjectKey: 'project.lock.order',
    kind: 'fact',
    content: 'PostgreSQL acquires the instance lock before the actor partition lock.',
  })
  await waitForPostgresqlInstanceLockWait(fixture)

  const actorLock = memoryTransaction(actorClient.em, 'write', async em => {
    await em.execute(`SET LOCAL search_path TO "${postgresql.schema}"`)
    await em.execute(
      'SELECT instance_id FROM memory_partition_locks WHERE instance_id = ? AND actor_id = ? FOR UPDATE',
      ['backend-persona', 'lock-order-actor'],
    )
    actorHeld.resolve()
    await releaseActor.promise
  })
  const actorDeadline = Promise.withResolvers<never>()
  const timeout = setTimeout(() => actorDeadline.reject(new Error('repository held the actor partition lock while waiting for the instance lock')), 5_000)
  try {
    await Promise.race([actorHeld.promise, actorDeadline.promise])
    releaseActor.resolve()
    await actorLock
    releaseInstance.resolve()
    expect((await writer).revision.content).toContain('instance lock before the actor partition lock')
    await instanceLock
  } finally {
    clearTimeout(timeout)
    releaseActor.resolve()
    releaseInstance.resolve()
    await Promise.allSettled([actorLock, instanceLock, writer])
    await actorClient.close()
    await instanceClient.close()
    await session.dispose()
  }
}

export async function assertActorPartitionRestart(fixture: MemoryBackendFixture): Promise<void> {
  const writer = await fixture.createSession({ actorId: 'restart-actor', sessionId: `restart-writer-${fixture.kind}`, projectId: 'restart-project' })
  const relationship = await writer.memory.remember({ operationId: `restart-relationship-${fixture.kind}`, subjectKey: 'preference.restart.relationship', kind: 'preference', content: 'Restart preserves relationship memory.', scope: 'relationship' })
  const project = await writer.memory.remember({ operationId: `restart-project-${fixture.kind}`, subjectKey: 'project.restart.fact', kind: 'fact', content: 'Restart preserves project memory.' })
  await writer.dispose()
  const reader = await fixture.createSession({ actorId: 'restart-actor', sessionId: `restart-reader-${fixture.kind}`, projectId: 'restart-project' })
  try {
    expect((await reader.memory.inspect(relationship.id)).id).toBe(relationship.id)
    expect((await reader.memory.inspect(project.id)).id).toBe(project.id)
  } finally {
    await reader.dispose()
  }
  const foreign = await fixture.createSession({ actorId: 'restart-foreign', sessionId: `restart-foreign-${fixture.kind}`, projectId: 'restart-project' })
  try {
    expect(await foreign.memory.get(relationship.id)).toBeUndefined()
    expect(await foreign.memory.get(project.id)).toBeUndefined()
  } finally {
    await foreign.dispose()
  }
}

function sqliteClientBackend(fixture: MemoryBackendFixture) {
  if (fixture.kind !== 'sqlite' || fixture.sqliteHome === undefined) throw new Error('SQLite process fixture is unavailable')
  return { kind: 'sqlite' as const, home: fixture.sqliteHome, namespace: 'memory' }
}

export async function assertSqliteProcessSubjectCreation(fixture: MemoryBackendFixture): Promise<void> {
  const backend = sqliteClientBackend(fixture)
  const first = await startMemoryTestClient({
    backend, actorId: 'backend-actor', sessionId: 'process-subject-first', projectId: 'backend-project',
    operation: { kind: 'remember', request: { operationId: 'process-subject-first', subjectKey: 'project.process.subject', kind: 'decision', content: 'Use process transport A.' } },
  })
  const second = await startMemoryTestClient({
    backend, actorId: 'backend-actor', sessionId: 'process-subject-second', projectId: 'backend-project',
    operation: { kind: 'remember', request: { operationId: 'process-subject-second', subjectKey: 'project.process.subject', kind: 'decision', content: 'Use process transport B.' } },
  })
  try {
    const settled = await Promise.all([first.go(), second.go()])
    expect(settled.filter(result => result.ok)).toHaveLength(1)
    expect(settled.find(result => !result.ok)).toMatchObject({ ok: false, error: { code: 'SUBJECT_CONFLICT' } })
    const reader = await fixture.createSession({ sessionId: 'process-subject-reader' })
    try {
      const result = await reader.memory.search({ query: 'process transport', tokenBudget: 100 })
      expect(result).toHaveLength(1)
      expect(await reader.memory.history(result[0]!.record.id)).toHaveLength(1)
    } finally {
      await reader.dispose()
    }
  } finally {
    await second.close()
    await first.close()
  }
}

export async function assertSqliteProcessIdenticalOperation(fixture: MemoryBackendFixture): Promise<void> {
  const backend = sqliteClientBackend(fixture)
  const operation = {
    kind: 'remember' as const,
    request: {
      operationId: 'process-identical-operation',
      subjectKey: 'project.process.identical',
      kind: 'fact' as const,
      content: 'Identical process delivery commits once.',
      evidence: { turnId: 'process-identical-turn', role: 'principal' as const },
    },
  }
  const first = await startMemoryTestClient({ backend, actorId: 'backend-actor', sessionId: 'process-identical-first', projectId: 'backend-project', operation })
  const second = await startMemoryTestClient({ backend, actorId: 'backend-actor', sessionId: 'process-identical-second', projectId: 'backend-project', operation })
  try {
    const [left, right] = await Promise.all([first.go(), second.go()])
    expect(left).toMatchObject({ ok: true })
    expect(right).toMatchObject({ ok: true })
    if (!left.ok || !right.ok || typeof left.value === 'boolean' || typeof right.value === 'boolean') throw new Error('identical process delivery did not return records')
    expect(left.value.id).toBe(right.value.id)
    expect(left.value.revision.id).toBe(right.value.revision.id)
    const reader = await fixture.createSession({ sessionId: 'process-identical-reader' })
    try {
      expect(await reader.memory.history(left.value.id)).toHaveLength(1)
      expect(await reader.memory.evidence(left.value.id)).toHaveLength(1)
      expect(await count(reader, 'memory_operations', ' WHERE operation_id = ?', [operation.request.operationId])).toBe(1)
    } finally {
      await reader.dispose()
    }
  } finally {
    await second.close()
    await first.close()
  }
}

export async function assertSqliteProcessCorrectionCas(fixture: MemoryBackendFixture): Promise<void> {
  const seed = await fixture.createSession({ sessionId: 'process-cas-seed' })
  const record = await seed.memory.remember({ operationId: 'process-cas-seed', subjectKey: 'project.process.cas', kind: 'decision', content: 'Use process runtime A.' })
  await seed.dispose()
  const backend = sqliteClientBackend(fixture)
  const first = await startMemoryTestClient({
    backend, actorId: 'backend-actor', sessionId: 'process-cas-first', projectId: 'backend-project',
    operation: { kind: 'correct', request: { operationId: 'process-cas-first', id: record.id, expectedRevisionId: record.revision.id, content: 'Use process runtime B.' } },
  })
  const second = await startMemoryTestClient({
    backend, actorId: 'backend-actor', sessionId: 'process-cas-second', projectId: 'backend-project',
    operation: { kind: 'correct', request: { operationId: 'process-cas-second', id: record.id, expectedRevisionId: record.revision.id, content: 'Use process runtime C.' } },
  })
  try {
    const settled = await Promise.all([first.go(), second.go()])
    expect(settled.filter(result => result.ok)).toHaveLength(1)
    expect(settled.find(result => !result.ok)).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } })
    const reader = await fixture.createSession({ sessionId: 'process-cas-reader' })
    try {
      const history = await reader.memory.history(record.id)
      expect(history).toHaveLength(2)
      expect(history[1]?.supersedesRevisionId).toBe(record.revision.id)
    } finally {
      await reader.dispose()
    }
  } finally {
    await second.close()
    await first.close()
  }
}

export async function assertSqliteProcessFreshness(fixture: MemoryBackendFixture): Promise<void> {
  const writer = await fixture.createSession({ sessionId: 'process-freshness-writer' })
  const record = await writer.memory.remember({ operationId: 'process-freshness-seed', subjectKey: 'project.process.freshness', kind: 'fact', content: 'The process sees the initial value.' })
  const child = await startMemoryTestClient({
    backend: sqliteClientBackend(fixture), actorId: 'backend-actor', sessionId: 'process-freshness-reader', projectId: 'backend-project',
    operation: { kind: 'inspect', id: record.id },
  })
  const corrected = await writer.memory.correct({ operationId: 'process-freshness-correct', id: record.id, expectedRevisionId: record.revision.id, content: 'The process sees the current value.' })
  try {
    const result = await child.go()
    expect(result).toMatchObject({ ok: true })
    if (!result.ok || typeof result.value === 'boolean') throw new Error('freshness process did not return a record')
    expect(result.value).toEqual(corrected)
  } finally {
    await child.close()
    await writer.dispose()
  }
}
